// Service Worker: macht die App installierbar und offline startbar.
// Bei jeder neuen Version die Zahl erhöhen, damit Handys das Update laden.
const CACHE = 'wasgibts-v22';
const FILES = ['./', './index.html', './styles.css', './app.js', './data.js', './config.js', './manifest.webmanifest', './icon.svg', './fonts/Figtree.woff', './fonts/Bricolage.woff', './lib/qrcode.min.js', ...Array.from({ length: 10 }, (_, i) => `./rezepte/${i + 1}.js`)];

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

// Push-Nachrichten aus dem Admin-Panel anzeigen
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "Was gibt's?", body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || "Was gibt's?", {
    body: d.body || '', icon: './icon-192.png', badge: './icon-192.png', data: { url: d.url || './' }, lang: 'de',
  }));
});
// Antippen öffnet die App (oder holt das offene Fenster nach vorne)
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data && e.notification.data.url || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const tab = new URL(target).searchParams.get('tab');
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c){ if (tab) c.postMessage({ tab }); return c.focus(); }
    return clients.openWindow(target);
  }));
});
