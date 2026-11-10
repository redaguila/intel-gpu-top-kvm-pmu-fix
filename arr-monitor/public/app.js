// arr monitor – single page app (no build step, no dependencies).

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');

const state = {
  types: [],
  typeMap: {},
  services: [],
  status: {}, // service id -> status object
  timers: [],
  renderToken: 0,
};

/* ---------------------------------------------------------------- helpers */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`api/${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function fmtBytes(n, digits = 1) {
  n = Number(n) || 0;
  if (n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i < 2 ? 0 : digits)} ${u[i]}`;
}
const fmtSpeed = (n) => `${fmtBytes(n)}/s`;
function fmtEta(s) {
  if (s === null || s === undefined || !Number.isFinite(Number(s))) return '';
  s = Math.round(Number(s));
  if (s <= 0) return '';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}
function fmtRelative(date) {
  if (!date) return '';
  const t = new Date(date).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = (t - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(date).toLocaleDateString();
}
function dayLabel(date) {
  const d = new Date(date);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((that - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
const timeOf = (date) => new Date(date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const initials = (name) => String(name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
const badge = (svcOrType, color) => {
  const name = svcOrType?.name || svcOrType;
  const c = color || svcOrType?.color || state.typeMap[svcOrType?.type]?.color;
  return `<span class="svc-badge" style="--c:${esc(c)}">${esc(initials(state.typeMap[svcOrType?.type]?.name || name))}</span>`;
};

function posterSrc(serviceId, poster) {
  if (!poster) return '';
  if (typeof poster === 'object' && poster.local) return `api/services/${encodeURIComponent(serviceId)}/image?path=${encodeURIComponent(poster.local)}`;
  return /^https?:\/\//i.test(poster) ? poster : '';
}

function toast(message, isError = false) {
  const el = document.createElement('div');
  el.className = `toast${isError ? ' err' : ''}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), isError ? 6000 : 3000);
}

function every(ms, fn) {
  const id = setInterval(() => { if (!document.hidden) fn(); }, ms);
  state.timers.push(id);
}
function clearTimers() { state.timers.forEach(clearInterval); state.timers = []; }

const svg = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'),
  resume: svg('<path d="M7 4.5v15l12-7.5z"/>'),
  delete: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  remove: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  blocklist: svg('<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>'),
};
const fmtVersion = (v) => String(v ?? '?').replace(/^v/i, '');

const loading = (text = 'Loading…') => `<div class="loading"><span class="spinner"></span>${esc(text)}</div>`;
const errorBox = (err) => `<div class="error-box">${esc(err?.message || err)}</div>`;
const empty = (text) => `<div class="empty">${esc(text)}</div>`;

/* ---------------------------------------------------------------- modal */

const modal = $('#modal');
function openModal(html) {
  $('#modal-body').innerHTML = html;
  if (!modal.open) modal.showModal();
  $('#modal-body').querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => modal.close()));
  return $('#modal-body');
}
modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });

function confirmDialog(title, message, okLabel = 'Confirm', danger = true) {
  return new Promise((resolve) => {
    const body = openModal(`
      <div class="modal-h"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">✕</button></div>
      <div class="modal-b">${message}</div>
      <div class="modal-f"><button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="confirm-ok">${esc(okLabel)}</button></div>`);
    let result = false;
    $('#confirm-ok', body).addEventListener('click', () => { result = true; modal.close(); });
    modal.addEventListener('close', () => resolve(result), { once: true });
  });
}

async function runAction(serviceId, action, payload = {}, successMsg) {
  try {
    const r = await api(`services/${encodeURIComponent(serviceId)}/a/${action}`, { method: 'POST', body: payload });
    toast(successMsg || 'Done');
    return r;
  } catch (err) {
    toast(err.message, true);
    throw err;
  }
}

/* ---------------------------------------------------------------- shell */

function setTitle(html, right = '') {
  $('#page-title').innerHTML = html;
  $('#topbar-right').innerHTML = right;
  document.title = `${$('#page-title').textContent.trim()} · arr monitor`;
}

function renderNav() {
  const route = location.hash || '#/';
  $('#nav-services').innerHTML = state.services.length
    ? state.services.map((s) => {
      const st = state.status[s.id];
      const dot = s.enabled === false ? '' : `<span class="dot ${st ? (st.online ? 'ok' : 'err') : ''}" title="${esc(st ? (st.online ? `Online · v${fmtVersion(st.version)}` : st.error) : 'Checking…')}"></span>`;
      return `<a class="nav-item${route.startsWith(`#/s/${s.id}`) ? ' active' : ''}" href="#/s/${esc(s.id)}">${badge(s)}<span style="overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</span>${dot}</a>`;
    }).join('')
    : '<div class="nav-item muted small">No services yet</div>';
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const n = a.dataset.nav;
    a.classList.toggle('active', (n === 'dashboard' && (route === '#/' || route === '')) || (n === 'settings' && route.startsWith('#/settings')));
  });
  const online = Object.values(state.status).filter((s) => s.online).length;
  $('#sidebar-foot').textContent = state.services.length ? `${online}/${state.services.filter((s) => s.enabled !== false).length} services online` : '';
}

async function refreshStatuses() {
  await Promise.all(state.services.filter((s) => s.enabled !== false).map(async (s) => {
    try { state.status[s.id] = await api(`services/${encodeURIComponent(s.id)}/status`); } catch (err) { state.status[s.id] = { online: false, error: err.message }; }
  }));
  renderNav();
}

async function loadServices() {
  state.services = await api('services');
  renderNav();
}

const sidebar = $('#sidebar');
const scrim = $('#scrim');
$('#menu-btn').addEventListener('click', () => { sidebar.classList.add('open'); scrim.classList.add('open'); });
scrim.addEventListener('click', () => { sidebar.classList.remove('open'); scrim.classList.remove('open'); });

/* ---------------------------------------------------------------- router */

async function route() {
  clearTimers();
  sidebar.classList.remove('open'); scrim.classList.remove('open');
  if (modal.open) modal.close();
  const token = ++state.renderToken;
  const hash = location.hash.replace(/^#/, '') || '/';
  const parts = hash.split('/').filter(Boolean).map(decodeURIComponent);
  renderNav();
  window.scrollTo(0, 0);
  try {
    if (parts[0] === 's' && parts[1]) await renderService(parts[1], parts[2], token);
    else if (parts[0] === 'settings') await renderSettings(parts[1], token);
    else await renderDashboard(token);
  } catch (err) {
    if (token === state.renderToken) view.innerHTML = errorBox(err);
  }
}
window.addEventListener('hashchange', route);

/* ---------------------------------------------------------------- shared row renderers */

function queueRow(item, serviceId, { showService = false } = {}) {
  const sid = item.serviceId || serviceId;
  const paused = /paus|stopp/i.test(item.status || '');
  const actionBtns = (item.actions || []).map((a) => {
    const label = { pause: 'Pause', resume: 'Resume', delete: 'Delete', remove: 'Remove from queue', blocklist: 'Remove and blocklist' }[a];
    if (!label) return '';
    return `<button class="icon-btn${['delete', 'remove', 'blocklist'].includes(a) ? ' danger' : ''}" title="${label}" aria-label="${label}" data-qa="${a}" data-sid="${esc(sid)}" data-id="${esc(item.id)}" data-title="${esc(item.title)}">${ICON[a]}</button>`;
  }).join('');
  const right = [
    item.speed ? `<div>↓ ${fmtSpeed(item.speed)}</div>` : '',
    item.uploadSpeed ? `<div>↑ ${fmtSpeed(item.uploadSpeed)}</div>` : '',
    item.eta ? `<div>${fmtEta(item.eta)}</div>` : '',
  ].join('');
  const sub = [
    showService ? esc(item.serviceName) : '',
    esc(item.status),
    item.size ? `${fmtBytes(item.size - (item.sizeLeft || 0))} / ${fmtBytes(item.size)}` : '',
    item.subtitle && item.subtitle !== item.title ? esc(item.subtitle) : '',
  ].filter(Boolean).join(' · ');
  return `<div class="row">
    ${showService ? badge({ type: item.serviceType, name: item.serviceName }, item.color) : ''}
    <div class="grow">
      <div class="title" title="${esc(item.release || item.title)}">${esc(item.title)}</div>
      <div class="sub">${item.countLabel ? `<span class="tag">${esc(item.countLabel)}</span> ` : ''}${sub}</div>
      ${item.warning ? `<div class="warning">⚠ ${esc(item.warning)}</div>` : ''}
      <div class="progress${paused ? ' paused' : ''}" style="--c:${esc(item.color || '')}"><i style="width:${Math.max(0, Math.min(100, item.progress || 0)).toFixed(1)}%"></i></div>
    </div>
    <div class="right"><div><b>${(item.progress || 0).toFixed(1)}%</b></div>${right}</div>
    <div class="actions">${actionBtns}</div>
  </div>`;
}

function bindQueueActions(root, onDone) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-qa]');
    if (!btn) return;
    const { qa, sid, id, title } = btn.dataset;
    const svc = state.services.find((s) => s.id === sid);
    const isTorrent = ['qbittorrent', 'transmission', 'deluge'].includes(svc?.type);
    let payload = { id };
    if (['delete', 'remove', 'blocklist'].includes(qa)) {
      const label = { delete: 'Delete download', remove: 'Remove from queue', blocklist: 'Remove & blocklist release' }[qa];
      const extra = isTorrent ? '<label class="check" style="margin-top:12px"><input type="checkbox" id="del-files"> Also delete downloaded files</label>' : '';
      if (!(await confirmDialog(label, `<p>${esc(title)}</p>${extra}`, label))) return;
      // The modal body is kept until the next dialog opens, so the checkbox can still be read.
      payload = { id, deleteFiles: !!$('#del-files')?.checked };
    }
    btn.disabled = true;
    const done = { pause: 'Paused', resume: 'Resumed', delete: 'Deleted', remove: 'Removed from queue', blocklist: 'Removed and blocklisted' }[qa];
    try { await runAction(sid, qa, payload, done); } catch { /* toast shown */ }
    onDone?.();
  });
}

