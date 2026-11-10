import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ConfigStore, redact } from './config.js';
import { adapters, describeTypes, secretKeysFor } from './services/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

class HttpError extends Error {
  constructor(statusCode, message) { super(message); this.statusCode = statusCode; }
}

function send(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

async function readJson(req, limit = 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'invalid JSON body'); }
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function validateService(input, { partial = false } = {}) {
  const out = {};
  if (!partial || input.type !== undefined) {
    if (!adapters[input.type]) throw new HttpError(400, `unknown service type "${input.type}"`);
    out.type = input.type;
  }
  if (!partial || input.url !== undefined) {
    let u;
    try { u = new URL(String(input.url || '')); } catch { throw new HttpError(400, 'url must be a valid http(s) URL'); }
    if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, 'url must start with http:// or https://');
    out.url = u.toString().replace(/\/+$/, '');
  }
  if (input.name !== undefined || !partial) out.name = String(input.name || adapters[input.type]?.name || '').slice(0, 60);
  if (input.enabled !== undefined) out.enabled = !!input.enabled;
  if (input.showOnDashboard !== undefined) out.showOnDashboard = !!input.showOnDashboard;
  const type = out.type || input.type;
  for (const f of adapters[type]?.fields || []) {
    if (f.key === 'url') continue;
    if (input[f.key] !== undefined) out[f.key] = String(input[f.key]);
  }
  return out;
}

