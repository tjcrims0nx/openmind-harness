const heading = document.querySelector('#activity-heading');
const activity = document.querySelector('#activity');
const counts = document.querySelector('#counts');
const filter = document.querySelector('#filter');
const filterLabel = document.querySelector('#filter-label');
const refresh = document.querySelector('#refresh');
const views = [...document.querySelectorAll('[data-view]')];
const connection = document.querySelector('#connection');
const updated = document.querySelector('#updated');
const error = document.querySelector('#error');

let state;
let active = 'tasks';
let refreshing = false;
const labels = {
  queued: 'Queued', running: 'Running', completed: 'Completed',
  failed: 'Failed', cancelled: 'Cancelled',
};
const formatDate = value => value ? new Date(value).toLocaleString() : '';
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
};

function list(rows, empty, title) {
  if (title) activity.append(element('h3', title, 'group-title'));
  if (!rows.length) {
    activity.append(element('p', empty, 'empty'));
    return;
  }
  const items = element('ul', '', 'items');
  for (const {name, status, detail, kind = ''} of rows) {
    const row = element('li', '', 'activity-row');
    row.append(element('strong', name));
    if (status) row.append(element('span', status, `status ${kind}`));
    if (detail) row.append(element('p', detail));
    items.append(row);
  }
  activity.append(items);
}

function render() {
  if (!state) return;
  counts.replaceChildren(...Object.entries(labels).map(([key, label]) => {
    const card = element('div', '', 'count');
    card.append(element('span', label), element('strong', state.counts[key]));
    return card;
  }));
  activity.replaceChildren();
  heading.textContent = views.find(button => button.dataset.view === active).textContent;
  filterLabel.hidden = active !== 'tasks' && active !== 'sandbox';
  if (active === 'tasks' || active === 'sandbox') {
    const rows = state[active].filter(task => filter.value === 'all' || task.status === filter.value);
    list(rows.map(task => ({
      name: task.kind,
      status: task.blocked ? 'Blocked' : task.status === 'running' && task.cancelRequestedAt ?
        'Cancellation requested' : labels[task.status],
      kind: task.status,
      detail: [task.id, `${task.attempts || 0} attempts`, formatDate(task.finishedAt || task.createdAt)]
        .filter(Boolean).join(' · '),
    })), 'No tasks match this view.');
  } else if (active === 'agents') {
    list(state.agents.map(agent => ({
      name: agent.name, status: `${agent.running} running`, detail: `${agent.queued} queued`,
    })), 'No agents available.', 'Agent tasks');
    list(state.workspaces.map(name => ({name})), 'No agent workspaces.', 'Workspaces');
  } else if (active === 'schedules') {
    list(state.schedules.map(job => ({
      name: job.kind,
      status: job.enabled ? 'Enabled' : 'Disabled',
      detail: job.enabled ? `Next run ${formatDate(job.nextAt)} · Every ${job.everyMs / 60000} min` : job.id,
    })), 'No schedules configured.');
  } else if (active === 'memory') {
    list(state.memory.map(note => ({
      name: note.title, status: note.scope, detail: formatDate(note.createdAt),
    })), 'No saved memory entries.');
  } else {
    list(state.traces.map(trace => ({
      name: trace.type, status: trace.status,
      detail: [formatDate(trace.at), trace.kind, trace.id].filter(Boolean).join(' · '),
    })), 'No trace events recorded.');
  }
}

async function load() {
  if (refreshing) return;
  refreshing = true;
  refresh.disabled = true;
  try {
    const response = await fetch('/api/state');
    if (!response.ok) throw new Error('State unavailable');
    state = await response.json();
    render();
    connection.textContent = 'Connected';
    connection.dataset.connected = 'true';
    updated.textContent = `Last updated ${new Date().toLocaleTimeString()}`;
    error.hidden = true;
  } catch {
    connection.textContent = 'Unavailable';
    connection.dataset.connected = 'false';
    error.textContent = 'Could not read runtime state. Check that the dashboard is running, then retry.';
    error.hidden = false;
  } finally {
    refreshing = false;
    refresh.disabled = false;
  }
}

for (const button of views) {
  button.addEventListener('click', () => {
    active = button.dataset.view;
    for (const view of views) view.setAttribute('aria-pressed', String(view === button));
    render();
  });
}
filter.addEventListener('change', render);
refresh.addEventListener('click', load);
load();
