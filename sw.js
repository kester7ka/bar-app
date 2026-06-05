const CACHE = 'bar-app-v7';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/nav.css',
  './css/home.css',
  './css/positions.css',
  './css/tools.css',
  './css/profile.css',
  './css/modal.css',
  './css/schedule.css',
  './css/calendar.css',
  './css/status.css',
  './css/scanner.css',
  './css/admin.css',
  './css/news.css',
  './css/auth.css',
  './css/kb.css',
  './js/api.js',
  './js/auth.js',
  './js/storage.js',
  './js/utils.js',
  './js/nav.js',
  './js/home.js',
  './js/positions.js',
  './js/tools.js',
  './js/profile.js',
  './js/schedule.js',
  './js/calendar.js',
  './js/status.js',
  './js/weather.js',
  './js/qr.js',
  './js/scanner.js',
  './js/admin.js',
  './js/news.js',
  './js/kb_data.js',
  './js/kb.js',
  './js/app.js',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const passthrough =
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('railway.app') ||
    url.hostname.includes('jsdelivr.net') ||
    url.hostname.includes('open-meteo.com') ||
    url.hostname.includes('disk.yandex') ||
    url.hostname.includes('cloud-api.yandex');
  if (passthrough) return;
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).then((resp) => {
      if (e.request.method === 'GET' && resp.ok && url.origin === self.location.origin) {
        const clone = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
      }
      return resp;
    }).catch(() => caches.match('./index.html')))
  );
});
