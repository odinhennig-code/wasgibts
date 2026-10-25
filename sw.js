// Service Worker: macht die App installierbar und offline startbar.
// Bei jeder neuen Version die Zahl erhöhen, damit Handys das Update laden.
const CACHE = 'wasgibts-v7';
const FILES = ['./', './index.html', './styles.css', './app.js', './data.js', './config.js', './manifest.webmanifest', './icon.svg', './fonts/Figtree.woff', './fonts/Bricolage.woff', './lib/qrcode.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Eigene Dateien: erst Netz, bei Offline aus dem Speicher. Datenbank-Anfragen nie zwischenspeichern.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
