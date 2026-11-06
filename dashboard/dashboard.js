/* =========================================================================
   WAS GIBT'S? – Admin-Dashboard (Version 4.1)
   Eigene Anmeldung (eigener Speicherplatz), damit sich App und Dashboard
   nicht mehr gegenseitig abmelden. Alle Daten über geschützte
   Datenbank-Funktionen, die selbst prüfen, ob ein App-Admin angemeldet ist.
   ========================================================================= */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

/* ---------- Anmeldung: eigener Schlüssel + Sicherung in der IndexedDB ---------- */
const store = (() => {
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((ok, no) => { try { const r = indexedDB.open('wasgibts-dashboard-auth', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); } catch(e){ no(e); } }));
  const tx = (mode, fn) => db().then(d => new Promise((ok, no) => { const t = d.transaction('kv', mode), st = t.objectStore('kv'), q = fn(st);
    t.oncomplete = () => ok(q && q.result); t.onerror = () => no(t.error); })).catch(() => null);
  const ls = { get:k => { try { return localStorage.getItem(k); } catch(e){ return null; } }, set:(k,v) => { try { localStorage.setItem(k, v); } catch(e){} }, del:k => { try { localStorage.removeItem(k); } catch(e){} } };
  return {
    async getItem(k){ const v = ls.get(k); if (v != null) return v; const b = await tx('readonly', st => st.get(k)); if (b != null) ls.set(k, b); return b ?? null; },
    async setItem(k, v){ ls.set(k, v); await tx('readwrite', st => st.put(v, k)); },
    async removeItem(k){ ls.del(k); await tx('readwrite', st => st.delete(k)); },
  };
})();
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth:{ storageKey:'wg-dashboard-auth', storage:store, persistSession:true, autoRefreshToken:true, detectSessionInUrl:false } });
try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(()=>{}); } catch(e){}
document.addEventListener('visibilitychange', () => { try {
  if (document.hidden) sb.auth.stopAutoRefresh(); else { sb.auth.startAutoRefresh(); sb.auth.getSession().catch(()=>{}); } } catch(e){} });

/* ---------- Helfer ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pl = (n, one, many) => `${n ?? 0} ${(n ?? 0) === 1 ? one : many}`;
const ic = n => `<i class="i" style="--m:url(ic/${n}.png)"></i>`;
const fmtDate = d => d ? new Date(d).toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '–';
const fmtTime = d => d ? new Date(d).toLocaleString('de-DE', { weekday:'short', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '–';
const dayKey = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
function ago(d){
  if (!d) return 'nie';
  const m = Math.round((Date.now() - new Date(d)) / 6e4);
  if (m < 2) return 'gerade eben'; if (m < 60) return `vor ${m} Min`;
  const h = Math.round(m / 60); if (h < 24) return `vor ${h} Std`;
  const t = Math.round(h / 24); return t === 1 ? 'gestern' : `vor ${t} Tagen`;
}
function left(d){
  const m = Math.max(1, Math.round((new Date(d) - Date.now()) / 6e4));
  if (m < 60) return `noch ${m} Min`; const h = Math.round(m / 60); if (h < 48) return `noch ${h} Std`; return `noch ${Math.round(h / 24)} Tage`;
}
const localInput = d => new Date(d - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
const isPhoto = a => /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(a || '');
const avatar = (u, cls='') => `<span class="av ${cls}" ${u && u.color ? `style="background:${esc(u.color)}33"` : ''}>${u && isPhoto(u.avatar) ? `<img src="${u.avatar}" alt="">` : esc((u && u.avatar) || '🙂')}</span>`;
function toast(m){ const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200); }
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = () => matchMedia('(max-width: 900px)').matches;

/* ---------- Farbschema ---------- */
let theme = 'auto'; try { theme = localStorage.getItem('wg-dash-theme') || 'auto'; } catch(e){}
const applyTheme = () => { if (theme === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = theme; };
applyTheme();

/* ---------- Zustand ---------- */
const S = { user:null, me:null, admin:false, v41:true, page:'home', errors:{},
  stats:null, counts:null, people:[], families:[], feedback:[], log:[], anns:[], templates:[], scheduled:[], auto:null, act:null, recent:[],
  chart:'signups', pf:'all', pq:'', fq:'', fb:'open', logf:'all', mod:'feed', modk:'all', gs:'',
  push:{ title:'', body:'', target:'all', fam:'', user:'', url:'home', later:false, at:'' }, confirm:false, busy:false, err:'',
  dr:null, pills:{}, tickets:[], tf:'open', msgs:{}, statusCfg:{ state:'ok', text:'' }, supCfg:{}, v42:true, online:true, ch:null };
try { S.online = localStorage.getItem('wg-dash-online') !== '0'; } catch(e){}
try { S.page = sessionStorage.getItem('dash.page') || 'home'; } catch(e){}

const PAGES = {
  home:['Übersicht','dashboard'], mod:['Moderation','shield'], people:['Personen','user'], families:['Familien','conference-call'],
  support:['Support','chat'], feedback:['Feedback','info'], push:['Push senden','send'], auto:['Automatisch','robot-2'], ann:['Ankündigung','megaphone'], more:['Mehr','more'] };
const GROUPS = [['Mein Büro',['home']], ['Community',['support','mod','people','families','feedback']], ['Nachrichten',['push','auto','ann']]];
const TABS = [['home','Start'],['support','Support'],['mod','Moderation'],['push','Push'],['more','Mehr']];
const LINKS = [['home','Heute'],['fridge','Kühlschrank'],['recipes','Rezepte'],['family','Familie'],['more','Mehr']];
const TARGETS = [['all','Alle'],['active7','Aktive'],['inactive14','Inaktive'],['family','Familie'],['user','Person'],['test','Test an mich']];
const BUILTIN = [
  { title:'Neue Rezepte sind da 🍝', body:'Schau mal rein – es gibt frische Ideen für heute Abend.', url:'recipes' },
  { title:'Was gibt\'s heute? 🤔', body:'Tipp kurz an, was im Kühlschrank ist – wir schlagen dir passende Gerichte vor.', url:'fridge' },
  { title:'Wir vermissen dich 💚', body:'Lange nicht gesehen! Deine Familie freut sich über einen Essensvorschlag.', url:'home' },
  { title:'Neues Update ✨', body:'Die App ist jetzt noch schneller und zuverlässiger. Viel Spaß!', url:'more' },
];
const AUTO = [
  ['wish','🙋 Neuer Essenswunsch','„Anna wünscht sich Spaghetti Carbonara" – an die anderen in der Familie'],
  ['poll','🗳️ Abstimmung gestartet','„Anna fragt: Was essen wir heute?" – an die anderen in der Familie'],
  ['join','👋 Beitrittsanfrage','„Ben möchte der Familie beitreten" – an die Familien-Admins'],
  ['accept','🎉 Willkommen','„Du bist jetzt in der Familie …" – an die Person, die angenommen wurde'],
];
const DUR = [['1h','1 Std',36e5],['1d','1 Tag',864e5],['7d','7 Tage',6048e5],['30d','30 Tage',2592e6],['perm','Dauerhaft',0]];
const ACTS = { ban:['Gesperrt','c-tomato'], unban:['Entsperrt','c-herb'], reset_name:['Name zurückgesetzt',''], reset_avatar:['Bild zurückgesetzt',''], reset_status:['Status gelöscht',''], reset_all:['Profil zurückgesetzt',''],
  delete_board:['Pinnwand gelöscht','c-yolk'], delete_note:['Notiz gelöscht','c-yolk'], delete_recipe:['Rezept gelöscht','c-yolk'], delete_wish:['Wunsch gelöscht','c-yolk'], delete_poll:['Abstimmung gelöscht','c-yolk'], delete_collection:['Sammlung gelöscht','c-yolk'],
  remove_member:['Aus Familie entfernt','c-tomato'], delete_family:['Familie gelöscht','c-tomato'], new_code:['Neuer Familien-Code',''] };
const KINDS = { board:['📌','Pinnwand'], note:['📝','Notiz'], recipe:['🍳','Rezept'] };

/* ---------- Daten ---------- */
async function load(what){
  const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; };
  const tbl = async q => { const { data, error } = await q; if (error) throw error; return data || []; };
  const jobs = {
    me:        async () => { const r = await tbl(sb.from('profiles').select('name,avatar,color').eq('id', S.user.id)); S.me = r[0] || null; },
    stats:     async () => { S.stats = await rpc('admin_stats'); },
    counts:    async () => { S.counts = await rpc('admin_push_counts'); },
    people:    async () => {
      try { S.people = await rpc('admin_people') || []; S.v41 = true; }
      catch(e){ S.v41 = false; S.people = (await rpc('admin_users') || []).map(u => ({ ...u, family_id:null, posts:0 })); }
    },
    families:  async () => { S.families = await rpc('admin_families') || []; },
    feedback:  async () => { S.feedback = await rpc('admin_feedback') || []; },
    act:       async () => { try { S.act = await rpc('admin_activity'); } catch(e){ S.act = null; } },
    recent:    async () => { try { S.recent = await rpc('admin_recent_content') || []; } catch(e){ S.recent = []; } },
    log:       async () => { S.log = await tbl(sb.from('push_log').select('*').order('created_at', { ascending:false }).limit(60)); },
    anns:      async () => { S.anns = await tbl(sb.from('announcements').select('*').order('created_at', { ascending:false }).limit(20)); },
    templates: async () => { S.templates = await tbl(sb.from('push_templates').select('*').order('created_at', { ascending:false })); },
    scheduled: async () => { S.scheduled = await tbl(sb.from('push_scheduled').select('*').order('send_at', { ascending:true }).limit(50)); },
    tickets:   async () => { try { S.tickets = await rpc('admin_tickets') || []; S.v42 = true; } catch(e){ S.tickets = []; S.v42 = false; } },
    supset:    async () => { const r = await tbl(sb.from('app_settings').select('key,value').in('key', ['status','support'])); r.forEach(x => { if (x.key === 'status') S.statusCfg = x.value || S.statusCfg; if (x.key === 'support') S.supCfg = x.value || {}; }); },
    auto:      async () => { const r = await tbl(sb.from('app_settings').select('value').eq('key','auto_push')); S.auto = (r[0] && r[0].value) || { wish:true, poll:true, join:true, accept:true }; },
  };
  await Promise.all((what || Object.keys(jobs)).map(async k => {
    try { await jobs[k](); delete S.errors[k]; }
    catch(e){ S.errors[k] = e.message || String(e); console.warn(k, e); }
  }));
}
const person = id => S.people.find(p => p.id === id);
const family = id => S.families.find(f => f.id === id);
const nameOf = () => (S.me && S.me.name && S.me.name !== 'Nutzer') ? S.me.name : (S.user.email || '').split('@')[0];
const banned = () => S.people.filter(p => p.banned);

/* =========================================================================
   Ansichten
   ========================================================================= */
function viewLogin(){
  return `<div class="login"><form id="loginForm" class="glass">
    <img src="../icon-192.png" alt="">
    <h1>Dashboard</h1><p>Was gibt's? · nur für Betreiber</p>
    <div class="field"><label for="m">E-Mail</label><input class="in" id="m" type="email" autocomplete="username" required></div>
    <div class="field"><label for="p">Passwort</label><input class="in" id="p" type="password" autocomplete="current-password" required></div>
    <div id="loginErr">${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}</div>
    <button class="btn btn-herb" id="loginBtn" style="min-height:48px">Anmelden</button>
    <p style="font-size:13px">Du bleibst auf diesem Gerät angemeldet.</p>
    <a href="../" class="muted" style="font-size:13px;text-align:center">← Zur App</a>
  </form></div>`;
}
function viewDenied(){
  return `<div class="login"><div class="box glass" style="text-align:center">
    <div style="font-size:44px">🔒</div><h1>Kein Zugriff</h1>
    <p>Dieser Account (${esc(S.user.email)}) ist kein App-Admin.</p>
    <button class="btn" data-a="logout-now">Abmelden</button><a href="../" class="muted" style="font-size:13px">← Zur App</a></div></div>`;
}

