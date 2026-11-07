/* Umzug von GitHub Pages zur neuen Adresse.
   Leer = kein Umzug. Sobald die neue Adresse läuft, wird sie hier eingetragen. */
(function(){
  var NEW = '';
  if (!NEW || !/github\.io$/.test(location.hostname)) return;
  var path = location.pathname.replace(/^\/wasgibts/, '') || '/';
  var target = NEW.replace(/\/$/, '') + path + location.search + location.hash;
  document.documentElement.innerHTML = '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Wir sind umgezogen</title>' +
    '<style>html,body{margin:0;height:100%;background:#F4F5F0;color:#16201A;font:17px/1.45 -apple-system,system-ui,sans-serif}' +
    '@media (prefers-color-scheme:dark){html,body{background:#0E130F;color:#E8EEE8}}' +
    'main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px 24px;box-sizing:border-box;gap:14px}' +
    'h1{font-size:30px;margin:0;letter-spacing:-.02em}p{margin:0;max-width:340px;color:#5D6A60}@media (prefers-color-scheme:dark){p{color:#97A59B}}' +
    'a{display:inline-block;margin-top:8px;background:#2F7A4C;color:#fff;text-decoration:none;font-weight:800;padding:15px 24px;border-radius:16px}' +
    'small{color:#5D6A60;max-width:320px}</style></head><body><main><div style="font-size:64px">🏡</div><h1>Wir sind umgezogen!</h1>' +
    '<p>„Was gibt\'s?" hat eine neue Adresse. Alle eure Daten sind noch da – du musst dich nur einmal neu anmelden.</p>' +
    '<a href="' + target + '">Zur neuen Adresse</a>' +
    '<small>Tipp: Danach die App über „Teilen → Zum Home-Bildschirm" neu hinzufügen und die alte löschen.</small></main></body>';
  setTimeout(function(){ location.replace(target); }, 4000);
})();
