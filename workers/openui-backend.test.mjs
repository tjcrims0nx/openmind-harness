import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{handleApi} from './openui-backend.mjs';

const token='z'.repeat(40);
const env={OMH_WEB_ACCESS_TOKEN:token,OPENAI_API_KEY:'server-secret-only',GEMINI_API_KEY:'server-gemini-secret'};
const base='https://omh-openui-test.example';
const headers={Authorization:'Bearer '+token,'Sec-Fetch-Site':'same-origin'};
const request=(path,method='GET',body,moreHeaders={})=>new Request(base+path,{
 method,
 headers:{...headers,...moreHeaders,...(body?{'Content-Type':'application/json','Origin':base}:{})},
 ...(body?{body:JSON.stringify(body)}:{})
});
test('denies unconfigured and unauthorized calls; never leaks provider secrets',async()=>{
 assert.equal((await handleApi(request('/api/chat'),{})).status,503);
 assert.equal((await handleApi(new Request(base+'/api/chat'),env)).status,401);
 const res=await handleApi(request('/api/chat'),env);
 assert.equal(res.status,200);
 const text=await res.text();
 assert.doesNotMatch(text,/server-secret-only|server-gemini-secret/);
 const providers=JSON.parse(text).providers;
 assert.equal(providers.find(x=>x.id==='openai').available,true);
 assert.equal(providers.find(x=>x.id==='gemini').model,'gemini-3.5-flash-lite');
});
test('forwards only validated messages to an approved provider with server-side key',async()=>{
 let called=0;
 const fetcher=async (url,init)=>{
  called+=1;
  assert.equal(url,'https://api.openai.com/v1/chat/completions');
  assert.equal(init.headers.Authorization,'Bearer server-secret-only');
  assert.deepEqual(JSON.parse(init.body).messages,[{role:'user',content:'hi'}]);
  return new Response(JSON.stringify({choices:[{message:{content:'Hello OMH'}}]}),{status:200,headers:{'Content-Type':'application/json'}});
 };
 const result=await handleApi(request('/api/chat','POST',{provider:'openai',messages:[{role:'user',content:'hi'}]}),env,{fetcher});
 assert.equal(result.status,200);
 assert.equal((await result.json()).text,'Hello OMH');
 assert.equal(called,1);
});
test('rejects cross-origin requests, unknown URLs, tool roles, unconfigured backend',async()=>{
 const payload={provider:'openai',messages:[{role:'user',content:'hi'}]};
 const cross=request('/api/chat','POST',payload,{'Origin':'https://attacker.example'});
 assert.equal((await handleApi(cross,env)).status,403);
 assert.equal((await handleApi(request('/api/not-found'),env)).status,404);
 assert.equal((await handleApi(request('/api/chat','POST',{provider:'openai',messages:[{role:'tool',content:'hi'}]}),env)).status,400);
 assert.equal((await handleApi(request('/api/chat','POST',{provider:'openai',messages:[{role:'user',content:'hi'}]}),{OMH_WEB_ACCESS_TOKEN:token})).status,503);
});
test('runtime stays disconnected without configured HTTPS upstream',async()=>{
 const result=await handleApi(request('/api/state'),env);
 assert.equal(result.status,503);
 assert.match((await result.json()).error,/not connected/i);
});
test('static frontend uses assets binding on same host',async()=>{
 const response=await worker.fetch(new Request(base+'/'),{ASSETS:{fetch:async()=>new Response('OMH UI')}});
 assert.equal(await response.text(),'OMH UI');
});
