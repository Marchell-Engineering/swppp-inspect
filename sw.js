// The offline layer: keeps a copy of the app on the phone so it opens with no signal. Bump VERSION with
// every app change (tools/publish.sh does it), so phones pick up the new copy; the app then offers an
// Update button on the sites screen, never in the middle of an inspection.
const VERSION = 'v0.1.0-202610221503';
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
});

// App files come from the phone's copy; everything else (weather, the upload server) goes to the network.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).catch(() => caches.match('index.html'))),
  );
});
