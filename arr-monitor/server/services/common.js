export const URL_FIELD = { key: 'url', label: 'URL', type: 'url', required: true, placeholder: 'http://192.168.1.10:8989' };
export const API_KEY_FIELD = { key: 'apiKey', label: 'API key', type: 'password', required: true, help: 'Settings → General → Security' };
export const USER_FIELD = { key: 'username', label: 'Username', type: 'text' };
export const PASS_FIELD = { key: 'password', label: 'Password', type: 'password' };

export function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

export const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/** Parse "H:MM:SS", "D:HH:MM:SS" or .NET-style "D.HH:MM:SS" into seconds. */
export function parseTimeLeft(str) {
  if (str === null || str === undefined || str === '') return null;
  if (typeof str === 'number') return str;
  const parts = String(str).replace('.', ':').split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  const units = [86400, 3600, 60, 1].slice(-parts.length);
  return parts.reduce((acc, n, i) => acc + n * units[i], 0);
}

export function isoDate(d) {
  return d.toISOString();
}

/** Run async fn over items with limited concurrency. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = undefined; }
    }
  });
  await Promise.all(workers);
  return out;
}
