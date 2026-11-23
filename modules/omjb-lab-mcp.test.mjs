import test from 'node:test';
import assert from 'node:assert/strict';
import {invoke,handleRPC} from '../plugins/omjb-mcp/lab-server.mjs';

test('Lab capabilities advertise execution tools but do not start processes',async()=>{
 const r=await invoke('omjb_lab_capabilities',{});
 assert.equal(typeof r.installed,'boolean');
 assert.equal(r.operations.length,3);
});
test('unsafe or arbitrary command arguments are rejected',async()=>{
 for(const args of [{case_id:'../../etc/passwd',target:'echo'},{case_id:'GL-001',target:'bash'},{case_id:'GL-001',target:'echo',command:'sh'}])
  await assert.rejects(invoke('omjb_lab_run_case',args));
});
test('campaigns require finite budgets and valid provider selectors',async()=>{
 for(const args of [
  {targets:['evil:cmd'],max_requests:2,max_usd:1,estimated_request_cost:0.1},
  {targets:['openai:test'],max_requests:999999,max_usd:1,estimated_request_cost:0.1},
  {targets:['openai:test'],max_requests:1,max_usd:0,estimated_request_cost:0}
 ])await assert.rejects(invoke('omjb_lab_run_campaign',args));
});
test('campaign preflight enforces the full requested cost, not one request',async()=>{
 await assert.rejects(invoke('omjb_lab_run_campaign',{
  targets:['openai:model'],max_requests:10,max_usd:0.05,estimated_request_cost:0.01
 }),/maximum estimated total cost/);
 await assert.rejects(invoke('omjb_lab_run_campaign',{
  targets:['echo:local'],max_requests:2,max_usd:0,estimated_request_cost:0.1
 }),/both be zero/);
});
test('campaign target selectors reject extra colons before execution',async()=>{
 for(const selector of ['openai:model:extra','ollama:model:latest','gemini:bad::model']){
  await assert.rejects(invoke('omjb_lab_run_campaign',{
   targets:[selector],max_requests:1,max_usd:1,estimated_request_cost:0.1
  }),/Invalid targets/);
 }
});
test('unknown tools and malformed RPC requests cannot invoke a process',async()=>{
 await assert.rejects(invoke('run_shell',{}));
 const r=await handleRPC({jsonrpc:'2.0',id:12,method:'tools/call',params:{name:'run_shell',arguments:{}}});
 assert.equal(r.result.isError,true);
});
