import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const run=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
console.log('Current GEO workspace: '+root);
console.log('Branch: '+run('branch','--show-current'));
console.log('Latest saved commit: '+run('log','-1','--format=%h %s'));
console.log('Saved HEAD vs last-known origin/master (local-only / remote-only): '+run('rev-list','--left-right','--count','HEAD...origin/master'));
console.log('This is the last recorded Git state, not a claim of a live EdgeOne deployment.');
console.log('Uncommitted changes:\n'+(run('status','--short')||'(none)'));
console.log('\n'+fs.readFileSync(path.join(root,'docs/superpowers/checkpoints/ACTIVE-GEO-PROGRESS.md'),'utf8'));
