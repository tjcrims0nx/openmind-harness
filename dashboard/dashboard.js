const $ = selector => document.querySelector(selector);
const views = {
  workspace: 'Workspace', agents: 'Agent teams', workflows: 'Workflows', tasks: 'Tasks', memory: 'Memory',
  skills: 'Skills', plugins: 'Plugins', traces: 'Trace', sandbox: 'Sandbox', schedules: 'Schedules',
  workspaces: 'Workspaces',
};
const features = {
  memory: 'Persistent context & project notes', agents: 'Roles, queues & activity',
  workflows: 'Track dependent steps', tasks: 'Inspect background jobs',
  skills: 'Review proposal status', plugins: 'Registered capabilities',
  traces: 'Execution history & events', sandbox: 'Isolated task activity',
};
const tabs = {console: 'Console', workspaces: 'Workspaces', schedules: 'Schedules', traces: 'Logs'};
const filterable = new Set(['tasks', 'workflows', 'sandbox']);
let state;
let active = 'workspace';
let tab = 'console';
let query;
let refreshed;
let csrf;
let actionBusy = false;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 24 24');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', '/icons.svg#' + name);
  svg.append(use);
  return svg;
}

function viewButton(view, label = views[view], description, symbol = view) {
  const button = el('button');
  button.type = 'button';
  button.dataset.view = view;
  const caption = el('span');
  caption.append(el('b', label));
  if (description) caption.append(el('small', description));
  button.append(icon(symbol), caption);
  return button;
}

const time = value => value ? new Date(value).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '';
const date = value => value ? new Date(value).toLocaleString() : '';
const title = word => word ? word[0].toUpperCase() + word.slice(1) : '';
const row = (name, status, detail, id) => ({name, status, detail, id});
const taskCount = () => Object.values(state.counts).reduce((sum, count) => sum + count, 0);

function records(view) {
  if (!state) return [];
  if (filterable.has(view)) {
    const tasks = view === 'workflows' ? state.workflowSteps : state[view];
    return tasks.map(t => ({
      ...row(t.kind, t.blocked ? 'Blocked' : t.cancelRequestedAt && t.status === 'running' ? 'Cancelling' : title(t.status),
        [t.id, (t.attempts || 0) + ' attempts', t.dependsOn && 'Depends on ' + t.dependsOn, date(t.finishedAt || t.createdAt)].filter(Boolean).join(' · '), t.id),
      queueStatus: t.status,
      kind: t.kind,
    }));
  }
  switch (view) {
    case 'agents': return state.agents.map(a => row(a.name, a.running ? 'Running' : a.queued ? 'Queued' : 'Idle', a.running + ' running · ' + a.queued + ' queued'));
    case 'memory': return state.memory.map(n => row(n.title, n.scope, date(n.createdAt), n.id));
    case 'skills': return state.skills.map(s => row(s.name, title(s.status), date(s.createdAt), s.id));
    case 'plugins': return state.plugins.map(p => row(p.name, p.enabled ? 'Enabled' : 'Disabled', 'Version ' + p.version));
    case 'schedules': return state.schedules.map(s => row(s.kind, s.enabled ? 'Enabled' : 'Disabled', 'Every ' + s.everyMs / 1000 + ' s · Next ' + date(s.nextAt), s.id));
    case 'traces': return state.traces.map(t => row(t.type, t.status, [date(t.at), t.kind, t.id].filter(Boolean).join(' · '), t.id));
    case 'workspaces': return state.workspaces.map(name => row(name, 'Workspace'));
    default: return [];
  }
}

