// Service Worker: macht die App installierbar und offline startbar.
// Bei jeder neuen Version die Zahl erhöhen, damit Handys das Update laden.
const CACHE = 'wasgibts-v44';
const FILES = ['./', './index.html', './styles.css', './app.js', './emu.js', './data.js', './config.js', './manifest.webmanifest', './icon.svg', './fonts/Figtree.woff', './fonts/Bricolage.woff', './lib/qrcode.min.js', './sponsor/pihill.png', './sponsor/pihill-white.png', ...Array.from({ length: 10 }, (_, i) => `./rezepte/${i + 1}.js`)];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Eigene Dateien: Schriften, Bibliotheken und Rezepte sofort aus dem Speicher (ändern sich kaum).
// Alles andere: erst Netz – aber höchstens 1,5 s warten, sonst sofort aus dem Speicher (schneller Start bei schlechtem Netz).
const STATIC = /\/(fonts|lib|rezepte|icons)\/|\.(png|svg|woff2?)$/;
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const fromNet = () => fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok){ const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; });
  if (STATIC.test(url.pathname)){
    e.respondWith(caches.match(e.request).then(hit => hit || fromNet()));
    return;
  }
  e.respondWith(new Promise(resolve => {
    let done = false; const finish = r => { if (!done && r){ done = true; resolve(r); } };
    const net = fromNet();
    const timer = setTimeout(() => caches.match(e.request).then(hit => finish(hit)), 1500);
    net.then(r => { clearTimeout(timer); finish(r); })
       .catch(() => { clearTimeout(timer); caches.match(e.request).then(hit => finish(hit)).then(() => { if (!done) caches.match('./index.html').then(r => finish(r || Response.error())); }); });
  }));
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
