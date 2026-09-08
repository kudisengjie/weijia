import { HttpError, cookieToken, digest, equal, passwordMatches, requireConfig, sessionCookie, token } from './security.mjs';
import { isIP } from 'node:net';

export async function login(request, body, store, env, clientIp) {
  requireConfig(env);
  if (!isIP(clientIp || '')) throw new HttpError(503, '服务端缺少可信客户端地址，请管理员检查函数配置。', 'CLIENT_IP_REQUIRED');
  // Reserve attempt slots with conditional writes. Parallel requests cannot bypass the limit.
  const window = Math.floor(Date.now() / 900000);
  let allowed = false, reserved = '';
  for (let slot = 0; slot < 5; slot++) {
    reserved = `login-attempts/${digest(clientIp)}/${window}/${slot}`;
    if (await store.create(reserved, { at: Date.now() })) { allowed = true; break; }
  }
  if (!allowed) throw new HttpError(429, '登录尝试过多，请 15 分钟后再试。', 'RATE_LIMITED');
  const matches = await passwordMatches(body.password, env.GEO_PASSWORD_HASH);
  if (!matches || !equal(body.account || '', env.GEO_ACCOUNT)) throw new HttpError(401, '账号或密码不正确。', 'LOGIN_FAILED');
  await store.delete(reserved);
  const raw = token(), id = digest(raw), csrf = token();
  await store.set(`sessions/${id}`, { id, csrf: digest(csrf), csrfToken: csrf, expiresAt: Date.now() + 604800000 });
  return { data: { authenticated: true, csrf }, cookie: sessionCookie(raw, env) };
}
export async function authenticate(request, store, env) {
  requireConfig(env);
  const raw = cookieToken(request);
  const session = raw ? await store.get(`sessions/${digest(raw)}`) : null;
  if (!session || session.expiresAt < Date.now()) throw new HttpError(401, '请先登录。', 'LOGIN_REQUIRED');
  if (!['GET', 'HEAD'].includes(request.method) && !equal(digest(request.headers.get('x-csrf-token') || ''), session.csrf)) throw new HttpError(403, '会话校验失败，请重新登录。', 'CSRF_REJECTED');
  return session;
}
export async function requireAdmin(body, env) {
  if (!env.IMA_ADMIN_SECRET || env.IMA_ADMIN_SECRET.length < 24) throw new HttpError(503, '管理员更新口令尚未配置。', 'ADMIN_SETUP_REQUIRED');
  if (!equal(body.adminSecret || '', env.IMA_ADMIN_SECRET)) throw new HttpError(403, '管理员更新口令不正确。', 'ADMIN_REQUIRED');
}
