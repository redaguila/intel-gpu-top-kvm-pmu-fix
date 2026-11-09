// Small fetch wrapper used by every service adapter.

export class UpstreamError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.body = body;
  }
}

export function joinUrl(base, path) {
  const b = String(base || '').replace(/\/+$/, '');
  const p = String(path || '');
  return p.startsWith('/') ? b + p : `${b}/${p}`;
}

export function basicAuth(username, password) {
  if (!username && !password) return {};
  const token = Buffer.from(`${username || ''}:${password || ''}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

/**
 * Perform an HTTP request.
 * @returns {Promise<{status:number, headers:Headers, data:any}>}
 */
export async function request(url, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    form,
    timeout = Number(process.env.UPSTREAM_TIMEOUT_MS) || 10000,
    accept = [200, 201, 202, 204],
    responseType = 'auto',
  } = opts;

  const h = { Accept: 'application/json, text/plain, */*', ...headers };
  let payload;
  if (form) {
    payload = new URLSearchParams(form).toString();
    h['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    if (!h['Content-Type']) h['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(url, { method, headers: h, body: payload, signal: controller.signal, redirect: 'follow' });
  } catch (err) {
    clearTimeout(timer);
    const reason = err.name === 'AbortError' ? `timed out after ${timeout}ms` : (err.cause?.code || err.cause?.message || err.message);
    throw new UpstreamError(`Cannot reach ${new URL(url).host}: ${reason}`, 0);
  }

  let data;
  try {
    if (responseType === 'buffer') {
      data = Buffer.from(await res.arrayBuffer());
    } else {
      const text = await res.text();
      const ct = res.headers.get('content-type') || '';
      if (responseType === 'text') data = text;
      else if (text && (responseType === 'json' || ct.includes('json') || /^[\[{]/.test(text.trim()))) {
        try { data = JSON.parse(text); } catch { data = text; }
      } else data = text;
    }
  } finally {
    clearTimeout(timer);
  }

  if (accept !== 'any' && !accept.includes(res.status)) {
    let detail = '';
    if (data && typeof data === 'object') detail = data.message || data.error || data.title || '';
    else if (typeof data === 'string') detail = data.slice(0, 200);
    const hint = res.status === 401 || res.status === 403 ? ' (check API key / credentials)' : '';
    throw new UpstreamError(`HTTP ${res.status}${hint}${detail ? `: ${detail}` : ''}`, res.status, data);
  }
  return { status: res.status, headers: res.headers, data };
}
