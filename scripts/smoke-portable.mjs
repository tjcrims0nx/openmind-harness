#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile,mkdir,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const target=process.argv[2]||process.platform;
const targets={linux:'linux',darwin:'macos',win32:'windows',android:'termux'};
if(!targets[target])throw Error('Unknown platform target');
const work=await mkdtemp(join(tmpdir(),'omh-portable-'));
const out=join(root,'dist','omh-runtime-'+targets[target]);
async function run(command,args,{cwd=work,env={}}={}){
 return await new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd,env:{...process.env,OMH_WORKSPACE:work,OMH_STATE_DIR:join(work,'.omh'),...env},windowsHide:true});
  let stdout='',stderr='';
  child.stdout.on('data',b=>stdout+=b);
  child.stderr.on('data',b=>stderr+=b);
  child.once('error',reject);
  child.once('close',code=>code===0?resolve(stdout):reject(Error(command+' exited '+code+': '+stderr)));
 });
}
try{
 await run(process.execPath,[join(root,'scripts','package-portable.mjs'),target],{cwd:root});
 const script=join(out,'scripts','omh-runtime.mjs');
 const status=JSON.parse(await run(process.execPath,[script,'status']));
 if(status.workspace!==work)throw Error('Workspace not isolated');
 const doctor=JSON.parse(await run(process.execPath,[script,'doctor']));
 if(typeof doctor!=='object'||doctor===null)throw Error('Invalid doctor result');
 const config=JSON.parse(await readFile(join(out,'opencode.json'),'utf8'));
 if(!config.model)throw Error('Missing model');
 // Verify a fresh OpenCode config installation without network access.
 const cfgRoot=join(work,'config');
 const configHome=join(cfgRoot,'opencode');
 await mkdir(configHome,{recursive:true});
 await writeFile(join(configHome,'opencode.json'),JSON.stringify(config));
 const installer=join(root,'scripts','install-omh-runtime.mjs');
 await run(process.execPath,[installer],{env:{XDG_CONFIG_HOME:cfgRoot}});
 await run(process.execPath,[installer,'--check'],{env:{XDG_CONFIG_HOME:cfgRoot}});
 const installed=JSON.parse(await readFile(join(configHome,'opencode.json'),'utf8'));
 if(installed.mcp?.['omh-runtime']?.enabled!==true)throw Error('Installed MCP registration not enabled');
 await access(join(configHome,'omh-runtime','scripts','omh-dashboard.mjs'));
 const installStatus=JSON.parse(await run(process.execPath,[join(configHome,'omh-runtime','scripts','omh-runtime.mjs'),'status']));
 if(installStatus.workspace!==work)throw Error('Installed runtime workspace leaked');

 if(target==='win32'){
  const result=await run('cmd.exe',['/d','/s','/c',join(out,'bin','omh.cmd'),'status']);
  if(!JSON.parse(result).workspace)throw Error('Windows launcher broken');
 } else if(target!=='android'){
  const result=await run('sh',[join(out,'bin','omh'),'status']);
  if(!JSON.parse(result).workspace)throw Error('Unix launcher broken');
 }
 console.log('Clean-workspace portable runtime smoke passed for '+target);
}finally{await rm(work,{recursive:true,force:true});}
