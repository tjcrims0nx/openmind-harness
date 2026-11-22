#!/usr/bin/env node
/** Installs OMH runtime + read-mostly MCP bridge into the local OpenCode config. */
import {cp,mkdir,readFile,writeFile,rename} from 'node:fs/promises';
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
const config=JSON.parse(await readFile(configPath,'utf8'));
if(!config||typeof config!=='object'||Array.isArray(config))throw Error('Invalid OpenCode config');
const command=[process.execPath,join(dest,'scripts','omh-mcp.mjs')];
const merged={...config,mcp:{...(config.mcp||{}),'omh-runtime':{type:'local',command,enabled:true,timeout:10000}}};
if(check){
 const registered=config.mcp?.['omh-runtime'];
 if(!registered||registered.enabled!==true||registered.type!=='local'||
    JSON.stringify(registered.command)!==JSON.stringify(command)){
  throw new Error('OMH MCP registration missing or stale; run node scripts/install-omh-runtime.mjs');
 }
 await readFile(command[1],'utf8');
 process.stdout.write('OMH MCP registration verified: '+command[1]+'\n');
}else if(dryRun){process.stdout.write(JSON.stringify({destination:dest,mcp:merged.mcp['omh-runtime']},null,2)+'\n');}
else{
 await mkdir(join(dest,'scripts'),{recursive:true});
 await cp(join(source,'modules'),join(dest,'modules'),{recursive:true,force:true});
 await cp(join(source,'dashboard'),join(dest,'dashboard'),{recursive:true,force:true});
 for(const name of ['omh-mcp.mjs','omh-runtime.mjs','omh-daemon.mjs','omh-dashboard.mjs'])await cp(join(source,'scripts',name),join(dest,'scripts',name),{force:true});
 const tmp=configPath+'.'+randomUUID()+'.tmp';
 await writeFile(tmp,JSON.stringify(merged,null,2)+'\n',{mode:0o600});
 await rename(tmp,configPath);
 process.stdout.write('OMH runtime installed with read-mostly MCP tools at '+dest+'\n');
 process.stdout.write('CLI: node '+join(dest,'scripts','omh-runtime.mjs')+' status\n');
 process.stdout.write('Dashboard: node '+join(dest,'scripts','omh-dashboard.mjs')+'\n');
}
