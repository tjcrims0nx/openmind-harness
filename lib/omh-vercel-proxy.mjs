/** Shared Vercel gateway: Vercel never runs agents or reads OMH local files.
 * Two independent credentials: browser access and Vercel-to-Linux transport.
 */
import {timingSafeEqual} from 'node:crypto';

function same(a,b){
 if(typeof a!=='string'||typeof b!=='string')return false;
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&timingSafeEqual(x,y);
}
export function verifyWebAccess(request,env=process.env){
 const token=env.OMH_WEB_ACCESS_TOKEN;
 if(typeof token!=='string'||Buffer.byteLength(token)<32)return {ok:false,status:503};
 const provided=request.headers?.authorization?.replace(/^Bearer /i,'');
 if(!same(provided,token))return {ok:false,status:401};
 const origin=request.headers?.origin;
 const host=request.headers?.host;
 if(origin&&(!host||origin!==`https://${host}`))return {ok:false,status:403};
 if(!['same-origin','none',undefined].includes(request.headers?.['sec-fetch-site']))return {ok:false,status:403};
 return {ok:true,status:200};
}
export function upstreamConfig(env=process.env){
 const url=env.OMH_LIVE_URL;
 const token=env.OMH_LIVE_TOKEN;
 if(typeof token!=='string'||Buffer.byteLength(token)<32||typeof url!=='string')return null;
 let parsed;
 try{parsed=new URL(url);}catch{return null;}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||
    /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[?::1)/i.test(parsed.hostname))
  return null;
 return {base:parsed.origin,token};
}
export async function bridgeRequest(req,res,{route,methods=['GET'],maxBytes=65536,fetcher=fetch,env=process.env}){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(!methods.includes(req.method))return res.status(405).json({error:'Method not allowed'});
 const access=verifyWebAccess(req,env);
 if(!access.ok)return res.status(access.status).json({error:access.status===503?'Dashboard access not configured':'Unauthorized'});
 const config=upstreamConfig(env);
 if(!config)return res.status(503).json({error:'Linux runtime not connected; configure HTTPS upstream'});
 let payload;
 if(req.method==='POST'){
  if(req.headers['content-type']?.split(';')[0].trim()!=='application/json')return res.status(415).json({error:'JSON required'});
  payload=typeof req.body==='string'?req.body:JSON.stringify(req.body);
  if(typeof payload!=='string'||Buffer.byteLength(payload)>maxBytes)return res.status(413).json({error:'Payload too large'});
 }
 try{
  const upstream=await fetcher(config.base+route,{
   method:req.method,
   headers:{Authorization:'Bearer '+config.token,...(req.method==='POST'?{'Content-Type':'application/json'}:{})},
   ...(payload!==undefined?{body:payload}:{}),
   signal:AbortSignal.timeout(10000),
   redirect:'error'
  });
  const data=await upstream.text();
  if(data.length>1024*1024)return res.status(502).json({error:'Unexpected upstream response size'});
  res.status(upstream.status);
  res.setHeader('Content-Type',upstream.status===202?'text/plain; charset=utf-8':'application/json; charset=utf-8');
  return res.send(data);
 }catch(error){
  console.error('OMH upstream transport failure:',error.name);
  return res.status(502).json({error:'Linux runtime unreachable'});
 }
}
