import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const run=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
const {describeGitSync}=await import('./progress-state.mjs');
const refreshRequested=process.argv.includes('--refresh');
let referenceMode='本地缓存；如需核对 GitHub，使用 --refresh 一次';
let comparisonTarget='本地缓存 origin/master';
if(refreshRequested){
  try{
    run('fetch','--quiet','origin','master');
    referenceMode='已实时刷新 GitHub master';
    comparisonTarget='GitHub master';
  }catch{
    referenceMode='GitHub 刷新失败，以下只显示本地缓存';
  }
}
const [ahead,behind]=run('rev-list','--left-right','--count','HEAD...origin/master').split(/\s+/).map(Number);
console.log('Current GEO workspace: '+root);
console.log('Branch: '+run('branch','--show-current'));
console.log('Local saved HEAD: '+run('log','-1','--format=%H %s'));
console.log('GitHub reference: '+run('rev-parse','origin/master')+' ('+referenceMode+')');
console.log('Git push state: '+describeGitSync(ahead,behind,comparisonTarget));
console.log('Local master branch: '+run('rev-parse','master'));
console.log('Working tree:\n'+(run('status','--short')||'(clean)'));
console.log('EdgeOne production: Git cannot determine deployment state; verify the commit shown in the EdgeOne deployment record.');
console.log('\n'+fs.readFileSync(path.join(root,'docs/superpowers/checkpoints/ACTIVE-GEO-PROGRESS.md'),'utf8'));
