#!/usr/bin/env node
/** Configure the official, OAuth-based Vercel MCP in the installed OpenCode client.
 * This is separate from OMH's inbound /api/mcp gateway. Never handle OAuth secrets here.
 */
import {readFile,writeFile,rename,open} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';

export function vercelMcpUrl(project){
 if(project===undefined)return 'https://mcp.vercel.com';
 if(typeof project!=='string'||!/^[a-z0-9][a-z0-9-]{0,99}\/([a-z0-9][a-z0-9-]{0,99})$/i.test(project))
  throw Error('Invalid --project. Expected <team>/<project> (letters, digits and hyphens).');
 return 'https://mcp.vercel.com/'+project;
}
export function addVercelMcp(config,{project}={}){
 if(!config||typeof config!=='object'||Array.isArray(config))throw Error('Invalid OpenCode config');
 const current=config.mcp;
 if(current!==undefined&&(!current||typeof current!=='object'||Array.isArray(current)))throw Error('Invalid MCP configuration');
 const server={type:'remote',url:vercelMcpUrl(project),enabled:true};
 // The pinned OMH OpenCode 1.19.6 configuration uses a flat mcp map.
 // Do not alter other MCP entries; OAuth uses OpenCode's native login flow.
 return {...config,mcp:{...current,vercel:server}};
}
export async function main(argv=process.argv.slice(2),env=process.env){
 const allowed=new Set(['--dry-run','--check','--project']);
 if(argv.some(arg=>arg.startsWith('--')&&!allowed.has(arg)))throw Error('Unrecognized option');
 const index=argv.indexOf('--project');
 if(index>=0&&(index+1>=argv.length||argv[index+1].startsWith('--')))throw Error('Missing --project value');
 const project=index>=0?argv[index+1]:undefined;
 const dryRun=argv.includes('--dry-run');
 const check=argv.includes('--check');
 if(dryRun&&check)throw Error('Choose one of --dry-run and --check');
 const base=env.XDG_CONFIG_HOME||join(env.HOME||homedir(),'.config');
 const path=join(base,'opencode','opencode.json');
 const previous=JSON.parse(await readFile(path,'utf8'));
 const next=addVercelMcp(previous,{project});
 if(check){
  const existing=previous.mcp?.vercel;
  if(!existing||existing.type!=='remote'||existing.url!==next.mcp.vercel.url||existing.enabled!==true)
   throw Error('Vercel MCP missing/stale in effective OpenCode config');
  process.stdout.write('Official Vercel MCP configured; authenticate using: opencode mcp auth vercel\n');
  return;
 }
 if(dryRun){
  process.stdout.write(JSON.stringify({configPath:path,vercel:next.mcp.vercel},null,2)+'\n');
  return;
 }
 const tmp=path+'.'+randomUUID()+'.tmp';
 try{
  await writeFile(tmp,JSON.stringify(next,null,2)+'\n',{mode:0o600,flag:'wx'});
  await rename(tmp,path);
 }catch(e){
  const {rm}=await import('node:fs/promises');await rm(tmp,{force:true});throw e;
 }
 process.stdout.write('Registered official Vercel MCP in '+path+'\n');
 process.stdout.write('Next: opencode mcp auth vercel && opencode mcp list\n');
}
if(process.argv[1]&&process.argv[1].replace(/\\/g,'/').endsWith('/connect-vercel-mcp.mjs')){
 main().catch(e=>{console.error('OMH Vercel MCP:',e.message);process.exitCode=1;});
}