function shell(){
  const nOpen = S.feedback.filter(f => !f.done).length;
  return `<div class="shell">
    <aside class="side glass">
      <div class="brand"><img src="../icon-192.png" alt=""><span><b>Was gibt's?</b><small>Dashboard</small></span></div>
      <div class="me">${avatar(S.me)}<span style="min-width:0"><b>${esc(nameOf())}</b><small>App-Admin</small></span></div>
      <nav aria-label="Bereiche"><span class="nav-pill" id="navPill"></span>
        ${GROUPS.map(([g, ks]) => `<div class="grp">${g}</div>${ks.map(k => `<button class="nav" data-page="${k}">${ic(PAGES[k][1])}${PAGES[k][0]}${k==='feedback'&&nOpen?`<span class="count">${nOpen}</span>`:''}${k==='support'&&supWait()?`<span class="count">${supWait()}</span>`:''}${k==='mod'&&banned().length?`<span class="count" style="background:var(--muted)">${banned().length}</span>`:''}</button>`).join('')}`).join('')}
      </nav>
      <div class="side-foot">
        <button class="nav" data-a="theme">${ic(theme==='dark'?'moon':theme==='light'?'sun':'sparkling')}${theme==='dark'?'Dunkel':theme==='light'?'Hell':'Automatisch hell/dunkel'}</button>
        <a class="nav" href="../" style="text-decoration:none">${ic('home')}Zur App</a>
        <button class="nav" data-a="logout">${ic('exit')}<span>Abmelden</span></button>
        <div class="credit">Icons von <a href="https://icons8.com" target="_blank" rel="noopener">Icons8</a></div>
      </div>
    </aside>
    <main id="main"></main>
    <nav class="tabbar glass" aria-label="Bereiche"><span class="pill" id="tabPill"></span>
      ${TABS.map(([k,l]) => `<button data-page="${k}">${ic(PAGES[k][1])}${l}${k==='support'&&supWait()?`<span class="count">${supWait()}</span>`:''}</button>`).join('')}
    </nav>
    <div id="dr"></div>
  </div>`;
}

function top(title, sub, right=''){
  return `<div class="top rise"><div class="ttl"><h1>${title}</h1>${sub?`<p>${sub}</p>`:''}</div>
    <div class="search d-only"><input class="in" id="gs" placeholder="Person oder Familie suchen …" value="${esc(S.gs)}" autocomplete="off">${ic('search')}<div id="gsr"></div></div>
    ${right}
    <button class="btn btn-icon" data-a="refresh" aria-label="Aktualisieren" title="Aktualisieren">${ic('refresh')}</button></div>`;
}
function errBox(keys){
  const list = keys.filter(k => S.errors[k]);
  return list.length ? `<div class="warn rise">${ic('info')}<span>Konnte nicht laden: ${list.map(k => `<b>${esc(k)}</b>`).join(', ')} · <button class="btn btn-sm" data-a="refresh">Erneut versuchen</button></span></div>` : '';
}
const v41Box = () => S.v41 ? '' : `<div class="warn rise">${ic('info')}<span><b>Noch ein Schritt:</b> Für Sperren mit Dauer, Inhalte löschen und die Detailansichten bitte <code>supabase/migration-4.1-dashboard.sql</code> im SQL-Editor ausführen. Bis dahin läuft alles wie im alten Panel.</span></div>`;
const empty = (i, t) => `<div class="empty">${ic(i)}${t}</div>`;
const seg = (key, items, cur, act) => `<div class="seg" data-seg="${key}" role="group">${items.map(([k,l]) => `<button data-a="${act}" data-v="${k}" aria-pressed="${cur===k}">${l}</button>`).join('')}</div>`;

/* ---------- Übersicht ---------- */
function greeting(){
  const h = new Date().getHours();
  return h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 17 ? 'Hallo' : h < 22 ? 'Guten Abend' : 'Gute Nacht';
}
function summary(){
  const st = S.stats || {}, open = S.feedback.filter(f => !f.done).length, b = banned().length;
  const parts = [];
  if (st.active_today) parts.push(`${pl(st.active_today,'Person war','Personen waren')} heute in der App`);
  const sw = supWait(); if (sw) parts.push(`${pl(sw,'Support-Anfrage wartet','Support-Anfragen warten')} auf Antwort`);
  if (open) parts.push(`${pl(open,'Feedback wartet','Feedbacks warten')} auf dich`);
  if (st.pending) parts.push(`${pl(st.pending,'Beitrittsanfrage ist','Beitrittsanfragen sind')} offen`);
  if (b) parts.push(`${pl(b,'Sperre läuft','Sperren laufen')}`);
  if (!parts.length) return 'Alles ruhig gerade – hol dir einen Kaffee ☕';
  return parts.length === 1 ? parts[0] + '.' : parts.slice(0, -1).join(', ') + ' und ' + parts[parts.length - 1] + '.';
}
function series(){
  const days = []; for (let i = 13; i >= 0; i--){ const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i); days.push(d); }
  const src = { signups:(S.stats||{}).signups, cooked:(S.act||{}).cooked, posts:(S.act||{}).posts, push:(S.act||{}).push }[S.chart] || [];
  const map = {}; src.forEach(x => map[String(x.day).slice(0,10)] = +x.n);
  return days.map(d => ({ d, n: map[dayKey(d)] || 0 }));
}
function kpi(i, l, v, s, cls='', page=''){
  return `<${page?'button':'div'} class="glass kpi rise ${cls}" style="--d:${i}" ${page?`data-page="${page}"`:''}><span class="ic">${ic(['user','home','conference-call','send','cooking-pot','chat'][i] || 'info')}</span>
    <span class="l">${l}</span><span class="v" data-count="${+v || 0}">${v ?? '–'}</span>${s?`<span class="s">${s}</span>`:''}</${page?'button':'div'}>`;
}
function viewHome(){
  const st = S.stats || {}, c = S.counts || {};
  const now = new Date();
  const open = S.feedback.filter(f => !f.done);
  const next = S.scheduled.find(p => p.status === 'geplant');
  const newest = S.people.slice(0, 5);
  const topR = (S.act && S.act.top) || [];
  const maxTop = Math.max(1, ...topR.map(t => t.n));
  const ml = ((S.act && S.act.modlog) || []).slice(0, 5);
  const sw = supWait(), sn = S.tickets.filter(t => t.status !== 'geloest' && t.priority === 'notfall').length;
  const todo = [
    [sw, sn ? `Support · ${sn} Notfall` : 'Support wartet', 'Anfragen, auf die noch niemand geantwortet hat', 'support', sn ? 'var(--tomato)' : 'var(--herb)'],
    [open.length, 'Offenes Feedback', 'Fehler, Ideen und Lob aus der App', 'feedback', 'var(--tomato)'],
    [st.pending || 0, 'Beitrittsanfragen', 'Warten auf die Familien-Admins', 'families', 'var(--yolk)'],
    [banned().length, 'Laufende Sperren', 'Anzeigen und bei Bedarf aufheben', 'mod', 'var(--muted)'],
  ];
  return `<div class="wrap home">${top('Übersicht', now.toLocaleDateString('de-DE', { weekday:'long', day:'numeric', month:'long' }))}
    ${v41Box()}${errBox(['stats','counts','feedback','people'])}
    <section class="glass hero card rise" style="--d:0"><div class="t">
      <div class="m-only hero-date">${now.toLocaleDateString('de-DE', { weekday:'long', day:'numeric', month:'long' })}</div>
      <h1>${greeting()}, ${esc(nameOf())} <span class="wave">👋</span></h1>
      <p>${esc(summary())}</p>
      <div class="row quick"><button class="btn btn-herb" data-page="push">${ic('send')}Push senden</button><button class="btn" data-page="ann">${ic('megaphone')}Ankündigung</button><button class="btn" data-page="mod">${ic('shield')}Moderation</button></div></div>
      <div class="hero-clock" id="clock">${now.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' })}<small>${pl(st.users,'Nutzer','Nutzer')} · ${pl(st.families,'Familie','Familien')}</small></div>
    </section>
    <div class="grid kpis mt">
      ${kpi(0,'Nutzer', st.users, `+${st.users_7d ?? 0} in 7 Tagen`, '', 'people')}
      ${kpi(1,'Heute aktiv', st.active_today, `${st.active_7d ?? 0} in 7 Tagen`)}
      ${kpi(2,'Familien', st.families, `${pl(st.members,'Mitglied','Mitglieder')}`, '', 'families')}
      ${kpi(3,'Push-Geräte', c.all ?? st.push_devices, `${pl(c.users,'Person','Personen')}`, 'yolk', 'push')}
      ${kpi(4,'Eigene Rezepte', st.recipes, `${pl(st.wishes,'Wunsch','Wünsche')}`)}
      ${kpi(5,'Offenes Feedback', st.feedback_open, pl(st.plus,'Plus-Interessent','Plus-Interessenten'), st.feedback_open ? 'red' : '', 'feedback')}
    </div>
    <div class="grid g-3 mt">
      <section class="glass card rise" style="--d:3"><div class="card-head"><h2>${ic('line-chart')}Aktivität · 14 Tage</h2>
        ${seg('chart', [['signups','Neue Nutzer'],['cooked','Gekocht'],['posts','Pinnwand'],['push','Push']], S.chart, 'chart')}</div>
        <div class="chart" data-chart></div></section>
      <section class="glass card rise" style="--d:4"><h2>${ic('checkmark')}Heute wichtig</h2>
        ${todo.map(([n,t,s,p,col]) => `<button class="todo" data-page="${p}"><span class="n" style="color:${n?col:'var(--muted)'}">${n}</span><span class="t"><b>${t}</b><small>${s}</small></span></button>`).join('')}
        ${next ? `<div class="todo" style="margin-top:8px"><span class="n">${ic('clock')}</span><span class="t"><b>${esc(next.title)}</b><small>Geplanter Push · ${fmtTime(next.send_at)}</small></span></div>` : ''}
      </section>
    </div>
    <div class="grid g-33 mt">
      <section class="glass card rise" style="--d:5"><div class="card-head"><h2>${ic('user')}Neu dabei</h2><button class="btn btn-sm btn-ghost" data-page="people">Alle</button></div>
        <div class="list">${newest.map(p => `<button class="li" data-a="person" data-id="${p.id}">${avatar(p)}<span class="t"><b>${esc(p.name || '(ohne Profil)')}</b><small>${esc(p.family || 'ohne Familie')} · ${ago(p.created_at)}</small></span></button>`).join('') || empty('user','Noch niemand')}</div></section>
      <section class="glass card rise" style="--d:6"><h2>${ic('cooking-pot')}Meistgekocht · 30 Tage</h2>
        ${topR.length ? `<div class="list">${topR.map((t,i) => `<div class="li"><span class="rank">${i+1}</span><span class="t"><b>${esc(t.name)}</b><div class="bar"><i style="width:${Math.round(t.n/maxTop*100)}%"></i></div></span><span class="num">${t.n}×</span></div>`).join('')}</div>` : empty('cooking-pot', S.v41 ? 'Noch nichts gekocht' : 'Kommt mit Migration 4.1')}</section>
      <section class="glass card rise" style="--d:7"><div class="card-head"><h2>${ic('time-machine')}Moderation</h2><button class="btn btn-sm btn-ghost" data-a="mod-log">Verlauf</button></div>
        ${ml.length ? `<div class="list">${ml.map(modRow).join('')}</div>` : empty('shield','Noch keine Eingriffe')}</section>
    </div>
    ${open.length ? `<section class="glass card mt rise" style="--d:8"><div class="card-head"><h2>${ic('chat')}Neuestes Feedback</h2><button class="btn btn-sm btn-ghost" data-page="feedback">Alle ansehen</button></div>
      <div class="grid g-2">${open.slice(0,4).map(f => `<div class="li" style="border:0;align-items:flex-start">${kindChip(f.kind)}<span class="t"><small>${esc(f.name || 'Unbekannt')} · ${ago(f.created_at)}</small><p>${esc(f.message.length > 160 ? f.message.slice(0,160) + '…' : f.message)}</p></span></div>`).join('')}</div></section>` : ''}
  </div>`;
}
function modRow(l){
  const [t, cls] = ACTS[l.action] || [l.action, ''];
  return `<div class="li"><span class="t"><b><span class="chip ${cls}">${t}</span> ${esc(l.who || l.fam || '')}</b><small>${l.detail ? esc(l.detail) + ' · ' : ''}${ago(l.at)}</small></span></div>`;
}

