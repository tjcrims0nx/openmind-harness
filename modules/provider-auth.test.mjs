import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorStatuses,verifyConnector} from './provider-auth.mjs';
test('status never exposes credentials',()=>{
 const statuses=connectorStatuses({OPENAI_API_KEY:'secret-test-key'});
 assert.equal(statuses.find(p=>p.id==='openai').status,'configured');
 assert.ok(!JSON.stringify(statuses).includes('secret-test-key'));
});
test('verification requires configured credentials and rejects unknown providers',async()=>{
 assert.equal((await verifyConnector('openai',{env:{}})).status,'disconnected');
 assert.equal((await verifyConnector('unknown',{env:{}})).status,'unsupported');
});
test('verification handles success, invalid keys, and network failures without leaking secrets',async()=>{
 const env={OPENAI_API_KEY:'private-secret'};
 const yes=await verifyConnector('openai',{env,fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/models');
  assert.equal(options.headers.Authorization,'Bearer private-secret');
  return {ok:true,status:200};
 }});
 assert.equal(yes.verified,true);
 const no=await verifyConnector('openai',{env,fetchImpl:async()=>({ok:false,status:401})});
 assert.equal(no.status,'unauthorized');
 const fail=await verifyConnector('openai',{env,fetchImpl:async()=>{throw Error('private-secret');}});
 assert.equal(fail.status,'unreachable');
 assert.ok(!JSON.stringify([yes,no,fail]).includes('private-secret'));
});
test('custom endpoint is not automatically contacted',async()=>{
 const result=await verifyConnector('custom',{env:{OPENMIND_CUSTOM_API_KEY:'secret'},fetchImpl:async()=>{throw Error('must not call');}});
 assert.equal(result.verified,false);
});