function showRows(container, rows, empty) {
  container.replaceChildren();
  if (!rows.length) {
    container.append(el('p', empty, 'empty'));
    return;
  }
  const list = el('ul', undefined, 'records');
  for (const r of rows) {
    const item = el('li');
    item.append(el('b', r.name));
    if (r.status) item.append(el('span', r.status, 'status'));
    if (r.detail) item.append(el('small', r.detail));
    if (r.id && r.queueStatus === 'queued') {
      const cancel=el('button','Cancel queued task','task-action');
      cancel.type='button';cancel.dataset.action='cancel';cancel.dataset.taskId=r.id;
      cancel.disabled=actionBusy;cancel.setAttribute('aria-label','Cancel task '+r.id);
      item.append(cancel);
    } else if (r.id && r.queueStatus === 'failed' && r.kind === 'workspace.read') {
      const retry=el('button','Retry read','task-action');
      retry.type='button';retry.dataset.action='retry';retry.dataset.taskId=r.id;
      retry.disabled=actionBusy;retry.setAttribute('aria-label','Retry task '+r.id);
      item.append(retry);
    }
    list.append(item);
  }
  container.append(list);
}

function renderDock() {
  const panel = $('#dock-content');
  panel.setAttribute('aria-labelledby', 'tab-' + tab);
  for (const button of $('#dock-tabs').children) {
    const selected = button.dataset.tab === tab;
    button.setAttribute('aria-selected', selected);
    button.tabIndex = selected ? 0 : -1;
  }
  if (tab === 'console') {
    panel.replaceChildren(el('span', 'omh@workspace', 'prompt'), el('span', '  ~  runtime status', 'command'),
      el('p', state ? state.agents.length + ' configured roles · ' + taskCount() + ' tasks recorded' : 'Waiting for runtime state.'),
      el('small', state ? Object.entries(state.counts).map(([status, count]) => count + ' ' + status).join(' · ') + '  │  ' + time(refreshed) : ''));
  } else showRows(panel, records(tab), 'No records in this view.');
}

function renderSearch() {
  $('#results').hidden = !query;
  if (!query) return;
  const keys = query.scope === 'all' ? Object.keys(views).filter(v => v !== 'workspace') : [query.scope];
  const rows = keys.flatMap(key => records(key)
    .filter(r => [r.name, r.status, r.detail, r.id].some(s => s?.toLowerCase().includes(query.term)))
    .map(r => ({...r, detail: [views[key], r.detail].filter(Boolean).join(' · ')})));
  showRows($('#matches'), rows, 'No matching runtime records.');
}

function renderView() {
  $('#hub').hidden = active !== 'workspace';
  $('#detail').hidden = active === 'workspace';
  for (const button of document.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', button.dataset.view === active);
  }
  if (active !== 'workspace') {
    $('#view-heading').textContent = views[active];
    $('#filter-label').hidden = !filterable.has(active);
    const rows = records(active).filter(r => !filterable.has(active) || $('#filter').value === 'all' || r.queueStatus === $('#filter').value);
    showRows($('#activity'), rows, 'No records match this view.');
  }
  renderSearch();
  renderDock();
}

function renderFeeds() {
  $('#agent-count').textContent = state.agents.length;
  $('#task-count').textContent = taskCount();
  $('#health-detail').textContent = state.agents.length + ' roles   ·   ' + taskCount() + ' tasks';
  const feeds = [
    ['#agent-feed', records('agents').map(r => row(title(r.name), r.status))],
    ['#task-feed', records('tasks').slice(0, 4)],
    ['#trace-feed', state.traces.slice(0, 4).map(t => row(t.type, time(t.at)))],
  ];
  for (const [selector, rows] of feeds) {
    const feed = $(selector);
    feed.replaceChildren();
    if (!rows.length) feed.append(el('p', 'No activity recorded.', 'empty'));
    for (const r of rows) {
      const item = el('div', undefined, 'feed-row');
      item.append(el('span', r.name), el('small', r.status));
      feed.append(item);
    }
  }
}

