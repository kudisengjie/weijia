import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scrypt as rawScrypt } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt=promisify(rawScrypt);
async function passwordHash(password){const salt=randomBytes(16).toString('hex');const hash=await scrypt(password,salt,64);return `scrypt:${salt}:${hash.toString('hex')}`;}

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.join(root,'.local'),target=path.join(dir,'edgeone-secrets.json');
if(fs.existsSync(target))throw new Error('Local configuration already exists; refusing to overwrite encryption keys.');
if(!process.argv.includes('--password-stdin'))throw new Error('Pass --password-stdin and supply the initial password via standard input. No plaintext password is saved.');
let password='';for await(const chunk of process.stdin)password+=chunk.toString();password=password.trim();
if(password.length<6)throw new Error('Password must contain at least six characters.');
const account=String(process.env.GEO_ACCOUNT||'').trim();if(!account)throw new Error('Set GEO_ACCOUNT before running setup.');
const env={APP_ORIGIN:'https://geo.lxue.xin',GEO_ACCOUNT:account,GEO_PASSWORD_HASH:await passwordHash(password),GEO_MASTER_KEY:randomBytes(32).toString('hex'),IMA_ADMIN_SECRET:randomBytes(32).toString('base64url'),IMA_OPENAPI_CLIENTID:process.env.IMA_OPENAPI_CLIENTID||'',IMA_OPENAPI_APIKEY:process.env.IMA_OPENAPI_APIKEY||'',DATABASE_URL:process.env.DATABASE_URL||''};
password='';fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(target,JSON.stringify(env,null,2),{encoding:'utf8',mode:0o600,flag:'wx'});
console.log('Private deployment configuration created at .local/edgeone-secrets.json. Values were not printed. Never upload this file to GitHub.');
