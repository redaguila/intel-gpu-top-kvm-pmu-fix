import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server/index.js';
import { createMockUpstream, API_KEY, USER, PASS } from './mock-upstream.js';
import { parseTimeLeft } from '../server/services/common.js';

let mock, app, base, upstream, dataDir;
const ids = {};

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

async function call(method, p, body) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
const get = (p) => call('GET', p).then((r) => { assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; });
const act = (id, action, body = {}) => call('POST', `/api/services/${id}/a/${action}`, body).then((r) => { assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; });

before(async () => {
  mock = createMockUpstream();
  upstream = `http://127.0.0.1:${await listen(mock)}`;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arr-monitor-test-'));
  app = createServer({ dataDir, auth: { username: '', password: '' } });
  base = `http://127.0.0.1:${await listen(app)}`;

  const services = [
    ['sonarr', { apiKey: API_KEY }], ['radarr', { apiKey: API_KEY }], ['lidarr', { apiKey: API_KEY }], ['readarr', { apiKey: API_KEY }],
    ['prowlarr', { apiKey: API_KEY }], ['bazarr', { apiKey: API_KEY }], ['sabnzbd', { apiKey: API_KEY }],
    ['nzbget', { username: USER, password: PASS }], ['qbittorrent', { username: USER, password: PASS }],
    ['transmission', { username: USER, password: PASS }], ['deluge', { password: PASS }],
    ['overseerr', { apiKey: API_KEY }], ['tautulli', { apiKey: API_KEY }],
    ['realdebrid', { apiKey: API_KEY }],
    // rdt-client is configured as a qBittorrent instance.
    ['qbittorrent', { username: USER, password: PASS }, 'rdtclient'],
  ];
  for (const [type, extra, path_ = type] of services) {
    const r = await call('POST', '/api/services', { type, name: path_, url: `${upstream}/${path_}`, ...extra });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    ids[path_] = r.data.id;
  }
});

