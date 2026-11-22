import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnose} from './doctor.mjs';
const ok=(cmd)=>({status:0,stdout:cmd==='opencode'?'1.19.6':'bubblewrap 0.9.0'});
test('doctor reports unsupported platform without pretending sandbox is available',async()=>{
 const d=await diagnose({platform:'darwin',nodeVersion:'22.1.0',spawn:ok});
 assert.equal(d.node.supported,true);
 assert.equal(d.sandbox.verified,false);
 assert.equal(d.sandbox.installed,false);
 assert.ok(d.warnings.some(s=>s.includes('isolation')));
});
test('doctor validates Linux namespace probe instead of bwrap version alone',async()=>{
 let checks=0;
 const d=await diagnose({platform:'linux',nodeVersion:'22.1.0',spawn:ok,sandboxRun:async ({command,args})=>{
  checks++;
  assert.equal(command,'sh');
  assert.ok(args.some(value=>value.includes('/workspace')));
  return {exitCode:0,timedOut:false,outputTruncated:false};
 }});
 assert.equal(checks,1);
 assert.equal(d.sandbox.verified,true);
});
test('doctor marks failing namespace probe as unverified',async()=>{
 const d=await diagnose({platform:'linux',nodeVersion:'20.0.0',spawn:ok,sandboxRun:async()=>{throw Error('namespace disabled');}});
 assert.equal(d.node.supported,false);
 assert.equal(d.sandbox.installed,true);
 assert.equal(d.sandbox.verified,false);
 assert.ok(d.warnings.some(s=>s.includes('Node.js 22')));
});
