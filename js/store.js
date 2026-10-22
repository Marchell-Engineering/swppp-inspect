// Everything the app keeps lives on the phone in IndexedDB, so a report survives no signal, a dead
// battery or the app being closed mid-walk. Three stores:
//   kv       settings and caches (the sign-in, the site list, weather per site, meter IDs)
//   reports  one record per inspection (draft -> signed -> filed)
//   blobs    photos, signatures and finished PDFs, keyed by id

const DB_NAME = 'swppp-inspect';
const DB_VERSION = 1;
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('reports')) d.createObjectStore('reports', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((r) => { out = r; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export const kv = {
  get: (k) => tx('kv', 'readonly', (s) => wrap(s.get(k))),
  set: (k, v) => tx('kv', 'readwrite', (s) => { s.put(v, k); }),
  del: (k) => tx('kv', 'readwrite', (s) => { s.delete(k); }),
};

export const reports = {
  get: (id) => tx('reports', 'readonly', (s) => wrap(s.get(id))),
  put: (r) => tx('reports', 'readwrite', (s) => { s.put(r); }),
  del: (id) => tx('reports', 'readwrite', (s) => { s.delete(id); }),
  all: () => tx('reports', 'readonly', (s) => wrap(s.getAll())),
};

export const blobs = {
  get: (k) => tx('blobs', 'readonly', (s) => wrap(s.get(k))),
  put: (k, b) => tx('blobs', 'readwrite', (s) => { s.put(b, k); }),
  del: (k) => tx('blobs', 'readwrite', (s) => { s.delete(k); }),
};

// Ask the browser not to clear our storage when the phone runs low (installed home-screen apps
// usually get this automatically).
export async function persist() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (e) { /* not supported */ }
  return false;
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
