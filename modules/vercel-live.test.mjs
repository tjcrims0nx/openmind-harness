import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyWebAccess,upstreamConfig,bridgeRequest} from '../lib/omh-vercel-proxy.mjs';

const env={OMH_WEB_ACCESS_TOKEN:'web-access-key-'.repeat(3),OMH_LIVE_URL:'https://omh-runtime.example.test',
 OMH_LIVE_TOKEN:'runtime-transport-key-'.repeat(2)};
function request(overrides={}){
 return {method:'GET',headers:{host:'omh.vercel.app',authorization:'Bearer '+env.OMH_WEB_ACCESS_TOKEN,...overrides.headers},body:overrides.body,...overrides};
}
function response(){
 const r={statusCode:200,headers:{},payload:undefined};
 r.status=n=>{r.statusCode=n;return r;};
 r.setHeader=(name,value)=>{r.headers[name]=value;return r;};
 r.json=value=>{r.payload=value;return r;};
 r.send=value=>{r.payload=value;return r;};
 return r;
}
test('Vercel proxy refuses missing and invalid access tokens and cross-origin requests',()=>{
 assert.equal(verifyWebAccess(request({headers:{authorization:'Bearer nope'}}),env).status,401);
 assert.equal(verifyWebAccess(request({headers:{origin:'https://untrusted.test'}}),env).status,403);
 assert.equal(verifyWebAccess(request(),{}).status,503);
 assert.equal(verifyWebAccess(request(),env).ok,true);
});
test('runtime URL must be HTTPS and not private-address SSRF target',()=>{
 assert.equal(upstreamConfig({...env,OMH_LIVE_URL:'http://127.0.0.1:4188'}),null);
 assert.equal(upstreamConfig({...env,OMH_LIVE_URL:'https://localhost'}),null);
 assert.equal(upstreamConfig({...env,OMH_LIVE_URL:'https://192.168.1.1'}),null);
 assert.equal(upstreamConfig({...env,OMH_LIVE_URL:'https://runtime.example.test@localhost/'}),null);
 assert.equal(upstreamConfig(env).base,'https://omh-runtime.example.test');
});
test('Vercel gateway forwards browser API to Linux using a separate secret',async()=>{
 const calls=[];
 const fetcher=async(url,opts)=>{
  calls.push({url,opts});
  return {status:200,text:async()=>JSON.stringify({version:1,counts:{queued:1}})};
 };
 const res=response();
 await bridgeRequest(request(),res,{route:'/api/state',fetcher,env});
 assert.equal(res.statusCode,200);
 assert.equal(JSON.parse(res.payload).version,1);
 assert.equal(calls[0].url,'https://omh-runtime.example.test/api/state');
 assert.equal(calls[0].opts.headers.Authorization,'Bearer '+env.OMH_LIVE_TOKEN);
 assert.ok(!calls[0].opts.headers.Authorization.includes(env.OMH_WEB_ACCESS_TOKEN));
 assert.equal(calls[0].opts.redirect,'error');
});
test('proxy denies unconfigured backend, oversized payloads and wrong methods',async()=>{
 const disconnected=response();
 await bridgeRequest(request(),disconnected,{route:'/api/state',env:{...env,OMH_LIVE_URL:undefined}});
 assert.equal(disconnected.statusCode,503);
 const req=request({method:'POST',headers:{'content-type':'application/json'},body:{action:'cancel',id:'test'}});
 const big=response();
 await bridgeRequest(req,big,{route:'/api/actions',methods:['POST'],maxBytes:4,env});
 assert.equal(big.statusCode,413);
 const wrong=response();
 await bridgeRequest(request(),wrong,{route:'/api/actions',methods:['POST'],env});
 assert.equal(wrong.statusCode,405);
});
test('public browser cannot access model execution or credentialed state through empty deployment',async()=>{
 const res=response();
 await bridgeRequest(request({headers:{authorization:''}}),res,{route:'/api/state',env});
 assert.equal(res.statusCode,401);
});
