import { createHash } from 'node:crypto';
import { copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync } from 'node:fs';
import { dirname,resolve,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),pkg=resolve(root,'packages/wrf-ui');
const stageOnly=process.argv.includes('--stage-only');
if(stageOnly&&process.argv.includes('--update-lock'))throw new Error('Staging must not update the installed release lock');
const manifest=JSON.parse(readFileSync(resolve(pkg,'package.json'),'utf8'));
const npmVersion=execFileSync('npm',['--version'],{encoding:'utf8'}).trim();
if(process.version!=='v24.14.1'||npmVersion!=='11.11.0')throw new Error('WRF UI reproducible build requires Node 24.14.1 / npm 11.11.0');
const output=resolve(root,'.artifacts/wrf-ui',manifest.version);mkdirSync(output,{recursive:true});
const staging=resolve(output,'package');mkdirSync(staging,{recursive:true});
function files(path){return readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(resolve(path,e.name)):[resolve(path,e.name)]);}
const sources=[...files(resolve(pkg,'src')),resolve(pkg,'package.json'),resolve(pkg,'package-lock.json'),resolve(pkg,'vite.config.js')].sort();
const hash=createHash('sha256');for(const p of sources){hash.update(relative(pkg,p));hash.update('\0');hash.update(readFileSync(p));hash.update('\0');}
const sourceSha=hash.digest('hex');
execFileSync('npm',['run','build'],{cwd:pkg,stdio:'inherit',env:{...process.env,WRF_UI_SOURCE_SHA:sourceSha,WRF_UI_BUILD_OUT:resolve(staging,'dist')}});
for(const name of ['package.json','README.md'])copyFileSync(resolve(pkg,name),resolve(staging,name));
const packed=JSON.parse(execFileSync('npm',['pack','--json','--ignore-scripts','--cache',process.env.WRF_UI_NPM_CACHE||resolve(output,'npm-cache'),'--pack-destination',output],{cwd:staging,encoding:'utf8'}))[0];
const artifact=stageOnly?resolve(output,packed.filename):resolve(root,'vendor/wrf-ui',packed.filename);
const release={name:manifest.name,version:manifest.version,interface_version:'wrf-ui-2',source_sha256:sourceSha,bundle_sha256:createHash('sha256').update(readFileSync(resolve(staging,'dist/wrf-ui.js'))).digest('hex'),artifact:relative(root,artifact),integrity:packed.integrity,node:process.version,npm:npmVersion};
if(stageOnly)release.stage_only=true;
const lockPath=resolve(root,'wrf-ui.lock.json');
if(stageOnly)console.log('Staged artifact only; installed release lock remains unchanged');
else if(process.argv.includes('--update-lock'))writeFileSync(lockPath,JSON.stringify(release,null,2)+'\n');
else if(!existsSync(lockPath)||JSON.parse(readFileSync(lockPath,'utf8')).source_sha256!==release.source_sha256||JSON.parse(readFileSync(lockPath,'utf8')).integrity!==release.integrity)throw new Error('WRF UI source or tarball differs from wrf-ui.lock.json; release explicitly with --update-lock');
if(!stageOnly){mkdirSync(dirname(artifact),{recursive:true});copyFileSync(resolve(output,packed.filename),artifact);}
writeFileSync(resolve(output,'manifest.json'),JSON.stringify(release,null,2)+'\n');console.log(JSON.stringify(release));
