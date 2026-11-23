const $ = selector => document.querySelector(selector);
const sections = {overview: 'Overview', activity: 'Activity', settings: 'Settings'};
const sectionIcons = {overview: 'workspace', activity: 'traces', settings: 'build'};
const views = {
  workspace: 'Workspace', agents: 'Agent teams', workflows: 'Workflows', tasks: 'Tasks', memory: 'Memory',
  skills: 'Skills', plugins: 'Plugins', traces: 'Trace', sandbox: 'Sandbox', schedules: 'Schedules',
  workspaces: 'Workspaces',
};
const activityViews = {
  tasks: 'Tasks', workflows: 'Workflows', traces: 'Traces',
  sandbox: 'Sandbox', memory: 'Memory', workspaces: 'Workspaces',
};
const tabs = {console: 'Console', workspaces: 'Workspaces', schedules: 'Schedules', traces: 'Logs'};
const filterable = new Set(['tasks', 'workflows', 'sandbox']);
let state;
let active = 'overview';
let activityView = 'tasks';
let tab = 'console';
let query;
let refreshed;
let csrf;
let adminToken;
let actionBusy = false;
const remote = document.documentElement.dataset.omhRemote === 'true';
let webToken;
async function runtimeFetch(url,options={}){
 if(!remote)return fetch(url,options);
 if(!webToken){
   const token=prompt('Enter your OMH Vercel dashboard access token (not your provider API key):');
   if(!token)throw Error('Dashboard access token required');
   webToken=token;
 }
 const response=await fetch(url,{...options,headers:{...options.headers,Authorization:'Bearer '+webToken}});
 if(response.status===401){
   webToken=undefined;
   throw Error('Dashboard token rejected. Select Refresh to try again.');
 }
 return response;
}


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

function sectionButton(section) {
  const button = el('button');
  button.type = 'button';
  button.dataset.section = section;
  button.append(icon(sectionIcons[section]), el('span', sections[section]));
  return button;
}

function activityTabButton(view) {
  const button = el('button');
  button.type = 'button';
  button.dataset.activityView = view;
  button.setAttribute('role', 'tab');
  button.append(icon(view), el('span', activityViews[view]));
  return button;
}

const time = value => value ? new Date(value).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '';
const date = value => value ? new Date(value).toLocaleString() : '';
const title = word => word ? word[0].toUpperCase() + word.slice(1) : '';
const row = (name, status, detail, id) => ({name, status, detail, id});
const taskCount = () => state ? Object.values(state.counts).reduce((sum, count) => sum + count, 0) : 0;

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
    case 'skills': return state.skills.map(s => ({...row(s.name, title(s.status), date(s.createdAt), s.id), governanceAction: s.status === 'pending' ? 'reject' : null, adminAction: state.adminActionsAvailable && s.status === 'pending' ? 'accept' : null}));
    case 'plugins': return state.plugins.map(p => ({...row(p.name, p.enabled ? 'Enabled' : 'Disabled', 'Version ' + p.version, p.name), governanceAction: p.enabled ? 'disable' : null, adminAction: state.adminActionsAvailable && !p.enabled ? 'enable' : null}));
    case 'schedules': return state.schedules.map(s => ({...row(s.kind, s.enabled ? 'Enabled' : 'Disabled', 'Every ' + s.everyMs / 1000 + ' s · Next ' + date(s.nextAt), s.id), governanceAction: s.enabled ? 'pause' : null, adminAction: state.adminActionsAvailable && !s.enabled ? 'resume' : null}));
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
    const labels={pause:'Pause schedule',disable:'Disable plugin',reject:'Reject proposal',
      resume:'Resume schedule (admin)',enable:'Enable plugin (admin)',accept:'Accept proposal (admin)'};
    for(const action of [r.governanceAction,r.adminAction].filter(Boolean)){
      const control=el('button',labels[action],'task-action');
      control.type='button';control.dataset.action=action;
      control.dataset.taskId=r.id;control.disabled=actionBusy;
      control.setAttribute('aria-label',labels[action]+' '+r.name);
      item.append(control);
    }
    list.append(item);
  }
  container.append(list);
}

