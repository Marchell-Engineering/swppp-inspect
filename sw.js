// The offline layer: keeps a copy of the app on the phone so it opens with no signal. Bump VERSION with
// every app change (tools/publish.sh does it), so phones pick up the new copy; the app then offers an
// Update button on the sites screen, never in the middle of an inspection.
const VERSION = 'v0.3.0-202611211924';
importScripts('js/upload_core.js');   // the upload steps the app uses too (SwpppUpload)
const CACHE = 'swppp-inspect-' + VERSION;
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js',
  'js/api.js',
  'js/bank.js',
  'js/checklist.js',
  'js/dom.js',
  'js/history.js',
  'js/media.js',
  'js/pdf.js',
  'js/settings.js',
  'js/store.js',
  'js/upload_core.js',
  'js/voice.js',
  'js/weather.js',
  'vendor/pdfmake.min.js',
  'vendor/vfs_fonts.js',
  'img/logo.png',
  'img/icon-192.png',
  'img/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('swppp-inspect-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  if (e.data === 'show-alerts') e.waitUntil(showAlerts());   // the same path a push takes (tests use it)
});

// Phone alerts (Brandon, 10/26): the Google script wakes the phone with an empty push, and the phone asks it
// what's new (the 'reminders' action) and shows that. Every push has to show something, so with no answer
// (no signal) a plain note shows instead.
self.addEventListener('push', (e) => e.waitUntil(showAlerts()));

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((wins) => (wins.length ? wins[0].focus() : self.clients.openWindow('./'))));
});

// the app's settings store (js/store.js), read and written from here
function kv(op, key, value) {
  return idb('kv', op, key, value).catch(() => undefined);
}

// One read or write on the app's store (js/store.js): op is get, put or all. Rejects when the store can't be
// read, so an upload stops rather than guessing.
function idb(store, op, key, value) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('swppp-inspect');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      try {
        const t = req.result.transaction(store, op === 'put' ? 'readwrite' : 'readonly');
        const s = t.objectStore(store);
        const r = op === 'all' ? s.getAll() : op === 'get' ? s.get(key) : s.keyPath ? s.put(value) : s.put(value, key);
        t.oncomplete = () => { req.result.close(); resolve(op === 'put' ? undefined : r.result); };
        t.onerror = () => { req.result.close(); reject(t.error); };
      } catch (err) {
        req.result.close();
        reject(err);
      }
    };
  });
}

// Background upload (Brandon, 11/21): the app asks for it when it leaves the screen or loses signal with a report
// still waiting, and Chrome runs it once there is signal, app open or not (Android only; an iPhone uploads while
// the app is open). Chrome caps how long one pass runs and doesn't say how long, so a pass stops between steps
// after BG_BUDGET_MS and asks for another; each step is saved, so nothing is sent twice.
const BG_BUDGET_MS = 150e3;
const BG_LOCK_WAIT_MS = 20e3;   // the app, just sent to the background, lets go of the upload between steps

self.addEventListener('sync', (e) => {
  if (e.tag === SwpppUpload.SYNC_TAG) e.waitUntil(backgroundUpload());
});

async function backgroundUpload() {
  const U = SwpppUpload;
  const t0 = Date.now();
  const done = await U.withLock(BG_LOCK_WAIT_MS, async (held) => {
    if (!held) return { busy: true };   // the app is uploading on screen
    const code = await kv('get', 'code');
    const url = await kv('get', 'backend_url');
    if (!code || !url) return { filed: [] };
    const io = {
      code,
      call: (payload, ms) => U.post(url, payload, ms),
      getReport: (id) => idb('reports', 'get', id),
      putReport: (r) => idb('reports', 'put', null, r),
      getBlob: (k) => idb('blobs', 'get', k),
      stop: () => Date.now() - t0 > BG_BUDGET_MS,
    };
    const waiting = (await idb('reports', 'all')).filter((r) => r.status === 'signed');
    const filed = [];
    for (const r of waiting) {
      try {
        if (await U.uploadOne(r.id, io)) filed.push(r);
      } catch (err) {
        if (err.name === 'Paused') return { filed, more: true };
        await tellApp(filed);
        throw err;   // no signal, or the script refused: Chrome tries again later
      }
    }
    return { filed };
  });
  if (done.busy) return;
  if (done.more) await self.registration.sync.register(U.SYNC_TAG).catch(() => {});
  await tellApp(done.filed);
}

// An open app shows its own "Report filed"; with none on screen, a phone with alerts on gets a notice.
async function tellApp(filed) {
  if (!filed || !filed.length) return;
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const w of wins) w.postMessage({ type: 'uploaded', filed: filed.length });
  if (wins.some((w) => w.visibilityState === 'visible')) return;
  if (self.Notification && Notification.permission !== 'granted') return;
  for (const r of filed) {
    const site = (r.data && r.data.site && (r.data.site.short_name || r.data.site.name)) || 'Report';
    await self.registration.showNotification('Report filed', {
      body: `${site}, ${(r.data && r.data.date) || ''}: uploaded in the background.`.replace(', :', ':'),
      tag: 'swppp-filed-' + r.id, icon: 'img/icon-192.png', badge: 'img/icon-192.png',
    }).catch(() => {});
  }
}

async function showAlerts() {
  let msgs = [];
  try {
    const code = await kv('get', 'code');
    const url = await kv('get', 'backend_url');
    const since = (await kv('get', 'alerts_seen_ms')) || 0;
    if (code && url) {
      const r = await fetch(url, { method: 'POST', body: JSON.stringify({ action: 'reminders', code, since }), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
      const out = await r.json();
      if (out.ok) msgs = out.messages || [];
    }
  } catch (err) { /* no signal: the plain note below */ }
  if (!msgs.length) {
    return self.registration.showNotification('SWPPP Inspect', { body: 'Something is due. Open the app to see it.', tag: 'swppp-due', icon: 'img/icon-192.png' });
  }
  for (const m of msgs.slice().reverse()) {
    await self.registration.showNotification(m.title, { body: m.body, tag: m.tag || undefined, icon: 'img/icon-192.png', badge: 'img/icon-192.png' });
  }
  await kv('put', 'alerts_seen_ms', Math.max(...msgs.map((m) => m.at)));
}

// App files come from the phone's copy; everything else (weather, the upload server) goes to the network.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).catch(() => caches.match('index.html'))),
  );
});
