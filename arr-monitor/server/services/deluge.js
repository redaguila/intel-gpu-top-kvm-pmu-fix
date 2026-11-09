import crypto from 'node:crypto';
import { request, joinUrl, UpstreamError } from '../http.js';
import { URL_FIELD, PASS_FIELD, badRequest, toNum } from './common.js';

const cookies = new Map();
const key = (cfg) => crypto.createHash('sha256').update(`${cfg.url}\0${cfg.password || ''}`).digest('hex');
let rpcId = 0;
const FIELDS = ['name', 'total_size', 'total_done', 'progress', 'state', 'download_payload_rate', 'upload_payload_rate',
  'eta', 'ratio', 'label', 'num_peers', 'time_added', 'message'];

async function raw(cfg, method, params, cookie) {
  const res = await request(joinUrl(cfg.url, '/json'), {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
    body: { method, params, id: ++rpcId },
  });
  return res;
}

async function login(cfg) {
  const res = await raw(cfg, 'auth.login', [cfg.password || '']);
  if (res.data?.result !== true) throw new UpstreamError('Deluge login failed (check password)', 401);
  const cookie = (res.headers.getSetCookie?.() || [res.headers.get('set-cookie') || ''])
    .map((c) => c.split(';')[0]).filter(Boolean).join('; ');
  cookies.set(key(cfg), cookie);
  // Make sure the web UI is connected to a daemon.
  const connected = await raw(cfg, 'web.connected', [], cookie);
  if (connected.data?.result === false) {
    const hosts = await raw(cfg, 'web.get_hosts', [], cookie);
    const first = hosts.data?.result?.[0]?.[0];
    if (first) await raw(cfg, 'web.connect', [first], cookie);
  }
  return cookie;
}

async function rpc(cfg, method, params = [], retried = false) {
  let cookie = cookies.get(key(cfg));
  if (cookie === undefined) cookie = await login(cfg);
  const res = await raw(cfg, method, params, cookie);
  const err = res.data?.error;
  if (err) {
    if (!retried && (err.code === 1 || /not authenticated/i.test(err.message || ''))) {
      cookies.delete(key(cfg));
      return rpc(cfg, method, params, true);
    }
    throw new UpstreamError(`Deluge: ${err.message || 'RPC error'}`, 502);
  }
  return res.data?.result;
}

const hashOf = (id) => {
  const h = String(id || '');
  if (!/^[a-fA-F0-9]{40}$/.test(h)) throw badRequest('invalid torrent hash');
  return h;
};

export const deluge = {
  type: 'deluge',
  name: 'Deluge',
  category: 'download',
  protocol: 'torrent',
  color: '#4c80c6',
  defaultPort: 8112,
  fields: [{ ...URL_FIELD, placeholder: 'http://192.168.1.10:8112' }, { ...PASS_FIELD, label: 'Web UI password' }],
  tabs: ['queue'],
  globalActions: [{ id: 'pauseAll', label: 'Pause all' }, { id: 'resumeAll', label: 'Resume all' }],

  async status(cfg) {
    const [version, ui] = await Promise.all([
      rpc(cfg, 'daemon.info').catch(() => null),
      rpc(cfg, 'web.update_ui', [['state', 'total_size', 'total_done'], {}]),
    ]);
    const torrents = Object.values(ui?.torrents || {});
    return {
      version,
      appName: 'Deluge',
      downloadSpeed: toNum(ui?.stats?.download_rate),
      uploadSpeed: toNum(ui?.stats?.upload_rate),
      paused: torrents.length > 0 && torrents.every((t) => t.state === 'Paused'),
      queueCount: torrents.filter((t) => t.total_done < t.total_size).length,
      sizeLeft: torrents.reduce((a, t) => a + Math.max(0, toNum(t.total_size) - toNum(t.total_done)), 0),
    };
  },

  resources: {
    async queue(cfg) {
      const ui = await rpc(cfg, 'web.update_ui', [FIELDS, {}]);
      return Object.entries(ui?.torrents || {})
        .sort((a, b) => b[1].time_added - a[1].time_added)
        .map(([hash, t]) => ({
          id: hash,
          title: t.name,
          subtitle: [t.label, `ratio ${Math.max(0, toNum(t.ratio)).toFixed(2)}`, `${t.num_peers} peers`].filter(Boolean).join(' · '),
          size: toNum(t.total_size),
          sizeLeft: Math.max(0, toNum(t.total_size) - toNum(t.total_done)),
          progress: toNum(t.progress),
          status: t.state,
          warning: t.state === 'Error' ? t.message : null,
          eta: t.eta > 0 ? t.eta : null,
          speed: toNum(t.download_payload_rate),
          uploadSpeed: toNum(t.upload_payload_rate),
          protocol: 'torrent',
          completed: toNum(t.progress) >= 100,
          actions: [t.state === 'Paused' ? 'resume' : 'pause', 'delete'],
        }));
    },
  },

  actions: {
    async pauseAll(cfg) { await rpc(cfg, 'core.pause_session'); return { ok: true }; },
    async resumeAll(cfg) { await rpc(cfg, 'core.resume_session'); return { ok: true }; },
    async pause(cfg, { id }) { await rpc(cfg, 'core.pause_torrent', [[hashOf(id)]]); return { ok: true }; },
    async resume(cfg, { id }) { await rpc(cfg, 'core.resume_torrent', [[hashOf(id)]]); return { ok: true }; },
    async delete(cfg, { id, deleteFiles = false }) { await rpc(cfg, 'core.remove_torrent', [hashOf(id), !!deleteFiles]); return { ok: true }; },
  },
};
