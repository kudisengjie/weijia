import { HttpError, checkOrigin, readJson, sessionCookie } from './security.mjs';
import { login, authenticate } from './auth.mjs';
import { loadSettings, saveModel, publicSettings, ownerPrefix } from './credentials.mjs';
import { complete } from './providers.mjs';
import { updateIma } from './ima.mjs';
import { withLock } from './storage.mjs';
import { createBatch, getBatch, listBatches, advanceBatch, batchPublic } from './batches.mjs';

export function createHandler({store,env,fetcher=fetch}) {
  const response=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});
  return async (request,context={})=>{
    let path='unknown';
    try {
      checkOrigin(request,env);
      path=new URL(request.url).pathname.replace(/^\/api\//,'').replace(/\/$/,'');
      const post=request.method==='POST';
      if(!post&&request.method!=='GET')throw new HttpError(405,'请求方法不支持。');
      if(path==='auth/login'&&post){const result=await login(request,await readJson(request,4096),store,env,context.clientIp);return response(result.data,200,{'Set-Cookie':result.cookie});}
      const session=await authenticate(request,store,env);
      // Authenticate before consuming a potentially large document body.
      const body=post?await readJson(request,path==='batches'?4*1024*1024:32768):{};
      if(path==='auth/session'&&!post)return response({authenticated:true,csrf:session.csrfToken,expiresAt:session.expiresAt});
      if(path==='auth/logout'&&post){await store.delete(`sessions/${session.id}`);return response({loggedOut:true},200,{'Set-Cookie':sessionCookie('',env,0)});}
      if(path==='settings'&&!post)return response(await publicSettings(store,env,session));
      if(path==='settings/model'&&post)return response(await saveModel(body,store,env,session));
      if(path==='models/test'&&post)return response(await withLock(store,`${ownerPrefix(session)}/model-test-lock`,async()=>{
        const settings=await loadSettings(store,env,session);
        await complete(settings.model,settings.keys[settings.model.id],[{role:'user',content:'Reply only: OK'}],{fetcher,test:true});
        return {ok:true,model:settings.model.label};
      }));
      if(path==='ima/update'&&post)return response(await updateIma(body,store,env,fetcher));
      if(path==='batches')return response(post?await createBatch(body,store,env,session):{batches:await listBatches(store,session)});
      const match=path.match(/^batches\/([a-f0-9]{32})(\/step)?$/);
      if(match){if(match[2]&&post)return response(await advanceBatch(match[1],body,store,env,session,fetcher));if(!match[2]&&!post)return response(batchPublic(await getBatch(store,env,session,match[1])));}
      throw new HttpError(404,'接口不存在。');
    } catch(error) {
      if (!(error instanceof HttpError)) console.error('api_request_failed', {
        requestId: context.requestId,
        path,
        method: request.method,
        name: error?.name,
        code: error?.code,
        operation: error?.storageOperation,
      });
      return response({error:error instanceof HttpError?error.message:'服务暂不可用，请检查 EdgeOne 服务端配置。',code:error instanceof HttpError?error.code:'SERVER_ERROR'},error instanceof HttpError?error.status:503);
    }
  };
}