/* ---------- Moderation ---------- */
function viewMod(){
  const b = banned();
  const feed = S.recent.filter(x => S.modk === 'all' || x.kind === S.modk);
  const ml = (S.act && S.act.modlog) || [];
  return `<div class="wrap">${top('Moderation', 'Beiträge prüfen, Personen sperren, Verlauf ansehen')}${v41Box()}
    <div class="row rise" style="margin-bottom:16px">${seg('mod', [['feed','Neueste Beiträge'],['banned',`Gesperrt · ${b.length}`],['log','Verlauf']], S.mod, 'mod')}</div>
    ${S.mod === 'feed' ? `
      <div class="row rise" style="margin-bottom:12px">${seg('modk', [['all','Alles'],['board','📌 Pinnwand'],['note','📝 Notizen'],['recipe','🍳 Rezepte']], S.modk, 'modk')}</div>
      <section class="glass card rise" style="--d:1">${feed.length ? `<div class="list">${feed.map(x => `<div class="li" style="align-items:flex-start">${avatar(x)}
        <span class="t"><small><b style="display:inline;color:var(--fg)">${esc(x.who || 'Unbekannt')}</b> · ${esc(x.fam || '')} · ${ago(x.at)} · ${KINDS[x.kind][0]} ${KINDS[x.kind][1]}</small><p>${esc(x.body)}</p></span>
        <span class="end">${x.uid ? `<button class="btn btn-sm btn-icon" data-a="person" data-id="${x.uid}" aria-label="Person ansehen" title="Person ansehen">${ic('user')}</button>` : ''}<button class="btn btn-sm btn-icon btn-soft-red" data-a="del" data-k="${x.kind}" data-id="${x.id}" aria-label="Löschen" title="Löschen">${ic('trash')}</button></span></div>`).join('')}</div>`
        : empty('shield', S.v41 ? 'Keine Beiträge – alles sauber' : 'Kommt mit Migration 4.1')}</section>` : ''}
    ${S.mod === 'banned' ? `<section class="glass card rise" style="--d:1">${b.length ? `<div class="list">${b.map(p => `<div class="li">${avatar(p)}
        <button class="t" style="text-align:left" data-a="person" data-id="${p.id}"><b>${esc(p.name || p.email)}</b><small>${p.banned_until ? `bis ${fmtTime(p.banned_until)} · ${left(p.banned_until)}` : 'dauerhaft'}${p.ban_reason ? ' · ' + esc(p.ban_reason) : ''}</small></button>
        <span class="end"><button class="btn btn-sm" data-a="unban" data-id="${p.id}">${ic('unlock')}Entsperren</button></span></div>`).join('')}</div>`
        : empty('checkmark','Niemand ist gesperrt')}</section>` : ''}
    ${S.mod === 'log' ? `<section class="glass card rise" style="--d:1">${ml.length ? `<div class="list">${ml.map(modRow).join('')}</div>` : empty('time-machine', S.v41 ? 'Noch keine Eingriffe' : 'Kommt mit Migration 4.1')}</section>` : ''}
  </div>`;
}

/* ---------- Personen ---------- */
function peopleList(){
  const q = S.pq.toLowerCase(), day = Date.now() - 864e5;
  return S.people.filter(p => {
    if (q && ![p.name, p.email, p.family].some(v => (v || '').toLowerCase().includes(q))) return false;
    return { all:true, today:p.last_seen && new Date(p.last_seen) > day, push:p.devices > 0, banned:p.banned, nofam:!p.family, admin:p.is_admin }[S.pf];
  });
}
function statusChip(p){
  if (p.banned) return '<span class="chip c-tomato">gesperrt</span>';
  if (p.is_admin) return '<span class="chip c-yolk">App-Admin</span>';
  if (p.last_seen && Date.now() - new Date(p.last_seen) < 864e5) return '<span class="chip c-herb">heute aktiv</span>';
  return '';
}
function peopleRows(list){
  if (mobile()) return `<div class="list">${list.map(p => `<button class="li" data-a="person" data-id="${p.id}">${avatar(p)}<span class="t"><b>${esc(p.name || '(ohne Profil)')} ${statusChip(p)}</b><small>${esc(p.family || 'ohne Familie')} · ${ago(p.last_seen)}</small></span></button>`).join('') || empty('search','Niemand gefunden')}</div>`;
  return `<table class="tbl"><thead><tr><th>Person</th><th>Familie</th><th>Registriert</th><th>Zuletzt aktiv</th><th>Push</th><th></th></tr></thead><tbody>
    ${list.map(p => `<tr data-a="person" data-id="${p.id}"><td><div class="who">${avatar(p)}<span><b>${esc(p.name || '(ohne Profil)')}</b><small>${esc(p.email)}</small></span></div></td>
      <td>${p.family ? esc(p.family) + (p.role === 'admin' ? ' <span class="chip">Admin</span>' : '') : '<span class="muted">–</span>'}</td>
      <td>${fmtDate(p.created_at)}</td><td>${ago(p.last_seen)}</td><td class="num">${p.devices || ''}</td><td style="text-align:right">${statusChip(p)}</td></tr>`).join('') || `<tr><td colspan="6">${empty('search','Niemand gefunden')}</td></tr>`}
  </tbody></table>`;
}
function viewPeople(){
  const n = k => S.people.filter(p => ({ all:true, today:p.last_seen && Date.now() - new Date(p.last_seen) < 864e5, push:p.devices > 0, banned:p.banned, nofam:!p.family, admin:p.is_admin }[k])).length;
  return `<div class="wrap">${top('Personen', pl(S.people.length,'Account','Accounts'))}${errBox(['people'])}
    <div class="row rise" style="margin-bottom:14px"><input class="in" id="pq" placeholder="Suchen: Name, E-Mail, Familie" value="${esc(S.pq)}" style="max-width:360px;border-radius:999px">
      ${seg('pf', [['all',`Alle · ${n('all')}`],['today',`Heute · ${n('today')}`],['push',`Push · ${n('push')}`],['banned',`Gesperrt · ${n('banned')}`],['nofam',`Ohne Familie · ${n('nofam')}`]], S.pf, 'pf')}</div>
    <section class="glass card rise" style="--d:1;padding:${mobile()?'10px 12px':'12px'}" id="peopleRows">${peopleRows(peopleList())}</section></div>`;
}

/* ---------- Familien ---------- */
function viewFamilies(){
  const q = S.fq.toLowerCase();
  const list = S.families.filter(f => !q || (f.name || '').toLowerCase().includes(q) || (f.code || '').toLowerCase().includes(q));
  const rows = mobile()
    ? `<div class="list">${list.map(f => `<button class="li" data-a="family" data-id="${f.id}"><span class="av">👨‍👩‍👧</span><span class="t"><b>${esc(f.name)}</b><small>${pl(f.members,'Mitglied','Mitglieder')}${f.pending ? ` · ${pl(f.pending,'Anfrage','Anfragen')}` : ''} · seit ${fmtDate(f.created_at)}</small></span></button>`).join('') || empty('conference-call','Keine Familien')}</div>`
    : `<table class="tbl"><thead><tr><th>Familie</th><th>Code</th><th>Mitglieder</th><th>Anfragen</th><th>Eigene Rezepte</th><th>Seit</th></tr></thead><tbody>
      ${list.map(f => `<tr data-a="family" data-id="${f.id}"><td><div class="who"><span class="av">👨‍👩‍👧</span><b>${esc(f.name)}</b></div></td><td><code>${esc(f.code)}</code></td><td class="num">${f.members}</td><td class="num">${f.pending || ''}</td><td class="num">${f.recipes || ''}</td><td>${fmtDate(f.created_at)}</td></tr>`).join('') || `<tr><td colspan="6">${empty('conference-call','Keine Familien')}</td></tr>`}</tbody></table>`;
  return `<div class="wrap">${top('Familien', pl(S.families.length,'Familie','Familien'))}${errBox(['families'])}
    <div class="row rise" style="margin-bottom:14px"><input class="in" id="fq" placeholder="Familie oder Code suchen" value="${esc(S.fq)}" style="max-width:360px;border-radius:999px"></div>
    <section class="glass card rise" style="--d:1;padding:${mobile()?'10px 12px':'12px'}">${rows}</section></div>`;
}

/* ---------- Feedback ---------- */
function kindChip(k){ return ({ fehler:'<span class="chip c-tomato">🐞 Fehler</span>', idee:'<span class="chip c-yolk">💡 Idee</span>', lob:'<span class="chip c-herb">💚 Lob</span>', support:'<span class="chip c-tomato">🛟 Support</span>', plus:'<span class="chip c-herb">✨ Plus</span>' })[k] || `<span class="chip">${esc(k)}</span>`; }
function viewFeedback(){
  const f = S.fb, test = (x, k) => k === 'all' ? true : k === 'open' ? !x.done : x.kind === k;
  const list = S.feedback.filter(x => test(x, f)), n = k => S.feedback.filter(x => test(x, k)).length;
  return `<div class="wrap">${top('Feedback', 'Alles aus „Mehr → Feedback senden" und „Plus"')}${errBox(['feedback'])}
    <div class="row rise" style="margin-bottom:14px">${seg('fb', [['open',`Offen · ${n('open')}`],['all',`Alle · ${n('all')}`],['support',`Support · ${n('support')}`],['fehler','Fehler'],['idee','Ideen'],['lob','Lob'],['plus','Plus']], f, 'fb')}</div>
    <div class="grid">${list.map((x,i) => `<article class="glass card rise" style="--d:${Math.min(i,8)};${x.done?'opacity:.6':''}">
      <div class="row" style="justify-content:space-between;align-items:flex-start"><div class="row" style="gap:8px">${kindChip(x.kind)}<b>${esc(x.name || 'Unbekannt')}</b><small class="muted">${fmtTime(x.created_at)}${x.app_version?` · v${esc(x.app_version)}`:''}</small></div>
        <div class="row" style="gap:6px">${x.email?`<a class="btn btn-sm" href="mailto:${esc(x.email)}">Antworten</a>`:''}<button class="btn btn-sm ${x.done?'':'btn-herb'}" data-a="fb-done" data-id="${x.id}" data-v="${!x.done}">${x.done?'Wieder öffnen':ic('checkmark')+'Erledigt'}</button><button class="btn btn-sm btn-icon btn-soft-red" data-a="fb-del" data-id="${x.id}" aria-label="Löschen">${ic('trash')}</button></div></div>
      <p style="margin:10px 0 0;white-space:pre-wrap;overflow-wrap:anywhere">${esc(x.message)}</p></article>`).join('') || `<div class="glass card">${empty('chat','Nichts in dieser Ansicht')}</div>`}</div></div>`;
}

