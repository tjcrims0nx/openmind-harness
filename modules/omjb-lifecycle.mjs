/**
 * Evidence MCP lifecycle: auto-start the installer-registered read-only
 * OMJB evidence server when OMH launches, watch its health, restart it
 * with bounded retries, and stop it cleanly with OMH.
 *
 * The client only ever spawns the registration the installer wrote into
 * the OpenCode config, and only when that registration is installer-managed
 * (a local server at plugins/omjb-mcp/server.mjs). It never enables
 * execution tools or provider calls: the server it starts exposes exactly
 * the five read-only evidence tools, and the client refuses to use a
 * server that offers anything else.
 */
import {spawn,execFile} from 'node:child_process';
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';

export const EVIDENCE_TOOLS=['omjb_status','omjb_list_runs','omjb_run_summary','omjb_pending_reviews','omjb_compare_runs'];
export const EVIDENCE_NAME='OpenMind Jailbreak Lab';

export function evidenceConfigPath(){
 return join(process.env.XDG_CONFIG_HOME||join(homedir(),'.config'),'opencode','opencode.json');
}

function isManaged(entry){
 return entry&&entry.type==='local'&&Array.isArray(entry.command)&&entry.command.length===2&&
  typeof entry.command[1]==='string'&&entry.command[1].endsWith(join('plugins','omjb-mcp','server.mjs'));
}

export async function readEvidenceRegistration(configPath=evidenceConfigPath()){
 let config;
 try{config=JSON.parse(await readFile(configPath,'utf8'));}
 catch(error){if(error?.code==='ENOENT')return {entry:null,configPath,managed:false};throw error;}
 const entry=config?.mcp?.['omjb-evidence']??null;
 return {entry,configPath,managed:isManaged(entry)};
}

export async function setEvidenceEnabled(enabled,configPath=evidenceConfigPath()){
 const {entry,managed}=await readEvidenceRegistration(configPath);
 if(!entry)throw Error('No omjb-evidence registration; enable it with the installer first');
 if(!managed)throw Error('Existing omjb-evidence registration is not installer-managed; review it manually');
 const config=JSON.parse(await readFile(configPath,'utf8'));
 config.mcp['omjb-evidence']={...entry,enabled:enabled===true};
 const tmp=configPath+'.'+randomUUID()+'.tmp';
 await writeFile(tmp,JSON.stringify(config,null,2)+'\n',{mode:0o600});
 await rename(tmp,configPath);
 return config.mcp['omjb-evidence'];
}

export function disabledEvidenceStatus(){
 return {name:EVIDENCE_NAME,enabled:false,connected:false,state:'disabled',restarts:0,lastError:null,lastPingAt:null,tools:[...EVIDENCE_TOOLS],dbPath:null,pid:null};
}

