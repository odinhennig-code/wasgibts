/* =========================================================================
   WAS GIBT'S? – Familien-Essensplaner
   Aufbau: Verbindung → Daten laden → Logik → Ansichten → Ereignisse
   Daten liegen in Supabase (siehe supabase/schema.sql).
   ========================================================================= */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { ING, ingName, ingEmoji, R, recipe, ALLERGENS, TRAITS, allergensOf, MEAT, FISH, CATS } from './data.js';

const configured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
/* ---------- Angemeldet bleiben ----------
   Die Anmeldung liegt doppelt: im localStorage (schnell) und in der IndexedDB (Sicherung).
   Löscht das Handy den localStorage (z. B. Speicher knapp, iOS räumt auf), holt die App
   die Anmeldung still aus der Sicherung zurück – man muss sich nicht neu anmelden. */
const authStore = (() => {
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((ok, no) => { try { const r = indexedDB.open('wasgibts-auth', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); } catch(e){ no(e); } }));
  const tx = (mode, fn) => db().then(d => new Promise((ok, no) => { const t = d.transaction('kv', mode), st = t.objectStore('kv'), q = fn(st);
    t.oncomplete = () => ok(q && q.result); t.onerror = () => no(t.error); })).catch(() => null);
  const ls = { get:k => { try { return localStorage.getItem(k); } catch(e){ return null; } }, set:(k,v) => { try { localStorage.setItem(k, v); } catch(e){} }, del:k => { try { localStorage.removeItem(k); } catch(e){} } };
  return {
    async getItem(k){ const v = ls.get(k); if (v != null) return v;
      const b = await tx('readonly', st => st.get(k)); if (b != null) ls.set(k, b); return b ?? null; },
    async setItem(k, v){ ls.set(k, v); await tx('readwrite', st => st.put(v, k)); },
    async removeItem(k){ ls.del(k); await tx('readwrite', st => st.delete(k)); },
  };
})();
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storage:authStore } }) : null;
/* Den Browser bitten, den Speicher der App nicht automatisch zu löschen */
try { navigator.storage && navigator.storage.persist && navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(()=>{}); } catch(e){}
/* Handy schläft Zeitgeber ein: beim Zurückkommen die Anmeldung sofort auffrischen */
if (sb) document.addEventListener('visibilitychange', () => { try {
  if (document.hidden) sb.auth.stopAutoRefresh && sb.auth.stopAutoRefresh();
  else { sb.auth.startAutoRefresh && sb.auth.startAutoRefresh(); sb.auth.getSession().catch(()=>{}); } } catch(e){} });

/* ---------- Zustand ---------- */
const D = { notes:[], board:[], colls:[], xrec:[], cap:{}, lastWeek:[], user:null, profile:null, membership:null, family:null, members:[], profiles:{}, wishes:[], fridge:[], expiries:{}, custom:[], poll:null, votes:[], shop:[], plan:[], log:[], ratings:[], ann:null, appAdmin:false };
const UI = { tab:'home', time:60, mood:'egal', rtab:'week', q:'', auth:'login', busy:false, err:'', loading:true,
             joinCode: new URLSearchParams(location.search).get('join') || '' };
const LOCAL = 'wasgibts.local';
let L = (() => { try { return JSON.parse(localStorage.getItem(LOCAL)) || {}; } catch(e){ return {}; } })();
const saveLocal = () => { try { localStorage.setItem(LOCAL, JSON.stringify(L)); } catch(e){} };
if (UI.joinCode) { L.joinCode = UI.joinCode; saveLocal(); history.replaceState(null, '', location.pathname); }
/* Aus einer Benachrichtigung geöffnet: direkt zum passenden Reiter */
{ const t = new URLSearchParams(location.search).get('tab'); if (['home','fridge','recipes','family','more'].includes(t)){ UI.tab = t; history.replaceState(null, '', location.pathname); } }

/* ---------- Hilfen ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function buzz(ms=12){
  try {
    if (navigator.vibrate){ navigator.vibrate(ms); return; }
    // iPhone (Safari 18+): Antippen eines Schalters löst ein leichtes haptisches Feedback aus
    let l = document.getElementById('hapt');
    if (!l){ l = document.createElement('label'); l.id = 'hapt'; l.setAttribute('aria-hidden', 'true'); l.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
      l.innerHTML = '<input type="checkbox" switch tabindex="-1">'; document.body.appendChild(l); }
    l.click();
  } catch(e){} }
function toast(m){ const t=$('#toast'); t.textContent=m; t.classList.add('show'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'),2600); }
const plu = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function names(list){ return list.length<=1 ? (list[0]||'') : list.slice(0,-1).join(', ') + ' und ' + list[list.length-1]; }
const prof = id => D.profiles[id] || { id, name:'Jemand', avatar:'🙂', veg:false, dislikes:[], allergies:[], favs:[] };
const isActive = () => D.membership && D.membership.status === 'active';
const isAdmin = () => isActive() && D.membership.role === 'admin';
const active = () => D.members.filter(m => m.status === 'active');
const pendingReq = () => D.members.filter(m => m.status === 'pending');
function eatersNow(){ const ids = active().map(m=>m.user_id); const e = (L.eaters||[]).filter(id=>ids.includes(id)); return e.length ? e : ids; }
function errText(e){
  const m = (e && (e.message || e.error_description || e.error)) || String(e);
  if (/Invalid login credentials/i.test(m)) return 'E-Mail oder Passwort stimmt nicht.';
  if (/already registered|already exists/i.test(m)) return 'Mit dieser E-Mail gibt es schon einen Account. Melde dich an.';
  if (/Password should be/i.test(m)) return 'Das Passwort muss mindestens 6 Zeichen haben.';
  if (/Email not confirmed/i.test(m)) return 'Bitte bestätige zuerst deine E-Mail-Adresse (Link im Postfach).';
  if (/Code nicht gefunden/i.test(m)) return 'Diesen Familien-Code gibt es nicht. Bitte prüfen.';
  if (/Failed to fetch|NetworkError|offline|Load failed|network/i.test(m) || (e && e.offline)) return '📡 Keine Internetverbindung – deine Änderung wird gespeichert, sobald du wieder online bist.';
  if (/JWT|token.*(expired|invalid)|not authenticated|session/i.test(m)) return '🔑 Du wurdest abgemeldet. Bitte melde dich neu an – danach klappt es wieder.';
  if (/row-level security|permission denied|not allowed|forbidden|42501/i.test(m)) return '🔒 Dafür fehlen dir die Rechte. Manche Dinge dürfen nur Familien-Admins.';
  if (/duplicate key|already|23505/i.test(m)) return 'Das gibt es schon – du musst nichts weiter tun.';
  if (/check constraint|too long|value too long|23514|22001/i.test(m)) return '✏️ Die Eingabe ist zu lang oder ungültig. Bitte kürzer fassen.';
  if (/rate|429|too many/i.test(m)) return '⏳ Zu viele Anfragen auf einmal. Warte kurz und versuch es dann nochmal.';
  if (/timeout|timed out|504/i.test(m)) return '⏳ Das hat zu lange gedauert. Bitte gleich nochmal versuchen.';
  if (/does not exist|schema cache|function .* not found|PGRST202/i.test(m)) return '🛠️ Diese Funktion ist gerade nicht verfügbar. Wir arbeiten daran.';
  if (/50\d|internal server|bad gateway|service unavailable/i.test(m)) return '🛠️ Unser Server hat gerade ein Problem. Bitte in ein paar Minuten nochmal versuchen.';
  return 'Das hat nicht geklappt. Bitte nochmal versuchen – passiert es öfter, schreib uns unter „Mehr → Hilfe & Support".';
}

/* ---------- Daten laden ----------
   Wichtig gegen „springt zurück" und „wird nicht gespeichert":
   Jede eigene Änderung erhöht `gen`. Ein Neuladen, das vor dieser Änderung
   gestartet ist, wird verworfen und später wiederholt. So überschreibt ein
   altes Ergebnis aus der Datenbank nie, was du gerade angetippt hast. */
let gen = 0;
const bump = () => { gen++; };
async function loadAll(force){
  const g = gen, uid = D.user.id, N = { profiles:{} };
  let { data: p, error: pe } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (pe){ const e = new Error(pe.message || 'offline'); e.offline = true; throw e; }   // keine Verbindung: nicht als „neues Profil" behandeln
  if (!p){ // Profil beim ersten Login aus den Registrierungsdaten anlegen
    const meta = D.user.user_metadata || {};
    const ins = await sb.from('profiles').insert({ id: uid, name: (meta.name || 'Ich').slice(0,30), avatar: meta.avatar || '🧑' }).select().single();
    p = ins.data; if (!p){ const e = new Error('Profil konnte nicht geladen werden'); e.offline = true; throw e; }
  }
  // Zeitlich begrenzte Sperre: abgelaufen? Dann sofort wieder frei (Funktion gibt es ab Datenbank 4.1)
  if (p.banned && p.banned_until && new Date(p.banned_until) <= new Date()){
    try { const { data: b } = await sb.rpc('my_ban'); if (b && !b.banned) p = { ...p, banned:false, banned_until:null, ban_reason:null }; } catch(e){}
  }
  N.profile = p; N.profiles[uid] = p;
  // „Zuletzt aktiv" höchstens alle 6 Stunden melden – sonst lädt bei allen in der Familie ständig alles neu
  if (!L.seenAt || Date.now() - L.seenAt > 6*36e5){ L.seenAt = Date.now(); saveLocal(); sb.rpc('touch_seen').then(()=>{}, ()=>{}); }
  const [an, adm, ms] = await Promise.all([
    sb.from('announcements').select('*').eq('active', true).order('created_at', { ascending:false }).limit(1),
    sb.rpc('is_app_admin'),
    sb.from('memberships').select('*').eq('user_id', uid).order('created_at').limit(1),
  ]);
  N.ann = (an.data && an.data[0]) || null; N.appAdmin = adm.data === true;
  N.membership = (ms.data && ms.data[0]) || null;
  Object.assign(N, { notes:[], board:[], colls:[], cap:{}, family:null, members:[], wishes:[], fridge:[], expiries:{}, custom:[], poll:null, votes:[], shop:[], plan:[], log:[], ratings:[] });
  if (N.membership){
    const fid = N.membership.family_id;
    const { data: fam } = await sb.from('families').select('*').eq('id', fid).maybeSingle();
    N.family = fam;
    if (N.membership.status === 'active'){
      const [mem, wis, fr, cus, pol, shp, pln, lg, rt] = await Promise.all([
        sb.from('memberships').select('*').eq('family_id', fid).order('created_at'),
        sb.from('wishes').select('*').eq('family_id', fid),
        sb.from('fridges').select('*').eq('family_id', fid).maybeSingle(),
        sb.from('custom_recipes').select('*').eq('family_id', fid).order('created_at'),
        sb.from('polls').select('*').eq('family_id', fid).order('created_at', { ascending:false }).limit(1),
        sb.from('shopping_items').select('*').eq('family_id', fid).order('created_at'),
        sb.from('meal_plan').select('*').eq('family_id', fid).gte('day', isoDay(new Date())),
        sb.from('cook_log').select('*').eq('family_id', fid).order('cooked_at', { ascending:false }).limit(300),
        sb.from('ratings').select('*').eq('family_id', fid),
      ]);
      N.log = (lg && lg.data) || []; N.ratings = (rt && rt.data) || [];
      N.shop = shp.data || []; N.plan = pln.data || [];
      N.members = mem.data || []; N.wishes = wis.data || []; N.fridge = (fr.data && fr.data.items) || [];
      N.expiries = (fr.data && fr.data.expiries) || {};
      N.custom = (cus.data || []).map(c => ({ id:'c_'+c.id, dbid:c.id, n:c.name, e:c.emoji, t:c.minutes, m:c.mood, i:c.ingredients||[], o:c.optional||[], x:c.traits||[], s:c.steps||[], custom:true, by:c.created_by }));
      N.poll = (pol.data && pol.data[0]) || null;
      /* 4.0: neue Tabellen/Spalten – nur nutzen, wenn das Datenbank-Update schon da ist */
      const [cp, cs, nt, bd, cl] = await Promise.all([
        sb.from('meal_plan').select('slot,cook,label').limit(1),
        sb.from('shopping_items').select('note,list,assigned_to').limit(1),
        sb.from('recipe_notes').select('*').eq('family_id', fid).order('created_at'),
        sb.from('board_posts').select('*').eq('family_id', fid).order('created_at', { ascending:false }).limit(30),
        sb.from('recipe_collections').select('*').eq('family_id', fid).order('created_at'),
      ]);
      N.cap = { plan3: !cp.error, shop3: !cs.error, notes: !nt.error, board: !bd.error, colls: !cl.error };
      N.notes = nt.data || []; N.board = bd.data || []; N.colls = cl.data || [];
      const ids = N.members.map(m=>m.user_id);
      const [vs, ps] = await Promise.all([
        N.poll ? sb.from('votes').select('*').eq('poll_id', N.poll.id) : Promise.resolve({ data:[] }),
        sb.from('profiles').select('*').in('id', ids),
      ]);
      N.votes = vs.data || [];
      (ps.data||[]).forEach(x => { if (x.id !== uid) N.profiles[x.id] = x; });
    }
  }
  if (!force && (g !== gen || busyWriting())) return false;   // in der Zwischenzeit selbst etwas geändert: verwerfen
  const seenW = loadAll.seen;   // neue Wünsche anderer → Banner auf dem iPhone am Computer
  Object.assign(D, N);
  if (UI.offline){ UI.offline = false; setTimeout(() => toast('🟢 Wieder online'), 300); }
  saveCache();
  if (!loadXRec.done && D.user){ loadXRec.done = true; loadXRec(); }
  loadAll.seen = new Set(D.wishes.map(w => w.id));
  if (seenW && window.__wgBanner) D.wishes.filter(w => !seenW.has(w.id) && w.user_id !== D.user.id && !String(w.id).startsWith('tmp'))
    .forEach(w => window.__wgBanner(`${prof(w.user_id).name} wünscht sich etwas`, (rec(w.recipe_id) || {}).n || ''));
  try { window.dispatchEvent(new Event('wg:data')); } catch(e){}
  return true;
}
let reloadT = null, writing = 0;
const busyWriting = () => writing > 0 || !!fridgeT || !!profT;
function scheduleReload(delay = 600){ clearTimeout(reloadT); reloadT = setTimeout(async () => {
  if (busyWriting()){ scheduleReload(); return; }
  let ok = false; try { ok = await loadAll(true); } catch(e){}
  if (!ok){ scheduleReload(900); return; }
  paint(); }, delay); }
/* Nach dem Laden nur das Nötige neu zeichnen – Eingaben in offenen Fenstern bleiben erhalten */
function paint(){ if (UI.cook) return; render(); if ($('.sheet')) refreshSheet(); }

/* Speichern: alle Schreibvorgänge laufen nacheinander, damit nichts in falscher Reihenfolge ankommt */
let chain = Promise.resolve();
function save(fn){
  bump(); writing++;
  const run = chain.then(async () => { const r = await fn(); if (r && r.error) throw r.error; return r; });
  chain = run.catch(() => {});
  return run.finally(() => { writing--; bump(); });
}

/* Live-Updates: Änderungen der Familie sofort auf allen Handys zeigen */
let channel = null;
function subscribe(){
  if (channel){ sb.removeChannel(channel); channel = null; }
  if (!D.membership) return;
  const fid = D.membership.family_id;
  channel = sb.channel('fam-'+fid)
    .on('postgres_changes', { event:'*', schema:'public', table:'memberships', filter:'family_id=eq.'+fid }, scheduleReload)
    .on('postgres_changes', { event:'*', schema:'public', table:'wishes', filter:'family_id=eq.'+fid }, scheduleReload)
    .on('postgres_changes', { event:'*', schema:'public', table:'fridges', filter:'family_id=eq.'+fid }, scheduleReload)
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'profiles' }, scheduleReload)
    .on('postgres_changes', { event:'*', schema:'public', table:'custom_recipes', filter:'family_id=eq.'+fid }, scheduleReload)
    .on('postgres_changes', { event:'*', schema:'public', table:'polls', filter:'family_id=eq.'+fid }, scheduleReload)
    .on('postgres_changes', { event:'*', schema:'public', table:'votes', filter:'family_id=eq.'+fid }, scheduleReload)
    .on('postgres_changes', { event:'*', schema:'public', table:'announcements' }, scheduleReload)
    .on('postgres_changes', { event:'*', schema:'public', table:'shopping_items', filter:'family_id=eq.'+fid }, scheduleReload)
    .on('postgres_changes', { event:'*', schema:'public', table:'meal_plan', filter:'family_id=eq.'+fid }, scheduleReload)
    .on('postgres_changes', { event:'*', schema:'public', table:'recipe_notes', filter:'family_id=eq.'+fid }, scheduleReload)
    .on('postgres_changes', { event:'*', schema:'public', table:'board_posts', filter:'family_id=eq.'+fid }, scheduleReload)
    .on('postgres_changes', { event:'*', schema:'public', table:'recipe_collections', filter:'family_id=eq.'+fid }, scheduleReload)
    .on('postgres_changes', { event:'*', schema:'public', table:'cook_log', filter:'family_id=eq.'+fid }, scheduleReload)
    .on('postgres_changes', { event:'*', schema:'public', table:'ratings', filter:'family_id=eq.'+fid }, scheduleReload)
    .on('presence', { event:'sync' }, readPresence)
    .subscribe(st => { if (st === 'SUBSCRIBED' && UI.shopMode) shopPresence(true); });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && D.user) scheduleReload(); });

/* ---------- Rezepte: feste Sammlung + eigene Familienrezepte ---------- */
const RX = () => [...R, ...D.xrec, ...D.custom];
async function loadXRec(){ try { const { data, error } = await sb.from('recipes').select('id,data,source').eq('active', true).limit(2000); if (error || !data) return;
  D.xrec = data.map(x => { const d = x.data || {}; return { id:'x_'+x.id, n:String(d.n||'').slice(0,80), e:d.e||'🍽️', t:+d.t||30, m:d.m||'normal', meal:d.meal, i:(d.i||[]).filter(k => ING[k]), o:(d.o||[]).filter(k => ING[k]), x:d.x||[], s:(d.s||[]).map(String), src:x.source||'', xdb:true }; }).filter(r => r.n && r.i.length && r.s.length);
  if (D.xrec.length) render(); } catch(e){} }
/* Datum als JJJJ-MM-TT in Ortszeit */
/* ---------- Saison-Look (Halloween) ----------
   Läuft automatisch vom 24. Oktober bis 2. November. Unter „Mehr → Darstellung" abschaltbar. */
const seasonByDate = () => { const d = new Date(), m = d.getMonth(), t = d.getDate(); return (m === 9 && t >= 24) || (m === 10 && t <= 2) ? 'halloween' : (m === 11 && t <= 26) ? 'advent' : null; };
const seasonNow = () => L.season === false ? null : (L.preview || seasonByDate());
const hwSeason = () => (L.preview || seasonByDate()) === 'halloween';
const hwOn = () => seasonNow() === 'halloween';
const adOn = () => seasonNow() === 'advent';
const HW_BATS = '<svg viewBox="0 0 64 28" aria-hidden="true"><path fill="currentColor" d="M32 9c1.6-3 3.2-4 4.2-4-.3 1.3-.1 2.3.6 3.1 3-3.4 8.5-6.3 15.2-6.1-2.6 1.5-3.6 3.6-3.2 6 2.9-.7 6.2-.2 9.2 1.6-3.4.4-5.5 2.1-6.3 4.9-2.6-1.5-5.6-1.5-8.4.4-.6-2.2-2.7-3.5-5.4-3.4L32 17l-5.9-5.5c-2.7-.1-4.8 1.2-5.4 3.4-2.8-1.9-5.8-1.9-8.4-.4-.8-2.8-2.9-4.5-6.3-4.9 3-1.8 6.3-2.3 9.2-1.6.4-2.4-.6-4.5-3.2-6 6.7-.2 12.2 2.7 15.2 6.1.7-.8.9-1.8.6-3.1 1 0 2.6 1 4.2 4z"/></svg>';
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const nextDays = n => Array.from({ length:n }, (_, i) => { const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate() + i); return d; });
const planFor = (iso, slot = 'abend') => D.plan.find(p => p.day === iso && (p.slot || 'abend') === slot);
const SLOTS = [['frueh','Frühstück','☕'],['mittag','Mittag','🥪'],['abend','Abendessen','🍽️']];
const isOut = p => p && p.recipe_id === '__out';

/* ---------- Einkaufsliste ---------- */
const openShop = () => D.shop.filter(x => !x.checked);
const onList = k => D.shop.some(x => !x.checked && x.ing_key === k);
async function addToList(keys = [], label = ''){
  const rows = [];
  const lx = D.cap.shop3 && UI.slist ? { list: UI.slist } : {}, nx = D.cap.shop3 && addToList.note ? { note: addToList.note } : {};
  [...new Set(keys)].filter(k => ING[k] && !onList(k)).forEach(k => rows.push({ family_id:D.family.id, ing_key:k, added_by:D.user.id, ...lx, ...nx }));
  if (label) rows.push({ family_id:D.family.id, label:label.slice(0,60), added_by:D.user.id, ...lx, ...nx });
  if (!rows.length) return 0;
  const tmp = rows.map(r => ({ ...r, id:'tmp'+Math.random().toString(36).slice(2), checked:false, created_at:new Date().toISOString() }));
  D.shop.push(...tmp); paintSoft();
  try { await save(async () => { const r = await sb.from('shopping_items').insert(rows).select(); (r.data||[]).forEach((row, i) => tmp[i] && Object.assign(tmp[i], row)); return r; }); }
  catch(e){ D.shop = D.shop.filter(x => !tmp.includes(x)); paintSoft(); throw e; }
  return rows.length;
}
function toggleShop(id){
  const it = D.shop.find(x => x.id === id); if (!it) return;
  it.checked = !it.checked;
  if (it.checked && it.ing_key && !D.fridge.includes(it.ing_key)){ D.fridge = [...D.fridge, it.ing_key]; saveFridgeSoon(); }
  const val = it.checked;
  save(() => String(it.id).startsWith('tmp') ? null : sb.from('shopping_items').update({ checked:val }).eq('id', it.id)).catch(e => toast(errText(e)));
}
function removeShop(items){
  D.shop = D.shop.filter(x => !items.includes(x));
  save(() => { const ids = items.map(x => x.id).filter(id => !String(id).startsWith('tmp')); return ids.length ? sb.from('shopping_items').delete().in('id', ids) : null; }).catch(e => toast(errText(e)));
}
const shopName = x => x.ing_key ? `${ingEmoji(x.ing_key)} ${ingName(x.ing_key)}` : `🛒 ${esc(x.label)}`;
/* Ansicht nach eigener Änderung neu zeichnen (Hauptansicht und offenes Fenster) */
function paintSoft(){ render(); if ($('.sheet')) refreshSheet(); }
const rec = id => RX().find(r => r.id === id);

/* ---------- Ablaufdaten ---------- */
function daysLeft(k){
  const v = D.expiries[k]; if (!v || !D.fridge.includes(k)) return null;
  const t = new Date(); t.setHours(0,0,0,0);
  return Math.round((new Date(v + 'T00:00:00') - t) / 864e5);
}
const expLabel = n => n < 0 ? 'abgelaufen' : n === 0 ? 'heute' : n === 1 ? 'morgen' : `in ${n} Tagen`;
const expiringSoon = () => D.fridge.map(k => ({ k, d: daysLeft(k) })).filter(x => x.d !== null && x.d <= 2).sort((a,b) => a.d - b.d);

/* ---------- Logik: Was passt für alle? ---------- */
function conflicts(r, p){
  const out = [];
  if (p.picky){ const no = r.i.filter(k => !(p.likes||[]).includes(k)); if (no.length) out.push('isst keine ' + ingName(no[0])); }
  if (p.veg && (r.x.includes('fleisch') || r.x.includes('fisch'))) out.push('isst vegetarisch');
  (p.dislikes||[]).forEach(d => { if (r.i.includes(d)) out.push('mag keine ' + ingName(d)); if (r.x.includes(d)) out.push('mag kein ' + (TRAITS[d]||d)); });
  (p.allergies||[]).forEach(a => { if (allergensOf(r).includes(a)) out.push('verträgt kein ' + ALLERGENS[a]); });
  return out;
}
function softNotes(r, people){
  const n=[]; people.forEach(p => { (p.dislikes||[]).forEach(d => { if (r.o.includes(d)) n.push(`${ingName(d)} bei ${p.name} weglassen`); }); if (p.veg) r.o.filter(k => MEAT.includes(k) || FISH.includes(k)).forEach(k => n.push(`${ingName(k)} bei ${p.name} weglassen`));
    (p.allergies||[]).forEach(a => r.o.filter(k => ((ING[k]&&ING[k][3])||[]).includes(a)).forEach(k => n.push(`${ingName(k)} bei ${p.name} weglassen`)));
    if (p.picky) r.o.filter(k => !(p.likes||[]).includes(k)).forEach(k => n.push(`${ingName(k)} bei ${p.name} weglassen`)); });
  return [...new Set(n)];
}
const wishersOf = rid => [...new Set(D.wishes.filter(w=>w.recipe_id===rid).map(w=>w.user_id))].filter(id => active().some(m=>m.user_id===id));
function suggest(){
  const people = eatersNow().map(prof), fr = new Set(D.fridge);
  /* Tageszeit: morgens Frühstück nach oben, Süßes nie als Hauptgericht */
  const h = new Date().getHours(), morning = h >= 5 && h < 11;
  const mealAdj = r => r.meal === 'fruehstueck' ? (morning ? 35 : -25) : r.meal === 'suess' ? -45 : (morning ? -10 : 0);
  return RX().filter(r => r.t <= UI.time && (UI.mood==='egal' || r.m===UI.mood))
    .filter(r => people.every(p => conflicts(r,p).length===0))
    .map(r => {
      const missing = r.i.filter(k=>!fr.has(k)), wishers = wishersOf(r.id), favs = people.filter(p=>(p.favs||[]).includes(r.id));
      const cover = r.i.length ? (r.i.length-missing.length)/r.i.length : 1;
      const uses = [...r.i, ...r.o].filter(k => fr.has(k) && (d => d !== null && d >= 0 && d <= 3)(daysLeft(k)));
      const rt = ratingOf(r.id), seas = inSeason(r);
      return { r, missing, wishers, favs, cover, uses, rt, seas, score: wishers.length*40 + favs.length*14 + cover*60 - missing.length*8 + uses.length*30 + mealAdj(r) + (rt.n ? (rt.avg - 3) * 12 : 0) + (seas ? 10 : 0) };
    }).sort((a,b)=>b.score-a.score);
}
function whyLines(s){
  const l=[];
  if (s.wishers.length) l.push(`🙋 ${esc(names(s.wishers.map(id=>prof(id).name)))} ${s.wishers.length>1?'haben':'hat'} sich das gewünscht`);
  if (s.favs.length) l.push(`❤️ Lieblingsessen von ${esc(names(s.favs.map(p=>p.name)))}`);
  if (s.uses && s.uses.length) l.push(`⏰ Verbraucht ${esc(names(s.uses.map(ingName)))}, läuft bald ab`);
  if (s.rt && s.rt.n && s.rt.avg >= 4.2) l.push(`⭐ Familien-Hit – ${s.rt.avg.toFixed(1).replace('.', ',')} von 5`);
  if (s.seas) l.push(`🍂 Gerade in Saison: ${esc(names(s.seas.map(ingName)))}`);
  l.push(s.missing.length===0 ? '✅ Du hast alles da' : s.missing.length===1 ? `🛒 Es fehlt nur: ${ingName(s.missing[0])}` : `🛒 Es fehlen ${s.missing.length} Zutaten`);
  return l;
}

/* ---------- Icons (Platzhalter – werden durch Icons8-Icons ersetzt) ---------- */
const I = {
  home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11c0-4 3.6-7 8-7s8 3 8 7H4z"/><path d="M3 11h18M6 15h12l-1 5H7z"/></svg>',
  fridge:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="2" width="14" height="20" rx="3"/><path d="M5 10h14M9 5.5v2M9 13v3"/></svg>',
  book:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z"/></svg>',
  family:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20c.6-3.5 2.8-5.5 5.5-5.5s4.9 2 5.5 5.5M14 15.5c.9-.7 1.9-1 3-1 2.3 0 4 1.7 4.5 4.5"/></svg>',
  cam:'<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  mic:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  speaker:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  x:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  heart:'<svg width="22" height="22" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 21s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z"/></svg>',
  qr:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v7h-7M17 21v-3"/></svg>',
  more:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>',
  chev:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity=".5"><path d="M9 5l7 7-7 7"/></svg>',
};

/* ---------- Tab-Leiste ---------- */
function renderTabbar(){
  const show = D.user && isActive() && !D.profile?.banned;
  $('#tabbar').hidden = !show; if (!show) return;
  const p = isAdmin() ? pendingReq().length : 0;
  // Icons8 (iOS-Stil): Umriss für inaktive Tabs, gefüllt für den aktiven Tab
  const ti = n => `<i class="ti" aria-hidden="true" style="--o:url(icons/tab/o-${n}.png);--f:url(icons/tab/f-${n}.png)"></i>`;
  const tabs = [['home','Heute',ti('restaurant')],['fridge','Kühlschrank',ti('fridge')],['recipes','Planen',ti('calendar')],['family','Familie',ti('conference-call')],['more','Mehr',ti('more')]];
  const tb = $('#tabbar'), idx = Math.max(0, tabs.findIndex(t => t[0] === UI.tab));
  if (!tb.querySelector('.tab-pill')) tb.innerHTML = `<span class="tab-pill" aria-hidden="true"></span>` + tabs.map(([id,l,ic]) => `<button class="tab" data-tab="${id}">${ic}<span>${l}</span></button>`).join('');
  tabs.forEach(([id]) => { const b = tb.querySelector(`[data-tab="${id}"]`); if (!b) return;
    if (UI.tab === id){ if (b.getAttribute('aria-current') !== 'page') b.setAttribute('aria-current', 'page'); } else b.removeAttribute('aria-current');
    let d = b.querySelector('.dot'); const want = id === 'family' && p ? String(p) : '';
    if (want && !d){ d = document.createElement('span'); d.className = 'dot'; b.appendChild(d); } if (d){ if (want) d.textContent = want; else d.remove(); } });
  tb.querySelector('.tab-pill').style.transform = `translateX(${idx * 100}%)`;
}

/* ---------- Ansichten: Start & Anmeldung ---------- */
const AVS = ['🧒','👧','👦','👩','👨','👵','👴','🧑'];
function viewSetup(){
  return `<div class="center"><div class="r-hero">🔌</div><div class="h1" style="text-align:center">Noch nicht verbunden</div>
    <p class="muted" style="text-align:center">Trage in <b>config.js</b> die Adresse und den Schlüssel deines Supabase-Projekts ein. Die Anleitung steht in der README.</p></div>`;
}
function viewAuth(){
  const reg = UI.auth === 'register';
  if (UI.auth === 'check') return `<div class="center"><div class="r-hero">📬</div><div class="h1" style="text-align:center">Fast geschafft!</div>
    <p class="muted" style="text-align:center">Wir haben dir eine E-Mail geschickt. Tippe auf den Link darin und melde dich dann hier an.</p>
    <button class="btn btn-herb btn-block" data-action="auth-mode" data-v="login">Zur Anmeldung</button></div>`;
  return `<div class="center">
    ${installBanner()}
    <div class="logo-big">Was<br>gibt's<span>?</span></div>
    <p class="muted" style="text-align:center;margin:0 0 6px">Ein Essen, das allen schmeckt, aus dem, was da ist.</p>
    ${UI.joinCode||L.joinCode ? `<div class="card" style="background:var(--herb-soft);font-weight:700">👋 Du wurdest in eine Familie eingeladen. ${reg?'Erstelle':'Melde dich an oder erstelle'} deinen Account, dann geht's los.</div>` : ''}
    <form id="authForm" class="stack" style="gap:0" novalidate>
      ${reg ? `<div class="field"><label for="a-name">Dein Name</label><input id="a-name" class="input" maxlength="30" autocomplete="given-name" required></div>
        <div class="field"><span class="lbl2">Dein Bild</span><div class="emoji-pick">${AVS.map(a=>`<button type="button" data-action="pick-av" data-v="${a}" aria-pressed="${(L.av||'🧑')===a}">${a}</button>`).join('')}</div></div>` : ''}
      <div class="field"><label for="a-mail">E-Mail</label><input id="a-mail" class="input" type="email" autocomplete="email" required></div>
      <div class="field"><label for="a-pass">Passwort</label><input id="a-pass" class="input" type="password" minlength="6" autocomplete="${reg?'new-password':'current-password'}" required></div>
      ${UI.err ? `<div class="err" role="alert">${esc(UI.err)}</div>` : ''}
      <button class="btn btn-herb btn-block" type="submit" style="margin-top:12px" ${UI.busy?'disabled':''}>${UI.busy?'<span class="spin"></span>':reg?'Account erstellen':'Anmelden'}</button>
    </form>
    <button class="linkbtn" data-action="auth-mode" data-v="${reg?'login':'register'}">${reg?'Ich habe schon einen Account':'Neu hier? Account erstellen'}</button>
  </div>`;
}
function viewNoFamily(){
  const p = D.profile;
  if (D.membership && D.membership.status==='pending') return `<div class="center" style="text-align:center">
      <div class="r-hero">⏳</div><div class="h1">Warte auf Bestätigung</div>
      <p class="muted">Deine Anfrage an <b>${esc(D.family ? D.family.name : 'die Familie')}</b> ist raus. Sobald ein Admin dich annimmt, geht es automatisch weiter.</p>
      <button class="btn btn-line" data-action="leave">Anfrage zurückziehen</button>
      <button class="linkbtn" data-action="logout">Abmelden</button></div>`;
  const code = UI.joinCode || L.joinCode || '';
  return `<div class="center">
    <div class="r-hero">${avIn(p)}</div>
    <div class="h1" style="text-align:center">Willkommen, ${esc(p.name)}!</div>
    <p class="muted" style="text-align:center;margin:0">Tritt deiner Familie bei oder gründe eine neue.</p>
    <div class="card"><div class="field" style="margin-bottom:10px"><label for="join-code">Familien-Code</label>
      <input id="join-code" class="input" placeholder="WG-XXXX" value="${esc(code)}" style="text-transform:uppercase;letter-spacing:.1em;font-weight:800" autocomplete="off"></div>
      <button class="btn btn-herb btn-block" data-action="join">${I.qr} Beitritt anfragen</button>
      <p class="muted" style="font-size:13px;margin:10px 0 0">Tipp: Scanne den QR-Code des Admins einfach mit der Handy-Kamera, dann wird der Code automatisch eingetragen.</p></div>
    <div class="card"><div class="field" style="margin-bottom:10px"><label for="fam-name">Oder neue Familie gründen</label>
      <input id="fam-name" class="input" maxlength="40" placeholder="z. B. Familie Sonnenberg"></div>
      <button class="btn btn-line btn-block" data-action="create-family">Familie gründen</button></div>
    ${UI.err ? `<div class="err" role="alert">${esc(UI.err)}</div>` : ''}
    <button class="linkbtn" data-action="logout">Abmelden</button></div>`;
}

/* ---------- Ansichten: App ---------- */
function header(title, sub){
  return `<div class="top"><div><div class="muted" style="font-weight:700">${sub}</div><div class="h1">${title}</div></div>
    <button class="avatar" data-tab="family" aria-label="Familie und Profil">${avIn(D.profile)}</button></div>` + offlineBar() + (partyOn() && Date.now() < PARTY.at && UI.tab !== 'home' ? partyChip() : '');
}
function suggestionCard(s){
  return `<button class="rc" data-action="open-recipe" data-id="${s.r.id}">
    ${photoEm(s.r)}
    <div class="main"><div class="t">${esc(s.r.n)}</div>
      <div class="s"><span>⏱ ${s.r.t} Min</span>${s.wishers.length?`<span class="chip c-tomato">🙋 ${s.wishers.length}</span>`:''}${s.favs.length?`<span class="chip c-tomato">❤️ ${s.favs.length}</span>`:''}${s.r.m==='fast'?'<span class="chip c-yolk">Fastfood</span>':s.r.m==='gesund'?'<span class="chip c-herb">Gesund</span>':''}${s.rt && s.rt.n ? `<span class="chip c-yolk">⭐ ${s.rt.avg.toFixed(1).replace('.', ',')}</span>` : ''}${s.seas ? '<span class="chip c-herb">🍂 Saison</span>' : ''}</div>
      ${s.missing.length?`<div class="s" style="margin-top:4px"><span class="chip c-yolk">🛒 ${s.missing.map(ingName).join(', ')}</span></div>`:'<div class="meter"><i style="width:100%"></i></div>'}</div>${I.chev}</button>`;
}
function viewHome(){
  const eat = eatersNow(), all = suggest();
  /* Nur zeigen, was mit dem Kühlschrank wirklich geht – plus Ideen mit genau einem Einkauf */
  const ready0 = all.filter(s => s.missing.length===0), almost = all.filter(s => s.missing.length===1);
  const top = ready0.find(s => s.r.meal !== 'suess'), ready = top ? [top, ...ready0.filter(s => s !== top)] : [];
  const h = new Date().getHours(), greet = (h<11?'Guten Morgen':h<17?'Hallo':'Guten Abend') + (hwOn() ? ' · Happy Halloween 🎃' : adOn() ? ' · Schöne Adventszeit 🎄' : '');
  const p = isAdmin() ? pendingReq() : [];
  return header(`Was gibt's heute, ${esc(D.profile.name)}?`, greet) + partyCard() + annBanner() + installBanner() + pushBanner() + hwCard() + adventCard() + rateBanner() +
    (p.length ? `<button class="banner" data-tab="family"><span class="avatar sm">${avIn(prof(p[0].user_id))}</span><span style="flex:1"><b>${esc(prof(p[0].user_id).name)}</b> möchte deiner Familie beitreten</span>${I.chev}</button>` : '') +
    (expiringSoon().length ? `<button class="banner" style="background:var(--tomato-soft)" data-action="reste-on"><span style="font-size:22px">⏰</span><span style="flex:1"><b>Bald aufbrauchen:</b> ${expiringSoon().map(x=>`${esc(ingName(x.k))} (${expLabel(x.d)})`).join(', ')}</span>${I.chev}</button>` : '') +
    `${todayPlanned()}
    ${filterSummary(eat)}
    <div class="filters card" ${UI.filtersOpen ? '' : 'hidden'} id="home-filters">
      <div class="who sm" role="group" aria-label="Wer isst mit">${active().map(m=>{ const a=prof(m.user_id); return `<button data-action="eater" data-id="${a.id}" aria-pressed="${eat.includes(a.id)}"><span class="avatar">${avIn(a)}</span>${esc(a.name)}</button>`; }).join('')}</div>
      <div class="frow">
        <div class="seg mini" role="group" aria-label="Zeit">${[[15,'15 Min'],[30,'30 Min'],[60,'Egal']].map(([v,l])=>`<button data-action="time" data-v="${v}" aria-pressed="${UI.time===v}" aria-label="${v===60?'Zeit egal':v+' Minuten'}">${l}</button>`).join('')}</div>
        <div class="seg mini" role="group" aria-label="Lust">${[['gesund','🥗'],['egal','Egal'],['fast','🍔']].map(([v,l])=>`<button data-action="mood" data-v="${v}" aria-pressed="${UI.mood===v}" aria-label="${v==='gesund'?'Gesund':v==='fast'?'Fastfood':'Egal'}">${l}</button>`).join('')}</div>
      </div>
    </div>
    ${pollBlock(all)}
    <div class="h2">${planFor(isoDay(new Date())) ? 'Oder spontan' : 'Du könntest machen'}</div>
    ${planFor(isoDay(new Date())) && ready.length ? `<div class="stack">${ready.filter(x => x.r.id !== planFor(isoDay(new Date())).recipe_id).slice(0,4).map(suggestionCard).join('')}</div>` : top ? `<button class="pick" data-action="open-recipe" data-id="${top.r.id}">${pickArt(top.r)}
        <div class="lbl">UNSER VORSCHLAG</div><div class="name">${esc(top.r.n)}</div>
        <div class="why">${whyLines(top).map(l=>`<span>${l}</span>`).join('')}</div>
        <div class="meta"><span class="chip">⏱ ${top.r.t} Min</span><span class="chip">Passt für ${eat.length===active().length?'alle':eat.length+' Personen'}</span></div></button>
      <button class="btn btn-herb btn-block" style="margin-top:10px" data-action="cook" data-id="${top.r.id}">👨‍🍳 Jetzt kochen</button>
      ${ready.length>1?`<div class="h2">Geht auch <span class="chip c-muted">${ready.length-1}</span></div><div class="stack">${ready.slice(1,8).map(suggestionCard).join('')}</div>`:''}`
    : `<div class="card empty"><div class="g">🧊</div><b>Mit dem, was da ist, passt noch kein Rezept</b>Trag im Kühlschrank ein, was du hast, oder schau unten, was mit einem Einkauf geht.<button class="btn btn-line btn-block" style="margin-top:12px" data-tab="fridge">Kühlschrank öffnen</button></div>`}
    ${all.length > 2 ? `<button class="slot-btn" data-action="slot"><span class="slot-ic">🎰</span><span><b>Kann mich nicht entscheiden</b><small>Dreh am Rad – die App sucht aus</small></span>${I.chev}</button>` : ''}
    ${almost.length?`<div class="h2">Mit einem kleinen Einkauf <span class="chip c-muted">${almost.length}</span></div><div class="stack">${almost.slice(0,6).map(suggestionCard).join('')}</div>`:''}
    ${seasonRow()}
    ${showPlusWidget() ? plusWidget() : ''}
    ${sponsorWidget()}`;
}
/* Filter-Zeile: zusammengeklappt, öffnet sich beim Antippen (Apple: schrittweise zeigen) */
function filterSummary(eat){
  const n = eat.length, all = active().length;
  const t = UI.time === 60 ? 'Zeit egal' : `bis ${UI.time} Min`, m = UI.mood === 'gesund' ? 'gesund' : UI.mood === 'fast' ? 'schnell & deftig' : 'Lust egal';
  const changed = n !== all || UI.time !== 60 || UI.mood !== 'egal';
  return `<button class="fsum ${changed ? 'on' : ''}" data-action="filters-toggle" aria-expanded="${!!UI.filtersOpen}" aria-controls="home-filters">
    <span class="fsum-ic" aria-hidden="true">⚙︎</span><span class="grow"><b>${n === all ? 'Für alle' : `Für ${n} von ${all}`}</b> · ${t} · ${m}</span><span class="fsum-chev" aria-hidden="true">${UI.filtersOpen ? '▴' : '▾'}</span></button>`;
}
/* Heute im Wochenplan */
function todayPlanned(){
  const p = planFor(isoDay(new Date())), r = p && rec(p.recipe_id);
  if (isOut(p)) return `<div class="h2">Heute auf dem Plan</div><button class="banner soft" data-action="plan-day" data-v="${p.day}"><span style="font-size:24px">🍕</span><span style="flex:1"><b>${esc(p.label || 'Auswärts essen')}</b><br><span class="muted" style="font-size:13px">Heute wird nicht gekocht${p.cook ? ' · kümmert sich: ' + esc(prof(p.cook).name) : ''}</span></span></button>`;
  if (!r) return '';
  const miss = r.i.filter(k => !D.fridge.includes(k));
  return `<div class="h2">Heute auf dem Plan</div>
    <button class="pick planned" data-action="open-recipe" data-id="${r.id}">${pickArt(r)}
      <div class="lbl">📅 WOCHENPLAN</div><div class="name">${esc(r.n)}</div>
      <div class="why"><span>${miss.length ? `🛒 Es fehlt noch: ${esc(miss.map(ingName).join(', '))}` : '✅ Du hast alles da'}</span></div>
      <div class="meta"><span class="chip">⏱ ${r.t} Min</span>${p.set_by && p.set_by !== D.user.id ? `<span class="chip">Geplant von ${esc(prof(p.set_by).name)}</span>` : ''}</div></button>
    <div style="display:grid;grid-template-columns:${miss.length ? '1fr 1fr' : '1fr'};gap:8px;margin-top:10px">
      <button class="btn btn-herb" data-action="cook" data-id="${r.id}">👨‍🍳 Jetzt kochen</button>
      ${miss.length ? `<button class="btn btn-ghost" data-action="shop-missing" data-id="${r.id}">🛒 Auf die Liste</button>` : ''}</div>`;
}
function expTag(k){ const d = daysLeft(k); if (d === null) return ''; return ` <span class="exp ${d<=1?'hot':''}">${d<0?'abgelaufen':d===0?'heute':d+' T'}</span>`; }
function viewFridge(){
  const n = openShop().length;
  const tabs = `<div class="seg" role="group" aria-label="Ansicht" style="margin-bottom:14px">
      <button data-action="ftab" data-v="fridge" aria-pressed="${UI.ftab!=='shop'}">🧊 Kühlschrank <span class="seg-n">${D.fridge.length}</span></button>
      <button data-action="ftab" data-v="shop" aria-pressed="${UI.ftab==='shop'}">🛒 Einkaufsliste${n?` <span class="seg-n hot">${n}</span>`:''}</button></div>`;
  if (UI.ftab === 'shop') return header('Einkaufsliste', 'Für die ganze Familie · live') + tabs + viewShopping();
  const fr = new Set(D.fridge), q = (UI.fq || '').trim().toLowerCase();
  const match = k => !q || ingMatch(k, q) > 0;
  const chip = k => `<button class="ing ${UI.justAdded&&UI.justAdded.includes(k)?'just':''}" data-action="ing" data-k="${k}" aria-pressed="${fr.has(k)}">${fr.has(k) ? '<span class="ing-ok" aria-hidden="true">✓</span>' : ''}${ING[k][1]} ${ING[k][0]}${expTag(k)}</button>`;
  const onlyHave = UI.fonly === 'have';
  if (!UI.recentSnap) UI.recentSnap = [...(L.recentIng || [])];
  const recent = UI.recentSnap.filter(k => ING[k] && match(k)).slice(0, 8);
  const cats = CATS.map(([id, e, title, keys]) => {
    const ks = keys.filter(k => match(k) && (!onlyHave || fr.has(k)));
    if (!ks.length) return '';
    const have = keys.filter(k => fr.has(k)).length;
    return `<div class="h2">${e} ${title} <span class="chip c-muted">${have} vorhanden</span></div><div class="chips">${ks.map(chip).join('')}</div>`;
  }).join('');
  const html = header('Was ist da?', `${plu(D.fridge.length,'Zutat','Zutaten')} · für alle sichtbar`) + tabs +
    `<button class="photo-card" data-action="photo"><span class="cam">${I.cam}</span><span style="flex:1"><b style="font-size:17px">Kühlschrank fotografieren</b><br><span style="opacity:.9;font-size:14px">Die App erkennt deine Zutaten automatisch</span></span></button>
    <div id="scanArea"></div>
    ${plusHint('fridge')}
    <div class="fbar"><input id="fsearch" class="input" type="search" placeholder="Zutat suchen …" value="${esc(UI.fq||'')}" aria-label="Zutat suchen" autocomplete="off">
      <div class="seg mini" role="group"><button data-action="fonly" data-v="all" aria-pressed="${!onlyHave}">Alle</button><button data-action="fonly" data-v="have" aria-pressed="${onlyHave}">Da</button></div></div>
    ${recent.length && !onlyHave ? `<div class="h2">🕘 Zuletzt benutzt</div><div class="chips">${recent.map(chip).join('')}</div>` : ''}
    ${cats || `<div class="card empty"><div class="g">🔍</div><b>Nichts gefunden</b>${q ? `<button class="btn btn-line btn-block" style="margin-top:12px" data-action="shop-free" data-v="${esc(UI.fq)}">„${esc(UI.fq)}" auf die Einkaufsliste</button>` : 'Tipp oben auf „Alle".'}</div>`}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px"><button class="btn btn-line" data-action="exp-photo">📷 MHD fotografieren</button><button class="btn btn-line" data-action="expiry">📅 Haltbarkeit</button></div>
    <p class="muted" style="font-size:13px;margin-top:12px">Salz, Pfeffer, Öl, Zucker und Gewürze setzen wir als vorhanden voraus.</p>
    <button class="btn btn-line btn-block" style="margin-top:6px" data-action="clear-fridge">Alles abwählen</button>`;
  UI.justAdded = null; return html;
}
const SLISTS = [['super','Supermarkt','🛒'],['drogerie','Drogerie','🧴'],['markt','Markt','🥕']];
function viewShopping(){
  const inList = x => !D.cap.shop3 || !UI.slist || (x.list || 'super') === UI.slist;
  const open = openShop().filter(inList), done = D.shop.filter(x => x.checked && inList(x)), q = (UI.sq || '').trim().toLowerCase();
  const sugg = q ? Object.keys(ING).map(k => [k, ingMatch(k, q)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1] || ING[a[0]][0].length - ING[b[0]][0].length).map(x => x[0]).slice(0, 6) : [];
  const row = x => `<div class="shop-row ${x.checked?'done':''}" data-id="${x.id}">
      <button class="tick" data-action="shop-toggle" data-id="${x.id}" aria-label="${x.checked?'Wieder offen':'Abhaken'}" aria-pressed="${x.checked}">✓</button>
      <button class="grow shop-name" data-action="shop-edit" data-id="${x.id}">${shopName(x)}${x.note ? `<small class="shop-note">${esc(x.note)}</small>` : ''}${x.assigned_to ? `<small class="shop-who">🙋 ${x.assigned_to === D.user.id ? 'Du bringst es mit' : esc(prof(x.assigned_to).name) + ' bringt es mit'}</small>` : ''}</button>
      ${x.added_by && x.added_by !== D.user.id && !x.assigned_to ? `<span class="avatar sm" title="${esc(prof(x.added_by).name)}">${avIn(prof(x.added_by))}</span>` : ''}
      <button class="x" data-action="shop-del" data-id="${x.id}" aria-label="Entfernen">${I.x}</button></div>`;
  const planned = plannedMissing();
  const shoppers = (UI.shoppers || []).filter(id => id !== D.user.id);
  return (shoppers.length ? `<div class="banner live-shop"><span class="ls-dot"></span><span style="flex:1"><b>${esc(names(shoppers.map(id => prof(id).name)))}</b> ${shoppers.length > 1 ? 'sind' : 'ist'} gerade einkaufen – was du jetzt hinzufügst, sehen sie sofort.</span></div>` : '') +
    (D.cap.shop3 ? `<div class="seg" role="group" aria-label="Liste" style="margin-bottom:10px"><button data-action="slist" data-v="" aria-pressed="${!UI.slist}">Alle</button>${SLISTS.map(([k,l,e]) => `<button data-action="slist" data-v="${k}" aria-pressed="${UI.slist===k}">${l}</button>`).join('')}</div>` : '') +
    `<form class="shop-add" id="shopForm" autocomplete="off"><input id="shopIn" class="input" placeholder="Was fehlt? z. B. Milch" value="${esc(UI.sq||'')}" aria-label="Zur Einkaufsliste hinzufügen">${voiceOK() ? `<button class="btn btn-ghost mic-btn ${UI.listening?'on':''}" type="button" data-action="shop-voice" aria-label="Per Sprache hinzufügen">🎤</button>` : ''}<button class="btn btn-herb" type="submit" aria-label="Hinzufügen">+</button></form>
    ${sugg.length ? `<div class="chips" style="margin:10px 0 4px">${sugg.map(k => `<button class="ing" data-action="shop-ing" data-k="${k}" ${onList(k)?'aria-pressed="true"':''}>${ING[k][1]} ${ING[k][0]}</button>`).join('')}</div>` : ''}
    ${planned.length ? `<button class="banner soft" data-action="shop-plan"><span style="font-size:22px">📅</span><span style="flex:1"><b>Für den Wochenplan ${planned.length === 1 ? 'fehlt 1 Zutat' : `fehlen ${planned.length} Zutaten`}</b><br><span class="muted" style="font-size:13px">${esc(planned.slice(0,4).map(ingName).join(', '))}${planned.length>4?' …':''}</span></span><span class="chip c-herb">Hinzufügen</span></button>` : ''}
    ${open.length ? `<div class="shop-tools"><button class="btn btn-herb" data-action="shop-mode">🛒 Einkaufs-Modus</button><button class="btn btn-ghost" data-action="shop-share">📤 Teilen</button></div>
      ${aisles(open).map(([t, items]) => `<div class="h2 aisle">${t}</div><div class="card list-card">${items.map(row).join('')}</div>`).join('')}`
      : `<div class="card empty"><div class="g">🛒</div><b>Die Liste ist leer</b>Tippe oben ein, was fehlt${voiceOK() ? ' – oder sag es einfach mit dem Mikrofon' : ''}.
        ${planned.length ? `<button class="btn btn-herb btn-block" style="margin-top:12px" data-action="shop-plan">📅 ${planned.length === 1 ? '1 Zutat' : planned.length + ' Zutaten'} für den Wochenplan hinzufügen</button>` : `<button class="btn btn-line btn-block" style="margin-top:12px" data-tab="recipes">📅 Woche planen – dann kommt die Liste fast von allein</button>`}</div>`}
    ${done.length ? `<div class="h2">Erledigt <button class="linkbtn" data-action="shop-clear">Löschen</button></div><div class="card list-card">${done.map(row).join('')}</div>` : ''}
    <p class="muted" style="font-size:13px;margin-top:14px">Abgehakte Zutaten landen automatisch im Kühlschrank.</p>
    ${plusHint('shop')}`;
}
/* Zutaten, die für geplante Gerichte fehlen (nicht im Kühlschrank, nicht auf der Liste) */
function plannedMissing(){
  const fr = new Set(D.fridge), out = new Set();
  D.plan.forEach(p => { const r = rec(p.recipe_id); if (r) r.i.forEach(k => { if (!fr.has(k) && !onList(k)) out.add(k); }); });
  return [...out];
}
/* ---------- Wochenplan ---------- */
const WD = ['So','Mo','Di','Mi','Do','Fr','Sa'], WDL = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
const dayLabel = (d, i) => i === 0 ? 'Heute' : i === 1 ? 'Morgen' : WDL[d.getDay()];
const dayShort = (d, i) => i === 0 ? 'Heute' : i === 1 ? 'Morgen' : WD[d.getDay()];
function mainKey(r){ return (r.i.find(k => MEAT.includes(k) || FISH.includes(k))) || ['nudeln','reis','kartoffeln','gnocchi','brot'].find(k => r.i.includes(k)) || r.i[0]; }
function planCandidates(){
  const people = active().map(m => prof(m.user_id)), fr = new Set(D.fridge);
  return RX().filter(r => r.meal !== 'suess' && r.meal !== 'fruehstueck' && people.every(p => conflicts(r, p).length === 0))
    .map(r => { const miss = r.i.filter(k => !fr.has(k)).length, favs = people.filter(p => (p.favs||[]).includes(r.id)).length;
      return { r, miss, score: wishersOf(r.id).length*40 + favs*12 + (1 - miss/(r.i.length||1))*40 - miss*3 + Math.random()*25 }; })
    .sort((a, b) => b.score - a.score);
}
function planRow(iso, rid, slot, extra){ const row = { family_id:D.family.id, day:iso, recipe_id:rid, set_by:D.user.id, updated_at:new Date().toISOString(), ...(extra||{}) };
  if (D.cap.plan3) row.slot = slot || 'abend'; else { delete row.cook; delete row.label; } return row; }
const planKey = () => D.cap.plan3 ? 'family_id,day,slot' : 'family_id,day';
function setPlan(iso, rid, slot = 'abend', extra){
  const ex = planFor(iso, slot), keep = ex && D.cap.plan3 ? { cook: ex.cook || null } : {};
  const row = planRow(iso, rid, slot, { label:null, ...keep, ...(extra||{}) });
  if (ex) Object.assign(ex, row); else D.plan.push({ ...row });
  paintSoft();
  return save(() => sb.from('meal_plan').upsert(row, { onConflict:planKey() }));
}
function clearPlan(iso, slot = 'abend'){
  D.plan = D.plan.filter(p => !(p.day === iso && (p.slot || 'abend') === slot)); paintSoft();
  return save(() => { let q = sb.from('meal_plan').delete().eq('family_id', D.family.id).eq('day', iso); if (D.cap.plan3) q = q.eq('slot', slot); return q; });
}
function setPlanCook(iso, slot, uid){ const ex = planFor(iso, slot); if (!ex || !D.cap.plan3) return;
  ex.cook = ex.cook === uid ? null : uid; paintSoft();
  return save(() => sb.from('meal_plan').update({ cook: ex.cook }).eq('family_id', D.family.id).eq('day', iso).eq('slot', slot)); }
async function fillWeek(){
  const used = new Set(D.plan.map(p => p.recipe_id)), cands = planCandidates(), rows = [];
  let prev = null, fast = D.plan.filter(p => rec(p.recipe_id)?.m === 'fast').length;
  for (const d of nextDays(7)){
    const iso = isoDay(d), ex = planFor(iso);
    if (ex){ const r = rec(ex.recipe_id); prev = r ? mainKey(r) : null; continue; }
    const pick = cands.find(c => !used.has(c.r.id) && mainKey(c.r) !== prev && (c.r.m !== 'fast' || fast < 2)) || cands.find(c => !used.has(c.r.id));
    if (!pick) break;
    used.add(pick.r.id); prev = mainKey(pick.r); if (pick.r.m === 'fast') fast++;
    const row = planRow(iso, pick.r.id, 'abend');
    rows.push(row); D.plan.push({ ...row });
  }
  if (!rows.length) return 0;
  paintSoft();
  await save(() => sb.from('meal_plan').upsert(rows, { onConflict:planKey() }));
  return rows.length;
}
function viewWeek(){
  const fr = new Set(D.fridge), days = nextDays(7), empty = days.filter(d => !planFor(isoDay(d))).length, miss = plannedMissing().length;
  const cookChip = p => p && p.cook ? `<span class="chip c-muted">👨‍🍳 ${esc(prof(p.cook).name)}</span>` : '';
  return `<div class="week">${days.map((d, i) => { const iso = isoDay(d), p = planFor(iso), r = p && rec(p.recipe_id);
      const m = r ? r.i.filter(k => !fr.has(k)).length : 0;
      const extras = D.cap.plan3 ? SLOTS.filter(([k]) => k !== 'abend').map(([k, l, e]) => { const x = planFor(iso, k); if (!x) return ''; const xr = rec(x.recipe_id);
        return `<button class="wk-extra" data-action="plan-day" data-v="${iso}" data-slot="${k}">${e} <b>${l}:</b> ${isOut(x) ? '🍕 ' + esc(x.label || 'Auswärts') : xr ? esc(xr.n) : ''}${x.cook ? ` · 👨‍🍳 ${esc(prof(x.cook).name)}` : ''}</button>`; }).join('') : '';
      return `<div class="week-row ${i===0?'today':''}"><div class="wd"><b>${dayShort(d, i)}</b><small>${d.getDate()}.${d.getMonth()+1}.</small></div><div class="wk-main">
        ${isOut(p) ? `<button class="rc" data-action="plan-day" data-v="${iso}"><div class="em">🍕</div><div class="main"><div class="t">${esc(p.label || 'Auswärts essen')}</div><div class="s"><span class="chip c-yolk">Auswärts / Bestellt</span>${cookChip(p)}</div></div>${I.chev}</button>`
        : r ? `<button class="rc" data-action="plan-day" data-v="${iso}">${photoEm(r)}<div class="main"><div class="t">${esc(r.n)}</div><div class="s"><span>⏱ ${r.t} Min</span>${m ? `<span class="chip c-yolk">🛒 ${m} fehlt</span>` : '<span class="chip c-herb">✅ alles da</span>'}${cookChip(p)}</div></div>${I.chev}</button>`
          : `<button class="week-empty" data-action="plan-day" data-v="${iso}">＋ Gericht wählen</button>`}${extras}</div></div>`; }).join('')}</div>
    <div class="week-actions">
      ${empty ? `<button class="btn btn-herb" data-action="plan-fill">✨ ${empty===7?'Woche planen':`${empty} ${empty===1?'Tag':'Tage'} füllen`}</button>` : ''}
      ${miss ? `<button class="btn btn-line" data-action="shop-plan">🛒 ${plu(miss,'Zutat','Zutaten')} einkaufen</button>` : ''}
      <button class="btn btn-line" data-action="party">🎉 Party planen</button>
      <button class="btn btn-ghost" data-action="plan-repeat">🔁 Letzte Woche wiederholen</button>
      ${D.plan.length ? `<button class="btn btn-ghost" data-action="plan-image">🖼️ Plan als Bild teilen</button><button class="btn btn-ghost" data-action="plan-ics">📆 In den Kalender</button>` : ''}
    </div>
    ${plusHint('week')}
    <p class="muted" style="font-size:13px;margin-top:12px">Die App wählt abwechslungsreich: Wünsche zuerst, passend für alle in der Familie, nicht zweimal hintereinander dasselbe Fleisch und höchstens zwei Fastfood-Tage.</p>`;
}
function openPlanDay(iso, keep, slot){
  slot = slot || UI.pslot || 'abend'; UI.pslot = slot;
  sheetFn = k => openPlanDay(iso, k, UI.pslot);
  const d = new Date(iso + 'T12:00:00'), i = Math.round((d - new Date(isoDay(new Date()) + 'T12:00:00')) / 864e5);
  const p = planFor(iso, slot), r = p && rec(p.recipe_id), q = (UI.pq || '').trim().toLowerCase();
  const list = q ? RX().filter(x => searchScore(x, q) > 0).sort((a, b) => searchScore(b, q) - searchScore(a, q)).slice(0, 12).map(x => ({ r:x }))
    : (slot === 'frueh' ? RX().filter(x => x.meal === 'fruehstueck' || x.meal === 'suess').slice(0, 8).map(x => ({ r:x })) : planCandidates().filter(c => !r || c.r.id !== r.id).slice(0, 8));
  openSheet(`${sheetHead(`${dayLabel(d, i)}, ${d.getDate()}.${d.getMonth()+1}.`)}
    ${D.cap.plan3 ? `<div class="seg" role="group" aria-label="Mahlzeit" style="margin-bottom:12px">${SLOTS.map(([k, l, e]) => `<button data-action="plan-slot" data-v="${iso}" data-slot="${k}" aria-pressed="${slot===k}">${e} ${l}</button>`).join('')}</div>` : ''}
    ${isOut(p) ? `<div class="card" style="display:flex;gap:12px;align-items:center;margin-bottom:12px"><div class="em" style="font-size:30px">🍕</div><div style="flex:1"><b>${esc(p.label || 'Auswärts essen')}</b><div class="muted" style="font-size:13px">Auswärts / Bestellt</div></div></div>
      <button class="btn btn-ghost btn-block" style="color:var(--tomato);margin-bottom:6px" data-action="plan-clear" data-v="${iso}" data-slot="${slot}">Entfernen</button>` : ''}
    ${r ? `<div class="card" style="display:flex;gap:12px;align-items:center;margin-bottom:12px">${photoEm(r)}<div style="flex:1;min-width:0"><b>${esc(r.n)}</b><div class="muted" style="font-size:13px">⏱ ${r.t} Min</div></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px"><button class="btn btn-ghost" data-action="open-recipe" data-id="${r.id}">Rezept öffnen</button><button class="btn btn-ghost" style="color:var(--tomato)" data-action="plan-clear" data-v="${iso}" data-slot="${slot}">Entfernen</button></div>` : ''}
    ${p && D.cap.plan3 ? `<div class="h2">👨‍🍳 Wer kocht?</div><div class="chips">${active().map(m => { const a = prof(m.user_id); return `<button class="ing" data-action="plan-cook" data-v="${iso}" data-slot="${slot}" data-id="${a.id}" aria-pressed="${p.cook===a.id}">${esc(a.avatar && a.avatar.length < 9 ? a.avatar : '🙂')} ${esc(a.name)}</button>`; }).join('')}</div>` : ''}
    <div class="h2">${p ? 'Tauschen gegen' : 'Was gibt\'s?'}</div>
    <div class="out-row"><input id="outIn" class="input" maxlength="40" placeholder="🍕 Auswärts / Bestellen, z. B. Pizza" autocomplete="off" aria-label="Auswärts essen oder bestellen"><button class="btn btn-line" data-action="plan-out" data-v="${iso}" data-slot="${slot}">Eintragen</button></div>
    <input id="planSearch" class="input" type="search" aria-label="Rezept suchen" placeholder="Rezept suchen …" value="${esc(UI.pq||'')}" autocomplete="off" style="margin:10px 0">
    <div class="stack">${list.map(c => `<button class="rc" data-action="plan-set" data-v="${iso}" data-slot="${slot}" data-id="${c.r.id}">${photoEm(c.r)}<div class="main"><div class="t">${esc(c.r.n)}</div><div class="s"><span>⏱ ${c.r.t} Min</span>${wishersOf(c.r.id).length?`<span class="chip c-tomato">🙋 ${wishersOf(c.r.id).length}</span>`:''}</div></div></button>`).join('') || '<div class="card empty"><b>Nichts gefunden</b></div>'}</div>`, keep);
}
function openPlanFor(rid){
  sheetFn = null; const r = rec(rid);
  openSheet(`${sheetHead('An welchem Tag?')}
    <p class="muted" style="margin:0 0 12px">${r.e} ${esc(r.n)}</p>
    <div class="stack">${nextDays(7).map((d, i) => { const iso = isoDay(d), p = planFor(iso), cur = p && rec(p.recipe_id);
      return `<button class="rc" data-action="plan-set" data-v="${iso}" data-id="${rid}"><div class="em" style="font-size:15px;font-weight:800">${WD[d.getDay()]}</div><div class="main"><div class="t">${dayLabel(d, i)} · ${d.getDate()}.${d.getMonth()+1}.</div><div class="s">${cur ? `Ersetzt: ${esc(cur.n)}` : 'Noch frei'}</div></div></button>`; }).join('')}</div>`);
}

function viewRecipes(){
  const t = UI.rtab, favs = D.profile.favs || [];
  let body = '';
  if (t==='week') body = viewWeek();
  else if (t==='wishes'){
    const ids = [...new Set(D.wishes.map(w=>w.recipe_id))].filter(id=>rec(id) && wishersOf(id).length).sort((a,b)=>wishersOf(b).length-wishersOf(a).length);
    body = ids.length ? `<div class="stack">${ids.map(id=>{ const r=rec(id), who=wishersOf(id);
      return `<button class="rc" data-action="open-recipe" data-id="${id}">${photoEm(r)}<div class="main"><div class="t">${esc(r.n)}</div>
        <div class="s"><span class="avatar-stack">${who.map(w=>`<span class="avatar sm">${avIn(prof(w))}</span>`).join('')}</span><span>${esc(names(who.map(w=>prof(w).name)))}</span></div></div>${I.chev}</button>`; }).join('')}</div>`
      : `<div class="card empty"><div class="g">🙋</div><b>Noch keine Wünsche</b>Was möchtest du diese Woche essen? Such dir etwas aus und tippe auf „Wünschen".<button class="btn btn-herb btn-block" style="margin-top:12px" data-action="rtab" data-v="all">Rezepte durchstöbern</button></div>`;
  } else {
    const q = UI.q.trim().toLowerCase();
    const coll = t === 'favs' && UI.coll && D.colls.find(c => c.id === UI.coll), rk = UI.reste && t === 'all' ? restoKeys() : null;
    let list = RX().filter(r => (t==='all' || (t==='favs' && (coll ? (coll.recipe_ids||[]).includes(r.id) : favs.includes(r.id))) || (t==='fam' && r.custom)) && (!q || searchScore(r, q) > 0));
    if (rk) list = list.filter(r => r.i.some(k => rk.includes(k))).sort((a, b) => b.i.filter(k => rk.includes(k)).length - a.i.filter(k => rk.includes(k)).length);
    if (q) list.sort((a, b) => searchScore(b, q) - searchScore(a, q));
    if (t === 'all') list = list.filter(passFilters);
    let more = 0, hint = '';
    if (t==='all'){
      /* Nicht alle 600+ Rezepte auf einmal: nur was zu allen passt, sortiert nach dem Kühlschrank */
      const people = eatersNow().map(prof), fr = new Set(D.fridge), have = r => r.i.filter(k => fr.has(k)).length / (r.i.length || 1);
      if (!q) list = list.filter(r => people.every(p => conflicts(r,p).length===0));
      if (!q && !rk) list = list.map(r => [r, have(r)]).sort((a,b) => b[1]-a[1] || a[0].n.localeCompare(b[0].n, 'de')).map(x => x[0]);
      const lim = UI.rlimit || 30; more = Math.max(0, list.length - lim); list = list.slice(0, lim);
      hint = q ? '' : `<div style="color:var(--muted);font-size:13px;margin:-4px 2px 10px">Passt zu allen, die mitessen · Was ihr schon da habt, steht oben</div>`;
    }
    body = (t==='all' ? `<div class="chips" style="margin-bottom:10px"><button class="ing" data-action="reste" aria-pressed="${!!UI.reste}">♻️ Reste-Modus${restoKeys().length ? ` · ${restoKeys().length} läuft bald ab` : ''}</button></div>${UI.reste && !rk.length ? '<div class="card" style="margin-bottom:10px;font-size:14px">♻️ Gerade läuft nichts bald ab. Trag im Kühlschrank Haltbarkeiten ein, dann zeigt dir der Reste-Modus passende Rezepte.</div>' : ''}` : '') +
      (t==='favs' && D.cap.colls ? (coll ? `<button class="banner soft" data-action="coll-close"><span style="font-size:22px">${esc(coll.emoji||'📁')}</span><span style="flex:1"><b>${esc(coll.name)}</b><br><span class="muted" style="font-size:13px">Sammlung · ${plu((coll.recipe_ids||[]).length,'Rezept','Rezepte')} · antippen zum Schließen</span></span></button>`
        : `<div class="coll-row">${D.colls.map(c => `<button class="coll" data-action="coll-open" data-id="${c.id}"><span>${esc(c.emoji||'📁')}</span><b>${esc(c.name)}</b><small>${(c.recipe_ids||[]).length}</small></button>`).join('')}<button class="coll add" data-action="coll-pick" data-id=""><span>＋</span><b>Neue Sammlung</b></button></div>`) : '') +
      (t==='fam' ? `<button class="btn btn-herb btn-block" style="margin-bottom:12px" data-action="new-recipe">📖 Eigenes Rezept eintragen</button>` : '') + (t==='all' ? `<input id="search" class="input" type="search" placeholder="In allen ${RX().length} Rezepten suchen" value="${esc(UI.q)}" aria-label="Rezept suchen" style="margin-bottom:10px">` + filterChips() + hint : '') +
      (list.length ? `<div class="stack">${list.map(r=>`<button class="rc" data-action="open-recipe" data-id="${r.id}">${photoEm(r)}<div class="main"><div class="t">${esc(r.n)}</div><div class="s"><span>⏱ ${r.t} Min</span>${r.custom?'<span class="chip c-herb">Familie</span>':''}${favs.includes(r.id)?'<span class="chip c-tomato">❤️</span>':''}${t==='all'&&D.fridge.length?(m => m===0?'<span class="chip c-herb">✅ alles da</span>':m===1?'<span class="chip c-yolk">🛒 1 fehlt</span>':'')(r.i.filter(k=>!D.fridge.includes(k)).length):''}</div></div>${I.chev}</button>`).join('')}</div>${more?`<button class="btn btn-line btn-block" style="margin-top:12px" data-action="more-recipes">Weitere ${Math.min(30, more)} anzeigen</button>`:''}`
      : t==='fam' ? `<div class="card empty"><div class="g">📖</div><b>Noch keine Familienrezepte</b>Tragt eure eigenen Lieblingsgerichte ein, zum Beispiel Omas Gulasch.<button class="btn btn-herb btn-block" style="margin-top:12px" data-action="new-recipe">＋ Erstes Familienrezept anlegen</button></div>`
      : `<div class="card empty"><div class="g">${t==='favs'?'❤️':'🔍'}</div><b>${t==='favs'?'Noch keine Lieblingsessen':'Nichts gefunden'}</b>${t==='favs'?'Tippe in einem Rezept auf das Herz – dann findest du es hier schneller wieder.<button class="btn btn-line btn-block" style="margin-top:12px" data-action="rtab" data-v="all">Rezepte durchstöbern</button>':'Versuch es mit einer Zutat, z. B. „Nudeln" oder „Paprika".'}</div>`);
  }
  return header('Planen & Rezepte', `${RX().length} Rezepte`) +
    `<div class="seg" role="group" aria-label="Ansicht">${[['week','Woche'],['wishes','Wünsche'],['favs','Lieblinge'],['fam','Familie'],['all','Alle']].map(([k,l])=>`<button data-action="rtab" data-v="${k}" aria-pressed="${t===k}">${l}</button>`).join('')}</div>
    <div style="margin-top:14px">${body}</div>`;
}
function prefText(a){ const parts=[]; if(a.picky) parts.push(`wählerisch · isst ${plu((a.likes||[]).length,'Zutat','Zutaten')}`); if(a.veg) parts.push('vegetarisch'); (a.dislikes||[]).forEach(d=>parts.push('keine '+(TRAITS[d]||ingName(d)))); (a.allergies||[]).forEach(x=>parts.push('ohne '+ALLERGENS[x])); return parts.join(' · ') || 'isst alles'; }
function viewFamily(){
  const p = isAdmin() ? pendingReq() : [];
  return header(esc(D.family.name), `${plu(active().length,'Mitglied','Mitglieder')}`) +
    (p.length ? `<div class="h2">Beitrittsanfragen</div><div class="stack">${p.map(m=>{ const a=prof(m.user_id); return `<div class="card" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <span class="avatar">${avIn(a)}</span><div style="flex:1;min-width:140px"><b>${esc(a.name)}</b> hat sich einen Account erstellt und möchte deiner Familie beitreten.</div>
        <div style="display:flex;gap:8px;flex-basis:100%"><button class="btn btn-herb btn-sm" style="flex:1" data-action="accept" data-id="${a.id}">Annehmen</button><button class="btn btn-ghost btn-sm" style="flex:1" data-action="decline" data-id="${a.id}">Ablehnen</button></div></div>`; }).join('')}</div>` : '') +
    (isAdmin() ? `<button class="btn btn-herb btn-block" style="margin-top:6px" data-action="invite">${I.qr} Familienmitglied einladen</button>` : '') +
    boardBlock() + rankBlock() +
    familyExtras() +
    `<div class="h2">Mitglieder</div>
    <div class="list">${active().map(m=>{ const a=prof(m.user_id), mine=a.id===D.user.id; return `<button class="row" data-action="profile" data-id="${a.id}"><span class="avatar">${avIn(a)}</span><span class="grow"><b>${esc(a.name)}</b>${m.role==='admin'?' <span class="chip c-herb">Admin</span>':''}${mine?' <span class="chip c-muted">Du</span>':''}<small>${a.status ? esc(a.status) : esc(prefText(a))}</small></span>${I.chev}</button>`; }).join('')}</div>
    ${!isAdmin()?`<div class="list" style="margin-top:16px"><button class="row" data-action="ask-leave"><span class="grow"><b>Familie verlassen</b></span></button></div>`:''}
    ${UI.confirmLeave?`<div class="card" style="background:var(--tomato-soft);margin-top:10px"><b style="color:var(--tomato)">Familie wirklich verlassen?</b><div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-tomato btn-sm" style="flex:1" data-action="leave">Verlassen</button><button class="btn btn-ghost btn-sm" style="flex:1" data-action="cancel-leave">Abbrechen</button></div></div>`:''}
`;
}

/* ---------- Reiter „Mehr" ---------- */
const VERSION = '4.5';
const CHANGELOG = [
  { v:'4.5', d:'12. November 2026', items:['Neuer, cleaner Look: frischere Farben, Flächen statt Rahmen, runde Knöpfe und weichere Schrift','Knöpfe und Karten federn beim Antippen'] },
  { v:'4.4', d:'7. November 2026', items:['↩︎ Rückgängig: Wer aus Versehen etwas löscht (Einkaufsliste, Kühlschrank leeren, Wochenplan), tippt unten einfach auf „Rückgängig"','📳 Kurze Vibration beim Abhaken – jetzt auch am iPhone','🔎 Suche verzeiht Tippfehler jetzt auch im Kühlschrank und in der Einkaufsliste („Tomatn" findet Tomaten)','🛒 Selbst getippte Einträge wie „Klopapier" oder „Brötchen" landen im richtigen Bereich – neu: Getränke und Haushalt & Drogerie','Leere Seiten zeigen jetzt immer, was man als Nächstes tun kann','Verständlichere Fehlermeldungen: was passiert ist und was du tun kannst'] },
  { v:'4.3', d:'7. November 2026', items:['Neuer Ladebildschirm: Der Teller füllt sich mit Zutaten – „Was gibt\'s heute?"','Den Werbespot unseres Sponsors PiHILL kannst du jetzt jederzeit ansehen – jetzt mit Ton','Tipps von PiHILL in Kühlschrank, Wochenplan, Familie und Rezepten','Kühlschrank-Foto: Das erste Foto am Tag ist frei, danach gibt es vorher einen kurzen Spot – mit Plus nie'] },
  { v:'4.2', d:'7. November 2026', items:['Aufgeräumter: „Heute auf dem Plan" steht jetzt ganz oben, die Filter sind in einer Zeile zusammengefasst und klappen beim Antippen auf','Schrift wächst mit: Die App folgt jetzt der Textgröße, die du am iPhone eingestellt hast','Neue Symbole in der Tab-Leiste – der aktive Tab ist gefüllt, „Planen" hat jetzt einen Kalender','Im Kühlschrank zeigt ein ✓, was da ist – nicht mehr nur die Farbe','Keine Fenster mehr, die ungefragt aufspringen','Behoben: Gelbe Schrift war kaum lesbar (zu wenig Kontrast)','Behoben: Einige Texte waren kleiner als die Mindestgröße','Behoben: „Jetzt kochen" war rot wie eine Warnung – jetzt grün','Behoben: Das Herz-Symbol bei „Planen" passte nicht','Behoben: Man konnte die App nicht mit zwei Fingern vergrößern','Behoben: „15′" heißt jetzt „15 Min", „8 da" heißt „8 vorhanden"','Der Küchen-Rückblick ist jetzt ruhiger gestaltet'] },
  { v:'4.1', d:'6. November 2026', items:['🛟 Neu: Hilfe & Support unter „Mehr"','💬 Live-Chat mit dem Support direkt in der App – du siehst, wenn der Support gerade online ist','📝 Anfragen mit Kategorie (Fehler, Konto, Familie, Plus, Datenschutz …) und Status','🚨 Notfall-Knopf für dringende Fälle – mit sofortigen Tipps, was du selbst tun kannst','✨ Plus-Mitglieder bekommen bevorzugt eine Antwort','⚑ Beiträge auf der Pinnwand und Notizen an Rezepten melden','✅ Status-Anzeige: Siehst sofort, ob es gerade eine Störung gibt','🔎 Häufige Fragen mit Suche','👍 Nach der Hilfe bewerten, ob es geholfen hat','Behoben: Gesperrte Personen konnten den Support nicht erreichen'] },
  { v:'4.0.1', d:'6. November 2026', items:['Wer vorübergehend gesperrt ist, sieht jetzt, bis wann die Sperre gilt und warum – danach geht es automatisch weiter','Behoben: Am Computer wurde man aus dem Admin-Bereich ständig abgemeldet, wenn die App gleichzeitig offen war – der Admin-Bereich hat jetzt eine eigene Anmeldung','Behoben: Gesperrten Personen wurden Hinweis-Fenster (z. B. „Update ist da“) über den Sperr-Bildschirm gelegt','Behoben: Auf dem Sperr-Bildschirm war die Tab-Leiste zu sehen, obwohl man sie nicht benutzen konnte','Gesperrte Personen können sich jetzt direkt aus der App an den Support wenden','Neues Admin-Dashboard mit Moderation (nur für Betreiber)'] },
  { v:'4.0', d:'6. November 2026', items:['🙏 Sorry, dass das Update später kam als angekündigt – dafür ist alles gründlich getestet','🎉 Das große Update – 20 neue Funktionen','🛒 Einkaufsliste: Menge und Notiz pro Eintrag („2 Packungen", „bio") – einfach auf den Eintrag tippen','🛒 Mehrere Listen: Supermarkt, Drogerie und Markt','🟢 Live: Ihr seht, wer gerade einkaufen ist – was ihr dann hinzufügt, sieht die Person sofort','🎤 Per Sprache hinzufügen: „Milch, Eier und Brot" sagen – alles landet auf der Liste','🙋 Einkauf zuweisen: „Mia bringt es mit"','✅ Vorbereitungs-Modus: Vor dem Kochen Zutaten und Geräte abhaken','⏱ Zeiten im Rezept antippen („10 Minuten") startet direkt einen Timer','👨‍🍳 Kochdienst: Im Wochenplan einteilen, wer wann kocht','💬 Notizen an Rezepten für die ganze Familie („Nächstes Mal mehr Käse!")','⚠️ Allergie-Warnung: Das Rezept zeigt, wer aus der Familie etwas nicht verträgt','📌 Familien-Pinnwand für kurze Nachrichten','🏆 Koch-Rangliste des Monats','🗳️ Abstimmung mit Uhrzeit – endet automatisch und meldet das Ergebnis','☕ Frühstück, Mittag und Abendessen im Wochenplan','🍕 Auswärts- und Bestell-Tage im Wochenplan','🎉 Party-Planer: Gäste und Gerichte wählen – Einkaufsliste und Plan werden gefüllt','📁 Eigene Rezept-Sammlungen (z. B. „Weihnachten")','♻️ Reste-Modus: Rezepte für alles, was bald abläuft','🖼️ Wochenplan als Bild teilen und 🔁 „Letzte Woche wiederholen"','📖 30 neue Rezepte aus der neuen Rezept-Datenbank – sie wächst ab jetzt laufend','Behoben: Ohne Internet blieb die App beim Start im Ladebildschirm hängen – jetzt siehst du den letzten Stand mit Offline-Hinweis, und sie verbindet sich automatisch neu','Behoben: Beim allerersten Start ohne Internet stürzte die App ab – jetzt gibt es eine klare Meldung mit „Nochmal versuchen"','Behoben: „Einkaufsliste teilen" warf dich aus der App, wenn Kopieren nicht ging','Behoben: Beim Teilen der Einkaufsliste fehlten Mengen und Notizen','Behoben: Auf kleinen Handys rutschte dein Profilbild oben rechts aus dem Bildschirm, wenn dein Name lang ist','Behoben: Auf kleinen Handys ragte die „Wer isst mit"-Leiste über den Rand','Behoben: Bei großer Schrift ragten die Umschalter (Woche, Wünsche …) über den Rand','Behoben: Bei großer Schrift ragte die Filterleiste auf „Heute" über den Rand','Behoben: Bei großer Schrift war das Plus-Fenster seitlich abgeschnitten','Behoben: Bei großer Schrift verschoben Saison- und Filter-Chips die ganze Seite','Behoben: Bei großer Schrift war das Rezeptfoto zu breit','Behoben: „Heute gekocht" doppelt angetippt wurde doppelt gezählt','Behoben: „1 Zutaten", „1 Mitglieder", „1 Rezepte" – Einzahl stimmt jetzt überall','Behoben: Im Rückblick stand „0 davon verschieden", wenn noch nichts gekocht war','Behoben: App-Öffnungen kurz nach Mitternacht zählten zum Vortag','Behoben: „Bald aufbrauchen" führt jetzt direkt zu passenden Rezepten','Behoben: Suchfelder und Datumsfelder hatten keine Beschriftung für Bildschirmleser','Behoben: Nach dem Schließen der Werbung lief im Hintergrund ein Fehler','Behoben: Auf dem iPhone blieb der Bereich hinter Uhrzeit und Akku grün – er passt sich jetzt jedem Bildschirm an','Admin-Panel: Einzahl-Fehler bei Familien, Personen und Wünschen behoben','Datenschutzerklärung für die neuen Familien-Funktionen aktualisiert'] },
  { v:'3.2.5', d:'5. November 2026', items:['Die Farbe hinter Uhrzeit und Akku passt sich jetzt automatisch an jeden Bildschirm an – Werbung, Rückblick, Kochmodus, Einkaufs-Modus und offene Fenster'] },
  { v:'3.2.4', d:'5. November 2026', items:['Neuer Ladebildschirm in App-Farbe statt Grün – dadurch wird auch der Bereich hinter Uhrzeit und Akku nicht mehr grün'] },
  { v:'3.2.3', d:'5. November 2026', items:['iPhone: Der Bereich hinter Uhrzeit und Akku bekommt jetzt die Farbe der App statt eines grünen oder dunklen Balkens (App dafür einmal neu zum Startbildschirm hinzufügen)'] },
  { v:'3.2.2', d:'5. November 2026', items:['Behoben: Auf dem iPhone blieb der Bereich hinter Uhrzeit und Akku grün (Farbe vom Startbildschirm) – jetzt hat er immer die Farbe der App, auch im Dunkelmodus'] },
  { v:'3.2.1', d:'5. November 2026', items:['🎉 Partystimmung: Heute um 20 Uhr kommt das große Update – mit Countdown in der ganzen App'] },
  { v:'3.2', d:'5. November 2026', items:['📸 Eigenes Profilbild: Foto machen oder aus der Galerie wählen','🎨 Profilfarbe und ✍️ Status („Über mich") – sieht die ganze Familie','👤 Neue Profilkarte: Familie antippen zeigt Bild, Status, wie oft gekocht, Lieblingsgerichte und Abzeichen'] },
  { v:'3.1', d:'4. November 2026', items:['Neuer Sponsor: PiHILL – handgemachte Häkel- und Deko-Stücke. Mit eigener Infoseite, zu finden auf der Startseite und unter „Mehr"','🎬 1 Tag Plus gratis: Alle 2 Wochen einen 15-Sekunden-Spot von PiHILL ansehen (ohne Ton)','✨ Plus-Extra: eigene Farbthemen für die App (Blau, Beere, Lila, Bernstein)'] },
  { v:'3.0.4', d:'2. November 2026', items:['Die Leiste ganz oben (Uhrzeit, Akku) ist jetzt durchsichtig – die App läuft darunter einfach weiter, ohne farbigen Balken'] },
  { v:'3.0.3', d:'2. November 2026', items:['Neue Preise für „Plus": 0,99 € im Monat oder 10 € im Jahr'] },
  { v:'3.0.2', d:'1. November 2026', items:['Behoben: Nach einem Update startete die App manchmal mitten in der Benutzung plötzlich neu – das passiert jetzt nur noch direkt beim Öffnen oder unbemerkt im Hintergrund','Schnellerer Start: Bei langsamem Netz wartet die App nicht mehr auf jede Datei, sondern startet nach spätestens 1,5 Sekunden aus dem Speicher','Schriften, Symbole und Rezepte kommen sofort aus dem Speicher'] },
  { v:'3.0.1', d:'1. November 2026', items:['Behoben: Oben war beim Scrollen ein andersfarbiger Streifen zu sehen – Statusleiste und Titelleiste sind jetzt eine durchgehende Fläche in App-Farbe','Behoben: In Kühlschrank, Rezepte, Familie und Einkaufsliste blitzten beim Scrollen ganz oben feine farbige Linien durch – die Leiste schließt jetzt in jedem Menü lückenlos ab','Keine sichtbaren Scrollbalken mehr in der Computer-Ansicht'] },
  { v:'3.0', d:'1. November 2026', items:['Das große Update: alles läuft flüssiger – weichere Seitenwechsel, Listen gleiten nacheinander herein, jeder Knopf gibt beim Antippen nach, Animationen ohne rechenintensive Unschärfe','Neue schwebende Tab-Leiste aus Glas mit gleitender Markierung – wird beim Scrollen kleiner','Neue Titelleiste aus Glas: Beim Scrollen erscheint oben der Titel, Antippen springt nach oben','Ziehen zum Aktualisieren und Fenster zum Wegwischen nach unten','🎰 Überrasch mich: Dreh am Rad, wenn sich keiner entscheiden kann','⭐ Bewerten nach dem Essen – Familien-Hits werden öfter vorgeschlagen','✨ Euer Küchen-Rückblick als Story, Kochverlauf, Statistik und 12 Erfolge unter „Familie"','Neuigkeiten aus der Familie: wer was gewünscht, gekocht oder bewertet hat','🛒 Einkaufs-Modus: große Liste nach Supermarkt-Bereichen, Bildschirm bleibt an; Einkaufsliste teilen (z. B. per WhatsApp)','🍂 Saison-Kalender: Was gerade frisch ist, kommt öfter auf den Tisch','🎄 Im Dezember: Advents-Look mit Schnee und Adventskalender mit 24 Türchen','👥 Kochmodus rechnet Mengen auf 1–8 Personen um, mehrere Timer laufen gleichzeitig – auch nach dem Schließen','📤 Rezept als Bild teilen, 📆 Wochenplan in den Kalender','Bessere Suche: findet auch Tippfehler, Umlaute und Zutaten – mit Filtern (bis 20 Min, vegetarisch, alles da, Saison)','Kurze Tour für neue Nutzer, Textgröße einstellbar, Lade-Platzhalter statt Kreisel'] },
  { v:'2.8', d:'1. November 2026', items:['Am Computer bedienst du das iPhone jetzt wie ein echtes: Sperrbildschirm mit Uhr und Mitteilungen – nach oben wischen zum Entsperren','Home-Bildschirm mit Widgets (Vorschlag für heute, Einkaufsliste) und App-Icon – die App öffnet und schließt mit der iOS-Zoom-Animation','Home-Strich unten nach oben ziehen (oder Esc) bringt dich zum Home-Bildschirm','Kontrollzentrum oben rechts: WLAN, Bluetooth, Flugmodus, Stumm, Helligkeit, Lautstärke, Fokus, Taschenlampe, Dunkelmodus','Die Tasten am Gehäuse funktionieren: Seitentaste sperrt, Lauter/Leiser zeigen die Lautstärke, Action-Taste schaltet stumm','Neue Wünsche aus der Familie erscheinen oben als Mitteilung'] },
  { v:'2.7', d:'1. November 2026', items:['Am Computer: nur noch das iPhone in der Mitte – ohne Text daneben','Das iPhone sieht jetzt echter aus: Titan-Rahmen mit Kantenlicht, schwarzer Glasrand, Dynamic Island mit Kameralinse, Spiegelung auf dem Glas und alle Seitentasten'] },
  { v:'2.6', d:'31. Oktober 2026', items:['Neu: Sind Benachrichtigungen aus, fragt die App nach dem Start – mit dem klaren Versprechen: keine nervigen Benachrichtigungen, nur selten, bei Updates und wenn deine Familie dich braucht','Neu: Hinweis-Karte auf „Heute", solange Benachrichtigungen aus sind','Besser angemeldet bleiben: die Anmeldung wird zusätzlich gesichert und nach dem Aufwecken des Handys sofort aufgefrischt','Die App bittet das Handy, ihren Speicher nicht automatisch zu löschen'] },
  { v:'2.5', d:'31. Oktober 2026', items:['Neu: Installations-Anleitung – die App erkennt, ob du ein iPhone oder Android-Handy hast und in welchem Browser du bist, und zeigt dir jeden Schritt','Neu: Auf Android-Handys mit Chrome reicht ein Tipp auf „Jetzt installieren"','Neu: Kommst du aus TikTok, Instagram & Co., erklärt die App, wie du die Seite zuerst im Browser öffnest – mit „Link kopieren"','Neu: Beim ersten Start vom Startbildschirm bestätigt die App, dass alles geklappt hat','Unter Mehr → „App installieren" jederzeit wieder aufrufbar'] },
  { v:'2.4.2', d:'31. Oktober 2026', items:['Behoben: Auf dem iPhone blieb die Leiste ganz oben nach dem Start-Intro grün – sie hat jetzt von Anfang an die App-Farbe','Halloween-Farben und Hell/Dunkel werden schon beim Laden gesetzt, damit das iPhone gleich die richtige Farbe übernimmt'] },
  { v:'2.4.1', d:'31. Oktober 2026', items:['Behoben: Das Halloween-Spinnennetz schien oben in die Statusleiste – die Leiste hat jetzt wieder exakt die App-Farbe'] },
  { v:'2.4', d:'31. Oktober 2026', items:['Halloween-Look 🎃: Kürbis-Orange, Nachtfarben im Dunkelmodus, Fledermäuse und ein eigenes Start-Intro','Neu auf „Heute": Halloween-Special mit allen Kürbis-Rezepten (ausblendbar)','Der Look endet automatisch am 2. November – unter Mehr → Darstellung auch vorher abschaltbar'] },
  { v:'2.3', d:'26. Oktober 2026', items:['Kochmodus ausführlich: 10–16 genaue Schritte – Zutaten holen, Haltbarkeit prüfen, schneiden, Herdstufe, Garzeiten und woran man erkennt, dass es fertig ist','Herdstufe oder Ofentemperatur steht bei jedem Schritt als eigenes Feld','Läuft eine Zutat bald ab, warnt der Kochmodus gleich am Anfang','Neue Food-Fotos von Pexels: die KI sucht gezielt ein Foto von genau diesem Gericht','Oberer Rand: hat jetzt exakt dieselbe Farbe wie die App'] },
  { v:'2.2', d:'26. Oktober 2026', items:['Neu: Haltbarkeitsdatum fotografieren – die App liest Datum und Produkt von der Verpackung und trägt beides ein','Erkanntes Produkt lässt sich mit einem Tipp ändern oder selbst eintippen','Die App sagt direkt, wo es hingehört: Kühlschrank, Vorrat oder kühl & dunkel','Ist das Produkt noch nicht im Kühlschrank, wird es automatisch hinzugefügt','Warnung, wenn etwas bald oder schon abgelaufen ist'] },
  { v:'2.1', d:'26. Oktober 2026', items:['Behoben: Kühlschrank-Foto gab auf, sobald bei einem KI-Modell das Tageslimit voll war – jetzt werden automatisch weitere Modelle versucht','Behoben: Foto aus der Einkaufsliste heraus führte zu keinem Ergebnis','Bei Problemen mit dem Foto zeigt die App jetzt einen genauen Hinweis und meldet den Fehler automatisch','Oberer Rand: farbiger Kopfbereich reicht jetzt bis ganz nach oben hinter Uhrzeit und Dynamic Island','Neu: Plus-Karte unter „Mehr" und Plus-Tipps im Kühlschrank, in der Einkaufsliste und im Wochenplan'] },
  { v:'2.0', d:'26. Oktober 2026', items:['Neu: Einkaufsliste für die ganze Familie – live, mit Vorschlägen beim Tippen; Abgehaktes landet automatisch im Kühlschrank','Neu: Im Rezept „Fehlende Zutaten auf die Einkaufsliste" mit einem Tipp','Neu: Wochenplan unter „Planen" – die App füllt die Woche abwechslungsreich, alles lässt sich tauschen','Neu: „Heute auf dem Plan" steht ganz oben auf der Startseite','Neu: Kühlschrank mit Suche, 9 Kategorien, „Zuletzt benutzt" und Filter „Nur was da ist"','Neu: Echte Food-Fotos von Wikipedia mit Urheberangabe – ohne passendes Foto bleibt das Emoji','Neu: Sprachsteuerung im Kochmodus („Weiter", „Zurück", „Nochmal", „Timer zehn Minuten") und Schritte vorlesen','Startseite aufgeräumt: Wer isst mit, Zeit und Lust in einer kompakten Karte'] },
  { v:'1.9', d:'26. Oktober 2026', items:['Neu: Kochmodus im Liquid-Glass-Design – klare Glasflächen, große Schrift, ruhige Uhr','Der Hintergrund leuchtet passend zum Schritt: orange beim Braten, blau beim Kochen, rot beim Backen','Weiche Übergänge zwischen den Schritten statt hartem Springen','Schlanker Fortschrittsbalken und Timer mit pulsierendem Punkt'] },
  { v:'1.8.2', d:'26. Oktober 2026', items:['Behoben: Das Start-Intro füllt jetzt den ganzen Bildschirm bis ganz oben, auch hinter Uhrzeit und Dynamic Island','Behoben: Das Intro lief manchmal doppelt, wenn sich die App für ein Update neu geladen hat','Behoben: Ein kurzer andersfarbiger Streifen oben während des Intros','Die App nutzt jetzt sicher die volle Bildschirmhöhe'] },
  { v:'1.8.1', d:'26. Oktober 2026', items:['Oberer Rand am iPhone: die Statusleiste hat jetzt dieselbe Farbe wie die App (vorher grüner Streifen in Safari)','Beim Scrollen läuft der Inhalt unter einem leichten Milchglas-Rand durch – Uhrzeit, Akku und Dynamic Island bleiben gut lesbar','Im Kochmodus färbt sich der obere Rand dunkel passend zum Kochbildschirm'] },
  { v:'1.8', d:'25. Oktober 2026', items:['Behoben: Antippen sprang manchmal zurück und wurde nicht gespeichert, wenn gleichzeitig jemand aus der Familie etwas geändert hat','Behoben: Die Seite scrollte nach Änderungen wieder nach oben','Behoben: Halb getippte Texte (z. B. Feedback, Name) gingen verloren','Behoben: Aufgeklappte Hilfe-Fragen klappten von selbst wieder zu','Behoben: Schnelles Antippen von „Wünschen" konnte doppelte Wünsche anlegen','Behoben: Name im Profil wurde beim Schließen mit ✕ nicht gespeichert','Behoben: Suche reagierte nach einiger Zeit mehrfach pro Buchstabe','„Abmelden" fragt jetzt nach, damit man nicht aus Versehen abgemeldet wird','Beim Zurückkehren in die App wird nicht mehr alles neu aufgebaut','Neu: Benachrichtigungen bei neuen Wünschen, Abstimmungen und Beitrittsanfragen','Antippen einer Benachrichtigung öffnet direkt den passenden Reiter','Etwas ruhigeres, schlichteres Design'] },
  { v:'1.7', d:'25. Oktober 2026', items:['Neu: über 580 neue Rezepte – jetzt mehr als 600 insgesamt','45 neue Zutaten, z. B. Rind, Pute, Garnelen, Kürbis, Gnocchi, Blätterteig und Pesto','Vorschläge zeigen weiterhin nur, was zu euch und eurem Kühlschrank passt','Morgens kommen Frühstücksideen zuerst, Desserts werden nie zum Hauptvorschlag','„Alle" zeigt zuerst die passendsten 30 Rezepte, die Suche durchsucht alle','Hinweis „weglassen" jetzt auch für Fleisch, Fisch und Allergene bei optionalen Zutaten'] },
  { v:'1.6', d:'25. Oktober 2026', items:['Neu: Push-Benachrichtigungen – unter „Mehr" einschalten','Neu: Ankündigungen oben auf „Heute" (lassen sich mit ✕ ausblenden)','Am iPhone: kurze Anleitung, wie die App für Benachrichtigungen auf den Home-Bildschirm kommt','Beim Abmelden bekommt das Handy keine Benachrichtigungen mehr'] },
  { v:'1.5', d:'25. Oktober 2026', items:['Neu: „Was gibt\'s? Plus" unter „Mehr" – alles Bisherige bleibt kostenlos','Hinweise auf Plus nur ganz selten: kleines Widget höchstens alle paar Tage, Pop-up höchstens alle 3 Wochen','Jeder Hinweis lässt sich mit ✕, „Nein danke", Tippen daneben oder Escape schließen'] },
  { v:'1.4', d:'25. Oktober 2026', items:['Neu: Kochmodus im Querformat mit „Bitte Handy drehen"-Hinweis','Neu: Große Uhr oben rechts, Fortschrittsbalken und große Weiter/Zurück-Knöpfe','Neu: Animation für jeden Schritt (Schneiden, Braten, Kochen, Backen, Rühren …)','Neu: „Jetzt kochen" direkt unter dem Vorschlag auf „Heute"','Neu: Die App nutzt den ganzen Bildschirm bis zum Rand','Impressum mit Namen ergänzt'] },
  { v:'1.3', d:'25. Oktober 2026', items:['Neu: Start-Intro mit Logo-Animation','Neu: Abstimmung „Was essen wir heute?" für die ganze Familie','Neu: Haltbarkeit im Kühlschrank – Gerichte, die Zutaten aufbrauchen, kommen zuerst','Neu: Eigene Familienrezepte eintragen','Neu: Kochmodus mit großen Schritten und Timer','Neu: Feedback senden, Impressum und Datenschutz','Schriften und QR-Code liegen jetzt direkt in der App (kein Laden bei Google mehr)','Behoben: Updates kamen teilweise erst nach mehrmaligem Öffnen an','Neu: Die App lädt neue Versionen ab jetzt automatisch'] },
  { v:'1.2.1', d:'25. Oktober 2026', items:['Behoben: Zutaten und Profil-Auswahl sprangen beim Antippen zurück und wurden teils nicht gespeichert','Behoben: Seite scrollte nach jedem Antippen wieder nach oben','Behoben: Fenster ruckelte beim Antippen von unten neu rein','Update-Log ist jetzt ein kleiner Knopf unten unter „Mehr"'] },
  { v:'1.2', d:'25. Oktober 2026', items:['Neu: Knopf „Wählerischer Esser" im Profil','Neu: Reiter „Mehr" mit Neuigkeiten und Hilfe','Foto-Erkennung mit Ersatz-KI und Pause-Hinweis'] },
  { v:'1.1', d:'25. Oktober 2026', items:['Vorschläge nur noch, wenn wirklich alles da ist','Neuer Bereich „Mit einem kleinen Einkauf"','Neue Zutaten: Salami, Würstchen, Frischkäse, Quark','6 neue Rezepte, z. B. Pizza-Toast und Hot Dogs'] },
  { v:'1.0', d:'25. Oktober 2026', items:['Erste Version: Familie per QR-Code, Wünsche, Kühlschrank, 32 Rezepte'] },
];
const FAQ = [
  ['Warum wird mir ein Gericht nicht vorgeschlagen?','Vorschläge erscheinen nur, wenn alle Hauptzutaten im Kühlschrank sind und das Gericht zu allen passt, die mitessen. Prüf unter „Wer isst mit?", wer ausgewählt ist.'],
  ['Wie lade ich jemanden ein?','Der Admin tippt unter „Familie" auf „Familienmitglied einladen". Der QR-Code wird mit der Handy-Kamera gescannt, danach muss der Admin die Anfrage annehmen.'],
  ['Was bedeutet „Wählerischer Esser"?','Statt anzugeben, was du nicht magst, wählst du aus, was du isst. Dann bekommst du nur Gerichte, bei denen du alle Hauptzutaten magst.'],
  ['Die Foto-Erkennung macht Pause?','Die KI hat ein Tageslimit. Am nächsten Tag geht es wieder. Bis dahin kannst du die Zutaten antippen.'],
  ['Wo finde ich den Kochmodus?','Auf „Heute" direkt unter dem Vorschlag („Jetzt kochen") oder in jedem Rezept über „Kochmodus starten". Dort gibt es große Schritte zum Wischen und Timer mit Ton.'],
  ['Wie installiere ich die App?','Unter Mehr → „App installieren" erkennt die App dein Handy und zeigt dir jeden Schritt. Kurz: iPhone in Safari „Teilen" → „Zum Home-Bildschirm". Android in Chrome ⋮ → „App installieren".'],
];
function hwCard(){
  if (!hwOn() || L.hwCardOff === new Date().getFullYear()) return '';
  const n = RX().filter(r => r.i.includes('kuerbis')).length;
  return `<div class="hw-card"><div class="hw-moon" aria-hidden="true"></div><span class="hw-bat" aria-hidden="true">${HW_BATS}</span>
    <button class="hw-main" data-action="hw-recipes"><span class="hw-kicker">Halloween-Special</span><b>Kürbis-Rezepte für heute Abend</b><span>${n} Gerichte mit Kürbis · von Suppe bis Curry</span><span class="hw-cta">Ansehen ›</span></button>
    <button class="hw-x" data-action="hw-card-off" aria-label="Ausblenden">✕</button><span class="hw-pump" aria-hidden="true">🎃</span></div>`;
}
function viewMore(){
  return header('Mehr', `Version ${VERSION}`) +
    `<button class="plus-card" data-action="plus"><div class="pc-glow"></div><span class="plus-badge">✨ PLUS</span><b>Mehr für deine Familie</b><span>KI-Rezepte · unbegrenzt Fotos · Wochenplan-Assistent · sortierte Einkaufsliste</span><span class="pc-cta">${L.plusInterest ? '💚 Du bist vorgemerkt' : 'Ansehen und vormerken ›'}</span></button>` +
    sponsorRow() +
    `<div class="h2">Hilfe</div>
    <div class="list" style="margin-bottom:10px"><button class="row" data-action="tour"><span style="font-size:22px">👋</span><span class="grow"><b>Kurze Tour durch die App</b><small>In 4 Schritten erklärt</small></span>${I.chev}</button></div>
    ${FAQ.map(([q,a])=>`<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
    <div class="h2">Darstellung</div>
    <div class="seg" role="group" aria-label="Farbschema">${[['system','System'],['light','Hell'],['dark','Dunkel']].map(([k,l])=>`<button data-action="theme" data-v="${k}" aria-pressed="${(L.theme||'system')===k}">${l}</button>`).join('')}</div>
    ${accentPicker()}
    ${(() => { const se = L.preview || seasonByDate(); if (!se) return ''; const on = seasonNow() === se;
      return `<div class="list" style="margin-top:10px"><button class="row" data-action="season" aria-pressed="${on}"><span style="font-size:22px">${se === 'advent' ? '🎄' : '🎃'}</span><span class="grow"><b>${se === 'advent' ? 'Advents-Look' : 'Halloween-Look'}</b><small>${se === 'advent' ? 'Bis 26. Dezember' : 'Nur bis 2. November'} · ${on ? 'an' : 'aus'}</small></span><span class="switch" aria-checked="${on}" aria-hidden="true"></span></button></div>`; })()}
    <div class="h2">Textgröße</div>
    <div class="seg" role="group" aria-label="Textgröße">${[['1','Normal'],['1.1','Groß'],['1.2','Sehr groß']].map(([k,l])=>`<button data-action="tz" data-v="${k}" aria-pressed="${String(L.tz||1)===k}">${l}</button>`).join('')}</div>
    ${D.appAdmin ? `<div class="h2">Vorschau Saison-Look <span class="chip c-muted">nur für dich</span></div><div class="seg" role="group">${[['','Aus'],['halloween','🎃'],['advent','🎄']].map(([k,l])=>`<button data-action="preview" data-v="${k}" aria-pressed="${(L.preview||'')===k}">${l}</button>`).join('')}</div>` : ''}
    ${isStandalone() ? '' : `<div class="h2">App</div><div class="list"><button class="row" data-action="install">${ic8(IC.dl,'row-ic')}<span class="grow"><b>App installieren</b><small>Auf den Startbildschirm – Schritt für Schritt</small></span>${I.chev}</button></div>`}
    <div class="h2">Benachrichtigungen</div>
    <div class="list">${pushRow()}</div>
    <div class="h2">Kontakt</div>
    <div class="list"><button class="row" data-action="help"><span style="font-size:22px">🛟</span><span class="grow"><b>Hilfe &amp; Support</b><small>Fragen, Live-Chat, Notfall</small></span>${supUnread() ? `<span class="sup-badge">${supUnread()}</span>` : ''}${I.chev}</button><button class="row" data-action="feedback"><span style="font-size:22px">💬</span><span class="grow"><b>Feedback senden</b><small>Ideen oder Lob</small></span>${I.chev}</button></div>
    <div class="h2">Konto</div>
    <div class="list">
      <button class="row" data-action="edit-prefs" data-id="${D.user.id}"><span class="avatar sm">${avIn(D.profile)}</span><span class="grow"><b>Mein Profil</b><small>${esc(prefText(D.profile))}</small></span>${I.chev}</button>
      <button class="row" data-action="logout"><span class="grow"><b style="color:var(--tomato)">${UI.confirmLogout ? 'Wirklich abmelden? Nochmal tippen' : 'Abmelden'}</b><small>${esc(D.user.email||'')}</small></span></button>
    </div>
    ${D.appAdmin ? `<div class="h2">Betreiber</div><div class="list"><a class="row" href="dashboard/" style="color:inherit;text-decoration:none"><span style="font-size:22px">🛠️</span><span class="grow"><b>Dashboard</b><small>Moderation, Push und Zahlen – nur für dich</small></span>${I.chev}</a></div>` : ''}
    <div class="h2">Rechtliches</div>
    <div class="list">
      <button class="row" data-action="legal" data-v="impressum"><span class="grow"><b>Impressum</b></span>${I.chev}</button>
      <button class="row" data-action="legal" data-v="privacy"><span class="grow"><b>Datenschutz</b></span>${I.chev}</button>
    </div>
    <div style="text-align:center;margin-top:22px"><button class="linkbtn" style="color:var(--muted);font-size:12px;font-weight:700" data-action="changelog">Version ${VERSION} · Update-Log${L.seenVersion!==VERSION?' <span class="new-badge">NEU</span>':''}</button></div>`;
}

/* ---------- Ankündigung (kommt aus dem Admin-Panel) ---------- */
function annBanner(){
  const a = D.ann; if (!a || L.annHidden === a.id) return '';
  return `<div class="banner ann"><span style="font-size:22px">${esc(a.emoji)}</span><span style="flex:1">${esc(a.text)}</span><button class="icon-btn sm" data-action="ann-hide" aria-label="Ausblenden">${I.x}</button></div>`;
}
function viewBanned(){
  return `<div class="center" style="text-align:center;align-items:center;gap:10px"><div style="font-size:56px">🚫</div>
    <div class="h1" style="font-size:24px">Dein Account ist ${D.profile.banned_until ? 'vorübergehend ' : ''}gesperrt</div>
    ${D.profile.banned_until ? `<p style="margin:0;font-weight:700">bis ${esc(new Date(D.profile.banned_until).toLocaleString('de-DE', { weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' }))} Uhr</p>` : ''}
    ${D.profile.ban_reason ? `<p style="margin:0;max-width:280px">Grund: ${esc(D.profile.ban_reason)}</p>` : ''}
    <p style="color:var(--muted);max-width:280px">Du glaubst, das ist ein Fehler? Schreib unserem Support – wir schauen es uns an.</p>
    <button class="btn btn-herb" data-action="sup-new" data-v="sperre">🛟 Support kontaktieren</button>
    <button class="btn btn-line" data-action="logout">Abmelden</button></div>`;
}

/* ---------- Push-Benachrichtigungen ---------- */
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && location.protocol === 'https:';
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/* ---------- App installieren: Gerät erkennen und Schritt für Schritt erklären ----------
   Icons: Icons8 (https://icons8.com), lokal in /icons gespeichert – werden als Maske eingefärbt, damit sie zu Hell/Dunkel passen. */
const ic8 = (n, cls = '') => `<i class="ic8 ${cls}" style="--ic:url('icons/${n}.png')" aria-hidden="true"></i>`;
const IC = { share:'share', more:'more', dots:'dots', plus:'plus', home:'home', open:'open', copy:'copy', ok:'ok', dl:'dl', phone:'phone', android:'android', menu:'menu', bell:'bell', nobell:'nobell', update:'update', family:'family', rare:'rare', nospam:'nospam' };   // liegen in /icons (von Icons8)
function deviceInfo(){
  const ua = navigator.userAgent, ios = isIOS(), android = /Android/i.test(ua);
  const appName = /musical_ly|Bytedance|TikTok/i.test(ua) ? 'TikTok' : /Instagram/i.test(ua) ? 'Instagram' : /FBAN|FBAV|FB_IAB/i.test(ua) ? 'Facebook' : /Snapchat/i.test(ua) ? 'Snapchat' : /WhatsApp/i.test(ua) ? 'WhatsApp' : /GSA\//.test(ua) ? 'der Google-App' : null;
  let browser = 'other', inApp = !!appName;
  if (ios){
    if (/CriOS/.test(ua)) browser = 'chrome'; else if (/FxiOS/.test(ua)) browser = 'firefox'; else if (/EdgiOS/.test(ua)) browser = 'edge';
    else if (!inApp && /Safari\//.test(ua)) browser = 'safari'; else inApp = true;
  } else if (android){
    if (/; wv\)/.test(ua)) inApp = true;
    if (/SamsungBrowser/.test(ua)) browser = 'samsung'; else if (/Firefox/.test(ua)) browser = 'firefox'; else if (/EdgA/.test(ua)) browser = 'edge'; else if (/Chrome/.test(ua)) browser = 'chrome';
  } else browser = /Edg\//.test(ua) ? 'edge' : /Chrome/.test(ua) ? 'chrome' : /Safari/.test(ua) ? 'safari' : /Firefox/.test(ua) ? 'firefox' : 'other';
  return { os: ios ? 'ios' : android ? 'android' : 'desktop', browser, inApp, appName, installed: isStandalone() };
}
const BNAME = { safari:'Safari', chrome:'Chrome', firefox:'Firefox', edge:'Edge', samsung:'Samsung Internet', other:'Browser' };
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (sheetFn === openInstall) refreshSheet(); });
window.addEventListener('appinstalled', () => { installEvt = null; L.installedAt = Date.now(); saveLocal(); if (sheetFn === openInstall) refreshSheet(); toast('🎉 Installiert! „Was gibt\'s?" ist jetzt auf deinem Startbildschirm.'); });

function installSteps(d){
  const os = UI.instOs || d.os, b = UI.instOs && UI.instOs !== d.os ? (UI.instOs === 'ios' ? 'safari' : 'chrome') : d.browser;
  const last = [IC.home, `<b>Fertig!</b> Öffne „Was gibt's?" ab jetzt über das neue Icon auf deinem Startbildschirm – wie jede andere App.`];
  if (d.inApp && !UI.instOs) return os === 'ios' ? [
      [IC.more, `Tippe oben rechts auf <b>⋯</b> oder auf das Kompass-Symbol.`],
      [IC.open, `Wähle <b>In Safari öffnen</b> bzw. <b>Im Browser öffnen</b>.`],
      [IC.share, `Danach geht's in Safari weiter – diese Anleitung erscheint dort automatisch wieder.`] ] : [
      [IC.dots, `Tippe oben rechts auf <b>⋮</b>.`],
      [IC.open, `Wähle <b>Im Browser öffnen</b> bzw. <b>In Chrome öffnen</b>.`],
      [IC.dl, `Danach geht's im Browser weiter – diese Anleitung erscheint dort automatisch wieder.`] ];
  if (os === 'ios') return [
      b === 'safari' ? [IC.share, `Tippe unten in Safari auf <b>Teilen</b> ${ic8(IC.share,'in')}. Siehst du es nicht, tippe zuerst auf <b>⋯</b> unten rechts.`]
        : b === 'firefox' ? [IC.share, `Tippe unten rechts auf <b>☰</b> und dann auf <b>Teilen</b> ${ic8(IC.share,'in')}.`]
        : [IC.share, `Tippe oben rechts in der Adresszeile auf <b>Teilen</b> ${ic8(IC.share,'in')}.`],
      [IC.plus, `Scroll in der Liste nach unten und wähle <b>Zum Home-Bildschirm</b> ${ic8(IC.plus,'in')}.`],
      [IC.ok, `Lass <b>„Als Web-App öffnen"</b> eingeschaltet und tippe oben rechts auf <b>Hinzufügen</b>.`], last ];
  if (os === 'android') return b === 'samsung' ? [
      [IC.menu, `Tippe unten rechts auf das Menü <b>☰</b>.`],
      [IC.plus, `Wähle <b>Seite hinzufügen zu</b> → <b>Startbildschirm</b>.`],
      [IC.ok, `Tippe auf <b>Hinzufügen</b>.`], last ] : [
      [IC.dots, `Tippe oben rechts auf <b>⋮</b>.`],
      [IC.dl, `Wähle <b>App installieren</b> – oder <b>Zum Startbildschirm hinzufügen</b>.`],
      [IC.ok, `Bestätige mit <b>Installieren</b>.`], last ];
  return b === 'safari' ? [
      [IC.share, `Am Mac: In der Menüleiste <b>Ablage</b> → <b>Zum Dock hinzufügen</b>.`], [IC.ok, `Auf <b>Hinzufügen</b> klicken.`] ] : [
      [IC.dl, `Klicke rechts in der Adresszeile auf das Installieren-Symbol ${ic8(IC.dl,'in')}.`], [IC.ok, `Auf <b>Installieren</b> klicken.`] ];
}
function openInstall(keep){
  sheetFn = openInstall;
  const d = deviceInfo(), os = UI.instOs || d.os;
  const devName = d.os === 'ios' ? (/iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && !/iPhone/.test(navigator.userAgent)) ? 'iPad' : 'iPhone') : d.os === 'android' ? 'Android-Handy' : 'Computer';
  const where = d.inApp ? `in ${d.appName || 'einer App'}` : `in ${BNAME[d.browser]}`;
  const steps = installSteps(d);
  const body = d.installed ? `
      <div class="inst-done">${ic8(IC.ok,'big')}<b>Alles erledigt!</b><p>Du nutzt „Was gibt's?" schon vom Startbildschirm. Mehr musst du nicht tun.</p></div>`
    : `
      <div class="inst-demo" aria-hidden="true"><div class="inst-grid">${'<i></i>'.repeat(7)}<img src="icon-192.png" alt=""></div></div>
      <div class="inst-dev">${ic8(os === 'ios' ? IC.phone : os === 'android' ? IC.android : IC.dl)}<span>Erkannt: <b>${devName}</b> · ${esc(where)}</span></div>
      ${d.inApp && !UI.instOs ? `<div class="inst-warn"><b>In ${esc(d.appName || 'dieser App')} geht das Installieren nicht.</b> Öffne die Seite zuerst in ${os === 'ios' ? 'Safari' : 'deinem Browser'} – oder kopiere den Link und füge ihn dort ein.
        <button class="btn btn-line btn-sm" data-action="inst-copy" style="margin-top:10px">${ic8(IC.copy,'in')} Link kopieren</button></div>` : ''}
      ${installEvt && os === 'android' && !UI.instOs ? `<button class="btn btn-herb btn-block inst-now" data-action="inst-now">${ic8(IC.dl,'in light')} Jetzt installieren</button><div class="h2" style="margin-top:14px">Oder von Hand</div>` : ''}
      <ol class="inst-steps">${steps.map(([icon, t], n) => `<li style="--d:${n * 70}ms"><span class="inst-n">${n + 1}</span><span class="inst-ic">${ic8(icon)}</span><span class="inst-t">${t}</span></li>`).join('')}</ol>
      ${os === 'ios' && !(d.inApp && !UI.instOs) ? `<p class="inst-note">Wichtig beim iPhone: Nach dem Öffnen vom Startbildschirm meldest du dich einmal neu an – das iPhone trennt Safari und Startbildschirm-Apps.</p>` : ''}
      <div class="inst-why"><span>⚡ Startet im Vollbild</span><span>🔔 Benachrichtigungen</span><span>📴 Läuft auch offline</span></div>
      <div class="inst-other">Anderes Gerät? <button class="linkbtn" data-action="inst-os" data-v="ios" aria-pressed="${os === 'ios'}">iPhone</button> · <button class="linkbtn" data-action="inst-os" data-v="android" aria-pressed="${os === 'android'}">Android</button></div>`;
  openSheet(`${sheetHead('App installieren')}${body}<p class="inst-credit">Icons von <a href="https://icons8.com" target="_blank" rel="noopener">Icons8</a></p>`, keep);
}
const isPhone = () => deviceInfo().os !== 'desktop';
const needsInstall = () => isPhone() && !isStandalone() && !mq.matches;
function installBanner(){
  if (!needsInstall() || (L.instHide && Date.now() < L.instHide)) return '';
  const d = deviceInfo();
  return `<div class="inst-banner"><button class="inst-b-main" data-action="install"><img src="icon-192.png" alt=""><span><b>App auf den Startbildschirm holen</b><small>${d.inApp ? `Öffne die Seite zuerst im Browser – so geht's` : `Dauert 20 Sekunden · für ${d.os === 'ios' ? 'iPhone' : 'Android'} erklärt`}</small></span><span class="inst-b-cta">Zeigen</span></button>
    <button class="inst-b-x" data-action="inst-hide" aria-label="Später">✕</button></div>`;
}
/* Beim ersten Besuch im Browser einmal automatisch zeigen, nach dem ersten Start vom Startbildschirm einmal „Geschafft" */
function installAuto(){
  if (sheetFn || $('.sheet') || $('#tour')) return;
  if (isStandalone()){
    if (!L.installedSeen){ L.installedSeen = Date.now(); saveLocal(); setTimeout(() => toast('🎉 Geschafft! „Was gibt\'s?" ist jetzt auf deinem Startbildschirm.'), 400); }
    return;
  }
  if (needsInstall() && !L.instAuto){ L.instAuto = Date.now(); saveLocal(); UI.instOs = null; openInstall(); }
}
function b64ToBytes(b){ const p = '='.repeat((4 - b.length % 4) % 4); const r = atob((b + p).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from(r, c => c.charCodeAt(0)); }
async function pushStatus(){
  if (!pushSupported()) return isIOS() && !isStandalone() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try { const reg = await navigator.serviceWorker.ready; return (await reg.pushManager.getSubscription()) && Notification.permission === 'granted' ? 'on' : 'off'; }
  catch(e){ return 'unsupported'; }
}
async function saveSub(sub){
  const j = sub.toJSON();
  await sb.from('push_subs').delete().eq('endpoint', j.endpoint);
  const { error } = await sb.from('push_subs').insert({ endpoint:j.endpoint, user_id:D.user.id, p256dh:j.keys.p256dh, auth:j.keys.auth });
  return error;
}
async function pushOn(){
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted'){ UI.push = await pushStatus(); return 'Ohne Erlaubnis geht es leider nicht'; }
    const { data, error } = await sb.functions.invoke('send-push', { body:{ action:'key' } });
    if (error || !data || !data.publicKey) return 'Gerade nicht möglich, versuch es später nochmal';
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:b64ToBytes(data.publicKey) });
    const err = await saveSub(sub); if (err) return 'Speichern hat nicht geklappt';
    UI.push = 'on'; L.pushAsked = true; saveLocal(); return true;
  } catch(e){ return 'Benachrichtigungen werden hier nicht unterstützt'; }
}
async function pushOff(quiet){
  try {
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
    if (sub){ await sb.from('push_subs').delete().eq('endpoint', sub.endpoint); if (!quiet) await sub.unsubscribe(); }
  } catch(e){}
  if (!quiet) UI.push = 'off';
}
/* Nach dem Anmelden: bestehendes Abo diesem Account zuordnen */
async function syncPush(){
  UI.push = await pushStatus();
  if (UI.push === 'on'){ try { const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription(); if (sub) await saveSub(sub); } catch(e){} }
  if (UI.tab === 'more' && !$('.sheet')) render();
}
function pushRow(){
  const st = UI.push || 'unsupported';
  const sub = { on:'An – nur bei Updates und Familien-Nachrichten', off:'Aus – tippen zum Einschalten', install:'Zuerst die App zum Home-Bildschirm hinzufügen', denied:'In den Handy-Einstellungen blockiert', unsupported:'Dieser Browser unterstützt das nicht' }[st];
  const clickable = st !== 'unsupported';
  return `<${clickable?'button':'div'} class="row" ${clickable?'data-action="push"':''}><span style="font-size:22px">🔔</span><span class="grow"><b>Push-Benachrichtigungen</b><small>${sub}</small></span>${st==='on'||st==='off'?`<span class="switch" role="switch" aria-checked="${st==='on'}"></span>`:st==='install'?I.chev:''}</${clickable?'button':'div'}>`;
}
function openPushHelp(){
  sheetFn = null;
  openSheet(sheetHead('Benachrichtigungen am iPhone') + `
    <p style="color:var(--muted);margin:0 0 14px">Apple erlaubt Benachrichtigungen nur, wenn die App auf dem Home-Bildschirm liegt. Das dauert 10 Sekunden:</p>
    <ol class="steps"><li>In Safari unten auf <b>Teilen</b> tippen (Quadrat mit Pfeil).</li><li><b>„Zum Home-Bildschirm"</b> wählen und hinzufügen.</li><li>Die App über das neue Symbol öffnen und hier unter „Mehr" Benachrichtigungen einschalten.</li></ol>
    <button class="btn btn-herb btn-block" style="margin-top:14px" data-action="close">Verstanden</button>`);
}


/* ---------- Benachrichtigungen: bei jedem Start fragen, solange sie aus sind ---------- */
function pushPromptHtml(){
  const pts = [[IC.rare,'Nur ganz selten','Kein Dauer-Gepiepe, versprochen.'],[IC.update,'Wenn es ein Update gibt','Damit du neue Funktionen nicht verpasst.'],[IC.family,'Wenn deine Familie dich braucht','Zum Beispiel bei einem Essenswunsch oder einer Abstimmung.'],[IC.nospam,'Keine Werbung, kein Spam','Niemals.']];
  return `${sheetHead('')}
    <div class="pp-hero" aria-hidden="true"><span class="pp-ring"></span><span class="pp-ring r2"></span>${ic8(IC.bell,'pp-bell')}</div>
    <div class="pp-title">Benachrichtigungen aktivieren</div>
    <p class="pp-sub">damit du keine Updates verpasst</p>
    <div class="pp-promise">${ic8(IC.nobell,'pp-nob')}<b>Keine nervigen<br>Benachrichtigungen.</b></div>
    <ul class="pp-list">${pts.map(([i,b,t]) => `<li>${ic8(i)}<span><b>${b}</b><small>${t}</small></span></li>`).join('')}</ul>
    <button class="btn btn-herb btn-block pp-on" data-action="pp-on">${ic8(IC.bell,'in light')} Benachrichtigungen aktivieren</button>
    <button class="linkbtn pp-later" data-action="pp-later">Jetzt nicht</button>
    <p class="inst-note" style="text-align:center">Du kannst sie jederzeit unter Mehr → Benachrichtigungen wieder ausschalten.</p>`;
}
function openPushPrompt(){ sheetFn = null; openSheet(pushPromptHtml()); }
function pushBanner(){
  if (UI.push !== 'off') return '';
  return `<button class="pp-banner" data-action="pp-open">${ic8(IC.bell,'pp-b-ic')}<span><b>Benachrichtigungen aktivieren</b><small>Keine nervigen – nur bei Updates &amp; wenn deine Familie dich braucht</small></span><span class="inst-b-cta">An</span></button>`;
}
/* Nach jedem Start / jeder Anmeldung einmal zeigen, solange Benachrichtigungen aus sind */
function maybePushPrompt(){
  if (UI.push !== 'off' || !D.user || !D.family || !isActive() || $('.sheet') || sheetFn || $('#tour')) return;
  try { if (sessionStorage.getItem('wg.pp') === (D.user && D.user.id)) return; sessionStorage.setItem('wg.pp', D.user.id); } catch(e){}
  openPushPrompt();
}

/* ---------- Sanftes Neuzeichnen ----------
   Statt alles wegzuwerfen, werden nur geänderte Stellen angepasst.
   Dadurch bleiben Scroll-Position, aufgeklappte Fragen, Fokus und
   halb getippte Texte erhalten, und nichts animiert erneut. */
function morph(from, html){
  const tpl = document.createElement('template'); tpl.innerHTML = html;
  patchChildren(from, tpl.content);
}
function sameNode(a, b){
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== 1) return true;
  if (a.tagName !== b.tagName) return false;
  // Unterschiedliche Elemente (z. B. anderes Rezept) nicht ineinander umbauen
  const ka = a.getAttribute('data-id') || a.id || '', kb = b.getAttribute('data-id') || b.id || '';
  return ka === kb;
}
function patchChildren(from, to){
  const a = [...from.childNodes], b = [...to.childNodes];
  b.forEach((nb, i) => {
    const na = a[i];
    if (!na){ from.appendChild(nb); return; }
    if (!sameNode(na, nb)){ from.replaceChild(nb, na); return; }
    if (na.nodeType === 3 || na.nodeType === 8){ if (na.nodeValue !== nb.nodeValue) na.nodeValue = nb.nodeValue; return; }
    patchEl(na, nb);
  });
  for (let i = b.length; i < a.length; i++) a[i].remove();
}
function patchEl(a, b){
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name) && !(name === 'open' && a.tagName === 'DETAILS') && name !== 'disabled') a.removeAttribute(name);
  if (b.hasAttribute('disabled') !== a.hasAttribute('disabled')) a.disabled = b.hasAttribute('disabled');
  const tag = a.tagName;
  if (tag === 'INPUT' || tag === 'SELECT'){
    // Was gerade getippt wird, nicht überschreiben
    if (document.activeElement !== a && b.hasAttribute('value') && a.value !== b.getAttribute('value') && a.dataset.v0 !== b.getAttribute('value')){ a.value = b.getAttribute('value'); }
    a.dataset.v0 = b.getAttribute('value') ?? '';
    return;
  }
  if (tag === 'TEXTAREA' || a.id === 'qr' || a.id === 'scanArea') return;   // Inhalt gehört dem Nutzer bzw. wird separat gefüllt
  if (tag === 'svg' || a instanceof SVGElement){ if (a.innerHTML !== b.innerHTML) a.innerHTML = b.innerHTML; return; }
  patchChildren(a, b);
}

/* ---------- Food-Fotos (Wikipedia / Wikimedia Commons, freie Lizenzen) ----------
   Zu jedem Rezept wird einmal ein passendes Foto gesucht und auf dem Gerät gemerkt.
   Ohne Treffer bleibt das Emoji. Urheber und Lizenz stehen im Rezept am Bild. */
const PH_KEY = 'wasgibts.photos.v3';
let PH = {}; try { PH = JSON.parse(localStorage.getItem(PH_KEY)) || {}; localStorage.removeItem('wasgibts.photos.v1'); localStorage.removeItem('wasgibts.photos.v2'); } catch(e){}
const phSave = () => { try { localStorage.setItem(PH_KEY, JSON.stringify(PH)); } catch(e){} };
const phQueue = [], phWait = new Set(), phFail = {}; let phBusy = 0, phT = null;
const phOf = r => { const v = PH[r.n]; return v && v.u ? v : null; };
function wantPhoto(r){
  if (!r || UI.photoOff || r.n in PH || phWait.has(r.n) || !navigator.onLine || (phFail[r.n] && Date.now() - phFail[r.n] < 6e5)) return;
  phWait.add(r.n); phQueue.push(r.n); pumpPhotos();
}
function pumpPhotos(){
  while (phBusy < 3 && phQueue.length){
    const n = phQueue.shift(); phBusy++;
    let found = false;
    findPhoto(n).then(v => { if (v === undefined) phFail[n] = Date.now(); else { PH[n] = v || 0; phSave(); found = !!v; } })
      .finally(() => { phWait.delete(n); phBusy--;
        if (found){ clearTimeout(phT); phT = setTimeout(() => { if (!UI.cook){ render(); if ($('.sheet') && sheetFn) refreshSheet(); } }, 250); }
        pumpPhotos(); });
  }
}
async function findPhoto(name){
  // Foto kommt jetzt von Pexels über unsere Server-Funktion (KI wählt passend aus, einmal für alle gespeichert)
  const r = RX().find(x => x.n === name); if (!r) return null;
  if (UI.photoOff) return undefined;
  try {
    const { data, error } = await sb.functions.invoke('recipe-ai', { body:{ action:'photo', recipe:{ id:r.id, name:r.n, ingredients:r.i.map(ingName) } } });
    if (error || !data) return undefined;
    if (data.reason === 'nokey'){ UI.photoOff = true; return undefined; }   // noch kein Pexels-Schlüssel: Emojis
    if (data.reason === 'limit' || data.reason === 'failed' || data.error) return undefined;
    const p = data.photo;
    return p ? { u:p.u, big:p.big || p.u, a:p.a, l:p.l, f:p.f } : null;
  } catch(e){ return undefined; }
}
/* Kleines Bild in Listen */
function photoEm(r){ const ph = phOf(r); if (!ph) wantPhoto(r);
  return `<div class="em${ph ? ' ph' : ''}" aria-hidden="true">${ph ? `<img src="${esc(ph.u)}" alt="" loading="lazy" decoding="async">` : r.e}</div>`; }
/* Bild im großen Vorschlag */
function pickArt(r){ const ph = phOf(r); if (!ph) wantPhoto(r);
  return ph ? `<span class="big ph" aria-hidden="true"><img src="${esc(ph.u)}" alt="" decoding="async"></span>` : `<span class="big" aria-hidden="true">${r.e}</span>`; }
/* Großes Bild im Rezept, mit Urheber */
function recipeHero(r){ const ph = phOf(r); if (!ph) wantPhoto(r);
  return ph ? `<figure class="r-photo"><img src="${esc(ph.big || ph.u)}" alt="${esc(r.n)}" decoding="async"><figcaption><a href="${esc(ph.f)}" target="_blank" rel="noopener">Foto: ${esc(ph.a)} · ${esc(ph.l)}</a></figcaption></figure>`
    : `<div class="r-hero" aria-hidden="true">${r.e}</div>`; }

/* ---------- Haupt-Render ---------- */
const ORDER = ['home','fridge','recipes','family','more'];
let slideDx = 0;
function render(){
  applyTheme(); renderTabbar(); document.documentElement.classList.toggle('banned', !!D.profile?.banned);
  let v;
  if (!configured) v = viewSetup();
  else if (UI.loading) v = skeletonView();
  else if (!D.user) v = viewAuth();
  else if (!D.profile) v = `<div class="center" style="text-align:center"><div class="r-hero">📴</div><div class="h1">Keine Verbindung</div><p class="muted">Die App braucht beim ersten Start Internet. Sobald du wieder online bist, geht es automatisch weiter.</p><button class="btn btn-herb" data-action="retry">Nochmal versuchen</button></div>`;
  else if (D.profile && D.profile.banned) v = viewBanned();
  else if (!isActive() || !D.family) v = viewNoFamily();
  else v = ({home:viewHome, fridge:viewFridge, recipes:viewRecipes, family:viewFamily, more:viewMore}[UI.tab])();
  if (configured && !UI.loading && D.user && !(D.profile && D.profile.banned) && isActive() && D.family) v += sponsorFoot();
  const key = UI.tab + '|' + (!configured ? 'setup' : UI.loading ? 'load' : !D.user ? 'auth' : D.profile?.banned ? 'ban' : (!isActive() || !D.family) ? 'nofam' : 'app');
  const prev = $('#views .view:not(.leaving)');
  if (!slideDx && prev && prev.dataset.key === key){ const top = prev.scrollTop; morph(prev, v); if (prev.scrollTop !== top) prev.scrollTop = top; }
  else {
    // Weicher Wechsel: die alte Seite gleitet raus, die neue rein (nur Bewegung und Deckkraft – läuft flüssig)
    if (slideDx && prev){ const old = prev; old.classList.add('leaving'); old.style.setProperty('--dx', (-slideDx * .6) + 'px'); old.removeAttribute('data-key'); setTimeout(() => old.remove(), 260);
      $('#views').insertAdjacentHTML('beforeend', `<div class="view" data-tab="${UI.tab}" data-key="${key}" style="--dx:${slideDx}px;--dy:0px">${v}</div>`); }
    else $('#views').innerHTML = `<div class="view" data-tab="${UI.tab}" data-key="${key}" style="${slideDx?`--dx:${slideDx}px;--dy:0px`:''}">${v}</div>`;
  }
  slideDx = 0; syncTopFade(); syncNav(true); watchLoops(); ensureSnow();
}
/* Beim Scrollen bekommt der obere Rand einen leichten Milchglas-Hintergrund, damit Uhrzeit und Akku lesbar bleiben */
const syncTopFade = () => { const v = $('#views .view'), f = $('#topfade'); if (f) f.classList.toggle('on', !!v && v.scrollTop > 4); };
document.addEventListener('scroll', e => { if (e.target.classList && e.target.classList.contains('view')) syncTopFade(); }, true);
/* Eingaben einmal zentral abfangen (nicht bei jedem Zeichnen neu anhängen) */
document.addEventListener('input', e => {
  const id = e.target.id;
  if (id === 'search'){ UI.q = e.target.value; UI.rlimit = 30; render(); }
  else if (id === 'fsearch'){ UI.fq = e.target.value; render(); }
  else if (id === 'shopIn'){ UI.sq = e.target.value; render(); }
  else if (id === 'planSearch'){ UI.pq = e.target.value; refreshSheet(); }
  else if (id === 'partySearch'){ UI.partyQ = e.target.value; refreshSheet(); }
  else if (id === 'expQ'){ UI.expQ = e.target.value; refreshSheet(); }
  else if (id === 'expDate' && UI.expScan){ UI.expScan.date = e.target.value; refreshSheet(); }
});
document.addEventListener('submit', async e => {
  if (e.target.id === 'authForm') onAuth(e);
  if (e.target.classList.contains('note-add')){ e.preventDefault(); const i = e.target.querySelector('input'); const v = i.value; i.value = ''; try { await addNote(e.target.dataset.rid, v); } catch(err){ toast(errText(err)); } }
  if (e.target.classList.contains('board-add')){ e.preventDefault(); const i = e.target.querySelector('input'); const v = i.value; i.value = ''; try { await addPost(v); } catch(err){ toast(errText(err)); } }
  if (e.target.id === 'shopForm'){ e.preventDefault();
    const v = (UI.sq || '').trim(); if (!v) return;
    const exact = Object.keys(ING).find(k => ING[k][0].toLowerCase() === v.toLowerCase());
    UI.sq = ''; const inp = $('#shopIn'); if (inp) inp.value = '';
    try { const n = await addToList(exact ? [exact] : [], exact ? '' : v); toast(n ? 'Auf der Liste ✓' : 'Steht schon drauf'); buzz(10); } catch(err){ toast(errText(err)); }
  }
});
function go(tab){ if (tab===UI.tab) return; UI.recentSnap = null; const a=ORDER.indexOf(UI.tab), b=ORDER.indexOf(tab); slideDx=b>a?36:-36; UI.tab=tab; UI.confirmLeave=false; buzz(8); closeSheet(); render(); }

/* ---------- Anmeldung ---------- */
async function onAuth(e){
  e.preventDefault(); UI.err=''; const reg = UI.auth==='register';
  const mail=$('#a-mail').value.trim(), pass=$('#a-pass').value, name=reg?$('#a-name').value.trim():'';
  if (reg && !name){ UI.err='Bitte gib deinen Namen ein.'; render(); return; }
  if (!mail || pass.length<6){ UI.err='Bitte E-Mail und ein Passwort mit mindestens 6 Zeichen eingeben.'; render(); return; }
  UI.busy=true; render(); $('#a-mail').value=mail;
  try {
    if (reg){
      const { data, error } = await sb.auth.signUp({ email:mail, password:pass, options:{ data:{ name, avatar:L.av||'🧑' }, emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      if (!data.session){ UI.auth='check'; UI.busy=false; render(); return; }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email:mail, password:pass }); if (error) throw error;
    }
  } catch(err){ UI.err = errText(err); UI.busy=false; render(); }
}
async function onSession(session){
  D.user = session ? session.user : null; UI.busy=false;
  if (D.user){ try { await loadAll(true); subscribe(); } catch(e){ if (!useCache()) UI.err = errText(e); offlineRetry(); } }
  else { try { localStorage.removeItem('wg.cache'); } catch(e){} UI.offline = false; UI.auth = UI.auth==='check' ? 'check' : 'login'; D.profile=null; D.membership=null; if (channel){ sb.removeChannel(channel); channel=null; } }
  UI.loading=false; render();
  if (D.user && !D.profile?.banned) syncPush().then(() => setTimeout(maybePushPrompt, performance.now() < 6000 ? 3800 : 600));
  if (D.user && D.profile && UI.supFor !== D.user.id){ UI.supFor = D.user.id; loadSupport().then(() => { if (SUP.tickets.some(t => t.status !== 'geloest')) supSubscribe(); if (supUnread() && UI.tab === 'more' && !$('.sheet')) render(); }).catch(()=>{}); }
  if (D.user && !UI.counted && !D.profile?.banned){ UI.counted = true; trackOpen(); setTimeout(firstRunInfo, 1400); setTimeout(checkBadges, 2500); }
}

/* ---------- Sheets ---------- */
let sheetFn = null;
function openSheet(html, keep){
  const old = $('.sheet');
  if (keep && old){ const top = old.scrollTop; morph(old, `<div class="grabber"></div>${html}`); if (old.scrollTop !== top) old.scrollTop = top; return; }
  $('#overlay').innerHTML = `<div class="scrim" data-action="close"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div>${html}</div>`; }
function closeSheet(){ $('#overlay').innerHTML=''; sheetFn=null; }
function refreshSheet(){ if (sheetFn) sheetFn(true); }
const sheetHead = t => `<div class="top" style="padding-top:0"><div class="h1" style="font-size:22px">${t}</div><button class="icon-btn" data-action="close" aria-label="Schließen">${I.x}</button></div>`;

function openRecipe(id, keep){
  sheetFn = (k) => openRecipe(id, k);
  const r = rec(id), me = D.profile, fr = new Set(D.fridge), favs = me.favs||[];
  const fav = favs.includes(id), wished = D.wishes.some(w=>w.recipe_id===id && w.user_id===me.id), who = wishersOf(id);
  const people = eatersNow().map(prof), notes = softNotes(r, people), blocked = people.map(p=>({p, c:conflicts(r,p)})).filter(x=>x.c.length);
  openSheet(`${sheetHead('')}
    ${recipeHero(r)}<div class="h1" style="text-align:center">${esc(r.n)}</div>
    <div style="display:flex;gap:6px;justify-content:center;margin:10px 0 16px;flex-wrap:wrap"><span class="chip c-muted">⏱ ${r.t} Min</span>${r.m==='fast'?'<span class="chip c-yolk">Fastfood-Abend</span>':r.m==='gesund'?'<span class="chip c-herb">Gesund</span>':''}${r.x.includes('scharf')?'<span class="chip c-tomato">Scharf</span>':''}${(rt => rt.n ? `<span class="chip c-yolk">⭐ ${rt.avg.toFixed(1).replace('.', ',')} · ${rt.n} ${rt.n === 1 ? 'Bewertung' : 'Bewertungen'}</span>` : '')(ratingOf(id))}${inSeason(r) ? '<span class="chip c-herb">🍂 Saison</span>' : ''}${cookedTimes(id) ? `<span class="chip c-muted">🍳 ${cookedTimes(id)}× gekocht</span>` : ''}</div>
    ${who.length?`<div class="card" style="display:flex;gap:10px;align-items:center;margin-bottom:12px"><span class="avatar-stack">${who.map(w=>`<span class="avatar sm">${avIn(prof(w))}</span>`).join('')}</span><span><b>${esc(names(who.map(w=>prof(w).name)))}</b> ${who.length>1?'wünschen':'wünscht'} sich das</span></div>`:''}
    ${blocked.length?`<div class="card" style="background:var(--tomato-soft);color:var(--tomato);margin-bottom:12px;font-weight:700">${blocked.map(b=>`${esc(b.p.name)} ${esc(b.c[0])}`).join('<br>')}</div>`:''}
    ${notes.length?`<div class="card" style="background:var(--yolk-soft);margin-bottom:12px;font-weight:700">💡 ${notes.map(esc).join('<br>💡 ')}</div>`:''}
    <div style="display:grid;grid-template-columns:1fr auto;gap:8px">
      <button class="btn ${wished?'btn-ghost':'btn-tomato'}" data-action="wish" data-id="${id}">${wished?'✓ Gewünscht':'🙋 Wünschen'}</button>
      <button class="btn btn-ghost" data-action="fav" data-id="${id}" aria-label="${fav?'Aus Lieblingen entfernen':'Als Lieblingsessen markieren'}" aria-pressed="${fav}"><span class="heart ${fav?'on':''}">${I.heart.replace('<svg','<svg fill="'+(fav?'currentColor':'none')+'"')}</span></button></div>
    <div class="h2">Zutaten</div>
    <div class="card" style="padding:6px 16px">${r.i.map(k=>`<div class="ing-line"><span class="ok" style="background:${fr.has(k)?'var(--herb-soft)':'var(--tomato-soft)'};color:${fr.has(k)?'var(--herb)':'var(--tomato)'}">${fr.has(k)?'✓':'!'}</span>${ingEmoji(k)} ${ingName(k)}${fr.has(k)?'':' <span class="muted" style="font-size:13px">fehlt</span>'}</div>`).join('')}
      ${r.o.map(k=>`<div class="ing-line muted"><span class="ok" style="background:var(--surface-2)">+</span>${ingEmoji(k)} ${ingName(k)} <span style="font-size:13px">optional</span></div>`).join('')}</div>
    ${(() => { const miss = r.i.filter(k => !fr.has(k)); if (!miss.length) return '';
      return miss.every(onList) ? `<div class="muted" style="text-align:center;font-size:13px;margin-top:10px">🛒 Alles Fehlende steht schon auf der Einkaufsliste</div>`
        : `<button class="btn btn-line btn-block" style="margin-top:10px" data-action="shop-missing" data-id="${id}">🛒 ${miss.length===1?'Fehlende Zutat':miss.length+' fehlende Zutaten'} auf die Einkaufsliste</button>`; })()}
    <button class="btn btn-line btn-block" style="margin-top:8px" data-action="plan-this" data-id="${id}">📅 In den Wochenplan</button>
    <div class="h2">So geht's</div>
    <div class="card" style="padding:6px 16px">${r.s.map((s,n)=>`<div class="step"><b>${n+1}</b><span>${stepWithTimers(s)}</span></div>`).join('')}</div>
    ${recipeExtras(r)}${r.xdb ? `<p class="muted" style="font-size:12px;text-align:center;margin-top:10px">Neu aus der Rezept-Datenbank${r.src ? ' · Quelle: ' + esc(r.src) : ''}</p>` : ''}
    <button class="btn btn-tomato btn-block" style="margin-top:16px" data-action="cook" data-id="${id}">👨‍🍳 Kochmodus starten</button>
    <button class="btn btn-herb btn-block" style="margin-top:8px" data-action="cooked" data-id="${id}">🍽️ Heute gekocht</button>
    <button class="btn btn-ghost btn-block" style="margin-top:8px" data-action="share-recipe" data-id="${id}">📤 Rezept als Bild teilen</button>
    ${r.custom ? `<p class="muted" style="text-align:center;font-size:13px;margin:14px 0 0">Familienrezept von ${esc(prof(r.by).name)}</p>
      ${(r.by===D.user.id || isAdmin()) ? (UI.confirmDel===id ? `<div class="card" style="background:var(--tomato-soft);margin-top:10px"><b style="color:var(--tomato)">Rezept wirklich löschen?</b><div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-tomato btn-sm" style="flex:1" data-action="del-recipe" data-id="${id}">Löschen</button><button class="btn btn-ghost btn-sm" style="flex:1" data-action="cancel-del" data-id="${id}">Abbrechen</button></div></div>` : `<button class="linkbtn" style="display:block;margin:4px auto 0;color:var(--tomato)" data-action="ask-del" data-id="${id}">Rezept löschen</button>`) : ''}` : ''}`, keep);
}
function openInvite(){
  sheetFn = null;
  const link = location.origin + location.pathname + '?join=' + encodeURIComponent(D.family.code);
  openSheet(`${sheetHead('Einladen')}
    <div class="qr-box"><p class="muted" style="margin:0">Lass dein Familienmitglied diesen Code mit der Handy-Kamera scannen. Die App öffnet sich dann mit der Einladung.</p>
      <div id="qr" aria-label="QR-Code zum Beitreten"></div>
      <div class="muted" style="font-size:13px">oder in der App eingeben</div><div class="code">${esc(D.family.code)}</div>
      <div style="display:flex;gap:8px;width:100%"><button class="btn btn-ghost btn-sm" style="flex:1" data-action="copy" data-text="${esc(D.family.code)}">Code kopieren</button><button class="btn btn-ghost btn-sm" style="flex:1" data-action="share-link" data-text="${esc(link)}">Link teilen</button></div></div>`);
  try { new QRCode($('#qr'), { text: link, width:180, height:180, colorDark:'#16201A', colorLight:'#ffffff' }); }
  catch(e){ $('#qr').innerHTML = `<div style="width:180px;height:180px;display:grid;place-items:center;color:#16201A;font-weight:800">${esc(D.family.code)}</div>`; }
}
function openPrefs(keep){
  sheetFn = null;   // Profil nicht von außen neu aufbauen, sonst gehen Eingaben verloren
  const a = D.profile, dis = ['champignons','zwiebeln','brokkoli','paprika','tomaten','spinat','zucchini','knoblauch','fisch','scharf','fleisch'];
  openSheet(`${sheetHead('Mein Profil')}
    <div class="field"><label for="p-name">Name</label><input id="p-name" class="input" maxlength="30" value="${esc(a.name)}"></div>
    <div class="pf-edit"><span class="avatar pf-big">${avIn(a)}</span>
      <div class="pf-btns"><button type="button" class="btn btn-line btn-sm" data-action="av-photo">📷 Eigenes Foto</button>${isPhoto(a.avatar) ? `<button type="button" class="btn btn-sm" style="background:none;color:var(--muted)" data-action="set-av" data-v="🧑">Foto entfernen</button>` : ''}</div></div>
    <div class="field"><span class="lbl2">Oder ein Symbol</span><div class="emoji-pick">${AVS.map(x=>`<button type="button" data-action="set-av" data-v="${x}" aria-pressed="${a.avatar===x}">${x}</button>`).join('')}</div></div>
    ${hasExtras() ? `<div class="field"><span class="lbl2">Profilfarbe</span><div class="pf-cols">${PCOLS.map(c=>`<button type="button" data-action="set-pc" data-v="${c}" aria-pressed="${(a.color||'')===c}" style="--c:${c||'var(--surface-2)'}" aria-label="Farbe ${c||'keine'}">${c?'':'∅'}</button>`).join('')}</div></div>
    <div class="field"><label for="p-status">Status / Über mich</label><input id="p-status" class="input" maxlength="60" placeholder="z. B. Lieblingsessen: Pizza 🍕" value="${esc(a.status||'')}"></div>` : ''}
    <div class="list"><div class="row"><span class="grow"><b>Vegetarisch</b><small>Kein Fleisch und kein Fisch</small></span><button class="switch" role="switch" aria-checked="${a.veg}" data-action="veg" aria-label="Vegetarisch"></button></div></div>
    <div class="list" style="margin-top:10px"><div class="row"><span class="grow"><b>Wählerischer Esser</b><small>Statt „mag ich nicht" wählst du aus, was du isst</small></span><button class="switch" role="switch" aria-checked="${!!a.picky}" data-action="picky" aria-label="Wählerischer Esser"></button></div></div>
    ${a.picky ? `<div class="h2">Das esse ich <span class="chip c-muted" data-count="likes">${(a.likes||[]).length} gewählt</span></div>
      ${[['k','Kühlschrank'],['v','Vorrat']].map(([g,t])=>`<div class="lbl2" style="margin:10px 0 8px">${t}</div><div class="chips">${Object.keys(ING).filter(k=>ING[k][2]===g).map(k=>`<button class="ing" data-action="like" data-k="${k}" aria-pressed="${(a.likes||[]).includes(k)}">${ING[k][1]} ${ING[k][0]}</button>`).join('')}</div>`).join('')}
      <p class="muted" style="font-size:13px">Du bekommst nur Gerichte vorgeschlagen, bei denen du alle Hauptzutaten isst.</p>` : `
    <div class="h2">Das mag ich nicht</div>
    <div class="chips">${dis.map(k=>`<button class="ing" data-action="dis" data-k="${k}" aria-pressed="${(a.dislikes||[]).includes(k)}">${TRAITS[k]?(k==='scharf'?'🌶️ ':k==='fisch'?'🐟 ':'🥩 ')+TRAITS[k]:ingEmoji(k)+' '+ingName(k)}</button>`).join('')}</div>`}
    <div class="h2">Unverträglichkeiten</div>
    <div class="chips">${Object.entries(ALLERGENS).map(([k,l])=>`<button class="ing" data-action="alg" data-k="${k}" aria-pressed="${(a.allergies||[]).includes(k)}">${l}</button>`).join('')}</div>
    <button class="btn btn-herb btn-block" style="margin-top:18px" data-action="save-prefs">Fertig</button>`, keep);
}

/* ---------- Abstimmung „Was essen wir heute?" ---------- */
function pollBlock(all){
  const P = D.poll, fresh = P && (Date.now() - new Date(P.created_at)) < 18*3600e3;
  if (P && P.status === 'open'){
    const counts = {}; D.votes.forEach(v => counts[v.recipe_id] = (counts[v.recipe_id]||0) + 1);
    const mine = D.votes.find(v => v.user_id === D.user.id), canEnd = P.created_by === D.user.id || isAdmin();
    return `<div class="h2">Abstimmung läuft <span class="chip c-tomato">${D.votes.length} von ${active().length}</span></div>
      <div class="card poll"><div style="font-weight:800;margin-bottom:10px">🗳️ Was essen wir heute?${P.ends_at ? ` <span class="chip c-muted" style="margin-left:6px">⏰ endet ${new Date(P.ends_at).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})} Uhr</span>` : ''}</div>
      <div class="stack" style="gap:8px">${P.options.filter(rec).map(id => { const r = rec(id), who = D.votes.filter(v=>v.recipe_id===id).map(v=>prof(v.user_id)), pct = D.votes.length ? (counts[id]||0)/D.votes.length*100 : 0;
        return `<button class="opt ${mine&&mine.recipe_id===id?'mine':''}" data-action="vote" data-id="${id}"><i style="width:${pct}%"></i><span class="oe">${r.e}</span><span class="on">${esc(r.n)}</span><span class="avatar-stack">${who.map(p=>`<span class="avatar sm">${avIn(p)}</span>`).join('')}</span><b>${counts[id]||0}</b></button>`; }).join('')}</div>
      ${canEnd ? `<button class="btn btn-herb btn-block btn-sm" style="margin-top:12px" data-action="end-poll">Abstimmung beenden</button>` : `<p class="muted" style="font-size:13px;margin:10px 0 0">${mine?'Deine Stimme ist gezählt. Du kannst sie noch ändern.':'Tippe auf dein Lieblingsgericht.'}</p>`}</div>`;
  }
  if (P && P.status === 'closed' && P.winner && fresh && rec(P.winner)){
    const r = rec(P.winner);
    return `<div class="h2">Abstimmung</div><button class="card poll-win" data-action="open-recipe" data-id="${r.id}"><span class="trophy">🏆</span><span style="flex:1;text-align:left"><span class="muted" style="font-size:13px;font-weight:700">Die Familie hat entschieden</span><br><b style="font-size:18px">${r.e} ${esc(r.n)}</b></span>${I.chev}</button>
      <button class="linkbtn" style="display:block;margin:6px auto 0" data-action="new-poll">Neue Abstimmung starten</button>`;
  }
  return active().length > 1 ? `<button class="btn btn-line btn-block" style="margin-top:18px" data-action="new-poll">🗳️ Abstimmung starten</button>` : '';
}
function openPollSetup(){
  sheetFn = null;
  const list = suggest().filter(x => x.missing.length <= 1).slice(0, 12), pre = list.slice(0, 3).map(x => x.r.id);
  openSheet(`${sheetHead('Abstimmung starten')}
    <p class="muted" style="margin-top:-6px">Wähle 2 bis 4 Gerichte. Alle in der Familie können dann abstimmen.</p>
    ${list.length < 2 ? `<div class="card empty"><div class="g">🧊</div><b>Zu wenig Auswahl</b>Trag im Kühlschrank mehr Zutaten ein.<button class="btn btn-line btn-block" style="margin-top:12px" data-tab="fridge">Zum Kühlschrank</button></div>` :
    `<div class="stack" style="gap:8px">${list.map(x => `<button class="opt pick-opt" data-action="poll-pick" data-id="${x.r.id}" aria-pressed="${pre.includes(x.r.id)}"><span class="oe">${x.r.e}</span><span class="on">${esc(x.r.n)}</span>${x.missing.length?'<span class="chip c-yolk">🛒 1</span>':''}<span class="tick">✓</span></button>`).join('')}</div>
    <div class="h2">⏰ Endet automatisch</div>
    <div class="seg" role="group" aria-label="Ende">${[['0','Von Hand'],['30','in 30 Min'],['60','in 1 Std'],['120','in 2 Std']].map(([k,l]) => `<button data-action="poll-end-pick" data-v="${k}" aria-pressed="${(UI.pollEnd||'60')===k}">${l}</button>`).join('')}</div>
    <button class="btn btn-herb btn-block" style="margin-top:16px" data-action="start-poll">Abstimmung starten</button>`}`);
}

/* ---------- Ablaufdaten eintragen ---------- */
function openExpiry(){
  sheetFn = null;
  const items = D.fridge.filter(k => ING[k]);
  openSheet(`${sheetHead('Haltbarkeit')}
    <button class="photo-card" data-action="exp-photo" style="margin-bottom:12px"><span class="cam">${I.cam}</span><span style="flex:1"><b style="font-size:17px">Datum fotografieren</b><br><span style="opacity:.9;font-size:14px">Foto vom Haltbarkeitsdatum – Produkt und Datum werden automatisch eingetragen</span></span></button>
    <p class="muted" style="margin-top:-2px">Oder trag es selbst ein. Die App schlägt dann zuerst Gerichte vor, die es aufbrauchen.</p>
    ${items.length ? `<div class="list">${items.map(k => `<label class="row" for="exp-${k}"><span style="font-size:22px">${ingEmoji(k)}</span><span class="grow"><b>${ingName(k)}</b></span><input id="exp-${k}" class="input date" type="date" value="${esc(D.expiries[k]||'')}"></label>`).join('')}</div>
    <button class="btn btn-herb btn-block" style="margin-top:16px" data-action="save-expiry">Speichern</button>` : `<div class="card empty"><div class="g">🧊</div><b>Kühlschrank ist leer</b>Wähle zuerst aus, was da ist.</div>`}`);
}

/* ---------- Eigenes Rezept eintragen ---------- */
const FOOD_EMOJI = ['🍽️','🍲','🍝','🥘','🍛','🥗','🍕','🍔','🌮','🥪','🍳','🥞','🍰','🍗','🐟','🥦'];
function openRecipeForm(){
  sheetFn = null;
  openSheet(`${sheetHead('Eigenes Rezept')}
    <div class="field"><label for="r-name">Name</label><input id="r-name" class="input" maxlength="60" placeholder="z. B. Omas Gulasch"></div>
    <div class="field"><span class="lbl2">Bild</span><div class="emoji-pick">${FOOD_EMOJI.map((x,n)=>`<button type="button" data-action="r-emoji" data-v="${x}" aria-pressed="${n===0}">${x}</button>`).join('')}</div></div>
    <div class="field"><label for="r-time">Zeit</label><select id="r-time" class="input">${[10,15,20,30,45,60,90,120].map(m=>`<option value="${m}" ${m===30?'selected':''}>${m} Minuten</option>`).join('')}</select></div>
    <div class="field"><span class="lbl2">Art</span><div class="seg" role="group" aria-label="Art">${[['gesund','🥗 Gesund'],['normal','Normal'],['fast','🍔 Fastfood']].map(([k,l])=>`<button type="button" data-action="r-mood" data-v="${k}" aria-pressed="${k==='normal'}">${l}</button>`).join('')}</div></div>
    <div class="h2">Hauptzutaten</div>
    <div class="chips">${Object.keys(ING).map(k=>`<button type="button" class="ing" data-action="r-ing" data-k="${k}" aria-pressed="false">${ING[k][1]} ${ING[k][0]}</button>`).join('')}</div>
    <div class="h2">Enthält</div>
    <div class="chips">${[['fleisch','🥩 Fleisch'],['fisch','🐟 Fisch'],['scharf','🌶️ Scharf']].map(([k,l])=>`<button type="button" class="ing" data-action="r-trait" data-k="${k}" aria-pressed="false">${l}</button>`).join('')}</div>
    <div class="field" style="margin-top:16px"><label for="r-steps">Zubereitung (ein Schritt pro Zeile)</label><textarea id="r-steps" class="input" rows="6" placeholder="Zwiebeln schneiden und anbraten.&#10;Fleisch dazugeben und 60 Minuten schmoren."></textarea></div>
    <button class="btn btn-herb btn-block" data-action="save-recipe">Rezept speichern</button>`);
}

/* ---------- Feedback ---------- */
function openFeedback(){
  sheetFn = null;
  openSheet(`${sheetHead('Feedback')}
    <div class="seg" role="group" aria-label="Art">${[['fehler','🐞 Fehler'],['idee','💡 Idee'],['lob','❤️ Lob']].map(([k,l],n)=>`<button type="button" data-action="fb-kind" data-v="${k}" aria-pressed="${n===0}">${l}</button>`).join('')}</div>
    <div class="field" style="margin-top:14px"><label for="fb-text">Was möchtest du uns sagen?</label><textarea id="fb-text" class="input" rows="6" maxlength="2000" placeholder="Beschreib kurz, was passiert ist oder was du dir wünschst."></textarea></div>
    <button class="btn btn-herb btn-block" data-action="send-feedback">Senden</button>`);
}

/* ---------- Kochmodus (Querformat) ---------- */
let wakeLock = null, timerT = null, audioCtx = null, clockT = null;
function stepMinutes(txt){ const m = txt.match(/(\d+)\s*Minuten/); return m ? +m[1] : 0; }

/* Passende Animation zum Arbeitsschritt */
function sceneFor(txt, r){
  const t = txt.toLowerCase();
  const ings = Object.keys(ING).filter(k => t.includes(ING[k][0].toLowerCase().slice(0, Math.max(4, ING[k][0].length - 2)))).slice(0, 3).map(k => ING[k][1]);
  const drop = ings.map((e, n) => `<span class="sc-ing" style="--d:${n * .18}s;--x:${(n - (ings.length - 1) / 2) * 46}px">${e}</span>`).join('');
  const pick = [
    [/schneid|hack|würfel|hobel|reib|streifen|scheiben|zerdrück|halbier/, 'chop', '🔪', 'Schneiden'],
    [/brat|anbrat|anschwitz|röst|pfanne|ausback/, 'fry', '🍳', 'Braten'],
    [/back|ofen|überback|°c/, 'bake', '🔥', 'Backen'],
    [/köchel|koch|sieden|wasser|ziehen lassen|schmor/, 'boil', '🍲', 'Kochen'],
    [/rühr|verquirl|misch|schwenk|unterheb|vermeng/, 'stir', '🥄', 'Verrühren'],
    [/knet|teig|ausroll|formen|forme/, 'knead', '🫓', 'Kneten'],
    [/würz|salz|pfeffer|abschmeck/, 'season', '🧂', 'Würzen'],
    [/ruhen|gehen lassen|quellen|abkühl|warten/, 'rest', '⏳', 'Warten'],
    [/servier|anricht|belegen|füllen|einroll|dazu/, 'serve', '🍽️', 'Anrichten'],
  ].find(([re]) => re.test(t)) || [null, 'idle', r.e, 'Los geht\'s'];
  const [, kind, icon, label] = pick;
  const extra = {
    chop: '<span class="sc-board"></span>',
    fry: '<span class="sc-sizzle"><i></i><i></i><i></i><i></i></span>',
    boil: '<span class="sc-bubbles"><i></i><i></i><i></i><i></i><i></i></span>',
    bake: '<span class="sc-heat"><i></i><i></i><i></i></span>',
    stir: '<span class="sc-swirl"></span>',
    season: '<span class="sc-grains"><i></i><i></i><i></i><i></i><i></i><i></i></span>',
    knead: '', rest: '', serve: '<span class="sc-sparkle"><i>✨</i><i>✨</i><i>✨</i></span>', idle: '',
  }[kind];
  return { kind, label, html: `<div class="scene sc-${kind}"><div class="sc-stage">${extra}<span class="sc-main">${icon}</span>${drop}</div></div>` };
}

function openCook(id){
  const r0 = rec(id);
  UI.cook = { id, step: 0, dir: 1, steps: cookStepsCached(r0), servings: Math.max(1, Math.min(12, eatersNow().length || 4)) }; sheetFn = null; applyTheme();
  if (!UI.cook.steps) loadCookSteps(r0);
  try { navigator.wakeLock && navigator.wakeLock.request('screen').then(l => wakeLock = l).catch(()=>{}); } catch(e){}
  // Auf dem Handy: Vollbild und Querformat versuchen (Android). iPhone zeigt den Dreh-Hinweis.
  if (!mq.matches){ try { const el = document.documentElement; (el.requestFullscreen ? el.requestFullscreen() : Promise.reject()).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape')).catch(()=>{}); } catch(e){} }
  document.documentElement.classList.add('cooking'); layout();
  clearInterval(clockT); clockT = setInterval(tickCookClock, 1000);
  renderCook(true);
}
function tickCookClock(){ const el = $('#cookClock'); if (!el) return; const d = new Date(); el.textContent = d.getHours() + ':' + String(d.getMinutes()).padStart(2,'0'); }
/* ---------- Ausführliche Kochschritte ----------
   Die KI schreibt aus der kurzen Anleitung 10–16 genaue Schritte (Zutaten holen, Haltbarkeit prüfen,
   Herdstufe, Garzeiten …). Einmal erzeugt, gelten sie für alle. Ohne KI greift eine eigene Logik. */
const ST_KEY = 'wasgibts.steps.v1';
let STC = {}; try { STC = JSON.parse(localStorage.getItem(ST_KEY)) || {}; } catch(e){}
const stKey = r => r.custom ? r.id : r.n;
function cookStepsCached(r){ const st = STC[stKey(r)]; return st ? personalize(r, st) : null; }
async function loadCookSteps(r){
  const c = UI.cook; let steps = null;
  try {
    const call = sb.functions.invoke('recipe-ai', { body:{ action:'steps', recipe:{ id:r.id, name:r.n, ingredients:r.i.map(ingName), optional:r.o.map(ingName), steps:r.s, minutes:r.t } } });
    const res = await Promise.race([call, new Promise(ok => setTimeout(() => ok({ timeout:true }), 15000))]);
    if (res && res.data && Array.isArray(res.data.steps) && res.data.steps.length >= 5){
      steps = res.data.steps; STC[stKey(r)] = steps; try { localStorage.setItem(ST_KEY, JSON.stringify(STC)); } catch(e){}
    }
  } catch(e){}
  if (UI.cook !== c) return;   // inzwischen geschlossen
  c.steps = personalize(r, steps || expandSteps(r)); c.step = 0; c.lastRead = null;
  renderCook(true);
}
/* Eigene Logik, falls die KI gerade nicht kann */
const PREP = {
  zwiebeln:'Zwiebeln schälen und fein würfeln.', knoblauch:'Knoblauch schälen und fein hacken.', paprika:'Paprika waschen, entkernen und in Streifen oder Würfel schneiden.',
  zucchini:'Zucchini waschen, die Enden abschneiden und in Scheiben oder Würfel schneiden.', tomaten:'Tomaten waschen und klein schneiden.', karotten:'Karotten schälen und in dünne Scheiben schneiden.',
  kartoffeln:'Kartoffeln schälen, waschen und in gleich große Stücke schneiden.', brokkoli:'Brokkoli waschen und in kleine Röschen teilen.', champignons:'Champignons mit Küchenpapier abreiben und in Scheiben schneiden.',
  lauch:'Lauch längs halbieren, gründlich waschen und in Ringe schneiden.', spinat:'Spinat waschen und abtropfen lassen.', aubergine:'Aubergine waschen und in Würfel schneiden.',
  blumenkohl:'Blumenkohl waschen und in Röschen teilen.', haehnchen:'Hähnchen kalt abspülen, trocken tupfen und in mundgerechte Stücke schneiden. Danach Hände und Brett gründlich waschen.',
  gurke:'Gurke waschen und in Scheiben schneiden.', salat:'Salat waschen und trocken schleudern.', kraeuter:'Kräuter waschen, trocken schütteln und hacken.', fruehlingszwiebeln:'Frühlingszwiebeln waschen und in Ringe schneiden.',
  kuerbis:'Kürbis waschen, entkernen und in Würfel schneiden.', suesskartoffel:'Süßkartoffeln schälen und in Würfel schneiden.', ingwer:'Ingwer schälen und fein reiben.', chili:'Chili entkernen und fein hacken (danach Hände waschen!).',
};
const FRESH_CHECK = ['milch','sahne','joghurt','quark','frischkaese','schmand','hackfleisch','haehnchen','pute','rind','schwein','lachs','fischfilet','garnelen','eier','mozzarella','feta','schinken','speck','wuerstchen','salami'];
function expandSteps(r){
  const out = [], k = r.i.filter(x => ING[x]), cold = k.filter(x => ING[x][2] === 'k'), dry = k.filter(x => ING[x][2] === 'v');
  out.push({ text: `Zutaten bereitlegen.${cold.length ? ' Aus dem Kühlschrank: ' + cold.map(ingName).join(', ') + '.' : ''}${dry.length ? ' Aus dem Vorrat: ' + dry.map(ingName).join(', ') + '.' : ''} Dazu Salz, Pfeffer und Öl.` });
  const fresh = k.filter(x => FRESH_CHECK.includes(x));
  if (fresh.length) out.push({ text: `Kurz prüfen: Haltbarkeitsdatum von ${fresh.map(ingName).join(', ')} ansehen und bei Fleisch und Milchprodukten auch riechen.` });
  const all = r.s.join(' ').toLowerCase(), oven = all.match(/(\d{3})\s*°c/);
  if (oven) out.push({ text: `Backofen auf ${oven[1]} °C Ober-/Unterhitze vorheizen.`, heat: `${oven[1]} °C Ober-/Unterhitze` });
  if (/nudeln|spaghetti|kartoffeln \d+ minuten|reis kochen/.test(all) || k.some(x => ['nudeln','reisnudeln','gnocchi','lasagne'].includes(x)) && /koch/.test(all))
    out.push({ text: 'Einen großen Topf mit reichlich Wasser füllen, 1 TL Salz pro Liter dazugeben und auf höchster Stufe zum Kochen bringen.', heat: 'Stufe 9 von 9' });
  const grate = /raspel|reib/.test(all);
  k.forEach(x => { if (!PREP[x]) return;
    if (grate && ['karotten','zucchini','kartoffeln','suesskartoffel'].includes(x)) out.push({ text: `${ingName(x)} waschen${['karotten','kartoffeln','suesskartoffel'].includes(x) ? ' und schälen' : ''} – geraspelt wird gleich.` });
    else out.push({ text: PREP[x] }); });
  let fried = false;
  r.s.forEach(st => {
    const t = st.toLowerCase();
    if (!fried && /brat|anbrat|anschwitz|pfanne|röst/.test(t)){ fried = true; out.push({ text: 'Eine große Pfanne mit 1–2 EL Öl auf den Herd stellen und heiß werden lassen.', heat: 'mittel-hoch, Stufe 6–7 von 9' }); }
    out.push({ text: st, minutes: stepMinutes(st) || null });
  });
  if (r.meal !== 'suess') out.push({ text: 'Abschmecken: probieren und bei Bedarf mit Salz und Pfeffer nachwürzen.' });
  out.push({ text: `Herd${oven ? ' und Ofen' : ''} ausschalten, anrichten und servieren. Guten Appetit!` });
  return out;
}
/* Persönlich: läuft etwas bald ab, kommt eine Warnung gleich an den Anfang */
function personalize(r, steps){
  const list = steps.map(x => typeof x === 'string' ? { text:x } : { ...x });
  const soon = r.i.filter(k => { const d = daysLeft(k); return d !== null && d <= 2; });
  if (soon.length){
    const txt = soon.map(k => { const d = daysLeft(k); return `${ingName(k)} (${d < 0 ? 'abgelaufen!' : d === 0 ? 'läuft heute ab' : d === 1 ? 'läuft morgen ab' : 'in 2 Tagen'})`; }).join(', ');
    list.splice(Math.min(1, list.length), 0, { text: `⚠️ Achtung: ${txt}. Kurz ansehen und riechen – wenn es gut ist, heute verbrauchen.`, warn: true });
  }
  return list;
}

function renderCook(first){
  const c = UI.cook, r = rec(c.id); if (!r) return;
  if (!c.steps){
    $('#overlay').innerHTML = `<div class="cook tone-idle enter" role="dialog" aria-label="Kochmodus"><div class="ck-aura" aria-hidden="true"><i></i><i></i><i></i></div>
      <header class="ck-top glass"><button class="ck-icon" data-action="cook-close" aria-label="Kochmodus beenden">${I.x}</button><div class="ck-title"><b>${r.e} ${esc(r.n)}</b><span>Wird vorbereitet …</span></div><div id="cookClock" class="ck-clock"></div></header>
      <div class="ck-prep glass"><div class="ck-prep-ic">👨‍🍳</div><b>Ich schreibe dir die Schritte ausführlich auf</b><span>mit Herdstufe, Garzeiten und woran du erkennst, dass es fertig ist</span><div class="ck-dots"><i></i><i></i><i></i></div></div></div>`;
    tickCookClock(); return;
  }
  const S = c.steps, n = S.length, cur = S[c.step] || { text:'' }, txt = scaleQty(cur.text, (c.servings || 4) / 4), mins = cur.minutes || stepMinutes(txt), last = c.step === n - 1, sc = cur.warn ? { kind:'season', label:'Prüfen', html: `<div class="scene sc-idle"><div class="sc-stage"><span class="sc-main">⚠️</span></div></div>` } : sceneFor(txt, r);
  const pct = Math.round((c.step + 1) / n * 100);
  const stepHTML = `
      <div class="ck-orb glass">${sc.html}</div>
      <div class="ck-copy">
        <div class="ck-kicker"><span class="ck-pill">${sc.label}</span>${cur.heat ? `<span class="ck-pill heat">🔥 ${esc(cur.heat)}</span>` : ''}</div>
        <p class="ck-text">${esc(txt)}</p>
        ${mins ? `<button class="ck-tbtn glass" data-action="timer" data-v="${mins}"><span class="ck-tdot"></span>${mins}-Minuten-Timer starten</button>` : ''}
      </div>`;
  const navHTML = `
      <button class="ck-prev glass" data-action="cook-prev" ${c.step===0?'disabled':''} aria-label="Zurück">‹<span>Zurück</span></button>
      ${last ? `<button class="ck-next glass tint gold" data-action="cook-done">Fertig <span>🍽️</span></button>` : `<button class="ck-next glass tint" data-action="cook-next">Weiter <span class="ck-arrow">›</span></button>`}`;
  const shell = $('.cook');
  if (first || !shell){
    $('#overlay').innerHTML = `<div class="cook tone-${sc.kind} ${first?'enter':''} ${UI.cookForce?'force':''}" role="dialog" aria-label="Kochmodus">
      <div class="ck-aura" aria-hidden="true"><i></i><i></i><i></i></div>
      <header class="ck-top glass">
        <button class="ck-icon" data-action="cook-close" aria-label="Kochmodus beenden">${I.x}</button>
        <div class="ck-title"><b>${r.e} ${esc(r.n)}</b><span id="ckStepTxt">Schritt ${c.step+1} von ${n}</span></div>
        ${SR ? `<button class="ck-icon ck-tool" id="ckMic" data-action="cook-voice" aria-pressed="${!!UI.voice}" aria-label="Sprachsteuerung">${I.mic}</button>` : ''}
        ${'speechSynthesis' in window ? `<button class="ck-icon ck-tool" id="ckRead" data-action="cook-read" aria-pressed="${!!L.readAloud}" aria-label="Schritte vorlesen">${I.speaker}</button>` : ''}
        <button class="ck-icon ck-tool ck-serv" data-action="cook-serv" aria-label="Personen ändern">👥 <b id="ckServ">${c.servings}</b></button>
        <span id="cookTimers" class="ck-timers"></span>
        <div id="cookClock" class="ck-clock"></div>
        <div class="ck-bar"><i id="ckBar" style="width:${pct}%"></i></div>
      </header>
      <main class="ck-main in" id="ckMain">${stepHTML}</main>
      <nav class="ck-nav" id="ckNav">${navHTML}</nav>
      <div class="ck-voice glass" id="ckVoice" ${UI.voice?'':'hidden'}><span class="ck-mic-dot"></span><span id="ckHeard">Sag „Weiter", „Zurück", „Nochmal" oder „Timer"</span></div>
      <div class="rotate"><div class="ck-aura" aria-hidden="true"><i></i><i></i><i></i></div><div class="rot-card glass"><div class="rot-phone"><span></span></div><b>Bitte dreh dein Handy</b><p>Im Querformat siehst du alles groß und hast die Hände frei.</p><button class="linkbtn" data-action="cook-force">Drehen geht nicht? Im Hochformat weiter</button></div></div>
    </div>`;
  } else {
    // Weicher Wechsel: alter Schritt gleitet raus, neuer gleitet rein
    shell.className = shell.className.replace(/tone-\S+/, 'tone-' + sc.kind);
    $('#ckBar').style.width = pct + '%'; $('#ckStepTxt').textContent = `Schritt ${c.step+1} von ${n}`;
    $('#ckNav').innerHTML = navHTML;
    const main = $('#ckMain'), old = main.cloneNode(true);
    old.removeAttribute('id'); old.className = 'ck-main out ' + (c.dir < 0 ? 'back' : '');
    main.parentNode.insertBefore(old, main); setTimeout(() => old.remove(), 320);
    main.innerHTML = stepHTML; main.className = 'ck-main in ' + (c.dir < 0 ? 'back' : ''); void main.offsetWidth;
  }
  tickCookClock(); tickTimer();
  if (L.readAloud && (first || c.lastRead !== c.step)) speakStep();
}
/* ---------- Timer, Vorlesen und Sprachsteuerung im Kochmodus ---------- */
/* Mehrere Timer gleichzeitig – laufen auch weiter, wenn der Kochmodus zu ist */
UI.timers = [];
function startTimer(m, label){ if (!m) return; const c = UI.cook;
  UI.timers.push({ id: Date.now() + Math.random(), end: Date.now() + m*60e3, label: label || (c ? `Schritt ${c.step + 1}` : 'Timer'), dish: c ? (rec(c.id) || {}).n : '' });
  clearInterval(timerT); timerT = setInterval(tickTimer, 500); tickTimer(); beep(); buzz(20); toast(`⏱ ${m}-Minuten-Timer läuft`); }
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let voiceRec = null;
function speak(text){
  try { if (!('speechSynthesis' in window)) return; speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'de-DE'; u.rate = 1;
    const v = speechSynthesis.getVoices().find(x => /^de/i.test(x.lang)); if (v) u.voice = v;
    speechSynthesis.speak(u); } catch(e){}
}
function speakStep(){ const c = UI.cook; if (!c || !c.steps) return; const st = c.steps[c.step]; if (!st) return; c.lastRead = c.step; speak(`Schritt ${c.step + 1}. ${st.text}${st.heat ? '. ' + st.heat : ''}`); }
function updVoice(){
  const m = $('#ckMic'), rd = $('#ckRead'), box = $('#ckVoice');
  if (m) m.setAttribute('aria-pressed', !!UI.voice); if (rd) rd.setAttribute('aria-pressed', !!L.readAloud); if (box) box.hidden = !UI.voice;
}
function startVoice(){
  if (!SR){ toast('Sprachsteuerung geht in diesem Browser leider nicht'); return; }
  try {
    voiceRec = new SR(); voiceRec.lang = 'de-DE'; voiceRec.continuous = true; voiceRec.interimResults = false;
    voiceRec.onresult = e => { const res = e.results[e.results.length - 1]; if (res && res[0]) onVoice(res[0].transcript.toLowerCase().trim()); };
    voiceRec.onerror = e => { if (/not-allowed|service-not-allowed/.test(e.error)){ UI.voice = false; updVoice(); toast('Bitte erlaube das Mikrofon für die Sprachsteuerung'); } };
    voiceRec.onend = () => { if (UI.voice && UI.cook){ try { voiceRec.start(); } catch(err){} } };
    voiceRec.start(); UI.voice = true; updVoice(); buzz(15); toast('🎙️ Sprachsteuerung an');
  } catch(e){ UI.voice = false; updVoice(); toast('Sprachsteuerung konnte nicht starten'); }
}
function stopVoice(){ UI.voice = false; try { voiceRec && voiceRec.abort(); } catch(e){} voiceRec = null; updVoice(); }
const NUMW = { ein:1, eine:1, eins:1, zwei:2, drei:3, vier:4, fünf:5, sechs:6, sieben:7, acht:8, neun:9, zehn:10, elf:11, zwölf:12, fünfzehn:15, zwanzig:20, fünfundzwanzig:25, dreißig:30, vierzig:40, fünfundvierzig:45, sechzig:60 };
function onVoice(t){
  const h = $('#ckHeard'); if (h){ h.textContent = '„' + t + '"'; clearTimeout(onVoice.t); onVoice.t = setTimeout(() => { const x = $('#ckHeard'); if (x) x.textContent = 'Sag „Weiter", „Zurück", „Nochmal" oder „Timer"'; }, 2500); }
  const click = sel => { const b = $(sel); if (b && !b.disabled){ b.click(); return true; } return false; };
  if (/\b(weiter|nächste[rn]?|next|danach)\b/.test(t)) click('[data-action=cook-next]') || click('[data-action=cook-done]');
  else if (/\b(zurück|vorherige[rn]?|davor)\b/.test(t)) click('[data-action=cook-prev]');
  else if (/(wiederhol|nochmal|noch mal|vorlesen|lies)/.test(t)) speakStep();
  else if (/(timer|wecker|stoppuhr)/.test(t)){
    const num = t.match(/(\d+)/), w = Object.keys(NUMW).sort((a, b) => b.length - a.length).find(k => new RegExp('\\b' + k + '\\b').test(t));
    const r = rec(UI.cook.id), m = num ? +num[1] : w ? NUMW[w] : (UI.cook.steps && UI.cook.steps[UI.cook.step] ? (UI.cook.steps[UI.cook.step].minutes || stepMinutes(UI.cook.steps[UI.cook.step].text)) : 0);
    if (m) startTimer(m); else toast('Wie viele Minuten? Sag z. B. „Timer zehn Minuten"');
  }
  else if (/\b(fertig)\b/.test(t)) click('[data-action=cook-done]') || click('[data-action=cook-next]');
  else if (/(beenden|schließen|stopp|ende)/.test(t)){ const b = $('[data-action=cook-close]'); if (b) b.click(); }
}
function beep(){
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [0, .35, .7].forEach(t => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(.25, audioCtx.currentTime + t); g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + t + .3); o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + .3); }); } catch(e){}
}
function tickTimer(){
  const now = Date.now(), fmt = t => { const left = Math.max(0, t.end - now); return Math.floor(left/60e3) + ':' + String(Math.floor(left%60e3/1e3)).padStart(2,'0'); };
  const done = UI.timers.filter(t => t.end <= now);
  if (done.length){ UI.timers = UI.timers.filter(t => t.end > now); beep(); buzz([300,150,300,150,300]); done.forEach(t => toast(`⏰ ${t.label}: Die Zeit ist um!`)); }
  const el = $('#cookTimers');
  if (el) el.innerHTML = UI.timers.map(t => `<button class="ck-timer" data-action="timer-x" data-v="${t.id}" title="${esc(t.label)} – antippen zum Beenden"><i></i>${fmt(t)}</button>`).join('');
  const ft = $('#ftimers');
  if (ft) ft.innerHTML = UI.cook ? '' : UI.timers.map(t => `<button class="ftimer" data-action="timer-x" data-v="${t.id}"><i></i><span>${esc(t.dish || t.label)}</span><b>${fmt(t)}</b></button>`).join('');
  if (!UI.timers.length) clearInterval(timerT);
}
function closeCook(){
  stopVoice(); try { speechSynthesis.cancel(); } catch(e){}
  UI.cook = null; UI.cookForce = false; clearInterval(clockT);
  try { wakeLock && wakeLock.release(); } catch(e){} wakeLock = null;
  try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch(e){}
  try { document.fullscreenElement && document.exitFullscreen(); } catch(e){}
  document.documentElement.classList.remove('cooking'); layout(); applyTheme();
  $('#overlay').innerHTML = '';
}

/* ---------- Rechtliches ---------- */
const LEGAL = {
  impressum: ['Impressum', `<p class="muted" style="font-size:13px">Anschrift und E-Mail werden vor der öffentlichen Veröffentlichung ergänzt.</p>
    <h3>Angaben gemäß § 5 DDG</h3><p>Odin Hennig<br>[Straße und Hausnummer]<br>[PLZ und Ort]</p>
    <h3>Kontakt</h3><p>E-Mail: [E-Mail-Adresse]</p>
    <h3>Verantwortlich für den Inhalt</h3><p>Odin Hennig, Anschrift wie oben</p>`],
  privacy: ['Datenschutz', `<p class="muted" style="font-size:13px">Entwurf. Vor der Veröffentlichung prüfen und die Platzhalter ersetzen.</p>
    <h3>Verantwortlich</h3><p>Odin Hennig (Anschrift und E-Mail siehe Impressum)</p>
    <h3>Welche Daten wir speichern</h3><p>Für dein Konto: E-Mail-Adresse und verschlüsseltes Passwort. In der App: Name, Profilbild-Emoji, Essensvorlieben und Unverträglichkeiten, Familienzugehörigkeit, Wünsche, Lieblingsgerichte, Kühlschrank-Inhalt mit Ablaufdaten, eigene Rezepte, Abstimmungen und Feedback. Diese Daten sehen nur die Mitglieder deiner Familie.</p>
    <h3>Wo die Daten liegen</h3><p>Die Daten werden bei Supabase in einem Rechenzentrum in Frankfurt (EU) gespeichert.</p>
    <h3>Kühlschrank-Foto</h3><p>Fotos werden nur zur Erkennung der Zutaten an Google (Gemini) gesendet und von der App nicht gespeichert.</p>
    <h3>Rezeptfotos und Kochschritte</h3><p>Fotos zu den Rezepten stammen von Pexels (pexels.com) und werden von deren Servern geladen; dabei wird deine IP-Adresse an Pexels übertragen. Fotograf und Quelle stehen am Bild. Für die Bildauswahl und die ausführlichen Kochschritte wird nur der Rezeptname mit seinen Zutaten an Google (Gemini) gesendet – keine persönlichen Daten.</p>
    <h3>Einkaufsliste und Wochenplan</h3><p>Einträge auf der Einkaufsliste und im Wochenplan sehen nur die Mitglieder deiner Familie.</p>
    <h3>Sprachsteuerung</h3><p>Wenn du im Kochmodus die Sprachsteuerung einschaltest, verarbeitet dein Gerät bzw. der Spracherkennungsdienst deines Browsers (bei Apple: Siri, bei Google: Google) deine Sprache. Die App selbst speichert keine Aufnahmen.</p>
    <h3>Hosting und Bibliotheken</h3><p>Die App wird über GitHub Pages ausgeliefert. Dabei werden technisch notwendige Daten wie deine IP-Adresse verarbeitet. Eine Programmbibliothek wird über jsDelivr geladen. Schriften liegen direkt in der App.</p>
    <h3>Deine Rechte</h3><p>Du hast das Recht auf Auskunft, Berichtigung und Löschung deiner Daten. Schreib uns dazu an die E-Mail-Adresse im Impressum. Du kannst die Familie jederzeit verlassen.</p>`],
};

/* ---------- „Was gibt's? Plus" – Hinweise, aber bewusst nicht nervig ----------
   Regeln:
   - Kleines Widget auf „Heute": frühestens ab dem 3. Öffnen, höchstens alle 3 Tage, mit ✕ für 14 Tage weg
   - Pop-up: frühestens ab dem 5. Öffnen an mindestens 3 verschiedenen Tagen, höchstens alle 21 Tage,
     nie beim ersten Öffnen eines Tages-Intros, nie im Kochmodus, nie über einem anderen Fenster
   - Schließen geht immer: großes ✕, „Nein danke", Tippen daneben oder Escape                      */
const DAY = 864e5;
function trackOpen(){
  const today = isoDay(new Date());
  L.opens = (L.opens||0) + 1; L.days = [...new Set([...(L.days||[]), today])].slice(-30); saveLocal();
}
function showPlusWidget(){ return !L.plusInterest && (L.plusHideUntil||0) <= Date.now(); }
function plusWidget(){
  return `<div class="plus-widget big"><div class="pw-glow"></div><span class="pw-ic">✨</span><button class="pw-main" data-action="plus"><b>Was gibt's? Plus</b><small>KI-Rezepte, unbegrenzt Fotos, Wochenplan-Assistent – für die ganze Familie</small><span class="pw-cta">Jetzt ansehen ›</span></button><button class="pw-x" data-action="plus-hide" aria-label="Hinweis ausblenden">✕</button></div>`;
}
/* Kleine Plus-Hinweise an passenden Stellen */
const PLUS_HINTS = {
  fridge: ['📸', 'Mit Plus ohne Tageslimit fotografieren', 'Die KI erkennt beliebig oft, was im Kühlschrank ist.'],
  week:   ['🤖', 'Mit Plus plant die KI eure Woche', 'Nach eurem Geschmack, mit Resteverwertung und Einkaufsliste nach Gängen im Laden sortiert.'],
  shop:   ['🧾', 'Plus: Einkaufsliste nach Supermarkt sortiert', 'Gemüse, Kühlregal, Vorrat – so gehst du nur einmal durch den Laden.'],
  more:   ['👑', 'Hol dir Plus für die ganze Familie', 'Ein Abo für alle. Alles Bisherige bleibt kostenlos.'],
};
function plusHint(k){
  if (!showPlusWidget()) return '';
  const [e, t, d] = PLUS_HINTS[k];
  return `<div class="plus-hint"><button class="ph-main" data-action="plus"><span class="ph-ic">${e}</span><span class="grow"><b>${t}</b><small>${d}</small></span><span class="ph-tag">PLUS</span></button><button class="pw-x" data-action="plus-hide" aria-label="Plus-Hinweise ausblenden">✕</button></div>`;
}
function maybePlusPopup(){
  if (D.profile?.banned) return;
  const now = Date.now();
  if (UI.cook || $('.sheet') || !D.user || !isActive()) return;
  if ((L.opens||0) < 2 || L.plusInterest) return;
  if (L.lastPlusPopup && now - L.lastPlusPopup < 4*DAY) return;
  L.lastPlusPopup = now; saveLocal(); openPlus(true);
}
function openPlus(popup){
  sheetFn = null;
  const perks = [['📸','Kühlschrank-Foto ohne Tageslimit'],['🤖','KI-Rezepte aus genau euren Zutaten'],['📅','Wochenplan mit automatischer Einkaufsliste'],['📖','Unbegrenzt eigene Familienrezepte'],['🎨','Eigene Farbthemen für die App']];
  openSheet(`<div class="plus-head"><button class="plus-x" data-action="close" aria-label="Schließen">✕</button><div class="plus-badge">✨ PLUS</div><div class="h1" style="color:#fff">Mehr für deine Familie</div><p>Alles, was du jetzt nutzt, bleibt kostenlos. Plus ist ein Extra obendrauf.</p></div>
    <div class="stack" style="margin-top:16px">${perks.map(([e,t])=>`<div class="perk-row"><span>${e}</span>${t}</div>`).join('')}</div>
    <div class="plus-prices"><div><b>0,99 €</b><small>pro Monat</small></div><div class="best"><b>10 €</b><small>pro Jahr · spart 16 %</small></div></div>
    <p class="muted" style="font-size:13px;text-align:center;margin:4px 0 12px">Ein Abo gilt für die ganze Familie. Plus startet bald.</p>
    ${adOffer()}
    ${L.plusInterest ? `<div class="card" style="text-align:center;background:var(--herb-soft);font-weight:800">💚 Danke! Wir sagen dir Bescheid, sobald Plus startet.</div>`
      : `<button class="btn btn-herb btn-block" data-action="plus-interest">Ich hätte Interesse</button>`}
    <button class="btn btn-block" style="background:none;color:var(--muted);margin-top:6px" data-action="close">${popup ? 'Nein danke' : 'Schließen'}</button>`);
}

/* ---------- Speichern in der Datenbank ---------- */
/* Profil: schnelle Tipps werden gesammelt und als ein Paket gespeichert */
let profT = null, profPatch = {};
function updateProfile(patch){
  Object.assign(D.profile, patch); D.profiles[D.profile.id] = D.profile; Object.assign(profPatch, patch); bump();
  clearTimeout(profT); profT = setTimeout(flushProfile, 350);
}
function flushProfile(){
  clearTimeout(profT); profT = null;
  const p = profPatch; profPatch = {};
  if (!Object.keys(p).length) return Promise.resolve();
  return save(() => sb.from('profiles').update(p).eq('id', D.profile.id)).catch(e => toast(errText(e)));
}
/* Kühlschrank: kurz sammeln, dann den aktuellen Stand speichern */
let fridgeT = null;
function saveFridgeSoon(){ bump(); clearTimeout(fridgeT); fridgeT = setTimeout(flushFridge, 450); }
function flushFridge(){
  clearTimeout(fridgeT); fridgeT = null;
  if (!D.family) return Promise.resolve();
  Object.keys(D.expiries).forEach(k => { if (!D.fridge.includes(k)) delete D.expiries[k]; });
  const items = [...D.fridge], expiries = { ...D.expiries };
  return save(() => sb.from('fridges').update({ items, expiries, updated_at: new Date().toISOString() }).eq('family_id', D.family.id)).catch(e => toast(errText(e)));
}
/* Beim Verlassen der App noch offene Änderungen sofort speichern */
document.addEventListener('visibilitychange', () => { if (document.hidden){ if (fridgeT) flushFridge(); if (profT) flushProfile(); } });
window.addEventListener('pagehide', () => { if (fridgeT) flushFridge(); if (profT) flushProfile(); });

/* ---------- Kühlschrank-Foto ---------- */
function shrink(file){ // Bild verkleinern, damit es schnell hochlädt
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => {
    const s = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width*s); c.height = Math.round(img.height*s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    res(c.toDataURL('image/jpeg', .82).split(',')[1]); }; img.onerror = rej; img.src = URL.createObjectURL(file); });
}
async function handlePhoto(file){
  if (UI.tab!=='fridge' || UI.ftab==='shop'){ UI.tab='fridge'; UI.ftab='fridge'; render(); }
  const area = $('#scanArea'), url = URL.createObjectURL(file);
  if (!area) return;
  area.innerHTML = `<div class="scan" style="margin-top:12px"><img src="${url}" alt="Dein Kühlschrank-Foto"></div><p class="muted" style="display:flex;gap:8px;align-items:center;justify-content:center"><span class="spin"></span> Zutaten werden erkannt …</p>`;
  $('#island').classList.add('wide'); const done = () => $('#island').classList.remove('wide');
  try {
    let image; try { image = await shrink(file); } catch(err){ throw { code:'failed', detail:'Bild konnte nicht gelesen werden (' + (file.type || 'unbekanntes Format') + ')' }; }
    const { data, error } = await sb.functions.invoke('scan-fridge', { body: { image, mediaType:'image/jpeg', keys: Object.keys(ING) } });
    if (error || !data) throw { code:'failed', detail: error && error.message };
    if (data.error) throw { code: data.error, detail: data.detail };
    const found = (data.items||[]).filter(k=>ING[k]), fresh = found.filter(k=>!D.fridge.includes(k));
    D.fridge = [...new Set([...D.fridge, ...found])]; saveFridgeSoon(); done();
    UI.justAdded = fresh; render();
    $('#scanArea').innerHTML = `<div class="card" style="margin-top:12px;background:var(--herb-soft)"><b>📸 ${plu(found.length,'Zutat','Zutaten')} erkannt</b><br><span class="muted" style="font-size:14px">${found.length?esc(found.map(ingName).join(', ')):'Leider nichts Eindeutiges. Versuch ein helleres Foto.'}</span></div>`;
    if (fresh.length) burstAt($('.photo-card')); buzz([20,40,20]);
  } catch(e){
    done(); const a = $('#scanArea');
    if (e && e.detail) console.warn('Foto-Erkennung:', e.detail);
    const msg = {
      limit: '😴 Die Foto-Erkennung macht für heute Pause. Morgen geht sie wieder. Tipp die Zutaten bis dahin einfach unten an.',
      nokey: 'Die Foto-Erkennung ist noch nicht eingerichtet. Tipp die Zutaten einfach unten an.',
      auth: 'Bitte melde dich neu an und versuch es dann noch mal.',
    }[e && e.code] || 'Die Erkennung hat gerade nicht geklappt. Probier es noch mal oder tippe die Zutaten unten an.';
    if (a) a.innerHTML = `<div class="card" style="margin-top:12px">${msg}${e && e.detail ? `<div class="muted" style="font-size:11px;margin-top:8px">Technik-Info: ${esc(String(e.detail).slice(0,160))}</div>` : ''}</div>`;
    // Fehler automatisch im Admin-Panel melden, damit er behoben werden kann
    if (!e || e.code !== 'limit'){ try { sb.from('feedback').insert({ user_id:D.user.id, kind:'fehler', message:'Automatisch: Foto-Erkennung fehlgeschlagen – ' + ((e && (e.code + ': ' + (e.detail || ''))) || String(e)).slice(0,400), app_version:VERSION }).then(()=>{}, ()=>{}); } catch(err){} }
  }
}
$('#photoInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value=''; if (f) handlePhoto(f); });
$('#expInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value=''; if (f) handleExpiryPhoto(f); });

/* ---------- Haltbarkeitsdatum per Foto ----------
   Die KI liest Datum und Produkt von der Verpackung. Danach kann man das Produkt
   korrigieren, und die App sagt, wo es hingehört (Kühlschrank oder Vorrat). */
const NOT_COLD = ['kartoffeln','zwiebeln','knoblauch','banane','suesskartoffel','kuerbis','brot','broetchen','tortillas'];
function storageOf(k){
  if (!ING[k]) return null;
  if (ING[k][2] === 'v') return ['🗄️', 'Vorrat', 'Gehört in den Vorratsschrank'];
  if (NOT_COLD.includes(k)) return ['🧺', 'Kühl & dunkel', 'Nicht in den Kühlschrank – kühl und dunkel lagern'];
  return ['🧊', 'Kühlschrank', 'Gehört in den Kühlschrank'];
}
const fmtDate = iso => { const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('de-DE', { day:'numeric', month:'long', year:'numeric' }); };
function guessKey(text){
  const q = String(text || '').toLowerCase(); if (!q) return null;
  return Object.keys(ING).find(k => q.includes(ING[k][0].toLowerCase())) || Object.keys(ING).find(k => ING[k][0].toLowerCase().includes(q.split(/\s+/)[0])) || null;
}
async function handleExpiryPhoto(file){
  sheetFn = null; const url = URL.createObjectURL(file);
  UI.expScan = { url, loading:true }; UI.expQ = '';
  openSheet(`${sheetHead('Haltbarkeit erkennen')}<div class="exp-photo"><img src="${url}" alt="Foto der Verpackung"><div class="exp-scanline"></div></div>
    <p class="muted" style="display:flex;gap:8px;align-items:center;justify-content:center;margin-top:14px"><span class="spin"></span> Datum und Produkt werden gelesen …</p>`);
  try {
    let image; try { image = await shrink(file); } catch(err){ throw { code:'failed', detail:'Bild konnte nicht gelesen werden' }; }
    const { data, error } = await sb.functions.invoke('scan-fridge', { body: { image, mediaType:'image/jpeg', keys:Object.keys(ING), mode:'expiry', today:isoDay(new Date()) } });
    if (error || !data) throw { code:'failed', detail: error && error.message };
    if (data.error) throw { code:data.error, detail:data.detail };
    const ex = data.expiry || {};
    const product = ex.product || guessKey(ex.label);
    UI.expScan = { url, date: ex.date, raw: ex.raw, label: ex.label, product, editing: !product };
    UI.expQ = product ? '' : (ex.label || '');
    buzz([15,30,15]); openExpScan();
  } catch(e){
    const msg = { limit:'😴 Die Foto-Erkennung macht für heute Pause. Trag das Datum bis morgen bitte von Hand ein.', auth:'Bitte melde dich neu an.' }[e && e.code] || 'Das hat nicht geklappt. Achte darauf, dass das Datum scharf und gut beleuchtet im Bild ist.';
    UI.expScan = { url, date:null, product:null, editing:true, failed:msg }; openExpScan();
  }
}
function openExpScan(keep){
  sheetFn = k => openExpScan(k);
  const x = UI.expScan || {}, k = x.product, st = storageOf(k), q = (UI.expQ || '').trim().toLowerCase();
  const left = x.date ? Math.round((new Date(x.date + 'T12:00:00') - new Date(isoDay(new Date()) + 'T12:00:00')) / 864e5) : null;
  const sugg = q ? Object.keys(ING).filter(key => ING[key][0].toLowerCase().includes(q)).slice(0, 8)
                 : Object.keys(ING).filter(key => D.fridge.includes(key) && !D.expiries[key]).slice(0, 8);
  openSheet(`${sheetHead('Haltbarkeit')}
    <div class="exp-photo sm"><img src="${esc(x.url||'')}" alt="Foto der Verpackung">${x.raw ? `<span class="exp-raw">📷 „${esc(x.raw)}"</span>` : ''}</div>
    ${x.failed ? `<div class="card" style="margin:12px 0;background:var(--yolk-soft)">${esc(x.failed)}</div>` : ''}
    <div class="h2">Was ist das?</div>
    ${k && !x.editing ? `<div class="exp-prod"><span class="exp-em">${ingEmoji(k)}</span><span class="grow"><b>${esc(ingName(k))}</b>${x.label && x.label.toLowerCase() !== ingName(k).toLowerCase() ? `<small>Auf der Packung: ${esc(x.label)}</small>` : ''}</span><button class="btn btn-ghost btn-sm" data-action="exp-edit">Ändern</button></div>
      <div class="exp-store"><span>${st[0]}</span><span><b>${st[1]}</b><small>${st[2]}${D.fridge.includes(k) ? '' : ' · wird beim Eintragen hinzugefügt'}</small></span></div>`
    : `<input id="expQ" class="input" aria-label="Produkt" placeholder="Produkt eingeben, z. B. Joghurt" value="${esc(UI.expQ||'')}" autocomplete="off">
      <div class="chips" style="margin-top:10px">${sugg.map(key => `<button class="ing" data-action="exp-pick" data-k="${key}" aria-pressed="${key===k}">${ING[key][1]} ${ING[key][0]}</button>`).join('') || `<span class="muted" style="font-size:13px">Nichts gefunden – versuch einen allgemeineren Begriff, z. B. „Käse" statt „Gouda".</span>`}</div>`}
    <div class="h2">Haltbar bis</div>
    <input id="expDate" class="input date" type="date" aria-label="Haltbar bis" value="${esc(x.date||'')}">
    ${left !== null ? `<div class="exp-left ${left < 0 ? 'bad' : left <= 2 ? 'warn' : ''}">${left < 0 ? `⚠️ Seit ${-left} ${-left===1?'Tag':'Tagen'} abgelaufen – lieber prüfen` : left === 0 ? '⏰ Läuft heute ab – heute verbrauchen!' : left === 1 ? '⏰ Läuft morgen ab' : `✓ Noch ${left} Tage haltbar · ${fmtDate(x.date)}`}</div>`
      : `<div class="exp-left warn">${x.loading ? '' : 'Kein Datum erkannt – bitte selbst eintragen.'}</div>`}
    <button class="btn btn-herb btn-block" style="margin-top:16px" data-action="exp-save" ${k ? '' : 'disabled'}>✓ Eintragen</button>
    <button class="btn btn-block" style="background:none;color:var(--muted);margin-top:4px" data-action="exp-photo">📷 Neues Foto</button>`, keep);
}
function saveExpScan(){
  const x = UI.expScan || {}, k = x.product, date = ($('#expDate') && $('#expDate').value) || x.date;
  if (!k){ toast('Bitte wähle zuerst, was es ist'); return; }
  if (!date){ toast('Bitte trag das Datum ein'); $('#expDate') && $('#expDate').focus(); return; }
  const added = !D.fridge.includes(k);
  if (added) D.fridge = [...D.fridge, k];
  D.expiries[k] = date; saveFridgeSoon();
  L.recentIng = [k, ...(L.recentIng||[]).filter(y => y !== k)].slice(0, 12); saveLocal();
  const st = storageOf(k);
  UI.expScan = null; closeSheet(); if (UI.tab === 'fridge') render(); else go('fridge');
  buzz([20,40,20]); toast(`${ingEmoji(k)} ${ingName(k)} bis ${fmtDate(date)} · ${st[1]}${added ? ' – hinzugefügt' : ''}`);
}

/* ---------- Effekte ---------- */
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function burstAt(el){ if(!el) return; const r=el.getBoundingClientRect(); burst(r.left+r.width/2, r.top+r.height/2); }
function burst(cx, cy){
  if (reduceMotion) return;
  const cv=$('#fx'), scr=$('#screen'), box=scr.getBoundingClientRect(), sc=box.width/scr.offsetWidth||1;
  cv.width=scr.offsetWidth; cv.height=scr.offsetHeight; const ctx=cv.getContext('2d');
  const x0=(cx-box.left)/sc, y0=(cy-box.top)/sc, food=['🍅','🥕','🧀','🥚','🌽','🍝','🥦','🍕'], colors=['#2F7A4C','#5CC98A','#D9482F','#E2A010','#FFFFFF'];
  const ps = Array.from({length:46},()=>({x:x0,y:y0,vx:(Math.random()-.5)*10,vy:-Math.random()*10-3,r:Math.random()*4+3,c:colors[Math.random()*colors.length|0],a:Math.random()*6,va:(Math.random()-.5)*.3,e:Math.random()<.3?food[Math.random()*food.length|0]:null}));
  const t0=performance.now();
  (function f(t){ const k=(t-t0)/1200; ctx.clearRect(0,0,cv.width,cv.height); if(k>=1) return; ctx.globalAlpha=1-k;
    ps.forEach(p=>{ p.vy+=.34; p.x+=p.vx; p.y+=p.vy; p.a+=p.va; ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.a);
      if(p.e){ ctx.font='22px sans-serif'; ctx.fillText(p.e,-11,8); } else { ctx.fillStyle=p.c; ctx.fillRect(-p.r,-p.r/2,p.r*2,p.r); } ctx.restore(); });
    requestAnimationFrame(f); })(t0);
}

/* Namen im Profil-Fenster übernehmen, auch wenn nur mit ✕ geschlossen wird */
function keepName(){ const i = $('#p-name'); if (!i) return; const n = i.value.trim().slice(0,30); if (n && n !== D.profile.name) updateProfile({ name:n });
  const st = $('#p-status'); if (st && hasExtras()){ const v = st.value.trim().slice(0,60); if (v !== (D.profile.status||'')) updateProfile({ status: v || null }); } }
/* Familie per Push informieren (Wunsch, Abstimmung, Beitritt) – Server prüft Einstellungen und Missbrauch */
function notifyFamily(type, ref, label){ try { sb.functions.invoke('send-push', { body:{ action:'event', type, ref: ref || '', label: label || '' } }).catch(()=>{}); } catch(e){} }

/* ---------- Ereignisse ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-tab],[data-action]'); if (!t) return;
  if (t.dataset.tab){ go(t.dataset.tab); return; }
  const a = t.dataset.action, id = t.dataset.id;
  try { switch(a){
    case 'close': keepName(); closeSheet(); render(); break;
    case 'retry': t.disabled = true; try { await loadAll(true); subscribe(); UI.err = ''; } catch(err){ toast('Noch keine Verbindung'); offlineRetry(); } t.disabled = false; render(); break;
    case 'auth-mode': UI.auth=t.dataset.v; UI.err=''; render(); break;
    case 'pick-av': L.av=t.dataset.v; saveLocal(); document.querySelectorAll('[data-action=pick-av]').forEach(b=>b.setAttribute('aria-pressed', b.dataset.v===L.av)); buzz(6); break;
    case 'logout': if (!UI.confirmLogout && D.profile && !D.profile.banned){ UI.confirmLogout = true; render(); setTimeout(() => { if (UI.confirmLogout){ UI.confirmLogout = false; render(); } }, 5000); break; }
      UI.confirmLogout = false; UI.auth='login'; UI.err=''; await pushOff(true); await sb.auth.signOut(); UI.tab='home'; break;
    case 'join': { const c=$('#join-code').value.trim(); if(!c){ UI.err='Bitte gib den Familien-Code ein.'; render(); break; }
      UI.err=''; t.disabled=true; const { error } = await sb.rpc('request_join', { join_code:c }); if (error){ t.disabled=false; throw error; }
      L.joinCode=''; saveLocal(); await loadAll(true); subscribe(); render(); toast('Anfrage gesendet'); buzz(20); notifyFamily('join'); break; }
    case 'create-family': { const n=$('#fam-name').value.trim(); if(!n){ UI.err='Bitte gib einen Namen für die Familie ein.'; render(); break; }
      UI.err=''; t.disabled=true; const { error } = await sb.rpc('create_family', { fam_name:n }); if (error) throw error;
      await loadAll(true); subscribe(); render(); burstAt($('.pick')||$('.h1')); toast('Familie gegründet 🎉'); break; }
    case 'accept': { t.disabled = true; await save(() => sb.from('memberships').update({ status:'active' }).eq('family_id', D.family.id).eq('user_id', id)); notifyFamily('accept', id);
      burstAt(t); buzz(30); toast(`${prof(id).name} ist jetzt in der Familie 🎉`); await loadAll(true); render(); break; }
    case 'decline': { const { error } = await sb.from('memberships').delete().eq('family_id', D.family.id).eq('user_id', id); if (error) throw error;
      toast(`Anfrage von ${prof(id).name} abgelehnt`); await loadAll(true); render(); break; }
    case 'ask-leave': UI.confirmLeave=true; render(); break;
    case 'cancel-leave': UI.confirmLeave=false; render(); break;
    case 'leave': { const { error } = await sb.from('memberships').delete().eq('family_id', D.membership.family_id).eq('user_id', D.user.id); if (error) throw error;
      UI.confirmLeave=false; UI.tab='home'; await loadAll(true); subscribe(); render(); break; }
    case 'invite': openInvite(); break;
    case 'copy': try { await navigator.clipboard.writeText(t.dataset.text); toast('Kopiert'); } catch(err){ toast(t.dataset.text); } break;
    case 'share-link': if (navigator.share){ navigator.share({ title:"Was gibt's?", text:'Komm in unsere Familie bei „Was gibt\'s?"', url:t.dataset.text }).catch(()=>{}); }
      else { try { await navigator.clipboard.writeText(t.dataset.text); toast('Link kopiert'); } catch(err){ toast(t.dataset.text); } } break;
    case 'eater': { let e2 = eatersNow(); e2 = e2.includes(id) ? e2.filter(x=>x!==id) : [...e2,id]; if(!e2.length){ toast('Mindestens eine Person muss mitessen'); break; } L.eaters=e2; saveLocal(); buzz(6); render(); break; }
    case 'time': UI.time=+t.dataset.v; buzz(6); render(); break;
    case 'mood': UI.mood=t.dataset.v; buzz(6); render(); break;
    case 'open-recipe': openRecipe(id); break;
    case 'wish': { const mine = D.wishes.find(w=>w.recipe_id===id && w.user_id===D.user.id);
      if (mine){ D.wishes = D.wishes.filter(w=>w!==mine); openRecipe(id, true); render(); toast('Wunsch zurückgenommen');
        try { await save(() => String(mine.id).startsWith('tmp') ? null : sb.from('wishes').delete().eq('id', mine.id)); } catch(err){ D.wishes.push(mine); openRecipe(id, true); render(); throw err; } }
      else { burstAt(t); buzz(25); const tmp = { id:'tmp'+Date.now(), family_id:D.family.id, user_id:D.user.id, recipe_id:id }; D.wishes.push(tmp); openRecipe(id, true); render(); toast('Gewünscht! Die Familie sieht es jetzt.');
        try { await save(async () => { const r = await sb.from('wishes').insert({ family_id:D.family.id, user_id:D.user.id, recipe_id:id }).select().single(); if (r.data) Object.assign(tmp, r.data); return r; }); notifyFamily('wish', id, rec(id) && rec(id).n); }
        catch(err){ D.wishes = D.wishes.filter(w => w !== tmp); openRecipe(id, true); render(); throw err; } } break; }
    case 'fav': { const f = new Set(D.profile.favs||[]); f.has(id) ? f.delete(id) : (f.add(id), buzz(20)); updateProfile({ favs:[...f] }); openRecipe(id, true); render(); break; }
    case 'cooked': { if (UI.cookedBusy) break; UI.cookedBusy = true; setTimeout(() => UI.cookedBusy = false, 2500); const r=rec(id); burstAt(t); buzz([20,50,20]); D.wishes = D.wishes.filter(w=>w.recipe_id!==id);
      L.cookedCount = (L.cookedCount||0) + 1; saveLocal();
      const logP = logCooked(r);
      setTimeout(()=>{ closeSheet(); render(); logP.then(log => { if (log) setTimeout(() => openRate(log.id), 500); }); }, 450); toast(`Guten Appetit! ${r.e}`);
      await save(() => sb.from('wishes').delete().eq('family_id', D.family.id).eq('recipe_id', id)); break; }
    case 'ing': { const k=t.dataset.k; D.fridge = D.fridge.includes(k) ? D.fridge.filter(x=>x!==k) : [...D.fridge,k]; saveFridgeSoon(); buzz(6);
      L.recentIng = [k, ...(L.recentIng||[]).filter(x => x !== k)].slice(0, 12); saveLocal();
      t.setAttribute('aria-pressed', D.fridge.includes(k)); t.classList.remove('just'); void t.offsetWidth; if (D.fridge.includes(k)) t.classList.add('just');
      render(); break; }
    case 'clear-fridge': { const was = [...D.fridge], wasExp = { ...D.expiries }; D.fridge=[]; D.expiries={}; saveFridgeSoon(); render(); buzz(8);
      undoToast('Kühlschrank geleert', () => { D.fridge = was; D.expiries = wasExp; saveFridgeSoon(); render(); }); break; }
    case 'photo': {
      const today = isoDay(new Date());
      if (L.scanDay !== today){ L.scanDay = today; L.scanN = 0; }
      const needAd = !plusActive() && (L.scanN || 0) >= 1 && !(L.scanAdOk && Date.now() - L.scanAdOk < 10 * 60e3);
      if (needAd){ openAd('scan'); break; }
      L.scanN = (L.scanN || 0) + 1; if (L.scanAdOk) L.scanAdOk = 0; saveLocal();
      $('#photoInput').click(); break; }
    case 'exp-photo': $('#expInput').click(); break;
    case 'exp-pick': UI.expScan.product = t.dataset.k; UI.expScan.editing = false; UI.expQ = ''; buzz(8); openExpScan(true); break;
    case 'exp-edit': UI.expScan.editing = true; UI.expQ = UI.expScan.label || ''; openExpScan(true); setTimeout(() => { const i = $('#expQ'); if (i){ i.focus(); i.select(); } }, 50); break;
    case 'exp-save': saveExpScan(); break;
    case 'rtab': UI.rtab=t.dataset.v; UI.rlimit=30; buzz(6); render(); break;
    case 'profile': openProfile(id); break;
    case 'av-photo': pickAvatarPhoto(); break;
    case 'set-pc': if (!hasExtras()) break; document.querySelectorAll('[data-action=set-pc]').forEach(b=>b.setAttribute('aria-pressed', b===t)); buzz(6); updateProfile({ color: t.dataset.v || null }); refreshPfBig(); render(); break;
    case 'edit-prefs': if (id===D.user.id) openPrefs(); else toast(`Nur ${prof(id).name} kann das eigene Profil ändern`); break;
    case 'set-av': { const wasPhoto = isPhoto(D.profile.avatar); document.querySelectorAll('[data-action=set-av]').forEach(b=>b.setAttribute('aria-pressed', b===t)); buzz(6); updateProfile({ avatar:t.dataset.v }); if (wasPhoto){ keepName(); openPrefs(true); } else refreshPfBig(); render(); break; }
    case 'veg': updateProfile({ veg: !D.profile.veg }); t.setAttribute('aria-checked', D.profile.veg); buzz(); render(); break;
    case 'picky': { keepName(); buzz(); updateProfile({ picky: !D.profile.picky }); openPrefs(true); render(); break; }
    case 'like': { const k=t.dataset.k, s=new Set(D.profile.likes||[]); s.has(k)?s.delete(k):s.add(k); updateProfile({ likes:[...s] }); t.setAttribute('aria-pressed', s.has(k)); const c=$('[data-count=likes]'); if (c) c.textContent = s.size+' gewählt'; buzz(6); break; }
    case 'dis': { const k=t.dataset.k, s=new Set(D.profile.dislikes||[]); s.has(k)?s.delete(k):s.add(k); updateProfile({ dislikes:[...s] }); t.setAttribute('aria-pressed', s.has(k)); buzz(6); break; }
    case 'alg': { const k=t.dataset.k, s=new Set(D.profile.allergies||[]); s.has(k)?s.delete(k):s.add(k); updateProfile({ allergies:[...s] }); t.setAttribute('aria-pressed', s.has(k)); buzz(6); break; }
    case 'save-prefs': { keepName(); await flushProfile(); closeSheet(); render(); toast('Gespeichert ✓'); break; }
    case 'changelog': L.seenVersion = VERSION; saveLocal();
      openSheet(`${sheetHead('Update-Log')}<div class="card" style="padding:4px 16px">${CHANGELOG.map((c,n)=>`<div class="log"><span class="v">${c.v}</span><div><b>${n===0?'<span class="new-badge">NEU</span> ':''}${c.d}</b><ul>${c.items.map(i=>`<li>${esc(i)}</li>`).join('')}</ul></div></div>`).join('')}</div>`);
      $('[data-action=changelog] .new-badge')?.remove(); break;
    case 'plus': openPlus(false); break;
    case 'sponsor': openSponsor(); break;
    case 'sponsor-shop': window.open(SPONSOR.url, '_blank', 'noopener'); break;
    case 'ad': openAd('plus'); break;
    case 'ad-watch': openAd('watch'); break;
    case 'ad-sound': { const v = $('#adv'); if (v){ v.muted = !v.muted; t.textContent = v.muted ? '🔇' : '🔊'; t.setAttribute('aria-label', v.muted ? 'Ton an' : 'Ton aus'); } break; }
    case 'ad-photo': closeAd(); $('#photoInput').click(); break;
    case 'ad-close': closeAd(); break;
    case 'accent': if (!plusActive()){ openPlus(false); break; } L.accent = t.dataset.v; saveLocal(); applyAccent(); render(); buzz(8); break;
    case 'plus-hide': L.plusHideUntil = Date.now() + 2*DAY; saveLocal(); render(); toast('Plus-Hinweise für 2 Tage ausgeblendet'); break;
    case 'plus-interest': { L.plusInterest = true; saveLocal(); openPlus(false); buzz(20);
      try { await sb.from('feedback').insert({ user_id:D.user.id, kind:'plus', message:'Interesse an Was gibt\'s? Plus', app_version:VERSION }); } catch(err){} break; }
    case 'new-poll': openPollSetup(); break;
    case 'poll-pick': { const on = t.getAttribute('aria-pressed') !== 'true'; if (on && document.querySelectorAll('.pick-opt[aria-pressed=true]').length >= 4){ toast('Höchstens 4 Gerichte'); break; } t.setAttribute('aria-pressed', on); buzz(6); break; }
    case 'start-poll': { const ids = [...document.querySelectorAll('.pick-opt[aria-pressed=true]')].map(b => b.dataset.id);
      if (ids.length < 2){ toast('Bitte mindestens 2 Gerichte wählen'); break; }
      if (D.poll && D.poll.status === 'open' && (D.poll.created_by === D.user.id || isAdmin())) await sb.from('polls').update({ status:'closed' }).eq('id', D.poll.id);
      const endMin = +(UI.pollEnd || '60'), prow = { family_id:D.family.id, created_by:D.user.id, options:ids, status:'open' }; if (endMin && D.cap.plan3) prow.ends_at = new Date(Date.now() + endMin*60e3).toISOString();
      t.disabled = true; let res; try { res = await save(() => sb.from('polls').insert(prow).select().single()); } catch(err){ t.disabled = false; throw err; }
      D.poll = res.data; D.votes = []; closeSheet(); render(); buzz(25); toast('Abstimmung gestartet 🗳️'); notifyFamily('poll'); break; }
    case 'vote': { if (!D.poll || D.poll.status !== 'open') break;
      D.votes = D.votes.filter(v => v.user_id !== D.user.id).concat({ poll_id:D.poll.id, family_id:D.family.id, user_id:D.user.id, recipe_id:id });
      buzz(15); render();
      await save(() => sb.from('votes').upsert({ poll_id:D.poll.id, family_id:D.family.id, user_id:D.user.id, recipe_id:id }, { onConflict:'poll_id,user_id' })); break; }
    case 'end-poll': { const counts = {}; D.votes.forEach(v => counts[v.recipe_id] = (counts[v.recipe_id]||0) + 1);
      const winner = D.poll.options.slice().sort((a,b) => (counts[b]||0) - (counts[a]||0))[0];
      await save(() => sb.from('polls').update({ status:'closed', winner }).eq('id', D.poll.id));
      D.poll.status = 'closed'; D.poll.winner = winner; render(); burstAt($('.poll-win')); buzz([30,60,30]); toast(`🏆 Gewonnen: ${rec(winner).n}`); break; }
    case 'expiry': openExpiry(); break;
    case 'save-expiry': { document.querySelectorAll('input.date').forEach(inp => { const k = inp.id.slice(4); if (inp.value) D.expiries[k] = inp.value; else delete D.expiries[k]; });
      closeSheet(); render(); saveFridgeSoon(); toast('Haltbarkeit gespeichert'); break; }
    case 'new-recipe': openRecipeForm(); break;
    case 'r-emoji': case 'r-mood': case 'fb-kind': document.querySelectorAll(`[data-action=${a}]`).forEach(b => b.setAttribute('aria-pressed', b===t)); buzz(6); break;
    case 'r-ing': case 'r-trait': t.setAttribute('aria-pressed', t.getAttribute('aria-pressed') !== 'true'); buzz(6); break;
    case 'save-recipe': { const name = $('#r-name').value.trim(), steps = $('#r-steps').value.split('\n').map(x => x.trim()).filter(Boolean);
      const ings = [...document.querySelectorAll('[data-action=r-ing][aria-pressed=true]')].map(b => b.dataset.k);
      if (!name){ toast('Bitte gib dem Rezept einen Namen'); $('#r-name').focus(); break; }
      if (!ings.length){ toast('Bitte wähle mindestens eine Hauptzutat'); break; }
      if (!steps.length){ toast('Bitte beschreib die Zubereitung'); $('#r-steps').focus(); break; }
      const row = { family_id:D.family.id, created_by:D.user.id, name, emoji:$('[data-action=r-emoji][aria-pressed=true]')?.dataset.v || '🍽️', minutes:+$('#r-time').value,
        mood:$('[data-action=r-mood][aria-pressed=true]')?.dataset.v || 'normal', ingredients:ings, optional:[], traits:[...document.querySelectorAll('[data-action=r-trait][aria-pressed=true]')].map(b => b.dataset.k), steps };
      t.disabled = true; try { await save(() => sb.from('custom_recipes').insert(row).select().single()); } catch(err){ t.disabled = false; throw err; }
      await loadAll(true); closeSheet(); UI.rtab = 'fam'; render(); burstAt($('.rc')); toast('Rezept gespeichert 📖'); break; }
    case 'ask-del': UI.confirmDel = id; openRecipe(id, true); break;
    case 'cancel-del': UI.confirmDel = null; openRecipe(id, true); break;
    case 'del-recipe': { const r = rec(id); const { error } = await sb.from('custom_recipes').delete().eq('id', r.dbid); if (error) throw error;
      UI.confirmDel = null; await loadAll(true); closeSheet(); render(); toast('Rezept gelöscht'); break; }
    case 'feedback': openFeedback(); break;
    case 'send-feedback': { const msg = $('#fb-text').value.trim(); if (!msg){ toast('Bitte schreib kurz etwas'); $('#fb-text').focus(); break; }
      t.disabled = true; const { error } = await sb.from('feedback').insert({ user_id:D.user.id, kind:$('[data-action=fb-kind][aria-pressed=true]')?.dataset.v || 'idee', message:msg, app_version:VERSION });
      if (error){ t.disabled = false; throw error; } closeSheet(); toast('Danke für dein Feedback! 💚'); break; }
    case 'cook': openPrep(id); break;
    case 'prep-tick': prepTick(t); break;
    case 'prep-go': closeSheet(); openCook(id); break;
    case 'shop-edit': openShopEdit(id); break;
    case 'se-list': UI.seList = t.dataset.v; document.querySelectorAll('[data-action=se-list]').forEach(b => b.setAttribute('aria-pressed', b === t)); buzz(6); break;
    case 'se-who': UI.seWho = UI.seWho === id ? null : id; document.querySelectorAll('[data-action=se-who]').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === UI.seWho)); buzz(6); break;
    case 'se-save': await saveShopEdit(id); break;
    case 'shop-voice': shopVoice(); break;
    case 'slist': UI.slist = t.dataset.v || ''; buzz(6); render(); break;
    case 'coll-pick': openCollPick(id); break;
    case 'coll-toggle': await collToggle(id, t.dataset.v); break;
    case 'coll-new': t.disabled = true; try { await collNew(t.dataset.v); } finally { t.disabled = false; } break;
    case 'coll-open': UI.coll = id; UI.rtab = 'favs'; render(); break;
    case 'coll-close': UI.coll = null; render(); break;
    case 'note-del': { const n = D.notes.find(x => x.id === id); D.notes = D.notes.filter(x => x.id !== id); refreshSheet(); if (n && !String(id).startsWith('tmp')) await save(() => sb.from('recipe_notes').delete().eq('id', id)); break; }
    case 'board-del': { D.board = D.board.filter(x => x.id !== id); render(); if (!String(id).startsWith('tmp')) await save(() => sb.from('board_posts').delete().eq('id', id)); break; }
    case 'poll-end-pick': UI.pollEnd = t.dataset.v; document.querySelectorAll('[data-action=poll-end-pick]').forEach(b => b.setAttribute('aria-pressed', b === t)); buzz(6); break;
    case 'party': UI.partyQ = ''; openParty(); break;
    case 'party-g': UI.party.guests = Math.max(2, Math.min(60, UI.party.guests + (+t.dataset.v))); buzz(6); refreshSheet(); break;
    case 'party-add': if (UI.party.ids.length >= 4){ toast('Höchstens 4 Gerichte'); break; } UI.party.ids.push(id); UI.partyQ = ''; buzz(8); refreshSheet(); break;
    case 'party-rm': UI.party.ids = UI.party.ids.filter(x => x !== id); refreshSheet(); break;
    case 'party-go': { const d = $('#partyDay'); if (d) UI.party.day = d.value; t.disabled = true; await partyGo(); break; }
    case 'plan-repeat': t.disabled = true; await planRepeat(); t.disabled = false; break;
    case 'plan-image': await planImage(); break;
    case 'reste-on': UI.reste = true; UI.rtab = 'all'; UI.q = ''; UI.rlimit = 30; go('recipes'); break;
    case 'reste': UI.reste = !UI.reste; UI.rtab = 'all'; UI.q = ''; UI.rlimit = 30; if (UI.tab !== 'recipes') go('recipes'); else render(); buzz(6); break;
    case 'cook-next': if (!UI.cook || !UI.cook.steps) break; UI.cook.step++; UI.cook.dir = 1; buzz(8); renderCook(); break;
    case 'cook-prev': if (!UI.cook || !UI.cook.steps) break; UI.cook.step = Math.max(0, UI.cook.step - 1); UI.cook.dir = -1; buzz(8); renderCook(); break;
    case 'cook-force': UI.cookForce = true; $('.cook').classList.add('force'); break;
    case 'cook-close': closeCook(); render(); break;
    case 'cook-done': { const cid = UI.cook.id; closeCook(); render(); openRecipe(cid); setTimeout(() => { const b = $('[data-action=cooked]'); if (b) b.click(); }, 350); break; }
    case 'timer': startTimer(+t.dataset.v); break;
    case 'cook-voice': UI.voice ? stopVoice() : startVoice(); break;
    case 'cook-read': L.readAloud = !L.readAloud; saveLocal(); updVoice(); if (L.readAloud) speakStep(); else try { speechSynthesis.cancel(); } catch(e){} toast(L.readAloud ? '🔊 Schritte werden vorgelesen' : 'Vorlesen aus'); break;
    case 'legal': { const [title, html] = LEGAL[t.dataset.v]; sheetFn = null; openSheet(`${sheetHead(title)}<div class="legal">${html}</div>`); break; }
    case 'theme': L.theme=t.dataset.v; saveLocal(); render(); break;
    case 'install': UI.instOs = null; openInstall(); break;
    case 'pp-open': openPushPrompt(); break;
    case 'pp-later': closeSheet(); render(); break;
    case 'pp-on': { t.disabled = true; const r = await pushOn(); closeSheet(); render(); toast(r === true ? 'Benachrichtigungen an 🔔 – danke!' : r); break; }
    case 'inst-os': UI.instOs = t.dataset.v === deviceInfo().os ? null : t.dataset.v; openInstall(true); break;
    case 'inst-hide': L.instHide = Date.now() + 3*864e5; saveLocal(); render(); break;
    case 'inst-now': if (installEvt){ const ev = installEvt; ev.prompt(); ev.userChoice.then(c => { if (c && c.outcome === 'accepted'){ installEvt = null; refreshSheet(); } }).catch(()=>{}); } break;
    case 'inst-copy': { const u = location.origin + location.pathname; (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => toast('Link kopiert – jetzt im Browser einfügen'), () => toast(u)); break; }
    case 'season': L.season = L.season === false ? true : !seasonNow() ? true : false; saveLocal(); applyTheme(); render(); break;
    case 'hw-card-off': L.hwCardOff = new Date().getFullYear(); saveLocal(); render(); break;
    case 'hw-recipes': UI.rtab = 'all'; UI.q = 'Kürbis'; UI.rlimit = 30; go('recipes'); break;
    case 'push': { if (UI.push === 'on'){ await pushOff(); toast('Benachrichtigungen aus'); }
      else if (UI.push === 'off'){ t.disabled = true; const r = await pushOn(); toast(r === true ? 'Benachrichtigungen an 🔔' : r); }
      else if (UI.push === 'install') openPushHelp();
      else if (UI.push === 'denied') toast('Bitte erlaube Benachrichtigungen in den Einstellungen deines Handys');
      render(); break; }
    case 'ftab': UI.ftab = t.dataset.v; buzz(6); render(); $('#views .view').scrollTop = 0; break;
    case 'fonly': UI.fonly = t.dataset.v; buzz(6); render(); break;
    case 'shop-toggle': toggleShop(id); buzz(8); render(); break;
    case 'shop-del': { const it = D.shop.find(x => x.id === id); if (!it) break; removeShop([it]); render(); buzz(8);
      undoToast(`„${it.ing_key ? ingName(it.ing_key) : it.label}" entfernt`, () => restoreShop([it])); break; }
    case 'shop-clear': { const gone = D.shop.filter(x => x.checked); removeShop(gone); render(); buzz(8); undoToast(`${gone.length === 1 ? '1 Eintrag' : gone.length + ' Einträge'} gelöscht`, () => restoreShop(gone)); break; }
    case 'shop-ing': { const k = t.dataset.k; if (onList(k)){ toast('Steht schon drauf'); break; } UI.sq = ''; await addToList([k]); buzz(10); toast(`${ingName(k)} auf der Liste ✓`); break; }
    case 'shop-free': { const v = t.dataset.v; UI.fq = ''; await addToList([], v); UI.ftab = 'shop'; render(); toast('Auf der Liste ✓'); break; }
    case 'shop-plan': { const n = await addToList(plannedMissing()); toast(`${plu(n,'Zutat','Zutaten')} für den Wochenplan auf der Liste ✓`); buzz(15); break; }
    case 'shop-missing': { const r = rec(id); const miss = r.i.filter(k => !D.fridge.includes(k)); const n = await addToList(miss); burstAt(t); buzz(15); toast(n ? `${n} ${n===1?'Zutat':'Zutaten'} auf der Einkaufsliste 🛒` : 'Steht schon alles drauf'); break; }
    case 'plan-day': UI.pq = ''; openPlanDay(t.dataset.v, false, t.dataset.slot || 'abend'); break;
    case 'plan-slot': UI.pq = ''; openPlanDay(t.dataset.v, true, t.dataset.slot); buzz(6); break;
    case 'plan-cook': await setPlanCook(t.dataset.v, t.dataset.slot, id); buzz(8); refreshSheet(); break;
    case 'plan-out': { const v = ($('#outIn')?.value || '').trim() || 'Auswärts essen'; await setPlan(t.dataset.v, '__out', t.dataset.slot || 'abend', { label: v.slice(0,40) }); closeSheet(); render(); toast('🍕 Eingetragen'); break; }
    case 'plan-set': { const iso = t.dataset.v; await setPlan(iso, id, t.dataset.slot || 'abend'); closeSheet(); render(); buzz(15); toast(`📅 ${rec(id).n} eingeplant`); break; }
    case 'plan-clear': { const iso = t.dataset.v, sl = t.dataset.slot || 'abend', old = planFor(iso, sl) ? { ...planFor(iso, sl) } : null;
      await clearPlan(iso, sl); closeSheet(); render(); buzz(8);
      if (old) undoToast('Aus dem Plan genommen', () => setPlan(iso, old.recipe_id, sl, { label: old.label || null, cook: old.cook || null }).catch(e => toast(errText(e))));
      else toast('Aus dem Plan genommen'); break; }
    case 'plan-fill': { t.disabled = true; const n = await fillWeek(); burstAt(t); buzz([20,40,20]); toast(n ? `✨ ${n} ${n===1?'Tag':'Tage'} geplant` : 'Keine passenden Gerichte gefunden'); break; }
    case 'plan-this': openPlanFor(id); break;
    case 'more-recipes': UI.rlimit = (UI.rlimit || 30) + 30; render(); break;
    case 'ann-hide': L.annHidden = D.ann && D.ann.id; saveLocal(); render(); break;
  } } catch(err){ toast(errText(err)); if (t) t.disabled = false; render(); }
});

/* Kochmodus mit Pfeiltasten steuern (Computer) */
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !UI.cook && $('.sheet')){ closeSheet(); render(); return; }
  if (!UI.cook) return;
  if (e.key === 'ArrowRight'){ const b = $('[data-action=cook-next]') || $('[data-action=cook-done]'); b && b.click(); }
  if (e.key === 'ArrowLeft'){ const b = $('[data-action=cook-prev]'); b && !b.disabled && b.click(); }
  if (e.key === 'Escape'){ closeCook(); render(); } });

/* Wischen zwischen den Tabs */
let tx=0, ty=0;
$('#views').addEventListener('touchstart', e=>{ tx=e.touches[0].clientX; ty=e.touches[0].clientY; }, {passive:true});
$('#overlay').addEventListener('touchstart', e=>{ tx=e.touches[0].clientX; ty=e.touches[0].clientY; }, {passive:true});
$('#overlay').addEventListener('touchend', e=>{ if (!UI.cook) return; const dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty;
  if (Math.abs(dx)>70 && Math.abs(dx)>Math.abs(dy)*1.6){ const r = rec(UI.cook.id); const k = UI.cook.step + (dx<0?1:-1); if (UI.cook.steps && k>=0 && k<UI.cook.steps.length){ UI.cook.dir = dx<0?1:-1; UI.cook.step=k; buzz(8); renderCook(); } } }, {passive:true});
$('#views').addEventListener('touchend', e=>{ if(!D.user || !isActive()) return;
  const dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty;
  if (Math.abs(dx)>70 && Math.abs(dx)>Math.abs(dy)*1.6){ const k=ORDER.indexOf(UI.tab)+(dx<0?1:-1); if(k>=0&&k<ORDER.length) go(ORDER[k]); } }, {passive:true});

/* ---------- Farbschema ---------- */
function applyTheme(){ const r=document.documentElement, th=L.theme||'system'; if(th==='system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', th);
  r.classList.toggle('halloween', hwOn()); r.classList.toggle('advent', adOn());
  /* Oberer Rand (Statusleiste / Safari-Leiste) in derselben Farbe wie die App */
  const bg = UI.cook ? '#0f1d14' : getComputedStyle(r).getPropertyValue('--bg').trim();
  if (bg && applyTheme.last !== bg){ applyTheme.last = bg; try { lastTop = ''; syncTopColor(); } catch(e){} } }
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());

/* ---------- Geräte-Modus: iPhone-Simulator am Computer ---------- */
const mq = window.matchMedia('(min-width: 820px) and (pointer: fine)');
function layout(){
  const framed = mq.matches; document.documentElement.classList.toggle('framed', framed);
  const w=$('#phoneWrap'), p=$('#phone');
  const land = document.documentElement.classList.contains('cooking'), W = land ? 874 : 420, H = land ? 420 : 874;
  if (framed){ const s=Math.min(1,(window.innerHeight-40)/H,(window.innerWidth-40)/W); w.style.width=(W*s)+'px'; w.style.height=(H*s)+'px'; p.style.transform=`scale(${s})`; }
  else { w.style.width=''; w.style.height=''; p.style.transform=''; }
}
try { mq.addEventListener('change', layout); } catch(e){ mq.addListener && mq.addListener(layout); }
window.addEventListener('resize', layout);
const tickClock = () => { const d=new Date(); $('#clock').textContent=d.getHours()+':'+String(d.getMinutes()).padStart(2,'0'); };
setInterval(tickClock, 1000); tickClock();


/* ---------- Schnittstelle für das iPhone am Computer (emu.js) ---------- */
window.__wgEmu = () => {
  if (!D.user) return { user:false };
  const out = { user:true, name: D.profile && D.profile.name, shop: D.family ? openShop().length : 0 };
  try {
    if (D.family){ const p = planFor(isoDay(new Date())), r = p && rec(p.recipe_id); if (r) out.planned = r.n;
      const top = suggest().find(s => s.missing.length === 0 && s.r.meal !== 'suess'); if (top) out.pick = top.r.n;
      out.wishes = D.wishes.filter(w => w.user_id !== D.user.id).slice(-2).reverse().map(w => ({ name: prof(w.user_id).name, dish: (rec(w.recipe_id) || {}).n || 'etwas' }));
      const ex = expiringSoon(); if (ex.length) out.expiring = ex.map(x => `${ingName(x.k)} (${expLabel(x.d)})`).join(', '); }
  } catch(e){}
  return out;
};
window.__wgGo = tab => { if (D.user && D.family && ORDER.includes(tab)){ closeSheet(); go(tab); } };
window.__wgCloseSheet = () => { closeSheet(); render(); };
window.__wgTheme = th => { L.theme = th; saveLocal(); render(); };

/* --- Offline: letzter Stand bleibt sichtbar, automatisch neu verbinden --- */
const CACHE_KEYS = ['profile','membership','family','members','profiles','wishes','fridge','expiries','custom','poll','votes','shop','plan','log','ratings','notes','board','colls','cap','ann','appAdmin'];
function saveCache(){ try { if (!D.user || !D.profile) return; const c = { uid: D.user.id, at: Date.now() }; CACHE_KEYS.forEach(k => c[k] = D[k]); localStorage.setItem('wg.cache', JSON.stringify(c)); } catch(e){} }
function useCache(){ try { const c = JSON.parse(localStorage.getItem('wg.cache') || 'null'); if (!c || !D.user || c.uid !== D.user.id || !c.profile) return false;
  CACHE_KEYS.forEach(k => { if (c[k] !== undefined) D[k] = c[k]; }); UI.offline = c.at || Date.now(); return true; } catch(e){ return false; } }
let offT = null;
function offlineRetry(){ clearTimeout(offT); if (!D.user) return; offT = setTimeout(async () => { if (!UI.offline && D.profile) return;
  try { await loadAll(true); subscribe(); UI.err = ''; render(); } catch(e){ offlineRetry(); } }, navigator.onLine === false ? 30000 : 12000); }
window.addEventListener('online', () => { if (UI.offline || !D.profile){ clearTimeout(offT); offT = setTimeout(() => { offlineRetry(); }, 0); loadAll(true).then(() => { subscribe(); UI.err = ''; render(); }).catch(() => {}); } });
function offlineBar(){ if (!UI.offline) return ''; const m = Math.round((Date.now() - UI.offline) / 60000);
  return `<div class="offline-bar">📴 <b>Offline</b> – du siehst den Stand von ${m < 1 ? 'gerade eben' : m < 60 ? `vor ${m} Min.` : new Date(UI.offline).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}) + ' Uhr'}. Änderungen gehen wieder, sobald du Internet hast.</div>`; }

/* =========================================================================
   VERSION 4.0 – das große Update
   ========================================================================= */
/* --- Einkaufsliste: Menge/Notiz, Liste, wer bringt's mit --- */
function openShopEdit(id){
  const x = D.shop.find(i => i.id === id); if (!x) return;
  sheetFn = null;
  openSheet(`${sheetHead(shopName(x))}
    ${D.cap.shop3 ? `<div class="field"><label for="se-note">Menge / Notiz</label><input id="se-note" class="input" maxlength="40" placeholder="z. B. 2 Packungen, bio, 1 kg" value="${esc(x.note||'')}"></div>
    <div class="field"><span class="lbl2">Auf welche Liste?</span><div class="seg" role="group">${SLISTS.map(([k,l,e]) => `<button data-action="se-list" data-v="${k}" aria-pressed="${(x.list||'super')===k}">${e} ${l}</button>`).join('')}</div></div>
    <div class="field"><span class="lbl2">Wer bringt es mit?</span><div class="chips">${active().map(m => { const a = prof(m.user_id); return `<button class="ing" data-action="se-who" data-id="${a.id}" aria-pressed="${x.assigned_to===a.id}">${a.id===D.user.id?'Ich':esc(a.name)}</button>`; }).join('')}</div></div>
    <button class="btn btn-herb btn-block" style="margin-top:8px" data-action="se-save" data-id="${x.id}">Speichern</button>`
    : `<div class="card empty"><b>Gleich verfügbar</b>Mengen, Listen und „Wer bringt's mit" werden gerade freigeschaltet.</div>`}
    <button class="btn btn-block" style="background:none;color:var(--tomato);margin-top:6px" data-action="shop-del" data-id="${x.id}">Von der Liste nehmen</button>`);
  UI.seList = x.list || 'super'; UI.seWho = x.assigned_to || null;
}
async function saveShopEdit(id){
  const x = D.shop.find(i => i.id === id); if (!x) return;
  const patch = { note: ($('#se-note')?.value || '').trim().slice(0,40) || null, list: UI.seList || 'super', assigned_to: UI.seWho || null };
  Object.assign(x, patch); closeSheet(); render();
  if (!String(id).startsWith('tmp')) await save(() => sb.from('shopping_items').update(patch).eq('id', id));
  toast('Gespeichert ✓');
}
/* --- Per Sprache hinzufügen --- */
const SPR = window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceOK = () => !!SPR;
let shopRec = null;
function shopVoice(){
  if (!SPR){ toast('Spracheingabe geht auf diesem Gerät leider nicht'); return; }
  if (shopRec){ try { shopRec.stop(); } catch(e){} return; }
  shopRec = new SPR(); shopRec.lang = 'de-DE'; shopRec.interimResults = false; shopRec.maxAlternatives = 1;
  UI.listening = true; render(); toast('🎤 Sag z. B. „Milch, Eier und Brot"');
  shopRec.onresult = async e => { const said = (e.results[0] && e.results[0][0].transcript) || ''; const parts = said.split(/,|\bund\b|\bsowie\b|\bauch\b/i).map(x => x.trim()).filter(Boolean);
    const keys = [], free = [];
    parts.forEach(w => { const lw = w.toLowerCase().replace(/^(noch |etwas |ein |eine |einen |zwei |drei |\d+ )+/, ''); const keysI = Object.keys(ING), nm = k => ING[k][0].toLowerCase(); const k = keysI.find(k => nm(k) === lw) || keysI.find(k => nm(k).startsWith(lw) && lw.length >= 3) || keysI.sort((x, y) => nm(y).length - nm(x).length).find(k => lw.startsWith(nm(k).slice(0, Math.max(4, nm(k).length - 2)))); k ? keys.push(k) : free.push(w); });
    let n = await addToList(keys); for (const f of free.slice(0, 5)) n += await addToList([], f.charAt(0).toUpperCase() + f.slice(1));
    toast(n ? `🎤 ${n} ${n===1?'Eintrag':'Einträge'} hinzugefügt` : 'Nichts verstanden – nochmal versuchen?'); buzz(15); };
  shopRec.onerror = () => toast('Mikrofon nicht verfügbar oder nicht erlaubt');
  shopRec.onend = () => { shopRec = null; UI.listening = false; render(); };
  try { shopRec.start(); } catch(e){ shopRec = null; UI.listening = false; render(); }
}
/* --- Live: wer ist gerade einkaufen (Präsenz im Familienkanal) --- */
function shopPresence(on){ try { if (!channel || !channel.track) return; channel.track({ uid: D.user.id, shopping: !!on, at: Date.now() }); } catch(e){} }
function readPresence(){ try { if (!channel || !channel.presenceState) return; const st = channel.presenceState(), ids = new Set();
  Object.values(st).forEach(arr => (arr || []).forEach(m => { if (m.shopping && m.uid) ids.add(m.uid); }));
  const next = [...ids]; if (next.join() !== (UI.shoppers || []).join()){ UI.shoppers = next; if (UI.tab === 'fridge') render(); } } catch(e){} }

/* --- Rezept: Allergie-Warnung für die ganze Familie, Notizen, Sammlungen, Zeiten antippen --- */
function familyWarnings(r){ return active().map(m => prof(m.user_id)).map(p => ({ p, c: conflicts(r, p) })).filter(x => x.c.length); }
function recipeExtras(r){
  const warn = familyWarnings(r), notes = D.notes.filter(n => n.recipe_id === r.id);
  const last = D.log.find(l => l.recipe_id === r.id), inColl = D.colls.filter(c => (c.recipe_ids||[]).includes(r.id));
  return `${warn.length ? `<div class="card fam-warn"><b>⚠️ Achtung für die Familie</b>${warn.map(w => `<div>${esc(w.p.name)}: ${esc(w.c.join(', '))}</div>`).join('')}</div>` : ''}
    ${last ? `<p class="muted" style="text-align:center;font-size:13px;margin:10px 0 0">🍳 Zuletzt gekocht ${agoText(last.cooked_at)}${last.user_id ? ' von ' + esc(prof(last.user_id).name) : ''}</p>` : ''}
    ${D.cap.colls ? `<button class="btn btn-ghost btn-block" style="margin-top:8px" data-action="coll-pick" data-id="${r.id}">📁 ${inColl.length ? 'In: ' + esc(inColl.map(c => c.name).join(', ')) : 'Zu einer Sammlung hinzufügen'}</button>` : ''}
    ${D.cap.notes ? `<div class="h2">💬 Notizen der Familie</div>
      <div class="card notes">${notes.length ? notes.map(n => `<div class="note-row"><span class="avatar sm">${avIn(prof(n.user_id))}</span><div style="flex:1"><b>${esc(prof(n.user_id).name)}</b> <small class="muted">${agoText(n.created_at)}</small><div>${esc(n.body)}</div></div>${n.user_id === D.user.id ? `<button class="x" data-action="note-del" data-id="${n.id}" aria-label="Löschen">${I.x}</button>` : `<button class="x rep" data-action="report" data-k="note" data-id="${n.id}" aria-label="Notiz melden" title="Melden">⚑</button>`}</div>`).join('') : '<div class="muted" style="font-size:13px;padding:4px 0">Noch keine Notiz – z. B. „Nächstes Mal mehr Käse!"</div>'}
        <form class="note-add" data-rid="${r.id}" autocomplete="off"><input class="input" maxlength="200" placeholder="Notiz für alle …" aria-label="Notiz schreiben"><button class="btn btn-herb btn-sm" type="submit">Senden</button></form></div>` : ''}`;
}
function agoText(ts){ const d = Math.floor((Date.now() - Date.parse(ts)) / 864e5); return d <= 0 ? 'heute' : d === 1 ? 'gestern' : d < 7 ? `vor ${d} Tagen` : d < 14 ? 'vor einer Woche' : `vor ${Math.floor(d/7)} Wochen`; }
function stepWithTimers(txt){ return esc(txt).replace(/(\d+)(?:\s*(?:–|-|bis)\s*(\d+))?\s*(Minuten|Min\.?|Minute)/g, (m, a, b) => `<button class="step-t" data-action="timer" data-v="${b || a}">⏱ ${m}</button>`); }
async function addNote(rid, body){ body = body.trim().slice(0,200); if (!body) return;
  const tmp = { id:'tmp'+Date.now(), family_id:D.family.id, recipe_id:rid, user_id:D.user.id, body, created_at:new Date().toISOString() }; D.notes.push(tmp); refreshSheet();
  try { await save(async () => { const r = await sb.from('recipe_notes').insert({ family_id:D.family.id, recipe_id:rid, body }).select().single(); if (r.data) Object.assign(tmp, r.data); return r; }); buzz(10); }
  catch(e){ D.notes = D.notes.filter(n => n !== tmp); refreshSheet(); throw e; } }
function openCollPick(rid){
  sheetFn = () => openCollPick(rid);
  openSheet(`${sheetHead('Sammlungen')}
    ${rid ? '' : '<p class="muted" style="margin:-6px 0 12px">Leg eine Sammlung an und füge Rezepte über „📁 Zu einer Sammlung hinzufügen" im Rezept hinzu.</p>'}
    <div class="stack" ${rid ? '' : 'hidden'}>${D.colls.map(c => { const on = (c.recipe_ids||[]).includes(rid); return `<button class="rc" data-action="coll-toggle" data-id="${c.id}" data-v="${rid}"><div class="em">${esc(c.emoji||'📁')}</div><div class="main"><div class="t">${esc(c.name)}</div><div class="s"><span>${plu((c.recipe_ids||[]).length,'Rezept','Rezepte')}</span></div></div><span class="chk ${on?'on':''}">${on?'✓':'+'}</span></button>`; }).join('') || '<p class="muted">Noch keine Sammlung.</p>'}</div>
    <div class="out-row" style="margin-top:12px"><input id="collNew" class="input" maxlength="30" placeholder="Neue Sammlung, z. B. Weihnachten 🎄" aria-label="Name der neuen Sammlung"><button class="btn btn-herb" data-action="coll-new" data-v="${rid}">Anlegen</button></div>`, true);
}
async function collToggle(cid, rid){ const c = D.colls.find(x => x.id === cid); if (!c) return; const set = new Set(c.recipe_ids || []); set.has(rid) ? set.delete(rid) : set.add(rid); c.recipe_ids = [...set]; refreshSheet(); buzz(8);
  await save(() => sb.from('recipe_collections').update({ recipe_ids: c.recipe_ids }).eq('id', cid)); }
async function collNew(rid){ const name = ($('#collNew')?.value || '').trim().slice(0,30); if (!name){ toast('Bitte gib einen Namen ein'); return; }
  const em = (name.match(/\p{Extended_Pictographic}/u) || ['📁'])[0], clean = name.replace(/\p{Extended_Pictographic}/gu, '').trim() || name;
  const r = await save(() => sb.from('recipe_collections').insert({ family_id:D.family.id, name:clean, emoji:em, recipe_ids: rid ? [rid] : [] }).select().single());
  if (r && r.data) D.colls.push(r.data); refreshSheet(); toast('📁 Sammlung angelegt'); }

/* --- Vorbereitungs-Modus vor dem Kochen --- */
function openPrep(id){
  const r = rec(id); if (!r) return; sheetFn = null; UI.prep = {};
  openSheet(`${sheetHead('Bereitlegen')}
    <p class="muted" style="margin:-6px 0 12px">${r.e} ${esc(r.n)} · Leg alles bereit und hak es ab – dann geht's los.</p>
    <div class="card prep">${[...r.i, ...r.o].map(k => `<button class="prep-row" data-action="prep-tick" data-k="${k}"><span class="tick"></span>${ingEmoji(k)} ${ingName(k)}${r.o.includes(k) ? ' <small class="muted">optional</small>' : ''}</button>`).join('')}
      ${['🔪 Messer & Brett','🍳 Pfanne oder Topf','🥄 Kochlöffel'].map(g => `<button class="prep-row" data-action="prep-tick" data-k="${g}"><span class="tick"></span>${g}</button>`).join('')}</div>
    <div class="prep-bar"><i id="prepBar"></i></div>
    <button class="btn btn-herb btn-block" style="margin-top:12px" data-action="prep-go" data-id="${id}">👨‍🍳 Los geht's</button>
    <button class="btn btn-block" style="background:none;color:var(--muted);margin-top:4px" data-action="prep-go" data-id="${id}">Überspringen</button>`);
}
function prepTick(t){ const on = !t.classList.contains('on'); t.classList.toggle('on', on); buzz(6);
  const all = document.querySelectorAll('.prep-row'), done = document.querySelectorAll('.prep-row.on').length, b = $('#prepBar'); if (b) b.style.width = (100*done/all.length) + '%';
  if (done === all.length){ const go = document.querySelector('[data-action=prep-go]'); if (go){ go.textContent = '✅ Alles bereit – los geht\'s!'; burstAt(go); } } }

/* --- Familie: Pinnwand + Koch-Rangliste --- */
function boardBlock(){
  if (!D.cap.board) return '';
  const posts = D.board.slice(0, 6);
  return `<div class="h2">📌 Pinnwand</div><div class="card board">
    <form class="board-add" autocomplete="off"><input class="input" maxlength="200" placeholder="Nachricht an die Familie, z. B. „Bin heute später da"" aria-label="Nachricht an die Familie"><button class="btn btn-herb btn-sm" type="submit">Posten</button></form>
    ${posts.map(p => `<div class="note-row"><span class="avatar sm">${avIn(prof(p.user_id))}</span><div style="flex:1"><b>${esc(prof(p.user_id).name)}</b> <small class="muted">${agoText(p.created_at)}</small><div>${esc(p.body)}</div></div>${p.user_id === D.user.id ? `<button class="x" data-action="board-del" data-id="${p.id}" aria-label="Löschen">${I.x}</button>` : `<button class="x rep" data-action="report" data-k="board" data-id="${p.id}" aria-label="Beitrag melden" title="Melden">⚑</button>`}</div>`).join('') || '<div class="muted" style="font-size:13px;padding:6px 2px">Noch leer.</div>'}</div>`;
}
function rankBlock(){
  const now = new Date(), m0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime(), by = {};
  D.log.filter(l => l.user_id && Date.parse(l.cooked_at) >= m0).forEach(l => by[l.user_id] = (by[l.user_id] || 0) + 1);
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 5); if (!top.length) return '';
  const mon = now.toLocaleDateString('de-DE', { month:'long' }), medal = ['🥇','🥈','🥉','4.','5.'];
  return `<div class="h2">🏆 Koch-Rangliste ${mon}</div><div class="list rank">${top.map(([id, n], i) => `<div class="row"><span class="rk">${medal[i]}</span><span class="avatar sm">${avIn(prof(id))}</span><span class="grow"><b>${esc(prof(id).name)}</b></span><b>${n}× gekocht</b></div>`).join('')}</div>`;
}
async function addPost(body){ body = body.trim().slice(0,200); if (!body) return;
  const tmp = { id:'tmp'+Date.now(), family_id:D.family.id, user_id:D.user.id, body, created_at:new Date().toISOString() }; D.board.unshift(tmp); render();
  try { await save(async () => { const r = await sb.from('board_posts').insert({ family_id:D.family.id, body }).select().single(); if (r.data) Object.assign(tmp, r.data); return r; }); buzz(10); }
  catch(e){ D.board = D.board.filter(n => n !== tmp); render(); throw e; } }

/* --- Abstimmung endet automatisch --- */
setInterval(async () => { try { const P = D.poll; if (!P || P.status !== 'open' || !P.ends_at || Date.parse(P.ends_at) > Date.now() || P.__closing) return; P.__closing = true;
  const counts = {}; D.votes.forEach(v => counts[v.recipe_id] = (counts[v.recipe_id]||0) + 1); const winner = P.options.slice().sort((a,b) => (counts[b]||0) - (counts[a]||0))[0];
  const { error } = await sb.from('polls').update({ status:'closed', winner }).eq('id', P.id).eq('status', 'open'); if (!error){ P.status = 'closed'; P.winner = winner; render(); toast(`🏆 Abstimmung beendet: ${rec(winner)?.n || ''}`); } } catch(e){} }, 15000);

/* --- Party-Planer --- */
function openParty(keep){
  sheetFn = k => openParty(k); UI.party = UI.party || { guests: 8, ids: [], day: isoDay(nextDays(7)[5] || new Date()) };
  const P = UI.party, q = (UI.partyQ || '').trim().toLowerCase();
  const list = (q ? RX().filter(r => searchScore(r, q) > 0).sort((a,b) => searchScore(b,q) - searchScore(a,q)) : RX().filter(r => r.m === 'fast' || r.t <= 40)).filter(r => !P.ids.includes(r.id)).slice(0, 8);
  const chosen = P.ids.map(rec).filter(Boolean), need = new Set(); chosen.forEach(r => r.i.forEach(k => { if (!D.fridge.includes(k)) need.add(k); }));
  const factor = Math.max(1, Math.round(P.guests / 4 * 10) / 10);
  openSheet(`${sheetHead('🎉 Party planen')}
    <div class="party-g"><span>Wie viele Gäste?</span><div class="stepper"><button data-action="party-g" data-v="-1" aria-label="Weniger">−</button><b>${P.guests}</b><button data-action="party-g" data-v="1" aria-label="Mehr">+</button></div></div>
    <div class="field"><label for="partyDay">Wann?</label><input id="partyDay" class="input" type="date" value="${P.day}"></div>
    ${chosen.length ? `<div class="h2">Auf dem Buffet</div><div class="stack">${chosen.map(r => `<div class="rc">${photoEm(r)}<div class="main"><div class="t">${esc(r.n)}</div><div class="s"><span>Menge × ${factor}</span></div></div><button class="x" data-action="party-rm" data-id="${r.id}" aria-label="Entfernen">${I.x}</button></div>`).join('')}</div>
      <div class="card" style="margin-top:10px;font-size:14px"><b>🛒 ${need.size === 1 ? '1 Zutat fehlt' : need.size + ' Zutaten fehlen'}</b><br><span class="muted">${esc([...need].slice(0,10).map(ingName).join(', '))}${need.size>10?' …':''} – Mengen etwa ${factor}× so viel wie im Rezept</span></div>
      <button class="btn btn-herb btn-block" style="margin-top:12px" data-action="party-go">🎉 Einplanen & Einkaufsliste füllen</button>` : `<p class="muted">Such dir 2–4 Gerichte für das Buffet aus.</p>`}
    <div class="h2">Gericht hinzufügen</div>
    <input id="partySearch" class="input" type="search" aria-label="Rezept für die Party suchen" placeholder="Rezept suchen …" value="${esc(UI.partyQ||'')}" autocomplete="off" style="margin-bottom:10px">
    <div class="stack">${list.map(r => `<button class="rc" data-action="party-add" data-id="${r.id}">${photoEm(r)}<div class="main"><div class="t">${esc(r.n)}</div><div class="s"><span>⏱ ${r.t} Min</span></div></div><span class="chk">+</span></button>`).join('')}</div>`, keep);
}
async function partyGo(){
  const P = UI.party, day = $('#partyDay')?.value || P.day, chosen = P.ids.map(rec).filter(Boolean); if (!chosen.length) return;
  const need = new Set(); chosen.forEach(r => r.i.forEach(k => { if (!D.fridge.includes(k)) need.add(k); }));
  addToList.note = `Party · ${P.guests} Pers.`; let n = 0; try { n = await addToList([...need]); } finally { addToList.note = null; }
  if (day) await setPlan(day, chosen[0].id, 'abend');
  if (D.cap.plan3 && day && chosen[1]) await setPlan(day, chosen[1].id, 'mittag');
  UI.party = null; closeSheet(); render(); burstAt($('.week') || $('.h1')); toast(`🎉 Party geplant · ${plu(n,'Zutat','Zutaten')} auf der Liste`);
}

/* --- Wochenplan: letzte Woche wiederholen, als Bild teilen --- */
async function planRepeat(){
  const from = new Date(); from.setDate(from.getDate() - 7);
  const { data, error } = await sb.from('meal_plan').select('*').eq('family_id', D.family.id).gte('day', isoDay(from)).lt('day', isoDay(new Date()));
  if (error) throw error; const rows = []; (data || []).forEach(p => { const d = new Date(p.day + 'T12:00:00'); d.setDate(d.getDate() + 7); const iso = isoDay(d), slot = p.slot || 'abend';
    if (!planFor(iso, slot)) rows.push(planRow(iso, p.recipe_id, slot, D.cap.plan3 ? { cook: p.cook || null, label: p.label || null } : {})); });
  if (!rows.length){ toast(data && data.length ? 'Die Tage sind schon verplant' : 'Letzte Woche war nichts geplant'); return; }
  D.plan.push(...rows.map(r => ({ ...r }))); paintSoft();
  await save(() => sb.from('meal_plan').upsert(rows, { onConflict: planKey() })); toast(`🔁 ${rows.length} ${rows.length===1?'Gericht':'Gerichte'} übernommen`); buzz(15);
}
async function planImage(){
  const days = nextDays(7), W = 900, rowH = 96, H = 170 + days.length * rowH + 50, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  const cs = getComputedStyle(document.documentElement), bg = cs.getPropertyValue('--bg').trim() || '#F4F5F0', fg = cs.getPropertyValue('--fg').trim() || '#16201A', herb = cs.getPropertyValue('--herb').trim() || '#2F7A4C';
  g.fillStyle = bg; g.fillRect(0, 0, W, H); g.fillStyle = herb; g.fillRect(0, 0, W, 130);
  g.fillStyle = '#fff'; g.font = '800 46px Bricolage Grotesque, sans-serif'; g.fillText('Unser Wochenplan', 48, 78); g.font = '700 24px Figtree, sans-serif'; g.fillText(D.family.name, 48, 112);
  days.forEach((d, i) => { const y = 170 + i * rowH, iso = isoDay(d), p = planFor(iso), r = p && rec(p.recipe_id);
    g.fillStyle = i % 2 ? 'rgba(0,0,0,.03)' : 'rgba(0,0,0,0)'; g.fillRect(24, y - 10, W - 48, rowH - 6);
    g.fillStyle = herb; g.font = '800 26px Figtree, sans-serif'; g.fillText(`${WD[d.getDay()]} ${d.getDate()}.${d.getMonth()+1}.`, 48, y + 44);
    g.fillStyle = fg; g.font = '44px sans-serif'; g.fillText(isOut(p) ? '🍕' : r ? r.e : '·', 230, y + 50);
    g.font = '700 30px Figtree, sans-serif'; g.fillText((isOut(p) ? (p.label || 'Auswärts') : r ? r.n : 'noch offen').slice(0, 34), 300, y + 46);
    if (p && p.cook){ g.globalAlpha = .6; g.font = '600 22px Figtree, sans-serif'; g.fillText('👨‍🍳 ' + prof(p.cook).name, 300, y + 76); g.globalAlpha = 1; } });
  g.globalAlpha = .5; g.fillStyle = fg; g.font = '600 20px Figtree, sans-serif'; g.fillText("Geplant mit „Was gibt's?\"", 48, H - 22); g.globalAlpha = 1;
  const blob = await new Promise(ok => cv.toBlob(ok, 'image/png')); const file = new File([blob], 'wochenplan.png', { type:'image/png' });
  try { if (navigator.canShare && navigator.canShare({ files:[file] })){ await navigator.share({ files:[file], title:'Unser Wochenplan' }); return; } } catch(e){ if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'wochenplan.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('🖼️ Bild gespeichert');
}

/* --- Reste-Modus: was bald abläuft, zuerst verbrauchen --- */
function restoKeys(){ return Object.keys(D.expiries || {}).filter(k => { const d = daysLeft(k); return d !== null && d <= 3; }); }

/* Farbe oben automatisch: liest, was ganz oben auf dem Bildschirm zu sehen ist (Werbung, Rückblick, Kochmodus, Fenster …),
   mischt durchscheinende Ebenen und gibt das als Farbe für den Bereich hinter Uhrzeit und Akku an iPhone/Android weiter */
function parseCol(str){ const m = str && str.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r:p[0], g:p[1], b:p[2], a: p[3] == null ? 1 : p[3] }; }
function layerCol(el){ const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) return null;
  let c = parseCol(cs.backgroundColor); const op = +cs.opacity;
  if ((!c || c.a === 0) && cs.backgroundImage && cs.backgroundImage !== 'none'){ const g = parseCol(cs.backgroundImage); if (g) c = g; }
  if (!c || c.a === 0) return null; return { ...c, a: c.a * op }; }
function topColor(){
  const x = innerWidth / 2; let el = document.elementFromPoint(x, 1); const layers = [];
  for (let n = el; n && n.nodeType === 1; n = n.parentElement){ const c = layerCol(n); if (c){ layers.push(c); if (c.a >= .999) break; } }
  let r = 0, g = 0, b = 0, acc = 0;   // von oben nach unten zusammenmischen
  for (const c of layers){ const w = (1 - acc) * c.a; r += c.r * w; g += c.g * w; b += c.b * w; acc += w; if (acc >= .999) break; }
  if (acc < .999){ const bg = parseCol(getComputedStyle(document.body).backgroundColor) || { r:244, g:245, b:240 }; const w = 1 - acc; r += bg.r*w; g += bg.g*w; b += bg.b*w; }
  return '#' + [r,g,b].map(v => Math.round(v).toString(16).padStart(2,'0')).join('');
}
let lastTop = '';
function syncTopColor(){ if (document.hidden || document.documentElement.classList.contains('framed')) return; let c; try { c = topColor(); } catch(e){ return; }
  if (c === lastTop) return; lastTop = c;
  document.querySelectorAll('meta[name=theme-color]').forEach(m => { m.removeAttribute('media'); m.setAttribute('content', c); });
  document.documentElement.style.setProperty('--sb', c); }
setInterval(syncTopColor, 250); document.addEventListener('visibilitychange', () => { lastTop = ''; syncTopColor(); });

/* Statusleisten-Farbe: Safari (iOS 26) färbt den Bereich hinter Uhrzeit/Akku nach dem obersten festen Element – #sbcol gibt die App-Farbe vor */
new MutationObserver(() => { const r = document.documentElement; if (!document.getElementById('story')) r.classList.remove('sb-story'); r.classList.toggle('sb-tour', !!document.getElementById('tour')); }).observe(document.getElementById('screen') || document.body, { childList:true, subtree:false });

/* =========================================================================
   Party: Countdown zum großen Update
   ========================================================================= */
const PARTY = { at: Date.parse('2026-11-06T14:50:00+01:00'), title: 'Das große Update' };
const partyOn = () => Date.now() < PARTY.at + 6*3600e3;   // bis 2 Std. nach Start sichtbar
function partyLeft(){ const ms = Math.max(0, PARTY.at - Date.now()), s = Math.floor(ms/1000);
  const h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = s%60, z = n => String(n).padStart(2,'0');
  return { ms, h, m, x, txt: h ? `${h}:${z(m)}:${z(x)}` : `${z(m)}:${z(x)}` }; }
function partyChip(){ const l = partyLeft();
  return `<button class="party-chip" data-tab="home"><span>🎉</span><b>${l.ms ? 'Großes Update in' : 'Das Update ist da!'}</b>${l.ms ? `<span class="pc-t" data-cd>${l.txt}</span>` : ''}</button>`; }
function partyCard(){ if (!partyOn()) return ''; const l = partyLeft();
  return `<div class="party-card"><div class="pty-conf" aria-hidden="true">${'🎉🎊✨🥳'.match(/\p{Extended_Pictographic}/gu).map((e,i) => `<i style="--i:${i}">${e}</i>`).join('')}</div>
    <span class="pty-k">${l.ms ? 'Heute · 20:00 Uhr' : 'Jetzt live'}</span>
    <b class="pty-t">${l.ms ? PARTY.title + ' kommt!' : 'Das große Update ist da! 🥳'}</b>
    ${l.ms ? `<div class="pty-cd" data-cdbig>${cdBoxes(l)}</div><span class="pty-s">Viele Verbesserungen und ein paar Überraschungen 👀</span>`
      : `<span class="pty-s">20 neue Funktionen und viele Fehler behoben. Sorry, dass es länger gedauert hat als angekündigt – dafür ist alles gründlich getestet. 💚</span><button class="pty-btn" data-action="changelog">Was ist neu?</button>`}</div>`; }
const cdBoxes = l => [[l.h,'Std'],[l.m,'Min'],[l.x,'Sek']].map(([v,u]) => `<span><b>${String(v).padStart(2,'0')}</b><small>${u}</small></span>`).join('');
let partyTick = null, partyWasLive = Date.now() >= PARTY.at;
function partyLoop(){ clearInterval(partyTick); if (!partyOn()) return;
  document.documentElement.classList.add('party');
  partyTick = setInterval(() => { if (!partyOn()){ clearInterval(partyTick); document.documentElement.classList.remove('party'); render(); return; }
    const l = partyLeft(); document.querySelectorAll('[data-cd]').forEach(e => e.textContent = l.txt);
    const big = document.querySelector('[data-cdbig]'); if (big) big.innerHTML = cdBoxes(l);
    if (!l.ms && !partyWasLive){ partyWasLive = true; render(); try { const c = document.querySelector('.party-card'); burstAt(c); setTimeout(() => burstAt(c), 400); } catch(e){} buzz([30,60,30]); } }, 1000); }
partyLoop();

/* =========================================================================
   Profil personalisieren: Foto, Farbe, Status, Profilkarte
   ========================================================================= */
const PHOTO_RE = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;
const isPhoto = v => typeof v === 'string' && v.length < 60000 && PHOTO_RE.test(v);
const PCOLS = ['', '#2F7A4C', '#2D6CB5', '#6B4BC4', '#B03A6B', '#D2452F', '#E08A1E', '#C9A227', '#1F8A8A', '#4E4542'];
const okColor = c => typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c);
const hasExtras = () => !!D.profile && ('color' in D.profile) && ('status' in D.profile);   // Spalten gibt es erst nach dem Datenbank-Update
function avIn(p){
  p = p || {}; const c = okColor(p.color) ? ` style="--pc:${p.color}"` : '';
  const inner = isPhoto(p.avatar) ? `<img src="${p.avatar}" alt="">` : esc(p.avatar || '🙂');
  return `<span class="avi${c ? ' has-pc' : ''}"${c}>${inner}</span>`;
}
function refreshPfBig(){ const b = document.querySelector('.pf-big'); if (b) b.innerHTML = avIn(D.profile); }
function pickAvatarPhoto(){
  let inp = $('#avInput'); if (!inp){ inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.id = 'avInput'; inp.hidden = true; document.body.appendChild(inp);
    inp.addEventListener('change', async () => { const f = inp.files && inp.files[0]; inp.value = ''; if (!f) return;
      try { const url = await squareImage(f, 192); keepName(); updateProfile({ avatar:url }); openPrefs(true); render(); buzz(15); toast('Profilbild gesetzt 📸'); }
      catch(e){ toast('Das Bild konnte nicht geladen werden'); } }); }
  inp.click();
}
function squareImage(file, size){
  return new Promise((ok, bad) => { const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => { const s = Math.min(img.naturalWidth, img.naturalHeight); const cv = document.createElement('canvas'); cv.width = cv.height = size;
      const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(img, (img.naturalWidth - s)/2, (img.naturalHeight - s)/2, s, s, 0, 0, size, size); URL.revokeObjectURL(u);
      let d = cv.toDataURL('image/webp', .8); if (!d.startsWith('data:image/webp')) d = cv.toDataURL('image/jpeg', .82);
      if (d.length > 58000) d = cv.toDataURL('image/jpeg', .6); isPhoto(d) ? ok(d) : bad(new Error('zu groß')); };
    img.onerror = () => { URL.revokeObjectURL(u); bad(new Error('bild')); }; img.src = u; });
}
function openProfile(id){
  const a = prof(id), mine = id === D.user.id, m = (D.members||[]).find(x => x.user_id === id);
  const cooked = D.log.filter(l => l.user_id === id), rates = D.ratings.filter(r => r.user_id === id);
  const wishes = D.wishes.filter(w => w.user_id === id).length;
  const byR = {}; cooked.forEach(l => byR[l.recipe_id] = (byR[l.recipe_id]||0) + 1);
  const topR = Object.entries(byR).sort((x,y) => y[1]-x[1])[0];
  const favs = (a.favs||[]).map(rec).filter(Boolean).slice(0,6);
  const st = kitchenStats ? (() => { try { return kitchenStats(); } catch(e){ return null; } })() : null;
  const isChef = st && st.topCook && st.topCook[0] === id && st.topCook[1] > 1;
  const since = m && m.created_at ? new Date(m.created_at).toLocaleDateString('de-DE', { month:'long', year:'numeric' }) : '';
  const pc = okColor(a.color) ? a.color : 'var(--herb)';
  sheetFn = null;
  openSheet(`<div class="pf-card" style="--pcc:${pc}">
      <div class="pf-cover"></div>
      <span class="avatar pf-hero">${avIn(a)}</span>
      <div class="h1" style="text-align:center;margin-top:8px">${esc(a.name)}</div>
      ${a.status ? `<p class="pf-status">${esc(a.status)}</p>` : mine && hasExtras() ? `<p class="pf-status muted">Noch kein Status – tipp auf „Profil bearbeiten"</p>` : ''}
      <div class="pf-tags">${m && m.role === 'admin' ? '<span class="chip c-herb">Admin</span>' : ''}${isChef ? '<span class="chip c-yolk">👨‍🍳 Chef de Cuisine</span>' : ''}${a.veg ? '<span class="chip c-herb">🥦 Vegetarisch</span>' : ''}${since ? `<span class="chip c-muted">dabei seit ${since}</span>` : ''}</div>
    </div>
    <div class="pf-stats"><div><b>${cooked.length}</b><small>gekocht</small></div><div><b>${rates.length}</b><small>bewertet</small></div><div><b>${wishes}</b><small>Wünsche offen</small></div></div>
    ${topR && rec(topR[0]) ? `<div class="card" style="display:flex;gap:12px;align-items:center;margin-top:12px"><span style="font-size:30px">${rec(topR[0]).e}</span><span><small class="muted" style="font-weight:700">Kocht am liebsten</small><br><b>${esc(rec(topR[0]).n)}</b> · ${topR[1]}×</span></div>` : ''}
    ${favs.length ? `<div class="h2">Lieblingsgerichte ❤️</div><div class="stack">${favs.map(r => `<button class="rc" data-action="open-recipe" data-id="${r.id}">${photoEm(r)}<div class="main"><div class="t">${esc(r.n)}</div><div class="s"><span>⏱ ${r.t} Min</span></div></div>${I.chev}</button>`).join('')}</div>` : ''}
    ${mine ? `<button class="btn btn-herb btn-block" style="margin-top:16px" data-action="edit-prefs" data-id="${id}">✏️ Profil bearbeiten</button>` : ''}
    <button class="btn btn-block" style="background:none;color:var(--muted);margin-top:6px" data-action="close">Schließen</button>`);
}

/* =========================================================================
   Sponsor: PiHILL
   ========================================================================= */
const SPONSOR = { name:'PiHILL', url:'https://www.etsy.com/de/shop/PiHILL', logo:'sponsor/pihill.png', logoW:'sponsor/pihill-white.png', video:'sponsor/pihill-tiktok.mp4', poster:'sponsor/pihill-tiktok.jpg' };
const AD_EVERY = 14*DAY, PLUS_DAY = DAY;
const plusActive = () => (L.plusUntil||0) > Date.now();
const adReady = () => Date.now() - (L.adLast||0) >= AD_EVERY;
const fmtDay = ms => new Date(ms).toLocaleDateString('de-DE', { day:'numeric', month:'long' });
const fmtLeft = ms => { const h = Math.max(1, Math.round((ms - Date.now())/36e5)); return h >= 2 ? `noch ${h} Stunden` : 'noch knapp 1 Stunde'; };
function sponsorFoot(){
  return `<button class="sp-foot" data-action="sponsor" aria-label="Gesponsert von PiHILL – mehr erfahren"><span>Gesponsert von</span><img src="${SPONSOR.logo}" alt="PiHILL"></button>`;
}
function sponsorWidget(){
  return `<div class="spw"><span class="spw-ad">Anzeige</span>
    <button class="spw-main" data-action="sponsor"><img src="${SPONSOR.logo}" alt="PiHILL"><span class="grow"><b>Handgemacht mit viel Liebe</b><small>Gehäkelt, gestrickt &amp; Deko, die leuchtet – von unserem Sponsor PiHILL</small></span>${I.chev}</button>
    ${adReady() ? `<button class="spw-ad-btn" data-action="ad">🎬 15 Sek. ansehen – <b>1 Tag Plus gratis</b></button>` : ''}</div>`;
}
function sponsorRow(){
  return `<div class="list" style="margin:14px 0 4px"><button class="row" data-action="sponsor"><img src="${SPONSOR.logo}" alt="" style="width:40px;height:40px;object-fit:contain"><span class="grow"><b>Unser Sponsor: PiHILL</b><small>Handgemachtes aus Wolle, Holz &amp; Licht</small></span>${I.chev}</button>
    ${plusActive() ? `<div class="row" style="cursor:default"><span style="font-size:22px">✨</span><span class="grow"><b>Plus ist aktiv</b><small>${fmtLeft(L.plusUntil)} · dank PiHILL</small></span></div>`
      : adReady() ? `<button class="row" data-action="ad"><span style="font-size:22px">🎬</span><span class="grow"><b>1 Tag Plus gratis</b><small>Kurzen Spot von PiHILL ansehen (15 Sek.)</small></span>${I.chev}</button>`
      : `<button class="row" data-action="ad-watch"><span style="font-size:22px">🎬</span><span class="grow"><b>PiHILL-Werbespot ansehen</b><small>Nächster Gratis-Tag Plus ab ${fmtDay((L.adLast||0) + AD_EVERY)}</small></span>${I.chev}</button>`}</div>`;
}
function adOffer(){
  if (plusActive()) return `<div class="card" style="text-align:center;background:var(--herb-soft);font-weight:800;margin-bottom:10px">✨ Plus ist aktiv – ${fmtLeft(L.plusUntil)}</div>`;
  if (adReady()) return `<button class="btn btn-line btn-block" style="margin-bottom:10px" data-action="ad">🎬 15 Sek. Spot ansehen – 1 Tag Plus gratis</button>`;
  return `<p class="muted" style="font-size:13px;text-align:center;margin:0 0 10px">🎬 Der nächste Gratis-Tag Plus ist ab ${fmtDay((L.adLast||0) + AD_EVERY)} wieder da.</p>`;
}
function openSponsor(){
  const groups = [
    ['🧶','Gehäkelt &amp; gestrickt','Ponchos, Strickjacken und Loop-Schals – Einzelstücke'],
    ['✨','Deko, die leuchtet','Lichterkugeln in Häkeloptik, Holz-Weihnachtsbäume, Kürbis, Leuchtpilz und Laternen'],
    ['🪢','Makramee &amp; Fensterdeko','Boho-Wanddeko aus Baumwollgarn und gehäkelte Fensterbilder'],
    ['🎁','Für jede Jahreszeit','Osteranhänger, Weihnachtsanhänger und kleine Geschenke'],
  ];
  openSheet(`<div class="sp-sheet">
    <div class="sp-hero"><span class="spw-ad">Anzeige</span><img src="${SPONSOR.logo}" alt="PiHILL"></div>
    <div class="h1" style="text-align:center;margin-top:6px">Handgemacht mit viel Liebe</div>
    <p class="muted" style="text-align:center;margin:6px 0 16px">PiHILL ist ein kleiner Etsy-Shop für Handgemachtes. Jedes Stück entsteht in Handarbeit und ist ein Unikat – PiHILL unterstützt „Was gibt's?" als Sponsor.</p>
    <div class="stack">${groups.map(([e,t,d]) => `<div class="perk-row" style="align-items:flex-start"><span>${e}</span><div><b>${t}</b><div class="muted" style="font-size:13.5px;font-weight:600">${d}</div></div></div>`).join('')}</div>
    <div class="sp-facts"><div><b>ab 4,90 €</b><small>Preise</small></div><div><b>⭐ 5,0</b><small>Bewertung</small></div><div><b>Etsy</b><small>sicher bezahlen</small></div></div>
    <button class="btn btn-herb btn-block" data-action="sponsor-shop">Zum Shop auf Etsy ↗</button>
    ${adReady() && !plusActive() ? `<button class="btn btn-line btn-block" style="margin-top:8px" data-action="ad">🎬 Spot ansehen – 1 Tag Plus gratis</button>` : `<button class="btn btn-line btn-block" style="margin-top:8px" data-action="ad-watch">🎬 Werbespot ansehen</button>`}
    <button class="btn btn-block" style="background:none;color:var(--muted);margin-top:6px" data-action="close">Schließen</button></div>`);
}
/* Werbespot: 15 Sekunden, ohne Ton – bis zum Ende ansehen schaltet 1 Tag Plus frei (alle 2 Wochen) */
let adT = null;
function openAd(reason){
  reason = reason || 'plus';
  const reward = reason === 'plus' && adReady() && !plusActive();
  closeSheet(); closeAd();
  const msg = reason === 'scan' ? 'Kurzer Spot von PiHILL – danach kannst du dein <b>Kühlschrank-Foto</b> machen 📷'
    : reward ? 'Bis zum Ende ansehen für <b>1 Tag Plus gratis</b>' : 'Danke, dass du PiHILL unterstützt 💚';
  (document.documentElement.classList.contains('framed') && $('#screen') || document.body).insertAdjacentHTML('beforeend', `<div class="adbox" role="dialog" aria-label="Werbespot von PiHILL">
    <video id="adv" src="${SPONSOR.video}" poster="${SPONSOR.poster}" playsinline autoplay preload="auto" disablepictureinpicture></video>
    <div class="ad-top"><span class="spw-ad">Anzeige · PiHILL</span><span class="ad-left" id="adLeft">21</span><button class="ad-snd" id="adSnd" data-action="ad-sound" aria-label="Ton aus">🔊</button></div>
    <div class="ad-bar"><i id="adBar"></i></div>
    <div class="ad-msg" id="adMsg">${msg}</div>
    <button class="ad-x" data-action="ad-close" aria-label="Schließen">✕</button></div>`);
  const v = $('#adv'); let max = 0; v.muted = false;
  const free = reason !== 'scan';   // freiwillig angesehen: Spulen erlaubt, sonst nicht
  v.addEventListener('timeupdate', () => { if (!v.isConnected || !$('#adBar')) return; if (!free || reward){ if (v.currentTime > max + 1.5) v.currentTime = max; } max = Math.max(max, v.currentTime);
    const d = v.duration || 21; $('#adBar').style.width = (100*v.currentTime/d) + '%'; $('#adLeft').textContent = Math.max(0, Math.ceil(d - v.currentTime)); });
  v.addEventListener('ended', () => { if (!v.isConnected) return; const full = max >= (v.duration || 21) - 1.5;
    try { sb.from('feedback').insert({ user_id:D.user.id, kind:'werbung', message:'PiHILL-Spot angesehen (' + reason + ')', app_version:VERSION }).then(()=>{}, ()=>{}); } catch(e){}
    $('#adLeft').textContent = '✓';
    if (reason === 'scan' && full){ L.scanAdOk = Date.now(); saveLocal(); $('#adMsg').innerHTML = `<b>Danke!</b> Jetzt ist die Kamera frei<br><button class="btn btn-herb" style="margin-top:10px" data-action="ad-photo">📷 Kühlschrank fotografieren</button>`; buzz([20,40,20]); return; }
    if (reward && full){ L.adLast = Date.now(); L.plusUntil = Math.max(Date.now(), L.plusUntil||0) + PLUS_DAY; saveLocal();
      $('#adMsg').innerHTML = '🎉 <b>Plus ist jetzt 24 Stunden aktiv!</b> Danke an PiHILL'; buzz([20,40,20]);
      adT = setTimeout(() => { closeAd(); render(); openPlus(false); }, 1800); return; }
    $('#adMsg').innerHTML = `Danke fürs Ansehen 💚<br><button class="btn btn-line" style="margin-top:10px" data-action="sponsor-shop">Zum Shop auf Etsy ↗</button>`; });
  v.addEventListener('error', () => { if (!$('#adMsg')) return; $('#adMsg').textContent = 'Der Spot konnte nicht geladen werden. Bitte später nochmal versuchen.'; if (reason === 'scan'){ L.scanAdOk = Date.now(); saveLocal(); } });
  const pr = v.play();
  if (pr && pr.catch) pr.catch(() => { v.muted = true; const s2 = $('#adSnd'); if (s2) s2.textContent = '🔇';
    v.play().catch(() => { v.addEventListener('click', () => v.play(), { once:true }); $('#adMsg').innerHTML = 'Antippen zum Abspielen'; }); });
}
function closeAd(){ clearTimeout(adT); const b = document.querySelector('.adbox'); if (b) b.remove(); }
/* Plus-Extra: eigene Farbthemen */
const ACCENTS = [['','Grün','#2F7A4C'],['blue','Blau','#2D6CB5'],['berry','Beere','#B03A6B'],['violet','Lila','#6B4BC4'],['amber','Bernstein','#C77A12']];
function applyAccent(){ const a = plusActive() ? (L.accent || '') : ''; if (a) document.documentElement.setAttribute('data-accent', a); else document.documentElement.removeAttribute('data-accent'); }
function accentPicker(){
  return `<div class="h2" style="margin-top:16px">Farbthema <span class="chip c-muted">✨ Plus</span></div>
    <div class="acc-row">${ACCENTS.map(([k,n,c]) => `<button class="acc" data-action="accent" data-v="${k}" aria-pressed="${plusActive() && (L.accent||'') === k}" aria-label="${n}" style="--c:${c}"><i></i><small>${n}</small></button>`).join('')}</div>
    ${plusActive() ? '' : '<p class="muted" style="font-size:13px;margin:6px 0 0">Mit Plus wählbar – z. B. 1 Tag gratis über den Spot von PiHILL.</p>'}`;
}
applyAccent(); setInterval(applyAccent, 60e3);

/* ---------- Start-Intro ---------- */
(() => { const sp = $('#splash'), root = document.documentElement; if (!sp) return;
  const setFood = arr => sp.querySelectorAll('.s2-food span').forEach((x, i) => { if (arr[i]) x.textContent = arr[i]; });
  if (partyOn()){ const c = sp.querySelector('.s2-claim'); if (c) c.textContent = Date.now() < PARTY.at ? '🎉 Heute 20 Uhr: das große Update!' : '🥳 Das große Update ist da!'; setFood(['🎉','🎊','🥳','🎈','✨','🍕']); }
  else if (hwOn() || adOn()){ setFood(adOn() ? ['🎄','⭐','🍪','🎁','❄️','🦌'] : ['🎃','🦇','🍬','👻','🕸️','🍂']); }
  let done = false;
  const hide = () => { if (done) return; done = true; sp.classList.add('gone'); root.classList.remove('splashing'); applyTheme.last = null; applyTheme(); };
  // Nur beim ersten Öffnen zeigen – nicht noch einmal, wenn die App sich für ein Update kurz neu lädt
  let seen = false; try { seen = !!sessionStorage.getItem('wg.splash'); sessionStorage.setItem('wg.splash', '1'); } catch(e){}
  if (seen || window.matchMedia('(prefers-reduced-motion: reduce)').matches){ hide(); return; }
  root.classList.add('splashing');   // oberer Rand bleibt in App-Farbe (iPhone übernimmt sonst das Grün des Intros)
  sp.addEventListener('animationend', e => { if (e.target === sp && (e.animationName === 's2Out' || e.animationName === 'spOut')) hide(); });
  sp.addEventListener('click', hide); setTimeout(hide, 3500); })();

/* =========================================================================
   VERSION 3.0 – flüssiger, schöner, mehr Funktionen
   ========================================================================= */

/* ---------- Lade-Platzhalter statt Kreisel ---------- */
function skeletonView(){
  const bar = (w, h = 14, r = 8, mt = 0) => `<i class="sk" style="width:${w};height:${h}px;border-radius:${r}px;margin-top:${mt}px"></i>`;
  return `<div class="skel" aria-label="Lädt …">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0 14px"><div style="flex:1">${bar('35%', 12)}${bar('75%', 26, 10, 8)}</div><i class="sk" style="width:44px;height:44px;border-radius:50%"></i></div>
    ${bar('100%', 92, 22)}${bar('40%', 12, 6, 22)}${bar('100%', 210, 26, 10)}${bar('100%', 52, 16, 10)}
    ${[1, 2, 3].map(() => `<div style="display:flex;gap:12px;align-items:center;margin-top:12px"><i class="sk" style="width:56px;height:56px;border-radius:16px"></i><div style="flex:1">${bar('70%', 14)}${bar('40%', 11, 6, 8)}</div></div>`).join('')}
  </div>`;
}

/* ---------- Obere Leiste: großer Titel schrumpft zu einer Glasleiste ---------- */
let lastScroll = 0;
function syncNav(fresh){
  const v = $('#views .view:not(.leaving)'), nb = $('#navbar'), tb = $('#tabbar'); if (!v || !nb) return;
  const h1 = v.querySelector('.top .h1');
  if (fresh){ $('#navTitle').textContent = h1 ? h1.textContent : ''; const av = nb.querySelector('.nb-av'); av.innerHTML = D.profile ? avIn(D.profile) : ''; av.hidden = !D.profile; }
  const st = v.scrollTop;
  nb.classList.toggle('on', !!h1 && st > 62 && !UI.cook);
  if (h1){ const k = Math.max(0, Math.min(1, st / 70)); h1.style.opacity = String(1 - k * .7); h1.style.transform = `scale(${1 - k * .04})`; }
  if (tb){ const d = st - lastScroll; if (fresh || st < 80) tb.classList.remove('mini'); else if (d > 6) tb.classList.add('mini'); else if (d < -6) tb.classList.remove('mini'); }
  lastScroll = st;
}
document.addEventListener('scroll', e => { if (e.target.classList && e.target.classList.contains('view') && !e.target.classList.contains('leaving')) syncNav(); }, true);
document.addEventListener('click', e => { if (e.target.closest('#navbar') && !e.target.closest('.nb-av')){ const v = $('#views .view'); v && v.scrollTo({ top:0, behavior:'smooth' }); } });

/* ---------- Endlos-Animationen anhalten, wenn man sie nicht sieht (spart Akku) ---------- */
const LOOPS = '.pick .big,.hw-pump,.hw-bat,.pc-glow,.plus-widget,.inst-grid img,.pp-hero,.adv-glow,.slot-btn .slot-ic';
const loopIO = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(x => x.target.classList.toggle('paused', !x.isIntersecting)), { threshold:0 }) : null;
function watchLoops(){ if (!loopIO) return; document.querySelectorAll(LOOPS).forEach(el => { if (!el.__w){ el.__w = 1; loopIO.observe(el); } }); }
document.addEventListener('visibilitychange', () => document.documentElement.classList.toggle('bg', document.hidden));

/* ---------- Ziehen zum Aktualisieren ---------- */
let ptr = null;
const ptrEl = () => $('#ptr');
function drawPtr(d){ const p = ptrEl(); if (!p) return; p.style.transform = `translate(-50%,${d - 54}px) rotate(${d * 3}deg)`; p.style.opacity = String(Math.min(1, d / 60)); p.classList.toggle('ready', d >= 70); }
document.addEventListener('touchstart', e => { const v = e.target.closest && e.target.closest('#views .view'); if (!v || v.scrollTop > 0 || UI.cook || $('.sheet') || !D.user) return; ptr = { y: e.touches[0].clientY, d: 0, v }; }, { passive:true });
document.addEventListener('touchmove', e => { if (!ptr) return; const dy = e.touches[0].clientY - ptr.y; if (dy <= 0 || ptr.v.scrollTop > 0){ ptr.d = 0; drawPtr(0); return; } ptr.d = Math.min(120, dy * .45); drawPtr(ptr.d); }, { passive:true });
document.addEventListener('touchend', async () => { if (!ptr) return; const d = ptr.d; ptr = null; const p = ptrEl();
  if (d >= 70 && p){ p.classList.add('spin'); drawPtr(70); buzz(10); try { await loadAll(true); } catch(e){} paint(); toast('Aktualisiert ✓'); }
  if (p){ p.classList.remove('spin', 'ready'); p.style.transition = 'transform .35s, opacity .3s'; drawPtr(0); setTimeout(() => { p.style.transition = ''; }, 360); } });

/* ---------- Fenster nach unten wegwischen ---------- */
let sdrag = null;
function sheetStart(y, sh){ sdrag = { y, d: 0, sh, t: performance.now() }; sh.style.transition = 'none'; }
function sheetMove(y){ if (!sdrag) return false; const d = Math.max(0, y - sdrag.y); if (d > 0 && sdrag.sh.scrollTop > 0) return false; sdrag.d = d;
  sdrag.sh.style.transform = `translateY(${d}px)`; const sc = $('.scrim'); if (sc) sc.style.opacity = String(Math.max(0, 1 - d / 400)); return d > 0; }
function sheetEnd(){ if (!sdrag) return; const { sh, d, t } = sdrag; sdrag = null; const fast = d > 40 && d / (performance.now() - t) > .6;
  sh.style.transition = 'transform .32s cubic-bezier(.2,.9,.25,1)'; const sc = $('.scrim'); if (sc){ sc.style.transition = 'opacity .3s'; }
  if (d > 130 || fast){ sh.style.transform = 'translateY(105%)'; if (sc) sc.style.opacity = '0'; setTimeout(() => { keepName(); closeSheet(); render(); }, 260); }
  else { sh.style.transform = ''; if (sc) sc.style.opacity = ''; } }
document.addEventListener('touchstart', e => { const sh = e.target.closest && e.target.closest('.sheet'); if (!sh || sh.scrollTop > 0 || e.target.closest('input,textarea,.slot,.no-drag')) return; sheetStart(e.touches[0].clientY, sh); }, { passive:true });
document.addEventListener('touchmove', e => { if (sdrag && sheetMove(e.touches[0].clientY) && e.cancelable) e.preventDefault(); }, { passive:false });
document.addEventListener('touchend', sheetEnd, { passive:true });
document.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') return; const g = e.target.closest && e.target.closest('.sheet .grabber'); if (!g) return; sheetStart(e.clientY, g.closest('.sheet'));
  const mv = ev => sheetMove(ev.clientY), up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); sheetEnd(); };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); });

/* ---------- Mengen im Kochmodus auf die Personenzahl umrechnen ---------- */
const FRAC = { '½':.5, '¼':.25, '¾':.75 };
function fmtNum(v){ const r = Math.round(v * 2) / 2, i = Math.floor(r), h = r - i ? '½' : ''; return i ? i + (h ? ' ' + h : '') : (h || '½'); }
function scaleQty(txt, f){
  if (!txt || Math.abs(f - 1) < .01) return txt;
  return txt.replace(/(\d+(?:[.,]\d+)?|½|¼|¾)(\s?)(kg|g|ml|l|EL|TL|Prisen?|Stück|Scheiben?|Zehen?|Dosen?|Becher|Packungen?|Pck\.?|Bund|Tassen?|Eier|Ei|Kellen?|Handvoll)(?![a-zäöü])/g, (all, n, sp, u) => {
    const v = (FRAC[n] ?? parseFloat(n.replace(',', '.'))) * f;
    let s;
    if (u === 'g' || u === 'ml') s = String(v < 20 ? Math.max(1, Math.round(v)) : v < 100 ? Math.round(v / 5) * 5 : Math.round(v / 10) * 10);
    else if (u === 'kg' || u === 'l') s = (Math.round(v * 10) / 10).toString().replace('.', ',');
    else s = fmtNum(Math.max(u.startsWith('Prise') ? 1 : .5, v));
    let unit = u; const num = Math.round(v * 2) / 2;
    if (u === 'Eier' && num <= 1) unit = 'Ei'; else if (u === 'Ei' && num > 1) unit = 'Eier';
    return s + sp + unit; });
}

/* ---------- Kochverlauf & Bewertungen ---------- */
async function logCooked(r){
  if (!D.family) return null;
  const row = { family_id:D.family.id, user_id:D.user.id, recipe_id:r.id, recipe_name:String(r.n).slice(0, 80) };
  const tmp = { ...row, id:'tmp' + Date.now(), cooked_at:new Date().toISOString() }; D.log.unshift(tmp);
  try { const res = await save(() => sb.from('cook_log').insert(row).select().single()); if (res && res.data) Object.assign(tmp, res.data); else throw new Error('x');
    setTimeout(checkBadges, 300); return tmp; }
  catch(e){ D.log = D.log.filter(x => x !== tmp); return null; }
}
function ratingOf(rid){ const rs = D.ratings.filter(x => x.recipe_id === rid); return { n: rs.length, avg: rs.length ? rs.reduce((a, x) => a + x.stars, 0) / rs.length : 0 }; }
const cookedTimes = rid => D.log.filter(l => l.recipe_id === rid).length;
const FACES = [[1, '😖', 'Gar nicht'], [2, '😕', 'Na ja'], [3, '🙂', 'Okay'], [4, '😋', 'Lecker'], [5, '🤩', 'Mega!']];
function openRate(logId){
  const log = D.log.find(l => l.id === logId); if (!log) return; const r = rec(log.recipe_id) || { n: log.recipe_name, e:'🍽️' };
  const mine = D.ratings.find(x => x.log_id === logId && x.user_id === D.user.id);
  sheetFn = null;
  openSheet(`${sheetHead('')}
    <div class="rate-hero"><span class="rate-em">${r.e}</span><div class="h1" style="text-align:center;font-size:24px">Wie war ${esc(r.n)}?</div>
    <p class="muted" style="text-align:center;margin:6px 0 18px">Eure Bewertungen helfen der App, öfter Familien-Hits vorzuschlagen.</p></div>
    <div class="rate-row">${FACES.map(([v, e, l]) => `<button class="rate-b" data-action="rate-set" data-id="${logId}" data-v="${v}" aria-pressed="${mine && mine.stars === v}" style="--i:${v}"><span>${e}</span><small>${l}</small></button>`).join('')}</div>
    <button class="linkbtn" style="display:block;margin:18px auto 0;color:var(--muted)" data-action="close">Später</button>`);
}
function rateBanner(){
  const since = Date.now() - 36 * 36e5;
  const log = D.log.find(l => !String(l.id).startsWith('tmp') && Date.parse(l.cooked_at) > since && !D.ratings.some(x => x.log_id === l.id && x.user_id === D.user.id));
  if (!log || L.rateSkip === log.id) return '';
  const r = rec(log.recipe_id) || { n: log.recipe_name, e:'🍽️' };
  return `<div class="banner rate-ban"><span style="font-size:24px">${r.e}</span><span style="flex:1"><b>Wie war ${esc(r.n)}?</b><br><span class="muted" style="font-size:13px">Tipp kurz an, wie's geschmeckt hat</span></span><button class="btn btn-herb btn-sm" data-action="rate" data-v="${log.id}">Bewerten</button><button class="icon-btn sm" data-action="rate-skip" data-v="${log.id}" aria-label="Ausblenden">${I.x}</button></div>`;
}

/* ---------- Erfolge ---------- */
const isVeg = r => r && !r.i.some(k => MEAT.includes(k) || FISH.includes(k));
function kitchenStats(){
  const log = D.log, byR = {}, byU = {}, types = { pasta:0, veg:0, meat:0, sweet:0, fish:0, quick:0 };
  log.forEach(l => { byR[l.recipe_id] = (byR[l.recipe_id] || 0) + 1; if (l.user_id) byU[l.user_id] = (byU[l.user_id] || 0) + 1;
    const r = rec(l.recipe_id); if (!r) return;
    if (r.i.some(k => ['nudeln','lasagne','gnocchi','reisnudeln'].includes(k))) types.pasta++;
    if (r.meal === 'suess') types.sweet++; else if (r.i.some(k => FISH.includes(k))) types.fish++; else if (r.i.some(k => MEAT.includes(k))) types.meat++; else types.veg++;
    if (r.t <= 20) types.quick++; });
  const days = [...new Set(log.map(l => isoDay(new Date(l.cooked_at))))].sort().reverse();
  let streak = 0, best = 0; for (let i = 0; i < days.length; i++){ const prev = i && (Date.parse(days[i - 1]) - Date.parse(days[i])) / 864e5; streak = i && prev === 1 ? streak + 1 : 1; best = Math.max(best, streak); }
  const top = Object.entries(byR).sort((a, b) => b[1] - a[1]);
  const topCook = Object.entries(byU).sort((a, b) => b[1] - a[1])[0];
  const week = log.filter(l => Date.parse(l.cooked_at) > Date.now() - 7 * 864e5).length;
  const rated = {}; D.ratings.forEach(x => { (rated[x.recipe_id] = rated[x.recipe_id] || []).push(x.stars); });
  const bestRated = Object.entries(rated).map(([id, a]) => [id, a.reduce((s, v) => s + v, 0) / a.length, a.length]).sort((a, b) => b[1] - a[1] || b[2] - a[2])[0];
  return { total: log.length, distinct: Object.keys(byR).length, week, top, topCook, types, streak: best,
    cooks: Object.keys(byU).length, ratings: D.ratings.filter(x => x.user_id === D.user.id).length, five: D.ratings.filter(x => x.stars === 5).length,
    veg: types.veg, sweet: types.sweet, breakfast: log.filter(l => (rec(l.recipe_id) || {}).meal === 'fruehstueck').length,
    planned: nextDays(7).filter(d => planFor(isoDay(d))).length, bestRated, avgTime: log.length ? Math.round(log.reduce((a, l) => a + ((rec(l.recipe_id) || {}).t || 30), 0) / log.length) : 0 };
}
const BADGES = [
  ['first','🍳','Erster Teller','Das erste Gericht gekocht', s => s.total >= 1],
  ['ten','🔟','Zehner-Club','10 Gerichte gekocht', s => s.total >= 10],
  ['fifty','🏅','Küchen-Profis','50 Gerichte gekocht', s => s.total >= 50],
  ['variety','🌈','Abwechslung','10 verschiedene Gerichte', s => s.distinct >= 10],
  ['veggie','🥦','Grüner Daumen','5 vegetarische Gerichte', s => s.veg >= 5],
  ['streak','🔥','Dranbleiber','3 Tage hintereinander gekocht', s => s.streak >= 3],
  ['team','👨‍👩‍👧','Teamwork','3 verschiedene Köche in der Familie', s => s.cooks >= 3],
  ['critic','⭐','Feinschmecker','10 Bewertungen abgegeben', s => s.ratings >= 10],
  ['planner','📅','Vorausplaner','Die ganze Woche geplant', s => s.planned >= 7],
  ['early','🥞','Frühaufsteher','Ein Frühstück gekocht', s => s.breakfast >= 1],
  ['sweet','🍰','Naschkatze','3 Desserts gekocht', s => s.sweet >= 3],
  ['star','🤩','Volltreffer','Ein Gericht mit 5 Sternen bewertet', s => s.five >= 1],
];
function checkBadges(){
  if (!D.family) return; const s = kitchenStats(), have = new Set(L.badges || []), got = BADGES.filter(b => b[4](s)).map(b => b[0]);
  const fresh = got.filter(k => !have.has(k)); L.badges = got; saveLocal();
  if (fresh.length && L.badgesInit){ const b = BADGES.find(x => x[0] === fresh[0]); setTimeout(() => { burst(window.innerWidth / 2, window.innerHeight / 3); toast(`🏆 Neuer Erfolg: ${b[1]} ${b[2]}`); }, 600); }
  L.badgesInit = true; saveLocal();
}

/* ---------- Familie: Küche, Neuigkeiten, Rückblick ---------- */
function timeAgo(ts){ const m = Math.round((Date.now() - Date.parse(ts)) / 6e4); if (m < 1) return 'gerade eben'; if (m < 60) return `vor ${m} Min.`; const h = Math.round(m / 60); if (h < 24) return `vor ${h} Std.`; const d = Math.round(h / 24); return d === 1 ? 'gestern' : `vor ${d} Tagen`; }
function feedItems(){
  const out = [];
  D.wishes.forEach(w => w.created_at && out.push({ t: w.created_at, who: w.user_id, txt: `wünscht sich <b>${esc((rec(w.recipe_id) || {}).n || 'etwas')}</b>`, e:'🙋' }));
  D.log.forEach(l => out.push({ t: l.cooked_at, who: l.user_id, txt: `hat <b>${esc((rec(l.recipe_id) || {}).n || l.recipe_name)}</b> gekocht`, e:'🍳' }));
  D.ratings.forEach(x => out.push({ t: x.created_at, who: x.user_id, txt: `findet <b>${esc((rec(x.recipe_id) || {}).n || 'das Essen')}</b> ${FACES[x.stars - 1][1]}`, e:'⭐' }));
  D.shop.forEach(x => x.created_at && x.added_by && !x.checked && out.push({ t: x.created_at, who: x.added_by, txt: `braucht ${x.ing_key ? `<b>${esc(ingName(x.ing_key))}</b>` : `<b>${esc(x.label)}</b>`}`, e:'🛒' }));
  D.plan.forEach(p => p.updated_at && p.set_by && out.push({ t: p.updated_at, who: p.set_by, txt: `plant <b>${esc((rec(p.recipe_id) || {}).n || '')}</b> ein`, e:'📅' }));
  return out.filter(x => x.t && !isNaN(Date.parse(x.t))).sort((a, b) => Date.parse(b.t) - Date.parse(a.t)).slice(0, 6);
}
function familyExtras(){
  const s = kitchenStats(), got = BADGES.filter(b => b[4](s)).length, feed = feedItems();
  return `<button class="kitchen-card" data-action="kitchen">
      <div class="kc-head"><b>Eure Küche</b><span>Statistik &amp; Erfolge ›</span></div>
      <div class="kc-stats"><span><b>${s.total}</b><small>gekocht</small></span><span><b>${s.distinct}</b><small>Gerichte</small></span><span><b>${got}/${BADGES.length}</b><small>Erfolge</small></span><span><b>${s.week}</b><small>diese Woche</small></span></div></button>
    <button class="wrapped-card" data-action="story"><span class="wc-glow"></span><span class="wc-em">✨</span><span><b>Euer Küchen-Rückblick</b><small>Eure Highlights als Story ansehen</small></span>${I.chev}</button>
    ${feed.length ? `<div class="h2">Neuigkeiten</div><div class="list feed">${feed.map(f => { const p = prof(f.who); return `<div class="row"><span class="avatar sm">${p.avatar || '🙂'}</span><span class="grow"><span><b>${esc(p.name || 'Jemand')}</b> ${f.txt}</span><small>${f.e} ${timeAgo(f.t)}</small></span></div>`; }).join('')}</div>` : ''}`;
}
function openKitchen(keep){
  sheetFn = openKitchen; const s = kitchenStats();
  const recent = D.log.slice(0, 12);
  openSheet(`${sheetHead('Eure Küche')}
    <div class="kstats">${[[s.total,'Gerichte gekocht','🍳'],[s.distinct,'verschiedene','🌈'],[s.week,'diese Woche','📆'],[s.streak,'Tage am Stück','🔥']].map(([v, l, e]) => `<div><span>${e}</span><b>${v}</b><small>${l}</small></div>`).join('')}</div>
    ${s.top.length ? `<div class="h2">Am häufigsten gekocht</div><div class="list">${s.top.slice(0, 3).map(([id, n], i) => { const r = rec(id) || { n:'?', e:'🍽️' }; return `<button class="row" data-action="open-recipe" data-id="${id}"><span class="medal">${['🥇','🥈','🥉'][i]}</span><span class="grow"><b>${esc(r.n)}</b><small>${n}× gekocht${(rt => rt.n ? ` · ⭐ ${rt.avg.toFixed(1).replace('.', ',')}` : '')(ratingOf(id))}</small></span>${I.chev}</button>`; }).join('')}</div>` : ''}
    <div class="h2">Erfolge <span class="chip c-muted">${BADGES.filter(b => b[4](s)).length} von ${BADGES.length}</span></div>
    <div class="badges">${BADGES.map(b => { const ok = b[4](s); return `<div class="badge ${ok ? 'ok' : ''}"><span>${ok ? b[1] : '🔒'}</span><b>${b[2]}</b><small>${b[3]}</small></div>`; }).join('')}</div>
    <div class="h2">Kochverlauf</div>
    ${recent.length ? `<div class="list">${recent.map(l => { const r = rec(l.recipe_id) || { n: l.recipe_name, e:'🍽️' }, rs = D.ratings.filter(x => x.log_id === l.id);
      return `<div class="row"><span style="font-size:24px">${r.e}</span><span class="grow"><b>${esc(r.n)}</b><small>${esc(prof(l.user_id).name || '')} · ${timeAgo(l.cooked_at)}${rs.length ? ' · ' + rs.map(x => FACES[x.stars - 1][1]).join('') : ''}</small></span>${!rs.some(x => x.user_id === D.user.id) && !String(l.id).startsWith('tmp') ? `<button class="btn btn-ghost btn-sm" data-action="rate" data-v="${l.id}">Bewerten</button>` : ''}</div>`; }).join('')}</div>`
      : `<div class="card empty"><div class="g">🍳</div><b>Noch nichts gekocht</b>Tippe nach dem Essen im Rezept auf „Heute gekocht" – dann füllt sich hier euer Kochverlauf.<button class="btn btn-herb btn-block" style="margin-top:12px" data-tab="home">Was koche ich heute?</button></div>`}`, keep);
}

/* ---------- Rückblick als Story ---------- */
function openStory(){
  const s = kitchenStats(), fam = D.family ? D.family.name : 'Eure Familie';
  const typeKey = Object.entries(s.types).filter(([k]) => k !== 'quick').sort((a, b) => b[1] - a[1])[0];
  const persona = !s.total ? ['🍳','Die Küchen-Entdecker','Ihr fangt gerade erst an – das wird lecker!']
    : s.avgTime && s.avgTime <= 20 && s.types.quick >= s.total / 2 ? ['⚡','Die Blitzköche','Schnell, lecker, fertig – ihr kocht im Turbo-Modus.']
    : ({ pasta:['🍝','Die Pasta-Profis','Nudeln gehen bei euch einfach immer.'], veg:['🥦','Die Gemüse-Gang','Bunt, frisch und meistens ohne Fleisch.'], meat:['🥩','Die Fleisch-Fans','Ein ordentliches Stück gehört bei euch dazu.'], sweet:['🍰','Die Naschkatzen','Bei euch gibt\'s auch mal Süßes – zu Recht!'], fish:['🐟','Die Fischköpfe','Ihr wisst, was gut ist: Fisch!'] }[typeKey && typeKey[1] ? typeKey[0] : 'veg'] || ['🍳','Die Allesköche','Ihr probiert einfach alles.']);
  const top = s.top[0] && rec(s.top[0][0]), cook = s.topCook && prof(s.topCook[0]), best = s.bestRated && rec(s.bestRated[0]);
  const slides = [
    `<div class="st-k">Was gibt's? · Rückblick</div><div class="st-big st-pop">✨</div><h2>${esc(fam)}</h2><p>Das war eure Küche bisher. Bereit?</p><div class="st-hint">Tippen zum Weitermachen</div>`,
    `<div class="st-k">Gekocht</div><div class="st-num" data-n="${s.total}">0</div><h2>${s.total === 1 ? 'Gericht' : 'Gerichte'}</h2><p>${s.total ? `${s.distinct === s.total ? 'alle verschieden' : s.distinct + ' davon verschieden'}${s.week ? ` · ${s.week} allein diese Woche` : ''}` : 'Noch nichts gekocht – tippt nach dem Essen auf „Heute gekocht"!'}</p>`,
    top ? `<div class="st-k">Euer Lieblingsessen</div><div class="st-big st-pop">${top.e}</div><h2>${esc(top.n)}</h2><p>${s.top[0][1]}× auf dem Tisch</p>` : `<div class="st-k">Euer Lieblingsessen</div><div class="st-big st-pop">🤔</div><h2>Noch offen</h2><p>Kocht ein paar Gerichte – dann wissen wir's.</p>`,
    cook ? `<div class="st-k">Chef de Cuisine</div><div class="st-big st-pop">${avIn(cook)}</div><h2>${esc(cook.name)}</h2><p>stand am häufigsten am Herd: ${s.topCook[1]}×</p>` : `<div class="st-k">Chef de Cuisine</div><div class="st-big st-pop">👨‍🍳</div><h2>Wer wird's?</h2><p>Wer am meisten kocht, landet hier.</p>`,
    best ? `<div class="st-k">Bester Teller</div><div class="st-big st-pop">${best.e}</div><h2>${esc(best.n)}</h2><p>${'⭐'.repeat(Math.round(s.bestRated[1]))} – ${s.bestRated[1].toFixed(1).replace('.', ',')} von 5</p>` : `<div class="st-k">Bester Teller</div><div class="st-big st-pop">⭐</div><h2>Noch keine Sterne</h2><p>Nach dem Essen kurz bewerten – dann seht ihr hier euren Hit.</p>`,
    `<div class="st-k">Euer Küchen-Typ</div><div class="st-big st-pop">${persona[0]}</div><h2>${persona[1]}</h2><p>${persona[2]}</p>`,
    `<div class="st-k">Danke fürs Kochen!</div><div class="st-big st-pop">💚</div><h2>Bis zum nächsten Rückblick</h2><p>${BADGES.filter(b => b[4](s)).length} von ${BADGES.length} Erfolgen geschafft</p><button class="st-btn" data-action="story-close">Fertig</button>`,
  ];
  document.documentElement.classList.add('sb-story'); const el = document.createElement('div'); el.id = 'story'; el.innerHTML = `<div class="st-bars">${slides.map(() => '<i><b></b></i>').join('')}</div><button class="st-x" data-action="story-close" aria-label="Schließen">${I.x}</button>${slides.map((h, i) => `<section class="st-s s${i}">${h}</section>`).join('')}<div class="st-nav"><span data-st="-1"></span><span data-st="1"></span></div>`;
  $('#screen').appendChild(el); let i = -1, t = null;
  const show = n => { i = Math.max(0, Math.min(slides.length - 1, n)); el.querySelectorAll('.st-s').forEach((x, k) => x.classList.toggle('on', k === i));
    el.querySelectorAll('.st-bars i').forEach((b, k) => { b.className = k < i ? 'done' : k === i ? 'run' : ''; });
    const num = el.querySelector(`.s${i} .st-num`); if (num){ const n2 = +num.dataset.n, t0 = performance.now(); (function f(tt){ const k = Math.min(1, (tt - t0) / 1100); num.textContent = Math.round(n2 * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(f); })(t0); }
    if (i === slides.length - 1) setTimeout(() => burst(innerWidth / 2, innerHeight / 2), 300);
    clearTimeout(t); if (i < slides.length - 1) t = setTimeout(() => show(i + 1), 5200); };
  el.addEventListener('click', e => { const n = e.target.closest('[data-st]'); if (n) show(i + +n.dataset.st); });
  el.__close = () => { clearTimeout(t); el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  requestAnimationFrame(() => show(0));
}

/* ---------- Glücksrad: „Kann mich nicht entscheiden" ---------- */
function openSlot(){
  let pool = suggest().filter(s => s.r.meal !== 'suess' && s.missing.length <= 1).slice(0, 14);
  if (pool.length < 3) pool = suggest().filter(s => s.r.meal !== 'suess').slice(0, 14);
  if (!pool.length){ toast('Gerade passt nichts – trag ein paar Zutaten ein'); return; }
  pool = pool.map(x => x.r).sort(() => Math.random() - .5);
  const win = Math.floor(Math.random() * pool.length), reps = 5, items = [];
  for (let k = 0; k < reps; k++) pool.forEach(r => items.push(r));
  const target = (reps - 1) * pool.length + win, H = 74, w = pool[win];
  sheetFn = null;
  openSheet(`${sheetHead('Überrasch mich!')}
    <div class="slot no-drag"><div class="slot-win"></div><div class="slot-reel" id="slotReel">${items.map(r => `<div class="slot-item"><span>${r.e}</span><b>${esc(r.n)}</b></div>`).join('')}</div></div>
    <div class="slot-res" id="slotRes" hidden><div class="muted" style="font-weight:700;text-align:center">Heute gibt's …</div><div class="h1" style="text-align:center;margin:4px 0 14px">${w.e} ${esc(w.n)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="btn btn-tomato" data-action="cook" data-id="${w.id}">👨‍🍳 Kochen</button><button class="btn btn-ghost" data-action="open-recipe" data-id="${w.id}">Rezept</button></div>
      <button class="btn btn-line btn-block" style="margin-top:8px" data-action="slot">🔄 Nochmal drehen</button></div>`);
  const reel = $('#slotReel'); if (!reel) return;
  const y = -(target * H) + H, anim = reel.animate([{ transform:'translateY(0)' }, { transform:`translateY(${y}px)` }], { duration:3400, easing:'cubic-bezier(.1,.7,.12,1)', fill:'forwards' });
  let last = -1; const tk = setInterval(() => { const m = new DOMMatrix(getComputedStyle(reel).transform); const idx = Math.round(-m.m42 / H); if (idx !== last){ last = idx; buzz(4); } }, 40);
  anim.onfinish = () => { clearInterval(tk); const box = $('.slot'); if (!box) return; box.classList.add('done'); buzz([20, 40, 30]); burstAt(box); const res = $('#slotRes'); if (res) res.hidden = false; };
}

/* ---------- Saison-Kalender ---------- */
const SEASON = [
  ['kohl','rotkohl','lauch','karotten','kartoffeln','apfel','sellerie'], ['kohl','rotkohl','lauch','karotten','kartoffeln','apfel','sellerie'],
  ['lauch','karotten','kohl','spinat','fruehlingszwiebeln'], ['spinat','fruehlingszwiebeln','kraeuter','salat'],
  ['spinat','salat','fruehlingszwiebeln','kraeuter','erbsen'], ['erbsen','zucchini','gurke','salat','beeren','kraeuter','blumenkohl'],
  ['zucchini','tomaten','paprika','beeren','gurke','gruenebohnen','blumenkohl','aubergine'], ['tomaten','paprika','zucchini','aubergine','beeren','gruenebohnen','mais'],
  ['kuerbis','apfel','tomaten','paprika','zucchini','mais','champignons','brokkoli'], ['kuerbis','apfel','kohl','rotkohl','champignons','lauch','brokkoli'],
  ['kuerbis','kohl','rotkohl','lauch','apfel','karotten','sellerie','champignons'], ['kohl','rotkohl','lauch','apfel','karotten','sellerie','kartoffeln'],
];
const seasonNowKeys = () => SEASON[new Date().getMonth()].filter(k => ING[k]);
function inSeason(r){ const s = seasonNowKeys(), hit = r.i.filter(k => s.includes(k) && !['kartoffeln','karotten'].includes(k)); return hit.length ? hit : null; }
function seasonRow(){
  const ks = seasonNowKeys(); if (!ks.length) return '';
  const M = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'][new Date().getMonth()];
  return `<div class="season-row"><div class="sr-k">🍂 Frisch im ${M}</div><div class="sr-chips">${ks.map(k => `<button data-action="season-ing" data-k="${k}">${ingEmoji(k)} ${ingName(k)}</button>`).join('')}</div></div>`;
}

/* ---------- Bessere Suche: Umlaute, Tippfehler, Zutaten ---------- */
const norm = s => String(s || '').toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
function editDist(a, b, max){
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++){ const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++){ cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
    if (best > max) return max + 1; prev = cur; }
  return prev[b.length];
}
function searchScore(r, q){
  const toks = norm(q).split(/\s+/).filter(Boolean); if (!toks.length) return 1;
  const name = norm(r.n), words = name.split(/[^a-z0-9]+/).filter(Boolean), ings = [...r.i, ...r.o].map(k => norm(ingName(k)));
  let score = 0;
  for (const t of toks){
    const tol = t.length >= 7 ? 2 : 1; let s = 0;
    if (name.startsWith(t)) s = 100; else if (words.some(w => w.startsWith(t))) s = 80; else if (name.includes(t)) s = 60;
    else if (ings.some(i => i.includes(t))) s = 40;
    else if (t.length >= 4 && words.some(w => editDist(w, t, tol) <= tol || (w.length > t.length && editDist(w.slice(0, t.length), t, tol) <= tol))) s = 25;
    else if (t.length >= 4 && ings.some(i => editDist(i, t, tol) <= tol)) s = 20;
    if (!s) return 0; score += s;
  }
  return score;
}
UI.rf = {};
function passFilters(r){ const f = UI.rf;
  return (!f.quick || r.t <= 20) && (!f.veg || isVeg(r)) && (!f.have || r.i.every(k => D.fridge.includes(k))) && (!f.season || inSeason(r)); }
function filterChips(){ return `<div class="fchips">${[['quick','⏱ Bis 20 Min'],['veg','🥦 Vegetarisch'],['have','✅ Alles da'],['season','🍂 Saison']].map(([k, l]) => `<button data-action="rf" data-v="${k}" aria-pressed="${!!UI.rf[k]}">${l}</button>`).join('')}</div>`; }

/* ---------- Einkaufsliste: nach Supermarkt-Bereichen, teilen, Einkaufs-Modus ---------- */
const AISLES = [['obst','🍎 Obst'],['gemuese','🥦 Gemüse'],['getreide','🍞 Brot, Nudeln & Reis'],['milch','🥛 Milch, Käse & Eier'],['kuehl','🧊 Kühlregal'],['fleisch','🥩 Fleisch & Fisch'],['dose','🥫 Dosen & Gläser'],['backen','🧁 Backen & Süßes'],['wuerz','🧂 Soßen & Gewürze']];
function aisleOf(x){ if (!x.ing_key) return 'other'; const c = CATS.find(c => c[3].includes(x.ing_key)); return c ? c[0] : 'other'; }
function aisles(items){ const g = [...AISLES, ['other','🧺 Sonstiges']].map(([id, t]) => [t, items.filter(x => aisleOf(x) === id)]).filter(x => x[1].length); return g; }
async function shareList(){
  const open = openShop(); if (!open.length) return;
  const txt = `🛒 Einkaufsliste – ${D.family.name}\n` + aisles(open).map(([t, it]) => `\n${t}\n` + it.map(x => '• ' + (x.ing_key ? ingName(x.ing_key) : x.label) + (x.note ? ` (${x.note})` : '') + (x.assigned_to ? ` – bringt ${prof(x.assigned_to).name} mit` : '')).join('\n')).join('\n') + `\n\nErstellt mit „Was gibt's?"`;
  try { if (navigator.share){ await navigator.share({ title:'Einkaufsliste', text: txt }); return; } } catch(e){ if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(txt); toast('Liste kopiert – jetzt z. B. in WhatsApp einfügen'); } catch(e){ window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank', 'noopener'); }
}
let shopWake = null;
function openShopMode(){ UI.shopMode = true; shopPresence(true); try { navigator.wakeLock && navigator.wakeLock.request('screen').then(l => shopWake = l).catch(() => {}); } catch(e){} renderShopMode(true); }
function closeShopMode(){ UI.shopMode = false; shopPresence(false); try { shopWake && shopWake.release(); } catch(e){} shopWake = null; const o = $('.shopmode'); if (o){ o.classList.add('out'); setTimeout(() => { if (!UI.shopMode) $('#overlay').innerHTML = ''; render(); }, 280); } }
function renderShopMode(first){
  if (!UI.shopMode) return;
  const all = D.shop, open = openShop(), done = all.filter(x => x.checked), n = all.length, k = done.length, pct = n ? k / n : 0, C = 2 * Math.PI * 26;
  const html = `<div class="shopmode ${first ? 'enter' : ''}" role="dialog" aria-label="Einkaufs-Modus">
    <header class="sm-top"><button class="icon-btn" data-action="shop-mode-x" aria-label="Schließen">${I.x}</button>
      <div><b>Einkaufs-Modus</b><small>Bildschirm bleibt an · ${open.length ? `${open.length} noch offen` : 'alles erledigt'}</small></div>
      <svg class="sm-ring" viewBox="0 0 60 60"><circle cx="30" cy="30" r="26"/><circle class="p" cx="30" cy="30" r="26" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - pct)}"/><text x="30" y="35">${k}/${n}</text></svg></header>
    <main class="sm-list">${open.length ? aisles(open).map(([t, it]) => `<div class="sm-h">${t}</div>${it.map(x => `<button class="sm-item" data-action="sm-tick" data-id="${x.id}"><span class="sm-box"></span><span class="sm-name">${shopName(x)}</span></button>`).join('')}`).join('')
      : `<div class="sm-done"><div class="sm-done-em">🎉</div><b>Alles im Wagen!</b><span>Die Sachen sind jetzt automatisch im Kühlschrank.</span><button class="btn btn-herb" data-action="shop-mode-x">Fertig</button></div>`}
      ${done.length && open.length ? `<div class="sm-h">✓ Im Wagen</div>${done.map(x => `<button class="sm-item done" data-action="sm-tick" data-id="${x.id}"><span class="sm-box">✓</span><span class="sm-name">${shopName(x)}</span></button>`).join('')}` : ''}</main></div>`;
  const cur = $('.shopmode');
  if (cur && !first){ morph(cur, html.replace(/^<div class="shopmode[^>]*>/, '').replace(/<\/div>$/, '')); }
  else $('#overlay').innerHTML = html;
}

/* ---------- Wochenplan in den Kalender ---------- */
async function exportICS(){
  const pad = n => String(n).padStart(2, '0'), ymd = d => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ev = D.plan.map(p => { const r = rec(p.recipe_id); if (!r) return ''; const d = new Date(p.day + 'T12:00:00'), e = new Date(d); e.setDate(e.getDate() + 1);
    return ['BEGIN:VEVENT', `UID:${p.day}-${p.recipe_id}@wasgibts`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(d)}`, `DTEND;VALUE=DATE:${ymd(e)}`, `SUMMARY:🍽️ ${r.n}`,
      `DESCRIPTION:Zutaten: ${r.i.map(ingName).join(', ')}\\nGeplant mit „Was gibt's?"`, 'END:VEVENT'].join('\r\n'); }).filter(Boolean);
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Was gibts//Wochenplan//DE', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR'].join('\r\n');
  const file = new File([ics], 'wochenplan.ics', { type:'text/calendar' });
  try { if (navigator.canShare && navigator.canShare({ files:[file] })){ await navigator.share({ files:[file], title:'Wochenplan' }); return; } } catch(e){ if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = 'wochenplan.ics'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  toast('📆 Kalender-Datei erstellt – öffnen zum Eintragen');
}

/* ---------- Rezept als Bild teilen ---------- */
async function shareRecipe(id){
  const r = rec(id); if (!r) return; toast('Bild wird erstellt …');
  try { await document.fonts.load('800 80px "Bricolage Grotesque"'); await document.fonts.load('700 40px Figtree'); } catch(e){}
  const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#2F7A4C'); g.addColorStop(1, '#173F28'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(255,255,255,.06)'; c.beginPath(); c.arc(W - 120, 160, 300, 0, 7); c.fill(); c.beginPath(); c.arc(140, H - 140, 240, 0, 7); c.fill();
  c.fillStyle = '#fff'; c.font = '800 44px "Bricolage Grotesque"'; c.fillText("Was gibt's?", 80, 120); c.fillStyle = '#FF8A6E'; c.fillText('', 0, 0);
  c.fillStyle = 'rgba(255,255,255,.95)'; c.beginPath(); c.arc(W / 2, 360, 170, 0, 7); c.fill();
  c.font = '190px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(r.e, W / 2, 372);
  c.fillStyle = '#fff'; c.textBaseline = 'alphabetic'; c.font = '800 84px "Bricolage Grotesque"';
  const lines = []; let line = ''; String(r.n).split(' ').forEach(w => { const t = line ? line + ' ' + w : w; if (c.measureText(t).width > W - 160){ lines.push(line); line = w; } else line = t; }); lines.push(line);
  lines.slice(0, 2).forEach((l, i) => c.fillText(l, W / 2, 650 + i * 92));
  const y0 = 650 + Math.min(2, lines.length) * 92 + 10;
  c.font = '700 38px Figtree'; c.fillStyle = 'rgba(255,255,255,.85)'; c.fillText(`⏱ ${r.t} Minuten  ·  ${r.i.length} Hauptzutaten`, W / 2, y0);
  const bx = 90, by = y0 + 50, bw = W - 180, bh = H - by - 170;
  c.fillStyle = 'rgba(255,255,255,.12)'; c.beginPath(); c.roundRect(bx, by, bw, bh, 40); c.fill();
  c.textAlign = 'left'; c.fillStyle = '#fff'; c.font = '800 34px "Bricolage Grotesque"'; c.fillText('Zutaten', bx + 44, by + 66);
  c.font = '600 36px Figtree'; [...r.i, ...r.o].slice(0, 10).forEach((k, i) => { const col = i % 2, row = Math.floor(i / 2); c.fillText(`${ingEmoji(k)}  ${ingName(k)}`, bx + 44 + col * (bw / 2 - 20), by + 130 + row * 58); });
  c.textAlign = 'center'; c.font = '700 32px Figtree'; c.fillStyle = 'rgba(255,255,255,.9)'; c.fillText('Gefunden mit der Familien-Koch-App „Was gibt\'s?"', W / 2, H - 92);
  c.font = '600 28px Figtree'; c.fillStyle = 'rgba(255,255,255,.6)'; c.fillText(location.host + location.pathname.replace(/index\.html$/, ''), W / 2, H - 48);
  const blob = await new Promise(ok => cv.toBlob(ok, 'image/png')); const file = new File([blob], `${r.n.replace(/[^\wäöüÄÖÜß-]+/g, '-')}.png`, { type:'image/png' });
  try { if (navigator.canShare && navigator.canShare({ files:[file] })){ await navigator.share({ files:[file], title: r.n, text: `Heute gibt's ${r.n} ${r.e}` }); return; } } catch(e){ if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); toast('📤 Bild gespeichert');
}

/* ---------- Erste-Schritte-Tour und „Neu in 3.0" ---------- */
const TOUR = [
  ['🧊', ['🥕','🧀','🥚'], 'Sag, was da ist', 'Tippe im Kühlschrank an, was ihr habt – oder mach einfach ein Foto. Die App erkennt die Zutaten.', 't1'],
  ['👨‍👩‍👧', ['🥦','❤️','🚫'], 'Wer isst mit?', 'Jeder hat sein Profil: vegetarisch, keine Pilze, Allergien. Vorgeschlagen wird nur, was allen schmeckt.', 't2'],
  ['🙋', ['📅','🛒','🗳️'], 'Wünschen & planen', 'Wünscht euch Gerichte, plant die Woche und schreibt die Einkaufsliste – alles gemeinsam und live.', 't3'],
  ['👨‍🍳', ['🔥','⏱','🎉'], 'Los geht\'s!', 'Der Kochmodus erklärt jeden Schritt – mit Herdstufe, Timern und Mengen für eure Personenzahl.', 't4'],
];
function openTour(){
  if ($('#tour')) return; const el = document.createElement('div'); el.id = 'tour';
  el.innerHTML = `<button class="tour-skip" data-action="tour-end">Überspringen</button><div class="tour-track no-drag">${TOUR.map(([m, s, h, p, c], i) => `<section class="tour-s ${c}"><div class="tour-art"><span class="ta-main">${m}</span>${s.map((x, k) => `<span class="ta-s s${k}">${x}</span>`).join('')}</div><div class="tour-n">${i + 1} / ${TOUR.length}</div><h2>${h}</h2><p>${p}</p></section>`).join('')}</div>
    <div class="tour-foot"><div class="tour-dots">${TOUR.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div><button class="btn btn-herb tour-next" data-action="tour-next">Weiter</button></div>`;
  $('#screen').appendChild(el);
  const tr = el.querySelector('.tour-track');
  tr.addEventListener('scroll', () => { const i = Math.round(tr.scrollLeft / tr.clientWidth); el.querySelectorAll('.tour-dots i').forEach((d, k) => d.classList.toggle('on', k === i)); el.querySelector('.tour-next').textContent = i === TOUR.length - 1 ? 'Los geht\'s!' : 'Weiter'; el.querySelectorAll('.tour-s').forEach((s, k) => s.classList.toggle('on', k === i)); }, { passive:true });
  el.querySelector('.tour-s').classList.add('on');
}
function endTour(){ const el = $('#tour'); L.tourDone = Date.now(); L.seen30 = true; saveLocal(); if (el){ el.classList.add('out'); setTimeout(() => el.remove(), 320); } }
function openWhatsNew(){
  sheetFn = null;
  const items = [['🫧','Flüssiger als je zuvor','Neue Animationen, weichere Übergänge, Fenster zum Wegwischen'],['🧭','Neue Leisten','Schwebende Tab-Leiste und eine Titelleiste aus Glas'],['🎰','Überrasch mich','Kann sich keiner entscheiden? Dreh am Rad!'],['⭐','Bewerten','Nach dem Essen kurz sagen, wie\'s war – Familien-Hits kommen öfter'],['✨','Euer Küchen-Rückblick','Eure Highlights als Story – unter „Familie"'],['🛒','Einkaufs-Modus','Große Liste nach Supermarkt sortiert, Bildschirm bleibt an'],['🍂','Saison-Kalender','Was gerade frisch ist, kommt öfter auf den Tisch'],['👥','Mengen umrechnen','Im Kochmodus für 1 bis 8 Personen'],['⏱','Mehrere Timer','Laufen sogar weiter, wenn du den Kochmodus schließt'],['📤','Teilen','Rezept als Bild, Einkaufsliste per WhatsApp, Wochenplan in den Kalender']];
  openSheet(`${sheetHead('')}<div class="wn-hero"><span>🎉</span><div class="h1" style="text-align:center">Update 3.0 ist da!</div><p class="muted" style="text-align:center;margin:6px 0 16px">Das größte Update bisher – und ein paar Überraschungen 🎁</p></div>
    <div class="wn-list">${items.map(([e, t, s], i) => `<div class="wn-i" style="--i:${i}"><span>${e}</span><div><b>${t}</b><small>${s}</small></div></div>`).join('')}</div>
    <button class="btn btn-herb btn-block" style="margin-top:16px" data-action="wn-ok">Los geht's</button>`);
}
function firstRunInfo(){
  if (!D.user || D.profile?.banned || !D.family || !isActive() || $('.sheet') || $('#tour') || UI.cook) return;
  if (!L.tourDone && !L.seenVersion && !L.cookedCount){ openTour(); return; }
  if (!L.seen30){ L.seen30 = true; L.tourDone = L.tourDone || Date.now(); saveLocal(); }   // kein Fenster mehr beim Start (Apple: nicht unterbrechen)
}

/* ---------- Adventskalender (1.–24. Dezember) ---------- */
const ADV_TIPS = ['Zwiebeln schneiden ohne Tränen: vorher 10 Minuten in den Kühlschrank legen.','Nudelwasser gehört gesalzen wie Meerwasser – ungefähr 1 Teelöffel pro Liter.','Kräuter bleiben länger frisch wie ein Blumenstrauß im Wasserglas.','Bananen lassen Obst daneben schneller reifen – praktisch bei harten Avocados.','Ein Holzlöffel quer über dem Topf verhindert, dass er überkocht.','Plätzchenteig wird mürber, wenn er eine Stunde im Kühlschrank ruht.','Brot nie in den Kühlschrank – dort wird es schneller altbacken.','Knoblauch lässt sich leichter schälen, wenn man die Zehe kurz andrückt.','Eier sind frisch, wenn sie in Wasser am Boden liegen bleiben.','Ein Spritzer Zitrone hält aufgeschnittene Äpfel hell.','Reste vom Vortag? Freitags gibt\'s bei vielen Familien „Restekönig".','Zimt passt nicht nur zu Süßem – probier ihn mal im Chili.','Kartoffeln mit kaltem Wasser aufsetzen, dann garen sie gleichmäßig.','Gefrorene Beeren direkt verwenden – nicht auftauen, sonst werden sie matschig.','Butter für Plätzchen: kalt für Mürbeteig, weich für Rührteig.','Ein Stück Apfel in der Keksdose hält Lebkuchen weich.','Pfanne erst heiß werden lassen, dann Öl – dann klebt nichts an.','Gewürze ohne Fett kurz anrösten – dann duften sie viel stärker.','Suppe zu salzig? Eine rohe Kartoffel mitkochen und wieder herausnehmen.','Teig ausrollen klappt am besten zwischen zwei Lagen Backpapier.','Schokolade schmilzt am schonendsten über einem Wasserbad.','Rotkohl schmeckt aufgewärmt am zweiten Tag sogar noch besser.','Am Heiligabend gibt\'s in vielen Familien Kartoffelsalat mit Würstchen – ganz ohne Stress.','Frohe Weihnachten! 🎄 Danke, dass ihr mit „Was gibt\'s?" kocht.'];
function advDay(){ const d = new Date(); return d.getMonth() === 11 ? Math.min(24, d.getDate()) : Math.max(1, Math.min(24, d.getDate())); }
function advRecipe(n){
  const by = re => RX().filter(r => re.test(r.n)).sort((a, b) => a.n.localeCompare(b.n));
  const sweet = by(/apfel|äpfel|zimt|keks|cookie|hefe|kuchen|waffel|crêpe|schoko|pudding|kaiserschmarrn|plätzchen|grieß|brownie|muffin/i), cozy = by(/suppe|eintopf|auflauf|gulasch|rotkohl|kürbis|braten|knödel|gratin|ragout/i);
  const pool = n % 2 ? (sweet.length ? sweet : cozy) : (cozy.length ? cozy : sweet);
  return pool.length ? pool[(n * 7 + 3) % pool.length] : RX()[n]; }
const ADV_ORDER = [7,18,3,22,11,1,15,9,24,5,13,20,2,17,8,23,12,4,19,10,6,16,21,14];
function adventCard(){
  if (!adOn()) return ''; const d = advDay(), open = (L.advent || []).includes(d);
  return `<button class="adv-card" data-action="advent"><span class="adv-glow"></span><span class="adv-snow" aria-hidden="true">❄️</span>
    <span class="adv-k">Adventskalender</span><b>${open ? `Tür ${d} ist offen ✓` : `Tür ${d} wartet auf dich`}</b><span class="adv-s">${open ? 'Schau dir die Überraschung nochmal an' : 'Heute: ein Rezept-Tipp und ein Küchen-Geheimnis'}</span><span class="adv-n">${d}</span></button>`;
}
function openAdvent(keep, opened){
  sheetFn = k => openAdvent(k, UI.advOpen);
  const d = advDay(), done = new Set(L.advent || []), sel = opened || UI.advOpen;
  const r = sel ? advRecipe(sel) : null;
  openSheet(`${sheetHead('Adventskalender 🎄')}
    <div class="adv-grid">${ADV_ORDER.map(n => `<button class="adv-door ${done.has(n) ? 'open' : ''} ${n === d && !done.has(n) ? 'today' : ''} ${n > d ? 'locked' : ''}" data-action="adv-door" data-v="${n}"><span class="ad-f"><b>${n}</b></span><span class="ad-b">${done.has(n) ? (advRecipe(n) || {}).e || '🎁' : ''}</span></button>`).join('')}</div>
    ${r ? `<div class="adv-out" id="advOut"><div class="adv-day">Tür ${sel}</div><button class="rc" data-action="open-recipe" data-id="${r.id}">${photoEm(r)}<div class="main"><div class="t">${esc(r.n)}</div><div class="s"><span>⏱ ${r.t} Min</span><span class="chip c-tomato">Rezept des Tages</span></div></div>${I.chev}</button>
      <div class="card adv-tip">💡 ${esc(ADV_TIPS[sel - 1])}</div></div>` : `<p class="muted" style="text-align:center;margin-top:14px">Jeden Tag geht eine neue Tür auf – mit einem Rezept und einem Küchen-Geheimnis.</p>`}`, keep);
}

/* ---------- Schnee im Advent ---------- */
function ensureSnow(){
  const on = adOn() && !UI.cook; let s = $('#snow');
  if (on && !s){ s = document.createElement('div'); s.id = 'snow'; s.setAttribute('aria-hidden', 'true'); s.innerHTML = Array.from({ length:22 }, (_, i) => `<i style="--x:${(i * 47) % 100}%;--d:${6 + (i * 7) % 7}s;--t:${-(i * 1.3) % 9}s;--s:${3 + (i * 5) % 4}px"></i>`).join(''); $('#screen').appendChild(s); }
  if (!on && s) s.remove();
}

/* ---------- Neue Aktionen ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-action]'); if (!t) return;
  const a = t.dataset.action;
  try { switch (a){
    case 'slot': openSlot(); break;
    case 'filters-toggle': UI.filtersOpen = !UI.filtersOpen; render(); break;
    case 'rate': openRate(t.dataset.v); break;
    case 'rate-skip': L.rateSkip = t.dataset.v; saveLocal(); render(); break;
    case 'rate-set': { const id = t.dataset.id, st = +t.dataset.v, log = D.log.find(l => l.id === id); if (!log) break;
      D.ratings = D.ratings.filter(x => !(x.log_id === id && x.user_id === D.user.id));
      const row = { log_id:id, family_id:D.family.id, user_id:D.user.id, recipe_id:log.recipe_id, stars:st };
      D.ratings.push({ ...row, created_at:new Date().toISOString() }); burstAt(t); buzz([15, 30, 15]);
      setTimeout(() => { closeSheet(); render(); }, 380); toast(st >= 4 ? `${FACES[st - 1][1]} Gemerkt – kommt öfter!` : `${FACES[st - 1][1]} Danke, gemerkt`);
      await save(() => sb.from('ratings').upsert(row, { onConflict:'log_id,user_id' })); checkBadges(); break; }
    case 'kitchen': openKitchen(); break;
    case 'story': openStory(); break;
    case 'story-close': { const s = $('#story'); s && s.__close && s.__close(); break; }
    case 'season-ing': UI.rtab = 'all'; UI.q = ingName(t.dataset.k); UI.rlimit = 30; go('recipes'); break;
    case 'rf': UI.rf[t.dataset.v] = !UI.rf[t.dataset.v]; UI.rlimit = 30; buzz(6); render(); break;
    case 'shop-share': shareList(); break;
    case 'shop-mode': openShopMode(); break;
    case 'shop-mode-x': closeShopMode(); break;
    case 'sm-tick': { const id = t.dataset.id, it = D.shop.find(x => String(x.id) === id); if (!it) break; buzz(10); t.classList.add('tick'); const wasOpen = openShop().length;
      setTimeout(() => { toggleShop(it.id); renderShopMode(); if (wasOpen && !openShop().length){ burst(innerWidth / 2, innerHeight / 2); buzz([30, 60, 30]); } }, 160); break; }
    case 'plan-ics': exportICS(); break;
    case 'share-recipe': shareRecipe(t.dataset.id); break;
    case 'cook-serv': { const c = UI.cook; if (!c) break; c.servings = c.servings >= 8 ? 1 : c.servings + 1; const s = $('#ckServ'); if (s) s.textContent = c.servings;
      const st = c.steps && c.steps[c.step], tx = $('.ck-main.in .ck-text'); if (st && tx) tx.textContent = scaleQty(st.text, c.servings / 4); buzz(6); toast(`👥 Mengen für ${c.servings} ${c.servings === 1 ? 'Person' : 'Personen'}`); break; }
    case 'timer-x': UI.timers = UI.timers.filter(x => String(x.id) !== t.dataset.v); tickTimer(); toast('Timer gestoppt'); break;
    case 'tour': openTour(); break;
    case 'tour-next': { const tr = $('#tour .tour-track'); if (!tr) break; const i = Math.round(tr.scrollLeft / tr.clientWidth); if (i >= TOUR.length - 1) endTour(); else tr.scrollTo({ left:(i + 1) * tr.clientWidth, behavior:'smooth' }); break; }
    case 'tour-end': endTour(); break;
    case 'wn-ok': closeSheet(); render(); break;
    case 'tz': L.tz = +t.dataset.v; saveLocal(); document.documentElement.style.setProperty('--tz', L.tz); render(); break;
    case 'preview': L.preview = t.dataset.v || undefined; if (L.season === false) L.season = true; saveLocal(); applyTheme(); render(); break;
    case 'advent': UI.advOpen = null; openAdvent(); break;
    case 'adv-door': { const n = +t.dataset.v, d = advDay();
      if (n > d){ t.animate([{ transform:'rotate(0)' }, { transform:'rotate(-6deg)' }, { transform:'rotate(5deg)' }, { transform:'rotate(0)' }], { duration:380 }); toast(`🎅 Noch ${n - d} ${n - d === 1 ? 'Tag' : 'Tage'} Geduld!`); break; }
      const first = !(L.advent || []).includes(n); L.advent = [...new Set([...(L.advent || []), n])]; saveLocal(); UI.advOpen = n;
      if (first){ t.classList.add('opening'); buzz([10, 30, 10]); setTimeout(() => { openAdvent(true, n); burstAt($('#advOut') || t); render(); }, 650); }
      else openAdvent(true, n); break; }
  } } catch(err){ toast(errText(err)); }
});
window.addEventListener('keydown', e => { if (e.key === 'Escape'){ const s = $('#story'); if (s && s.__close) s.__close(); if ($('#tour')) endTour(); if (UI.shopMode) closeShopMode(); } });
window.addEventListener('wg:data', () => { if (UI.shopMode) renderShopMode(); });

/* ---------- Start ---------- */
/* Neue Versionen automatisch laden: sobald ein neuer Service Worker übernimmt, einmal neu laden */
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { const t = e.data && e.data.tab; if (t && D.user && ORDER.includes(t)){ closeSheet(); go(t); scheduleReload(50); } });
if ('serviceWorker' in navigator && location.protocol === 'https:'){
  const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    // Update gleich beim Start: sofort neu laden (fällt hinter dem Intro kaum auf).
    // Sonst nicht mitten in der Benutzung neu starten – erst, wenn die App im Hintergrund ist.
    if (performance.now() < 5000){ reloaded = true; location.reload(); return; }
    const later = () => { if (document.hidden && !reloaded){ reloaded = true; location.reload(); } };
    document.addEventListener('visibilitychange', later);
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => { r.update(); document.addEventListener('visibilitychange', () => { if (!document.hidden) r.update(); }); }).catch(()=>{});
}
layout(); render();
setTimeout(installAuto, 3300);
if (configured){
  sb.auth.getSession().then(({ data }) => onSession(data.session));
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === 'SIGNED_IN' && session && D.user && D.user.id === session.user.id){ D.user = session.user; return; }   // gleiche Person: nur Token aufgefrischt
    if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') onSession(session);
  });
} else { UI.loading=false; render(); }


/* =========================================================================
   VERSION 4.2 – Hilfe & Support
   Hilfe-Center, Live-Chat, Anfragen, Notfall, Inhalte melden, Status.
   Gesperrte Personen erreichen den Support weiterhin.
   ========================================================================= */
const FAQ2 = [
  ['Wie lade ich jemanden in meine Familie ein?', 'Unter „Familie" findest du den Familien-Code und einen QR-Code. Die andere Person gibt den Code bei der Anmeldung ein – ein Familien-Admin muss die Anfrage dann bestätigen.'],
  ['Warum bekomme ich keine Benachrichtigungen?', 'Am iPhone gehen Benachrichtigungen nur, wenn die App über „Teilen → Zum Home-Bildschirm" installiert ist. Danach unter „Mehr" Benachrichtigungen einschalten und erlauben.'],
  ['Wie füge ich etwas zum Kühlschrank hinzu?', 'Unter „Kühlschrank" eintippen, per Foto scannen oder aus den Vorschlägen antippen. Ablaufdaten kannst du pro Zutat eintragen.'],
  ['Wie funktioniert die Einkaufsliste?', 'Unter „Planen → Einkauf". Tippe auf einen Eintrag, um Menge, Notiz oder Person festzulegen. Mit dem Mikrofon kannst du mehrere Sachen auf einmal sagen.'],
  ['Kann ich eigene Rezepte speichern?', 'Ja – unter „Rezepte → Familie" auf „Neues Rezept". Eure Rezepte sieht nur eure Familie.'],
  ['Wie ändere ich meinen Namen oder mein Profilbild?', 'Tippe oben rechts auf dein Bild. Dort kannst du Name, Bild, Farbe und Status ändern.'],
  ['Ich habe mein Passwort vergessen.', 'Melde dich ab und tippe bei der Anmeldung auf „Passwort vergessen". Du bekommst eine E-Mail zum Zurücksetzen.'],
  ['Wie verlasse ich eine Familie?', 'Unter „Familie" ganz unten auf „Familie verlassen". Als letzter Admin solltest du vorher jemand anderen zum Admin machen.'],
  ['Was ist Plus?', 'Plus schaltet Extras frei. Unter „Mehr → Plus" siehst du alles – Plus-Mitglieder bekommen außerdem bevorzugt Antwort vom Support.'],
  ['Wie lösche ich meinen Account und meine Daten?', 'Schreib uns über „Anfrage stellen → Datenschutz". Wir löschen deinen Account mit allen Daten und bestätigen es dir.'],
  ['Die App lädt nicht oder zeigt alte Daten.', 'Ohne Internet zeigt die App den letzten Stand. Prüfe die Verbindung und zieh die Seite neu. Hilft das nicht, schau oben nach, ob es gerade eine Störung gibt.'],
  ['Jemand schreibt unangemessene Dinge.', 'Tippe beim Beitrag auf ⚑ „Melden". Bei etwas Ernstem nutze den Notfall-Knopf – das sehen wir zuerst.'],
];
const SUP_CATS = [['fehler','🐞','Etwas funktioniert nicht'],['konto','👤','Konto & Anmeldung'],['familie','👨‍👩‍👧','Familie & Einladungen'],['abo','✨','Plus & Abo'],['datenschutz','🔒','Datenschutz & Daten löschen'],['sonstiges','💬','Etwas anderes']];
const SUP_NOT = [
  ['gehackt','🔐','Mein Konto wurde übernommen','Ändere zuerst dein Passwort: abmelden → „Passwort vergessen". Wir prüfen dein Konto und sperren fremde Zugriffe.'],
  ['fremd','🚪','Jemand Fremdes ist in meiner Familie','Familien-Admins können die Person sofort unter „Familie" entfernen. Wir erstellen euch außerdem einen neuen Familien-Code.'],
  ['inhalt','⚠️','Belästigung oder schlimmer Inhalt','Du kannst den Beitrag zusätzlich mit ⚑ melden. Wir schauen uns das sofort an und sperren bei Bedarf.'],
  ['dringend','🚨','Etwas anderes Dringendes','Beschreib kurz, was passiert ist – Notfälle sehen wir als Erstes.']];
const SUP_ICON = { chat:'💬', konto:'👤', familie:'👨‍👩‍👧', fehler:'🐞', abo:'✨', datenschutz:'🔒', sonstiges:'💬', sperre:'🛟', notfall:'🚨', melden:'⚑' };
const SUP_STATUS = { offen:['Offen','c-yolk'], in_arbeit:['In Bearbeitung','c-herb'], geloest:['Gelöst',''] };
const SUP = { tickets:[], msgs:{}, status:null, cfg:null, online:false, ch:null, ok:null, view:'home', tid:null, cat:null, sub:null, rep:null };
const supUnread = () => SUP.tickets.filter(t => t.user_unread).length;

async function loadSupport(){
  if (!sb || !D.user) return;
  if (SUP.uid !== D.user.id){ SUP.uid = D.user.id; SUP.tickets = []; SUP.msgs = {}; if (SUP.ch){ sb.removeChannel(SUP.ch); SUP.ch = null; } }
  const safe = async q => { try { return (await q) || {}; } catch(e){ return { error:e }; } };
  const [st, tk] = await Promise.all([
    safe(sb.from('app_settings').select('key,value').in('key', ['status','support'])),
    safe(sb.from('support_tickets').select('*').eq('user_id', D.user.id).order('updated_at', { ascending:false }).limit(30)),
  ]);
  (st.data || []).forEach(r => { if (r.key === 'status') SUP.status = r.value; if (r.key === 'support') SUP.cfg = r.value; });
  if (tk.error){ SUP.ok = false; } else { SUP.ok = true; SUP.tickets = tk.data || []; }
}
function supSubscribe(){
  if (SUP.ch || !sb || !D.user) return;
  const ch = sb.channel('support-online', { config:{ presence:{ key: D.user.id } } });
  ch.on('presence', { event:'sync' }, () => {
      const st = ch.presenceState ? ch.presenceState() : {}; SUP.online = Object.values(st).some(arr => arr.some(p => p.support));
      supRefresh(); })
    .on('postgres_changes', { event:'*', schema:'public', table:'support_tickets' }, async () => { await loadSupport(); supRefresh(); if (!$('.sheet') && UI.tab === 'more') render(); })
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'support_messages' }, async ev => {
      const m = ev.new; if (!m) return;
      const list = SUP.msgs[m.ticket_id]; if (list && !list.some(x => x.id === m.id)) list.push(m);
      if (m.from_support && !(SUP.view === 'ticket' && SUP.tid === m.ticket_id && $('.sheet'))) toast('🛟 Neue Antwort vom Support');
      if (SUP.view === 'ticket' && SUP.tid === m.ticket_id && $('.sheet')) sb.rpc('support_seen', { tid:m.ticket_id }).then(()=>{}, ()=>{});
      supRefresh(); })
    .subscribe();
  SUP.ch = ch;
}
function supRefresh(){ if ($('.sheet') && sheetFn && sheetFn.sup) sheetFn(true); }
function supSheet(fn){ const f = k => fn(k); f.sup = true; sheetFn = f; return f; }

async function openHelp(keep){
  SUP.view = 'home'; supSheet(openHelp);
  if (!keep){ supSubscribe(); loadSupport().then(supRefresh); }
  const s = SUP.status || {}, cfg = SUP.cfg || {};
  const plus = plusActive();
  openSheet(`${sheetHead('Hilfe &amp; Support')}
    ${s.state && s.state !== 'ok' ? `<div class="sup-status warn"><b>⚠️ Gerade gibt es Probleme</b><span>${esc(s.text || 'Wir arbeiten schon daran.')}</span></div>` : `<div class="sup-status"><b>✅ Alles läuft normal</b></div>`}
    <div class="sup-online ${SUP.online ? 'on' : ''}"><i></i>${SUP.online ? 'Support ist gerade online – Antwort im Live-Chat meist in wenigen Minuten' : esc(cfg.reply || 'Wir antworten meistens innerhalb von 24 Stunden.')}</div>
    <div class="sup-acts">
      <button class="sup-act" data-action="sup-new" data-v="chat"><span>💬</span><b>Live-Chat</b><small>Direkt schreiben</small></button>
      <button class="sup-act" data-action="sup-new" data-v=""><span>📝</span><b>Anfrage</b><small>Mit Kategorie</small></button>
      <button class="sup-act red" data-action="sup-new" data-v="notfall"><span>🚨</span><b>Notfall</b><small>Sofort dringend</small></button>
    </div>
    <div class="sup-plus">${plus ? '✨ Du bist Plus-Mitglied – deine Anfragen werden bevorzugt beantwortet.' : '✨ ' + esc(cfg.plus || 'Plus-Mitglieder bekommen bevorzugt eine Antwort.')}</div>
    ${SUP.tickets.length ? `<div class="h2">Meine Anfragen</div><div class="list">${SUP.tickets.slice(0, 8).map(t => `<button class="row" data-action="sup-open" data-id="${t.id}"><span style="font-size:20px">${SUP_ICON[t.category] || '💬'}</span><span class="grow"><b>${esc(t.subject)}</b><small>${(SUP_STATUS[t.status] || ['',''])[0]} · ${supAgo(t.updated_at)}</small></span>${t.user_unread ? '<span class="sup-badge">neu</span>' : ''}${I.chev}</button>`).join('')}</div>` : ''}
    <div class="h2">Häufige Fragen</div>
    <input class="input" id="sup-q" placeholder="Frage suchen, z. B. „Einladen"" aria-label="Häufige Fragen durchsuchen" autocomplete="off">
    <div class="card sup-faq" id="sup-faq">${[...FAQ2, ...FAQ].map(([q, a], i) => `<details data-q="${esc((q + ' ' + a).toLowerCase())}"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}<div class="muted sup-none" hidden>Nichts gefunden – schreib uns einfach im Live-Chat.</div></div>`, keep);
}
function supAgo(ts){ const m = Math.round((Date.now() - Date.parse(ts)) / 6e4); if (m < 2) return 'gerade eben'; if (m < 60) return `vor ${m} Min`; const h = Math.round(m / 60); if (h < 24) return `vor ${h} Std`; return agoText(ts); }

function openSupNew(keep){
  SUP.view = 'new'; supSheet(openSupNew);
  const cat = SUP.cat, banned = D.profile?.banned;
  const back = banned ? '' : `<button class="linkbtn sup-back" data-action="help">‹ Hilfe</button>`;
  if (!cat){
    openSheet(`${back}${sheetHead('Worum geht es?')}<div class="list">${SUP_CATS.map(([k, e, l]) => `<button class="row" data-action="sup-cat" data-v="${k}"><span style="font-size:20px">${e}</span><span class="grow"><b>${l}</b></span>${I.chev}</button>`).join('')}</div>`, keep); return;
  }
  if (cat === 'notfall' && !SUP.sub){
    openSheet(`${back}${sheetHead('🚨 Notfall')}<p class="muted" style="margin:0 0 12px">Was ist passiert? Notfälle sehen wir als Erstes.</p><div class="list">${SUP_NOT.map(([k, e, l]) => `<button class="row" data-action="sup-sub" data-v="${k}"><span style="font-size:20px">${e}</span><span class="grow"><b>${l}</b></span>${I.chev}</button>`).join('')}</div>`, keep); return;
  }
  const n = cat === 'notfall' ? SUP_NOT.find(x => x[0] === SUP.sub) : null;
  const title = cat === 'chat' ? '💬 Live-Chat' : cat === 'sperre' ? '🛟 Support' : n ? n[1] + ' ' + n[2] : (SUP_CATS.find(x => x[0] === cat) || [, '', 'Anfrage'])[1] + ' ' + (SUP_CATS.find(x => x[0] === cat) || [,, 'Anfrage'])[2];
  const hint = cat === 'sperre' ? 'Erklär kurz, warum die Sperre deiner Meinung nach ein Fehler ist.' : cat === 'chat' ? 'Schreib einfach los – wir antworten hier im Chat.' : 'Beschreib kurz, was passiert ist.';
  openSheet(`${back}${sheetHead(title)}
    ${n ? `<div class="sup-tip">💡 ${esc(n[3])}</div>` : ''}
    ${cat === 'sperre' ? `<p class="muted" style="margin:0 0 12px">Deine Nachricht geht direkt an das Team von „Was gibt's?". Die Antwort siehst du hier in der App.</p>` : ''}
    ${!['chat','sperre','notfall'].includes(cat) ? `<div class="field"><label for="sup-subj">Betreff</label><input id="sup-subj" class="input" maxlength="100" placeholder="Kurz in ein paar Worten"></div>` : ''}
    <div class="field"><label for="sup-text">${cat === 'chat' ? 'Deine Nachricht' : 'Was ist passiert?'}</label><textarea id="sup-text" class="input" rows="5" maxlength="2000" placeholder="${hint}"></textarea></div>
    <button class="btn ${cat === 'notfall' ? 'btn-tomato' : 'btn-herb'} btn-block" data-action="sup-send">${cat === 'notfall' ? 'Notfall senden' : 'Senden'}</button>
    ${plusActive() && cat !== 'notfall' ? '<p class="muted" style="text-align:center;font-size:13px;margin:10px 0 0">✨ Als Plus-Mitglied bevorzugt</p>' : ''}`, keep);
}

async function openTicket(keep){
  SUP.view = 'ticket'; supSheet(openTicket);
  const t = SUP.tickets.find(x => x.id === SUP.tid); if (!t){ openHelp(); return; }
  if (!SUP.msgs[t.id]){ SUP.msgs[t.id] = []; sb.from('support_messages').select('*').eq('ticket_id', t.id).order('created_at').then(({ data }) => { SUP.msgs[t.id] = data || []; supRefresh(); }); }
  if (t.user_unread){ t.user_unread = false; sb.rpc('support_seen', { tid:t.id }).then(()=>{}, ()=>{}); }
  const ms = SUP.msgs[t.id], [sl, sc] = SUP_STATUS[t.status] || ['', ''];
  const back = D.profile?.banned ? '' : `<button class="linkbtn sup-back" data-action="help">‹ Hilfe</button>`;
  openSheet(`${back}${sheetHead(esc(t.subject))}
    <div class="sup-meta"><span class="chip ${sc}">${sl}</span>${t.priority === 'notfall' ? '<span class="chip c-tomato">🚨 Notfall</span>' : t.priority === 'plus' ? '<span class="chip c-herb">✨ Plus</span>' : ''}<span class="muted">${SUP.online ? '🟢 Support online' : ''}</span></div>
    <div class="sup-chat" id="sup-chat">${ms.map(m => `<div class="bub ${m.from_support ? 'them' : 'me'}">${m.from_support ? '<b>Support</b>' : ''}<span>${esc(m.body)}</span><small>${new Date(m.created_at).toLocaleString('de-DE', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</small></div>`).join('') || '<div class="muted" style="text-align:center;padding:20px">Lädt …</div>'}
      ${ms.length && t.last_from === 'user' && t.status !== 'geloest' ? `<div class="sup-wait">${SUP.online ? 'Der Support ist online und antwortet gleich.' : 'Wir haben deine Nachricht und melden uns hier.'}</div>` : ''}</div>
    ${t.status === 'geloest' ? `<div class="sup-rate">${t.rating ? (t.rating > 0 ? 'Danke! Schön, dass wir helfen konnten 💚' : 'Danke für deine ehrliche Bewertung – wir werden besser.') : `<span>Hat dir das geholfen?</span><div><button class="btn btn-line btn-sm" data-action="sup-rate" data-v="1">👍 Ja</button><button class="btn btn-line btn-sm" data-action="sup-rate" data-v="-1">👎 Nein</button></div>`}</div>` : ''}
    <form class="sup-input" id="sup-form" autocomplete="off"><textarea id="sup-reply" class="input" rows="1" maxlength="2000" placeholder="${t.status === 'geloest' ? 'Noch eine Frage? Schreib einfach weiter' : 'Nachricht schreiben …'}" aria-label="Nachricht"></textarea><button class="btn btn-herb" type="submit" aria-label="Senden">➤</button></form>
    ${t.status !== 'geloest' ? `<button class="linkbtn" style="display:block;margin:10px auto 0;color:var(--muted);font-size:13px" data-action="sup-close">Problem gelöst? Anfrage schließen</button>` : ''}`, keep);
  const c = $('#sup-chat'); if (c) c.scrollTop = c.scrollHeight;
  const sh = $('.sheet'); if (sh && !keep) setTimeout(() => { sh.scrollTop = sh.scrollHeight; }, 50); else if (sh) sh.scrollTop = sh.scrollHeight;
}

function openReport(keep){
  supSheet(openReport); SUP.view = 'report';
  const r = SUP.rep || {};
  openSheet(`${sheetHead('⚑ Melden')}<p class="muted" style="margin:0 0 12px">Was stimmt mit dem ${r.k === 'note' ? 'Kommentar' : 'Beitrag'} nicht? Die Person erfährt nicht, wer gemeldet hat.</p>
    <div class="card" style="font-size:14px;margin-bottom:12px">„${esc(r.body || '')}"</div>
    <div class="sup-chips">${['Spam','Beleidigung','Unangemessen','Etwas anderes'].map(x => `<button class="chip-btn" data-action="rep-why" data-v="${x}" aria-pressed="${r.why === x}">${x}</button>`).join('')}</div>
    <div class="field" style="margin-top:12px"><textarea id="rep-text" class="input" rows="3" maxlength="500" placeholder="Optional: Was ist passiert?"></textarea></div>
    <button class="btn btn-tomato btn-block" data-action="rep-send">Melden</button>`, keep);
}

async function supCreate(cat, subj, body, rep){
  let tid = null, err = null;
  if (SUP.ok !== false){
    const r = await sb.rpc('support_open', { cat, subj, body, plus: plusActive(), rkind: rep ? rep.k : null, rid: rep ? rep.id : null, rtext: rep ? rep.body : null });
    if (r.error){ err = r.error; if (!/does not exist|schema cache|function/i.test(r.error.message || '')) throw new Error(r.error.message); } else tid = r.data;
  }
  if (!tid){   // ältere Datenbank: als Feedback senden
    const msg = `[${cat}] ${subj ? subj + ': ' : ''}${body}${rep ? ` (gemeldet: „${rep.body}")` : ''}`;
    let { error } = await sb.from('feedback').insert({ user_id:D.user.id, kind:'support', message:msg, app_version:VERSION });
    if (error) ({ error } = await sb.from('feedback').insert({ user_id:D.user.id, kind:'fehler', message:'[Support] ' + msg, app_version:VERSION }));
    if (error) throw error;
    return null;
  }
  await loadSupport(); return tid;
}

document.addEventListener('input', e => {
  if (e.target.id === 'sup-q'){ const q = e.target.value.trim().toLowerCase(); let n = 0;
    document.querySelectorAll('#sup-faq details').forEach(d => { const on = !q || d.dataset.q.includes(q); d.hidden = !on; if (on) n++; if (q && on) d.open = true; });
    const no = $('#sup-faq .sup-none'); if (no) no.hidden = n > 0; }
  if (e.target.id === 'sup-reply'){ e.target.style.height = 'auto'; e.target.style.height = Math.min(140, e.target.scrollHeight) + 'px'; }
});
document.addEventListener('submit', async e => {
  if (e.target.id !== 'sup-form') return; e.preventDefault();
  const ta = $('#sup-reply'), body = ta.value.trim(); if (!body) return;
  const t = SUP.tickets.find(x => x.id === SUP.tid); if (!t) return;
  ta.value = ''; const tmp = { id:'tmp' + Date.now(), ticket_id:t.id, from_support:false, body, created_at:new Date().toISOString() };
  SUP.msgs[t.id].push(tmp); t.last_from = 'user'; if (t.status === 'geloest') t.status = 'offen'; supRefresh();
  const { data, error } = await sb.from('support_messages').insert({ ticket_id:t.id, body, from_support:false }).select().single();
  const list = SUP.msgs[t.id]; const i = list.indexOf(tmp);
  if (error){ list.splice(i, 1); supRefresh(); toast('Nachricht konnte nicht gesendet werden'); ta.value = body; return; }
  if (i >= 0){ if (list.some(x => x.id === data.id)) list.splice(i, 1); else list[i] = data; }
  supRefresh();
});
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-action]'); if (!t) return;
  const a = t.dataset.action; if (!/^(help|sup-|report$|rep-)/.test(a)) return;
  try { switch (a){
    case 'help': openHelp(); break;
    case 'sup-new': await (SUP.ok === null ? loadSupport() : null); SUP.cat = t.dataset.v || null; SUP.sub = null;
      if (SUP.cat === 'chat'){ const open = SUP.tickets.find(x => x.category === 'chat' && x.status !== 'geloest'); if (open){ SUP.tid = open.id; supSubscribe(); openTicket(); break; } }
      if (SUP.cat === 'sperre'){ const open = SUP.tickets.find(x => x.category === 'sperre' && x.status !== 'geloest'); if (open){ SUP.tid = open.id; supSubscribe(); openTicket(); break; } }
      openSupNew(); break;
    case 'sup-cat': SUP.cat = t.dataset.v; openSupNew(); break;
    case 'sup-sub': SUP.sub = t.dataset.v; openSupNew(); break;
    case 'sup-send': {
      const body = $('#sup-text').value.trim(); if (!body){ toast('Bitte schreib kurz etwas'); $('#sup-text').focus(); break; }
      const cat = SUP.cat, n = SUP_NOT.find(x => x[0] === SUP.sub);
      const subj = ($('#sup-subj') && $('#sup-subj').value.trim()) || (cat === 'chat' ? 'Live-Chat' : cat === 'sperre' ? 'Frage zur Sperre' : n ? 'Notfall: ' + n[2] : (SUP_CATS.find(x => x[0] === cat) || [,, 'Anfrage'])[2]);
      t.disabled = true; t.textContent = 'Sende …';
      const tid = await supCreate(cat, subj, body);
      if (tid){ SUP.tid = tid; supSubscribe(); openTicket(); toast(cat === 'notfall' ? '🚨 Notfall ist angekommen – wir kümmern uns zuerst darum' : 'Angekommen – die Antwort siehst du hier'); }
      else { closeSheet(); render(); toast('Deine Nachricht ist beim Support angekommen 💚'); }
      break; }
    case 'sup-open': SUP.tid = t.dataset.id; openTicket(); break;
    case 'sup-rate': { const tk = SUP.tickets.find(x => x.id === SUP.tid); if (!tk) break; tk.rating = +t.dataset.v; supRefresh(); await sb.rpc('support_rate', { tid:tk.id, val:+t.dataset.v }); break; }
    case 'sup-close': { const tk = SUP.tickets.find(x => x.id === SUP.tid); if (!tk) break; tk.status = 'geloest'; supRefresh(); const { error } = await sb.rpc('support_close', { tid:tk.id }); if (error) throw error; toast('Anfrage geschlossen ✓'); break; }
    case 'report': { const k = t.dataset.k, id = t.dataset.id; const item = (k === 'note' ? D.notes : D.board).find(x => x.id === id); if (!item) break;
      SUP.rep = { k, id, body: item.body, why: null }; openReport(); break; }
    case 'rep-why': SUP.rep.why = t.dataset.v; document.querySelectorAll('[data-action=rep-why]').forEach(b => b.setAttribute('aria-pressed', b === t)); break;
    case 'rep-send': { const r = SUP.rep; if (!r.why){ toast('Bitte wähle einen Grund'); break; }
      t.disabled = true; const extra = $('#rep-text').value.trim();
      await supCreate('melden', 'Meldung: ' + r.why, extra || r.why, r);
      closeSheet(); render(); toast('Danke – wir schauen uns das an'); break; }
  } } catch(err){ t.disabled = false; toast(/[A-Za-zÄÖÜ]{3,}.*[.!–]/.test(err && err.message || '') && !/[_(]|error|exception/i.test(err.message) ? err.message : errText(err)); }
});


/* =========================================================================
   VERSION 4.3 – PiHILL „im Augenwinkel"
   Kleine, immer gleich aussehende Hinweise an ruhigen Stellen (Ende von Listen,
   nach Erfolgsmomenten). Wiedererkennung durch gleiches Format, Abwechslung durch
   wechselnde Texte. Immer als „Anzeige" gekennzeichnet (Pflicht in Deutschland).
   ========================================================================= */
const SP_LINES = [
  ['🧶','Kuschelig wie Omas Küche: gehäkelte Ponchos & Loop-Schals'],
  ['✨','Gemütlich essen mit Licht: Lichterkugeln in Häkeloptik'],
  ['🏮','Laternen & Leuchtpilze – Deko, die leuchtet'],
  ['🪢','Makramee & Fensterdeko für eure Küche'],
  ['🎁','Kleine handgemachte Geschenke – jedes ein Unikat'],
  ['🎄','Holz-Weihnachtsbäume & Anhänger für die Adventszeit'],
  ['🧥','Strickjacken in Handarbeit – warm durch den Winter'],
];
function spHint(seed){
  const [e, t] = SP_LINES[(Math.floor(Date.now() / 36e5) + (seed || 0)) % SP_LINES.length];
  return `<button class="sp-hint" data-action="sponsor" aria-label="Anzeige von PiHILL: ${esc(t)}"><img src="${SPONSOR.logo}" alt=""><span class="grow"><b>${e} ${esc(t)}</b><small>PiHILL · handgemacht</small></span><span class="sp-hint-ad">Anzeige</span></button>`;
}
{
  const wrap = (fn, seed) => function(){ const out = fn.apply(this, arguments); return typeof out === 'string' && D.user && !(D.profile && D.profile.banned) ? out + spHint(seed) : out; };
  viewFridge = wrap(viewFridge, 1); viewWeek = wrap(viewWeek, 3); viewFamily = wrap(viewFamily, 4);
  const _or = openRecipe;
  openRecipe = function(id, keep){ const r = _or.apply(this, arguments);
    const sh = document.querySelector('.sheet'); if (sh && !sh.querySelector('.sp-hint')) sh.insertAdjacentHTML('beforeend', `<div style="margin-top:14px">${spHint(5)}</div>`); return r; };
}


/* =========================================================================
   VERSION 4.4 – Rückgängig, bessere Suche, Ladenreihenfolge, leere Seiten
   ========================================================================= */
/* Unten kurz „Gelöscht · Rückgängig" statt vorher „Sicher?" zu fragen */
function undoToast(msg, undo, ms = 5000){
  const t = $('#toast'); clearTimeout(t._h);
  t.innerHTML = `<span>${esc(msg)}</span><button class="undo-btn" type="button">Rückgängig</button>`;
  t.classList.add('show', 'undo');
  const b = t.querySelector('.undo-btn');
  b.onclick = ev => { ev.stopPropagation(); clearTimeout(t._h); t.classList.remove('show', 'undo'); try { undo(); } catch(e){} buzz(10); setTimeout(() => toast('Wiederhergestellt ↩︎'), 250); };
  t._h = setTimeout(() => t.classList.remove('show', 'undo'), ms);
}
function restoreShop(items){
  const rows = items.map(({ id, created_at, ...r }) => ({ ...r }));
  const tmp = items.map(x => ({ ...x, id:'tmp' + Math.random().toString(36).slice(2) }));
  D.shop.push(...tmp); paintSoft();
  save(async () => { const r = await sb.from('shopping_items').insert(rows.map(r => { const o = { family_id:r.family_id, ing_key:r.ing_key || null, label:r.label || null, added_by:r.added_by, checked:!!r.checked };
      if (D.cap.shop3){ if (r.note) o.note = r.note; if (r.list) o.list = r.list; if (r.assigned_to) o.assigned_to = r.assigned_to; } return o; })).select();
    (r.data || []).forEach((row, i) => tmp[i] && Object.assign(tmp[i], row)); return r; }).catch(e => toast(errText(e)));
}

/* Suche verzeiht Tippfehler – jetzt auch im Kühlschrank und in der Einkaufsliste */
function ingMatch(k, q){
  if (!q) return 1; const n = norm(ING[k][0]), t = norm(q);
  if (n.startsWith(t)) return 3; if (n.includes(t)) return 2;
  if (t.length >= 4){ const tol = t.length >= 7 ? 2 : 1; const w = n.split(/[^a-z0-9]+/);
    if (w.some(x => editDist(x, t, tol) <= tol || (x.length > t.length && editDist(x.slice(0, t.length), t, tol) <= tol))) return 1; }
  return 0;
}

/* Frei getippte Einträge („Klopapier", „Brötchen") landen im richtigen Bereich statt unter „Sonstiges" */
const AISLE_WORDS = [
  ['getraenke', /wasser|saft|cola|limo|bier|wein|kaffee|tee|sprudel|getränk|kakao/],
  ['haushalt', /klopapier|toilettenpapier|küchenrolle|spül|waschmittel|müllbeutel|zahnpasta|shampoo|seife|duschgel|deo|windel|taschentuch|schwamm|alufolie|frischhaltefolie|batterie|kerze/],
  ['obst', /apfel|äpfel|banane|birne|traube|orange|mandarine|clementine|zitrone|limette|beere|kiwi|mango|ananas|melone|pfirsich|pflaume|obst/],
  ['gemuese', /salat|gurke|tomate|paprika|zwiebel|knoblauch|kartoffel|möhre|karotte|zucchini|brokkoli|kohl|spinat|pilz|champignon|lauch|sellerie|kräuter|petersilie|basilikum|ingwer|gemüse|avocado|mais/],
  ['getreide', /brot|brötchen|toast|baguette|nudel|spaghetti|reis|mehl|haferflocken|müsli|cornflakes|wrap|tortilla|knäcke|semmel|croissant/],
  ['milch', /milch|joghurt|quark|käse|butter|sahne|schmand|ei(er)?$|eier|frischkäse|mozzarella|feta|parmesan/],
  ['kuehl', /tiefkühl|tk-|eis$|eiscreme|pizza|fischstäbchen|pommes|aufschnitt|wurst|tofu|hummus/],
  ['fleisch', /fleisch|hähnchen|hühnchen|rind|schwein|hack|wurst|schinken|speck|lachs|fisch|thunfisch|garnele/],
  ['dose', /dose|konserve|passata|tomatenmark|bohnen|kichererbsen|linsen|mais|glas|marmelade|nutella|honig|pesto|oliven/],
  ['backen', /zucker|backpulver|hefe|schokolade|kekse|kuchen|vanille|puderzucker|chips|süß|gummibär|snack/],
  ['wuerz', /salz|pfeffer|öl|essig|senf|ketchup|mayo|soße|sauce|gewürz|brühe|curry|paprikapulver/],
];
AISLES.push(['getraenke','🥤 Getränke'], ['haushalt','🧻 Haushalt & Drogerie']);
aisleOf = function(x){
  if (x.ing_key){ const c = CATS.find(c => c[3].includes(x.ing_key)); return c ? c[0] : 'other'; }
  const l = String(x.label || '').toLowerCase().trim(); if (!l) return 'other';
  const k = Object.keys(ING).find(k => norm(ING[k][0]) === norm(l)); if (k){ const c = CATS.find(c => c[3].includes(k)); if (c) return c[0]; }
  const hit = AISLE_WORDS.find(([, re]) => re.test(l)); return hit ? hit[0] : 'other';
};