after(() => {
  mock.close();
  app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('parseTimeLeft handles arr, SAB and .NET formats', () => {
  assert.equal(parseTimeLeft('00:04:12'), 252);
  assert.equal(parseTimeLeft('0:04:12'), 252);
  assert.equal(parseTimeLeft('1:02:10:00'), 86400 + 7800);
  assert.equal(parseTimeLeft('1.02:10:00'), 86400 + 7800);
  assert.equal(parseTimeLeft(''), null);
  assert.equal(parseTimeLeft('garbage'), null);
});

test('types endpoint lists every adapter', async () => {
  const types = await get('/api/types');
  const names = types.map((t) => t.type);
  for (const t of Object.keys(ids).filter((k) => k !== 'rdtclient')) assert.ok(names.includes(t), t);
});

test('secrets are never returned to the browser and survive updates', async () => {
  const list = await get('/api/services');
  const sonarr = list.find((s) => s.id === ids.sonarr);
  assert.equal(sonarr.apiKey, '__unchanged__');
  const qb = list.find((s) => s.id === ids.qbittorrent);
  assert.equal(qb.password, '__unchanged__');
  assert.equal(qb.username, USER);

  const r = await call('PUT', `/api/services/${ids.sonarr}`, { name: 'TV', apiKey: '__unchanged__', url: `${upstream}/sonarr/` });
  assert.equal(r.status, 200);
  assert.equal(r.data.name, 'TV');
  assert.equal(r.data.url, `${upstream}/sonarr`);
  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
  assert.equal(stored.services.find((s) => s.id === ids.sonarr).apiKey, API_KEY);
  const st = await get(`/api/services/${ids.sonarr}/status`);
  assert.equal(st.online, true);
});

test('validation rejects bad input', async () => {
  assert.equal((await call('POST', '/api/services', { type: 'nope', url: 'http://x' })).status, 400);
  assert.equal((await call('POST', '/api/services', { type: 'sonarr', url: 'ftp://x' })).status, 400);
  assert.equal((await call('GET', '/api/services/missing/status')).status, 404);
  const r = await fetch(`${base}/api/services`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'type=sonarr' });
  assert.equal(r.status, 415);
});

test('connection test reports success and failure', async () => {
  const ok = await call('POST', '/api/services/test', { type: 'radarr', url: `${upstream}/radarr`, apiKey: API_KEY });
  assert.equal(ok.data.ok, true);
  assert.equal(ok.data.status.version, '5.14.0.9383');
  const bad = await call('POST', '/api/services/test', { type: 'radarr', url: `${upstream}/radarr`, apiKey: 'wrong' });
  assert.equal(bad.data.ok, false);
  assert.match(bad.data.error, /401/);
  // Re-uses the stored secret when editing an existing service.
  const reuse = await call('POST', '/api/services/test', { id: ids.qbittorrent, type: 'qbittorrent', url: `${upstream}/qbittorrent`, username: USER, password: '__unchanged__' });
  assert.equal(reuse.data.ok, true, reuse.data.error);
});

test('every service reports online', async () => {
  for (const [type, id] of Object.entries(ids)) {
    const st = await get(`/api/services/${id}/status`);
    assert.equal(st.online, true, `${type}: ${st.error}`);
    // Real-Debrid has no version, and rdt-client doesn't expose one.
    if (!['realdebrid', 'rdtclient'].includes(type)) assert.ok(st.version, `${type} has a version`);
  }
});

test('sonarr queue, calendar, library, wanted, history and actions', async () => {
  const id = ids.sonarr;
  const queue = await get(`/api/services/${id}/r/queue`);
  // The three episode records of the season pack collapse into one row.
  assert.equal(queue.length, 3);
  assert.equal(queue[0].title, 'Better Call Saul S01');
  assert.equal(queue[0].count, 3);
  assert.equal(queue[0].id, '201,202,203');
  assert.equal(queue[0].size, 44130000000);
  assert.equal(queue[0].progress, 100);
  assert.equal(queue[0].countLabel, '3 episodes');
  assert.match(queue[0].subtitle, /^Better\.Call\.Saul\.S01/);
  assert.equal(queue[1].title, 'Night Signal S02E05');
  assert.equal(queue[1].eta, 252);
  assert.ok(queue[1].progress > 60 && queue[1].progress < 70);
  assert.match(queue[2].warning, /eligible for import/);

  const cal = await get(`/api/services/${id}/r/calendar`);
  assert.equal(cal.length, 3);
  assert.ok(new Date(cal[0].date) <= new Date(cal[1].date));

  const lib = await get(`/api/services/${id}/r/library`);
  assert.equal(lib[0].title, 'Copper Valley');
  assert.equal(lib.find((s) => s.title === 'Night Signal').info, '14/18 episodes');

  const wanted = await get(`/api/services/${id}/r/wanted`);
  assert.equal(wanted[0].subtitle.startsWith('S01E02'), true);

  const hist = await get(`/api/services/${id}/r/history`);
  assert.equal(hist[0].event, 'downloadFolderImported');

  await act(id, 'searchMissing');
  await act(id, 'searchItem', { id: 2 });
  await act(id, 'searchWanted', { id: 12 });
  await act(id, 'rssSync');
  const cmds = mock.state.commands.filter((c) => c.kind === 'sonarr');
  assert.deepEqual(cmds.map((c) => c.name), ['MissingEpisodeSearch', 'SeriesSearch', 'EpisodeSearch', 'RssSync']);
  assert.equal(cmds[1].seriesId, 2);
  assert.deepEqual(cmds[2].episodeIds, [12]);

  await act(id, 'blocklist', { id: 102 });
  const del = mock.state.log.find((l) => l.action === 'deleteQueue');
  assert.match(del.query, /blocklist=true/);
  assert.equal((await get(`/api/services/${id}/r/queue`)).length, 2);

  // Removing a grouped row removes every record of the pack in one bulk call.
  await act(id, 'remove', { id: '201,202,203' });
  const bulk = mock.state.log.find((l) => l.action === 'deleteQueueBulk');
  assert.deepEqual(bulk.ids, [201, 202, 203]);
  assert.match(bulk.query, /blocklist=false/);
  assert.equal((await get(`/api/services/${id}/r/queue`)).length, 1);
  assert.equal((await call('POST', `/api/services/${id}/a/remove`, { id: 'abc' })).status, 400);
});

test('sonarr lookup and add', async () => {
  const id = ids.sonarr;
  const results = await act(id, 'lookup', { term: 'Foo' });
  assert.equal(results[0].title, 'Foo (lookup)');
  assert.equal(results[0].exists, false);
  assert.equal(results[1].exists, true);
  const opts = await act(id, 'addOptions');
  assert.equal(opts.qualityProfiles[0].name, 'HD-1080p');
  assert.equal(opts.rootFolders[0].path, '/data/tv');
  const added = await act(id, 'add', { item: results[0].raw, qualityProfileId: '4', rootFolderPath: '/data/tv', search: false });
  assert.equal(added.ok, true);
  const body = mock.state.added[0].body;
  assert.equal(body.qualityProfileId, 4);
  assert.equal(body.rootFolderPath, '/data/tv');
  assert.equal(body.addOptions.searchForMissingEpisodes, false);
  assert.equal(body.tvdbId, 1234);
  assert.equal((await call('POST', `/api/services/${id}/a/add`, { item: results[0].raw })).status, 400);
});

test('radarr wanted falls back to library when endpoint is missing', async () => {
  const wanted = await get(`/api/services/${ids.radarr}/r/wanted`);
  assert.deepEqual(wanted.map((w) => w.title), ['Cloud Harbor']);
  const cal = await get(`/api/services/${ids.radarr}/r/calendar`);
  assert.equal(cal[0].subtitle.startsWith('Digital release'), true);
  const health = await get(`/api/services/${ids.radarr}/r/health`);
  assert.match(health[0].message, /NZBFinder/);
});

test('lidarr and readarr libraries', async () => {
  const artists = await get(`/api/services/${ids.lidarr}/r/library`);
  assert.equal(artists[0].info, '20/24 tracks');
  const authors = await get(`/api/services/${ids.readarr}/r/library`);
  assert.equal(authors[0].info, '3/5 books');
});

test('image proxy only serves images from the configured host', async () => {
  const ok = await fetch(`${base}/api/services/${ids.sonarr}/image?path=${encodeURIComponent('/sonarr/MediaCover/1/poster.jpg')}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/jpeg');
  const bad = await fetch(`${base}/api/services/${ids.sonarr}/image?path=${encodeURIComponent('//evil.example/x.jpg')}`);
  assert.equal(bad.status, 400);
});

test('sabnzbd queue and controls', async () => {
  const id = ids.sabnzbd;
  const st = await get(`/api/services/${id}/status`);
  assert.equal(st.downloadSpeed, 24576 * 1024);
  const q = await get(`/api/services/${id}/r/queue`);
  assert.equal(q[0].title, 'Night.Signal.S02E05.1080p.WEB-DL');
  assert.equal(q[0].eta, 252);
  assert.equal(q[1].eta, 86400 + 2 * 3600 + 600);
  await act(id, 'pause', { id: 'SABnzbd_nzo_1' });
  assert.equal((await get(`/api/services/${id}/r/queue`))[0].status, 'Paused');
  await act(id, 'pauseAll');
  assert.equal((await get(`/api/services/${id}/status`)).paused, true);
  await act(id, 'resumeAll');
  await act(id, 'setSpeedLimit', { value: '50' });
  assert.equal((await call('POST', `/api/services/${id}/a/setSpeedLimit`, { value: '50; rm -rf' })).status, 400);
  const hist = await get(`/api/services/${id}/r/history`);
  assert.equal(hist[1].error, 'Out of retention');
});

test('nzbget queue and controls', async () => {
  const id = ids.nzbget;
  const q = await get(`/api/services/${id}/r/queue`);
  assert.equal(q[0].title, 'Paper.Lanterns.2023.1080p');
  assert.ok(Math.abs(q[0].progress - 83.33) < 0.1);
  await act(id, 'pause', { id: 7 });
  assert.deepEqual(mock.state.log.find((l) => l.kind === 'nzbget').ids, [7]);
  await act(id, 'pauseAll');
  assert.equal((await get(`/api/services/${id}/status`)).paused, true);
});

test('qbittorrent login, queue and v5 stop/start fallback', async () => {
  const id = ids.qbittorrent;
  const q = await get(`/api/services/${id}/r/queue`);
  assert.equal(q.length, 2);
  assert.equal(q[0].status, 'Downloading');
  assert.equal(q[1].completed, true);
  await act(id, 'pause', { id: 'a'.repeat(40) });
  assert.equal((await get(`/api/services/${id}/r/queue`))[0].status, 'Paused');
  await act(id, 'resumeAll');
  assert.equal((await get(`/api/services/${id}/r/queue`))[0].status, 'Downloading');
  assert.equal((await call('POST', `/api/services/${id}/a/pause`, { id: 'not-a-hash' })).status, 400);
  await act(id, 'delete', { id: 'b'.repeat(40), deleteFiles: true });
  const del = mock.state.log.find((l) => l.kind === 'qbittorrent' && l.action === 'delete');
  assert.equal(del.deleteFiles, 'true');
});

test('qbittorrent wrong password reports a clear error', async () => {
  const r = await call('POST', '/api/services/test', { type: 'qbittorrent', url: `${upstream}/qbittorrent`, username: USER, password: 'nope' });
  assert.equal(r.data.ok, false);
  assert.match(r.data.error, /login failed/);
});

test('rdt-client works as a qBittorrent client', async () => {
  const id = ids.rdtclient;
  const st = await get(`/api/services/${id}/status`);
  assert.equal(st.online, true, st.error);
  assert.equal(st.version, null);
  assert.equal(st.downloadSpeed, 8e6); // per-torrent speeds win over transfer/info's 0 during the Real-Debrid phase
  assert.equal(st.uploadSpeed, 0);
  assert.equal(st.paused, false); // a finished "pausedUP" torrent does not make the client look paused
  const q = await get(`/api/services/${id}/r/queue`);
  assert.equal(q.find((t) => t.progress === 100).completed, true);
  const active = q.find((t) => t.progress === 75);
  assert.equal(active.speed, 8e6);
  assert.equal(active.uploadSpeed, 0); // mirrored upspeed is ignored
  await act(id, 'pause', { id: 'f'.repeat(40) });
  assert.equal(mock.state.log.find((l) => l.kind === 'rdtclient').action, 'pause');
});

test('real-debrid account, torrents, health and delete', async () => {
  const id = ids.realdebrid;
  const st = await get(`/api/services/${id}/status`);
  assert.equal(st.online, true, st.error);
  assert.equal(st.account, 'dan');
  assert.equal(st.counts['Premium days left'], 5);
  assert.equal(st.downloadSpeed, 50e6);
  const q = await get(`/api/services/${id}/r/queue`);
  assert.equal(q.length, 3);
  assert.equal(q[0].completed, true);
  assert.equal(q[1].status, 'Downloading');
  assert.equal(q[2].warning, 'Magnet error');
  const health = await get(`/api/services/${id}/r/health`);
  assert.ok(health.some((h) => /expires in 5 day/.test(h.message)));
  assert.ok(health.some((h) => /1 torrent\(s\) failed/.test(h.message)));
  const hist = await get(`/api/services/${id}/r/history`);
  assert.equal(hist[0].title, 'Better.Call.Saul.S01E01.mkv');
  await act(id, 'delete', { id: 'RDCCC3' });
  assert.equal((await get(`/api/services/${id}/r/queue`)).length, 2);
  assert.equal((await call('POST', `/api/services/${id}/a/delete`, { id: '../user' })).status, 400);
  const bad = await call('POST', '/api/services/test', { type: 'realdebrid', url: `${upstream}/realdebrid`, apiKey: 'nope' });
  assert.equal(bad.data.ok, false);
  assert.match(bad.data.error, /401/);
});

test('transmission session handshake and controls', async () => {
  const id = ids.transmission;
  const q = await get(`/api/services/${id}/r/queue`);
  assert.equal(q[0].status, 'Downloading');
  await act(id, 'pause', { id: 1 });
  assert.equal((await get(`/api/services/${id}/r/queue`))[0].status, 'Paused');
  await act(id, 'setSpeedLimit', { value: 500 });
  const set = mock.state.log.find((l) => l.kind === 'transmission' && l.action === 'session-set');
  assert.equal(set.args['speed-limit-down'], 500);
});

test('deluge login and queue', async () => {
  const q = await get(`/api/services/${ids.deluge}/r/queue`);
  assert.equal(q[0].progress, 50);
  await act(ids.deluge, 'pause', { id: 'd'.repeat(40) });
  assert.equal(mock.state.log.find((l) => l.kind === 'deluge').action, 'core.pause_torrent');
});

test('prowlarr indexers, search and grab', async () => {
  const id = ids.prowlarr;
  const idx = await get(`/api/services/${id}/r/indexers`);
  assert.equal(idx.find((i) => i.title === 'NZBFinder').failing, true);
  const res = await get(`/api/services/${id}/r/search?term=night%20signal`);
  assert.equal(res.length, 2);
  const torrent = res.find((r) => r.guid === 'g1');
  assert.equal(torrent.seeders, 120);
  await act(id, 'grab', { guid: torrent.guid, indexerId: torrent.indexerId });
  assert.deepEqual(mock.state.log.find((l) => l.action === 'grab').body, { guid: 'g1', indexerId: 2 });
});

test('bazarr wanted subtitles', async () => {
  const w = await get(`/api/services/${ids.bazarr}/r/wanted`);
  assert.equal(w.length, 2);
  assert.deepEqual(w[0].tags, ['en']);
  const st = await get(`/api/services/${ids.bazarr}/status`);
  assert.equal(st.counts['Wanted episodes'], 4);
});

test('overseerr requests with titles, approve and decline', async () => {
  const id = ids.overseerr;
  const r = await get(`/api/services/${id}/r/requests`);
  assert.equal(r[0].title, 'Fight Club');
  assert.equal(r[0].status, 'Pending');
  assert.deepEqual(r[0].actions, ['approve', 'decline']);
  assert.equal(r[1].title, 'Game of Thrones');
  await act(id, 'approve', { id: 1 });
  assert.equal((await get(`/api/services/${id}/r/requests`))[0].status, 'Approved');
});

test('tautulli activity', async () => {
  const a = await get(`/api/services/${ids.tautulli}/r/activity`);
  assert.equal(a.length, 2);
  assert.equal(a[1].decision, 'transcode');
  const st = await get(`/api/services/${ids.tautulli}/status`);
  assert.equal(st.counts.Streams, 2);
});

test('dashboard aggregates everything and survives an offline service', async () => {
  const off = await call('POST', '/api/services', { type: 'sonarr', name: 'Offline', url: 'http://127.0.0.1:1', apiKey: 'x' });
  const d = await get('/api/dashboard');
  assert.equal(d.totals.total, Object.keys(ids).length + 1);
  assert.equal(d.totals.online, Object.keys(ids).length);
  assert.equal(d.services.find((s) => s.id === off.data.id).status.online, false);
  assert.ok(d.totals.downloadSpeed > 0);
  assert.ok(d.queue.some((q) => q.serviceType === 'sabnzbd'));
  assert.ok(d.queue.some((q) => q.serviceType === 'transmission'));
  assert.ok(d.queue.every((q) => !q.completed));
  assert.ok(d.calendar.some((c) => c.serviceType === 'sonarr'));
  assert.ok(d.health.some((h) => h.serviceType === 'radarr'));
  await call('DELETE', `/api/services/${off.data.id}`);
});

test('reorder and delete services', async () => {
  const before_ = (await get('/api/services')).map((s) => s.id);
  const reversed = [...before_].reverse();
  await call('PUT', '/api/services/order', { ids: reversed });
  assert.deepEqual((await get('/api/services')).map((s) => s.id), reversed);
  await call('PUT', '/api/services/order', { ids: before_ });
});

test('static files are served and traversal is blocked', async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /arr monitor/);
  const spa = await fetch(`${base}/settings`);
  assert.equal(spa.status, 200);
  const trav = await fetch(`${base}/..%2f..%2fpackage.json`);
  assert.notEqual(trav.status, 200);
});

test('basic auth protects the app when configured', async () => {
  const secured = createServer({ dataDir, auth: { username: 'u', password: 'p' } });
  const port = await listen(secured);
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/services`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200);
    const ok = await fetch(`http://127.0.0.1:${port}/api/services`, { headers: { Authorization: `Basic ${Buffer.from('u:p').toString('base64')}` } });
    assert.equal(ok.status, 200);
    const bad = await fetch(`http://127.0.0.1:${port}/api/services`, { headers: { Authorization: `Basic ${Buffer.from('u:x').toString('base64')}` } });
    assert.equal(bad.status, 401);
  } finally { secured.close(); }
});
