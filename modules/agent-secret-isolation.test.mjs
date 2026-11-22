import test from 'node:test';
import assert from 'node:assert/strict';
import {restrictedAgentEnvironment} from './opencode-session.mjs';

test('OpenCode subprocesses never inherit dashboard administrator credentials',()=>{
 const original={
  OMH_DASHBOARD_ADMIN_TOKEN:'test-dashboard-secret',
  GEMINI_API_KEY:'fixture-provider-secret',
  HOME:'/tmp/test-home',
  OPENCODE_SERVER_PASSWORD:'inherited-old-password'
 };
 const env=restrictedAgentEnvironment(original,'omh','new-random-password');
 assert.equal(Object.hasOwn(env,'OMH_DASHBOARD_ADMIN_TOKEN'),false);
 assert.equal(env.GEMINI_API_KEY,'fixture-provider-secret');
 assert.equal(env.OPENCODE_SERVER_USERNAME,'omh');
 assert.equal(env.OPENCODE_SERVER_PASSWORD,'new-random-password');
 assert.equal(original.OMH_DASHBOARD_ADMIN_TOKEN,'test-dashboard-secret');
});
