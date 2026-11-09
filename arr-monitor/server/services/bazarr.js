import { request, joinUrl } from '../http.js';
import { URL_FIELD, API_KEY_FIELD } from './common.js';

const api = (cfg, path, opts = {}) => request(joinUrl(cfg.url, `/api/${path}`), {
  ...opts,
  headers: { 'X-API-KEY': cfg.apiKey || '' },
}).then((r) => r.data);

const langs = (list) => (list || []).map((l) => l.code2 || l.name).filter(Boolean);

export const bazarr = {
  type: 'bazarr',
  name: 'Bazarr',
  category: 'subtitles',
  color: '#a4a4a4',
  defaultPort: 6767,
  fields: [{ ...URL_FIELD, placeholder: 'http://192.168.1.10:6767' }, { ...API_KEY_FIELD, help: 'Settings → General → Security' }],
  tabs: ['wanted', 'history', 'health'],
  globalActions: [
    { id: 'searchWantedEpisodes', label: 'Search wanted episodes' },
    { id: 'searchWantedMovies', label: 'Search wanted movies' },
  ],

  async status(cfg) {
    const s = await api(cfg, 'system/status');
    let badges = null;
    try { badges = await api(cfg, 'badges'); } catch { /* optional */ }
    return {
      version: s.data?.bazarr_version || s.bazarr_version,
      appName: 'Bazarr',
      counts: badges ? { 'Wanted episodes': badges.episodes ?? 0, 'Wanted movies': badges.movies ?? 0, 'Provider issues': badges.providers ?? 0 } : null,
    };
  },

  resources: {
    async wanted(cfg) {
      const [eps, movies] = await Promise.all([
        api(cfg, 'episodes/wanted?start=0&length=100').catch(() => ({ data: [] })),
        api(cfg, 'movies/wanted?start=0&length=100').catch(() => ({ data: [] })),
      ]);
      return [
        ...(eps.data || []).map((e) => ({
          id: `e${e.sonarrEpisodeId}`,
          title: e.seriesTitle,
          subtitle: `${e.episode_number || ''} · ${e.episodeTitle || ''}`,
          tags: langs(e.missing_subtitles),
          kind: 'Episode',
        })),
        ...(movies.data || []).map((m) => ({
          id: `m${m.radarrId}`,
          title: m.title,
          subtitle: 'Movie',
          tags: langs(m.missing_subtitles),
          kind: 'Movie',
        })),
      ];
    },
    async history(cfg) {
      const [eps, movies] = await Promise.all([
        api(cfg, 'episodes/history?start=0&length=30').catch(() => ({ data: [] })),
        api(cfg, 'movies/history?start=0&length=30').catch(() => ({ data: [] })),
      ]);
      const rows = [
        ...(eps.data || []).map((h) => ({ title: h.seriesTitle, subtitle: `${h.episode_number || ''} · ${h.language?.name || ''} · ${h.provider || ''}`, event: h.description || 'subtitle', date: h.parsed_timestamp || h.timestamp })),
        ...(movies.data || []).map((h) => ({ title: h.title, subtitle: `${h.language?.name || ''} · ${h.provider || ''}`, event: h.description || 'subtitle', date: h.parsed_timestamp || h.timestamp })),
      ];
      return rows.map((r, i) => ({ id: i, ...r })).sort((a, b) => new Date(b.date) - new Date(a.date));
    },
    async health(cfg) {
      const h = await api(cfg, 'system/health');
      return (h.data || []).map((i) => ({ type: 'warning', source: i.object, message: i.issue }));
    },
  },

  actions: {
    async searchWantedEpisodes(cfg) {
      await api(cfg, 'system/tasks?taskid=wanted_search_missing_subtitles_series', { method: 'POST' });
      return { ok: true };
    },
    async searchWantedMovies(cfg) {
      await api(cfg, 'system/tasks?taskid=wanted_search_missing_subtitles_movies', { method: 'POST' });
      return { ok: true };
    },
  },
};
