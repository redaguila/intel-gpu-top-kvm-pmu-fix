// Persistent service configuration. Secrets never leave the server:
// they are replaced with a placeholder when sent to the browser.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SECRET_PLACEHOLDER = '__unchanged__';

export class ConfigStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'config.json');
    this.data = { services: [] };
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = { services: Array.isArray(parsed.services) ? parsed.services : [] };
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`[config] could not read ${this.file}: ${err.message}`);
      this.data = { services: [] };
    }
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  list() { return this.data.services; }
  get(id) { return this.data.services.find((s) => s.id === id); }

  add(service) {
    const s = { ...service, id: crypto.randomUUID(), enabled: service.enabled !== false };
    this.data.services.push(s);
    this.save();
    return s;
  }

  update(id, patch, secretKeys = []) {
    const idx = this.data.services.findIndex((s) => s.id === id);
    if (idx < 0) return null;
    const current = this.data.services[idx];
    const next = { ...current, ...patch, id };
    for (const key of secretKeys) {
      if (patch[key] === SECRET_PLACEHOLDER || patch[key] === undefined) next[key] = current[key];
    }
    this.data.services[idx] = next;
    this.save();
    return next;
  }

  remove(id) {
    const before = this.data.services.length;
    this.data.services = this.data.services.filter((s) => s.id !== id);
    if (this.data.services.length !== before) { this.save(); return true; }
    return false;
  }

  reorder(ids) {
    const byId = new Map(this.data.services.map((s) => [s.id, s]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
    for (const s of this.data.services) if (!ids.includes(s.id)) ordered.push(s);
    this.data.services = ordered;
    this.save();
  }
}

/** Strip secret values before sending a service config to the browser. */
export function redact(service, secretKeys) {
  const out = { ...service };
  for (const key of secretKeys) {
    if (out[key]) out[key] = SECRET_PLACEHOLDER;
  }
  return out;
}