/* ---------- Push ---------- */
function reach(){
  const P = S.push, c = S.counts || {};
  if (P.target === 'test') return 'nur an deine eigenen Geräte';
  if (P.target === 'family'){ const f = family(P.fam); return f ? `an Familie ${f.name}` : 'an die gewählte Familie'; }
  if (P.target === 'user'){ const u = person(P.user); return u ? `an ${u.name || u.email} (${pl(u.devices,'Gerät','Geräte')})` : 'an die gewählte Person'; }
  const n = { all:c.all, active7:c.active7, inactive14:c.inactive14 }[P.target] ?? 0;
  return `an ${pl(n,'Gerät','Geräte')}`;
}
const kindLabel = k => ({ manuell:'<span class="chip">Von dir</span>', geplant:'<span class="chip c-yolk">Geplant</span>', auto:'<span class="chip c-herb">Automatisch</span>', test:'<span class="chip">Test</span>' })[k] || esc(k);
function targetLabel(p){
  if (p.target === 'family'){ const f = family(p.family_id); return 'Familie ' + (f ? f.name : '?'); }
  if (p.target === 'user'){ const u = person(p.user_id); return u ? (u.name || u.email) : 'Person'; }
  return ({ all:'Alle', active7:'Aktive', inactive14:'Inaktive' })[p.target] || p.target;
}
function viewPush(){
  const P = S.push, now = new Date();
  const famOpts = S.families.map(f => `<option value="${f.id}" ${P.fam===f.id?'selected':''}>${esc(f.name)} (${f.members})</option>`).join('');
  const userOpts = S.people.filter(u => u.devices > 0 || u.id === P.user).map(u => `<option value="${u.id}" ${P.user===u.id?'selected':''}>${esc(u.name || '(ohne Namen)')} · ${esc(u.email)}</option>`).join('');
  const tpls = [...S.templates.map(t => ({ ...t, own:true })), ...BUILTIN];
  const planned = S.scheduled.filter(p => p.status === 'geplant');
  const logList = S.log.filter(l => S.logf === 'all' || l.kind === S.logf);
  return `<div class="wrap">${top('Push senden', 'Nachricht aufs Handy – du entscheidest, wann')}${errBox(['counts','log','templates','scheduled'])}
    <div class="grid g-3">
      <section class="glass card rise" style="--d:1;display:grid;gap:16px">
        <div class="field"><label>Vorlage</label><div class="tpls">${tpls.map((t,i) => `<span class="tpl"><button class="btn btn-sm" data-a="tpl" data-i="${i}" title="${esc(t.body)}">${esc(t.title)}</button>${t.own?`<button class="btn btn-sm btn-icon x" data-a="tpl-del" data-id="${t.id}" aria-label="Vorlage löschen">✕</button>`:''}</span>`).join('')}</div></div>
        <div class="field"><label>An wen?</label>${seg('target', TARGETS, P.target, 'target')}</div>
        ${P.target === 'family' ? `<div class="field"><label for="pf">Familie</label><select class="in" id="pf" data-in="fam"><option value="">Bitte wählen …</option>${famOpts}</select></div>` : ''}
        ${P.target === 'user' ? `<div class="field"><label for="pu">Person</label><select class="in" id="pu" data-in="user"><option value="">Bitte wählen …</option>${userOpts}</select>${!userOpts?'<div class="hint" style="text-align:left">Noch niemand hat Benachrichtigungen eingeschaltet.</div>':''}</div>` : ''}
        <div class="field"><label for="pt">Titel</label><input class="in" id="pt" maxlength="80" data-in="title" value="${esc(P.title)}" placeholder="z. B. Neue Rezepte sind da 🍝"><div class="hint" data-hint="title">${P.title.length}/80</div></div>
        <div class="field"><label for="pb">Text</label><textarea class="in" id="pb" maxlength="240" data-in="body" placeholder="Was möchtest du sagen?">${esc(P.body)}</textarea><div class="hint" data-hint="body">${P.body.length}/240</div></div>
        <div class="field"><label for="pl">Beim Antippen öffnen</label><select class="in" id="pl" data-in="url">${LINKS.map(([k,l]) => `<option value="${k}" ${P.url===k?'selected':''}>${l}</option>`).join('')}</select></div>
        ${P.target !== 'test' ? `<label class="check"><input type="checkbox" data-a="later" ${P.later?'checked':''}> Später senden</label>
          ${P.later ? `<div class="field"><label for="pa">Wann?</label><input class="in" id="pa" type="datetime-local" data-in="at" min="${localInput(Date.now() + 2*6e4)}" value="${esc(P.at || localInput(Date.now() + 60*6e4))}"></div>` : ''}` : ''}
        ${S.confirm ? `<div class="warn" style="margin:0">${ic('info')}<span>${P.later ? 'Die Nachricht wird zur gewählten Zeit automatisch gesendet.' : 'Wirklich senden? Die Nachricht lässt sich danach nicht zurückholen.'} Geht <b>${esc(reach())}</b>.</span></div>` : ''}
        <div class="row">
          ${S.confirm
            ? `<button class="btn btn-tomato" data-a="send" ${S.busy?'disabled':''}>${S.busy?'Sende …':P.later?'Ja, so planen':'Ja, jetzt senden'}</button><button class="btn" data-a="cancel">Abbrechen</button>`
            : `<button class="btn btn-herb" data-a="ask-send" ${S.busy?'disabled':''}>${ic('send')}${S.busy?'Sende …':P.target==='test'?'Test senden':P.later?'Planen …':'Senden …'}</button>`}
          <button class="btn btn-sm btn-ghost" data-a="tpl-save">☆ Als Vorlage</button>
        </div>
        <div class="muted" style="font-size:13px;font-weight:600" id="reach">Geht ${esc(reach())}</div>
      </section>
      <section class="glass card rise" style="--d:2"><h2>${ic('appointment-reminders')}Vorschau</h2>
        <div class="phone"><div class="clock">${now.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' })}</div><div class="date">${now.toLocaleDateString('de-DE', { weekday:'long', day:'numeric', month:'long' })}</div>
          <div class="notif"><img class="ic" src="../icon-192.png" alt=""><div style="min-width:0;flex:1"><b><span class="nt">${esc(P.title || 'Titel der Nachricht')}</span><span>jetzt</span></b><p class="nb">${esc(P.body || 'Hier steht dein Text.')}</p></div></div></div>
        <p class="muted" style="font-size:12.5px;margin:12px 0 0">Am iPhone kommt die Nachricht nur an, wenn die App auf dem Home-Bildschirm ist und Benachrichtigungen eingeschaltet sind.</p>
        ${planned.length ? `<h2 style="margin-top:18px">${ic('clock')}Geplant</h2><div class="list">${planned.map(p => `<div class="li"><span class="t"><b>${esc(p.title)}</b><small>${fmtTime(p.send_at)} · ${esc(targetLabel(p))}</small></span><span class="end"><button class="btn btn-sm" data-a="sched-cancel" data-id="${p.id}">Abbrechen</button></span></div>`).join('')}</div>` : ''}
      </section>
    </div>
    <section class="glass card mt rise" style="--d:3"><div class="card-head"><h2>${ic('time-machine')}Gesendet</h2>
      ${seg('logf', [['all','Alle'],['manuell','Von dir'],['geplant','Geplant'],['auto','Automatisch'],['test','Tests']], S.logf, 'logf')}</div>
      ${logList.length ? `<div class="list">${logList.map(l => `<div class="li" style="align-items:flex-start"><span class="t"><b>${esc(l.title)}</b><small style="white-space:normal">${esc(l.body)}</small><small>${fmtTime(l.created_at)} · ${esc(l.target)}</small></span><span class="end" style="flex-direction:column;align-items:flex-end">${kindLabel(l.kind)}<small class="num">✓ ${l.sent}${l.failed?` · <span style="color:var(--tomato)">✕ ${l.failed}</span>`:''}</small></span></div>`).join('')}</div>`
        : empty('send','Noch nichts in dieser Ansicht')}
    </section></div>`;
}

/* ---------- Automatisch ---------- */
function viewAuto(){
  const a = S.auto || {}, sent = S.log.filter(l => l.kind === 'auto');
  return `<div class="wrap">${top('Automatisch', 'Nachrichten, die die App von selbst an Familien schickt')}${errBox(['auto','log'])}
    <section class="glass card rise" style="--d:1"><h2>${ic('robot-2')}Was soll automatisch rausgehen?</h2>
      <div class="list">${AUTO.map(([k,t,d]) => `<div class="li"><span class="t"><b>${t}</b><small style="white-space:normal">${d}</small></span>
        <button class="switch" role="switch" aria-checked="${a[k] !== false}" data-a="auto" data-v="${k}" aria-label="${esc(t)}"></button></div>`).join('')}</div>
      <p class="muted" style="font-size:13px;margin:14px 0 0">Schutz gegen Nerven: dieselbe Meldung höchstens alle 10 Minuten, pro Person höchstens 15 pro Stunde.</p></section>
    <section class="glass card mt rise" style="--d:2"><h2>${ic('time-machine')}Zuletzt automatisch gesendet</h2>
      ${sent.length ? `<div class="list">${sent.map(l => `<div class="li"><span class="t"><b>${esc(l.title)}</b><small>${fmtTime(l.created_at)} · ${esc(l.target)}</small></span><span class="num">✓ ${l.sent}</span></div>`).join('')}</div>` : empty('robot-2','Noch keine automatischen Nachrichten')}</section></div>`;
}

/* ---------- Ankündigung ---------- */
function viewAnn(){
  const cur = S.anns.find(a => a.active);
  return `<div class="wrap">${top('Ankündigung', 'Ein Banner oben auf „Heute" – für alle')}${errBox(['anns'])}
    <div class="grid g-2">
      <section class="glass card rise" style="--d:1;display:grid;gap:14px"><h2 style="margin:0">${ic('megaphone')}Neue Ankündigung</h2>
        <div class="row" style="flex-wrap:nowrap"><div class="field" style="width:76px"><label for="ae">Emoji</label><input class="in" id="ae" maxlength="4" value="📣" style="text-align:center;font-size:20px"></div>
          <div class="field" style="flex:1"><label for="at">Text</label><input class="in" id="at" maxlength="200" placeholder="z. B. Neu: über 580 Rezepte!"></div></div>
        <div class="row"><button class="btn btn-herb" data-a="ann-save">Veröffentlichen</button><small class="muted">Ersetzt die aktuelle</small></div></section>
      <section class="glass card rise" style="--d:2"><h2>${ic('appointment-reminders')}Gerade sichtbar</h2>
        ${cur ? `<div class="todo"><span style="font-size:24px">${esc(cur.emoji)}</span><span class="t"><b style="font-weight:600">${esc(cur.text)}</b><small>seit ${fmtTime(cur.created_at)}</small></span></div>
          <div class="row" style="margin-top:12px"><button class="btn btn-sm" data-a="ann-off" data-id="${cur.id}">Ausblenden</button></div>` : empty('megaphone','Gerade keine Ankündigung')}</section>
    </div>
    <section class="glass card mt rise" style="--d:3"><h2>${ic('time-machine')}Frühere</h2>
      ${S.anns.length ? `<div class="list">${S.anns.map(a => `<div class="li"><span style="font-size:20px">${esc(a.emoji)}</span><span class="t"><b style="font-weight:600;white-space:normal">${esc(a.text)}</b><small>${fmtTime(a.created_at)} ${a.active?'· <span style="color:var(--herb);font-weight:800">sichtbar</span>':''}</small></span>
        <span class="end">${a.active?`<button class="btn btn-sm" data-a="ann-off" data-id="${a.id}">Ausblenden</button>`:`<button class="btn btn-sm" data-a="ann-on" data-id="${a.id}">Zeigen</button>`}<button class="btn btn-sm btn-icon btn-soft-red" data-a="ann-del" data-id="${a.id}" aria-label="Löschen">${ic('trash')}</button></span></div>`).join('')}</div>` : empty('megaphone','Noch keine')}</section></div>`;
}

/* ---------- Mehr (Handy) ---------- */
function viewMore(){
  const t = (p, l, s, i, cls='') => `<button class="glass tile rise ${cls}" data-page="${p}"><span class="ic">${ic(i)}</span><span>${l}<small>${s}</small></span></button>`;
  return `<div class="wrap"><div class="top rise"><div class="ttl"><h1>Mehr</h1></div>${avatar(S.me)}</div>
    <div class="tiles">
      ${t('people','Personen', pl(S.people.length,'Account','Accounts'), 'user')}
      ${t('families','Familien', pl(S.families.length,'Familie','Familien'), 'conference-call')}
      ${t('feedback','Feedback', pl(S.feedback.filter(f => !f.done).length,'offenes','offene'), 'info')}
      ${t('auto','Automatisch','Push von selbst','robot-2')}
      ${t('ann','Ankündigung','Banner in der App','megaphone')}
    </div>
    <section class="glass card mt rise" style="--d:2;padding:8px 10px">
      <button class="li" data-a="theme">${ic(theme==='dark'?'moon':theme==='light'?'sun':'sparkling')}<span class="t"><b>Darstellung</b><small>${theme==='dark'?'Dunkel':theme==='light'?'Hell':'Automatisch'}</small></span></button>
      <button class="li" data-a="refresh">${ic('refresh')}<span class="t"><b>Aktualisieren</b><small>Alle Zahlen neu laden</small></span></button>
      <a class="li" href="../" style="text-decoration:none">${ic('home')}<span class="t"><b>Zur App</b><small>„Was gibt's?" öffnen</small></span></a>
      <button class="li" data-a="logout" style="color:var(--tomato)">${ic('exit')}<span class="t"><b>Abmelden</b><small style="color:inherit;opacity:.8">${esc(S.user.email)}</small></span></button>
    </section>
    <p class="credit" style="text-align:center;margin-top:14px">Icons von <a href="https://icons8.com" target="_blank" rel="noopener">Icons8</a></p></div>`;
}

/* =========================================================================
   Detail-Ansichten (rechts am Computer, Blatt von unten am Handy)
   ========================================================================= */
