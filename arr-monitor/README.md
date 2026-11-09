# arr monitor

A self-hosted web dashboard to **monitor and control your whole \*arr stack from one place**: every phone, tablet and desktop browser gets the same view. It is inspired by mobile apps like nzb360 but runs as a small web server on your own network.

* **Zero dependencies.** Plain Node.js (≥ 20), no build step and no `npm install`.
* **Secrets stay on the server.** API keys and passwords are stored in `data/config.json` and are never sent back to the browser. The browser only talks to arr monitor, which talks to your services.
* **Mobile-first, dark/light UI** that you can install as a PWA ("Add to Home screen").

## Supported services

| Category | Services | What you can do |
|---|---|---|
| Media managers | **Sonarr, Radarr, Lidarr, Readarr** | Queue (remove / blocklist), calendar, library browser with posters, filters and sorting, wanted / missing with per-item search, history, health, disk space, **add new series / movies / artists / authors**, search all missing, RSS sync, refresh |
| Indexer manager | **Prowlarr** | Search all indexers and grab results, indexer health (failing / disabled), history |
| Subtitles | **Bazarr** | Wanted subtitles for episodes and movies, history, health, trigger searches |
| Usenet clients | **SABnzbd, NZBGet** | Live speed, queue with progress and ETA, pause / resume / delete items, pause / resume everything, speed limit, history (with failure reasons) |
| Torrent clients | **qBittorrent (4.x & 5.x), Transmission, Deluge**, plus qBittorrent-compatible clients such as **rdt-client** | Live up/down speed, torrents with progress / ratio / peers, pause / resume / delete (optionally with files), pause / resume all, alt-speed toggle, speed limit |
| Debrid | **Real-Debrid** | Account type and premium days left (with a warning before it expires), cloud torrents with progress and speed, failed torrents, delete, unrestricted-download history |
| Requests | **Overseerr, Jellyseerr** | Request list with posters and status, approve / decline pending requests |
| Statistics | **Tautulli** | Current streams (direct play vs transcode, bandwidth), watch history |

The **dashboard** combines everything: total download and upload speed, remaining size, service health, one merged queue across all download clients (with *Pause all* and *Resume all*), the next 7 days of releases from every \*arr calendar, and every health warning.

## Quick start

### Docker (recommended)

```bash
cd arr-monitor
docker compose up -d --build
# open http://<your-server>:8484
```

Configuration is stored in `./config/config.json`.

### Node.js

```bash
cd arr-monitor
npm start            # http://localhost:8484
```

Then open **Settings → Add service**, pick a service, enter its URL and API key (or username and password), click **Test connection**, then **Add service**.

Where to find the credentials:

| Service | Credential |
|---|---|
| Sonarr / Radarr / Lidarr / Readarr / Prowlarr | Settings → General → Security → API Key |
| Bazarr | Settings → General → Security → API Key |
| SABnzbd | Config → General → Security → API Key |
| NZBGet | Settings → Security → ControlUsername / ControlPassword |
| qBittorrent | Web UI username / password |
| Transmission | RPC username / password (leave empty if disabled) |
| Deluge | Web UI password |
| rdt-client | Add it as **qBittorrent**, with the same URL, username and password Sonarr/Radarr use for it |
| Real-Debrid | API token from https://real-debrid.com/apitoken (the API URL is pre-filled) |
| Overseerr / Jellyseerr | Settings → General → API Key |
| Tautulli | Settings → Web Interface → API Key |

Season packs (and multi-album / multi-book releases) show as one row in the *arr queue, with removal applying to the whole pack.

If a service runs behind a URL base (e.g. `http://host/sonarr`), include it in the URL.

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `PORT` | `8484` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` (`/config` in Docker) | Where `config.json` is stored |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | unset | Enables HTTP Basic auth for the whole UI and API |
| `UPSTREAM_TIMEOUT_MS` | `10000` | Timeout for calls to your services |

> **Security:** anyone who can open arr monitor can control your services. Set `AUTH_USERNAME`/`AUTH_PASSWORD`, or put it behind a reverse proxy with authentication (Authelia, Authentik, Cloudflare Access, Tailscale…), before exposing it outside your LAN.

## Development

```bash
npm run mock   # fake *arr stack on http://127.0.0.1:9999/<service>
npm run dev    # app with auto-restart on http://localhost:8484
npm test       # integration tests against the mock stack
```

The mock stack implements every supported service under its own path, for example `http://127.0.0.1:9999/sonarr` or `http://127.0.0.1:9999/qbittorrent`. It uses API key `test-api-key`, username `admin` and password `secret`, so you can explore the UI without a real setup.

### Architecture

```
public/            Single-page app (vanilla JS, no build step)
server/index.js    HTTP server: REST API, static files, auth, dashboard aggregation
server/config.js   Persistent service config with secret redaction
server/services/   One adapter per service type, all with the same shape:
                   { status(), resources: { queue, calendar, library, ... }, actions: { pause, add, ... } }
test/              Mock upstream services + integration tests (node:test)
```

To add a new service, write an adapter in `server/services/` that returns the normalised shapes, register it in `server/services/index.js`, and the UI picks it up automatically: the settings form, tabs and actions are all driven by the adapter's metadata.

REST API (used by the UI):

| Method & path | Purpose |
|---|---|
| `GET /api/dashboard` | Aggregated status, queue, calendar, health |
| `GET /api/types` | Supported service types and their fields/tabs |
| `GET/POST /api/services`, `PUT/DELETE /api/services/:id` | Manage services |
| `POST /api/services/test` | Test a connection |
| `GET /api/services/:id/status` | Service status |
| `GET /api/services/:id/r/:resource` | `queue`, `calendar`, `library`, `wanted`, `history`, `health`, `indexers`, `search`, `requests`, `activity` |
| `POST /api/services/:id/a/:action` | `pause`, `resume`, `delete`, `pauseAll`, `resumeAll`, `setSpeedLimit`, `searchMissing`, `lookup`, `add`, `grab`, `approve`, … |
