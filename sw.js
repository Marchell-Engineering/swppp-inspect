// The offline layer: keeps a copy of the app on the phone so it opens with no signal. Bump VERSION with
// every app change (tools/publish.sh does it), so phones pick up the new copy; the app then offers an
// Update button on the sites screen, never in the middle of an inspection.
const VERSION = 'v0.1.0-202610261702';
const CACHE = 'swppp-inspect-' + VERSION;
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js',
  'js/api.js',
  'js/checklist.js',
  'js/media.js',
  'js/pdf.js',
  'js/settings.js',
  'js/store.js',
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
  return new Promise((resolve) => {
    const req = indexedDB.open('swppp-inspect');
    req.onerror = () => resolve(undefined);
    req.onsuccess = () => {
      try {
        const t = req.result.transaction('kv', op === 'get' ? 'readonly' : 'readwrite');
        const r = op === 'get' ? t.objectStore('kv').get(key) : t.objectStore('kv').put(value, key);
        t.oncomplete = () => resolve(op === 'get' ? r.result : undefined);
        t.onerror = () => resolve(undefined);
      } catch (err) {
        resolve(undefined);
      }
    };
  });
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
