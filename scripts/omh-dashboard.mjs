#!/usr/bin/env node
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {OMH_AGENTS} from '../modules/agent-runner.mjs';
import {PluginRegistry} from '../modules/plugin-registry.mjs';
import {SkillProposalStore} from '../modules/skill-proposals.mjs';
import {MemoryStore} from '../modules/memory.mjs';
import {Scheduler} from '../modules/scheduler.mjs';
import {TaskQueue} from '../modules/task-queue.mjs';
import {TraceJournal} from '../modules/trace-journal.mjs';
import {redact} from '../modules/trace.mjs';
import {WorkspaceManager} from '../modules/workspaces.mjs';

const HOST = '127.0.0.1';
const ASSETS = [
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/dashboard.css', 'dashboard.css', 'text/css; charset=utf-8'],
  ['/app-icon.png', 'app-icon.png', 'image/png'],
  ['/orbit.webp', 'orbit.webp', 'image/webp'],
  ['/orbitron.ttf', 'orbitron.ttf', 'font/ttf'],
  ['/icons.svg', 'icons.svg', 'image/svg+xml'],
  ['/dashboard.js', 'dashboard.js', 'text/javascript; charset=utf-8'],
];
const LIMIT = 50;
const HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

async function readState(state) {
  const queue = new TaskQueue(join(state, 'tasks.json'));
  const [tasks, schedules, notes, traces, workspaces, skills, plugins] = await Promise.all([
    queue.load().then(store => store.list()),
    new Scheduler(join(state, 'schedules.json'), queue).load().then(store => store.list()),
    new MemoryStore(join(state, 'memory.json')).load().then(store => store.list()),
    new TraceJournal(join(state, 'audit.jsonl')).read({limit: LIMIT}),
    new WorkspaceManager(join(state, 'team-workspaces')).list(),
    new SkillProposalStore(join(state, 'skill-proposals.json')).load().then(store => store.list()),
    new PluginRegistry(join(state, 'plugins.json')).load().then(store => store.list()),
  ]);
  const counts = {queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0};
  const agents = OMH_AGENTS.map(name => ({name, queued: 0, running: 0}));
  const byId = new Map(tasks.map(task => [task.id, task]));
  const sandbox = [];
  for (const task of tasks) {
    counts[task.status]++;
    if (task.kind === 'sandbox.exec') sandbox.push(task);
    if (task.kind === 'agent.run' && (task.status === 'queued' || task.status === 'running')) {
      const agent = agents.find(item => item.name === task.input?.agent);
      if (agent) agent[task.status]++;
    }
  }
  const taskView = ({id, kind, status, attempts, createdAt, finishedAt, cancelRequestedAt, dependsOn}) => ({
    id, kind, status, attempts, createdAt, finishedAt, cancelRequestedAt, dependsOn,
    blocked: status === 'queued' && Boolean(dependsOn) && byId.get(dependsOn)?.status !== 'completed',
  });
  return {
    version: 1,
    counts,
    agents,
    tasks: tasks.slice(-LIMIT).reverse().map(taskView),
    workflowSteps: tasks.filter(task => task.dependsOn).slice(-LIMIT).reverse().map(taskView),
    skills: skills.slice(-LIMIT).reverse().map(({id, name, status, createdAt}) => ({id, name, status, createdAt})),
    plugins: plugins.slice(-LIMIT).reverse().map(({name, version, enabled}) => ({name, version, enabled})),
    sandbox: sandbox.slice(-LIMIT).reverse().map(taskView),
    schedules: schedules.slice(-LIMIT).reverse().map(({id, kind, everyMs, enabled, nextAt}) => ({
      id, kind, everyMs, enabled, nextAt,
    })),
    memory: notes.slice(-LIMIT).reverse().map(({id, scope, title, createdAt}) =>
      redact({id, scope, title, createdAt})),
    traces: traces.reverse().map(({at, type, fields}) =>
      redact({at, type, id: fields?.id, kind: fields?.kind, status: fields?.status})),
    workspaces: workspaces.sort().slice(0, LIMIT),
  };
}

export async function createDashboardServer(state) {
  const assets = new Map(await Promise.all(ASSETS.map(async ([route, file, type]) => [
    route, {type, body: await readFile(new URL(`../dashboard/${file}`, import.meta.url))},
  ])));
  const server = createServer(async (request, response) => {
    function send(status, body, type = 'text/plain; charset=utf-8') {
      response.writeHead(status, {...HEADERS, 'Content-Type': type});
      response.end(body);
    }
    if (request.headers.host !== `${HOST}:${server.address().port}` ||
        (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin' &&
         request.headers['sec-fetch-site'] !== 'none')) {
      return send(403, 'Local dashboard requests only');
    }
    if (request.method !== 'GET') return send(405, 'Method not allowed');
    if (request.url === '/api/state') {
      try {
        return send(200, JSON.stringify(await readState(state)), 'application/json; charset=utf-8');
      } catch (error) {
        console.error('OMH dashboard could not read runtime state:', error.code || error.name);
        return send(500, 'Runtime state could not be read.');
      }
    }
    const asset = assets.get(request.url);
    if (asset) return send(200, asset.body, asset.type);
    return send(404, 'Not found');
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const workspace = resolve(process.env.OMH_WORKSPACE || process.cwd());
  const state = resolve(process.env.OMH_STATE_DIR || join(workspace, '.omh'));
  const port = Number(process.env.OMH_DASHBOARD_PORT ?? 4177);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('Invalid OMH dashboard port');
  const server = await createDashboardServer(state);
  server.listen(port, HOST, () => {
    console.log(`OpenMind Harness dashboard at http://${HOST}:${server.address().port}`);
  });
}