function calendarList(items, serviceId, { showService = false } = {}) {
  if (!items.length) return empty('Nothing scheduled');
  let lastDay = '';
  return items.map((i) => {
    const day = dayLabel(i.date);
    const header = day !== lastDay ? `<div class="day-h">${esc(day)}</div>` : '';
    lastDay = day;
    const src = posterSrc(i.serviceId || serviceId, i.poster);
    const aired = new Date(i.date) < new Date();
    const tag = i.hasFile ? '<span class="tag ok">Downloaded</span>' : (aired ? '<span class="tag warn">Missing</span>' : '<span class="tag">Upcoming</span>');
    return `${header}<div class="row">
      ${src ? `<img class="thumb" loading="lazy" src="${esc(src)}" alt="" onerror="this.style.visibility='hidden'">` : (showService ? badge({ type: i.serviceType, name: i.serviceName }, i.color) : '')}
      <div class="grow"><div class="title">${esc(i.title)}</div><div class="sub">${showService ? `${esc(i.serviceName)} · ` : ''}${esc(i.subtitle || '')}</div></div>
      <div class="right"><div>${esc(timeOf(i.date))}</div><div style="margin-top:4px">${tag}</div></div>
    </div>`;
  }).join('');
}

function healthList(items, { showService = false } = {}) {
  if (!items.length) return empty('No issues 🎉');
  return items.map((h) => `<div class="row">
    <span class="tag ${h.type === 'error' ? 'err' : 'warn'}">${esc(h.type || 'warning')}</span>
    <div class="grow"><div class="title wrap">${esc(h.message)}</div>
    <div class="sub">${showService ? `${esc(h.serviceName)} · ` : ''}${esc(h.source || '')}</div></div>
    ${h.wikiUrl && /^https?:/.test(h.wikiUrl) ? `<a class="btn small" href="${esc(h.wikiUrl)}" target="_blank" rel="noopener">Wiki</a>` : ''}
  </div>`).join('');
}

/* ---------------------------------------------------------------- dashboard */

async function renderDashboard(token) {
  setTitle('Dashboard', '<button class="icon-btn" id="dash-refresh" title="Refresh">⟳</button>');
  if (!state.services.length) {
    view.innerHTML = `<div class="hero card">
      <img src="icon.svg" width="64" height="64" alt="">
      <h2>Welcome to arr monitor</h2>
      <p>Connect Sonarr, Radarr, Lidarr, Readarr, Prowlarr, Bazarr, your download clients (SABnzbd, NZBGet, qBittorrent, Transmission, Deluge), Overseerr/Jellyseerr and Tautulli to monitor everything from one place.</p>
      <a class="btn primary" href="#/settings/new">Add your first service</a>
    </div>`;
    return;
  }
  view.innerHTML = loading('Contacting your services…');
  const load = async () => {
    let d;
    try { d = await api('dashboard'); } catch (err) { if (token === state.renderToken) view.innerHTML = errorBox(err); return; }
    if (token !== state.renderToken) return;
    for (const s of d.services) state.status[s.id] = s.status;
    renderNav();
    drawDashboard(d, load);
  };
  $('#dash-refresh').addEventListener('click', load);
  await load();
  every(5000, load);
}

