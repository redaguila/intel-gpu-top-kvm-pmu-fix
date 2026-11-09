// Sonarr, Radarr, Lidarr and Readarr share the same API design (v3 / v1).
import { request, joinUrl, UpstreamError } from '../http.js';
import { URL_FIELD, API_KEY_FIELD, badRequest, parseTimeLeft, toNum } from './common.js';

const pad = (n) => String(n ?? 0).padStart(2, '0');

const FLAVORS = {
  sonarr: {
    name: 'Sonarr', color: '#35c5f4', port: 8989, api: '/api/v3',
    media: 'series', mediaLabel: 'Series', mediaSingular: 'series', lookup: 'series/lookup',
    queueInclude: { includeSeries: true, includeEpisode: true },
    calendarInclude: { includeSeries: true },
    historyInclude: { includeSeries: true, includeEpisode: true },
    wantedInclude: { includeSeries: true },
    commands: { refreshAll: 'RefreshSeries', searchMissing: 'MissingEpisodeSearch' },
    itemSearch: (id) => ({ name: 'SeriesSearch', seriesId: id }),
    wantedSearch: (id) => ({ name: 'EpisodeSearch', episodeIds: [id] }),
    addOptions: { searchForMissingEpisodes: true, monitor: 'all' },
    recordTitle: (r) => r.series?.title
      ? `${r.series.title} S${pad(r.episode?.seasonNumber)}E${pad(r.episode?.episodeNumber)}`
      : null,
    recordSubtitle: (r) => r.episode?.title,
    calendarItem: (e) => ({
      id: e.id, title: e.series?.title || 'Unknown series',
      subtitle: `S${pad(e.seasonNumber)}E${pad(e.episodeNumber)} · ${e.title || 'TBA'}`,
      date: e.airDateUtc || e.airDate, hasFile: !!e.hasFile, monitored: e.monitored,
      poster: posterOf(e.series?.images),
    }),
    wantedItem: (e) => ({
      id: e.id, title: e.series?.title || 'Unknown series',
      subtitle: `S${pad(e.seasonNumber)}E${pad(e.episodeNumber)} · ${e.title || ''}`,
      date: e.airDateUtc || e.airDate,
    }),
    libraryItem: (s) => {
      const st = s.statistics || {};
      return {
        id: s.id, title: s.title, year: s.year, status: s.status, monitored: s.monitored,
        overview: s.overview, network: s.network, poster: posterOf(s.images),
        sizeOnDisk: st.sizeOnDisk || 0,
        progress: st.episodeCount ? Math.round((st.episodeFileCount / st.episodeCount) * 100) : 0,
        info: `${st.episodeFileCount ?? 0}/${st.episodeCount ?? 0} episodes`,
        added: s.added,
      };
    },
    lookupItem: (s) => ({ title: s.title, year: s.year, overview: s.overview, poster: posterOf(s.images), exists: !!s.id, extra: s.network }),
  },
  radarr: {
    name: 'Radarr', color: '#ffc230', port: 7878, api: '/api/v3',
    media: 'movie', mediaLabel: 'Movies', mediaSingular: 'movie', lookup: 'movie/lookup',
    queueInclude: { includeMovie: true },
    calendarInclude: {},
    historyInclude: { includeMovie: true },
    wantedInclude: {},
    commands: { refreshAll: 'RefreshMovie', searchMissing: 'MissingMoviesSearch' },
    itemSearch: (id) => ({ name: 'MoviesSearch', movieIds: [id] }),
    wantedSearch: (id) => ({ name: 'MoviesSearch', movieIds: [id] }),
    addOptions: { searchForMovie: true },
    recordTitle: (r) => r.movie?.title ? `${r.movie.title}${r.movie.year ? ` (${r.movie.year})` : ''}` : null,
    recordSubtitle: (r) => r.quality?.quality?.name,
    calendarItem: (m, start, end) => {
      const releases = [
        ['In cinemas', m.inCinemas], ['Digital release', m.digitalRelease], ['Physical release', m.physicalRelease],
      ].filter(([, d]) => d && (!start || (new Date(d) >= start && new Date(d) <= end)));
      const [label, date] = releases.sort((a, b) => new Date(a[1]) - new Date(b[1]))[0] || ['Release', m.inCinemas || m.digitalRelease];
      return {
        id: m.id, title: m.title, subtitle: `${label}${m.year ? ` · ${m.year}` : ''}`,
        date, hasFile: !!m.hasFile, monitored: m.monitored, poster: posterOf(m.images),
      };
    },
    wantedItem: (m) => ({ id: m.id, title: m.title, subtitle: m.year ? String(m.year) : '', date: m.digitalRelease || m.physicalRelease || m.inCinemas }),
    libraryItem: (m) => ({
      id: m.id, title: m.title, year: m.year, status: m.status, monitored: m.monitored,
      overview: m.overview, network: m.studio, poster: posterOf(m.images),
      sizeOnDisk: m.sizeOnDisk || m.statistics?.sizeOnDisk || 0,
      progress: m.hasFile ? 100 : 0,
      info: m.hasFile ? (m.movieFile?.quality?.quality?.name || 'Downloaded') : (m.isAvailable ? 'Missing' : 'Not available'),
      added: m.added,
    }),
    lookupItem: (m) => ({ title: m.title, year: m.year, overview: m.overview, poster: posterOf(m.images), exists: !!m.id, extra: m.studio }),
  },
  lidarr: {
    name: 'Lidarr', color: '#00a65b', port: 8686, api: '/api/v1',
    media: 'artist', mediaLabel: 'Artists', mediaSingular: 'artist', lookup: 'artist/lookup', metadataProfile: true,
    queueInclude: { includeArtist: true, includeAlbum: true },
    calendarInclude: { includeArtist: true },
    historyInclude: { includeArtist: true, includeAlbum: true },
    wantedInclude: { includeArtist: true },
    commands: { refreshAll: 'RefreshArtist', searchMissing: 'MissingAlbumSearch' },
    itemSearch: (id) => ({ name: 'ArtistSearch', artistId: id }),
    wantedSearch: (id) => ({ name: 'AlbumSearch', albumIds: [id] }),
    addOptions: { searchForMissingAlbums: true, monitor: 'all' },
    recordTitle: (r) => r.artist?.artistName ? `${r.artist.artistName}${r.album?.title ? ` – ${r.album.title}` : ''}` : null,
    recordSubtitle: (r) => r.quality?.quality?.name,
    calendarItem: (a) => ({
      id: a.id, title: a.artist?.artistName || 'Unknown artist', subtitle: a.title,
      date: a.releaseDate, hasFile: (a.statistics?.trackFileCount || 0) > 0, monitored: a.monitored,
      poster: posterOf(a.images, 'cover') || posterOf(a.artist?.images),
    }),
    wantedItem: (a) => ({ id: a.id, title: a.artist?.artistName || a.title, subtitle: a.title, date: a.releaseDate }),
    libraryItem: (a) => {
      const st = a.statistics || {};
      return {
        id: a.id, title: a.artistName, status: a.status, monitored: a.monitored,
        overview: a.overview, poster: posterOf(a.images),
        sizeOnDisk: st.sizeOnDisk || 0,
        progress: st.trackCount ? Math.round((st.trackFileCount / st.trackCount) * 100) : 0,
        info: `${st.trackFileCount ?? 0}/${st.trackCount ?? 0} tracks`,
        added: a.added,
      };
    },
    lookupItem: (a) => ({ title: a.artistName, overview: a.overview, poster: posterOf(a.images), exists: !!a.id, extra: a.disambiguation }),
  },
  readarr: {
    name: 'Readarr', color: '#8e2222', port: 8787, api: '/api/v1',
    media: 'author', mediaLabel: 'Authors', mediaSingular: 'author', lookup: 'author/lookup', metadataProfile: true,
    queueInclude: { includeAuthor: true, includeBook: true },
    calendarInclude: { includeAuthor: true },
    historyInclude: { includeAuthor: true, includeBook: true },
    wantedInclude: { includeAuthor: true },
    commands: { refreshAll: 'RefreshAuthor', searchMissing: 'MissingBookSearch' },
    itemSearch: (id) => ({ name: 'AuthorSearch', authorId: id }),
    wantedSearch: (id) => ({ name: 'BookSearch', bookIds: [id] }),
    addOptions: { searchForMissingBooks: true, monitor: 'all' },
    recordTitle: (r) => r.author?.authorName ? `${r.author.authorName}${r.book?.title ? ` – ${r.book.title}` : ''}` : null,
    recordSubtitle: (r) => r.quality?.quality?.name,
    calendarItem: (b) => ({
      id: b.id, title: b.author?.authorName || 'Unknown author', subtitle: b.title,
      date: b.releaseDate, hasFile: (b.statistics?.bookFileCount || 0) > 0, monitored: b.monitored,
      poster: posterOf(b.images, 'cover') || posterOf(b.author?.images),
    }),
    wantedItem: (b) => ({ id: b.id, title: b.author?.authorName || b.title, subtitle: b.title, date: b.releaseDate }),
    libraryItem: (a) => {
      const st = a.statistics || {};
      return {
        id: a.id, title: a.authorName, status: a.status, monitored: a.monitored,
        overview: a.overview, poster: posterOf(a.images),
        sizeOnDisk: st.sizeOnDisk || 0,
        progress: st.bookCount ? Math.round((st.bookFileCount / st.bookCount) * 100) : 0,
        info: `${st.bookFileCount ?? 0}/${st.bookCount ?? 0} books`,
        added: a.added,
      };
    },
    lookupItem: (a) => ({ title: a.authorName, overview: a.overview, poster: posterOf(a.images), exists: !!a.id }),
  },
};

