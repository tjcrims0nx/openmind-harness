import test from 'node:test';import assert from 'node:assert/strict';import {agentArgs,runAgent} from './agent-runner.mjs';
test('native agent command uses arguments not a shell',()=>{const args=agentArgs({agent:'reviewer',workspace:'/tmp/project',prompt:'Review only'});assert.deepEqual(args,['run','--format','json','--agent','reviewer','--dir','/tmp/project','--','Review only']);});
test('unknown agents and malformed models denied',()=>{assert.throws(()=>agentArgs({agent:'dangerous',workspace:'/tmp',prompt:'a'}));assert.throws(()=>agentArgs({agent:'reviewer',workspace:'/tmp',prompt:'a',model:'bad'}));});
test('native agent requires explicit approval',async()=>{await assert.rejects(runAgent({agent:'reviewer',workspace:'/tmp',prompt:'Hi'}),/approval/);});
