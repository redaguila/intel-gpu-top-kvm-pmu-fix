// A fake *arr stack used by the tests and for local demos (`npm run mock`).
// Every service lives under its own path prefix on a single HTTP server:
//   http://127.0.0.1:<port>/sonarr, /radarr, /lidarr, /readarr, /prowlarr, /bazarr,
//   /sabnzbd, /nzbget, /qbittorrent, /transmission, /deluge, /overseerr, /tautulli
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const API_KEY = 'test-api-key';
export const USER = 'admin';
export const PASS = 'secret';

const day = 86400000;
const iso = (offsetDays, hour = 20) => {
  const d = new Date(Date.now() + offsetDays * day);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const poster = (seed) => [{ coverType: 'poster', url: `/MediaCover/${seed}/poster.jpg`, remoteUrl: `https://picsum.photos/seed/${seed}/300/450` }];

export function createState() {
  return {
    sabPaused: false,
    sabSlots: [
      { nzo_id: 'SABnzbd_nzo_1', filename: 'Night.Signal.S02E05.1080p.WEB-DL', mb: '2300.5', mbleft: '820.1', percentage: '64', status: 'Downloading', timeleft: '0:04:12', cat: 'tv' },
      { nzo_id: 'SABnzbd_nzo_2', filename: 'Cloud.Harbor.2026.2160p.UHD.BluRay', mb: '41000', mbleft: '41000', percentage: '0', status: 'Queued', timeleft: '1:02:10:00', cat: 'movies' },
    ],
    torrents: [
      { hash: 'a'.repeat(40), name: 'Copper Valley S01 1080p WEB', size: 12e9, amount_left: 3e9, progress: 0.75, dlspeed: 5.2e6, upspeed: 4e5, eta: 580, state: 'downloading', category: 'tv-sonarr', ratio: 0.12, num_seeds: 54, num_leechs: 7, added_on: 3 },
      { hash: 'b'.repeat(40), name: 'Ambient Works Vol 3 FLAC', size: 900e6, amount_left: 0, progress: 1, dlspeed: 0, upspeed: 1.1e5, eta: 8640000, state: 'uploading', category: 'music', ratio: 1.8, num_seeds: 3, num_leechs: 1, added_on: 2 },
    ],
    trTorrents: [
      { id: 1, hashString: 'c'.repeat(40), name: 'Linux.Distro.2026.iso', totalSize: 4e9, leftUntilDone: 1e9, percentDone: 0.75, rateDownload: 3e6, rateUpload: 2e5, eta: 333, status: 4, error: 0, errorString: '', uploadRatio: 0.3, peersConnected: 12, labels: ['iso'], addedDate: 10 },
    ],
    nzbgetPaused: false,
    rdtTorrents: [
      { hash: 'e'.repeat(40), name: 'Better.Call.Saul.S01.1080p.BluRay.x264-ROVERS', size: 44.1e9, amount_left: 0, progress: 1, dlspeed: 0, upspeed: 0, eta: 0, state: 'pausedUP', category: 'tv-sonarr', ratio: 0, num_seeds: 0, num_leechs: 0, added_on: 5 },
      { hash: 'f'.repeat(40), name: 'Cloud.Harbor.2026.2160p', size: 20e9, amount_left: 5e9, progress: 0.75, dlspeed: 8e6, upspeed: 0, eta: 625, state: 'downloading', category: 'radarr', ratio: 0, num_seeds: 0, num_leechs: 0, added_on: 6 },
    ],
    rdTorrents: [
      { id: 'RDAAA1', filename: 'Better.Call.Saul.S01.1080p.BluRay.x264-ROVERS', hash: 'e'.repeat(40), bytes: 44.1e9, host: 'real-debrid.com', progress: 100, status: 'downloaded', links: ['l1', 'l2'], added: iso(-1) },
      { id: 'RDBBB2', filename: 'Cloud.Harbor.2026.2160p', hash: 'f'.repeat(40), bytes: 20e9, host: 'real-debrid.com', progress: 40, status: 'downloading', speed: 50e6, seeders: 30, links: [], added: iso(-0.01) },
      { id: 'RDCCC3', filename: 'Broken.Upload', bytes: 1e9, host: 'real-debrid.com', progress: 0, status: 'magnet_error', links: [], added: iso(-2) },
    ],
    sonarrQueue: [
      ...[1, 2, 3].map((ep) => ({ id: 200 + ep, downloadId: 'PACK1HASH', title: 'Better.Call.Saul.S01.1080p.BluRay.x264-ROVERS', size: 44130000000, sizeleft: 0, status: 'downloading', trackedDownloadStatus: 'ok', trackedDownloadState: 'downloading', protocol: 'torrent', downloadClient: 'RDTClient', series: { title: 'Better Call Saul' }, episode: { seasonNumber: 1, episodeNumber: ep, title: `Episode ${ep}` } })),
      { id: 101, title: 'Night.Signal.S02E05.1080p.WEB-DL', size: 2412000000, sizeleft: 860000000, status: 'downloading', trackedDownloadStatus: 'ok', trackedDownloadState: 'downloading', timeleft: '00:04:12', protocol: 'usenet', downloadClient: 'SABnzbd', series: { title: 'Night Signal' }, episode: { seasonNumber: 2, episodeNumber: 5, title: 'Static' } },
      { id: 102, title: 'Copper.Valley.S01E03.1080p', size: 1500000000, sizeleft: 0, status: 'completed', trackedDownloadStatus: 'warning', trackedDownloadState: 'importPending', statusMessages: [{ title: 'x', messages: ['No files found are eligible for import'] }], protocol: 'torrent', downloadClient: 'qBittorrent', series: { title: 'Copper Valley' }, episode: { seasonNumber: 1, episodeNumber: 3, title: 'Ore' } },
    ],
    requests: [
      { id: 1, status: 1, type: 'movie', media: { tmdbId: 550, status: 2 }, requestedBy: { displayName: 'Sam' }, createdAt: iso(-1), seasons: [] },
      { id: 2, status: 2, type: 'tv', media: { tmdbId: 1399, status: 3 }, requestedBy: { displayName: 'Alex' }, createdAt: iso(-3), seasons: [{ seasonNumber: 1 }] },
    ],
    commands: [],
    added: [],
    log: [],
  };
}

const series = [
  { id: 1, title: 'Night Signal', year: 2024, status: 'continuing', monitored: true, network: 'Northwave', overview: 'A late-night radio host picks up transmissions from the future.', images: poster('nightsignal'), statistics: { episodeFileCount: 14, episodeCount: 18, sizeOnDisk: 32e9 }, added: '2024-03-01T00:00:00Z' },
  { id: 2, title: 'Copper Valley', year: 2026, status: 'continuing', monitored: true, network: 'Range TV', overview: 'Mining town drama.', images: poster('coppervalley'), statistics: { episodeFileCount: 2, episodeCount: 8, sizeOnDisk: 3e9 }, added: '2026-09-01T00:00:00Z' },
  { id: 3, title: 'The Quiet Orchard', year: 2019, status: 'ended', monitored: false, network: 'Studio Nine', overview: 'Family saga.', images: poster('orchard'), statistics: { episodeFileCount: 30, episodeCount: 30, sizeOnDisk: 61e9 }, added: '2021-01-01T00:00:00Z' },
];
const movies = [
  { id: 1, title: 'Cloud Harbor', year: 2026, status: 'released', monitored: true, hasFile: false, isAvailable: true, studio: 'Skyline', overview: 'Airship heist.', images: poster('cloudharbor'), sizeOnDisk: 0, inCinemas: iso(-40), digitalRelease: iso(2), added: '2026-10-01T00:00:00Z' },
  { id: 2, title: 'Paper Lanterns', year: 2023, status: 'released', monitored: true, hasFile: true, isAvailable: true, studio: 'Ember', overview: 'A quiet drama.', images: poster('lanterns'), sizeOnDisk: 9e9, movieFile: { quality: { quality: { name: 'Bluray-1080p' } } }, added: '2024-01-01T00:00:00Z' },
];

function send(res, status, body, headers = {}) {
  const isStr = typeof body === 'string';
  res.writeHead(status, { 'Content-Type': isStr ? 'text/plain' : 'application/json', ...headers });
  res.end(isStr ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const basicOk = (req) => req.headers.authorization === `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`;

function arrHandler(kind, state) {
  const unauthorized = (req) => req.headers['x-api-key'] !== API_KEY;
  return async (req, res, sub, url) => {
    if (sub.startsWith('/MediaCover/')) {
      if (unauthorized(req)) return send(res, 401, { error: 'Unauthorized' });
      return send(res, 200, 'JPEGDATA', { 'Content-Type': 'image/jpeg' });
    }
    if (unauthorized(req)) return send(res, 401, { error: 'Unauthorized' });
    const v = kind === 'lidarr' || kind === 'readarr' ? '/api/v1' : '/api/v3';
    if (!sub.startsWith(v)) return send(res, 404, { message: 'NotFound' });
    const p = sub.slice(v.length);
    const appName = kind[0].toUpperCase() + kind.slice(1);
    if (p === '/system/status') return send(res, 200, { appName, version: kind === 'sonarr' ? '4.0.9.2244' : '5.14.0.9383' });
    if (p === '/diskspace') return send(res, 200, [{ path: '/data', freeSpace: 1.2e12, totalSpace: 4e12 }]);
    if (p === '/health') {
      if (kind === 'radarr') return send(res, 200, [{ source: 'IndexerStatusCheck', type: 'warning', message: 'Indexers unavailable due to failures: NZBFinder', wikiUrl: 'https://wiki.servarr.com/radarr/system#indexers-are-unavailable-due-to-failures' }]);
      if (kind === 'sonarr') return send(res, 200, [{ source: 'RemotePathMappingCheck', type: 'error', message: 'You are using docker; download client RDTClient places downloads in /data/downloads/rdt-client/tv-sonarr/Better.Call.Saul.S01.1080p.BluRay.x264-ROVERS but this directory does not appear to exist inside the container. Review your remote path mappings and container volume settings.', wikiUrl: 'https://wiki.servarr.com/sonarr/system#docker-bad-remote-path-mapping' }]);
      return send(res, 200, []);
    }
    if (p === '/queue') {
      if (kind === 'sonarr') return send(res, 200, { page: 1, totalRecords: state.sonarrQueue.length, records: state.sonarrQueue });
      return send(res, 200, { page: 1, totalRecords: 0, records: [] });
    }
    if (p === '/queue/bulk' && req.method === 'DELETE') {
      const { ids } = JSON.parse(await readBody(req));
      state.log.push({ kind, action: 'deleteQueueBulk', ids, query: url.search });
      state.sonarrQueue = state.sonarrQueue.filter((q) => !ids.includes(q.id));
      return send(res, 200, {});
    }
    if (p.startsWith('/queue/') && req.method === 'DELETE') {
      const id = Number(p.split('/')[2]);
      state.log.push({ kind, action: 'deleteQueue', id, query: url.search });
      state.sonarrQueue = state.sonarrQueue.filter((q) => q.id !== id);
      return send(res, 200, {});
    }
    if (p === '/calendar') {
      if (kind === 'sonarr') return send(res, 200, [
        { id: 11, seasonNumber: 2, episodeNumber: 6, title: 'Feedback', airDateUtc: iso(0, 21), hasFile: false, monitored: true, series: { title: 'Night Signal', images: poster('nightsignal') } },
        { id: 12, seasonNumber: 1, episodeNumber: 4, title: 'Vein', airDateUtc: iso(1, 2), hasFile: false, monitored: true, series: { title: 'Copper Valley', images: poster('coppervalley') } },
        { id: 13, seasonNumber: 2, episodeNumber: 4, title: 'Noise', airDateUtc: iso(-1, 21), hasFile: true, monitored: true, series: { title: 'Night Signal', images: poster('nightsignal') } },
      ]);
      if (kind === 'radarr') return send(res, 200, [movies[0]]);
      if (kind === 'lidarr') return send(res, 200, [{ id: 5, title: 'Low Tide', releaseDate: iso(3), artist: { artistName: 'The Shoals' }, statistics: { trackFileCount: 0 } }]);
      return send(res, 200, []);
    }
    if (p === '/history') return send(res, 200, { records: [
      { id: 1, eventType: 'downloadFolderImported', date: iso(-0.1), sourceTitle: 'Night.Signal.S02E04.1080p.WEB-DL', series: { title: 'Night Signal' }, episode: { seasonNumber: 2, episodeNumber: 4 }, movie: { title: 'Paper Lanterns', year: 2023 }, quality: { quality: { name: 'WEBDL-1080p' } } },
      { id: 2, eventType: 'grabbed', date: iso(-0.2), sourceTitle: 'Night.Signal.S02E05.1080p.WEB-DL', series: { title: 'Night Signal' }, episode: { seasonNumber: 2, episodeNumber: 5 }, movie: { title: 'Cloud Harbor', year: 2026 }, quality: { quality: { name: 'WEBDL-1080p' } } },
    ] });
    if (p === '/series') {
      if (req.method === 'POST') { const b = JSON.parse(await readBody(req)); state.added.push({ kind, body: b }); return send(res, 201, { id: 99, title: b.title }); }
      return send(res, 200, series);
    }
    if (p === '/movie') {
      if (req.method === 'POST') { const b = JSON.parse(await readBody(req)); state.added.push({ kind, body: b }); return send(res, 201, { id: 99, title: b.title }); }
      return send(res, 200, movies);
    }
    if (p === '/artist') return send(res, 200, [{ id: 1, artistName: 'The Shoals', monitored: true, images: [], statistics: { trackFileCount: 20, trackCount: 24, sizeOnDisk: 1e9 } }]);
    if (p === '/author') return send(res, 200, [{ id: 1, authorName: 'R. Vale', monitored: true, images: [], statistics: { bookFileCount: 3, bookCount: 5, sizeOnDisk: 5e7 } }]);
    if (p === '/wanted/missing') {
      if (kind === 'radarr') return send(res, 404, { message: 'NotFound' }); // exercise the fallback
      if (kind === 'sonarr') return send(res, 200, { records: [{ id: 12, seasonNumber: 1, episodeNumber: 2, title: 'Shaft', airDateUtc: iso(-7), series: { title: 'Copper Valley' } }] });
      return send(res, 200, { records: [] });
    }
    if (p === '/series/lookup' || p === '/movie/lookup') {
      const term = url.searchParams.get('term');
      return send(res, 200, [{ title: `${term} (lookup)`, year: 2025, tvdbId: 1234, tmdbId: 4321, images: poster('lookup'), overview: 'Found by lookup' }, { id: 1, title: 'Night Signal', year: 2024, images: [] }]);
    }
    if (p === '/qualityprofile') return send(res, 200, [{ id: 1, name: 'HD-1080p' }, { id: 4, name: 'Ultra-HD' }]);
    if (p === '/rootfolder') return send(res, 200, [{ path: kind === 'sonarr' ? '/data/tv' : '/data/movies', freeSpace: 1.2e12 }]);
    if (p === '/metadataprofile') return send(res, 200, [{ id: 1, name: 'Standard' }]);
    if (p === '/languageprofile') return send(res, 404, { message: 'NotFound' });
    if (p === '/command' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req));
      state.commands.push({ kind, ...b });
      return send(res, 201, { id: state.commands.length, name: b.name, status: 'queued' });
    }
    return send(res, 404, { message: 'NotFound' });
  };
}

function prowlarrHandler(state) {
  return async (req, res, sub, url) => {
    if (req.headers['x-api-key'] !== API_KEY) return send(res, 401, {});
    const p = sub.replace('/api/v1', '');
    if (p === '/system/status') return send(res, 200, { appName: 'Prowlarr', version: '1.24.3.4754' });
    if (p === '/health') return send(res, 200, []);
    if (p === '/indexer') return send(res, 200, [{ id: 1, name: 'NZBFinder', protocol: 'usenet', enable: true, privacy: 'private', priority: 25 }, { id: 2, name: '1337x', protocol: 'torrent', enable: true, privacy: 'public', priority: 25 }]);
    if (p === '/indexerstatus') return send(res, 200, [{ indexerId: 1, disabledTill: iso(0.1) }]);
    if (p === '/history') return send(res, 200, { records: [{ id: 1, eventType: 'indexerQuery', date: iso(-0.01), successful: true, data: { query: 'night signal', source: 'Sonarr', queryResults: '42' } }] });
    if (p === '/search' && req.method === 'GET') {
      return send(res, 200, [
        { guid: 'g1', indexerId: 2, indexer: '1337x', title: `${url.searchParams.get('query')} 1080p WEB`, size: 2e9, seeders: 120, leechers: 4, protocol: 'torrent', publishDate: iso(-2), age: 2, categories: [{ name: 'TV/HD' }] },
        { guid: 'g2', indexerId: 1, indexer: 'NZBFinder', title: `${url.searchParams.get('query')} 2160p`, size: 8e9, grabs: 300, protocol: 'usenet', publishDate: iso(-5), age: 5, categories: [{ name: 'TV/UHD' }] },
      ]);
    }
    if (p === '/search' && req.method === 'POST') { state.log.push({ kind: 'prowlarr', action: 'grab', body: JSON.parse(await readBody(req)) }); return send(res, 200, {}); }
    return send(res, 404, {});
  };
}

function bazarrHandler() {
  return (req, res, sub) => {
    if (req.headers['x-api-key'] !== API_KEY) return send(res, 401, {});
    if (sub === '/api/system/status') return send(res, 200, { data: { bazarr_version: '1.4.5' } });
    if (sub === '/api/badges') return send(res, 200, { episodes: 4, movies: 1, providers: 0 });
    if (sub.startsWith('/api/episodes/wanted')) return send(res, 200, { data: [{ sonarrEpisodeId: 7, seriesTitle: 'Night Signal', episode_number: '2x04', episodeTitle: 'Noise', missing_subtitles: [{ name: 'English', code2: 'en' }] }] });
    if (sub.startsWith('/api/movies/wanted')) return send(res, 200, { data: [{ radarrId: 2, title: 'Paper Lanterns', missing_subtitles: [{ code2: 'es' }] }] });
    if (sub.startsWith('/api/episodes/history') || sub.startsWith('/api/movies/history')) return send(res, 200, { data: [] });
    if (sub === '/api/system/health') return send(res, 200, { data: [] });
    return send(res, 404, {});
  };
}

function sabHandler(state) {
  return (req, res, sub, url) => {
    const q = url.searchParams;
    if (q.get('apikey') !== API_KEY) return send(res, 200, { status: false, error: 'API Key Incorrect' });
    const mode = q.get('mode');
    if (mode === 'version') return send(res, 200, { version: '4.3.3' });
    if (mode === 'queue') {
      const name = q.get('name');
      if (name) {
        state.log.push({ kind: 'sabnzbd', action: name, value: q.get('value') });
        const slot = state.sabSlots.find((s) => s.nzo_id === q.get('value'));
        if (slot && name === 'pause') slot.status = 'Paused';
        if (slot && name === 'resume') slot.status = 'Queued';
        if (name === 'delete') state.sabSlots = state.sabSlots.filter((s) => s.nzo_id !== q.get('value'));
        return send(res, 200, { status: true });
      }
      return send(res, 200, { queue: { status: state.sabPaused ? 'Paused' : 'Downloading', paused: state.sabPaused, kbpersec: state.sabPaused ? '0' : '24576', mbleft: '41820.1', noofslots_total: state.sabSlots.length, diskspace1: '850.2', speedlimit: '', slots: state.sabSlots } });
    }
    if (mode === 'history') return send(res, 200, { history: { slots: [{ nzo_id: 'h1', name: 'Night.Signal.S02E04', status: 'Completed', completed: Math.floor(Date.now() / 1000) - 3600, category: 'tv', size: '2.1 GB' }, { nzo_id: 'h2', name: 'Broken.Release', status: 'Failed', fail_message: 'Out of retention', completed: Math.floor(Date.now() / 1000) - 7200 }] } });
    if (mode === 'pause') { state.sabPaused = true; return send(res, 200, { status: true }); }
    if (mode === 'resume') { state.sabPaused = false; return send(res, 200, { status: true }); }
    if (mode === 'config') { state.log.push({ kind: 'sabnzbd', action: 'speedlimit', value: q.get('value') }); return send(res, 200, { status: true }); }
    return send(res, 200, { status: false, error: 'not implemented' });
  };
}

function nzbgetHandler(state) {
  return async (req, res, sub) => {
    if (!basicOk(req)) return send(res, 401, 'Unauthorized');
    if (sub !== '/jsonrpc') return send(res, 404, '');
    const { method, params, id } = JSON.parse(await readBody(req));
    const ok = (result) => send(res, 200, { version: '1.1', id, result });
    if (method === 'version') return ok('24.3');
    if (method === 'status') return ok({ DownloadRate: state.nzbgetPaused ? 0 : 10485760, DownloadPaused: state.nzbgetPaused, RemainingSizeMB: 1500, FreeDiskSpaceMB: 500000, DownloadLimit: 0 });
    if (method === 'listgroups') return ok([{ NZBID: 7, NZBName: 'Paper.Lanterns.2023.1080p', FileSizeMB: 9000, RemainingSizeMB: 1500, Status: 'DOWNLOADING', Category: 'movies' }]);
    if (method === 'history') return ok([{ NZBID: 3, Name: 'Older.Thing', Status: 'SUCCESS/ALL', HistoryTime: Math.floor(Date.now() / 1000) - 600 }]);
    if (method === 'pausedownload') { state.nzbgetPaused = true; return ok(true); }
    if (method === 'resumedownload') { state.nzbgetPaused = false; return ok(true); }
    if (method === 'editqueue') { state.log.push({ kind: 'nzbget', action: params[0], ids: params[2] }); return ok(true); }
    if (method === 'rate') { state.log.push({ kind: 'nzbget', action: 'rate', value: params[0] }); return ok(true); }
    return send(res, 200, { id, error: { message: 'unknown method' } });
  };
}

function qbHandler(state) {
  const SID = 'SID=mocksession123';
  return async (req, res, sub, url) => {
    if (sub === '/api/v2/auth/login') {
      const body = new URLSearchParams(await readBody(req));
      if (body.get('username') === USER && body.get('password') === PASS) return send(res, 200, 'Ok.', { 'Set-Cookie': `${SID}; HttpOnly; path=/` });
      return send(res, 200, 'Fails.');
    }
    if (!String(req.headers.cookie || '').includes(SID)) return send(res, 403, 'Forbidden');
    if (sub === '/api/v2/app/version') return send(res, 200, 'v5.0.1');
    if (sub === '/api/v2/transfer/info') return send(res, 200, { dl_info_speed: state.torrents.reduce((a, t) => a + t.dlspeed, 0), up_info_speed: state.torrents.reduce((a, t) => a + t.upspeed, 0), dl_rate_limit: 0 });
    if (sub === '/api/v2/torrents/info') return send(res, 200, state.torrents);
    // qBittorrent 5 removed pause/resume in favour of stop/start.
    if (sub === '/api/v2/torrents/pause' || sub === '/api/v2/torrents/resume') return send(res, 404, 'Not Found');
    if (sub === '/api/v2/torrents/stop' || sub === '/api/v2/torrents/start' || sub === '/api/v2/torrents/delete') {
      const body = new URLSearchParams(await readBody(req));
      const hashes = body.get('hashes');
      state.log.push({ kind: 'qbittorrent', action: sub.split('/').pop(), hashes, deleteFiles: body.get('deleteFiles') });
      for (const t of state.torrents) {
        if (hashes !== 'all' && t.hash !== hashes) continue;
        if (sub.endsWith('stop')) { t.state = t.progress >= 1 ? 'stoppedUP' : 'stoppedDL'; t.dlspeed = 0; }
        if (sub.endsWith('start')) t.state = t.progress >= 1 ? 'uploading' : 'downloading';
      }
      if (sub.endsWith('delete')) state.torrents = state.torrents.filter((t) => t.hash !== hashes);
      return send(res, 200, '');
    }
    if (sub === '/api/v2/transfer/toggleSpeedLimitsMode' || sub === '/api/v2/transfer/setDownloadLimit') { state.log.push({ kind: 'qbittorrent', action: sub.split('/').pop(), body: await readBody(req) }); return send(res, 200, ''); }
    return send(res, 404, 'Not Found');
  };
}

// rdt-client exposes a qBittorrent-compatible API: 401 when not logged in, finished torrents are
// "pausedUP". This mock also omits app/version and transfer/info to exercise the optional paths.
function rdtClientHandler(state) {
  const COOKIE = 'SID=CfDJ8rdtclientcookie';
  return async (req, res, sub) => {
    if (sub === '/api/v2/auth/login') {
      const body = new URLSearchParams(await readBody(req));
      if (body.get('username') === USER && body.get('password') === PASS) return send(res, 200, 'Ok.', { 'Set-Cookie': `${COOKIE}; path=/; samesite=lax; httponly` });
      return send(res, 200, 'Fails.');
    }
    if (!String(req.headers.cookie || '').includes(COOKIE)) return send(res, 401, '');
    if (sub === '/api/v2/torrents/info') return send(res, 200, state.rdtTorrents);
    if (sub === '/api/v2/torrents/pause' || sub === '/api/v2/torrents/resume' || sub === '/api/v2/torrents/delete') {
      const body = new URLSearchParams(await readBody(req));
      state.log.push({ kind: 'rdtclient', action: sub.split('/').pop(), hashes: body.get('hashes') });
      return send(res, 200, '');
    }
    return send(res, 404, '');
  };
}

function realDebridHandler(state) {
  return (req, res, sub) => {
    if (req.headers.authorization !== `Bearer ${API_KEY}`) return send(res, 401, { error: 'bad_token', error_code: 8 });
    const p = sub.replace('/rest/1.0', '');
    if (p === '/user') return send(res, 200, { id: 1, username: 'dan', type: 'premium', points: 1200, premium: 5 * 86400 + 3600, expiration: iso(5) });
    if (p === '/torrents') return send(res, 200, state.rdTorrents);
    if (p === '/downloads') return send(res, 200, [{ id: 'DL1', filename: 'Better.Call.Saul.S01E01.mkv', filesize: 4.1e9, host: 'real-debrid.com', generated: iso(-0.1) }]);
    const m = p.match(/^\/torrents\/delete\/(\w+)$/);
    if (m && req.method === 'DELETE') {
      state.log.push({ kind: 'realdebrid', action: 'delete', id: m[1] });
      state.rdTorrents = state.rdTorrents.filter((t) => t.id !== m[1]);
      res.writeHead(204); return res.end();
    }
    return send(res, 404, { error: 'unknown_ressource' });
  };
}

function transmissionHandler(state) {
  const SESSION = 'mock-transmission-session';
  return async (req, res, sub) => {
    if (sub !== '/transmission/rpc') return send(res, 404, '');
    if (!basicOk(req)) return send(res, 401, 'Unauthorized');
    if (req.headers['x-transmission-session-id'] !== SESSION) return send(res, 409, 'Conflict', { 'X-Transmission-Session-Id': SESSION });
    const { method, arguments: args = {} } = JSON.parse(await readBody(req));
    const ok = (a = {}) => send(res, 200, { result: 'success', arguments: a });
    if (method === 'session-get') return ok({ version: '4.0.6 (38c164933e)', 'alt-speed-enabled': false });
    if (method === 'session-stats') return ok({ downloadSpeed: 3e6, uploadSpeed: 2e5, activeTorrentCount: 1 });
    if (method === 'torrent-get') return ok({ torrents: state.trTorrents });
    if (['torrent-stop', 'torrent-start', 'torrent-remove', 'session-set'].includes(method)) {
      state.log.push({ kind: 'transmission', action: method, args });
      for (const t of state.trTorrents) if (!args.ids || args.ids.includes(t.id)) {
        if (method === 'torrent-stop') t.status = 0;
        if (method === 'torrent-start') t.status = 4;
      }
      return ok();
    }
    return send(res, 200, { result: 'method name not recognized' });
  };
}

function delugeHandler(state) {
  return async (req, res, sub) => {
    if (sub !== '/json') return send(res, 404, '');
    const { method, params, id } = JSON.parse(await readBody(req));
    const ok = (result, headers) => send(res, 200, { id, result, error: null }, headers);
    if (method === 'auth.login') return params[0] === PASS ? ok(true, { 'Set-Cookie': '_session_id=deluge123; Path=/json' }) : ok(false);
    if (!String(req.headers.cookie || '').includes('_session_id=deluge123')) return send(res, 200, { id, result: null, error: { message: 'Not authenticated', code: 1 } });
    if (method === 'web.connected') return ok(true);
    if (method === 'daemon.info') return ok('2.1.1');
    if (method === 'web.update_ui') return ok({ stats: { download_rate: 1e6, upload_rate: 5e4 }, torrents: { ['d'.repeat(40)]: { name: 'Big.Buck.Bunny.4K', total_size: 6e9, total_done: 3e9, progress: 50, state: 'Downloading', download_payload_rate: 1e6, upload_payload_rate: 5e4, eta: 3000, ratio: 0.1, label: 'movies', num_peers: 9, time_added: 1 } } });
    state.log.push({ kind: 'deluge', action: method, params });
    return ok(true);
  };
}

function overseerrHandler(state) {
  return (req, res, sub) => {
    if (req.headers['x-api-key'] !== API_KEY) return send(res, 403, { message: 'You do not have permission' });
    const p = sub.replace('/api/v1', '');
    if (p === '/status') return send(res, 200, { version: '1.33.2' });
    if (p === '/request/count') return send(res, 200, { pending: state.requests.filter((r) => r.status === 1).length, approved: 1, processing: 1, available: 10 });
    if (p.startsWith('/request?')) return send(res, 200, { pageInfo: {}, results: state.requests });
    if (p === '/movie/550') return send(res, 200, { title: 'Fight Club', releaseDate: '1999-10-15', posterPath: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg' });
    if (p === '/tv/1399') return send(res, 200, { name: 'Game of Thrones', firstAirDate: '2011-04-17', posterPath: null });
    const m = p.match(/^\/request\/(\d+)\/(approve|decline)$/);
    if (m && req.method === 'POST') {
      const r = state.requests.find((x) => x.id === Number(m[1]));
      if (r) r.status = m[2] === 'approve' ? 2 : 3;
      return send(res, 200, r || {});
    }
    return send(res, 404, {});
  };
}

function tautulliHandler() {
  return (req, res, sub, url) => {
    const q = url.searchParams;
    if (q.get('apikey') !== API_KEY) return send(res, 200, { response: { result: 'error', message: 'Invalid apikey', data: {} } });
    const ok = (data) => send(res, 200, { response: { result: 'success', message: null, data } });
    if (q.get('cmd') === 'get_tautulli_info') return ok({ tautulli_version: 'v2.14.6' });
    if (q.get('cmd') === 'get_activity') return ok({ stream_count: '2', stream_count_transcode: 1, total_bandwidth: 24000, sessions: [
      { session_key: '1', full_title: 'Night Signal - Static', friendly_name: 'Sam', player: 'Living Room TV', product: 'Plex for LG', progress_percent: '42', state: 'playing', transcode_decision: 'direct play', quality_profile: 'Original', bandwidth: '12000' },
      { session_key: '2', full_title: 'Paper Lanterns', friendly_name: 'Alex', player: 'iPhone', progress_percent: '80', state: 'paused', transcode_decision: 'transcode', quality_profile: '4 Mbps 720p', bandwidth: '4000' },
    ] });
    if (q.get('cmd') === 'get_history') return ok({ data: [{ row_id: 1, full_title: 'Copper Valley - Ore', friendly_name: 'Sam', player: 'Chrome', watched_status: 1, date: Math.floor(Date.now() / 1000) - 5000 }] });
    return send(res, 200, { response: { result: 'error', message: 'unknown cmd' } });
  };
}

export function createMockUpstream(state = createState()) {
  const handlers = {
    sonarr: arrHandler('sonarr', state), radarr: arrHandler('radarr', state),
    lidarr: arrHandler('lidarr', state), readarr: arrHandler('readarr', state),
    prowlarr: prowlarrHandler(state), bazarr: bazarrHandler(state), sabnzbd: sabHandler(state),
    nzbget: nzbgetHandler(state), qbittorrent: qbHandler(state), transmission: transmissionHandler(state),
    deluge: delugeHandler(state), overseerr: overseerrHandler(state), tautulli: tautulliHandler(state),
    rdtclient: rdtClientHandler(state), realdebrid: realDebridHandler(state),
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const [, prefix, ...rest] = url.pathname.split('/');
    let sub = `/${rest.join('/')}`;
    // MediaCover requests arrive at the host root ("/<prefix>/MediaCover/...").
    const handler = handlers[prefix];
    if (!handler) return send(res, 404, 'unknown service');
    if (prefix === 'overseerr' && url.search) sub += url.search;
    try { await handler(req, res, sub, url); } catch (err) { send(res, 500, { error: err.message }); }
  });
  server.state = state;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.MOCK_PORT) || 9999;
  createMockUpstream().listen(port, () => {
    console.log(`Mock *arr stack on http://127.0.0.1:${port}/<service>  (api key "${API_KEY}", user "${USER}" / pass "${PASS}")`);
  });
}
