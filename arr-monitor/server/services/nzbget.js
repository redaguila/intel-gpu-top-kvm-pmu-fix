import { request, joinUrl, basicAuth, UpstreamError } from '../http.js';
import { URL_FIELD, USER_FIELD, PASS_FIELD, badRequest, toNum } from './common.js';

const MB = 1024 * 1024;
let rpcId = 0;

async function rpc(cfg, method, params = []) {
  const { data } = await request(joinUrl(cfg.url, '/jsonrpc'), {
    method: 'POST',
    headers: basicAuth(cfg.username, cfg.password),
    body: { version: '1.1', id: ++rpcId, method, params },
  });
  if (data?.error) throw new UpstreamError(data.error.message || 'NZBGet RPC error', 502);
  return data?.result;
}

const sizeMB = (lo, hi, mb) => (hi !== undefined ? (toNum(hi) * 4294967296 + toNum(lo)) : toNum(mb) * MB);

export const nzbget = {
  type: 'nzbget',
  name: 'NZBGet',
  category: 'download',
  protocol: 'usenet',
  color: '#3fa34d',
  defaultPort: 6789,
  fields: [{ ...URL_FIELD, placeholder: 'http://192.168.1.10:6789' }, { ...USER_FIELD, placeholder: 'nzbget' }, PASS_FIELD],
  tabs: ['queue', 'history'],
  globalActions: [{ id: 'pauseAll', label: 'Pause' }, { id: 'resumeAll', label: 'Resume' }],
  speedLimit: true,

  async status(cfg) {
    const [version, s] = await Promise.all([rpc(cfg, 'version'), rpc(cfg, 'status')]);
    return {
      version,
      appName: 'NZBGet',
      downloadSpeed: toNum(s.DownloadRate),
      uploadSpeed: null,
      paused: !!s.DownloadPaused,
      sizeLeft: sizeMB(s.RemainingSizeLo, s.RemainingSizeHi, s.RemainingSizeMB),
      diskFree: s.FreeDiskSpaceMB !== undefined ? toNum(s.FreeDiskSpaceMB) * MB : null,
      speedLimit: s.DownloadLimit ? `${Math.round(s.DownloadLimit / 1024)} KB/s` : null,
    };
  },

  resources: {
    async queue(cfg) {
      const [groups, s] = await Promise.all([rpc(cfg, 'listgroups', [0]), rpc(cfg, 'status')]);
      const rate = toNum(s.DownloadRate);
      return (groups || []).map((g) => {
        const size = sizeMB(g.FileSizeLo, g.FileSizeHi, g.FileSizeMB);
        const left = sizeMB(g.RemainingSizeLo, g.RemainingSizeHi, g.RemainingSizeMB);
        const downloading = g.Status === 'DOWNLOADING';
        return {
          id: g.NZBID,
          title: g.NZBName,
          subtitle: g.Category || '',
          size,
          sizeLeft: left,
          progress: size ? ((size - left) / size) * 100 : 0,
          status: g.Status,
          eta: downloading && rate ? Math.round(left / rate) : null,
          speed: downloading ? rate : 0,
          category: g.Category,
          protocol: 'usenet',
          actions: [g.Status === 'PAUSED' ? 'resume' : 'pause', 'delete'],
        };
      });
    },
    async history(cfg) {
      const items = await rpc(cfg, 'history', [false]);
      return (items || []).slice(0, 50).map((h) => ({
        id: h.NZBID,
        title: h.Name,
        subtitle: h.Category || '',
        event: h.Status,
        date: h.HistoryTime ? new Date(h.HistoryTime * 1000).toISOString() : null,
      }));
    },
  },

  actions: {
    async pauseAll(cfg) { await rpc(cfg, 'pausedownload'); return { ok: true }; },
    async resumeAll(cfg) { await rpc(cfg, 'resumedownload'); return { ok: true }; },
    async pause(cfg, { id }) { return edit(cfg, 'GroupPause', id); },
    async resume(cfg, { id }) { return edit(cfg, 'GroupResume', id); },
    async delete(cfg, { id }) { return edit(cfg, 'GroupFinalDelete', id); },
    async setSpeedLimit(cfg, { value }) {
      const kb = Math.max(0, Math.round(toNum(value)));
      await rpc(cfg, 'rate', [kb]);
      return { ok: true };
    },
  },
};

async function edit(cfg, command, id) {
  if (!id) throw badRequest('id is required');
  const ok = await rpc(cfg, 'editqueue', [command, '', [Number(id)]]);
  if (ok === false) throw new UpstreamError(`NZBGet rejected ${command}`, 502);
  return { ok: true };
}
