import { request, joinUrl, UpstreamError } from '../http.js';
import { URL_FIELD, API_KEY_FIELD, toNum } from './common.js';

async function cmd(cfg, command, params = {}) {
  const q = new URLSearchParams({ apikey: cfg.apiKey || '', cmd: command, ...params });
  const { data } = await request(joinUrl(cfg.url, `/api/v2?${q}`));
  const resp = data?.response;
  if (!resp || resp.result !== 'success') throw new UpstreamError(resp?.message || 'Tautulli API error', 502);
  return resp.data;
}

export const tautulli = {
  type: 'tautulli',
  name: 'Tautulli',
  category: 'stats',
  color: '#e5a00d',
  defaultPort: 8181,
  fields: [{ ...URL_FIELD, placeholder: 'http://192.168.1.10:8181' }, { ...API_KEY_FIELD, help: 'Settings → Web Interface → API' }],
  tabs: ['activity', 'history'],
  globalActions: [],

  async status(cfg) {
    const [info, activity] = await Promise.all([cmd(cfg, 'get_tautulli_info'), cmd(cfg, 'get_activity').catch(() => null)]);
    return {
      version: info?.tautulli_version,
      appName: 'Tautulli',
      counts: activity ? {
        Streams: toNum(activity.stream_count),
        Transcodes: toNum(activity.stream_count_transcode),
        'Bandwidth (Mbps)': Math.round(toNum(activity.total_bandwidth) / 100) / 10,
      } : null,
    };
  },

  resources: {
    async activity(cfg) {
      const a = await cmd(cfg, 'get_activity');
      return (a.sessions || []).map((s) => ({
        id: s.session_key || s.session_id,
        title: s.full_title || s.title,
        subtitle: [s.friendly_name || s.user, s.player, s.product].filter(Boolean).join(' · '),
        progress: toNum(s.progress_percent),
        state: s.state,
        decision: s.transcode_decision,
        quality: s.quality_profile,
        bandwidth: toNum(s.bandwidth) * 1000 / 8, // kbps → bytes/s
        poster: null,
      }));
    },
    async history(cfg) {
      const h = await cmd(cfg, 'get_history', { length: '50' });
      return (h.data || []).map((r) => ({
        id: r.row_id || r.reference_id,
        title: r.full_title,
        subtitle: [r.friendly_name || r.user, r.player].filter(Boolean).join(' · '),
        event: r.watched_status === 1 ? 'watched' : 'played',
        date: r.date ? new Date(r.date * 1000).toISOString() : null,
      }));
    },
  },
  actions: {},
};
