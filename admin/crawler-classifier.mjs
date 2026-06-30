import crypto from 'node:crypto';

const CRAWLER_RULES = [
  {
    name: 'Doubao / ByteDance',
    key: 'doubao',
    pattern: /(bytespider|bytespider-image|doubaobot|doubao|bytedance|toutiao|tiktokspider)/i
  },
  {
    name: 'DeepSeek',
    key: 'deepseek',
    pattern: /(deepseekbot|deepseekcrawler|deepseek-crawler|deepseek)/i
  },
  {
    name: 'Yuanbao / Tencent',
    key: 'tencent',
    pattern: /(tencentcrawl|tencentbot|yuanbaobot|tencentyuanbaobot|qqbrowser)/i
  },
  {
    name: 'Baidu',
    key: 'baidu',
    pattern: /(baiduspider|baidu)/i
  },
  {
    name: 'Google',
    key: 'google',
    pattern: /(googlebot|google-inspectiontool|google-extended)/i
  },
  {
    name: 'Bing',
    key: 'bing',
    pattern: /(bingbot|msnbot)/i
  },
  {
    name: 'OpenAI',
    key: 'openai',
    pattern: /(oai-searchbot|gptbot|chatgpt-user|openai)/i
  },
  {
    name: 'Claude',
    key: 'claude',
    pattern: /(claudebot|claude-searchbot|anthropic)/i
  },
  {
    name: 'Perplexity',
    key: 'perplexity',
    pattern: /(perplexitybot|perplexity-user)/i
  },
  {
    name: 'Qwen / Alibaba',
    key: 'qwen',
    pattern: /(qwenbot|alibababot|alicrawler)/i
  }
];

export function classifyCrawler(userAgent = '') {
  const ua = String(userAgent || '');
  const match = CRAWLER_RULES.find((rule) => rule.pattern.test(ua));
  if (match) {
    return { name: match.name, key: match.key, isKnownCrawler: true };
  }

  const genericBot = /(bot|spider|crawler|crawl|slurp|fetch|preview)/i.test(ua);
  return {
    name: genericBot ? 'Other Bot' : 'Other',
    key: genericBot ? 'other-bot' : 'other',
    isKnownCrawler: genericBot
  };
}

export function hashIp(ip, salt = process.env.CRAWLER_IP_SALT || 'geo-crawler-log') {
  return crypto.createHash('sha256').update(`${salt}:${ip || ''}`).digest('hex').slice(0, 16);
}

function pick(record, keys, fallback = '') {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== '-') {
      return record[key];
    }
  }
  return fallback;
}

function normalizePath(rawUrl) {
  if (!rawUrl) return '/';
  try {
    const parsed = new URL(rawUrl, 'https://www.lxue.xin');
    return parsed.pathname || '/';
  } catch {
    return String(rawUrl).split('?')[0] || '/';
  }
}

export function normalizeEdgeOneLog(record = {}) {
  const userAgent = String(pick(record, ['RequestUA', 'UserAgent', 'userAgent', 'ua']));
  const crawler = classifyCrawler(userAgent);
  const status = Number(pick(record, ['EdgeResponseStatusCode', 'StatusCode', 'status'], 0));
  const rawUrl = pick(record, ['RequestUrl', 'Url', 'url', 'path'], '/');
  const clientIp = pick(record, ['ClientIP', 'ClientIp', 'RemoteAddr', 'ip'], '');

  return {
    time: String(pick(record, ['RequestTime', 'Time', 'timestamp', 'time'], new Date().toISOString())),
    path: normalizePath(rawUrl),
    method: String(pick(record, ['RequestMethod', 'Method', 'method'], 'GET')).toUpperCase(),
    status: Number.isFinite(status) ? status : 0,
    userAgent,
    crawlerName: crawler.name,
    crawlerKey: crawler.key,
    ipHash: hashIp(clientIp),
    region: String(pick(record, ['Country', 'ClientCountry', 'region'], '')),
    referer: String(pick(record, ['RequestReferer', 'Referer', 'referer'], '')),
    requestId: String(pick(record, ['RequestID', 'RequestId', 'requestId'], '')),
    cacheStatus: String(pick(record, ['CacheStatus', 'EdgeCacheStatus', 'cacheStatus'], ''))
  };
}

export function summarizeCrawlerLogs(logs = []) {
  const byCrawler = new Map();
  const byPath = new Map();
  const now = Date.now();
  const windows = { today: 0, sevenDays: 0, thirtyDays: 0 };

  for (const log of logs) {
    const time = Date.parse(log.time);
    const age = Number.isFinite(time) ? now - time : Number.POSITIVE_INFINITY;
    if (age <= 24 * 60 * 60 * 1000) windows.today += 1;
    if (age <= 7 * 24 * 60 * 60 * 1000) windows.sevenDays += 1;
    if (age <= 30 * 24 * 60 * 60 * 1000) windows.thirtyDays += 1;

    byCrawler.set(log.crawlerName, (byCrawler.get(log.crawlerName) || 0) + 1);
    byPath.set(log.path, (byPath.get(log.path) || 0) + 1);
  }

  return {
    windows,
    crawlers: [...byCrawler.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    paths: [...byPath.entries()].map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count).slice(0, 12)
  };
}