export class EvidenceMcpClient{
 constructor({configPath=evidenceConfigPath(),pidFile,maxRestarts=5,baseDelayMs=1000,maxDelayMs=16000,pingIntervalMs=30000,rpcTimeoutMs=5000,logger=console}={}){
  this.configPath=configPath;
  this.pidFile=pidFile??join(dirname(configPath),'omh-evidence-mcp.pid');
  this.maxRestarts=maxRestarts;
  this.baseDelayMs=baseDelayMs;
  this.maxDelayMs=maxDelayMs;
  this.pingIntervalMs=pingIntervalMs;
  this.rpcTimeoutMs=rpcTimeoutMs;
  this.logger=logger;
  this.child=null;
  this.nextId=1;
  this.pending=new Map();
  this.buffer='';
  this.state='disabled';
  this.enabled=false;
  this.connected=false;
  this.starting=false;
  this.restarts=0;
  this.failures=0;
  this.lastError=null;
  this.lastPingAt=null;
  this.tools=[...EVIDENCE_TOOLS];
  this.dbPath=null;
  this.pid=null;
  this.stopping=false;
  this.restartTimer=null;
  this.pingTimer=null;
  this.entry=null;
 }
 status(){
  return {name:EVIDENCE_NAME,enabled:this.enabled,connected:this.connected,state:this.state,
   restarts:this.restarts,lastError:this.lastError,lastPingAt:this.lastPingAt,
   tools:[...this.tools],dbPath:this.dbPath,pid:this.pid};
 }
 async start(){
  if(this.starting||this.state==='connected')return this.status();
  this.starting=true;
  try{
   this.stopping=false;
   const {entry,managed}=await readEvidenceRegistration(this.configPath);
   this.entry=entry;
   if(!entry||entry.enabled!==true){this.enabled=false;this.state='disabled';this.dbPath=null;return this.status();}
   if(!managed){this.enabled=true;this.state='failed';this.lastError='Existing omjb-evidence registration is not installer-managed; review it manually';return this.status();}
   this.enabled=true;
   this.dbPath=entry.environment?.OMJB_DB_PATH??null;
   this.state='starting';
   try{
    await this.#reapStale();
    await this.#spawn();
    await this.#initialize();
    if(this.stopping){await this.#killChild();this.connected=false;this.state='stopped';return this.status();}
    this.connected=true;
    this.state='connected';
    this.lastError=null;
    this.#startHeartbeat();
   }catch(error){
    this.lastError=error.message;
    await this.#killChild();
    this.#scheduleRestart();
   }
   return this.status();
  }finally{this.starting=false;}
 }
 async retry(){
  this.restarts=0;
  this.failures=0;
  this.lastError=null;
  if(this.restartTimer){clearTimeout(this.restartTimer);this.restartTimer=null;}
  if(this.child)await this.#killChild();
  this.connected=false;
  return this.start();
 }
 async stop(){
  this.stopping=true;
  if(this.restartTimer){clearTimeout(this.restartTimer);this.restartTimer=null;}
  if(this.pingTimer){clearInterval(this.pingTimer);this.pingTimer=null;}
  if(this.child)await this.#killChild();
  this.connected=false;
  await rm(this.pidFile,{force:true}).catch(()=>{});
  // Report the preference as it stands now, not as it was at startup:
  // a disable flips the config before stopping, so the state reads
  // 'disabled'; a plain OMH shutdown leaves it enabled and reads 'stopped'.
  const {entry}=await readEvidenceRegistration(this.configPath).catch(()=>({entry:null}));
  this.enabled=entry?.enabled===true;
  this.state=this.enabled?'stopped':'disabled';
  return this.status();
 }
 async #reapStale(){
  // A previous OMH run may have left a server behind (for example after a
  // SIGKILL, which no handler can catch). Never start a second copy: stop
  // the survivor first, but only when it is positively our own server.
  let pid;
  try{pid=Number(await readFile(this.pidFile,'utf8'));}catch{return;}
  if(!Number.isInteger(pid)||pid<=0||pid===process.pid){await rm(this.pidFile,{force:true}).catch(()=>{});return;}
  let alive=false;
  try{process.kill(pid,0);alive=true;}catch{alive=false;}
  if(!alive){await rm(this.pidFile,{force:true}).catch(()=>{});return;}
  if(!await this.#isOurServer(pid)){
   this.logger?.error?.('OMJB evidence MCP: stale pid file points at an unidentified process; leaving it alone');
   await rm(this.pidFile,{force:true}).catch(()=>{});
   return;
  }
  try{process.kill(pid,'SIGTERM');}catch{}
  const deadline=Date.now()+3000;
  while(Date.now()<deadline){
   try{process.kill(pid,0);}catch{break;}
   await new Promise(r=>setTimeout(r,50));
  }
  try{process.kill(pid,0);process.kill(pid,'SIGKILL');}catch{}
  await new Promise(r=>setTimeout(r,100));
  await rm(this.pidFile,{force:true}).catch(()=>{});
 }
 async #isOurServer(pid){
  const entry=this.entry?.command?.[1];
  if(!entry)return false;
  try{
   const cmdline=await readFile(`/proc/${pid}/cmdline`,'utf8');
   return cmdline.includes(entry);
  }catch{}
  try{
   const stdout=await new Promise((resolve,reject)=>{
    execFile('ps',['-o','args=','-p',String(pid)],{timeout:3000},(error,stdout)=>error?reject(error):resolve(stdout));
   });
   return stdout.includes(entry);
  }catch{return false;}
 }
 async #spawn(){
  const [node,entry]=this.entry.command;
  this.child=spawn(node,[entry],{stdio:['pipe','pipe','pipe'],env:{...process.env,...(this.entry.environment||{})},windowsHide:true});
  this.pid=this.child.pid??null;
  if(this.pid!==null)await writeFile(this.pidFile,String(this.pid),{mode:0o600}).catch(()=>{});
  this.buffer='';
  this.child.stdout.on('data',chunk=>this.#onData(chunk));
  this.child.stderr.on('data',chunk=>this.logger?.error?.('OMJB evidence MCP:',String(chunk).trim()));
  this.child.on('error',error=>{
   if(this.stopping)return;
   this.lastError=error.message;
   this.#cleanupChild();
   this.#scheduleRestart();
  });
  this.child.on('exit',()=>{
   if(this.stopping)return;
   const wasConnected=this.connected;
   this.connected=false;
   this.#cleanupChild();
   if(wasConnected)this.logger?.error?.('OMJB evidence MCP exited unexpectedly; scheduling a bounded restart');
   this.#scheduleRestart();
  });
 }
 #onData(chunk){
  this.buffer+=chunk;
  let idx;
  while((idx=this.buffer.indexOf('\n'))>=0){
   const line=this.buffer.slice(0,idx);this.buffer=this.buffer.slice(idx+1);
   if(!line.trim())continue;
   let msg;
   try{msg=JSON.parse(line);}catch{continue;}
   if(msg.id===undefined||!this.pending.has(msg.id))continue;
   const {resolve,reject,timer}=this.pending.get(msg.id);
   this.pending.delete(msg.id);
   clearTimeout(timer);
   if(msg.error)reject(new Error(msg.error.message||'MCP request failed'));
   else resolve(msg.result);
  }
 }
 #request(method,params){
  return new Promise((resolve,reject)=>{
   if(!this.child) return reject(new Error('Evidence MCP is not running'));
   const id=this.nextId++;
   const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Evidence MCP request timed out'));},this.rpcTimeoutMs);
   this.pending.set(id,{resolve,reject,timer});
   this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n',error=>{
    if(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
   });
  });
 }
 async #initialize(){
  const init=await this.#request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'openmind-harness',version:'0.1.0'}});
  if(init?.serverInfo?.name!=='openmind-jailbreak-lab-evidence')throw new Error('Unexpected evidence MCP server identity');
  const list=await this.#request('tools/list');
  const names=(list?.tools??[]).map(t=>t.name);
  if(names.length!==EVIDENCE_TOOLS.length||!EVIDENCE_TOOLS.every(name=>names.includes(name)))
   throw new Error('Evidence MCP offers tools outside the read-only set');
  this.tools=names;
 }
 #startHeartbeat(){
  if(this.pingTimer)clearInterval(this.pingTimer);
  this.pingTimer=setInterval(async()=>{
   try{
    await this.#request('ping');
    this.lastPingAt=new Date().toISOString();
    // A healthy heartbeat clears the consecutive-failure count, so an
    // occasional crash is retried while a crash loop still hits the bound.
    this.failures=0;
   }catch(error){
    if(this.stopping)return;
    this.lastError=error.message;
    this.connected=false;
    await this.#killChild();
    this.#scheduleRestart();
   }
  },this.pingIntervalMs);
  this.pingTimer.unref?.();
 }
 #scheduleRestart(){
  if(this.stopping)return;
  if(this.pingTimer){clearInterval(this.pingTimer);this.pingTimer=null;}
  if(this.failures>=this.maxRestarts){
   this.state='failed';
   this.lastError=this.lastError||'Evidence MCP restart limit reached';
   return;
  }
  this.state='reconnecting';
  const delay=Math.min(this.baseDelayMs*(2**this.failures),this.maxDelayMs);
  this.failures++;
  this.restarts++;
  this.restartTimer=setTimeout(()=>{this.restartTimer=null;this.start().catch(error=>{this.lastError=error.message;});},delay);
  this.restartTimer.unref?.();
 }
 #cleanupChild(){
  if(this.child){this.child.removeAllListeners();this.child=null;}
  this.pid=null;
  for(const {reject,timer} of this.pending.values()){clearTimeout(timer);reject(new Error('Evidence MCP disconnected'));}
  this.pending.clear();
  this.buffer='';
 }
 async #killChild(){
  const child=this.child;
  if(!child)return;
  this.#cleanupChild();
  if(child.exitCode!==null||child.signalCode!==null)return;
  const exited=new Promise(resolve=>child.once('exit',resolve));
  try{child.stdin.end();}catch{}
  child.kill();
  const timeout=new Promise(resolve=>setTimeout(resolve,3000));
  await Promise.race([exited,timeout]);
  if(child.exitCode===null&&child.signalCode===null){
   child.kill('SIGKILL');
   await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,2000))]);
  }
 }
}