function drawerPerson(){
  const d = S.dr, p = person(d.id); if (!p) return '';
  const det = d.detail, self = p.id === S.user.id;
  const content = det ? [['board','📌 Pinnwand',det.board],['notes','📝 Notizen',det.notes],['recipes','🍳 Rezepte',det.recipes],['wishes','🙋 Wünsche',det.wishes]] : [];
  const cur = content.find(c => c[0] === d.tab) || content[0];
  const kindOf = { board:'board', notes:'note', recipes:'recipe', wishes:'wish' };
  return `<span class="grab"></span><button class="btn btn-icon btn-ghost d-close" data-a="close" aria-label="Schließen">${ic('cancel')}</button>
    <div class="d-head">${avatar(p,'lg')}<h2>${esc(p.name || '(ohne Profil)')}</h2><p>${esc(p.email)}</p>
      ${p.status ? `<p style="font-style:italic">„${esc(p.status)}"</p>` : ''}
      <div class="row" style="justify-content:center">${statusChip(p)}${p.family ? `<button class="chip" data-a="family" data-id="${p.family_id || ''}" ${p.family_id?'':'disabled'}>👨‍👩‍👧 ${esc(p.family)}${p.role==='admin'?' · Admin':''}</button>` : '<span class="chip">ohne Familie</span>'}</div></div>
    <div class="stats"><div><b>${fmtDate(p.created_at)}</b><small>Registriert</small></div><div><b>${ago(p.last_seen)}</b><small>Zuletzt aktiv</small></div><div><b>${p.devices || 0}</b><small>Push-Geräte</small></div>
      ${det ? `<div><b>${det.cooked}</b><small>Gekocht</small></div><div><b>${p.posts || 0}</b><small>Beiträge</small></div><div><b>${det.feedback}</b><small>Feedback</small></div>` : ''}</div>
    ${self ? `<div class="warn" style="margin-top:16px">${ic('info')}<span>Das bist du – dich selbst kannst du nicht sperren.</span></div>` : `
    <div class="d-sec"><h3>Sperre</h3>
      ${p.banned ? `<div class="banbox">🚫 Gesperrt ${p.banned_until ? `bis ${fmtTime(p.banned_until)}` : 'dauerhaft'}<small>${p.banned_until ? left(p.banned_until) : ''}${p.ban_reason ? (p.banned_until ? ' · ' : '') + 'Grund: ' + esc(p.ban_reason) : ''}</small></div>
        <div class="row" style="margin-top:10px"><button class="btn btn-herb" data-a="unban" data-id="${p.id}">${ic('unlock')}Entsperren</button></div>`
      : `${S.v41 ? `<div class="dur" role="group" aria-label="Dauer">${DUR.map(([k,l]) => `<button data-a="dur" data-v="${k}" aria-pressed="${d.dur===k}">${l}</button>`).join('')}</div>
        <div class="field" style="margin-top:10px"><input class="in" id="reason" maxlength="200" placeholder="Grund (sieht die Person in der App)" value="${esc(d.reason || '')}"></div>` : ''}
        <div class="row" style="margin-top:10px"><button class="btn btn-tomato" data-a="ban" data-id="${p.id}">${ic('cancel')}Sperren</button><small class="muted">Push-Geräte werden dabei entfernt</small></div>`}
    </div>
    ${S.v41 ? `<div class="d-sec"><h3>Profil zurücksetzen</h3><div class="row">
      <button class="btn btn-sm" data-a="reset" data-v="name" data-id="${p.id}">${ic('eraser')}Name</button><button class="btn btn-sm" data-a="reset" data-v="avatar" data-id="${p.id}">${ic('eraser')}Bild</button>
      <button class="btn btn-sm" data-a="reset" data-v="status" data-id="${p.id}">${ic('eraser')}Status</button><button class="btn btn-sm btn-soft-red" data-a="reset" data-v="all" data-id="${p.id}">Alles</button></div></div>` : ''}`}
    ${det ? `<div class="d-sec"><h3>Inhalte</h3>${seg('dtab', content.map(([k,l,a]) => [k, `${l} · ${a.length}`]), cur[0], 'dtab')}
      <div class="list" style="margin-top:8px">${cur[2].map(x => `<div class="li" style="align-items:flex-start"><span class="t"><p style="margin:0">${esc(x.body || ((x.emoji || '') + ' ' + (x.name || x.recipe || '')))}</p><small>${x.recipe && x.body ? 'zu ' + esc(x.recipe) + ' · ' : ''}${ago(x.at)}</small></span>
        <span class="end"><button class="btn btn-sm btn-icon btn-soft-red" data-a="del" data-k="${kindOf[cur[0]]}" data-id="${x.id}" aria-label="Löschen">${ic('trash')}</button></span></div>`).join('') || empty('checkmark','Nichts da')}</div></div>
    ${det.log.length ? `<div class="d-sec"><h3>Verlauf</h3><div class="list">${det.log.map(l => modRow(l)).join('')}</div></div>` : ''}`
    : S.v41 ? `<div class="empty"><span class="spin"></span></div>` : ''}
    <div class="d-sec"><h3>Aktionen</h3><div class="row">
      ${p.devices ? `<button class="btn" data-a="push-user" data-id="${p.id}">${ic('send')}Push an ${esc(p.name || 'Person')}</button>` : ''}
      ${S.v41 && p.family_id && !self ? `<button class="btn btn-soft-red" data-a="kick" data-f="${p.family_id}" data-id="${p.id}">Aus Familie entfernen</button>` : ''}
    </div></div>`;
}
function drawerFamily(){
  const d = S.dr, f = family(d.id); if (!f) return '';
  const det = d.detail;
  const content = det ? [['board','📌 Pinnwand',det.board,'board'],['notes','📝 Notizen',det.notes,'note'],['recipes','🍳 Rezepte',det.recipes,'recipe']] : [];
  const cur = content.find(c => c[0] === d.tab) || content[0];
  return `<span class="grab"></span><button class="btn btn-icon btn-ghost d-close" data-a="close" aria-label="Schließen">${ic('cancel')}</button>
    <div class="d-head"><span class="av lg">👨‍👩‍👧</span><h2>${esc(f.name)}</h2><p>seit ${fmtDate(f.created_at)}</p>
      <div class="row" style="justify-content:center"><span class="chip">Code <b style="letter-spacing:.08em">${esc(f.code)}</b></span>${S.v41 ? `<button class="btn btn-sm" data-a="newcode" data-id="${f.id}">${ic('restart')}Neuer Code</button>` : ''}</div></div>
    <div class="stats"><div><b>${f.members}</b><small>Mitglieder</small></div><div><b>${f.pending || 0}</b><small>Anfragen</small></div><div><b>${f.recipes || 0}</b><small>Rezepte</small></div>
      ${det ? `<div><b>${det.cooked}</b><small>Gekocht</small></div><div><b>${det.plan}</b><small>Im Plan</small></div><div><b>${det.shop}</b><small>Einkauf</small></div>` : ''}</div>
    ${det ? `<div class="d-sec"><h3>Mitglieder</h3><div class="list">${det.members.map(m => `<div class="li">${avatar(m,'sm')}<button class="t" style="text-align:left" data-a="person" data-id="${m.id}"><b>${esc(m.name || '(ohne Profil)')} ${m.role==='admin'?'<span class="chip">Admin</span>':''} ${m.status==='pending'?'<span class="chip c-yolk">Anfrage</span>':''} ${m.banned?'<span class="chip c-tomato">gesperrt</span>':''}</b><small>${ago(m.last_seen)}</small></button>
        <span class="end"><button class="btn btn-sm btn-soft-red" data-a="kick" data-f="${f.id}" data-id="${m.id}">Entfernen</button></span></div>`).join('') || empty('user','Niemand')}</div></div>
      <div class="d-sec"><h3>Inhalte</h3>${seg('ftab', content.map(([k,l,a]) => [k, `${l} · ${a.length}`]), cur[0], 'dtab')}
        <div class="list" style="margin-top:8px">${cur[2].map(x => `<div class="li" style="align-items:flex-start"><span class="t"><p style="margin:0">${esc(x.body || ((x.emoji || '') + ' ' + x.name))}</p><small>${esc(x.who || '')} · ${ago(x.at)}</small></span>
          <span class="end"><button class="btn btn-sm btn-icon btn-soft-red" data-a="del" data-k="${cur[3]}" data-id="${x.id}" aria-label="Löschen">${ic('trash')}</button></span></div>`).join('') || empty('checkmark','Nichts da')}</div></div>`
      : S.v41 ? `<div class="empty"><span class="spin"></span></div>` : ''}
    <div class="d-sec"><h3>Aktionen</h3><div class="row"><button class="btn" data-a="push-fam" data-id="${f.id}">${ic('send')}Push an Familie</button></div></div>
    ${S.v41 ? `<div class="d-sec"><h3>Gefahrenzone</h3><div class="field"><label for="delname">Zum Löschen den Namen „${esc(f.name)}" eintippen</label><input class="in" id="delname" autocomplete="off"></div>
      <div class="row" style="margin-top:10px"><button class="btn btn-tomato" id="delfam" data-a="delfam" data-id="${f.id}" disabled>${ic('trash')}Familie endgültig löschen</button></div></div>` : ''}`;
}

/* =========================================================================
   Zeichnen
   ========================================================================= */
const VIEWS = { support:viewSupport, home:viewHome, mod:viewMod, people:viewPeople, families:viewFamilies, feedback:viewFeedback, push:viewPush, auto:viewAuto, ann:viewAnn, more:viewMore };
let shellOn = false;
function render(anim=false){
  const app = $('#app');
  if (!S.user){ shellOn = false;
    if (!$('#loginForm')) app.innerHTML = viewLogin(); else $('#loginErr').innerHTML = S.err ? `<div class="err">${esc(S.err)}</div>` : '';
    const b = $('#loginBtn'); if (b){ b.disabled = S.busy; b.textContent = S.busy ? 'Melde an …' : 'Anmelden'; } return; }
  if (!S.admin){ shellOn = false; app.innerHTML = viewDenied(); return; }
  if (!shellOn){ app.innerHTML = shell(); shellOn = true; anim = true; }
  if (S.page === 'more' && !mobile()) S.page = 'home';
  const main = $('#main');
  const focus = document.activeElement && document.activeElement.id, pos = focus && document.activeElement.selectionStart, y = window.scrollY;
  rememberPills(main);
  main.className = anim && !reduced() ? 'anim' : '';
  main.innerHTML = (VIEWS[S.page] || viewHome)();
  if (!anim) window.scrollTo(0, y);
  if (focus){ const el = document.getElementById(focus); if (el && main.contains(el)){ el.focus(); try { el.setSelectionRange(pos, pos); } catch(e){} } }
  updateNav(); placePills(main); drawCharts(anim); if (anim) countUp(main);
  renderDrawer();
}
function refreshShell(){ if (!shellOn) return; const keep = $('#dr').innerHTML; $('#app').innerHTML = shell(); $('#dr').innerHTML = keep; render(false); }

function updateNav(){
  document.querySelectorAll('[data-page]').forEach(b => { if (b.closest('.side nav') || b.closest('.tabbar')){ if (b.dataset.page === S.page) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); } });
  const a = $('.side nav [aria-current]'), np = $('#navPill');
  if (np){ if (a){ np.style.opacity = 1; np.style.top = a.offsetTop + 'px'; np.style.height = a.offsetHeight + 'px'; } else np.style.opacity = 0; }
  const tabPage = TABS.some(([k]) => k === S.page) ? S.page : 'more';
  const t = document.querySelector(`.tabbar [data-page="${tabPage}"]`), tp = $('#tabPill');
  if (tp && t){ tp.style.left = t.offsetLeft + 'px'; tp.style.width = t.offsetWidth + 'px'; }
  document.querySelectorAll('.tabbar [data-page]').forEach(b => b.toggleAttribute('aria-current', b.dataset.page === tabPage));
}
/* Glas-Pillen gleiten von der alten zur neuen Position */
function rememberPills(root){ root.querySelectorAll('.seg[data-seg]').forEach(s => { const p = s.querySelector('.pill'); if (p) S.pills[s.dataset.seg] = { l:p.offsetLeft, w:p.offsetWidth }; }); }
function placePills(root){
  root.querySelectorAll('.seg[data-seg]').forEach(s => {
    const on = s.querySelector('[aria-pressed="true"]'); if (!on) return;
    const p = document.createElement('span'); p.className = 'pill'; s.prepend(p);
    const old = S.pills[s.dataset.seg];
    if (old){ p.style.transition = 'none'; p.style.left = old.l + 'px'; p.style.width = old.w + 'px'; p.offsetWidth; p.style.transition = ''; }
    p.style.left = on.offsetLeft + 'px'; p.style.width = on.offsetWidth + 'px';
    if (on.offsetLeft + on.offsetWidth > s.clientWidth + s.scrollLeft || on.offsetLeft < s.scrollLeft) s.scrollLeft = on.offsetLeft - 20;
  });
}
function countUp(root){
  if (reduced()) return;
  root.querySelectorAll('[data-count]').forEach(el => {
    const to = +el.dataset.count; if (!to) return;
    const t0 = performance.now(), dur = 900 + Math.min(600, to * 4);
    const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(to * e).toLocaleString('de-DE'); if (k < 1) requestAnimationFrame(step); };
    el.textContent = '0'; requestAnimationFrame(step);
  });
}
function drawCharts(anim){
  const box = document.querySelector('[data-chart]'); if (!box) return;
  const data = series(), W = box.clientWidth, H = box.clientHeight, pad = { l:8, r:8, t:18, b:24 };
  const max = Math.max(3, ...data.map(v => v.n)), n = data.length;
  const X = i => pad.l + i * (W - pad.l - pad.r) / (n - 1), Y = v => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const pts = data.map((v, i) => [X(i), Y(v.n)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < n; i++){ const [x0,y0] = pts[i-1], [x1,y1] = pts[i], cx = (x0 + x1) / 2; d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`; }
  const area = d + ` L${pts[n-1][0]},${H - pad.b} L${pts[0][0]},${H - pad.b} Z`;
  const grid = [0, .5, 1].map(k => `<line class="gl" x1="0" x2="${W}" y1="${Y(max * k)}" y2="${Y(max * k)}"/>`).join('');
  const labels = data.map((v, i) => i % (mobile() ? 3 : 2) === (n - 1) % (mobile() ? 3 : 2) ? `<text class="xl" x="${X(i)}" y="${H - 4}" text-anchor="middle">${v.d.getDate()}.${v.d.getMonth()+1}.</text>` : '').join('');
  const total = data.reduce((a, v) => a + v.n, 0);
  const unit = { signups:['neue Person','neue Personen'], cooked:['Mal gekocht','Mal gekocht'], posts:['Pinnwand-Beitrag','Pinnwand-Beiträge'], push:['Push zugestellt','Pushes zugestellt'] }[S.chart];
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${total} ${unit[1]} in 14 Tagen"><defs><linearGradient id="ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--herb)" stop-opacity=".35"/><stop offset="1" stop-color="var(--herb)" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path class="area" d="${area}"/><path class="ln" d="${d}"/>${pts.map(([x,y],i) => `<circle class="dot" data-i="${i}" cx="${x}" cy="${y}" r="5"/>`).join('')}${labels}</svg><div class="tip"></div>`;
  const ln = box.querySelector('.ln'), L = ln.getTotalLength();
  if (anim && !reduced()){ ln.style.strokeDasharray = L; ln.style.strokeDashoffset = L; ln.getBoundingClientRect(); ln.style.transition = 'stroke-dashoffset 1.3s cubic-bezier(.2,.8,.2,1)'; ln.style.strokeDashoffset = 0; }
  requestAnimationFrame(() => box.classList.add('go'));
  const tip = box.querySelector('.tip'), svg = box.querySelector('svg');
  const show = e => { const r = svg.getBoundingClientRect(), x = e.clientX - r.left; const i = Math.max(0, Math.min(n - 1, Math.round((x - pad.l) / ((W - pad.l - pad.r) / (n - 1)))));
    box.querySelectorAll('.dot').forEach(c => c.classList.toggle('on', +c.dataset.i === i));
    tip.innerHTML = `${data[i].d.toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'numeric' })}: <b>${data[i].n}</b>`; tip.style.left = pts[i][0] + 'px'; tip.style.top = pts[i][1] + 'px'; tip.classList.add('on'); };
  svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', () => { tip.classList.remove('on'); box.querySelectorAll('.dot').forEach(c => c.classList.remove('on')); });
}

