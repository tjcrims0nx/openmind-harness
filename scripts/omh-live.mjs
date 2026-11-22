#!/usr/bin/env node
/** Authenticated HTTP gateway for a trusted, persistent Linux OMH runtime.
 * Designed for a TLS tunnel to Vercel; never execute model-supplied shell code.
 */
import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readState} from './omh-dashboard.mjs';
import {handleRPC} from './omh-mcp.mjs';
import {TaskQueue} from '../modules/task-queue.mjs';
import {Scheduler} from '../modules/scheduler.mjs';
import {PluginRegistry} from '../modules/plugin-registry.mjs';
import {SkillProposalStore} from '../modules/skill-proposals.mjs';

const BODY_LIMIT=65536;
const HEADERS={'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const allowed=new Set(['cancel','retry','pause','disable','reject']);
const validId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const validName=name=>typeof name==='string'&&/^[-a-z0-9.]{2,64}$/.test(name);
function equal(a,b){
 if(typeof a!=='string'||typeof b!=='string')return false;
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&timingSafeEqual(x,y);
}
async function bodyJson(req){
 let length=0;const parts=[];
 for await(const chunk of req){length+=chunk.length;if(length>BODY_LIMIT)throw new Error('Request body too large');parts.push(chunk);}
 const value=JSON.parse(Buffer.concat(parts).toString('utf8'));
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('JSON object expected');
 return value;
}
export async function applyLiveAction(state,action,payload){
 if(!allowed.has(action))return {status:403,error:'Action not permitted'};
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return {status:400,error:'Invalid input'};
 if(action==='disable'){
  if(!validName(payload.name))return {status:400,error:'Invalid plugin name'};
  const plugins=await new PluginRegistry(join(state,'plugins.json')).load();
  if(!plugins.list().some(p=>p.name===payload.name&&p.enabled))return {status:409,error:'Plugin not enabled'};
  const result=await plugins.disable(payload.name);
  return {status:200,data:{name:result.name,enabled:result.enabled}};
 }
 if(!validId(payload.id))return {status:400,error:'Invalid identifier'};
 if(action==='pause'){
  const schedule=await new Scheduler(join(state,'schedules.json'),new TaskQueue(join(state,'tasks.json'))).load();
  if(!schedule.list().some(s=>s.id===payload.id&&s.enabled))return {status:409,error:'Schedule not enabled'};
  const result=await schedule.pause(payload.id);
  return {status:200,data:{id:result.id,enabled:result.enabled}};
 }
 if(action==='reject'){
  const store=await new SkillProposalStore(join(state,'skill-proposals.json')).load();
  if(!store.list('pending').some(p=>p.id===payload.id))return {status:409,error:'Proposal not pending'};
  const result=await store.review(payload.id,{decision:'reject',approved:true});
  return {status:200,data:{id:result.id,status:result.status}};
 }
 const queue=await new TaskQueue(join(state,'tasks.json')).load();
 const task=queue.list().find(t=>t.id===payload.id);
 if(!task)return {status:404,error:'Task not found'};
 if(action==='cancel'){
  if(task.status!=='queued')return {status:409,error:'Only queued tasks can be cancelled'};
  const result=await queue.cancel(task.id);
  return {status:200,data:{id:result.id,status:result.status}};
 }
 if(task.kind!=='workspace.read'||task.status!=='failed')return {status:409,error:'Only failed read-only tasks can be retried'};
 try{
  const result=await queue.retry(task.id,{maxAttempts:3});
  return {status:200,data:{id:result.id,status:result.status}};
 }catch{return {status:409,error:'Retry not available'};}
}
export function createLiveBridge({state=resolve(process.env.OMH_STATE_DIR||
 join(process.env.OMH_WORKSPACE||process.cwd(),'.omh')),
 token=process.env.OMH_LIVE_TOKEN}={}){
 if(typeof token!=='string'||Buffer.byteLength(token)<32)throw Error('OMH_LIVE_TOKEN must contain at least 32 bytes');
 const server=createServer(async(req,res)=>{
  const send=(code,value)=>{res.writeHead(code,HEADERS);res.end(JSON.stringify(value));};
  if(!equal(req.headers.authorization?.replace(/^Bearer /i,''),token))return send(401,{error:'Unauthorized'});
  if(req.headers.origin||!['same-origin','none',undefined].includes(req.headers['sec-fetch-site']))
   return send(403,{error:'Browser requests must use the authorized Vercel proxy'});
  try{
   const pathname=new URL(req.url||'/', 'http://omh.internal').pathname;
   if(req.method==='GET'&&pathname==='/health')return send(200,{service:'omh-live',ready:true});
   if(req.method==='GET'&&pathname==='/api/state')
    return send(200,{...await readState(state),adminActionsAvailable:false});
   if(req.method==='POST'&&pathname==='/api/actions'){
    if(req.headers['content-type']?.split(';')[0].trim()!=='application/json')return send(415,{error:'JSON required'});
    const {action,...data}=await bodyJson(req);
    const result=await applyLiveAction(state,action,data);
    return send(result.status,result.data??{error:result.error});
   }
   if(req.method==='POST'&&pathname==='/mcp'){
    if(req.headers['content-type']?.split(';')[0].trim()!=='application/json')return send(415,{error:'JSON required'});
    const rpc=await bodyJson(req);
    if(rpc.jsonrpc!=='2.0')return send(400,{error:'Invalid JSON-RPC request'});
    const result=await handleRPC(rpc);
    if(result===null){res.writeHead(202,{'Cache-Control':'no-store'});return res.end();}
    return send(200,result);
   }
   return send(404,{error:'Not found'});
  }catch(error){
   if(error instanceof SyntaxError||['Request body too large','JSON object expected'].includes(error.message))
    return send(400,{error:'Invalid JSON request'});
   console.error('OMH live bridge failure:',error.code||error.name);
   return send(500,{error:'Runtime request failed'});
  }
 });
 server.requestTimeout=12000;
 server.headersTimeout=8000;
 server.keepAliveTimeout=5000;
 server.maxHeadersCount=50;
 return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const port=Number(process.env.OMH_LIVE_PORT??4188);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid OMH_LIVE_PORT');
 const server=createLiveBridge();
 server.listen(port,'127.0.0.1',()=>console.log('OMH live gateway listening on 127.0.0.1:'+port));
}
