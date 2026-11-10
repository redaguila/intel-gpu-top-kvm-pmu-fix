import { request, joinUrl, basicAuth, UpstreamError } from '../http.js';
import { URL_FIELD, USER_FIELD, PASS_FIELD, badRequest, toNum } from './common.js';

const sessionIds = new Map();
const STATUS = ['Paused', 'Queued (check)', 'Checking', 'Queued', 'Downloading', 'Queued (seed)', 'Seeding'];
const FIELDS = ['id', 'hashString', 'name', 'totalSize', 'leftUntilDone', 'percentDone', 'rateDownload', 'rateUpload',
  'eta', 'status', 'error', 'errorString', 'uploadRatio', 'peersConnected', 'labels', 'addedDate'];

async function rpc(cfg, method, args = {}, retried = false) {
  const url = joinUrl(cfg.url, cfg.rpcPath || '/transmission/rpc');
  const sid = sessionIds.get(cfg.url) || '';
  const res = await request(url, {
    method: 'POST',
    headers: { ...basicAuth(cfg.username, cfg.password), 'X-Transmission-Session-Id': sid },
    body: { method, arguments: args },
    accept: [200, 409],
  });
  if (res.status === 409) {
    if (retried) throw new UpstreamError('Transmission session handshake failed', 409);
    sessionIds.set(cfg.url, res.headers.get('x-transmission-session-id') || '');
    return rpc(cfg, method, args, true);
  }
  if (res.data?.result !== 'success') throw new UpstreamError(`Transmission: ${res.data?.result || 'unknown error'}`, 502);
  return res.data.arguments || {};
}

const idOf = (id) => {
  const n = Number(id);
  if (!Number.isInteger(n)) throw badRequest('invalid torrent id');
  return n;
};

export const transmission = {
  type: 'transmission',
  name: 'Transmission',
  category: 'download',
  protocol: 'torrent',
  color: '#b50d0d',
  defaultPort: 9091,
  fields: [
    { ...URL_FIELD, placeholder: 'http://192.168.1.10:9091' },
    USER_FIELD, PASS_FIELD,
    { key: 'rpcPath', label: 'RPC path', type: 'text', placeholder: '/transmission/rpc' },
  ],
  tabs: ['queue'],
  globalActions: [{ id: 'pauseAll', label: 'Pause all' }, { id: 'resumeAll', label: 'Resume all' }, { id: 'toggleAltSpeed', label: 'Toggle alt speed' }],
  speedLimit: true,

  async status(cfg) {
    const [session, stats, list] = await Promise.all([
      rpc(cfg, 'session-get', { fields: ['version', 'alt-speed-enabled', 'speed-limit-down-enabled', 'speed-limit-down', 'download-dir'] }),
      rpc(cfg, 'session-stats'),
      rpc(cfg, 'torrent-get', { fields: ['status', 'leftUntilDone'] }),
    ]);
    const torrents = list.torrents || [];
    return {
      version: session.version,
      appName: 'Transmission',
      downloadSpeed: toNum(stats.downloadSpeed),
      uploadSpeed: toNum(stats.uploadSpeed),
      paused: torrents.length > 0 && torrents.every((t) => t.status === 0),
      queueCount: torrents.filter((t) => t.leftUntilDone > 0).length,
      activeCount: toNum(stats.activeTorrentCount),
      sizeLeft: torrents.reduce((a, t) => a + toNum(t.leftUntilDone), 0),
      speedLimit: session['alt-speed-enabled'] ? 'Alt speed' : (session['speed-limit-down-enabled'] ? `${session['speed-limit-down']} KB/s` : null),
    };
  },

  resources: {
    async queue(cfg) {
      const { torrents = [] } = await rpc(cfg, 'torrent-get', { fields: FIELDS });
      return torrents.sort((a, b) => b.addedDate - a.addedDate).map((t) => ({
        id: t.id,
        hash: t.hashString,
        title: t.name,
        subtitle: [(t.labels || []).join(', '), `ratio ${Math.max(0, toNum(t.uploadRatio)).toFixed(2)}`, `${t.peersConnected} peers`].filter(Boolean).join(' · '),
        size: toNum(t.totalSize),
        sizeLeft: toNum(t.leftUntilDone),
        progress: toNum(t.percentDone) * 100,
        status: t.error ? 'Error' : (STATUS[t.status] || 'Unknown'),
        warning: t.error ? t.errorString : null,
        eta: t.eta >= 0 ? t.eta : null,
        speed: toNum(t.rateDownload),
        uploadSpeed: toNum(t.rateUpload),
        protocol: 'torrent',
        completed: t.percentDone >= 1,
        actions: [t.status === 0 ? 'resume' : 'pause', 'delete'],
      }));
    },
  },

  actions: {
    async pauseAll(cfg) { await rpc(cfg, 'torrent-stop', {}); return { ok: true }; },
    async resumeAll(cfg) { await rpc(cfg, 'torrent-start', {}); return { ok: true }; },
    async pause(cfg, { id }) { await rpc(cfg, 'torrent-stop', { ids: [idOf(id)] }); return { ok: true }; },
    async resume(cfg, { id }) { await rpc(cfg, 'torrent-start', { ids: [idOf(id)] }); return { ok: true }; },
    async delete(cfg, { id, deleteFiles = false }) {
      await rpc(cfg, 'torrent-remove', { ids: [idOf(id)], 'delete-local-data': !!deleteFiles });
      return { ok: true };
    },
    async toggleAltSpeed(cfg) {
      const s = await rpc(cfg, 'session-get', { fields: ['alt-speed-enabled'] });
      await rpc(cfg, 'session-set', { 'alt-speed-enabled': !s['alt-speed-enabled'] });
      return { ok: true };
    },
    async setSpeedLimit(cfg, { value }) {
      const kb = Math.max(0, Math.round(toNum(value)));
      await rpc(cfg, 'session-set', { 'speed-limit-down-enabled': kb > 0, 'speed-limit-down': kb });
      return { ok: true };
    },
  },
};
