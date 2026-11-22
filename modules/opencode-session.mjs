/** An authenticated loopback OpenCode instance owned by one OMH task. */
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

export async function startOpenCode(workspace, signal) {
 signal?.throwIfAborted();
 const username='omh';
 const password=randomBytes(32).toString('hex');
 const auth='Basic '+Buffer.from(username+':'+password).toString('base64');
 const env={...process.env,OPENCODE_SERVER_USERNAME:username,OPENCODE_SERVER_PASSWORD:password};
 const child=spawn('opencode',['serve','--hostname','127.0.0.1','--port','0','--no-mdns'],{
  cwd:workspace,env,stdio:['ignore','pipe','ignore'],
 });
 let startupResolve,startupReject;
 const ready=new Promise((resolve,reject)=>{startupResolve=resolve;startupReject=reject;});
 const closed=new Promise(resolve=>child.once('close',resolve));
 child.once('error',startupReject);
 child.once('close',()=>startupReject(new Error('OpenCode server stopped before it was ready')));
 let output='';
 const onData=chunk=>{
  output+=chunk.toString();
  const match=output.match(/^opencode server listening on http:\/\/127\.0\.0\.1:(\d+)\r?$/m);
  if(match&&Number(match[1])>0&&Number(match[1])<=65535){
   child.stdout.off('data',onData);
   startupResolve('http://127.0.0.1:'+match[1]);
  }else if(output.length>16384){
   startupReject(new Error('Invalid OpenCode server startup output'));
  }
 };
 child.stdout.on('data',onData);
 const timeout=setTimeout(()=>startupReject(new Error('OpenCode server startup timed out')),15000);
 const onAbort=()=>startupReject(signal.reason);
 signal?.addEventListener('abort',onAbort,{once:true});
 async function close(){
  child.kill('SIGTERM');
  const escalation=setTimeout(()=>child.kill('SIGKILL'),750);
  try{await closed;}finally{clearTimeout(escalation);}
 }
 try{
  const url=await ready;
  const request=async (path,{method='GET',body,timeoutMs=5000}={})=>{
   const response=await fetch(url+path,{
    method,body,redirect:'error',signal:AbortSignal.timeout(timeoutMs),
    headers:{Authorization:auth,'Content-Type':'application/json','x-opencode-directory':encodeURIComponent(workspace)},
   });
   if(!response.ok)throw new Error(`OpenCode session API returned HTTP ${response.status}`);
   const chunks=[];
   let bytes=0;
   for await(const chunk of response.body){
    bytes+=chunk.byteLength;
    if(bytes>1048576)throw new Error('OpenCode session response exceeded its output limit');
    chunks.push(chunk);
   }
   return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
  return {url,env,request,close};
 }catch(error){
  await close();
  throw error;
 }finally{
  clearTimeout(timeout);
  signal?.removeEventListener('abort',onAbort);
 }
}

export async function abortOpenCodeSession(server, id, exited) {
 // The attached CLI can still be setting up its request. Wait for the session
 // to become active before asking OpenCode to abort it.
 const deadline=Date.now()+5000;
 while(!exited()&&Date.now()<deadline){
  const status=await server.request('/session/status',{timeoutMs:1000});
  if(status[id]&&status[id].type!=='idle'){
   if(await server.request(`/session/${id}/abort`,{method:'POST',timeoutMs:10000})!==true){
    throw new Error('OpenCode did not acknowledge the session abort');
   }
   const remaining=await server.request('/session/status');
   if(remaining[id]&&remaining[id].type!=='idle'){
    throw new Error('OpenCode session stayed active after its abort');
   }
   return true;
  }
  await delay(100);
 }
 if(exited())return false;
 throw new Error('OpenCode cancellation could not be confirmed');
}
