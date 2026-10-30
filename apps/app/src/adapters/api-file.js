// api-file.js — IFileAdapter for the API client on Android. Android has no free filesystem for a
// WebView app, so a "collection folder" is a path in a small virtual file system kept in storage
// (same read/write/list/delete/mkdir contract the desktop adapter has over real folders).
// Collections live in the app, so back them up through the profile export.

const PREFIX = 'helm.android.apifs:';

const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');

export function createVirtualFs(storage = localStorage) {
  const fileKey = (p) => `${PREFIX}f:${norm(p)}`;
  const dirKey = (p) => `${PREFIX}d:${norm(p)}`;
  const keys = () => Array.from({ length: storage.length }, (_, i) => storage.key(i));
  const parent = (p) => norm(p).split('/').slice(0, -1).join('/');

  function mkdirSync(dir) {
    const parts = norm(dir).split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) storage.setItem(dirKey(parts.slice(0, i).join('/')), '1');
  }

  return {
    async read(path) {
      const v = storage.getItem(fileKey(path));
      if (v == null) throw new Error(`ENOENT: no such file '${path}'`);
      return v;
    },
    async write(path, text) {
      mkdirSync(parent(path));
      storage.setItem(fileKey(path), String(text));
    },
    async exists(path) {
      return storage.getItem(fileKey(path)) != null || storage.getItem(dirKey(path)) != null;
    },
    async list(dir) {
      const base = norm(dir);
      if (storage.getItem(dirKey(base)) == null) throw new Error(`ENOENT: no such directory '${dir}'`);
      const names = new Set();
      for (const key of keys()) {
        if (!key.startsWith(PREFIX)) continue;
        const path = key.slice(PREFIX.length + 2);
        if (parent(path) === base && path !== base) names.add(path.slice(base ? base.length + 1 : 0));
      }
      return [...names].sort();
    },
    async delete(path) {
      const base = norm(path);
      for (const key of keys()) {
        if (!key.startsWith(PREFIX)) continue;
        const p = key.slice(PREFIX.length + 2);
        if (p === base || p.startsWith(base + '/')) storage.removeItem(key);
      }
    },
    async mkdir(dir) { mkdirSync(dir); },
  };
}

export const apiFileAdapter = createVirtualFs();
