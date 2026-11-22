/** Linux Bubblewrap sandbox. Fail closed when isolation cannot be enforced. */
import {spawn,spawnSync} from 'node:child_process';
import {realpath,mkdir} from 'node:fs/promises';
import {resolve,isAbsolute} from 'node:path';
const COMMANDS=new Set(['node','python3','git','sh']);
export function sandboxArgs({workspace,command,args=[],network=false}={}) {
  if(!isAbsolute(workspace||''))throw new TypeError('Workspace must be absolute');
  if(!COMMANDS.has(command)||!Array.isArray(args)||args.some(a=>typeof a!=='string'||a.includes('\0')))throw new TypeError('Command or args not allowed');
  if(network)throw new Error('Networked sandbox execution is not supported');
  return ['--die-with-parent','--new-session','--unshare-all','--share-net','--ro-bind','/usr','/usr','--ro-bind-try','/bin','/bin','--ro-bind-try','/lib','/lib','--ro-bind-try','/lib64','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--bind',workspace,'/workspace','--chdir','/workspace','--setenv','HOME','/tmp','--setenv','PATH','/usr/bin:/bin','--',command,...args];
}
// Use bwrap's --unshare-net instead of --share-net: network remains isolated.
// The explicit --share-net placeholder above is replaced here for older bwrap compatibility.
export function isolatedArgs(opts){const a=sandboxArgs(opts);a[a.indexOf('--share-net')]='--unshare-net';return a;}
export function sandboxAvailable(){return process.platform==='linux'&&spawnSync('bwrap',['--version'],{stdio:'ignore'}).status===0;}
export async function runSandbox({workspace,command,args=[],timeoutMs=30000,maxOutputBytes=65536}={}) {
  if(!sandboxAvailable())throw new Error('Sandbox unavailable: Linux and bubblewrap required; refusing unsandboxed execution');
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>300000||!Number.isInteger(maxOutputBytes)||maxOutputBytes<1||maxOutputBytes>1048576)throw new RangeError('Invalid sandbox limits');
  await mkdir(workspace,{recursive:true});const path=await realpath(workspace);const argv=isolatedArgs({workspace:path,command,args});
  return new Promise((ok,fail)=>{
    const child=spawn('bwrap',argv,{stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin'},detached:false});
    let stdout='',stderr='',bytes=0,settled=false,timedOut=false,overflow=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL')},timeoutMs);
    const onData=(type)=>buf=>{bytes+=buf.length;if(bytes>maxOutputBytes){overflow=true;child.kill('SIGKILL');return;}if(type==='out')stdout+=buf.toString();else stderr+=buf.toString();};
    child.stdout.on('data',onData('out'));child.stderr.on('data',onData('err'));
    child.on('error',e=>{clearTimeout(timer);if(!settled){settled=true;fail(e)}});
    child.on('close',(code,signal)=>{clearTimeout(timer);if(!settled){settled=true;ok({exitCode:code,signal,stdout,stderr,timedOut,outputTruncated:overflow});}});
  });
}
