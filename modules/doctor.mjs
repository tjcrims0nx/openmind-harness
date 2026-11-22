/** OMH capability diagnostics. No credentials or user files are inspected. */
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runSandbox} from './sandbox.mjs';

function commandProbe(command,args,{spawn=spawnSync}={}) {
 try {
  const result=spawn(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:5000,maxBuffer:8192});
  return {available:result.status===0,version:result.status===0 ? String(result.stdout||'').trim().slice(0,120) : null};
 } catch {return {available:false,version:null};}
}
export async function diagnose({platform=process.platform,nodeVersion=process.versions.node,spawn=spawnSync,sandboxRun=runSandbox}={}) {
 const nodeMajor=Number(String(nodeVersion).split('.')[0]);
 const node={supported:Number.isInteger(nodeMajor)&&nodeMajor>=22,version:String(nodeVersion)};
 const opencode=commandProbe('opencode',['--version'],{spawn});
 const bubblewrap=platform==='linux'?commandProbe('bwrap',['--version'],{spawn}):{available:false,version:null};
 let isolation={supported:false,verified:false,reason:platform==='linux'?'bubblewrap not installed':'Linux-only backend'};
 if(platform==='linux'&&bubblewrap.available) {
  const tmp=await mkdtemp(join(tmpdir(),'omh-doctor-'));
  try {
   const result=await sandboxRun({workspace:tmp,command:'sh',args:['-c','test -d /workspace && test ! -e /etc/passwd && test ! -e /etc/shadow'],timeoutMs:5000});
   isolation={supported:true,verified:result.exitCode===0&&!result.timedOut&&!result.outputTruncated,reason:result.exitCode===0?'mount namespace smoke probe passed':'sandbox execution probe failed'};
  } catch {isolation={supported:true,verified:false,reason:'sandbox execution probe failed'};}
  finally {await rm(tmp,{recursive:true,force:true});}
 }
 return {
  schema:'omh.doctor.v1',
  node,
  opencode,
  sandbox:{platform,engine:'bubblewrap',installed:bubblewrap.available,...isolation},
  warnings:[
   ...(!node.supported?['Node.js 22 or newer is required']:[]),
   ...(!opencode.available?['OpenCode CLI is not accessible in PATH']:[]),
   ...(!isolation.verified?['OS execution isolation is not verified; sandbox tasks must fail closed']:[]),
   'MCP model connection and provider authentication require separate live verification'
  ]
 };
}