function drawDashboard(d, reload) {
  const t = d.totals;
  const downloads = d.services.filter((s) => s.category === 'download');
  const pausedClients = downloads.filter((s) => s.status.online && s.status.paused).length;
  const healthCount = d.health.length;
  const offline = d.services.filter((s) => !s.status.online);

  const svcCards = d.services.map((s) => {
    const st = s.status;
    let meta = st.online ? `v${esc(fmtVersion(st.version))}` : esc(st.error || 'Offline');
    if (st.online && s.category === 'download') meta = `${st.paused ? 'Paused' : `↓ ${fmtSpeed(st.downloadSpeed)}`}${st.uploadSpeed ? ` · ↑ ${fmtSpeed(st.uploadSpeed)}` : ''}`;
    if (st.online && st.counts) {
      const first = Object.entries(st.counts).find(([, v]) => v);
      if (first) meta += ` · ${esc(first[1])} ${esc(first[0].toLowerCase())}`;
    }
    return `<a class="svc-card" href="#/s/${esc(s.id)}" title="${st.online ? '' : esc(st.error)}">
      ${badge(s)}
      <div class="grow"><div class="name">${esc(s.name)}</div><div class="meta">${meta}</div></div>
      <span class="dot ${st.online ? 'ok' : 'err'}"></span></a>`;
  }).join('');

  const scroll = window.scrollY;
  view.innerHTML = `
    <div class="grid stats">
      <div class="card stat"><div class="label">Download</div><div class="value">${fmtSpeed(t.downloadSpeed)}</div><div class="sub">${pausedClients ? `${pausedClients} client(s) paused` : `${downloads.length} client(s)`}</div></div>
      <div class="card stat"><div class="label">Upload</div><div class="value">${fmtSpeed(t.uploadSpeed)}</div><div class="sub">torrent clients</div></div>
      <div class="card stat"><div class="label">Remaining</div><div class="value">${fmtBytes(t.sizeLeft)}</div><div class="sub">${d.queue.length} item(s) in queues</div></div>
      <div class="card stat"><div class="label">Services</div><div class="value">${t.online}/${t.total}</div><div class="sub">${offline.length ? `<span style="color:var(--err)">${offline.length} offline</span>` : 'all online'}${healthCount ? ` · <span style="color:var(--warn)">${healthCount} warning(s)</span>` : ''}</div></div>
    </div>
    <div class="card" style="margin-bottom:16px"><div class="card-b"><div class="svc-grid">${svcCards}</div></div></div>
    <div class="grid dash">
      <div class="col">
        <section class="card">
          <div class="card-h"><h2>Active downloads</h2><div class="right">
            ${downloads.length ? `<button class="btn small" id="pause-all">${ICON.pause} Pause all</button><button class="btn small" id="resume-all">${ICON.resume} Resume all</button>` : ''}
          </div></div>
          <div class="card-b list" id="dash-queue">${d.queue.length ? d.queue.slice(0, 40).map((i) => queueRow(i, null, { showService: true })).join('') : empty(downloads.length ? 'Nothing downloading' : 'Add a download client to see its queue')}</div>
        </section>
        ${healthCount ? `<section class="card"><div class="card-h"><h2>Health</h2><div class="right"><span class="tag warn">${healthCount}</span></div></div><div class="card-b list">${healthList(d.health, { showService: true })}</div></section>` : ''}
      </div>
      <div class="col">
        <section class="card">
          <div class="card-h"><h2>Upcoming</h2><div class="right muted small">next 7 days</div></div>
          <div class="card-b list">${calendarList(d.calendar.slice(0, 60), null, { showService: true })}</div>
        </section>
      </div>
    </div>`;
  window.scrollTo(0, scroll);
  bindQueueActions($('#dash-queue'), reload);
  const all = (action) => async () => {
    await Promise.allSettled(downloads.filter((s) => s.status.online && state.typeMap[s.type]?.globalActions.some((g) => g.id === action)).map((s) => api(`services/${encodeURIComponent(s.id)}/a/${action}`, { method: 'POST', body: {} })));
    toast(action === 'pauseAll' ? 'All clients paused' : 'All clients resumed');
    reload();
  };
  $('#pause-all')?.addEventListener('click', all('pauseAll'));
  $('#resume-all')?.addEventListener('click', all('resumeAll'));
}

/* ---------------------------------------------------------------- service page */

const TAB_LABELS = {
  queue: 'Queue', calendar: 'Calendar', library: 'Library', wanted: 'Wanted', history: 'History', health: 'Health',
  indexers: 'Indexers', search: 'Search', requests: 'Requests', activity: 'Activity',
};

