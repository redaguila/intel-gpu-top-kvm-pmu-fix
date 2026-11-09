// Overseerr and Jellyseerr share the same API.
import { request, joinUrl } from '../http.js';
import { URL_FIELD, API_KEY_FIELD, badRequest, mapLimit } from './common.js';

const REQUEST_STATUS = { 1: 'Pending', 2: 'Approved', 3: 'Declined', 4: 'Failed', 5: 'Completed' };
const MEDIA_STATUS = { 1: 'Unknown', 2: 'Pending', 3: 'Processing', 4: 'Partially available', 5: 'Available', 6: 'Deleted' };
const titleCache = new Map();

function makeSeerr(type, name, color) {
  const api = (cfg, path, opts = {}) => request(joinUrl(cfg.url, `/api/v1/${path}`), {
    ...opts,
    headers: { 'X-Api-Key': cfg.apiKey || '' },
  }).then((r) => r.data);

  async function mediaInfo(cfg, mediaType, tmdbId) {
    const key = `${cfg.url}|${mediaType}|${tmdbId}`;
    if (titleCache.has(key)) return titleCache.get(key);
    const d = await api(cfg, `${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}`);
    const info = {
      title: d.title || d.name || d.originalTitle || d.originalName,
      year: (d.releaseDate || d.firstAirDate || '').slice(0, 4),
      poster: d.posterPath ? `https://image.tmdb.org/t/p/w300${d.posterPath}` : null,
    };
    if (titleCache.size > 2000) titleCache.clear();
    titleCache.set(key, info);
    return info;
  }

  return {
    type, name, category: 'requests', color, defaultPort: 5055,
    fields: [{ ...URL_FIELD, placeholder: 'http://192.168.1.10:5055' }, { ...API_KEY_FIELD, help: 'Settings → General → API Key' }],
    tabs: ['requests'],
    globalActions: [],

    async status(cfg) {
      const [s, counts] = await Promise.all([api(cfg, 'status'), api(cfg, 'request/count').catch(() => null)]);
      return {
        version: s.version, appName: name,
        counts: counts ? { Pending: counts.pending, Approved: counts.approved, Processing: counts.processing, Available: counts.available } : null,
      };
    },

    resources: {
      async requests(cfg, query) {
        const filter = ['all', 'pending', 'approved', 'processing', 'available', 'unavailable', 'failed'].includes(query.filter) ? query.filter : 'all';
        const data = await api(cfg, `request?take=50&skip=0&sort=added&filter=${filter}`);
        const results = data.results || [];
        const infos = await mapLimit(results, 6, (r) => mediaInfo(cfg, r.type, r.media?.tmdbId));
        return results.map((r, i) => ({
          id: r.id,
          title: infos[i]?.title || `TMDB ${r.media?.tmdbId}`,
          year: infos[i]?.year,
          poster: infos[i]?.poster,
          mediaType: r.type,
          status: REQUEST_STATUS[r.status] || String(r.status),
          mediaStatus: MEDIA_STATUS[r.media?.status] || '',
          requestedBy: r.requestedBy?.displayName || r.requestedBy?.username || r.requestedBy?.plexUsername || r.requestedBy?.email,
          seasons: (r.seasons || []).map((s) => s.seasonNumber),
          date: r.createdAt,
          is4k: !!r.is4k,
          actions: r.status === 1 ? ['approve', 'decline'] : [],
        }));
      },
    },

    actions: {
      async approve(cfg, { id }) {
        if (!id) throw badRequest('id is required');
        await api(cfg, `request/${Number(id)}/approve`, { method: 'POST' });
        return { ok: true };
      },
      async decline(cfg, { id }) {
        if (!id) throw badRequest('id is required');
        await api(cfg, `request/${Number(id)}/decline`, { method: 'POST' });
        return { ok: true };
      },
    },
  };
}

export const overseerr = makeSeerr('overseerr', 'Overseerr', '#5a67d8');
export const jellyseerr = makeSeerr('jellyseerr', 'Jellyseerr', '#7c3aed');
