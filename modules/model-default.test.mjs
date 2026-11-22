import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const config=JSON.parse(await readFile(new URL('../opencode.json',import.meta.url),'utf8'));

test('responsive Gemini Flash Lite is the configured default',()=>{
 assert.equal(config.model,'google/gemini-3.5-flash-lite');
 assert.ok(config.provider.google.models['gemini-3.5-flash-lite']);
 assert.ok(config.provider.google.models['gemini-3.8-flash'],'Keep experimental option in the picker');
});

test('native OMH planning, implementation, review, and testing roles do not select stalled 3.8',()=>{
 for(const role of ['planner','implementer','reviewer','tester']){
  assert.equal(config.agent[role].model,config.model,role);
 }
});

test('small-model selection is separate and must not be mistaken for main-model failover',()=>{
 assert.equal(config.small_model,'experientiallabs/deepseek-v4.1-flash:free');
 assert.notEqual(config.model,config.small_model);
});