async function renderService(id, tab, token) {
  const svc = state.services.find((s) => s.id === id);
  if (!svc) { setTitle('Not found'); view.innerHTML = empty('This service does not exist.'); return; }
  const type = state.typeMap[svc.type];
  tab = type.tabs.includes(tab) ? tab : type.tabs[0];

  const actions = type.globalActions.map((a) => `<button class="btn small" data-ga="${esc(a.id)}" data-confirm="${a.confirm ? 1 : ''}">${esc(a.label)}</button>`).join('');
  setTitle(`${badge(svc)} <span>${esc(svc.name)}</span>`, `
    ${type.canAdd ? `<button class="btn small primary" id="add-media" title="Add ${esc(type.mediaSingular)}">＋ <span class="btn-label">Add ${esc(type.mediaSingular)}</span></button>` : ''}
    <a class="btn small" href="${esc(type.webUrl || svc.url)}" target="_blank" rel="noopener" title="Open web UI">↗ <span class="btn-label">Open</span></a>`);


  const speedCtl = type.speedLimit ? `<div class="speed-ctl">
      <input class="input" id="speed-limit" type="text" inputmode="numeric" placeholder="${svc.type === 'sabnzbd' ? 'Limit %' : 'KB/s'}" title="${svc.type === 'sabnzbd' ? 'Percentage of max line speed (or e.g. 5M); empty = no limit' : 'Download limit in KB/s; 0 = unlimited'}">
      <button class="btn small" id="speed-set">Set limit</button></div>` : '';
  view.innerHTML = `
    <div class="card" style="margin-bottom:16px"><div class="card-b" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
      <div id="svc-status" style="flex:1;min-width:0">${loading('Checking status…')}</div>${speedCtl}</div>
      ${actions ? `<div class="card-b action-bar">${actions}</div>` : ''}</div>
    <div class="tabs" style="--c:${esc(type.color)}">${type.tabs.map((t) => `<a class="tab${t === tab ? ' active' : ''}" href="#/s/${esc(svc.id)}/${t}">${TAB_LABELS[t] || t}</a>`).join('')}</div>
    <div id="tab-body">${loading()}</div>`;

  document.querySelectorAll('[data-ga]').forEach((b) => b.addEventListener('click', async () => {
    const label = b.textContent;
    if (b.dataset.confirm && !(await confirmDialog(label, `<p>Run “${esc(label)}” on ${esc(svc.name)}?</p>`, 'Run', false))) return;
    b.disabled = true;
    try { await runAction(svc.id, b.dataset.ga, {}, `${label} started`); } catch { /* toast */ }
    b.disabled = false;
    loadStatus();
  }));
  $('#add-media')?.addEventListener('click', () => addMediaModal(svc, type));

  const loadStatus = async () => {
    let st;
    try { st = await api(`services/${encodeURIComponent(svc.id)}/status`); } catch (err) { st = { online: false, error: err.message }; }
    if (token !== state.renderToken) return;
    state.status[svc.id] = st;
    renderNav();
    $('#svc-status').innerHTML = statusLine(type, st);
  };
  bindSpeedLimit(svc, () => loadStatus());
  loadStatus();
  every(type.category === 'download' ? 4000 : 30000, loadStatus);

  const body = $('#tab-body');
  const renderer = TABS[tab];
  if (!renderer) { body.innerHTML = empty('Not supported'); return; }
  await renderer(svc, type, body, token);
}

function statusLine(type, st) {
  if (!st.online) return `<div style="display:flex;gap:10px;align-items:center"><span class="dot err"></span><div><b>Offline</b><div class="small" style="color:var(--err)">${esc(st.error)}</div></div></div>`;
  const items = [
    ['Status', `<span class="dot ok" style="display:inline-block;margin-right:6px"></span>Online`],
    ...(st.version ? [['Version', esc(fmtVersion(st.version))]] : []),
    ['Latency', `${esc(st.latency ?? '?')} ms`],
  ];
  if (type.category === 'download') {
    items.push(['Download', st.paused ? '<span class="tag warn">Paused</span>' : fmtSpeed(st.downloadSpeed)]);
    if (st.uploadSpeed !== null && st.uploadSpeed !== undefined) items.push(['Upload', fmtSpeed(st.uploadSpeed)]);
    if (st.sizeLeft) items.push(['Remaining', fmtBytes(st.sizeLeft)]);
    if (st.diskFree) items.push(['Free disk', fmtBytes(st.diskFree)]);
    if (st.speedLimit) items.push(['Limit', esc(st.speedLimit)]);
  }
  for (const [k, v] of Object.entries(st.counts || {})) items.push([esc(k), esc(v)]);
  for (const d of (st.disks || []).slice(0, 3)) items.push([esc(d.path), `${fmtBytes(d.free)} free`]);
  return `<div style="display:flex;flex-wrap:wrap;gap:18px 28px;align-items:center">
    ${items.map(([k, v]) => `<div><div class="muted small">${k}</div><div style="font-weight:600;margin-top:2px">${v}</div></div>`).join('')}</div>`;
}

function bindSpeedLimit(svc, after) {
  const btn = $('#speed-set');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const value = $('#speed-limit').value.trim();
    try { await runAction(svc.id, 'setSpeedLimit', { value }, value && value !== '0' ? `Speed limit set to ${value}` : 'Speed limit removed'); } catch { /* toast */ }
    after?.();
  });
}

const fetchResource = (svc, res, params = {}) => {
  const q = new URLSearchParams(params).toString();
  return api(`services/${encodeURIComponent(svc.id)}/r/${res}${q ? `?${q}` : ''}`);
};

async function simpleTab(svc, body, token, resource, renderFn, { poll, params } = {}) {
  const load = async (first) => {
    try {
      const items = await fetchResource(svc, resource, params);
      if (token !== state.renderToken) return;
      body.innerHTML = renderFn(items);
    } catch (err) {
      if (token !== state.renderToken) return;
      if (first || !body.querySelector('.row')) body.innerHTML = errorBox(err);
    }
  };
  await load(true);
  if (poll) every(poll, () => load(false));
  return load;
}

