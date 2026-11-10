import crypto from 'node:crypto';
import { request, joinUrl, UpstreamError } from '../http.js';
import { URL_FIELD, USER_FIELD, PASS_FIELD, badRequest, toNum } from './common.js';

const sessions = new Map(); // service url+user -> cookie

const STATE_LABELS = {
  downloading: 'Downloading', forcedDL: 'Downloading (forced)', metaDL: 'Fetching metadata', forcedMetaDL: 'Fetching metadata',
  stalledDL: 'Stalled', queuedDL: 'Queued', pausedDL: 'Paused', stoppedDL: 'Paused', checkingDL: 'Checking',
  uploading: 'Seeding', forcedUP: 'Seeding (forced)', stalledUP: 'Seeding', queuedUP: 'Queued (seed)',
  pausedUP: 'Completed', stoppedUP: 'Completed', checkingUP: 'Checking', checkingResumeData: 'Checking',
  error: 'Error', missingFiles: 'Missing files', moving: 'Moving', unknown: 'Unknown',
};
const isPaused = (state) => /^(paused|stopped)/.test(state);

// Keyed on the credentials too, so changing the password never reuses a stale session.
const key = (cfg) => crypto.createHash('sha256').update(`${cfg.url}\0${cfg.username || ''}\0${cfg.password || ''}`).digest('hex');

async function login(cfg) {
  const origin = new URL(cfg.url).origin;
  const res = await request(joinUrl(cfg.url, '/api/v2/auth/login'), {
    method: 'POST',
    form: { username: cfg.username || '', password: cfg.password || '' },
    headers: { Referer: origin, Origin: origin },
    responseType: 'text',
  });
  if (String(res.data).trim() !== 'Ok.') throw new UpstreamError('qBittorrent login failed (check username / password)', 401);
  // qBittorrent uses SID (or QBT_SID_<port>); emulators such as rdt-client may use other names, so keep them all.
  const cookie = (res.headers.getSetCookie?.() || [res.headers.get('set-cookie') || ''])
    .map((c) => c.split(';')[0].trim()).filter((c) => c.includes('=')).join('; ');
  sessions.set(key(cfg), cookie);
  return cookie;
}

async function api(cfg, path, opts = {}, retried = false) {
  let cookie = sessions.get(key(cfg));
  if (cookie === undefined) cookie = await login(cfg);
  const origin = new URL(cfg.url).origin;
  try {
    const res = await request(joinUrl(cfg.url, `/api/v2/${path}`), {
      ...opts,
      method: opts.method || (opts.form ? 'POST' : 'GET'),
      headers: { Referer: origin, ...(cookie ? { Cookie: cookie } : {}) },
    });
    return res.data;
  } catch (err) {
    // Expired session: qBittorrent answers 403, rdt-client answers 401.
    if (!retried && err instanceof UpstreamError && (err.status === 403 || err.status === 401)) {
      sessions.delete(key(cfg));
      return api(cfg, path, opts, true);
    }
    throw err;
  }
}

/** qBittorrent 5 renamed pause/resume to stop/start. */
async function pauseResume(cfg, action, hashes) {
  const [legacy, modern] = action === 'pause' ? ['pause', 'stop'] : ['resume', 'start'];
  try {
    await api(cfg, `torrents/${legacy}`, { form: { hashes } });
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 404) await api(cfg, `torrents/${modern}`, { form: { hashes } });
    else throw err;
  }
  return { ok: true };
}

const hashOf = (id) => {
  const h = String(id || '');
  if (!/^[a-fA-F0-9]{32,64}$/.test(h)) throw badRequest('invalid torrent hash');
  return h;
};

