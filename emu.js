/* =========================================================================
   WAS GIBT'S? – iPhone am Computer: bedienen wie ein echtes iPhone
   Sperrbildschirm (nach oben wischen), Home-Bildschirm mit Widgets,
   App öffnen/schließen mit Zoom, Home-Strich, Seitentaste, Lautstärke,
   Action-Taste (Stumm). Läuft nur in der Computer-Ansicht (html.framed).
   Icons: Icons8 (https://icons8.com), lokal in /icons.
   ========================================================================= */
const html = document.documentElement;
const $ = s => document.querySelector(s);
const screen = $('#screen'), phone = $('#phone');
const framed = () => html.classList.contains('framed');
const cooking = () => html.classList.contains('cooking');
const ic = (n, cls = '') => `<i class="ic8 ${cls}" style="--ic:url('icons/${n}.png')" aria-hidden="true"></i>`;
const EASE = 'cubic-bezier(.2,.9,.25,1)';
const DAYS = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const data = () => { try { return (window.__wgEmu && window.__wgEmu()) || {}; } catch(e){ return {}; } };

/* ---------- Aufbau ---------- */
const SB = `<span class="emu-time"></span><span class="emu-ic">
  <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5" width="3" height="7" rx="1"/><rect x="10" y="2.5" width="3" height="9.5" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
  <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.2-1.3C13.3 1.5 10.8.4 8 .4S2.7 1.5.8 3.3L2 4.6c1.6-1.5 3.7-2.4 6-2.4zm0 3.6c1.3 0 2.6.5 3.5 1.4l1.2-1.3C11.5 4.7 9.8 4 8 4s-3.5.7-4.7 1.9l1.2 1.3c.9-.9 2.2-1.4 3.5-1.4zM8 9.4c-.6 0-1.1.2-1.5.6L8 11.6 9.5 10c-.4-.4-.9-.6-1.5-.6z"/></svg>
  <svg width="27" height="13" viewBox="0 0 27 13" fill="none"><rect x=".5" y=".5" width="23" height="12" rx="3.5" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="17" height="9" rx="2" fill="currentColor"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2z" fill="currentColor" opacity=".4"/></svg></span>`;
const emu = document.createElement('div');
emu.id = 'emu';
emu.innerHTML = `
  <div class="emu-wall"></div>
  <div class="emu-sb">${SB}</div>
  <div class="emu-home" aria-label="Home-Bildschirm">
    <div class="emu-widgets"></div>
    <div class="emu-grid">
      <button class="emu-app" data-emu="open" aria-label="Was gibt's? öffnen"><img src="icon-192.png" alt=""><span>Was gibt's?</span></button>
    </div>
    <div class="emu-search">${ic('search')} Suchen</div>
    <div class="emu-dock"><button class="emu-app" data-emu="open" aria-label="Was gibt's? öffnen"><img src="icon-192.png" alt=""></button></div>
  </div>
  <div class="emu-lock" aria-label="Sperrbildschirm">
    <div class="emu-lockic">${ic('lock')}</div>
    <div class="emu-date"></div>
    <div class="emu-clock"></div>
    <div class="emu-notes"></div>
    <button class="emu-round l" data-emu="torch" aria-label="Taschenlampe">${ic('torch')}</button>
    <button class="emu-round r" data-emu="cam" aria-label="Kamera">${ic('cam')}</button>
    <div class="emu-hint">Zum Öffnen nach oben wischen</div>
  </div>
  <div class="emu-off"></div>`;
const bar = document.createElement('div'); bar.id = 'emu-bar'; bar.title = 'Nach oben ziehen';
const hud = document.createElement('div'); hud.id = 'emu-hud'; hud.innerHTML = `${ic('vol')}<div class="emu-hud-track"><i></i></div>`;
const isl = document.createElement('div'); isl.className = 'emu-isl';
screen.appendChild(emu); screen.appendChild(bar); screen.appendChild(hud);
const island = $('#island'); island && island.appendChild(isl);

/* ---------- Zustand ---------- */
let state = 'lock', prevState = 'home', volume = 9, silent = false;
try { const s = sessionStorage.getItem('wg.emu'); if (s === 'app' || s === 'home') state = s; } catch(e){}
function set(s){ state = s; emu.dataset.s = s; bar.dataset.s = s; html.dataset.emu = s; try { sessionStorage.setItem('wg.emu', s === 'off' ? 'lock' : s); } catch(e){} }
set(state);