const TABS = {
  async queue(svc, type, body, token) {
    const wrap = document.createElement('div');
    body.innerHTML = '';
    body.appendChild(wrap);
    const reload = await simpleTab(svc, wrap, token, 'queue', (items) => {
      if (!items.length) return `<div class="card">${empty('Queue is empty')}</div>`;
      const active = items.filter((i) => !i.completed && !i.failed);
      const failed = items.filter((i) => i.failed);
      const done = items.filter((i) => i.completed);
      return `<div class="card"><div class="card-h"><h2>${active.length} active</h2><div class="right muted small">${fmtBytes(active.reduce((a, i) => a + (i.sizeLeft || 0), 0))} left</div></div>
        <div class="card-b list">${active.length ? active.map((i) => queueRow({ ...i, color: type.color }, svc.id)).join('') : empty('Nothing downloading')}</div></div>
        ${failed.length ? `<div class="card" style="margin-top:16px"><div class="card-h"><h2>Failed</h2><div class="right"><span class="tag err">${failed.length}</span></div></div>
        <div class="card-b list">${failed.map((i) => queueRow({ ...i, color: type.color }, svc.id)).join('')}</div></div>` : ''}
        ${done.length ? `<div class="card" style="margin-top:16px"><div class="card-h"><h2>Completed / seeding</h2><div class="right"><span class="tag">${done.length}</span></div></div>
        <div class="card-b list">${done.map((i) => queueRow({ ...i, color: type.color }, svc.id)).join('')}</div></div>` : ''}`;
    }, { poll: 3000 });
    bindQueueActions(wrap, reload);
  },

  async calendar(svc, type, body, token) {
    const start = new Date(Date.now() - 2 * 86400000);
    const end = new Date(Date.now() + 28 * 86400000);
    await simpleTab(svc, body, token, 'calendar', (items) => `<div class="card"><div class="card-b list">${calendarList(items, svc.id)}</div></div>`,
      { params: { start: start.toISOString(), end: end.toISOString() } });
  },

  async library(svc, type, body, token) {
    body.innerHTML = loading();
    let items;
    try { items = await fetchResource(svc, 'library'); } catch (err) { body.innerHTML = errorBox(err); return; }
    if (token !== state.renderToken) return;
    body.innerHTML = `<div class="toolbar">
        <input class="input grow" id="lib-q" type="search" placeholder="Filter ${items.length} ${esc(type.mediaLabel?.toLowerCase() || 'items')}…">
        <select class="input" id="lib-f"><option value="all">All</option><option value="monitored">Monitored</option><option value="unmonitored">Unmonitored</option><option value="missing">Missing files</option><option value="complete">Complete</option></select>
        <select class="input" id="lib-s"><option value="title">Title</option><option value="added">Recently added</option><option value="size">Size on disk</option><option value="year">Year</option></select>
      </div>
      <div class="muted small" id="lib-count" style="margin-bottom:10px"></div>
      <div class="posters" id="lib-grid" style="--c:${esc(type.color)}"></div>`;
    const draw = () => {
      const q = $('#lib-q').value.trim().toLowerCase();
      const f = $('#lib-f').value;
      const s = $('#lib-s').value;
      let list = items.filter((i) => !q || String(i.title).toLowerCase().includes(q));
      if (f === 'monitored') list = list.filter((i) => i.monitored);
      if (f === 'unmonitored') list = list.filter((i) => !i.monitored);
      if (f === 'missing') list = list.filter((i) => i.progress < 100);
      if (f === 'complete') list = list.filter((i) => i.progress >= 100);
      const sorters = {
        title: (a, b) => String(a.title).localeCompare(String(b.title)),
        added: (a, b) => new Date(b.added || 0) - new Date(a.added || 0),
        size: (a, b) => (b.sizeOnDisk || 0) - (a.sizeOnDisk || 0),
        year: (a, b) => (b.year || 0) - (a.year || 0),
      };
      list.sort(sorters[s]);
      const totalSize = list.reduce((a, i) => a + (i.sizeOnDisk || 0), 0);
      $('#lib-count').textContent = `${list.length} shown · ${fmtBytes(totalSize)} on disk`;
      const shown = list.slice(0, 400);
      $('#lib-grid').innerHTML = shown.length ? shown.map((i) => {
        const src = posterSrc(svc.id, i.poster);
        return `<button class="poster" data-lib="${esc(i.id)}">
          <div class="img"><span>${esc(i.title)}</span>${src ? `<img loading="lazy" src="${esc(src)}" alt="" onerror="this.remove()">` : ''}
            ${i.monitored ? '' : '<span class="tag unmon">unmonitored</span>'}
            <div class="pbar"><i style="width:${i.progress}%"></i></div></div>
          <div class="cap"><div class="t" title="${esc(i.title)}">${esc(i.title)}</div><div class="s">${esc([i.year, i.info].filter(Boolean).join(' · '))}</div></div>
        </button>`;
      }).join('') : empty('No matches');
    };
    ['input', 'change'].forEach((ev) => body.addEventListener(ev, (e) => { if (e.target.matches('#lib-q, #lib-f, #lib-s')) draw(); }));
    $('#lib-grid').addEventListener('click', (e) => {
      const card = e.target.closest('[data-lib]');
      if (!card) return;
      const item = items.find((i) => String(i.id) === card.dataset.lib);
      if (item) libraryDetail(svc, type, item);
    });
    draw();
  },

  async wanted(svc, type, body, token) {
    const isArr = type.category === 'arr';
    const load = await simpleTab(svc, body, token, 'wanted', (items) => {
      if (!items.length) return `<div class="card">${empty('Nothing missing 🎉')}</div>`;
      return `<div class="card"><div class="card-h"><h2>${items.length} missing</h2></div><div class="card-b list">${items.map((i) => `<div class="row">
        <div class="grow"><div class="title">${esc(i.title)}</div><div class="sub">${esc(i.subtitle || '')}${i.date ? ` · ${esc(new Date(i.date).toLocaleDateString())}` : ''}</div></div>
        ${(i.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}
        ${isArr ? `<button class="btn small" data-search="${esc(i.id)}">🔍 Search</button>` : ''}
      </div>`).join('')}</div></div>`;
    });
    body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-search]');
      if (!b) return;
      b.disabled = true;
      try { await runAction(svc.id, 'searchWanted', { id: b.dataset.search }, 'Search started'); } catch { /* toast */ }
    });
    return load;
  },

  async history(svc, type, body, token) {
    await simpleTab(svc, body, token, 'history', (items) => {
      if (!items.length) return `<div class="card">${empty('No history yet')}</div>`;
      return `<div class="card"><div class="card-b list">${items.map((i) => {
        const ev = String(i.event || '');
        const cls = /fail|error|delet|reject/i.test(ev) ? 'err' : /import|complet|grab|success|watched/i.test(ev) ? 'ok' : '';
        return `<div class="row">
          <span class="tag ${cls}" style="min-width:90px;text-align:center">${esc(ev.replace(/([a-z])([A-Z])/g, '$1 $2'))}</span>
          <div class="grow"><div class="title">${esc(i.title)}</div><div class="sub">${esc(i.subtitle && i.subtitle !== i.title ? i.subtitle : '')}${i.quality ? ` · ${esc(i.quality)}` : ''}</div>
          ${i.error ? `<div class="warning">⚠ ${esc(i.error)}</div>` : ''}</div>
          <div class="right" title="${esc(i.date ? new Date(i.date).toLocaleString() : '')}">${esc(fmtRelative(i.date))}</div>
        </div>`;
      }).join('')}</div></div>`;
    });
  },

  async health(svc, type, body, token) {
    await simpleTab(svc, body, token, 'health', (items) => `<div class="card"><div class="card-b list">${healthList(items)}</div></div>`);
  },

  async indexers(svc, type, body, token) {
    await simpleTab(svc, body, token, 'indexers', (items) => {
      if (!items.length) return `<div class="card">${empty('No indexers configured')}</div>`;
      return `<div class="card"><div class="card-h"><h2>${items.length} indexers</h2><div class="right">
        <span class="tag ok">${items.filter((i) => i.enabled && !i.failing).length} healthy</span>
        ${items.some((i) => i.failing) ? `<span class="tag err">${items.filter((i) => i.failing).length} failing</span>` : ''}</div></div>
        <div class="card-b list">${items.map((i) => `<div class="row">
          <span class="dot ${!i.enabled ? '' : i.failing ? 'err' : 'ok'}"></span>
          <div class="grow"><div class="title">${esc(i.title)}</div><div class="sub">${esc(i.info)}${i.disabledTill ? ` · disabled until ${esc(new Date(i.disabledTill).toLocaleString())}` : ''}</div></div>
          ${i.enabled ? '' : '<span class="tag">disabled</span>'}
        </div>`).join('')}</div></div>`;
    });
  },

  async search(svc, type, body) {
    body.innerHTML = `<form class="toolbar" id="s-form">
        <input class="input grow" id="s-q" type="search" placeholder="Search all indexers…" autofocus>
        <select class="input" id="s-cat">
          <option value="">All categories</option><option value="2000">Movies</option><option value="5000">TV</option>
          <option value="3000">Audio</option><option value="7000">Books</option><option value="4000">PC</option>
        </select>
        <button class="btn primary">Search</button>
      </form><div id="s-res"></div>`;
    let results = [];
    $('#s-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const term = $('#s-q').value.trim();
      if (!term) return;
      const out = $('#s-res');
      out.innerHTML = loading('Searching indexers… this can take a while');
      try {
        results = await fetchResource(svc, 'search', { term, ...($('#s-cat').value ? { categories: $('#s-cat').value } : {}) });
      } catch (err) { out.innerHTML = errorBox(err); return; }
      out.innerHTML = results.length ? `<div class="card table-wrap"><table>
        <thead><tr><th>Title</th><th>Indexer</th><th class="num">Size</th><th class="num">Peers</th><th class="num">Age</th><th></th></tr></thead>
        <tbody>${results.map((r, idx) => `<tr>
          <td class="t" title="${esc(r.title)}">${r.infoUrl && /^https?:/.test(r.infoUrl) ? `<a href="${esc(r.infoUrl)}" target="_blank" rel="noopener">${esc(r.title)}</a>` : esc(r.title)}<div class="muted small">${esc(r.categories)}</div></td>
          <td><span class="tag">${esc(r.protocol)}</span> ${esc(r.indexer)}</td>
          <td class="num">${fmtBytes(r.size)}</td>
          <td class="num">${r.seeders !== null ? `${esc(r.seeders)} / ${esc(r.leechers ?? 0)}` : (r.grabs !== null ? `${esc(r.grabs)} grabs` : '–')}</td>
          <td class="num">${r.age !== undefined ? `${esc(r.age)}d` : esc(fmtRelative(r.date))}</td>
          <td><button class="btn small" data-grab="${idx}">⬇ Grab</button></td></tr>`).join('')}</tbody></table></div>`
        : `<div class="card">${empty('No results')}</div>`;
    });
    body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-grab]');
      if (!b) return;
      const r = results[Number(b.dataset.grab)];
      b.disabled = true;
      try { await runAction(svc.id, 'grab', { guid: r.guid, indexerId: r.indexerId }, 'Sent to download client'); b.textContent = '✓ Sent'; } catch { b.disabled = false; }
    });
  },

  async requests(svc, type, body, token) {
    body.innerHTML = `<div class="toolbar"><select class="input" id="rq-f">
      ${['all', 'pending', 'approved', 'processing', 'available', 'failed'].map((f) => `<option value="${f}">${f[0].toUpperCase()}${f.slice(1)}</option>`).join('')}
      </select></div><div id="rq-list"></div>`;
    const list = $('#rq-list');
    const load = () => simpleTab(svc, list, token, 'requests', (items) => {
      if (!items.length) return `<div class="card">${empty('No requests')}</div>`;
      return `<div class="card"><div class="card-b list">${items.map((r) => {
        const cls = { Pending: 'warn', Approved: 'ok', Declined: 'err', Failed: 'err', Completed: 'ok' }[r.status] || '';
        return `<div class="row">
          ${r.poster ? `<img class="thumb" loading="lazy" src="${esc(r.poster)}" alt="" onerror="this.style.visibility='hidden'">` : ''}
          <div class="grow"><div class="title">${esc(r.title)} ${r.year ? `<span class="muted">(${esc(r.year)})</span>` : ''}</div>
            <div class="sub">${esc(r.mediaType === 'tv' ? 'TV' : 'Movie')}${r.seasons?.length ? ` · seasons ${esc(r.seasons.join(', '))}` : ''}${r.is4k ? ' · 4K' : ''} · ${esc(r.requestedBy || '?')} · ${esc(fmtRelative(r.date))}</div>
            <div style="margin-top:5px;display:flex;gap:5px"><span class="tag ${cls}">${esc(r.status)}</span>${r.mediaStatus ? `<span class="tag">${esc(r.mediaStatus)}</span>` : ''}</div></div>
          <div class="actions" style="gap:6px">${r.actions.includes('approve') ? `<button class="btn small" data-rq="approve" data-id="${esc(r.id)}">✓ Approve</button><button class="btn small danger" data-rq="decline" data-id="${esc(r.id)}">✕ Decline</button>` : ''}</div>
        </div>`;
      }).join('')}</div></div>`;
    }, { params: { filter: $('#rq-f').value } });
    $('#rq-f').addEventListener('change', load);
    list.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-rq]');
      if (!b) return;
      b.disabled = true;
      try { await runAction(svc.id, b.dataset.rq, { id: b.dataset.id }, b.dataset.rq === 'approve' ? 'Request approved' : 'Request declined'); } catch { /* toast */ }
      load();
    });
    await load();
  },

  async activity(svc, type, body, token) {
    await simpleTab(svc, body, token, 'activity', (items) => {
      if (!items.length) return `<div class="card">${empty('Nobody is watching right now')}</div>`;
      return `<div class="card"><div class="card-h"><h2>${items.length} stream(s)</h2></div><div class="card-b list">${items.map((s) => `<div class="row">
        <div class="grow"><div class="title">${esc(s.title)}</div><div class="sub">${esc(s.subtitle)}</div>
          <div class="progress${s.state === 'paused' ? ' paused' : ''}" style="--c:${esc(type.color)}"><i style="width:${s.progress}%"></i></div></div>
        <div class="right"><div><span class="tag ${s.decision === 'transcode' ? 'warn' : 'ok'}">${esc(s.decision || '')}</span></div><div style="margin-top:4px">${esc(s.quality || '')}</div><div>${esc(s.state || '')}</div></div>
      </div>`).join('')}</div></div>`;
    }, { poll: 5000 });
  },
};

