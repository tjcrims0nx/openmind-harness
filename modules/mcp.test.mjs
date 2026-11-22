import test from 'node:test';import assert from 'node:assert/strict';import {handleRPC} from '../scripts/omh-mcp.mjs';
test('MCP initializes in legacy OpenCode and exposes only safe tools',async()=>{const init=await handleRPC({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}});assert.equal(init.result.serverInfo.name,'omh-runtime');const t=await handleRPC({jsonrpc:'2.0',id:2,method:'tools/list'});const names=t.result.tools.map(x=>x.name);assert.ok(names.includes('omh_memory_search'));assert.ok(names.includes('omh_doctor'));assert.ok(!names.includes('sandbox.exec'));assert.ok(!names.includes('agent.run'));});
test('MCP refuses privileged tool calls',async()=>{const r=await handleRPC({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'sandbox.exec',arguments:{approved:true}}});assert.ok(r.result?.isError===true||r.error);});
test('MCP does not respond to notifications',async()=>{assert.equal(await handleRPC({jsonrpc:'2.0',method:'notifications/initialized'}),null);});

test('MCP rejects unexpected, missing, and malformed arguments before accessing state',async()=>{
 for(const args of [{path:'README.md',approved:true},{},{path:42}]){
  const r=await handleRPC({jsonrpc:'2.0',id:20,method:'tools/call',params:{name:'omh_queue_read',arguments:args}});
  assert.equal(r.result?.isError,true);
 }
 const invalidLimit=await handleRPC({jsonrpc:'2.0',id:21,method:'tools/call',params:{name:'omh_trace_recent',arguments:{limit:101}}});
 assert.equal(invalidLimit.result?.isError,true);
 const malformed=await handleRPC({jsonrpc:'2.0',id:22,method:'tools/call',params:{name:'omh_status',arguments:[]}});
 assert.equal(malformed.result?.isError,true);
});
