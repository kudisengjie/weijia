import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.GEO_DEV_PORT||8088),origin=`http://127.0.0.1:${port}`;
const local=JSON.parse(await fs.readFile(path.join(root,'.local/edgeone-secrets.json'),'utf8'));
const env={...local,DATABASE_URL:process.env.DATABASE_URL||local.DATABASE_URL||'',APP_ORIGIN:origin,GEO_LOCAL_DEV:'1'};
if(!env.DATABASE_URL)throw new Error('DATABASE_URL is missing from .local/edgeone-secrets.json or the process environment.');
const command=process.platform==='win32'?'npx.cmd':'npx';
const child=spawn(command,['--yes','edgeone','pages','dev'],{cwd:root,env:{...process.env,...env},stdio:'inherit',windowsHide:true});
child.on('exit',code=>process.exitCode=code??1);
