import { createHash, randomBytes, timingSafeEqual, scrypt as rawScrypt, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(rawScrypt);
export class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED') { super(message); this.status = status; this.code = code; }
}
export const digest = value => createHash('sha256').update(String(value)).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export const equal = (a, b) => timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
export function requireConfig(env) {
  if (!env.GEO_ACCOUNT || !env.GEO_PASSWORD_HASH || !/^[a-f0-9]{64}$/i.test(env.GEO_MASTER_KEY || '')) {
    throw new HttpError(503, '服务端尚未完成登录配置，请联系管理员。', 'SETUP_REQUIRED');
  }
}
export async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function passwordMatches(password, encoded) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [kind, salt, hash] = String(encoded).split(':');
  if (kind !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hash || '')) return false;
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
export function seal(value, env, context) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(env.GEO_MASTER_KEY, 'hex'), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
export function unseal(value, env, context) {
  try {
    if (value?.v !== 1) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(env.GEO_MASTER_KEY, 'hex'), Buffer.from(value.iv, 'base64'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8'));
  } catch { throw new HttpError(503, '凭据无法解密，请管理员检查服务端加密配置。', 'CREDENTIAL_ERROR'); }
}
export function sessionCookie(value, env, maxAge = 604800) {
  const secure = env.GEO_LOCAL_DEV === '1' ? '' : '; Secure';
  return `lxue_session=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`;
}
export function cookieToken(request) {
  return (request.headers.get('cookie') || '').match(/(?:^|;\s*)lxue_session=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1] || '';
}
export function checkOrigin(request, env) {
  if (['GET', 'HEAD'].includes(request.method)) return;
  const expected = env.APP_ORIGIN || 'https://geo.lxue.xin';
  if (request.headers.get('origin') !== expected) throw new HttpError(403, '请求来源不匹配，请从本站重新登录。', 'ORIGIN_REJECTED');
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new HttpError(415, '请求格式不支持。');
}
export async function readJson(request, maxBytes = 4 * 1024 * 1024) {
  if (Number(request.headers.get('content-length')) > maxBytes) throw new HttpError(413, '提交内容过大，请拆分批次或文档。');
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new HttpError(413, '提交内容过大，请拆分批次或文档。'); }
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400, '请求 JSON 无效。'); }
}
export function textValue(value, label, max = 512, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new HttpError(400, `${label}未填写或过长。`);
  return value.trim();
}