function toggleMenu(open) {
  $('#menu').setAttribute('aria-expanded', open);
  document.body.classList.toggle('menu-open', open);
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-view]');
  if (!button) return;
  active = button.dataset.view;
  $('#filter').value = 'all';
  toggleMenu(false);
  renderView();
  if (active !== 'workspace') $('#view-heading').focus({preventScroll: true});
});
document.addEventListener('click', async event => {
  const button=event.target.closest('button[data-action][data-task-id]');
  if(!button || actionBusy)return;
  const action=button.dataset.action;
  if(action!=='cancel' && action!=='retry')return;
  if(!confirm(action==='cancel'?'Cancel this queued task?':'Retry this failed read-only task?'))return;
  actionBusy=true;
  button.disabled=true;
  try {
    if(!csrf){
      const session=await fetch('/api/session',{signal:AbortSignal.timeout(10000)});
      if(!session.ok)throw Error('Dashboard session unavailable');
      csrf=(await session.json()).csrf;
    }
    const response=await fetch('/api/tasks/'+action,{
      method:'POST',
      headers:{'Content-Type':'application/json','X-OMH-CSRF':csrf},
      body:JSON.stringify({id:button.dataset.taskId}),
      signal:AbortSignal.timeout(10000),
    });
    if(!response.ok)throw Error((await response.text()).slice(0,160));
    await load();
  }catch(error){
    $('#error').textContent='Task action failed: '+error.message;
    $('#error').hidden=false;
  }finally{actionBusy=false;button.disabled=false;}
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.classList.contains('menu-open')) {
    toggleMenu(false);
    $('#menu').focus();
  }
});
for (const node of document.querySelectorAll('[data-icon]')) node.replaceWith(icon(node.dataset.icon));
$('#refresh').append(icon('refresh'));
$('#menu').append(icon('menu'));
$('#menu').onclick = () => toggleMenu($('#menu').getAttribute('aria-expanded') !== 'true');
for (const [key, label] of Object.entries(views)) {
  $('#navigation').append(viewButton(key));
  if (key !== 'workspace') $('#scope').add(new Option(label, key));
}
for (const [key, description] of Object.entries(features)) $('#tiles').append(viewButton(key, views[key], description));
$('#shortcuts').append(viewButton('workspace', 'Overview', null, 'panel'), viewButton('agents', 'Agent team'), viewButton('tasks', 'Queue', null, 'list'));
for (const [key, label] of Object.entries(tabs)) {
  const button = el('button');
  button.id = 'tab-' + key;
  button.dataset.tab = key;
  button.setAttribute('role', 'tab');
  button.setAttribute('aria-controls', 'dock-content');
  button.append(icon(key), label);
  button.onclick = () => { tab = key; renderDock(); };
  $('#dock-tabs').append(button);
}
$('#dock-tabs').onkeydown = event => {
  const keys = Object.keys(tabs);
  let index = keys.indexOf(tab);
  switch (event.key) {
    case 'ArrowLeft': index = (index + keys.length - 1) % keys.length; break;
    case 'ArrowRight': index = (index + 1) % keys.length; break;
    case 'Home': index = 0; break;
    case 'End': index = keys.length - 1; break;
    default: return;
  }
  event.preventDefault();
  const button = $('#tab-' + keys[index]);
  button.click();
  button.focus();
};
$('#filter').onchange = renderView;
$('#search-form').onsubmit = event => {
  event.preventDefault();
  query = {term: $('#search').value.trim().toLowerCase(), scope: $('#scope').value};
  renderSearch();
};
$('#scope').onchange = () => { if (query) $('#search-form').requestSubmit(); };
$('#clear').onclick = () => {
  query = undefined;
  $('#search').value = '';
  renderSearch();
  $('#search').focus();
};

async function load() {
  $('#refresh').disabled = true;
  try {
    const response = await fetch('/api/state', {signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw Error('State unavailable');
    state = await response.json();
    refreshed = Date.now();
    renderFeeds();
    renderView();
    $('#connection').textContent = 'Connected';
    $('#health-title').textContent = 'Harness online';
    document.body.dataset.online = 'true';
    $('#error').hidden = true;
  } catch {
    $('#connection').textContent = 'Offline';
    $('#health-title').textContent = 'Harness offline';
    document.body.dataset.online = 'false';
    $('#error').textContent = state ? 'Refresh failed. Showing the last snapshot. Use Refresh to retry.' : 'Runtime state unavailable. Use Refresh to retry.';
    $('#error').hidden = false;
  } finally {
    $('#refresh').disabled = false;
  }
}
$('#refresh').onclick = load;
renderView();
load();
