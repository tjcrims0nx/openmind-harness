import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {request} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createDashboardServer} from '../scripts/omh-dashboard.mjs';
import {PluginRegistry} from './plugin-registry.mjs';
import {SkillProposalStore} from './skill-proposals.mjs';
import {MemoryStore} from './memory.mjs';
import {Scheduler} from './scheduler.mjs';
import {TaskQueue} from './task-queue.mjs';
import {TraceJournal} from './trace-journal.mjs';
import {WorkspaceManager} from './workspaces.mjs';

test('dashboard reads runtime stores over loopback without leaking task or note contents', async t => {
  const state = await mkdtemp(join(tmpdir(), 'omh-dashboard-'));
  t.after(() => rm(state, {recursive: true, force: true}));
  const server = await createDashboardServer(state);
  t.after(() => new Promise(resolve => server.close(resolve)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  const home = await page.text();
  // OpenUI is primary when frontend-next/dist is built; otherwise the
  // classic dashboard remains the home page. Either way /classic always
  // serves the classic dashboard.
  const isOpenUI = home.includes('<div id="root"></div>');
  if (isOpenUI) {
    assert.match(home, /<title>OpenMind Harness · Chat<\/title>/);
  } else {
    assert.match(home, /<title>Chat · OpenMind Harness<\/title>/);
  }
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const classic = await fetch(base + '/classic');
  assert.equal(classic.status, 200);
  assert.match(await classic.text(), /<title>Chat · OpenMind Harness<\/title>/);

  const empty = await (await fetch(base + '/api/state')).json();
  assert.equal(empty.platform.os, process.platform);
  assert.equal(empty.platform.arch, process.arch);
  assert.equal(empty.platform.node, process.versions.node);
  assert.equal(typeof empty.platform.sandboxBackendInstalled, 'boolean');
  assert.equal(empty.counts.queued, 0);
  assert.deepEqual(empty.tasks, []);
  assert.ok(Array.isArray(empty.providers));
  assert.ok(empty.providers.every(p => typeof p.id === 'string' && (p.status === 'configured' || p.status === 'disconnected')));
  assert.ok(empty.providers.every(p => !('key' in p) && !('token' in p) && !('secret' in p)));

  const queue = new TaskQueue(join(state, 'tasks.json'), {
    'agent.run': async () => 'private-output',
    'sandbox.exec': async () => null,
  });
  const [first, second] = await queue.enqueueSequence([
    {kind: 'agent.run', input: {agent: 'reviewer', prompt: 'private-prompt'}},
    {kind: 'sandbox.exec', input: {args: ['private-argument']}},
  ]);
  await new Scheduler(join(state, 'schedules.json'), queue)
    .add({kind: 'sandbox.exec', input: {args: ['private-schedule']}, everyMs: 60000});
  await new MemoryStore(join(state, 'memory.json'))
    .add({title: 'Conventions', content: 'private-memory', approved: true});
  await new WorkspaceManager(join(state, 'team-workspaces')).create('reviewer');
  await new TraceJournal(join(state, 'audit.jsonl'), {enabled: true})
    .record('task.queued', {id: first.id, kind: first.kind, extra: 'private-trace'});

  await new PluginRegistry(join(state, 'plugins.json')).register({
    name: 'test-plugin', version: '1.0.0', description: 'private-description', approved: true,
  });
  await new SkillProposalStore(join(state, 'skill-proposals.json')).propose({
    name: 'test-skill', description: 'private-skill', instructions: 'private-instructions',
  });
  const response = await fetch(base + '/api/state');
  const raw = await response.text();
  assert.equal(response.status, 200);
  assert.doesNotMatch(raw, /private-/);
  const data = JSON.parse(raw);
  assert.equal(data.counts.queued, 2);
  assert.equal(data.workflowSteps[0].dependsOn, first.id);
  assert.deepEqual(data.plugins, [{name: 'test-plugin', version: '1.0.0', enabled: false}]);
  assert.equal(data.skills[0].status, 'pending');
  assert.equal(data.sandbox[0].id, second.id);
  assert.equal(data.sandbox[0].blocked, true);
  assert.deepEqual(data.agents.find(item => item.name === 'reviewer'),
    {name: 'reviewer', queued: 1, running: 0});
  assert.equal(data.schedules[0].enabled, true);
  assert.equal(data.memory[0].title, 'Conventions');
  assert.equal(data.traces[0].id, first.id);
  assert.deepEqual(data.workspaces, ['reviewer']);

  assert.equal((await fetch(base + '/api/state', {method: 'POST'})).status, 405);
  assert.equal((await fetch(base + '/api/state', {headers: {'Sec-Fetch-Site': 'cross-site'}})).status, 403);
  const foreignHost = request(base + '/api/state', {headers: {Host: 'example.test'}});
  foreignHost.end();
  const [denied] = await once(foreignHost, 'response');
  denied.resume();
  assert.equal(denied.statusCode, 403);
  assert.equal((await fetch(base + '/tasks.json')).status, 404);
});
