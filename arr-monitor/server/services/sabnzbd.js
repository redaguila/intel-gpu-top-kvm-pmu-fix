import { request, joinUrl, UpstreamError } from '../http.js';
import { URL_FIELD, API_KEY_FIELD, badRequest, parseTimeLeft, toNum } from './common.js';

const MB = 1024 * 1024;

async function api(cfg, params) {
  const q = new URLSearchParams({ output: 'json', apikey: cfg.apiKey || '', ...params });
  const { data } = await request(joinUrl(cfg.url, `/api?${q}`));
  if (data && typeof data === 'object' && data.status === false && data.error) throw new UpstreamError(data.error, 401);
  if (typeof data === 'string' && /api key/i.test(data)) throw new UpstreamError(data.trim(), 401);
  return data;
}

const DOWNLOAD_ACTIONS = { pause: 'pause', resume: 'resume', delete: 'delete' };

export const sabnzbd = {
  type: 'sabnzbd',
  name: 'SABnzbd',
  category: 'download',
  protocol: 'usenet',
  color: '#f5c518',
  defaultPort: 8080,
  fields: [{ ...URL_FIELD, placeholder: 'http://192.168.1.10:8080' }, { ...API_KEY_FIELD, help: 'Config → General → Security' }],
  tabs: ['queue', 'history'],
  globalActions: [{ id: 'pauseAll', label: 'Pause' }, { id: 'resumeAll', label: 'Resume' }],
  speedLimit: true,

  async status(cfg) {
    const [v, q] = await Promise.all([api(cfg, { mode: 'version' }), api(cfg, { mode: 'queue', limit: '0' })]);
    const queue = q.queue || {};
    return {
      version: v.version,
      appName: 'SABnzbd',
      downloadSpeed: toNum(queue.kbpersec) * 1024,
      uploadSpeed: null,
      paused: !!queue.paused,
      sizeLeft: toNum(queue.mbleft) * MB,
      queueCount: toNum(queue.noofslots_total ?? queue.noofslots),
      diskFree: queue.diskspace1 ? toNum(queue.diskspace1) * 1024 * MB : null,
      speedLimit: queue.speedlimit ? `${queue.speedlimit}%` : null,
    };
  },

  resources: {
    async queue(cfg) {
      const q = await api(cfg, { mode: 'queue', limit: '200' });
      const queue = q.queue || {};
      const speed = toNum(queue.kbpersec) * 1024;
      return (queue.slots || []).map((s, i) => ({
        id: s.nzo_id,
        title: s.filename,
        subtitle: s.cat && s.cat !== '*' ? s.cat : '',
        size: toNum(s.mb) * MB,
        sizeLeft: toNum(s.mbleft) * MB,
        progress: toNum(s.percentage),
        status: s.status,
        eta: parseTimeLeft(s.timeleft),
        speed: i === 0 && s.status === 'Downloading' ? speed : 0,
        category: s.cat,
        protocol: 'usenet',
        actions: [s.status === 'Paused' ? 'resume' : 'pause', 'delete'],
      }));
    },
    async history(cfg) {
      const h = await api(cfg, { mode: 'history', limit: '50' });
      return (h.history?.slots || []).map((s) => ({
        id: s.nzo_id,
        title: s.name,
        subtitle: [s.category, s.size].filter(Boolean).join(' · '),
        event: s.status,
        error: s.fail_message || null,
        date: s.completed ? new Date(s.completed * 1000).toISOString() : null,
      }));
    },
  },

  actions: {
    async pauseAll(cfg) { await api(cfg, { mode: 'pause' }); return { ok: true }; },
    async resumeAll(cfg) { await api(cfg, { mode: 'resume' }); return { ok: true }; },
    async pause(cfg, { id }) { return item(cfg, 'pause', id); },
    async resume(cfg, { id }) { return item(cfg, 'resume', id); },
    async delete(cfg, { id }) { return item(cfg, 'delete', id); },
    async setSpeedLimit(cfg, { value }) {
      // value: percentage of the configured line speed ("0"/"" = no limit) or e.g. "5M".
      const v = String(value ?? '').trim() || '100';
      if (!/^\d+(\.\d+)?[KM%]?$/i.test(v)) throw badRequest('invalid speed limit');
      await api(cfg, { mode: 'config', name: 'speedlimit', value: v });
      return { ok: true };
    },
  },
};

async function item(cfg, action, id) {
  if (!id) throw badRequest('id is required');
  const params = { mode: 'queue', name: DOWNLOAD_ACTIONS[action], value: String(id) };
  if (action === 'delete') params.del_files = '1';
  await api(cfg, params);
  return { ok: true };
}