function posterOf(images, coverType = 'poster') {
  if (!Array.isArray(images)) return null;
  const img = images.find((i) => i.coverType === coverType) || (coverType === 'poster' ? images.find((i) => i.coverType === 'cover') : null);
  if (!img) return null;
  // Prefer the public CDN URL so the browser can load it directly; local paths are proxied.
  if (img.remoteUrl) return img.remoteUrl;
  return img.url ? { local: img.url } : null;
}

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

function makeArr(type) {
  const f = FLAVORS[type];

  const api = (cfg, path, opts = {}) => request(joinUrl(cfg.url, `${f.api}/${path}`), {
    ...opts,
    headers: { 'X-Api-Key': cfg.apiKey || '', ...(opts.headers || {}) },
  }).then((r) => r.data);

  const command = (cfg, body) => api(cfg, 'command', { method: 'POST', body });

  const queueItem = (r) => {
    const size = toNum(r.size);
    const sizeLeft = toNum(r.sizeleft);
    const warn = r.trackedDownloadStatus && r.trackedDownloadStatus !== 'ok';
    return {
      id: r.id,
      title: f.recordTitle(r) || r.title,
      subtitle: f.recordSubtitle(r) || r.title,
      release: r.title,
      size, sizeLeft,
      progress: size ? Math.max(0, Math.min(100, ((size - sizeLeft) / size) * 100)) : 0,
      status: r.trackedDownloadState || r.status,
      warning: warn ? (r.statusMessages || []).flatMap((m) => m.messages || []).join(' ') || r.errorMessage || r.trackedDownloadStatus : null,
      eta: parseTimeLeft(r.timeleft),
      protocol: r.protocol,
      client: r.downloadClient,
      actions: ['remove', 'blocklist'],
    };
  };

  return {
    type,
    name: f.name,
    category: 'arr',
    color: f.color,
    defaultPort: f.port,
    mediaLabel: f.mediaLabel,
    mediaSingular: f.mediaSingular,
    fields: [{ ...URL_FIELD, placeholder: `http://192.168.1.10:${f.port}` }, API_KEY_FIELD],
    tabs: ['queue', 'calendar', 'library', 'wanted', 'history', 'health'],
    globalActions: [
      { id: 'searchMissing', label: 'Search all missing', confirm: true },
      { id: 'rssSync', label: 'RSS sync' },
      { id: 'refreshAll', label: `Refresh all ${f.mediaLabel.toLowerCase()}` },
    ],
    canAdd: true,

    async status(cfg) {
      const s = await api(cfg, 'system/status');
      let diskFree = null;
      try {
        const disks = await api(cfg, 'diskspace');
        if (Array.isArray(disks)) diskFree = disks.map((d) => ({ path: d.path, free: d.freeSpace, total: d.totalSpace }));
      } catch { /* optional */ }
      return { version: s.version, appName: s.appName || f.name, disks: diskFree };
    },

    resources: {
      async queue(cfg) {
        const data = await api(cfg, `queue${qs({ page: 1, pageSize: 200, ...f.queueInclude })}`);
        const records = Array.isArray(data) ? data : data.records || [];
        return records.map(queueItem);
      },

      async calendar(cfg, query) {
        const start = query.start ? new Date(query.start) : new Date(Date.now() - 86400000);
        const end = query.end ? new Date(query.end) : new Date(Date.now() + 14 * 86400000);
        const items = await api(cfg, `calendar${qs({ start: start.toISOString(), end: end.toISOString(), unmonitored: false, ...f.calendarInclude })}`);
        return (items || []).map((i) => f.calendarItem(i, start, end)).filter((i) => i.date)
          .sort((a, b) => new Date(a.date) - new Date(b.date));
      },

      async history(cfg) {
        const data = await api(cfg, `history${qs({ page: 1, pageSize: 50, sortKey: 'date', sortDirection: 'descending', ...f.historyInclude })}`);
        return (data.records || []).map((r) => ({
          id: r.id,
          title: f.recordTitle(r) || r.sourceTitle,
          subtitle: r.sourceTitle,
          event: r.eventType,
          date: r.date,
          quality: r.quality?.quality?.name,
        }));
      },

      async health(cfg) {
        const items = await api(cfg, 'health');
        return (items || []).map((h) => ({ type: h.type, source: h.source, message: h.message, wikiUrl: h.wikiUrl }));
      },

      async library(cfg) {
        const items = await api(cfg, f.media);
        return (items || []).map(f.libraryItem).sort((a, b) => String(a.title).localeCompare(String(b.title)));
      },

      async wanted(cfg) {
        try {
          const data = await api(cfg, `wanted/missing${qs({ page: 1, pageSize: 100, monitored: true, ...f.wantedInclude })}`);
          return (data.records || []).map(f.wantedItem);
        } catch (err) {
          // Older Radarr builds have no wanted endpoint – derive it from the library.
          if (type === 'radarr' && err instanceof UpstreamError && err.status === 404) {
            const movies = await api(cfg, 'movie');
            return movies.filter((m) => m.monitored && !m.hasFile && m.isAvailable).map(f.wantedItem);
          }
          throw err;
        }
      },
    },

    actions: {
      async rssSync(cfg) { return command(cfg, { name: 'RssSync' }); },
      async refreshAll(cfg) { return command(cfg, { name: f.commands.refreshAll }); },
      async searchMissing(cfg) { return command(cfg, { name: f.commands.searchMissing }); },
      async searchItem(cfg, { id }) {
        if (!id) throw badRequest('id is required');
        return command(cfg, f.itemSearch(Number(id)));
      },
      async searchWanted(cfg, { id }) {
        if (!id) throw badRequest('id is required');
        return command(cfg, f.wantedSearch(Number(id)));
      },
      async remove(cfg, { id }) {
        await api(cfg, `queue/${Number(id)}${qs({ removeFromClient: true, blocklist: false })}`, { method: 'DELETE' });
        return { ok: true };
      },
      async blocklist(cfg, { id }) {
        await api(cfg, `queue/${Number(id)}${qs({ removeFromClient: true, blocklist: true })}`, { method: 'DELETE' });
        return { ok: true };
      },
      async lookup(cfg, { term }) {
        if (!term) throw badRequest('term is required');
        const results = await api(cfg, `${f.lookup}${qs({ term })}`);
        return (results || []).slice(0, 30).map((raw) => ({ ...f.lookupItem(raw), raw }));
      },
      async addOptions(cfg) {
        const [qualityProfiles, rootFolders, metadataProfiles] = await Promise.all([
          api(cfg, 'qualityprofile'),
          api(cfg, 'rootfolder'),
          f.metadataProfile ? api(cfg, 'metadataprofile') : Promise.resolve([]),
        ]);
        return {
          qualityProfiles: qualityProfiles.map((p) => ({ id: p.id, name: p.name })),
          rootFolders: rootFolders.map((r) => ({ path: r.path, freeSpace: r.freeSpace })),
          metadataProfiles: metadataProfiles.map((p) => ({ id: p.id, name: p.name })),
        };
      },
      async add(cfg, { item, qualityProfileId, rootFolderPath, metadataProfileId, search = true }) {
        if (!item || typeof item !== 'object') throw badRequest('item is required');
        if (!qualityProfileId || !rootFolderPath) throw badRequest('qualityProfileId and rootFolderPath are required');
        const body = {
          ...item,
          qualityProfileId: Number(qualityProfileId),
          rootFolderPath,
          monitored: true,
          addOptions: { ...f.addOptions, ...Object.fromEntries(Object.keys(f.addOptions).filter((k) => k.startsWith('search')).map((k) => [k, !!search])) },
        };
        if (f.metadataProfile) body.metadataProfileId = Number(metadataProfileId);
        if (type === 'sonarr') {
          body.seasonFolder = true;
          // Sonarr v3 still requires a language profile; v4 removed the endpoint.
          try {
            const langs = await api(cfg, 'languageprofile');
            if (Array.isArray(langs) && langs[0]) body.languageProfileId = langs[0].id;
          } catch { /* Sonarr v4 */ }
        }
        if (type === 'radarr') body.minimumAvailability = item.minimumAvailability || 'released';
        const added = await api(cfg, f.media, { method: 'POST', body });
        return { ok: true, id: added?.id, title: added?.title || added?.artistName || added?.authorName };
      },
    },

    /** Fetch a local MediaCover image (path is relative to the host root). */
    async image(cfg, path) {
      const base = new URL(cfg.url);
      const target = new URL(path, base.origin);
      if (target.origin !== base.origin) throw badRequest('invalid image path');
      const r = await request(target.toString(), { headers: { 'X-Api-Key': cfg.apiKey || '' }, responseType: 'buffer' });
      return { contentType: r.headers.get('content-type') || 'image/jpeg', body: r.data };
    },
  };
}

export const sonarr = makeArr('sonarr');
export const radarr = makeArr('radarr');
export const lidarr = makeArr('lidarr');
export const readarr = makeArr('readarr');
