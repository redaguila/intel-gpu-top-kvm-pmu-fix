// Real-Debrid account and cloud torrents (https://api.real-debrid.com/).
import { request, joinUrl } from '../http.js';
import { badRequest, toNum } from './common.js';

const STATUS = {
  magnet_conversion: 'Converting magnet', waiting_files_selection: 'Waiting for file selection', queued: 'Queued',
  downloading: 'Downloading', downloaded: 'Downloaded', compressing: 'Compressing', uploading: 'Uploading',
  magnet_error: 'Magnet error', error: 'Error', virus: 'Virus detected', dead: 'Dead',
};
const FAILED = new Set(['magnet_error', 'error', 'virus', 'dead']);
const DAY = 86400;

const api = (cfg, path, opts = {}) => request(joinUrl(cfg.url || 'https://api.real-debrid.com', `/rest/1.0/${path}`), {
  ...opts,
  headers: { Authorization: `Bearer ${cfg.apiKey || ''}` },
}).then((r) => (Array.isArray(r.data) || (r.data && typeof r.data === 'object') ? r.data : []));

const premiumDays = (user) => Math.max(0, Math.floor(toNum(user.premium) / DAY));

export const realdebrid = {
  type: 'realdebrid',
  name: 'Real-Debrid',
  category: 'download',
  protocol: 'torrent',
  color: '#7cb342',
  defaultPort: 443,
  webUrl: 'https://real-debrid.com/torrents',
  fields: [
    { key: 'url', label: 'API URL', type: 'url', required: true, default: 'https://api.real-debrid.com', placeholder: 'https://api.real-debrid.com' },
    { key: 'apiKey', label: 'API token', type: 'password', required: true, help: 'real-debrid.com/apitoken' },
  ],
  tabs: ['queue', 'history', 'health'],
  globalActions: [],

  async status(cfg) {
    const [user, torrents] = await Promise.all([api(cfg, 'user'), api(cfg, 'torrents?limit=500').catch(() => [])]);
    const active = torrents.filter((t) => !['downloaded', ...FAILED].includes(t.status));
    return {
      version: null,
      appName: 'Real-Debrid',
      account: user.username,
      downloadSpeed: active.reduce((a, t) => a + toNum(t.speed), 0),
      uploadSpeed: null,
      paused: false,
      queueCount: active.length,
      sizeLeft: active.reduce((a, t) => a + toNum(t.bytes) * (1 - toNum(t.progress) / 100), 0),
      counts: {
        Account: user.type === 'premium' ? 'Premium' : 'Free',
        'Premium days left': premiumDays(user),
        Torrents: torrents.length,
        Points: toNum(user.points),
      },
    };
  },

  resources: {
    async queue(cfg) {
      const torrents = await api(cfg, 'torrents?limit=500');
      return torrents.map((t) => {
        const size = toNum(t.bytes);
        const progress = toNum(t.progress);
        const speed = toNum(t.speed);
        const failed = FAILED.has(t.status);
        const left = size * (1 - progress / 100);
        return {
          id: t.id,
          hash: t.hash,
          title: t.filename,
          subtitle: [t.host, t.links?.length ? `${t.links.length} link(s)` : null, t.seeders ? `${t.seeders} seeders` : null].filter(Boolean).join(' · '),
          size,
          sizeLeft: left,
          progress,
          status: STATUS[t.status] || t.status,
          warning: failed
            ? 'Failed on Real-Debrid and will not recover. Delete it, then blocklist the release in its *arr app so it searches for another.'
            : (t.status === 'waiting_files_selection' ? 'Select files on real-debrid.com to start this torrent' : null),
          eta: !failed && speed > 0 ? Math.round(left / speed) : null,
          failed,
          speed,
          protocol: 'torrent',
          completed: t.status === 'downloaded',
          added: t.added,
          actions: ['delete'],
        };
      });
    },
    async history(cfg) {
      const downloads = await api(cfg, 'downloads?limit=50');
      return downloads.map((d) => ({
        id: d.id,
        title: d.filename,
        subtitle: [d.host, d.filesize ? `${(toNum(d.filesize) / 1073741824).toFixed(2)} GB` : null].filter(Boolean).join(' · '),
        event: 'unrestricted',
        date: d.generated,
      }));
    },
    async health(cfg) {
      const [user, torrents] = await Promise.all([api(cfg, 'user'), api(cfg, 'torrents?limit=500').catch(() => [])]);
      const out = [];
      if (user.type !== 'premium') out.push({ type: 'error', source: 'Account', message: 'Real-Debrid premium has expired; downloads will stop working.' });
      else if (toNum(user.premium) < 7 * DAY) out.push({ type: 'warning', source: 'Account', message: `Real-Debrid premium expires in ${premiumDays(user)} day(s).` });
      const failed = torrents.filter((t) => FAILED.has(t.status));
      if (failed.length) out.push({ type: 'warning', source: 'Torrents', message: `${failed.length} torrent(s) failed on Real-Debrid (${failed.slice(0, 3).map((t) => t.filename).join(', ')}${failed.length > 3 ? ', …' : ''}).` });
      return out;
    },
  },

  actions: {
    async delete(cfg, { id }) {
      const tid = String(id || '');
      if (!/^[A-Za-z0-9]+$/.test(tid)) throw badRequest('invalid torrent id');
      await api(cfg, `torrents/delete/${tid}`, { method: 'DELETE' });
      return { ok: true };
    },
  },
};
