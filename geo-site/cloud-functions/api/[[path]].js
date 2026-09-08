import { createHandler } from '../../server/router.mjs';
import { makeProductionStore } from '../../server/storage.mjs';

export default async function onRequest({ request, env, clientIp }) {
  try {
    return await createHandler({ store: await makeProductionStore(), env: { ...process.env, ...env } })(request,{clientIp});
  } catch {
    return new Response(JSON.stringify({ error: '私有存储尚未就绪，请管理员启用 EdgeOne Blob 并重新部署。', code: 'STORAGE_UNAVAILABLE' }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
}