function statusCard(label, value, detail, tone) {
  const card = el('div', undefined, 'status-card' + (tone ? ' ' + tone : ''));
  card.append(el('span', label, 'label'));
  card.append(el('div', value, 'value'));
  if (detail) card.append(el('div', detail, 'detail'));
  return card;
}

function renderStatusCards() {
  const container = $('#status-cards');
  container.replaceChildren();
  if (!state) {
    container.append(
      statusCard('Harness', 'Offline', remote ? 'No live harness reachable from Vercel.' : 'No local harness responding.', 'offline'),
      statusCard('Worker', 'Unknown', 'Start the harness to see worker status.'),
      statusCard('Agents', '—', 'No roles loaded.'),
      statusCard('Tasks', '—', 'No tasks recorded.'),
    );
    return;
  }
  const counts = Object.entries(state.counts).filter(([, count]) => count > 0)
    .map(([status, count]) => count + ' ' + status).join(' · ') || 'No tasks';
  container.append(
    statusCard('Harness', 'Online', (state.platform?.os || 'unknown OS') + '/' + (state.platform?.arch || 'unknown') + ' · Node ' + (state.platform?.node || '?'), 'online'),
    statusCard('Worker', state.worker?.online ? 'Online' : 'Offline', state.worker?.online ? 'Daemon heartbeat current.' : 'Daemon heartbeat missing.', state.worker?.online ? 'online' : 'offline'),
    statusCard('Agents', String(state.agents.length) + ' roles', state.agents.filter(a => a.running).length + ' running · ' + state.agents.filter(a => a.queued).length + ' queued'),
    statusCard('Tasks', String(taskCount()), counts + (refreshed ? ' · Updated ' + time(refreshed) : '')),
  );
}

function renderOfflineCard() {
  const card = $('#offline-card');
  card.hidden = Boolean(state);
  if (state) return;
  const steps = $('#offline-steps');
  steps.replaceChildren();
  const step = (heading, body) => {
    const div = el('div', undefined, 'offline-step');
    div.append(el('b', heading));
    const p = el('p');
    p.textContent = body;
    div.append(p);
    steps.append(div);
  };
  if (remote) {
    step('1 · Start a Linux harness', 'On the machine that runs the harness, start the live gateway and the dashboard daemon so Vercel has something to connect to.');
    step('2 · Check the Vercel settings', 'The Vercel project needs OMH_LIVE_URL (the public tunnel to the harness), OMH_LIVE_TOKEN, and OMH_WEB_ACCESS_TOKEN set as environment variables, then a redeploy.');
    step('3 · Refresh this page', 'Once the harness is running and the settings are set, Refresh here and the status cards should turn green.');
  } else {
    step('1 · Start the harness', 'Run the runtime dashboard on this machine, then Refresh. The dashboard reads live state from the local harness.');
    step('2 · Check the port', 'If the dashboard itself loaded but state did not, the harness daemon may not be running. Restart it and try again.');
  }
}

