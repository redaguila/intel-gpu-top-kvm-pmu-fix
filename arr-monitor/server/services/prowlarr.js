import { request, joinUrl } from '../http.js';
import { URL_FIELD, API_KEY_FIELD, badRequest } from './common.js';

const api = (cfg, path, opts = {}) => request(joinUrl(cfg.url, `/api/v1/${path}`), {
  timeout: 30000,
  ...opts,
  headers: { 'X-Api-Key': cfg.apiKey || '' },
}).then((r) => r.data);

export const prowlarr = {
  type: 'prowlarr',
  name: 'Prowlarr',
  category: 'indexer',
  color: '#e66000',
  defaultPort: 9696,
  fields: [{ ...URL_FIELD, placeholder: 'http://192.168.1.10:9696' }, API_KEY_FIELD],
  tabs: ['search', 'indexers', 'history', 'health'],
  globalActions: [{ id: 'testAll', label: 'Test all indexers' }],

  async status(cfg) {
    const s = await api(cfg, 'system/status');
    return { version: s.version, appName: 'Prowlarr' };
  },

  resources: {
    async indexers(cfg) {
      const [indexers, statuses] = await Promise.all([api(cfg, 'indexer'), api(cfg, 'indexerstatus').catch(() => [])]);
      const byId = new Map((statuses || []).map((s) => [s.indexerId, s]));
      return indexers.map((i) => {
        const st = byId.get(i.id);
        return {
          id: i.id, title: i.name, protocol: i.protocol, enabled: i.enable,
          privacy: i.privacy, priority: i.priority,
          failing: !!st, disabledTill: st?.disabledTill || null,
          info: [i.protocol, i.privacy].filter(Boolean).join(' · '),
        };
      }).sort((a, b) => a.title.localeCompare(b.title));
    },
    async history(cfg) {
      const data = await api(cfg, 'history?page=1&pageSize=50&sortKey=date&sortDirection=descending');
      return (data.records || []).map((r) => ({
        id: r.id,
        title: r.data?.query || r.data?.grabTitle || r.eventType,
        subtitle: [r.data?.source, r.data?.queryResults ? `${r.data.queryResults} results` : null].filter(Boolean).join(' · '),
        event: r.eventType + (r.successful === false ? ' (failed)' : ''),
        date: r.date,
      }));
    },
    async health(cfg) {
      const items = await api(cfg, 'health');
      return (items || []).map((h) => ({ type: h.type, source: h.source, message: h.message, wikiUrl: h.wikiUrl }));
    },
    async search(cfg, query) {
      const term = String(query.term || '').trim();
      if (!term) return [];
      const params = new URLSearchParams({ query: term, type: 'search', limit: '100' });
      if (query.categories) for (const c of String(query.categories).split(',')) params.append('categories', c);
      const results = await api(cfg, `search?${params}`);
      return (results || []).map((r) => ({
        id: r.guid,
        guid: r.guid,
        indexerId: r.indexerId,
        title: r.title,
        indexer: r.indexer,
        size: r.size,
        seeders: r.seeders ?? null,
        leechers: r.leechers ?? null,
        grabs: r.grabs ?? null,
        protocol: r.protocol,
        date: r.publishDate,
        age: r.age,
        categories: (r.categories || []).map((c) => c.name).slice(0, 2).join(', '),
        infoUrl: r.infoUrl,
      })).sort((a, b) => (b.seeders ?? b.grabs ?? 0) - (a.seeders ?? a.grabs ?? 0));
    },
  },

  actions: {
    async grab(cfg, { guid, indexerId }) {
      if (!guid || !indexerId) throw badRequest('guid and indexerId are required');
      await api(cfg, 'search', { method: 'POST', body: { guid, indexerId: Number(indexerId) } });
      return { ok: true };
    },
    async testAll(cfg) {
      await api(cfg, 'indexer/testall', { method: 'POST', body: {}, accept: [200, 400] });
      return { ok: true };
    },
  },
};
