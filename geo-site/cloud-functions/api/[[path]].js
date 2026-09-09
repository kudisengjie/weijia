import { getStore } from '@edgeone/pages-blob';
import { createHandler } from '../../server/router.mjs';
import { JsonStore } from '../../server/storage.mjs';

export default async function onRequest({ request, env, clientIp }) {
  let store;
  try {
    store = new JsonStore(getStore({ name: 'lxue-geo-private', consistency: 'strong' }));
  } catch (error) {
    console.error('blob_init_failed', { name: error?.name, code: error?.code });
    return new Response(JSON.stringify({ error: '私有存储初始化失败，请管理员查看此次部署的 Cloud Functions 日志。', code: 'STORAGE_UNAVAILABLE' }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  return createHandler({ store, env: { ...process.env, ...env } })(request, { clientIp });
}
