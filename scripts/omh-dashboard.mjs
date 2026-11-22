#!/usr/bin/env node
import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
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
import {sandboxAvailable} from '../modules/sandbox.mjs';

const HOST = '127.0.0.1';
const JSON_LIMIT = 4096;
function safeEqual(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const first=Buffer.from(a);const second=Buffer.from(b);return first.length===second.length&&timingSafeEqual(first,second);}
async function readJson(request){
 let size=0;const chunks=[];
 for await(const part of request){size+=part.length;if(size>JSON_LIMIT)throw new Error('Request too large');chunks.push(part);}
 const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Object required');
 return value;
}

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
    platform: {os:process.platform,arch:process.arch,node:process.versions.node,sandboxBackendInstalled:sandboxAvailable()},
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

export async function createDashboardServer(state,{adminToken=process.env.OMH_DASHBOARD_ADMIN_TOKEN,workspace=process.env.OMH_WORKSPACE||process.cwd()}={}) {
  if(adminToken!==undefined&&(typeof adminToken!=='string'||Buffer.byteLength(adminToken)<32))throw new Error('OMH dashboard administrator token must contain at least 32 bytes');
  const adminEnabled=adminToken!==undefined;
  const csrf = randomBytes(32).toString('hex');
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
    if (request.method === 'POST' && ['/api/tasks/cancel','/api/tasks/retry','/api/schedules/pause','/api/plugins/disable','/api/skills/reject','/api/schedules/resume','/api/plugins/enable','/api/skills/accept'].includes(request.url)) {
      const port=server.address().port;
      if(request.headers.origin !== `http://${HOST}:${port}` ||
         !safeEqual(request.headers['x-omh-csrf'],csrf) ||
         request.headers['content-type']?.split(';')[0].trim() !== 'application/json'){
        return send(403,'Dashboard action not authorized');
      }
      const privileged=['/api/schedules/resume','/api/plugins/enable','/api/skills/accept'].includes(request.url);
      if(privileged&&(!adminEnabled||!safeEqual(request.headers['x-omh-admin-token'],adminToken))){
        return send(403,'Administrator authorization required');
      }
      try{
        const body=await readJson(request);
        if(request.url==='/api/plugins/enable'){
          if(typeof body.name!=='string'||!/^[-a-z0-9.]{2,64}$/.test(body.name))return send(400,'Invalid plugin name');
          const registry=await new PluginRegistry(join(state,'plugins.json')).load();
          if(!registry.list().some(item=>item.name===body.name&&!item.enabled))return send(409,'Plugin not disabled');
          const result=await registry.enable(body.name,{approved:true});
          return send(200,JSON.stringify({name:result.name,enabled:result.enabled}),'application/json; charset=utf-8');
        }
        if(request.url==='/api/plugins/disable'){
          if(typeof body.name!=='string'||!/^[-a-z0-9.]{2,64}$/.test(body.name))return send(400,'Invalid plugin name');
          const registry=await new PluginRegistry(join(state,'plugins.json')).load();
          const plugin=registry.list().find(item=>item.name===body.name&&item.enabled===true);
          if(!plugin)return send(409,'Plugin not enabled');
          const result=await registry.disable(body.name);
          return send(200,JSON.stringify({name:result.name,enabled:result.enabled}),'application/json; charset=utf-8');
        }
        if(typeof body.id!=='string'||!/^[a-f0-9-]{36}$/i.test(body.id))return send(400,'Invalid identifier');
        if(request.url==='/api/schedules/resume'){
          const queue=new TaskQueue(join(state,'tasks.json'));
          const scheduler=await new Scheduler(join(state,'schedules.json'),queue).load();
          if(!scheduler.list().some(item=>item.id===body.id&&!item.enabled))return send(409,'Schedule not paused');
          const result=await scheduler.resume(body.id);
          return send(200,JSON.stringify({id:result.id,enabled:result.enabled}),'application/json; charset=utf-8');
        }
        if(request.url==='/api/schedules/pause'){
          const queue=new TaskQueue(join(state,'tasks.json'));
          const scheduler=await new Scheduler(join(state,'schedules.json'),queue).load();
          const scheduled=scheduler.list().find(item=>item.id===body.id&&item.enabled===true);
          if(!scheduled)return send(409,'Schedule not enabled');
          const result=await scheduler.pause(body.id);
          return send(200,JSON.stringify({id:result.id,enabled:result.enabled}),'application/json; charset=utf-8');
        }
        if(request.url==='/api/skills/accept'){
          const proposals=await new SkillProposalStore(join(state,'skill-proposals.json')).load();
          if(!proposals.list('pending').some(item=>item.id===body.id))return send(409,'Proposal not pending');
          const result=await proposals.review(body.id,{decision:'accept',approved:true,root:join(resolve(workspace),'skills')});
          return send(200,JSON.stringify({id:result.id,status:result.status}),'application/json; charset=utf-8');
        }
        if(request.url==='/api/skills/reject'){
          const proposals=await new SkillProposalStore(join(state,'skill-proposals.json')).load();
          const pending=proposals.list('pending').find(item=>item.id===body.id);
          if(!pending)return send(409,'Proposal not pending');
          const result=await proposals.review(body.id,{decision:'reject',approved:true});
          return send(200,JSON.stringify({id:result.id,status:result.status}),'application/json; charset=utf-8');
        }
        const queue=await new TaskQueue(join(state,'tasks.json')).load();
        const task=queue.list().find(item=>item.id===body.id);
        if(!task)return send(404,'Task not found');
        // The dashboard is deliberately a restricted local control surface.
        // Do not grant execution privileges or re-run model-originated jobs.
        if(request.url==='/api/tasks/cancel'){
          if(task.status!=='queued')return send(409,'Only queued tasks can be cancelled here');
          const result=await queue.cancel(body.id);
          return send(200,JSON.stringify({id:result.id,status:result.status}),'application/json; charset=utf-8');
        }
        if(task.kind!=='workspace.read'||task.status!=='failed')return send(409,'Only failed read-only tasks can be retried here');
        const result=await queue.retry(body.id,{maxAttempts:3});
        return send(200,JSON.stringify({id:result.id,status:result.status}),'application/json; charset=utf-8');
      }catch(error){
        if(error instanceof SyntaxError||error.message==='Request too large'||error.message==='Object required')return send(400,'Malformed dashboard request');
        if(/Retry limit|Only failed|running task/.test(error.message))return send(409,'Task state changed or retry limit reached');
        console.error('OMH dashboard action failed:',error.code||error.name);
        return send(500,'Dashboard action failed');
      }
    }
    if (request.method !== 'GET') return send(405, 'Method not allowed');
    if (request.url === '/api/session') return send(200,JSON.stringify({csrf}), 'application/json; charset=utf-8');
    if (request.url === '/api/state') {
      try {
        return send(200, JSON.stringify({...await readState(state),adminActionsAvailable:adminEnabled}), 'application/json; charset=utf-8');
      } catch (error) {
        console.error('OMH dashboard could not read runtime state:', error.code || error.name);
        return send(500, 'Runtime state could not be read.');
      }
    }
    const asset = assets.get(request.url);
    if (asset) return send(200, asset.body, asset.type);
    return send(404, 'Not found');
  });
  server.requestTimeout=10000;
  server.headersTimeout=8000;
  server.keepAliveTimeout=5000;
  server.maxHeadersCount=60;
  server.maxRequestsPerSocket=100;
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