function renderDrawer(){
  const root = $('#dr'); if (!root) return;
  if (!S.dr){ if (root.firstChild && !root.querySelector('.out')){ root.querySelectorAll('.drawer,.scrim').forEach(x => x.classList.add('out')); setTimeout(() => { if (!S.dr) root.innerHTML = ''; }, 300); } return; }
  const html = S.dr.type === 'person' ? drawerPerson() : S.dr.type === 'ticket' ? drawerTicket() : drawerFamily();
  if (!html){ S.dr = null; root.innerHTML = ''; return; }
  const ex = root.querySelector('.drawer:not(.out)');
  if (ex && ex.dataset.key === S.dr.type + S.dr.id){ const st = ex.scrollTop; rememberPills(ex); ex.innerHTML = html; ex.scrollTop = st; placePills(ex); return; }
  root.innerHTML = `<div class="scrim" data-a="close"></div><aside class="drawer glass" role="dialog" aria-modal="true" data-key="${S.dr.type + S.dr.id}">${html}</aside>`;
  placePills(root.querySelector('.drawer'));
}
async function openDrawer(type, id){
  S.dr = { type, id, tab: type === 'person' ? 'board' : 'board', dur:'1d', reason:'', detail:null };
  S.gs = ''; const r = $('#gsr'); if (r) r.innerHTML = '';
  renderDrawer();
  if (type === 'ticket'){ await loadMsgs(id); return; }
  if (!S.v41) return;
  const { data, error } = await sb.rpc(type === 'person' ? 'admin_person' : 'admin_family', type === 'person' ? { uid:id } : { fid:id });
  if (S.dr && S.dr.id === id){ if (error){ toast('Details konnten nicht geladen werden'); return; } S.dr.detail = data; renderDrawer(); }
}
async function reloadDrawer(){ if (S.dr && S.dr.type === 'ticket'){ await loadMsgs(S.dr.id); return; } if (S.dr && S.v41){ const { type, id } = S.dr; const { data } = await sb.rpc(type === 'person' ? 'admin_person' : 'admin_family', type === 'person' ? { uid:id } : { fid:id }); if (S.dr && S.dr.id === id && data){ S.dr.detail = data; } } renderDrawer(); }

/* ---------- Globale Suche ---------- */
function searchResults(){
  const q = S.gs.trim().toLowerCase(), box = $('#gsr'); if (!box) return;
  if (!q){ box.innerHTML = ''; return; }
  const ps = S.people.filter(p => [p.name, p.email].some(v => (v || '').toLowerCase().includes(q))).slice(0, 6);
  const fs = S.families.filter(f => (f.name || '').toLowerCase().includes(q) || (f.code || '').toLowerCase() === q).slice(0, 4);
  box.innerHTML = `<div class="sr glass">${ps.map(p => `<button data-a="person" data-id="${p.id}">${avatar(p,'sm')}<span><b>${esc(p.name || '(ohne Profil)')}</b> <small class="muted">${esc(p.email)}</small></span></button>`).join('')}
    ${fs.map(f => `<button data-a="family" data-id="${f.id}"><span class="av sm">👨‍👩‍👧</span><span><b>${esc(f.name)}</b> <small class="muted">${pl(f.members,'Mitglied','Mitglieder')}</small></span></button>`).join('')}
    ${!ps.length && !fs.length ? '<div class="empty" style="padding:14px">Nichts gefunden</div>' : ''}</div>`;
}

/* =========================================================================
   Ereignisse
   ========================================================================= */
async function onLogin(e){
  e.preventDefault();
  const email = $('#m').value.trim(), password = $('#p').value;
  if (!email || !password){ S.err = 'Bitte E-Mail und Passwort eingeben.'; render(); return; }
  S.err = ''; S.busy = true; render();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  S.busy = false;
  if (error){ S.err = /Invalid login/i.test(error.message) ? 'E-Mail oder Passwort stimmt nicht.' : error.message; render(); }
}
document.addEventListener('submit', e => { if (e.target.id === 'loginForm') onLogin(e); });

document.addEventListener('input', e => {
  const t = e.target, k = t.dataset.in;
  if (k){
    S.push[k] = t.value; if (S.confirm){ S.confirm = false; render(); return; }
    if (k === 'title' || k === 'body'){
      const n = $('.notif'); if (n){ n.querySelector('.nt').textContent = S.push.title || 'Titel der Nachricht'; n.querySelector('.nb').textContent = S.push.body || 'Hier steht dein Text.'; }
      const h = $(`[data-hint=${k}]`); if (h) h.textContent = `${t.value.length}/${t.maxLength}`;
    }
    return;
  }
  if (t.id === 'gs'){ S.gs = t.value; searchResults(); return; }
  if (t.id === 'pq'){ S.pq = t.value; const b = $('#peopleRows'); if (b) b.innerHTML = peopleRows(peopleList()); return; }
  if (t.id === 'fq'){ S.fq = t.value; render(); return; }
  if (t.id === 'reason' && S.dr){ S.dr.reason = t.value; return; }
  if (t.id === 'delname'){ const f = S.dr && family(S.dr.id), b = $('#delfam'); if (b && f) b.disabled = t.value.trim() !== f.name.trim(); }
});
document.addEventListener('change', e => { const k = e.target.dataset.in; if (k === 'fam' || k === 'user' || k === 'url'){ S.push[k] = e.target.value; const r = $('#reach'); if (r) r.textContent = 'Geht ' + reach(); } });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape'){ if (S.dr){ S.dr = null; renderDrawer(); } else if (S.gs){ S.gs = ''; const g = $('#gs'); if (g) g.value = ''; searchResults(); } }
  if (e.key === 'Enter' && e.target.id === 'gs'){ const b = document.querySelector('#gsr button'); if (b) b.click(); }
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey))){ const g = $('#gs'); if (g){ e.preventDefault(); g.focus(); } }
});
document.addEventListener('click', e => { if (S.gs && !e.target.closest('.search')){ S.gs = ''; const g = $('#gs'); if (g) g.value = ''; searchResults(); } }, true);

function go(page){ S.page = page; S.confirm = false; try { sessionStorage.setItem('dash.page', page); } catch(e){} render(true); window.scrollTo({ top:0, behavior: reduced() ? 'auto' : 'smooth' }); }

