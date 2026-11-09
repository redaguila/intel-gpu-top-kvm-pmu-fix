import { sonarr, radarr, lidarr, readarr } from './arr.js';
import { prowlarr } from './prowlarr.js';
import { bazarr } from './bazarr.js';
import { sabnzbd } from './sabnzbd.js';
import { nzbget } from './nzbget.js';
import { qbittorrent } from './qbittorrent.js';
import { transmission } from './transmission.js';
import { deluge } from './deluge.js';
import { overseerr, jellyseerr } from './overseerr.js';
import { tautulli } from './tautulli.js';
import { realdebrid } from './realdebrid.js';

const all = [sonarr, radarr, lidarr, readarr, prowlarr, bazarr, sabnzbd, nzbget, qbittorrent, transmission, deluge, realdebrid, overseerr, jellyseerr, tautulli];

export const adapters = Object.fromEntries(all.map((a) => [a.type, a]));

export const secretKeysFor = (type) => (adapters[type]?.fields || []).filter((f) => f.type === 'password').map((f) => f.key);

/** Public, serialisable description of each service type for the UI. */
export function describeTypes() {
  return all.map((a) => ({
    type: a.type,
    name: a.name,
    category: a.category,
    color: a.color,
    defaultPort: a.defaultPort,
    fields: a.fields,
    tabs: a.tabs,
    globalActions: a.globalActions || [],
    canAdd: !!a.canAdd,
    speedLimit: !!a.speedLimit,
    webUrl: a.webUrl || null,
    mediaLabel: a.mediaLabel || null,
    mediaSingular: a.mediaSingular || null,
  }));
}
