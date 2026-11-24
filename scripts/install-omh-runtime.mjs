#!/usr/bin/env node
/** Installs OMH runtime + read-mostly MCP bridge into the local OpenCode config. */
import {cp,mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const source=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const configHome=join(process.env.XDG_CONFIG_HOME||join(homedir(),'.config'),'opencode');
const dest=join(configHome,'omh-runtime');
const configPath=join(configHome,'opencode.json');
const dryRun=process.argv.includes('--dry-run');
const check=process.argv.includes('--check');
if(!Number(process.versions.node.split('.')[0])||Number(process.versions.node.split('.')[0])<22)throw Error('Node.js 22+ required for OMH runtime');
let config;
try {
 config=JSON.parse(await readFile(configPath,'utf8'));
} catch (error) {
 if (error?.code==='ENOENT') {
  if (check) {
   process.stderr.write('OpenCode is not configured: '+configPath+' is missing. Run the platform setup before --check.\n');
   process.exit(1);
  }
  if (dryRun) {
   // A dry run may preview the proposed MCP entry without creating config.
   process.stderr.write('OpenCode config not found; showing the proposed registration only (no files written).\n');
   config={};
  } else {
   process.stderr.write('OpenCode config not found at '+configPath+'. Install and configure OpenCode first.\n');
   process.exit(1);
  }
 } else if (error instanceof SyntaxError) {
  process.stderr.write('OpenCode config is not valid JSON: '+configPath+'\n');
  process.exit(1);
 } else throw error;
}
if(!config||typeof config!=='object'||Array.isArray(config)) {
 process.stderr.write('OpenCode config must contain a JSON object: '+configPath+'\n');
 process.exit(1);
}
const command=[process.execPath,join(dest,'scripts','omh-mcp.mjs')];
const merged={...config,mcp:{...(config.mcp||{}),'omh-runtime':{type:'local',command,enabled:true,timeout:10000}}};
// Explicit operator opt-in; OpenCode owns the stdio server lifecycle.
const enableEvidence=process.argv.includes('--enable-omjb-evidence');
const disableEvidence=process.argv.includes('--disable-omjb-evidence');
if(enableEvidence&&disableEvidence)throw Error('Choose only one evidence plugin action');
if(check&&(enableEvidence||disableEvidence))throw Error('Check mode cannot change plugin preferences');
const evidenceCommand=[process.execPath,join(dest,'plugins','omjb-mcp','server.mjs')];
if(enableEvidence||disableEvidence){
 const existing=config.mcp?.['omjb-evidence'];
 if(existing&&(!Array.isArray(existing.command)||existing.command[1]!==evidenceCommand[1]||existing.type!=='local'))
  throw Error('Existing omjb-evidence registration is not installer-managed; review it manually');
 if(enableEvidence){
  const db=process.env.OMJB_DB_PATH;
  if(!db||!await import('node:fs/promises').then(async fs=>{try{return (await fs.stat(db)).isFile()}catch{return false}}))
   throw Error('Set OMJB_DB_PATH to an existing evidence database before enabling');
  merged.mcp['omjb-evidence']={type:'local',command:evidenceCommand,enabled:true,timeout:10000,environment:{OMJB_DB_PATH:resolve(db)}};
 }else if(existing)merged.mcp['omjb-evidence']={...existing,enabled:false};
}
if(check){
 const registered=config.mcp?.['omh-runtime'];
 if(!registered||registered.enabled!==true||registered.type!=='local'||
    JSON.stringify(registered.command)!==JSON.stringify(command)){
  throw new Error('OMH MCP registration missing or stale; run node scripts/install-omh-runtime.mjs');
 }
 await readFile(command[1],'utf8');
 process.stdout.write('OMH MCP registration verified: '+command[1]+'\n');
}else if(dryRun){process.stdout.write(JSON.stringify({destination:dest,mcp:merged.mcp['omh-runtime'],omjbEvidence:merged.mcp['omjb-evidence']?{enabled:merged.mcp['omjb-evidence'].enabled===true}:undefined},null,2)+'\n');}
else{
 await mkdir(join(dest,'scripts'),{recursive:true});
 // The dashboard imports shared chat adapters from ../lib at runtime.
 await cp(join(source,'lib'),join(dest,'lib'),{recursive:true,force:true});
 await cp(join(source,'modules'),join(dest,'modules'),{recursive:true,force:true});
 await cp(join(source,'dashboard'),join(dest,'dashboard'),{recursive:true,force:true});
 // Ship the built OpenUI so the dashboard serves it as the primary
 // interface. If the frontend has not been built yet the dashboard falls
 // back to the classic interface; build it with `npm run build` in
 // frontend-next and re-run this installer to pick it up.
 if (existsSync(join(source,'frontend-next','dist','index.html'))) {
   await cp(join(source,'frontend-next','dist'),join(dest,'frontend-next','dist'),{recursive:true,force:true});
 } else {
   process.stderr.write('OpenUI frontend not built; dashboard will use the classic interface. Build it with `npm run build` in frontend-next and re-run this installer.\n');
 }
 await mkdir(join(dest,'plugins'),{recursive:true});
 await cp(join(source,'plugins','omjb-mcp'),join(dest,'plugins','omjb-mcp'),{recursive:true,force:true});
 for(const name of ['omh-mcp.mjs','omh-runtime.mjs','omh-daemon.mjs','omh-dashboard.mjs','omh-live.mjs'])await cp(join(source,'scripts',name),join(dest,'scripts',name),{force:true});
 const tmp=configPath+'.'+randomUUID()+'.tmp';
 await writeFile(tmp,JSON.stringify(merged,null,2)+'\n',{mode:0o600});
 await rename(tmp,configPath);
 process.stdout.write('OMH runtime installed with read-mostly MCP tools at '+dest+'\n');
 process.stdout.write('CLI: node '+join(dest,'scripts','omh-runtime.mjs')+' status\n');
 process.stdout.write('Dashboard: node '+join(dest,'scripts','omh-dashboard.mjs')+'\n');
 process.stdout.write('Live connector: OMH_LIVE_TOKEN=<secret> node '+join(dest,'scripts','omh-live.mjs')+'\n');
}