document.addEventListener('click', async e => {
  const nav = e.target.closest('[data-page]');
  if (nav){ if (S.dr){ S.dr = null; renderDrawer(); } go(nav.dataset.page); return; }
  const t = e.target.closest('[data-a]'); if (!t) return;
  const id = t.dataset.id, v = t.dataset.v;
  try {
    switch (t.dataset.a){
      case 'theme': theme = { auto:'light', light:'dark', dark:'auto' }[theme]; try { localStorage.setItem('wg-dash-theme', theme); } catch(err){} applyTheme(); refreshShell(); break;
      case 'logout':
        if (!confirmTwice(t, 'Wirklich abmelden?')) break;
      // fallthrough
      case 'logout-now': await sb.auth.signOut({ scope:'local' }); break;
      case 'refresh': t.disabled = true; await load(); refreshShell(); toast(Object.keys(S.errors).length ? 'Einiges konnte nicht geladen werden' : 'Aktualisiert ✓'); break;
      case 'chart': S.chart = v; render(); break;
      case 'mod': S.mod = v; render(); break;
      case 'modk': S.modk = v; render(); break;
      case 'mod-log': S.mod = 'log'; go('mod'); break;
      case 'pf': S.pf = v; render(); break;
      case 'fb': S.fb = v; render(); break;
      case 'logf': S.logf = v; render(); break;
      case 'person': if (id) await openDrawer('person', id); break;
      case 'family': if (id) await openDrawer('family', id); break;
      case 'ticket': if (id) await openDrawer('ticket', id); break;
      case 'tf': S.tf = v; render(); break;
      case 'tstatus': { const tk = ticket(S.dr.id); if (!tk) break; const old = tk.status; tk.status = v; renderDrawer(); render();
        const { error } = await sb.from('support_tickets').update({ status:v }).eq('id', tk.id); if (error){ tk.status = old; renderDrawer(); throw error; } toast(v === 'geloest' ? 'Als gelöst markiert ✓' : 'Status geändert'); break; }
      case 'tpl-reply': { const ta = $('#treply'); if (ta){ ta.value = REPLIES[+v]; ta.focus(); } break; }
      case 'treply': await sendReply(t); break;
      case 'online': S.online = !S.online; try { localStorage.setItem('wg-dash-online', S.online ? '1' : '0'); } catch(err){} supTrack(); render(); toast(S.online ? 'Du wirst in der App als online angezeigt' : 'Du wirst nicht mehr als online angezeigt'); break;
      case 'st-state': S.statusCfg = { ...S.statusCfg, state:v }; render(); break;
      case 'st-save': { const text = ($('#sttext') || {}).value || ''; const reply = ($('#streply') || {}).value || '';
        S.statusCfg = { ...S.statusCfg, text:text.trim() }; S.supCfg = { ...S.supCfg, reply:reply.trim() || 'Wir antworten meistens innerhalb von 24 Stunden.' };
        const a1 = await sb.from('app_settings').upsert({ key:'status', value:S.statusCfg }, { onConflict:'key' }); if (a1.error) throw a1.error;
        const a2 = await sb.from('app_settings').upsert({ key:'support', value:S.supCfg }, { onConflict:'key' }); if (a2.error) throw a2.error;
        render(); toast('Gespeichert – in der App sofort sichtbar'); break; }
      case 'close': S.dr = null; renderDrawer(); break;
      case 'dtab': S.dr.tab = v; renderDrawer(); break;
      case 'dur': S.dr.dur = v; renderDrawer(); break;

      /* Moderation */
      case 'ban': {
        const p = person(id); if (!confirmTwice(t, 'Wirklich sperren?')) break;
        if (S.v41){ const ms = (DUR.find(x => x[0] === S.dr.dur) || DUR[1])[2];
          const { error } = await sb.rpc('admin_ban', { uid:id, until: ms ? new Date(Date.now() + ms).toISOString() : null, reason: S.dr.reason || null }); if (error) throw error; }
        else { const { error } = await sb.rpc('admin_set_banned', { uid:id, val:true }); if (error) throw error; }
        await load(['people','stats','act']); refreshShell(); await reloadDrawer(); toast(`${p?.name || 'Person'} ist gesperrt`); break; }
      case 'unban': {
        const p = person(id);
        const { error } = S.v41 ? await sb.rpc('admin_unban', { uid:id }) : await sb.rpc('admin_set_banned', { uid:id, val:false }); if (error) throw error;
        await load(['people','stats','act']); refreshShell(); await reloadDrawer(); toast(`${p?.name || 'Person'} ist entsperrt`); break; }
      case 'reset': {
        if (!confirmTwice(t, 'Sicher?')) break;
        const { error } = await sb.rpc('admin_reset_profile', { uid:id, what:v }); if (error) throw error;
        await load(['people','act']); render(); await reloadDrawer(); toast('Zurückgesetzt'); break; }
      case 'del': {
        if (!confirmTwice(t, '✓?')) break;
        const { error } = await sb.rpc('admin_delete_content', { kind:t.dataset.k, cid:id }); if (error) throw error;
        S.recent = S.recent.filter(x => x.id !== id);
        await load(['recent','act','people','families']); render(); await reloadDrawer(); toast('Gelöscht'); break; }
      case 'kick': {
        if (!confirmTwice(t, 'Wirklich?')) break;
        const { error } = await sb.rpc('admin_remove_member', { fid:t.dataset.f, uid:id }); if (error) throw error;
        await load(['people','families','act','stats']); render(); await reloadDrawer(); toast('Aus der Familie entfernt'); break; }
      case 'newcode': {
        if (!confirmTwice(t, 'Alten Code ungültig machen?')) break;
        const { data, error } = await sb.rpc('admin_new_code', { fid:id }); if (error) throw error;
        await load(['families']); render(); renderDrawer(); toast('Neuer Code: ' + data); break; }
      case 'delfam': {
        if (!confirmTwice(t, 'Letzte Chance – wirklich löschen?')) break;
        const { error } = await sb.rpc('admin_delete_family', { fid:id }); if (error) throw error;
        S.dr = null; await load(['families','people','stats','act']); refreshShell(); toast('Familie gelöscht'); break; }

      /* Push */
      case 'target': S.push.target = v; S.confirm = false; if (v === 'test') S.push.later = false; render(); break;
      case 'later': S.push.later = t.checked; S.confirm = false; render(); break;
      case 'push-fam': S.push.target = 'family'; S.push.fam = id; S.dr = null; renderDrawer(); go('push'); break;
      case 'push-user': S.push.target = 'user'; S.push.user = id; S.dr = null; renderDrawer(); go('push'); break;
      case 'tpl': { const all = [...S.templates, ...BUILTIN], tp = all[+t.dataset.i]; if (!tp) break;
        S.push.title = tp.title; S.push.body = tp.body; S.push.url = (tp.url || 'home').replace('./?tab=',''); if (!LINKS.some(([k]) => k === S.push.url)) S.push.url = 'home'; S.confirm = false; render(); break; }
      case 'tpl-save': {
        if (!S.push.title.trim() || !S.push.body.trim()){ toast('Bitte erst Titel und Text ausfüllen'); break; }
        const { error } = await sb.from('push_templates').insert({ title:S.push.title.trim(), body:S.push.body.trim(), url:S.push.url }); if (error) throw error;
        await load(['templates']); render(); toast('Als Vorlage gespeichert'); break; }
      case 'tpl-del': { if (!confirmTwice(t, '✓?')) break; const { error } = await sb.from('push_templates').delete().eq('id', id); if (error) throw error; await load(['templates']); render(); break; }
      case 'ask-send': {
        if (!S.push.title.trim() || !S.push.body.trim()){ toast('Bitte Titel und Text ausfüllen'); break; }
        if (S.push.target === 'family' && !S.push.fam){ toast('Bitte eine Familie wählen'); break; }
        if (S.push.target === 'user' && !S.push.user){ toast('Bitte eine Person wählen'); break; }
        if (S.push.later){ const at = $('#pa') && $('#pa').value; if (!at || new Date(at) < new Date()){ toast('Bitte eine Zeit in der Zukunft wählen'); break; } S.push.at = at; }
        if (S.push.target === 'test'){ await sendPush(); break; }
        S.confirm = true; render(); break; }
      case 'cancel': S.confirm = false; render(); break;
      case 'send': await sendPush(); break;
      case 'sched-cancel': { const { error } = await sb.from('push_scheduled').update({ status:'abgebrochen' }).eq('id', id).eq('status', 'geplant'); if (error) throw error; await load(['scheduled']); render(); toast('Geplante Nachricht abgebrochen'); break; }
      case 'auto': {
        const next = { ...(S.auto || {}) }; next[v] = !(next[v] !== false); S.auto = next; t.setAttribute('aria-checked', next[v]);
        const { error } = await sb.from('app_settings').upsert({ key:'auto_push', value:next }, { onConflict:'key' });
        if (error){ next[v] = !next[v]; t.setAttribute('aria-checked', next[v]); throw error; }
        toast(next[v] ? 'Eingeschaltet' : 'Ausgeschaltet'); break; }

      /* Ankündigung */
      case 'ann-save': {
        const text = $('#at').value.trim(), emoji = $('#ae').value.trim() || '📣';
        if (!text){ toast('Bitte einen Text eingeben'); $('#at').focus(); break; }
        t.disabled = true;
        const off = await sb.from('announcements').update({ active:false }).eq('active', true); if (off.error) throw off.error;
        const { error } = await sb.from('announcements').insert({ text, emoji, active:true }); if (error) throw error;
        await load(['anns']); render(); toast('Ankündigung ist jetzt in der App sichtbar'); break; }
      case 'ann-off': { const { error } = await sb.from('announcements').update({ active:false }).eq('id', id); if (error) throw error; await load(['anns']); render(); toast('Ausgeblendet'); break; }
      case 'ann-on': { await sb.from('announcements').update({ active:false }).eq('active', true); const { error } = await sb.from('announcements').update({ active:true }).eq('id', id); if (error) throw error; await load(['anns']); render(); toast('Wieder sichtbar'); break; }
      case 'ann-del': { if (!confirmTwice(t, '✓?')) break; const { error } = await sb.from('announcements').delete().eq('id', id); if (error) throw error; await load(['anns']); render(); break; }

      /* Feedback */
      case 'fb-done': { const x = S.feedback.find(f => f.id === id), on = v === 'true'; if (x) x.done = on; refreshShell();
        const { error } = await sb.from('feedback').update({ done:on }).eq('id', id); if (error){ if (x) x.done = !on; refreshShell(); throw error; } load(['stats']); break; }
      case 'fb-del': { if (!confirmTwice(t, '✓?')) break; const keep = S.feedback; S.feedback = S.feedback.filter(f => f.id !== id); refreshShell();
        const { error } = await sb.from('feedback').delete().eq('id', id); if (error){ S.feedback = keep; refreshShell(); throw error; } break; }
    }
  } catch(err){
    t.disabled = false;
    toast('Hat nicht geklappt: ' + (err && (err.message || err.error_description) || err));
  }
});
/* Zerstörende Knöpfe: erst beim zweiten Antippen ausführen */
function confirmTwice(btn, label='Sicher?'){
  if (btn.dataset.sure) return true;
  btn.dataset.sure = '1'; const old = btn.innerHTML; btn.innerHTML = label; btn.classList.add('btn-tomato');
  if (btn.classList.contains('btn-icon')) btn.style.width = 'auto';
  setTimeout(() => { if (btn.isConnected){ delete btn.dataset.sure; btn.innerHTML = old; btn.classList.remove('btn-tomato'); btn.style.width = ''; } }, 3000);
  return false;
}

async function sendPush(){
  const P = S.push; S.busy = true; render();
  const body = { action: P.target === 'test' ? 'test' : 'send', title:P.title, body:P.body, url:P.url, target:P.target };
  if (P.target === 'family') body.familyId = P.fam;
  if (P.target === 'user') body.userId = P.user;
  if (P.later && P.target !== 'test') body.sendAt = new Date(P.at).toISOString();
  let data, error;
  try { ({ data, error } = await sb.functions.invoke('send-push', { body })); } catch(e){ error = e; }
  S.busy = false; S.confirm = false;
  if (error || !data || data.error){
    const c = data && data.error;
    toast(c === 'forbidden' ? 'Kein Zugriff' : c === 'empty' ? 'Titel, Text oder Empfänger fehlt' : c === 'time' ? 'Die Zeit liegt in der Vergangenheit' : 'Senden fehlgeschlagen' + (data && data.detail ? ': ' + data.detail : error ? ': ' + (error.message || error) : ''));
  } else if (data.scheduled){
    toast('Geplant für ' + fmtTime(P.at)); P.title = ''; P.body = ''; P.later = false;
  } else {
    toast(data.sent ? `Angekommen auf ${pl(data.sent,'Gerät','Geräten')}${data.failed ? ` · ${data.failed} Fehler` : ''}` : P.target === 'test' ? 'Auf deinen Geräten sind keine Benachrichtigungen an' : 'Keine Geräte mit Benachrichtigungen gefunden');
    if (P.target !== 'test' && data.sent){ P.title = ''; P.body = ''; }
  }
  await load(['log','stats','counts','scheduled','act']); render();
}

/* =========================================================================
   Support (Version 4.2)
   ========================================================================= */