function renderProviders() {
  const target = $('#provider-list');
  const note = $('#providers-note');
  if (!state || !state.providers) {
    target.textContent = remote
      ? 'Provider list is unavailable while the harness is offline.'
      : 'Provider list is unavailable while the harness is offline.';
    note.textContent = '';
    return;
  }
  note.textContent = state.providers.filter(p => p.status === 'configured').length + ' of ' + state.providers.length + ' configured';
  target.replaceChildren();
  for (const provider of state.providers) {
    const line = el('div', undefined, 'provider-row');
    line.append(el('strong', provider.id));
    const status = el('span', provider.status === 'configured' ? 'Configured' : 'Not configured', 'status');
    line.append(status);
    if (!remote) {
      const button = el('button', 'Verify');
      button.type = 'button';
      button.disabled = provider.status !== 'configured' || provider.id === 'custom';
      button.addEventListener('click', async () => {
        button.disabled = true;
        status.textContent = 'Verifying…';
        try {
          if (!csrf) {
            const session = await runtimeFetch('/api/session');
            if (!session.ok) throw Error('Session unavailable');
            csrf = (await session.json()).csrf;
          }
          if (!adminToken) adminToken = prompt('Enter local dashboard administrator token:') || undefined;
          if (!adminToken) throw Error('Administrator token required');
          const result = await runtimeFetch('/api/connectors/verify', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-OMH-CSRF': csrf, 'X-OMH-Admin-Token': adminToken}, body: JSON.stringify({id: provider.id})});
          if (!result.ok) throw Error(result.status === 403 ? 'Not authorized' : 'Verification request failed');
          status.textContent = (await result.json()).status;
        } catch (e) { status.textContent = e.message; } finally { button.disabled = false; }
      });
      line.append(button);
    }
    target.append(line);
  }
  if (remote) {
    const hint = el('p', 'Verification runs on the local harness only. This page shows which providers are configured; it never sees your keys.', 'empty');
    target.append(hint);
  }
}

function renderSettings() {
  renderProviders();
  showRows($('#plugin-list'), records('plugins'), 'No plugins registered.');
  showRows($('#schedule-list'), records('schedules'), 'No schedules configured.');
  showRows($('#skill-list'), records('skills'), 'No skill proposals.');
  $('#plugins-note').textContent = state ? state.plugins.filter(p => p.enabled).length + ' of ' + state.plugins.length + ' enabled' : '';
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
  const keys = query.scope === 'all' ? Object.keys(activityViews) : [query.scope];
  const rows = keys.flatMap(key => records(key)
    .filter(r => [r.name, r.status, r.detail, r.id].some(s => s?.toLowerCase().includes(query.term)))
    .map(r => ({...r, detail: [activityViews[key] || views[key], r.detail].filter(Boolean).join(' · ')})));
  showRows($('#matches'), rows, 'No matching runtime records.');
}

function renderActivity() {
  for (const button of document.querySelectorAll('[data-activity-view]')) {
    const selected = button.dataset.activityView === activityView;
    button.setAttribute('aria-selected', selected);
    button.tabIndex = selected ? 0 : -1;
  }
  $('#view-heading').textContent = activityViews[activityView];
  $('#filter-label').hidden = !filterable.has(activityView);
  const rows = records(activityView).filter(r => !filterable.has(activityView) || $('#filter').value === 'all' || r.queueStatus === $('#filter').value);
  showRows($('#activity'), rows, state ? 'No records match this view.' : 'No records — the harness is offline.');
  renderSearch();
}

function renderSection() {
  $('#view-overview').hidden = active !== 'overview';
  $('#view-activity').hidden = active !== 'activity';
  $('#view-settings').hidden = active !== 'settings';
  for (const button of document.querySelectorAll('[data-section]')) {
    button.setAttribute('aria-pressed', button.dataset.section === active);
  }
  toggleMenu(false);
  if (active === 'activity') renderActivity();
  if (active === 'settings') renderSettings();
  renderDock();
}

function renderFeeds() {
  $('#agent-count').textContent = state ? state.agents.length : '';
  $('#task-count').textContent = state ? taskCount() : '';
  $('#health-detail').textContent = state
    ? state.agents.length + ' roles · ' + taskCount() + ' tasks · Worker ' + (state.worker?.online ? 'online' : 'offline') + ' · ' + (state.platform?.os || 'unknown OS') + '/' + (state.platform?.arch || 'unknown')
    : 'No live data — the harness is offline.';
  const feeds = [
    ['#agent-feed', state ? records('agents').map(r => row(title(r.name), r.status)) : []],
    ['#task-feed', state ? records('tasks').slice(0, 4) : []],
    ['#trace-feed', state ? state.traces.slice(0, 4).map(t => row(t.type, time(t.at))) : []],
  ];
  for (const [selector, rows] of feeds) {
    const feed = $(selector);
    feed.replaceChildren();
    if (!rows.length) feed.append(el('p', state ? 'No activity recorded.' : 'No activity — the harness is offline.', 'empty'));
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
  const button = event.target.closest('[data-section]');
  if (!button) return;
  active = button.dataset.section;
  renderSection();
});
document.addEventListener('click', event => {
  const button = event.target.closest('[data-activity-view]');
  if (!button) return;
  activityView = button.dataset.activityView;
  $('#filter').value = 'all';
  renderActivity();
  $('#view-heading').focus({preventScroll: true});
});
document.addEventListener('click', async event => {
  const button=event.target.closest('button[data-action][data-task-id]');
  if(!button || actionBusy)return;
  const action=button.dataset.action;
  if(!['cancel','retry','pause','disable','reject','resume','enable','accept'].includes(action))return;
  const confirmations={
    cancel:'Cancel this queued task?',
    retry:'Retry this failed read-only task?',
    pause:'Pause this schedule? Already queued tasks will not be cancelled.',
    disable:'Disable this plugin?',
    reject:'Reject this skill proposal?',
    resume:'Resume this schedule with a new next-run time?',
    enable:'Enable this plugin manifest?',
    accept:'Accept and publish this skill proposal?'
  };
  if(!confirm(confirmations[action]))return;
  const privileged=['resume','enable','accept'].includes(action);
  if(privileged&&!adminToken){
    adminToken=prompt('Enter the administrator token configured for this local OMH dashboard:') || undefined;
    if(!adminToken)return;
  }
  actionBusy=true;
  button.disabled=true;
  try {
    if(!remote&&!csrf){
      const session=await fetch('/api/session',{signal:AbortSignal.timeout(10000)});
      if(!session.ok)throw Error('Dashboard session unavailable');
      csrf=(await session.json()).csrf;
    }
    const endpoint={
      cancel:'/api/tasks/cancel',retry:'/api/tasks/retry',
      pause:'/api/schedules/pause',disable:'/api/plugins/disable',reject:'/api/skills/reject',
      resume:'/api/schedules/resume',enable:'/api/plugins/enable',accept:'/api/skills/accept'
    }[action];
    const payload=['disable','enable'].includes(action)?{name:button.dataset.taskId}:{id:button.dataset.taskId};
    const response=await runtimeFetch(remote?'/api/actions':endpoint,{
      method:'POST',
      headers:remote?{'Content-Type':'application/json'}:{'Content-Type':'application/json','X-OMH-CSRF':csrf,...(privileged?{'X-OMH-Admin-Token':adminToken}:{})},
      body:JSON.stringify(remote?{action,...payload}:payload),
      signal:AbortSignal.timeout(10000),
    });
    if(!response.ok){if(privileged&&response.status===403)adminToken=undefined;throw Error((await response.text()).slice(0,160));}
    // Re-enable actions before rebuilding the records; otherwise the new
    // buttons inherit the busy state and stay disabled after the old node
    // is detached from the DOM.
    actionBusy=false;
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
for (const section of Object.keys(sections)) {
  $('#rail-sections').append(sectionButton(section));
  $('#bottomnav').append(sectionButton(section));
}
for (const view of Object.keys(activityViews)) {
  $('#activity-tabs').append(activityTabButton(view));
  $('#scope').add(new Option(activityViews[view], view));
}
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
$('#filter').onchange = renderActivity;
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
    const response = await runtimeFetch('/api/state', {signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw Error('State unavailable');
    state = await response.json();
    refreshed = Date.now();
    renderStatusCards();
    renderOfflineCard();
    renderFeeds();
    renderSection();
    $('#connection').textContent = 'Connected';
    $('#health-title').textContent = 'Harness online';
    document.body.dataset.online = 'true';
    $('#error').hidden = true;
  } catch (error) {
    $('#connection').textContent = 'Offline';
    $('#health-title').textContent = 'Harness offline';
    document.body.dataset.online = 'false';
    renderStatusCards();
    renderOfflineCard();
    renderFeeds();
    renderSection();
    $('#error').textContent = remote ? ('Remote runtime unavailable: '+error.message) : (state ? 'Refresh failed. Showing the last snapshot. Use Refresh to retry.' : 'Runtime state unavailable. Use Refresh to retry.');
    $('#error').hidden = false;
  } finally {
    $('#refresh').disabled = false;
  }
}
$('#refresh').onclick = load;
renderStatusCards();
renderOfflineCard();
renderFeeds();
renderSection();
load();