/* ---------- Uhr, Datum, Mitteilungen, Widgets ---------- */
function tick(){
  const d = new Date(), hm = d.getHours() + ':' + String(d.getMinutes()).padStart(2,'0');
  emu.querySelector('.emu-time').textContent = hm;
  emu.querySelector('.emu-clock').textContent = hm;
  emu.querySelector('.emu-date').textContent = `${DAYS[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
}
function fill(){
  const x = data();
  const notes = [];
  (x.wishes || []).slice(0, 2).forEach(w => notes.push({ t:`${w.name} wünscht sich ${w.dish}`, s:'Tippe, um es dir anzusehen' }));
  if (x.expiring) notes.push({ t:'Bald aufbrauchen', s:x.expiring });
  if (!notes.length) notes.push(x.user ? { t:`Was gibt's heute${x.name ? ', ' + x.name : ''}?`, s:x.pick ? `Vorschlag: ${x.pick}` : 'Öffne die App für Ideen' } : { t:'Willkommen bei „Was gibt\'s?"', s:'Öffne die App, um loszulegen' });
  emu.querySelector('.emu-notes').innerHTML = notes.map((n, i) => `<div class="emu-note" style="--i:${i}"><img src="icon-192.png" alt=""><div><div class="emu-nh"><b>Was gibt's?</b><span>${i ? 'vor 1 Std.' : 'jetzt'}</span></div><div class="emu-nt">${esc(n.t)}</div><div class="emu-ns">${esc(n.s)}</div></div></div>`).join('');
  emu.querySelector('.emu-widgets').innerHTML = `
    <button class="emu-w big" data-emu="open" data-tab="home"><span class="emu-wk">${ic('chef')} Heute</span><b>${esc(x.planned || x.pick || 'Was gibt\'s heute?')}</b><span class="emu-ws">${x.planned ? 'Auf dem Wochenplan' : x.pick ? 'Unser Vorschlag' : 'Tippe für Ideen'}</span><span class="emu-wl">Was gibt's?</span></button>
    <button class="emu-w" data-emu="open" data-tab="fridge"><span class="emu-wk">${ic('cart')} Einkauf</span><b class="emu-num">${x.shop ?? 0}</b><span class="emu-ws">${(x.shop ?? 0) === 1 ? 'Sache' : 'Sachen'} auf der Liste</span><span class="emu-wl">Was gibt's?</span></button>`;
}
tick(); fill(); setInterval(tick, 5000); setInterval(() => { if (state !== 'app') fill(); }, 15000);

/* ---------- Übergänge ---------- */
const layer = c => emu.querySelector(c);
function unlock(){
  if (state !== 'lock') return;
  const lk = layer('.emu-lock');
  lk.animate([{ transform:getComputedStyle(lk).transform === 'none' ? 'translateY(0)' : getComputedStyle(lk).transform, opacity:1 }, { transform:'translateY(-100%)', opacity:0 }], { duration:380, easing:EASE });
  layer('.emu-home').animate([{ transform:'scale(.9)', opacity:0 }, { transform:'none', opacity:1 }], { duration:420, easing:EASE });
  lk.style.transform = '';
  set('home');
}
function openApp(tab){
  if (state === 'app') return;
  const icon = emu.querySelector('.emu-grid .emu-app img'), sr = screen.getBoundingClientRect(), s = sr.width / screen.offsetWidth;
  const r = icon.getBoundingClientRect(), x = (r.left - sr.left) / s, y = (r.top - sr.top) / s, w = r.width / s;
  const z = document.createElement('div'); z.className = 'emu-zoom';
  z.innerHTML = `<img src="icon-192.png" alt="">`; screen.appendChild(z);
  const W = screen.offsetWidth, H = screen.offsetHeight;
  z.animate([{ left:x+'px', top:y+'px', width:w+'px', height:w+'px', borderRadius:'14px' }, { left:'0px', top:'0px', width:W+'px', height:H+'px', borderRadius:'53px' }], { duration:420, easing:EASE, fill:'forwards' });
  z.querySelector('img').animate([{ opacity:1, transform:'scale(1)' }, { opacity:0, transform:'scale(1.6)' }], { duration:300, easing:'ease-out', fill:'forwards' });
  layer('.emu-home').animate([{ transform:'none', opacity:1 }, { transform:'scale(1.12)', opacity:0 }], { duration:380, easing:EASE, fill:'forwards' });
  if (tab && window.__wgGo) window.__wgGo(tab);
  setTimeout(() => {
    set('app'); layer('.emu-home').getAnimations().forEach(a => a.cancel());
    z.animate([{ opacity:1 }, { opacity:0 }], { duration:180, fill:'forwards' }).onfinish = () => z.remove();
  }, 400);
}
function goHome(){
  if (state !== 'app' || cooking()) return;
  if (document.querySelector('.sheet') && window.__wgCloseSheet) window.__wgCloseSheet();
  set('home'); fill();
  const icon = emu.querySelector('.emu-grid .emu-app img'), sr = screen.getBoundingClientRect(), s = sr.width / screen.offsetWidth;
  const r = icon.getBoundingClientRect(), x = (r.left - sr.left) / s, y = (r.top - sr.top) / s, w = r.width / s;
  const z = document.createElement('div'); z.className = 'emu-zoom'; z.innerHTML = `<img src="icon-192.png" alt="">`; screen.appendChild(z);
  const W = screen.offsetWidth, H = screen.offsetHeight;
  z.animate([{ left:'0px', top:'0px', width:W+'px', height:H+'px', borderRadius:'53px' }, { left:x+'px', top:y+'px', width:w+'px', height:w+'px', borderRadius:'14px' }], { duration:400, easing:EASE, fill:'forwards' }).onfinish = () => z.remove();
  z.querySelector('img').animate([{ opacity:0 }, { opacity:1 }], { duration:400, easing:'ease-in', fill:'forwards' });
  layer('.emu-home').animate([{ transform:'scale(1.12)', opacity:0 }, { transform:'none', opacity:1 }], { duration:420, easing:EASE });
}
function power(){
  if (state === 'off'){ set('lock'); fill(); tick(); layer('.emu-off').animate([{ opacity:1 }, { opacity:0 }], { duration:260 }); return; }
  prevState = state; layer('.emu-off').animate([{ opacity:0 }, { opacity:1 }], { duration:200, fill:'none' });
  setTimeout(() => set('off'), 180);
}
let hudT = 0;
function vol(d){
  volume = Math.max(0, Math.min(16, volume + d));
  hud.querySelector('.emu-hud-track i').style.height = (volume / 16 * 100) + '%';
  hud.classList.add('on'); clearTimeout(hudT); hudT = setTimeout(() => hud.classList.remove('on'), 1400);
}
let islT = 0;
function action(){
  silent = !silent;
  isl.innerHTML = `${ic(silent ? 'mute' : 'bellf', silent ? 'mute' : '')}<b>${silent ? 'Stumm' : 'Klingeln'}</b>`;
  island.classList.add('wide', 'emu-on'); clearTimeout(islT);
  islT = setTimeout(() => island.classList.remove('wide', 'emu-on'), 1600);
}