const ticket = id => S.tickets.find(t => t.id === id);
const supWait = () => S.tickets.filter(t => t.status !== 'geloest' && t.last_from === 'user').length;
const TCAT = { chat:['💬','Live-Chat'], konto:['👤','Konto'], familie:['👨‍👩‍👧','Familie'], fehler:['🐞','Fehler'], abo:['✨','Plus & Abo'], datenschutz:['🔒','Datenschutz'], sonstiges:['💬','Sonstiges'], sperre:['🛟','Sperre'], notfall:['🚨','Notfall'], melden:['⚑','Meldung'] };
const TSTAT = { offen:['Offen','c-yolk'], in_arbeit:['In Bearbeitung','c-herb'], geloest:['Gelöst',''] };
const REPLIES = [
  'Danke für deine Nachricht! Wir schauen uns das an und melden uns hier.',
  'Kannst du genauer beschreiben, was passiert ist? Ein Screenshot hilft auch.',
  'Das ist jetzt behoben – probier es bitte nochmal. Melde dich, falls es noch hakt.',
  'Ich habe den Beitrag entfernt. Danke fürs Melden! 💚',
  'Wir haben uns deine Sperre angesehen und sie aufgehoben. Willkommen zurück!',
  'Wir haben uns deine Sperre angesehen – sie bleibt leider bestehen.',
];
const REPLY_L = ['Danke, schauen wir uns an','Mehr Infos bitte','Ist behoben','Beitrag entfernt','Sperre aufgehoben','Sperre bleibt'];
function tPrio(t){ return t.priority === 'notfall' ? '<span class="chip c-tomato">🚨 Notfall</span>' : t.priority === 'plus' ? '<span class="chip c-herb">✨ Plus</span>' : ''; }
function tFilter(t, f){ return { open:t.status !== 'geloest', notfall:t.status !== 'geloest' && t.priority === 'notfall', plus:t.status !== 'geloest' && t.priority === 'plus', melden:t.category === 'melden' && t.status !== 'geloest', sperre:t.category === 'sperre' && t.status !== 'geloest', done:t.status === 'geloest', all:true }[f]; }
function viewSupport(){
  const list = S.tickets.filter(t => tFilter(t, S.tf)), n = f => S.tickets.filter(t => tFilter(t, f)).length;
  const done = S.tickets.filter(t => t.rating), good = done.filter(t => t.rating > 0).length;
  const st = S.statusCfg || {};
  return `<div class="wrap">${top('Support', 'Live-Chat, Anfragen, Notfälle und Meldungen')}
    ${S.v42 ? '' : `<div class="warn rise">${ic('info')}<span><b>Noch ein Schritt:</b> Für Live-Chat und Anfragen bitte <code>supabase/migration-4.2-support.sql</code> im SQL-Editor ausführen. Bis dahin kommen Support-Nachrichten unter „Feedback" an.</span></div>`}
    <div class="grid kpis">
      <div class="glass kpi rise ${n('notfall')?'red':''}" style="--d:0"><span class="ic">${ic('info')}</span><span class="l">Notfälle offen</span><span class="v" data-count="${n('notfall')}">${n('notfall')}</span><span class="s">werden zuerst gezeigt</span></div>
      <div class="glass kpi rise" style="--d:1"><span class="ic">${ic('chat')}</span><span class="l">Warten auf dich</span><span class="v" data-count="${supWait()}">${supWait()}</span><span class="s">${pl(n('open'),'Anfrage offen','Anfragen offen')}</span></div>
      <div class="glass kpi rise yolk" style="--d:2"><span class="ic">${ic('sparkling')}</span><span class="l">Plus-Anfragen</span><span class="v" data-count="${n('plus')}">${n('plus')}</span><span class="s">bevorzugt</span></div>
      <div class="glass kpi rise" style="--d:3"><span class="ic">${ic('checkmark')}</span><span class="l">Zufriedenheit</span><span class="v">${done.length ? Math.round(good / done.length * 100) + '%' : '–'}</span><span class="s">${pl(done.length,'Bewertung','Bewertungen')}</span></div>
    </div>
    <div class="grid g-3 mt">
      <section class="glass card rise" style="--d:4">
        <div class="row" style="margin-bottom:12px">${seg('tf', [['open',`Offen · ${n('open')}`],['notfall',`🚨 ${n('notfall')}`],['plus',`✨ ${n('plus')}`],['melden',`⚑ Meldungen · ${n('melden')}`],['sperre',`🛟 Sperren · ${n('sperre')}`],['done','Gelöst'],['all','Alle']], S.tf, 'tf')}</div>
        ${list.length ? `<div class="list">${list.map(t => `<button class="li tk" data-a="ticket" data-id="${t.id}">${avatar(t)}
          <span class="t"><b>${t.last_from === 'user' && t.status !== 'geloest' ? '<span class="dotc" style="background:var(--tomato);display:inline-block;margin-right:6px"></span>' : ''}${esc(t.subject)}</b>
          <small>${TCAT[t.category] ? TCAT[t.category][0] + ' ' + TCAT[t.category][1] : ''} · ${esc(t.name || t.email || '')} · ${ago(t.updated_at)}</small>
          <small style="white-space:nowrap">${esc(t.last_body || '')}</small></span>
          <span class="end" style="flex-direction:column;align-items:flex-end;gap:4px">${tPrio(t)}<span class="chip ${TSTAT[t.status][1]}">${TSTAT[t.status][0]}</span></span></button>`).join('')}</div>`
          : empty('checkmark', S.tf === 'open' ? 'Keine offenen Anfragen – alles beantwortet 🎉' : 'Nichts in dieser Ansicht')}
      </section>
      <div class="grid" style="align-content:start">
        <section class="glass card rise" style="--d:5"><h2>${ic('appointment-reminders')}Erreichbarkeit</h2>
          <div class="li" style="padding:4px 0"><span class="t"><b>In der App als online zeigen</b><small style="white-space:normal">Solange das Dashboard offen ist, sehen Nutzer „Support ist gerade online"</small></span>
            <button class="switch" role="switch" aria-checked="${S.online}" data-a="online" aria-label="Als online zeigen"></button></div>
          <div class="field" style="margin-top:12px"><label for="streply">Antwortzeit-Hinweis (wenn du offline bist)</label><input class="in" id="streply" maxlength="120" value="${esc((S.supCfg || {}).reply || 'Wir antworten meistens innerhalb von 24 Stunden.')}"></div>
        </section>
        <section class="glass card rise" style="--d:6"><h2>${ic('info')}Status-Seite</h2>
          ${seg('st', [['ok','✅ Alles läuft'],['stoerung','⚠️ Störung']], st.state === 'stoerung' ? 'stoerung' : 'ok', 'st-state')}
          ${st.state === 'stoerung' ? `<div class="field" style="margin-top:12px"><label for="sttext">Was ist los?</label><input class="in" id="sttext" maxlength="160" value="${esc(st.text || '')}" placeholder="z. B. Fotos scannen geht gerade nicht"></div>` : ''}
          <div class="row" style="margin-top:12px"><button class="btn btn-herb btn-sm" data-a="st-save">Speichern</button><small class="muted">Sichtbar unter „Hilfe & Support"</small></div>
        </section>
      </div>
    </div></div>`;
}
function drawerTicket(){
  const t = ticket(S.dr.id); if (!t) return '';
  const ms = S.msgs[t.id];
  const c = TCAT[t.category] || ['💬', t.category];
  return `<span class="grab"></span><button class="btn btn-icon btn-ghost d-close" data-a="close" aria-label="Schließen">${ic('cancel')}</button>
    <div class="tk-head">${avatar(t)}<div class="t"><b>${esc(t.name || '(ohne Profil)')}</b> ${t.banned ? '<span class="chip c-tomato">gesperrt</span>' : ''}<small>${esc(t.email || '')}</small></div>
      <button class="btn btn-sm" data-a="person" data-id="${t.user_id}">${ic('user')}Person</button></div>
    <h2 style="font-size:21px;margin:14px 0 8px">${esc(t.subject)}</h2>
    <div class="row" style="gap:6px;margin-bottom:12px">${t.category === 'notfall' ? '' : `<span class="chip">${c[0]} ${c[1]}</span>`}${tPrio(t)}<small class="muted">seit ${fmtTime(t.created_at)}</small>${t.rating ? `<span class="chip ${t.rating > 0 ? 'c-herb' : 'c-tomato'}">${t.rating > 0 ? '👍 hilfreich' : '👎 nicht hilfreich'}</span>` : ''}</div>
    ${seg('tstat', [['offen','Offen'],['in_arbeit','In Bearbeitung'],['geloest','✓ Gelöst']], t.status, 'tstatus')}
    ${t.report_kind ? `<div class="d-sec"><h3>Gemeldeter Inhalt</h3><div class="banbox" style="background:var(--yolk-soft);color:var(--fg)">„${esc(t.report_text || '')}"<small>${t.report_kind === 'note' ? 'Notiz an einem Rezept' : 'Pinnwand-Beitrag'}</small></div>
      <div class="row" style="margin-top:10px"><button class="btn btn-sm btn-soft-red" data-a="del" data-k="${t.report_kind}" data-id="${esc(t.report_id)}">${ic('trash')}Inhalt löschen</button></div></div>` : ''}
    <div class="d-sec"><h3>Verlauf</h3><div class="chat" id="tchat">${ms ? ms.map(m => `<div class="bub ${m.from_support ? 'me' : 'them'}">${m.from_support ? '' : `<b>${esc(t.name || 'Nutzer')}</b>`}<span>${esc(m.body)}</span><small>${fmtTime(m.created_at)}</small></div>`).join('') : '<div class="empty"><span class="spin"></span></div>'}</div></div>
    <div class="d-sec"><h3>Antworten</h3>
      <div class="tpls" style="margin-bottom:10px">${REPLY_L.map((l, i) => `<button class="btn btn-sm" data-a="tpl-reply" data-v="${i}">${l}</button>`).join('')}</div>
      <textarea class="in" id="treply" maxlength="2000" placeholder="Antwort an ${esc(t.name || 'die Person')} …"></textarea>
      <div class="row" style="margin-top:10px"><button class="btn btn-herb" data-a="treply">${ic('send')}Senden</button><label class="check" style="font-size:13.5px"><input type="checkbox" id="tdone"> und als gelöst markieren</label></div></div>`;
}
async function loadMsgs(id){
  const { data, error } = await sb.from('support_messages').select('*').eq('ticket_id', id).order('created_at');
  if (!error) S.msgs[id] = data || [];
  if (S.dr && S.dr.id === id){ renderDrawer(); const c = $('#tchat'); if (c) c.scrollTop = c.scrollHeight; }
}
async function sendReply(btn){
  const ta = $('#treply'), body = ta && ta.value.trim(), t = ticket(S.dr && S.dr.id); if (!body || !t){ toast('Bitte eine Antwort schreiben'); return; }
  const done = $('#tdone') && $('#tdone').checked;
  btn.disabled = true;
  const { error } = await sb.from('support_messages').insert({ ticket_id:t.id, body, from_support:true });
  if (error){ btn.disabled = false; throw error; }
  if (done){ await sb.from('support_tickets').update({ status:'geloest' }).eq('id', t.id); }
  await load(['tickets']); await loadMsgs(t.id); refreshShell(); toast(done ? 'Gesendet und gelöst ✓' : 'Antwort gesendet ✓');
}
/* Live: neue Nachrichten sofort sehen + in der App als online erscheinen */
function supLive(){
  if (S.ch || !S.v42) return;
  S.ch = sb.channel('support-online', { config:{ presence:{ key:'support-' + S.user.id } } })
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'support_messages' }, async ev => {
      const m = ev.new || {}; if (!m.ticket_id){ await load(['tickets']); updateNav(); return; }
      if (S.msgs[m.ticket_id] && !S.msgs[m.ticket_id].some(x => x.id === m.id)) S.msgs[m.ticket_id].push(m);
      await load(['tickets']);
      if (!m.from_support){ const t = ticket(m.ticket_id); toast(`${t && t.priority === 'notfall' ? '🚨 Notfall' : '💬 Neue Nachricht'} von ${t ? (t.name || 'Nutzer') : 'Nutzer'}`); }
      const keep = $('#treply') ? $('#treply').value : null;
      if (!(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName))) refreshShell(); else { updateNav(); renderDrawer(); }
      if (keep != null && $('#treply')) $('#treply').value = keep;
      const c = $('#tchat'); if (c) c.scrollTop = c.scrollHeight; })
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'support_tickets' }, async () => { await load(['tickets']); if (!(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName))) refreshShell(); })
    .subscribe(st => { if (st === 'SUBSCRIBED') supTrack(); });
}
function supTrack(){ if (!S.ch) return; try { if (S.online && !document.hidden) S.ch.track({ support:true }); else S.ch.untrack(); } catch(e){} }
document.addEventListener('visibilitychange', supTrack);

/* ---------- Uhr, stille Aktualisierung, Größenwechsel ---------- */
setInterval(() => { const c = $('#clock'); if (c && c.firstChild) c.firstChild.textContent = new Date().toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' }); }, 10e3);
setInterval(async () => {
  if (!S.admin || document.hidden || S.dr || S.confirm || S.busy) return;
  const a = document.activeElement; if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
  await load(['stats','counts','feedback','people','recent','act','tickets']); refreshShell();
}, 90e3);
let lastMobile = mobile();
addEventListener('resize', () => { if (!shellOn) return; updateNav(); placePills($('#main')); if (mobile() !== lastMobile){ lastMobile = mobile(); render(); } else drawCharts(false); });

/* ---------- Start ---------- */
let current;
async function onSession(session){
  const uid = session ? session.user.id : null;
  if (uid && uid === current) return;   // nur Token aufgefrischt
  current = uid;
  S.user = session ? session.user : null; S.admin = false; shellOn = false;
  if (S.user){
    $('#app').innerHTML = '<div class="boot"><span class="spin"></span></div>';
    const { data, error } = await sb.rpc('is_app_admin');
    if (error){ S.err = 'Konnte Zugriff nicht prüfen: ' + error.message; }
    S.admin = data === true;
    if (S.admin){ await load(); supLive(); }
  }
  render(true);
}
sb.auth.getSession().then(({ data }) => onSession(data.session));
sb.auth.onAuthStateChange((ev, session) => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') setTimeout(() => onSession(session), 0); });