const publicService = (s) => {
  const a = adapters[s.type];
  return { ...redact(s, secretKeysFor(s.type)), category: a?.category, color: a?.color };
};

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${label} timed out`)), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

const errMessage = (err) => err?.message || String(err);

async function buildDashboard(store) {
  const services = store.list().filter((s) => s.enabled !== false);
  const start = new Date(Date.now() - 12 * 3600 * 1000);
  const end = new Date(Date.now() + 7 * 86400 * 1000);

  const results = await Promise.all(services.map(async (svc) => {
    const a = adapters[svc.type];
    const entry = { id: svc.id, name: svc.name || a.name, type: svc.type, category: a.category, color: a.color };
    const out = { entry, queue: [], calendar: [], health: [] };
    const t0 = Date.now();
    try {
      entry.status = { online: true, ...(await withTimeout(a.status(svc), 12000, 'status')) };
    } catch (err) {
      entry.status = { online: false, error: errMessage(err) };
      return out;
    }
    entry.status.latency = Date.now() - t0;
    if (svc.showOnDashboard === false) return out;
    const tag = (items) => items.map((i) => ({ ...i, serviceId: svc.id, serviceName: entry.name, serviceType: svc.type, color: a.color }));
    const jobs = [];
    if (a.category === 'download' && a.resources.queue) {
      // Failed items (e.g. dead Real-Debrid torrents) won't recover; they're reported under Health instead.
      jobs.push(a.resources.queue(svc).then((q) => { out.queue = tag(q.filter((i) => !i.completed && !i.failed)); }));
    }
    if (a.category === 'arr') {
      jobs.push(a.resources.calendar(svc, { start: start.toISOString(), end: end.toISOString() }).then((c) => { out.calendar = tag(c); }));
    }
    if (a.resources.health) {
      jobs.push(a.resources.health(svc).then((h) => { out.health = tag(h); }));
    }
    await Promise.allSettled(jobs.map((j) => withTimeout(j, 15000, 'dashboard')));
    return out;
  }));

  const services_ = results.map((r) => r.entry);
  const downloads = services_.filter((s) => s.category === 'download' && s.status.online);

  // A torrent sent through rdt-client (or another client) to Real-Debrid shows up in both. Keep the
  // client's row and drop the Real-Debrid copy, so it is listed and counted once.
  const queue = results.flatMap((r) => r.queue);
  const clientHashes = new Set(queue.filter((i) => i.serviceType !== 'realdebrid' && i.hash).map((i) => String(i.hash).toLowerCase()));
  const dupes = new Set(queue.filter((i) => i.serviceType === 'realdebrid' && i.hash && clientHashes.has(String(i.hash).toLowerCase())));
  const sumOf = (items, key) => [...items].reduce((a, i) => a + (i[key] || 0), 0);
  return {
    generatedAt: new Date().toISOString(),
    services: services_,
    totals: {
      downloadSpeed: Math.max(0, downloads.reduce((a, s) => a + (s.status.downloadSpeed || 0), 0) - sumOf(dupes, 'speed')),
      uploadSpeed: downloads.reduce((a, s) => a + (s.status.uploadSpeed || 0), 0),
      sizeLeft: Math.max(0, downloads.reduce((a, s) => a + (s.status.sizeLeft || 0), 0) - sumOf(dupes, 'sizeLeft')),
      online: services_.filter((s) => s.status.online).length,
      total: services_.length,
    },
    queue: queue.filter((i) => !dupes.has(i)).sort((a, b) => (b.speed || 0) - (a.speed || 0)),
    calendar: results.flatMap((r) => r.calendar).sort((a, b) => new Date(a.date) - new Date(b.date)),
    health: results.flatMap((r) => r.health),
  };
}

export function createServer({ dataDir, auth } = {}) {
  const store = new ConfigStore(dataDir || process.env.DATA_DIR || path.resolve(process.cwd(), 'data'));
  const authUser = auth?.username ?? process.env.AUTH_USERNAME;
  const authPass = auth?.password ?? process.env.AUTH_PASSWORD;

  const getService = (id) => {
    const svc = store.get(id);
    if (!svc) throw new HttpError(404, 'service not found');
    const adapter = adapters[svc.type];
    if (!adapter) throw new HttpError(500, `service type ${svc.type} is not supported`);
    return { svc, adapter };
  };

  const routes = [
    ['GET', /^\/api\/health$/, () => ({ ok: true })],
    ['GET', /^\/api\/types$/, () => describeTypes()],
    ['GET', /^\/api\/services$/, () => store.list().map(publicService)],
    ['POST', /^\/api\/services$/, async (req) => {
      const body = await readJson(req);
      return publicService(store.add(validateService(body)));
    }],
    ['POST', /^\/api\/services\/test$/, async (req) => {
      const body = await readJson(req);
      let cfg = validateService(body);
      if (body.id && store.get(body.id)) {
        // Re-use stored secrets that the browser never saw.
        const stored = store.get(body.id);
        for (const k of secretKeysFor(cfg.type)) if (!cfg[k] || cfg[k] === '__unchanged__') cfg[k] = stored[k];
      }
      cfg = { ...cfg };
      const t0 = Date.now();
      try {
        const status = await withTimeout(adapters[cfg.type].status(cfg), 15000, 'connection test');
        return { ok: true, latency: Date.now() - t0, status };
      } catch (err) {
        return { ok: false, error: errMessage(err) };
      }
    }],
    ['PUT', /^\/api\/services\/order$/, async (req) => {
      const { ids } = await readJson(req);
      if (!Array.isArray(ids)) throw new HttpError(400, 'ids must be an array');
      store.reorder(ids.map(String));
      return { ok: true };
    }],
    ['PUT', /^\/api\/services\/([\w-]+)$/, async (req, [id]) => {
      const { svc } = getService(id);
      const body = await readJson(req);
      const patch = validateService({ ...body, type: svc.type }, { partial: true });
      delete patch.type;
      return publicService(store.update(id, patch, secretKeysFor(svc.type)));
    }],
    ['DELETE', /^\/api\/services\/([\w-]+)$/, (req, [id]) => {
      if (!store.remove(id)) throw new HttpError(404, 'service not found');
      return { ok: true };
    }],
    ['GET', /^\/api\/services\/([\w-]+)\/status$/, async (req, [id]) => {
      const { svc, adapter } = getService(id);
      const t0 = Date.now();
      try {
        return { online: true, ...(await adapter.status(svc)), latency: Date.now() - t0 };
      } catch (err) {
        return { online: false, error: errMessage(err) };
      }
    }],
    ['GET', /^\/api\/services\/([\w-]+)\/image$/, async (req, [id], url, res) => {
      const { svc, adapter } = getService(id);
      if (!adapter.image) throw new HttpError(404, 'images not supported');
      const p = url.searchParams.get('path') || '';
      if (!p.startsWith('/') || p.startsWith('//') || p.includes('..')) throw new HttpError(400, 'invalid path');
      const img = await adapter.image(svc, p);
      if (!/^image\//.test(img.contentType)) throw new HttpError(502, 'upstream did not return an image');
      res.writeHead(200, { 'Content-Type': img.contentType, 'Cache-Control': 'private, max-age=86400' });
      res.end(img.body);
      return undefined;
    }],
    ['GET', /^\/api\/services\/([\w-]+)\/r\/(\w+)$/, async (req, [id, resource], url) => {
      const { svc, adapter } = getService(id);
      const fn = adapter.resources?.[resource];
      if (!fn) throw new HttpError(404, `resource "${resource}" not available for ${adapter.name}`);
      return fn(svc, Object.fromEntries(url.searchParams));
    }],
    ['POST', /^\/api\/services\/([\w-]+)\/a\/(\w+)$/, async (req, [id, action]) => {
      const { svc, adapter } = getService(id);
      const fn = adapter.actions?.[action];
      if (!fn) throw new HttpError(404, `action "${action}" not available for ${adapter.name}`);
      const body = await readJson(req);
      return (await fn(svc, body)) ?? { ok: true };
    }],
    ['GET', /^\/api\/dashboard$/, () => buildDashboard(store)],
  ];

  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.resolve(PUBLIC_DIR, `.${rel}`);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': rel === '/index.html' ? 'no-cache' : 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(buf);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (authUser && authPass && url.pathname !== '/api/health') {
      const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
      const [u, ...rest] = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':') : [];
      if (!(safeEqual(u ?? '', authUser) & safeEqual(rest.join(':'), authPass))) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="arr-monitor", charset="UTF-8"', 'Content-Type': 'text/plain' });
        res.end('Authentication required');
        return;
      }
    }

    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      serveStatic(req, res, url.pathname);
      return;
    }

    // Basic CSRF guard: state-changing API calls must be JSON (not a cross-site form post).
    if (req.method !== 'GET' && req.method !== 'DELETE' && !String(req.headers['content-type'] || '').includes('application/json')) {
      send(res, 415, { error: 'Content-Type must be application/json' });
      return;
    }

    for (const [method, pattern, handler] of routes) {
      if (req.method !== method) continue;
      const m = url.pathname.match(pattern);
      if (!m) continue;
      try {
        const result = await handler(req, m.slice(1), url, res);
        if (result !== undefined) send(res, 200, result);
      } catch (err) {
        const status = err.statusCode || (err.name === 'UpstreamError' ? 502 : 500);
        if (status >= 500 && err.name !== 'UpstreamError') console.error(err);
        if (!res.headersSent) send(res, status, { error: errMessage(err), upstreamStatus: err.status });
      }
      return;
    }
    send(res, 404, { error: 'not found' });
  });

  server.store = store;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8484;
  const host = process.env.HOST || '0.0.0.0';
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`arr-monitor listening on http://${host}:${port}`);
    if (!process.env.AUTH_USERNAME) console.log('Tip: set AUTH_USERNAME and AUTH_PASSWORD to protect the UI with a login.');
  });
}