function libraryDetail(svc, type, item) {
  const src = posterSrc(svc.id, item.poster);
  const body = openModal(`
    <div class="modal-h">${badge(svc)}<h3>${esc(item.title)}${item.year ? ` <span class="muted">(${esc(item.year)})</span>` : ''}</h3><button class="icon-btn" data-close aria-label="Close">✕</button></div>
    <div class="modal-b"><div class="detail">
      ${src ? `<img src="${esc(src)}" alt="">` : ''}
      <div style="min-width:0">
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <span class="tag ${item.monitored ? 'ok' : ''}">${item.monitored ? 'Monitored' : 'Unmonitored'}</span>
          ${item.status ? `<span class="tag">${esc(item.status)}</span>` : ''}
          ${item.network ? `<span class="tag">${esc(item.network)}</span>` : ''}
        </div>
        <p>${esc(item.overview || 'No overview available.')}</p>
        <div class="small muted">${esc(item.info)} · ${fmtBytes(item.sizeOnDisk)} on disk</div>
        <div class="progress" style="--c:${esc(type.color)}"><i style="width:${item.progress}%"></i></div>
      </div></div></div>
    <div class="modal-f"><button class="btn" data-close>Close</button><button class="btn primary" id="lib-search">🔍 Search now</button></div>`);
  $('#lib-search', body).addEventListener('click', async () => {
    try { await runAction(svc.id, 'searchItem', { id: item.id }, `Search started for ${item.title}`); modal.close(); } catch { /* toast */ }
  });
}