/* ---------- Bedienung ---------- */
emu.addEventListener('click', e => {
  const t = e.target.closest('[data-emu]'); if (!t) return;
  const a = t.dataset.emu;
  if (a === 'open') openApp(t.dataset.tab);
  else if (a === 'torch' || a === 'cam') t.animate([{ transform:'scale(1)' }, { transform:'scale(1.18)' }, { transform:'scale(1)' }], { duration:260 });
});
emu.querySelector('.emu-notes').addEventListener('click', () => { if (state === 'lock') unlock(); });
// Wischen: vom Home-Strich nach oben (Sperrbildschirm → entsperren, App → Home)
let drag = null;
function down(e){ if (!framed() || cooking()) return; drag = { y:e.clientY, dy:0, from:state }; bar.setPointerCapture && bar.setPointerCapture(e.pointerId); }
function move(e){ if (!drag) return; drag.dy = Math.min(0, e.clientY - drag.y);
  const s = screen.getBoundingClientRect().height / screen.offsetHeight, dy = drag.dy / s;
  if (drag.from === 'lock') layer('.emu-lock').style.transform = `translateY(${dy}px)`;
  if (drag.from === 'app'){ const k = Math.max(.82, 1 + dy / 1400); $('#views').style.transform = `scale(${k}) translateY(${dy * .35}px)`; $('#views').style.borderRadius = '40px'; } }
function up(){ if (!drag) return; const s = screen.getBoundingClientRect().height / screen.offsetHeight, dy = drag.dy / s, from = drag.from; drag = null;
  const lk = layer('.emu-lock'), v = $('#views'); v.style.transform = ''; v.style.borderRadius = '';
  if (from === 'lock'){ if (dy < -70) unlock(); else { lk.animate([{ transform:`translateY(${dy}px)` }, { transform:'translateY(0)' }], { duration:300, easing:EASE }); lk.style.transform = ''; } }
  else if (from === 'app' && dy < -50) goHome();
  else if (from === 'lock' || from === 'home'){}
}
bar.addEventListener('pointerdown', down); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
bar.addEventListener('click', () => { if (state === 'lock') unlock(); });
// Auf dem Sperrbildschirm geht auch: irgendwo nach oben ziehen oder Mausrad
const lockEl = layer('.emu-lock');
lockEl.addEventListener('pointerdown', e => { if (e.target.closest('[data-emu]')) return; down(e); });
emu.addEventListener('wheel', e => { if (state === 'lock' && e.deltaY > 20) unlock(); }, { passive:true });
// Tasten am Gehäuse
const btn = (sel, fn) => { const b = phone.querySelector(sel); if (b){ b.setAttribute('role', 'button'); b.addEventListener('click', e => { e.stopPropagation(); if (framed()) fn(); }); } };
btn('.b1', action); btn('.b2', () => vol(+1)); btn('.b3', () => vol(-1)); btn('.b4', power); btn('.b5', () => { if (state !== 'app') openApp(); });
// Tastatur: Esc = Home, Ende = Seitentaste
window.addEventListener('keydown', e => { if (!framed()) return;
  if (e.key === 'Escape' && state === 'app' && !document.querySelector('.sheet')) goHome();
  if (e.key === 'Enter' && state === 'lock') unlock(); });
// Bei neuen Daten Widgets und Mitteilungen auffrischen
window.addEventListener('wg:data', () => { if (state !== 'app') fill(); });
window.__wgEmuState = () => state;
