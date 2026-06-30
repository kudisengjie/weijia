import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeEdgeOneLog, summarizeCrawlerLogs } from './crawler-classifier.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.ADMIN_PORT || 8787);
const sessionCookie = 'geo_admin_session';
const sessionSecret = process.env.SESSION_SECRET || process.env.ADMIN_SESSION_SECRET || '';
const username = process.env.ADMIN_USERNAME || '13539770556';

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=UTF-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(JSON.stringify(body));
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((part) => part.trim().split('=')).filter(([key]) => key).map(([key, ...value]) => [key, decodeURIComponent(value.join('='))])
  );
}

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');
}

function createSession(remember) {
  const maxAge = remember ? 30 * 24 * 60 * 60 : 8 * 60 * 60;
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + maxAge * 1000 })).toString('base64url');
  return { token: `${payload}.${sign(payload)}`, maxAge };
}

function verifySession(req) {
  if (!sessionSecret) return false;
  const token = parseCookies(req.headers.cookie || '')[sessionCookie];
  if (!token || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  if (signature !== sign(payload)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

function verifyPassword(password) {
  const stored = process.env.ADMIN_PASSWORD_HASH;
  if (stored) {
    const [iterationsRaw, salt, expected] = stored.split(':');
    const iterations = Number(iterationsRaw);
    if (!iterations || !salt || !expected) return false;
    const actual = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  }
  const plain = process.env.ADMIN_PASSWORD;
  return Boolean(plain) && crypto.timingSafeEqual(Buffer.from(password), Buffer.from(plain));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function tencentSign({ secretId, secretKey, region, service, action, version, payload }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const hashedPayload = crypto.createHash('sha256').update(payload).digest('hex');
  const canonicalRequest = ['POST', '/', '', 'content-type:application/json; charset=utf-8\nhost:cls.tencentcloudapi.com\n', 'content-type;host', hashedPayload].join('\n');
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const secretDate = crypto.createHmac('sha256', `TC3${secretKey}`).update(date).digest();
  const secretService = crypto.createHmac('sha256', secretDate).update(service).digest();
  const secretSigning = crypto.createHmac('sha256', secretService).update('tc3_request').digest();
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
  return {
    Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`,
    'Content-Type': 'application/json; charset=utf-8',
    Host: 'cls.tencentcloudapi.com',
    'X-TC-Action': action,
    'X-TC-Version': version,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Region': region
  };
}

async function queryClsLogs(range = '7d') {
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  const topicId = process.env.TENCENT_CLS_TOPIC_ID;
  const region = process.env.TENCENT_REGION || 'ap-guangzhou';
  if (!secretId || !secretKey || !topicId) {
    return [];
  }

  const seconds = range === '30d' ? 30 * 86400 : range === '24h' ? 86400 : 7 * 86400;
  const payload = JSON.stringify({
    TopicId: topicId,
    From: Math.floor(Date.now() / 1000) - seconds,
    To: Math.floor(Date.now() / 1000),
    Query: process.env.TENCENT_CLS_QUERY || 'RequestUA:*',
    Limit: Number(process.env.TENCENT_CLS_LIMIT || 200),
    Sort: 'desc'
  });
  const headers = tencentSign({
    secretId,
    secretKey,
    region,
    service: 'cls',
    action: 'SearchLog',
    version: '2020-10-16',
    payload
  });

  const response = await fetch('https://cls.tencentcloudapi.com', { method: 'POST', headers, body: payload });
  const data = await response.json();
  if (!response.ok || data.Response?.Error) {
    throw new Error(data.Response?.Error?.Message || `CLS SearchLog failed with ${response.status}`);
  }
  const rows = data.Response?.Results || data.Response?.AnalysisRecords || [];
  return rows.map((row) => normalizeEdgeOneLog(row.LogJson ? JSON.parse(row.LogJson) : row)).filter(Boolean);
}

async function queryJsonlLogs() {
  const logFile = process.env.CRAWLER_LOG_FILE;
  if (!logFile) return [];
  const raw = await fs.readFile(logFile, 'utf8');
  return raw.split(/\r?\n/).filter(Boolean).map((line) => normalizeEdgeOneLog(JSON.parse(line)));
}

async function loadCrawlerLogs(range) {
  const source = process.env.LOG_SOURCE || 'cls';
  const logs = source === 'jsonl' ? await queryJsonlLogs() : await queryClsLogs(range);
  return {
    source,
    logs,
    summary: summarizeCrawlerLogs(logs)
  };
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const file = url.pathname === '/admin/' || url.pathname === '/admin' ? 'index.html' : url.pathname.replace(/^\/admin\//, '');
  const target = path.normalize(path.join(root, file));
  if (!target.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const ext = path.extname(target);
  const type = ext === '.css' ? 'text/css; charset=UTF-8' : ext === '.js' ? 'application/javascript; charset=UTF-8' : 'text/html; charset=UTF-8';
  try {
    const data = await fs.readFile(target);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/admin/login' && req.method === 'POST') {
      if (!sessionSecret) {
        json(res, 500, { error: 'SESSION_SECRET is not configured.' });
        return;
      }
      const body = await readBody(req);
      if (body.username !== username || !verifyPassword(String(body.password || ''))) {
        json(res, 401, { error: '用户名或密码错误' });
        return;
      }
      const session = createSession(Boolean(body.remember));
      json(res, 200, { ok: true }, {
        'Set-Cookie': `${sessionCookie}=${encodeURIComponent(session.token)}; Path=/; Max-Age=${session.maxAge}; HttpOnly; SameSite=Lax`
      });
      return;
    }

    if (url.pathname === '/api/admin/logout') {
      json(res, 200, { ok: true }, {
        'Set-Cookie': `${sessionCookie}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
      });
      return;
    }

    if (url.pathname === '/api/admin/session') {
      json(res, 200, { authenticated: verifySession(req) });
      return;
    }

    if (url.pathname === '/api/admin/crawler-logs') {
      if (!verifySession(req)) {
        json(res, 401, { error: 'Unauthorized' });
        return;
      }
      const data = await loadCrawlerLogs(url.searchParams.get('range') || '7d');
      json(res, 200, data);
      return;
    }

    if (url.pathname.startsWith('/admin')) {
      await serveStatic(req, res);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (error) {
    json(res, 500, { error: error.message });
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  http.createServer(handle).listen(port, () => {
    console.log(`Crawler admin server listening on http://localhost:${port}/admin/`);
  });
}

export { handle };