async function addMediaModal(svc, type) {
  const label = type.mediaSingular || 'item';
  const body = openModal(`
    <div class="modal-h">${badge(svc)}<h3>Add ${esc(label.toLowerCase())}</h3><button class="icon-btn" data-close aria-label="Close">✕</button></div>
    <div class="modal-b">
      <form class="toolbar" id="lk-form"><input class="input grow" id="lk-q" type="search" placeholder="Search for a ${esc(label.toLowerCase())}…" autofocus><button class="btn primary">Search</button></form>
      <div id="lk-res" class="list"></div>
    </div>`);
  let results = [];
  $('#lk-form', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const term = $('#lk-q', body).value.trim();
    if (!term) return;
    const out = $('#lk-res', body);
    out.innerHTML = loading('Searching…');
    try { results = await api(`services/${encodeURIComponent(svc.id)}/a/lookup`, { method: 'POST', body: { term } }); } catch (err) { out.innerHTML = errorBox(err); return; }
    out.innerHTML = results.length ? results.map((r, i) => `<div class="row">
      ${r.poster && /^https?:/.test(r.poster) ? `<img class="thumb" loading="lazy" src="${esc(r.poster)}" alt="" onerror="this.style.visibility='hidden'">` : '<div class="thumb"></div>'}
      <div class="grow"><div class="title">${esc(r.title)} ${r.year ? `<span class="muted">(${esc(r.year)})</span>` : ''}</div><div class="sub">${esc(r.extra || '')} ${esc((r.overview || '').slice(0, 140))}</div></div>
      ${r.exists ? '<span class="tag ok">In library</span>' : `<button class="btn small primary" data-pick="${i}">Add</button>`}
    </div>`).join('') : empty('No results');
  });
  $('#lk-res', body).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const item = results[Number(b.dataset.pick)];
    let opts;
    try { opts = await api(`services/${encodeURIComponent(svc.id)}/a/addOptions`, { method: 'POST', body: {} }); } catch (err) { toast(err.message, true); return; }
    const m = openModal(`
      <div class="modal-h">${badge(svc)}<h3>Add “${esc(item.title)}”</h3><button class="icon-btn" data-close aria-label="Close">✕</button></div>
      <div class="modal-b form">
        <div class="field"><label>Quality profile</label><select class="input" id="ad-qp">${opts.qualityProfiles.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
        ${opts.metadataProfiles.length ? `<div class="field"><label>Metadata profile</label><select class="input" id="ad-mp">${opts.metadataProfiles.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>` : ''}
        <div class="field"><label>Root folder</label><select class="input" id="ad-rf">${opts.rootFolders.map((r) => `<option value="${esc(r.path)}">${esc(r.path)} (${fmtBytes(r.freeSpace)} free)</option>`).join('')}</select></div>
        <label class="check"><input type="checkbox" id="ad-search" checked> Start searching immediately</label>
      </div>
      <div class="modal-f"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ad-go">Add</button></div>`);
    $('#ad-go', m).addEventListener('click', async () => {
      $('#ad-go', m).disabled = true;
      try {
        await runAction(svc.id, 'add', {
          item: item.raw,
          qualityProfileId: $('#ad-qp', m).value,
          rootFolderPath: $('#ad-rf', m).value,
          metadataProfileId: $('#ad-mp', m)?.value,
          search: $('#ad-search', m).checked,
        }, `${item.title} added`);
        modal.close();
      } catch { $('#ad-go', m).disabled = false; }
    });
  });
}

/* ---------------------------------------------------------------- settings */

const CATEGORY_LABELS = { arr: 'Media manager', download: 'Download client', indexer: 'Indexer manager', subtitles: 'Subtitles', requests: 'Requests', stats: 'Statistics' };

