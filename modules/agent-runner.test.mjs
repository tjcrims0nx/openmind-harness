import test from 'node:test';import assert from 'node:assert/strict';import {agentArgs,requireSuccessfulAgentRun,runAgent} from './agent-runner.mjs';
test('native agent command uses arguments not a shell',()=>{const args=agentArgs({agent:'reviewer',workspace:'/tmp/project',prompt:'Review only'});assert.deepEqual(args,['run','--format','json','--agent','reviewer','--dir','/tmp/project','--','Review only']);});
test('unknown agents and malformed models denied',()=>{assert.throws(()=>agentArgs({agent:'dangerous',workspace:'/tmp',prompt:'a'}));assert.throws(()=>agentArgs({agent:'reviewer',workspace:'/tmp',prompt:'a',model:'bad'}));});
test('native agent requires explicit approval',async()=>{await assert.rejects(runAgent({agent:'reviewer',workspace:'/tmp',prompt:'Hi'}),/approval/);});

test('native agent failures cannot be recorded as completed tasks', () => {
 const success = {exitCode: 0, stdout: '{"type":"step_finish"}\n'};
 assert.doesNotThrow(() => requireSuccessfulAgentRun(success));
 assert.throws(() => requireSuccessfulAgentRun({...success, exitCode: 1}), /exited with code 1/);
 assert.throws(() => requireSuccessfulAgentRun({...success, timedOut: true}), /timed out/);
 assert.throws(() => requireSuccessfulAgentRun({...success, outputTruncated: true}), /output limit/);
 assert.throws(() => requireSuccessfulAgentRun({...success, signal: 'SIGTERM'}), /terminated/);
 assert.throws(
  () => requireSuccessfulAgentRun({...success, stderr: 'agent "reviewer" not found. Falling back to default agent'}),
  /did not select the requested OMH agent/,
 );
 const stdout = 'non-JSON output\n{"type":"error","error":{"message":"private provider details"}}\n';
 assert.throws(
  () => requireSuccessfulAgentRun({...success, stdout}),
  {message: 'OpenCode reported a session error'},
 );
});