export const qbittorrent = {
  type: 'qbittorrent',
  name: 'qBittorrent',
  category: 'download',
  protocol: 'torrent',
  color: '#2f67ba',
  defaultPort: 8080,
  fields: [{ ...URL_FIELD, placeholder: 'http://192.168.1.10:8080' }, { ...USER_FIELD, placeholder: 'admin' }, PASS_FIELD],
  tabs: ['queue'],
  globalActions: [{ id: 'pauseAll', label: 'Pause all' }, { id: 'resumeAll', label: 'Resume all' }, { id: 'toggleAltSpeed', label: 'Toggle alt speed' }],
  speedLimit: true,

  async status(cfg) {
    // torrents/info doubles as the credential check; version and transfer/info are optional because
    // qBittorrent emulators (rdt-client, Decypharr, …) don't always implement them.
    const all = await api(cfg, 'torrents/info');
    const [version, info] = await Promise.all([
      api(cfg, 'app/version', { responseType: 'text' }).catch(() => null),
      api(cfg, 'transfer/info').catch(() => null),
    ]);
    const incomplete = all.filter((t) => toNum(t.progress) < 1);
    const downloading = incomplete.filter((t) => !isPaused(t.state));
    const sum = (key) => all.reduce((a, t) => a + toNum(t[key]), 0);
    return {
      version: version ? String(version).trim() : null,
      appName: 'qBittorrent',
      // rdt-client's transfer/info only counts its local download phase, while each torrent's dlspeed
      // also covers the Real-Debrid phase, so take whichever is larger (real qBittorrent: they match).
      downloadSpeed: Math.max(toNum(info?.dl_info_speed), sum('dlspeed')),
      uploadSpeed: info && info.up_info_speed !== undefined ? toNum(info.up_info_speed) : sum('upspeed'),
      // Finished torrents are "pausedUP"/"stoppedUP"; only unfinished ones decide whether the client is paused.
      paused: incomplete.length > 0 && incomplete.every((t) => isPaused(t.state)),
      queueCount: downloading.length,
      activeCount: all.filter((t) => t.dlspeed > 0 || t.upspeed > 0).length,
      sizeLeft: downloading.reduce((a, t) => a + toNum(t.amount_left), 0),
      speedLimit: info?.dl_rate_limit ? `${Math.round(info.dl_rate_limit / 1024)} KB/s` : null,
    };
  },

  resources: {
    async queue(cfg) {
      const [torrents, info] = await Promise.all([
        api(cfg, 'torrents/info?sort=added_on&reverse=true'),
        api(cfg, 'transfer/info').catch(() => null),
      ]);
      // rdt-client copies each torrent's download speed into upspeed although it never uploads; when the
      // client reports no upload at all, per-torrent upload figures can't be real.
      const noUpload = info && info.up_info_speed !== undefined && toNum(info.up_info_speed) === 0;
      return torrents.map((t) => ({
        id: t.hash,
        hash: t.hash,
        title: t.name,
        subtitle: [t.category, `ratio ${toNum(t.ratio).toFixed(2)}`, `${t.num_seeds}/${t.num_leechs} peers`].filter(Boolean).join(' · '),
        size: toNum(t.size || t.total_size),
        sizeLeft: toNum(t.amount_left),
        progress: toNum(t.progress) * 100,
        status: STATE_LABELS[t.state] || t.state,
        eta: t.eta > 0 && t.eta < 8640000 ? t.eta : null,
        speed: toNum(t.dlspeed),
        uploadSpeed: noUpload ? 0 : toNum(t.upspeed),
        category: t.category,
        protocol: 'torrent',
        completed: toNum(t.progress) >= 1,
        actions: [isPaused(t.state) ? 'resume' : 'pause', 'delete'],
      }));
    },
  },

  actions: {
    pauseAll: (cfg) => pauseResume(cfg, 'pause', 'all'),
    resumeAll: (cfg) => pauseResume(cfg, 'resume', 'all'),
    pause: (cfg, { id }) => pauseResume(cfg, 'pause', hashOf(id)),
    resume: (cfg, { id }) => pauseResume(cfg, 'resume', hashOf(id)),
    async delete(cfg, { id, deleteFiles = false }) {
      await api(cfg, 'torrents/delete', { form: { hashes: hashOf(id), deleteFiles: String(!!deleteFiles) } });
      return { ok: true };
    },
    async toggleAltSpeed(cfg) {
      await api(cfg, 'transfer/toggleSpeedLimitsMode', { form: {} });
      return { ok: true };
    },
    async setSpeedLimit(cfg, { value }) {
      const kb = Math.max(0, Math.round(toNum(value)));
      await api(cfg, 'transfer/setDownloadLimit', { form: { limit: String(kb * 1024) } });
      return { ok: true };
    },
  },
};

export function _resetQbSessions() { sessions.clear(); }