async function renderSettings(sub) {
  if (sub === 'new') return renderTypePicker();
  if (sub) {
    const [kind, value] = sub.split(':');
    if (kind === 'add') return renderServiceForm(null, value);
    return renderServiceForm(state.services.find((s) => s.id === sub));
  }
  setTitle('Settings', '<a class="btn small primary" href="#/settings/new">＋ Add service</a>');
  view.innerHTML = `<div class="card"><div class="card-h"><h2>Services</h2><div class="right muted small">${state.services.length} configured</div></div>
    <div class="card-b list">${state.services.length ? state.services.map((s, i) => {
      const st = state.status[s.id];
      return `<div class="row">
        ${badge(s)}
        <div class="grow"><div class="title">${esc(s.name)} ${s.enabled === false ? '<span class="tag">disabled</span>' : ''}</div>
        <div class="sub">${esc(state.typeMap[s.type]?.name)} · ${esc(s.url)}</div></div>
        ${s.enabled === false ? '' : `<span class="dot ${st ? (st.online ? 'ok' : 'err') : ''}" title="${esc(st?.error || '')}"></span>`}
        <div class="actions">
          <button class="icon-btn" data-move="${i}" data-dir="-1" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-btn" data-move="${i}" data-dir="1" title="Move down" ${i === state.services.length - 1 ? 'disabled' : ''}>↓</button>
          <a class="icon-btn" href="#/settings/${esc(s.id)}" title="Edit">✎</a>
          <button class="icon-btn danger" data-del="${esc(s.id)}" title="Delete">🗑</button>
        </div></div>`;
    }).join('') : empty('No services configured yet.')}</div></div>
    <div class="card" style="margin-top:16px"><div class="card-b small muted" style="line-height:1.6">
      API keys and passwords are stored only on the server (in <code>data/config.json</code>) and are never sent back to the browser.
      Protect this dashboard with the <code>AUTH_USERNAME</code> / <code>AUTH_PASSWORD</code> environment variables or a reverse proxy before exposing it outside your network.
    </div></div>`;

  view.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const s = state.services.find((x) => x.id === b.dataset.del);
    if (!(await confirmDialog('Delete service', `<p>Remove <b>${esc(s.name)}</b> from arr monitor? This does not touch the service itself.</p>`, 'Delete'))) return;
    await api(`services/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
    delete state.status[s.id];
    await loadServices();
    route();
  }));
  view.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', async () => {
    const i = Number(b.dataset.move);
    const j = i + Number(b.dataset.dir);
    const ids = state.services.map((s) => s.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api('services/order', { method: 'PUT', body: { ids } });
    await loadServices();
    route();
  }));
}

function renderTypePicker() {
  setTitle('Add service', '<a class="btn small" href="#/settings">Cancel</a>');
  const groups = {};
  for (const t of state.types) (groups[t.category] ||= []).push(t);
  view.innerHTML = Object.entries(groups).map(([cat, types]) => `
    <div class="card" style="margin-bottom:16px"><div class="card-h"><h2>${esc(CATEGORY_LABELS[cat] || cat)}</h2></div>
    <div class="card-b"><div class="type-grid">${types.map((t) => `
      <a class="type-opt" href="#/settings/add:${esc(t.type)}">${badge({ type: t.type, name: t.name }, t.color)}<div><div>${esc(t.name)}</div><div class="cat">:${esc(t.defaultPort)}</div></div></a>`).join('')}
    </div></div></div>`).join('');
}

function renderServiceForm(existing, typeName) {
  const type = state.typeMap[existing?.type || typeName];
  if (!type) { view.innerHTML = empty('Unknown service type'); return; }
  const v = existing || { name: type.name, enabled: true, showOnDashboard: true };
  setTitle(`${badge({ type: type.type, name: type.name }, type.color)} ${existing ? `Edit ${esc(existing.name)}` : `Add ${esc(type.name)}`}`, '<a class="btn small" href="#/settings">Cancel</a>');
  const fieldHtml = (f) => {
    const val = v[f.key] ?? (existing ? '' : f.default) ?? '';
    const isSecret = f.type === 'password';
    return `<div class="field"><label for="f-${esc(f.key)}">${esc(f.label)}${f.required ? ' *' : ''}</label>
      <input class="input" id="f-${esc(f.key)}" name="${esc(f.key)}" type="${isSecret ? 'password' : f.type === 'url' ? 'url' : 'text'}"
        value="${esc(val)}" placeholder="${esc(isSecret && existing && val ? '•••••••• (unchanged)' : f.placeholder || '')}"
        ${f.required && !(isSecret && existing) ? 'required' : ''} autocomplete="off" spellcheck="false">
      ${f.help ? `<div class="help">${esc(f.help)}</div>` : ''}</div>`;
  };
  view.innerHTML = `<form class="card" id="svc-form" style="max-width:640px"><div class="card-b form">
      <div class="field"><label for="f-name">Display name</label><input class="input" id="f-name" name="name" value="${esc(v.name)}" required maxlength="60"></div>
      ${type.fields.map(fieldHtml).join('')}
      <label class="check"><input type="checkbox" name="enabled" ${v.enabled !== false ? 'checked' : ''}> Enabled</label>
      <label class="check"><input type="checkbox" name="showOnDashboard" ${v.showOnDashboard !== false ? 'checked' : ''}> Show queue / calendar / health on dashboard</label>
      <div id="test-result"></div>
    </div>
    <div class="modal-f"><button type="button" class="btn" id="test-btn">Test connection</button><button class="btn primary">${existing ? 'Save' : 'Add service'}</button></div>
  </form>`;
  const form = $('#svc-form');
  // Secret inputs start empty in edit mode; empty means "keep the stored value".
  if (existing) for (const f of type.fields) if (f.type === 'password') form.elements[f.key].value = '';

  const collect = () => {
    const out = { type: type.type, name: form.elements.name.value.trim(), enabled: form.elements.enabled.checked, showOnDashboard: form.elements.showOnDashboard.checked };
    for (const f of type.fields) {
      const val = form.elements[f.key].value.trim();
      out[f.key] = f.type === 'password' && existing && !val ? '__unchanged__' : val;
    }
    return out;
  };

  $('#test-btn').addEventListener('click', async () => {
    const out = $('#test-result');
    out.innerHTML = loading('Testing…');
    try {
      const r = await api('services/test', { method: 'POST', body: { ...collect(), id: existing?.id } });
      out.innerHTML = r.ok
        ? `<div class="tag ok" style="padding:6px 10px">✓ Connected to ${esc(r.status.appName || type.name)}${r.status.version ? ` v${esc(fmtVersion(r.status.version))}` : ''}${r.status.account ? ` as ${esc(r.status.account)}` : ''} in ${esc(r.latency)} ms</div>`
        : errorBox(r.error);
    } catch (err) { out.innerHTML = errorBox(err); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const saved = existing
        ? await api(`services/${encodeURIComponent(existing.id)}`, { method: 'PUT', body: collect() })
        : await api('services', { method: 'POST', body: collect() });
      toast(existing ? 'Saved' : `${saved.name} added`);
      await loadServices();
      refreshStatuses();
      location.hash = `#/s/${saved.id}`;
    } catch (err) { $('#test-result').innerHTML = errorBox(err); }
  });
}

/* ---------------------------------------------------------------- boot */

(async function boot() {
  try {
    state.types = await api('types');
    state.typeMap = Object.fromEntries(state.types.map((t) => [t.type, t]));
    await loadServices();
  } catch (err) {
    view.innerHTML = errorBox(err);
    return;
  }
  route();
  refreshStatuses();
  // The dashboard refreshes statuses itself; elsewhere keep the sidebar dots fresh.
  setInterval(() => { if (!document.hidden && !['', '#', '#/'].includes(location.hash)) refreshStatuses(); }, 60000);
})();
