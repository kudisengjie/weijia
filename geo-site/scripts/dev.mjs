import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../server/security.mjs';
import { createHandler } from '../server/router.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.GEO_DEV_PORT||8787),origin=`http://127.0.0.1:${port}`;
const local=JSON.parse(await fs.readFile(path.join(root,'.local/edgeone-secrets.json'),'utf8'));
const env={...local,APP_ORIGIN:origin,GEO_LOCAL_DEV:'1'};
const dir=path.join(root,'.local/store');await fs.mkdir(dir,{recursive:true});
class DiskStore {
  filename(key){return path.join(dir,digest(key)+'.json');}
  async get(key){try{return JSON.parse(await fs.readFile(this.filename(key),'utf8')).value;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
  async set(key,value){const target=this.filename(key),temp=target+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify({key,value}),{mode:0o600});await fs.rename(temp,target);}
  async create(key,value){try{await fs.writeFile(this.filename(key),JSON.stringify({key,value}),{flag:'wx',mode:0o600});return true;}catch(e){if(e.code==='EEXIST')return false;throw e;}}
  async delete(key){await fs.rm(this.filename(key),{force:true});}
  async list(prefix){const values=await Promise.all((await fs.readdir(dir)).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await fs.readFile(path.join(dir,f),'utf8'))));return values.filter(v=>v.key.startsWith(prefix)).map(v=>v.key).slice(0,500);}
}
const handler=createHandler({store:new DiskStore(),env});
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.png':'image/png','.ico':'image/x-icon'};
const policy=JSON.parse(await fs.readFile(path.join(root,'edgeone.json'),'utf8')).headers[0].headers;
http.createServer(async(req,res)=>{
  try {
    const pathname=new URL(req.url,origin).pathname;
    if(pathname.startsWith('/api/')){
      const chunks=[];let bytes=0;for await(const c of req){bytes+=c.length;if(bytes>4*1024*1024){res.writeHead(413);res.end('{}');return;}chunks.push(c);}
      const result=await handler(new Request(origin+req.url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),{clientIp:req.socket.remoteAddress});res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
    }
    const file=pathname==='/'?'index.html':decodeURIComponent(pathname).slice(1);
    if(!/^(index\.html|styles\.css|favicon\.ico|assets\/[a-zA-Z0-9_./-]+)$/.test(file)||file.split('/').includes('..')){res.writeHead(404);res.end();return;}
    const data=await fs.readFile(path.join(root,'dist',file));res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store',...Object.fromEntries(policy.map(h=>[h.key,h.value]))});res.end(data);
  }catch{res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'Local server not ready. Run npm run build and check private configuration.'}));}
}).listen(port,'127.0.0.1',()=>console.log(`Zero Snow GEO local preview: ${origin}. Credentials are not logged.`));
