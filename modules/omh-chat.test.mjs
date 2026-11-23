import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handleChat,listChatProviders} from '../lib/omh-chat.mjs';
import {createDashboardServer} from '../scripts/omh-dashboard.mjs';
function response(){
 return {statusCode:200,headers:{},payload:null,
  setHeader(k,v){this.headers[k]=v;return this;},
  status(n){this.statusCode=n;return this;},
  json(value){this.payload=value;return this;}};
}
const webToken='w'.repeat(40), mockKey='test-secret-never-returned';
const env={OMH_WEB_ACCESS_TOKEN:webToken,OPENAI_API_KEY:mockKey,OMH_CHAT_OPENAI_MODEL:'gpt-test'};
const fetcher=async (url,options)=>{
 assert.equal(url,'https://api.openai.com/v1/chat/completions');
 assert.equal(options.headers.Authorization,'Bearer '+mockKey);
 assert.equal(JSON.parse(options.body).messages.at(-1).content,'Hello');
 return {ok:true,json:async()=>({choices:[{message:{content:'Hello back'}}]})};
};
test('server-side provider configuration never returns credentials',async()=>{
 const res=response();
 await handleChat({method:'GET',headers:{authorization:'Bearer '+webToken}},res,{env});
 assert.equal(res.statusCode,200);
 const configured=res.payload.providers.find(p=>p.id==='openai');
 assert.equal(configured.available,true);
 assert.equal(configured.model,'gpt-test');
 assert.doesNotMatch(JSON.stringify(res.payload),/test-secret-never-returned/);
});
test('authenticated multi-provider chat routes to fixed endpoint',async()=>{
 const res=response();
 await handleChat({method:'POST',headers:{authorization:'Bearer '+webToken,'content-type':'application/json'},
  body:{provider:'openai',messages:[{role:'user',content:'Hello'}]}},res,{env,fetcher});
 assert.equal(res.statusCode,200);
 assert.deepEqual(res.payload,{provider:'openai',model:'gpt-test',text:'Hello back'});
});
test('chat rejects unknown provider, model override, bad token and arbitrary tool roles',async()=>{
 for(const input of [
  {provider:'custom',messages:[{role:'user',content:'Hello'}]},
  {provider:'openai',messages:[{role:'tool',content:'Hello'}]},
  {provider:'openai',messages:[{role:'user',content:''}]}
 ]){
  const res=response();
  await handleChat({method:'POST',headers:{authorization:'Bearer '+webToken,'content-type':'application/json'},body:input},res,{env,fetcher});
  assert.equal(res.statusCode,400);
 }
 const denied=response();
 await handleChat({method:'GET',headers:{authorization:'Bearer wrong'}},denied,{env});
 assert.equal(denied.statusCode,401);
});
test('local chat blocks missing CSRF and runs a fake provider only after same-origin authorization',async t=>{
 const state=await mkdtemp(join(tmpdir(),'omh-chat-'));
 t.after(()=>rm(state,{recursive:true,force:true}));
 const server=await createDashboardServer(state,{chatEnv:env,chatFetcher:fetcher});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 const session=await (await fetch(base+'/api/session')).json();
 const post=JSON.stringify({provider:'openai',messages:[{role:'user',content:'Hello'}]});
 const denied=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json','Origin':base},body:post});
 assert.equal(denied.status,403);
 const allowed=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json','Origin':base,'X-OMH-CSRF':session.csrf},body:post});
 assert.equal(allowed.status,200);
 const answer=await allowed.json();
 assert.equal(answer.text,'Hello back');
 const listing=await (await fetch(base+'/api/chat')).json();
 assert.equal(listing.providers.find(p=>p.id==='openai').available,true);
});
