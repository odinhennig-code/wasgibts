/* =========================================================================
   WAS GIBT'S? – Familien-Essensplaner
   Aufbau: Verbindung → Daten laden → Logik → Ansichten → Ereignisse
   Daten liegen in Supabase (siehe supabase/schema.sql).
   ========================================================================= */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { ING, ingName, ingEmoji, R, recipe, ALLERGENS, TRAITS, allergensOf, MEAT, FISH, CATS } from './data.js';

const configured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/* ---------- Zustand ---------- */
const D = { user:null, profile:null, membership:null, family:null, members:[], profiles:{}, wishes:[], fridge:[], expiries:{}, custom:[], poll:null, votes:[], shop:[], plan:[], ann:null, appAdmin:false };
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
function buzz(ms=12){ try { navigator.vibrate && navigator.vibrate(ms); } catch(e){} }
function toast(m){ const t=$('#toast'); t.textContent=m; t.classList.add('show'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'),2600); }
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
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Keine Verbindung. Prüfe dein Internet.';
  return 'Etwas ist schiefgelaufen: ' + m;
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
  let { data: p } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (!p){ // Profil beim ersten Login aus den Registrierungsdaten anlegen
    const meta = D.user.user_metadata || {};
    const ins = await sb.from('profiles').insert({ id: uid, name: (meta.name || 'Ich').slice(0,30), avatar: meta.avatar || '🧑' }).select().single();
    p = ins.data;
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
  Object.assign(N, { family:null, members:[], wishes:[], fridge:[], expiries:{}, custom:[], poll:null, votes:[], shop:[], plan:[] });
  if (N.membership){
    const fid = N.membership.family_id;
    const { data: fam } = await sb.from('families').select('*').eq('id', fid).maybeSingle();
    N.family = fam;
    if (N.membership.status === 'active'){
      const [mem, wis, fr, cus, pol, shp, pln] = await Promise.all([
        sb.from('memberships').select('*').eq('family_id', fid).order('created_at'),
        sb.from('wishes').select('*').eq('family_id', fid),
        sb.from('fridges').select('*').eq('family_id', fid).maybeSingle(),
        sb.from('custom_recipes').select('*').eq('family_id', fid).order('created_at'),
        sb.from('polls').select('*').eq('family_id', fid).order('created_at', { ascending:false }).limit(1),
        sb.from('shopping_items').select('*').eq('family_id', fid).order('created_at'),
        sb.from('meal_plan').select('*').eq('family_id', fid).gte('day', isoDay(new Date())),
      ]);
      N.shop = shp.data || []; N.plan = pln.data || [];
      N.members = mem.data || []; N.wishes = wis.data || []; N.fridge = (fr.data && fr.data.items) || [];
      N.expiries = (fr.data && fr.data.expiries) || {};
      N.custom = (cus.data || []).map(c => ({ id:'c_'+c.id, dbid:c.id, n:c.name, e:c.emoji, t:c.minutes, m:c.mood, i:c.ingredients||[], o:c.optional||[], x:c.traits||[], s:c.steps||[], custom:true, by:c.created_by }));
      N.poll = (pol.data && pol.data[0]) || null;
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
  Object.assign(D, N);
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
    .subscribe();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && D.user) scheduleReload(); });

/* ---------- Rezepte: feste Sammlung + eigene Familienrezepte ---------- */
const RX = () => [...R, ...D.custom];
/* Datum als JJJJ-MM-TT in Ortszeit */
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const nextDays = n => Array.from({ length:n }, (_, i) => { const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate() + i); return d; });
const planFor = iso => D.plan.find(p => p.day === iso);

/* ---------- Einkaufsliste ---------- */
const openShop = () => D.shop.filter(x => !x.checked);
const onList = k => D.shop.some(x => !x.checked && x.ing_key === k);
async function addToList(keys = [], label = ''){
  const rows = [];
  [...new Set(keys)].filter(k => ING[k] && !onList(k)).forEach(k => rows.push({ family_id:D.family.id, ing_key:k, added_by:D.user.id }));
  if (label) rows.push({ family_id:D.family.id, label:label.slice(0,60), added_by:D.user.id });
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
      return { r, missing, wishers, favs, cover, uses, score: wishers.length*40 + favs.length*14 + cover*60 - missing.length*8 + uses.length*30 + mealAdj(r) };
    }).sort((a,b)=>b.score-a.score);
}
function whyLines(s){
  const l=[];
  if (s.wishers.length) l.push(`🙋 ${esc(names(s.wishers.map(id=>prof(id).name)))} ${s.wishers.length>1?'haben':'hat'} sich das gewünscht`);
  if (s.favs.length) l.push(`❤️ Lieblingsessen von ${esc(names(s.favs.map(p=>p.name)))}`);
  if (s.uses && s.uses.length) l.push(`⏰ Verbraucht ${esc(names(s.uses.map(ingName)))}, läuft bald ab`);
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
  const show = D.user && isActive();
  $('#tabbar').hidden = !show; if (!show) return;
  const p = isAdmin() ? pendingReq().length : 0;
  const tabs = [['home','Heute',I.home],['fridge','Kühlschrank',I.fridge],['recipes','Planen',I.book],['family','Familie',I.family],['more','Mehr',I.more]];
  $('#tabbar').innerHTML = tabs.map(([id,l,ic]) => `<button class="tab" data-tab="${id}" ${UI.tab===id?'aria-current="page"':''}>${ic}<span>${l}</span>${id==='family'&&p?`<span class="dot">${p}</span>`:''}</button>`).join('');
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
    <div class="r-hero">${p.avatar}</div>
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
    <button class="avatar" data-tab="family" aria-label="Familie und Profil">${D.profile.avatar}</button></div>`;
}
function suggestionCard(s){
  return `<button class="rc" data-action="open-recipe" data-id="${s.r.id}">
    ${photoEm(s.r)}
    <div class="main"><div class="t">${esc(s.r.n)}</div>
      <div class="s"><span>⏱ ${s.r.t} Min</span>${s.wishers.length?`<span class="chip c-tomato">🙋 ${s.wishers.length}</span>`:''}${s.favs.length?`<span class="chip c-tomato">❤️ ${s.favs.length}</span>`:''}${s.r.m==='fast'?'<span class="chip c-yolk">Fastfood</span>':s.r.m==='gesund'?'<span class="chip c-herb">Gesund</span>':''}</div>
      ${s.missing.length?`<div class="s" style="margin-top:4px"><span class="chip c-yolk">🛒 ${s.missing.map(ingName).join(', ')}</span></div>`:'<div class="meter"><i style="width:100%"></i></div>'}</div>${I.chev}</button>`;
}
function viewHome(){
  const eat = eatersNow(), all = suggest();
  /* Nur zeigen, was mit dem Kühlschrank wirklich geht – plus Ideen mit genau einem Einkauf */
  const ready0 = all.filter(s => s.missing.length===0), almost = all.filter(s => s.missing.length===1);
  const top = ready0.find(s => s.r.meal !== 'suess'), ready = top ? [top, ...ready0.filter(s => s !== top)] : [];
  const h = new Date().getHours(), greet = h<11?'Guten Morgen':h<17?'Hallo':'Guten Abend';
  const p = isAdmin() ? pendingReq() : [];
  return header(`Was gibt's heute, ${esc(D.profile.name)}?`, greet) + annBanner() +
    (p.length ? `<button class="banner" data-tab="family"><span class="avatar sm">${prof(p[0].user_id).avatar}</span><span style="flex:1"><b>${esc(prof(p[0].user_id).name)}</b> möchte deiner Familie beitreten</span>${I.chev}</button>` : '') +
    (expiringSoon().length ? `<button class="banner" style="background:var(--tomato-soft)" data-tab="fridge"><span style="font-size:22px">⏰</span><span style="flex:1"><b>Bald aufbrauchen:</b> ${expiringSoon().map(x=>`${esc(ingName(x.k))} (${expLabel(x.d)})`).join(', ')}</span>${I.chev}</button>` : '') +
    `<div class="filters card">
      <div class="who sm" role="group" aria-label="Wer isst mit">${active().map(m=>{ const a=prof(m.user_id); return `<button data-action="eater" data-id="${a.id}" aria-pressed="${eat.includes(a.id)}"><span class="avatar">${a.avatar}</span>${esc(a.name)}</button>`; }).join('')}</div>
      <div class="frow">
        <div class="seg mini" role="group" aria-label="Zeit">${[[15,'15′'],[30,'30′'],[60,'Egal']].map(([v,l])=>`<button data-action="time" data-v="${v}" aria-pressed="${UI.time===v}" aria-label="${v===60?'Zeit egal':v+' Minuten'}">${l}</button>`).join('')}</div>
        <div class="seg mini" role="group" aria-label="Lust">${[['gesund','🥗'],['egal','Egal'],['fast','🍔']].map(([v,l])=>`<button data-action="mood" data-v="${v}" aria-pressed="${UI.mood===v}" aria-label="${v==='gesund'?'Gesund':v==='fast'?'Fastfood':'Egal'}">${l}</button>`).join('')}</div>
      </div>
    </div>
    ${todayPlanned()}
    ${pollBlock(all)}
    <div class="h2">${planFor(isoDay(new Date())) ? 'Oder spontan' : 'Du könntest machen'}</div>
    ${planFor(isoDay(new Date())) && ready.length ? `<div class="stack">${ready.filter(x => x.r.id !== planFor(isoDay(new Date())).recipe_id).slice(0,4).map(suggestionCard).join('')}</div>` : top ? `<button class="pick" data-action="open-recipe" data-id="${top.r.id}">${pickArt(top.r)}
        <div class="lbl">UNSER VORSCHLAG</div><div class="name">${esc(top.r.n)}</div>
        <div class="why">${whyLines(top).map(l=>`<span>${l}</span>`).join('')}</div>
        <div class="meta"><span class="chip">⏱ ${top.r.t} Min</span><span class="chip">Passt für ${eat.length===active().length?'alle':eat.length+' Personen'}</span></div></button>
      <button class="btn btn-tomato btn-block" style="margin-top:10px" data-action="cook" data-id="${top.r.id}">👨‍🍳 Jetzt kochen</button>
      ${ready.length>1?`<div class="h2">Geht auch <span class="chip c-muted">${ready.length-1}</span></div><div class="stack">${ready.slice(1,8).map(suggestionCard).join('')}</div>`:''}`
    : `<div class="card empty"><div class="g">🧊</div><b>Mit dem, was da ist, passt noch kein Rezept</b>Trag im Kühlschrank ein, was du hast, oder schau unten, was mit einem Einkauf geht.<button class="btn btn-line btn-block" style="margin-top:12px" data-tab="fridge">Kühlschrank öffnen</button></div>`}
    ${almost.length?`<div class="h2">Mit einem kleinen Einkauf <span class="chip c-muted">${almost.length}</span></div><div class="stack">${almost.slice(0,6).map(suggestionCard).join('')}</div>`:''}
    ${showPlusWidget() ? plusWidget() : ''}`;
}
/* Heute im Wochenplan */
function todayPlanned(){
  const p = planFor(isoDay(new Date())), r = p && rec(p.recipe_id); if (!r) return '';
  const miss = r.i.filter(k => !D.fridge.includes(k));
  return `<div class="h2">Heute auf dem Plan</div>
    <button class="pick planned" data-action="open-recipe" data-id="${r.id}">${pickArt(r)}
      <div class="lbl">📅 WOCHENPLAN</div><div class="name">${esc(r.n)}</div>
      <div class="why"><span>${miss.length ? `🛒 Es fehlt noch: ${esc(miss.map(ingName).join(', '))}` : '✅ Du hast alles da'}</span></div>
      <div class="meta"><span class="chip">⏱ ${r.t} Min</span>${p.set_by && p.set_by !== D.user.id ? `<span class="chip">Geplant von ${esc(prof(p.set_by).name)}</span>` : ''}</div></button>
    <div style="display:grid;grid-template-columns:${miss.length ? '1fr 1fr' : '1fr'};gap:8px;margin-top:10px">
      <button class="btn btn-tomato" data-action="cook" data-id="${r.id}">👨‍🍳 Jetzt kochen</button>
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
  const match = k => !q || ING[k][0].toLowerCase().includes(q);
  const chip = k => `<button class="ing ${UI.justAdded&&UI.justAdded.includes(k)?'just':''}" data-action="ing" data-k="${k}" aria-pressed="${fr.has(k)}">${ING[k][1]} ${ING[k][0]}${expTag(k)}</button>`;
  const onlyHave = UI.fonly === 'have';
  if (!UI.recentSnap) UI.recentSnap = [...(L.recentIng || [])];
  const recent = UI.recentSnap.filter(k => ING[k] && match(k)).slice(0, 8);
  const cats = CATS.map(([id, e, title, keys]) => {
    const ks = keys.filter(k => match(k) && (!onlyHave || fr.has(k)));
    if (!ks.length) return '';
    const have = keys.filter(k => fr.has(k)).length;
    return `<div class="h2">${e} ${title} <span class="chip c-muted">${have} da</span></div><div class="chips">${ks.map(chip).join('')}</div>`;
  }).join('');
  const html = header('Was ist da?', `${D.fridge.length} Zutaten · für alle sichtbar`) + tabs +
    `<button class="photo-card" data-action="photo"><span class="cam">${I.cam}</span><span style="flex:1"><b style="font-size:17px">Kühlschrank fotografieren</b><br><span style="opacity:.9;font-size:14px">Die App erkennt deine Zutaten automatisch</span></span></button>
    <div id="scanArea"></div>
    ${plusHint('fridge')}
    <div class="fbar"><input id="fsearch" class="input" type="search" placeholder="Zutat suchen …" value="${esc(UI.fq||'')}" aria-label="Zutat suchen" autocomplete="off">
      <div class="seg mini" role="group"><button data-action="fonly" data-v="all" aria-pressed="${!onlyHave}">Alle</button><button data-action="fonly" data-v="have" aria-pressed="${onlyHave}">Da</button></div></div>
    ${recent.length && !onlyHave ? `<div class="h2">🕘 Zuletzt benutzt</div><div class="chips">${recent.map(chip).join('')}</div>` : ''}
    ${cats || `<div class="card empty"><div class="g">🔍</div><b>Nichts gefunden</b>${q ? `<button class="btn btn-line btn-block" style="margin-top:12px" data-action="shop-free" data-v="${esc(UI.fq)}">„${esc(UI.fq)}" auf die Einkaufsliste</button>` : 'Tipp oben auf „Alle".'}</div>`}
    <button class="btn btn-line btn-block" style="margin-top:16px" data-action="expiry">📅 Haltbarkeit eintragen</button>
    <p class="muted" style="font-size:13px;margin-top:12px">Salz, Pfeffer, Öl, Zucker und Gewürze setzen wir als vorhanden voraus.</p>
    <button class="btn btn-line btn-block" style="margin-top:6px" data-action="clear-fridge">Alles abwählen</button>`;
  UI.justAdded = null; return html;
}
function viewShopping(){
  const open = openShop(), done = D.shop.filter(x => x.checked), q = (UI.sq || '').trim().toLowerCase();
  const sugg = q ? Object.keys(ING).filter(k => ING[k][0].toLowerCase().includes(q)).sort((a,b) => ING[a][0].toLowerCase().indexOf(q) - ING[b][0].toLowerCase().indexOf(q)).slice(0, 6) : [];
  const row = x => `<div class="shop-row ${x.checked?'done':''}" data-id="${x.id}">
      <button class="tick" data-action="shop-toggle" data-id="${x.id}" aria-label="${x.checked?'Wieder offen':'Abhaken'}" aria-pressed="${x.checked}">✓</button>
      <span class="grow">${shopName(x)}</span>
      ${x.added_by && x.added_by !== D.user.id ? `<span class="avatar sm" title="${esc(prof(x.added_by).name)}">${prof(x.added_by).avatar}</span>` : ''}
      <button class="x" data-action="shop-del" data-id="${x.id}" aria-label="Entfernen">${I.x}</button></div>`;
  const planned = plannedMissing();
  return `<form class="shop-add" id="shopForm" autocomplete="off"><input id="shopIn" class="input" placeholder="Was fehlt? z. B. Milch" value="${esc(UI.sq||'')}" aria-label="Zur Einkaufsliste hinzufügen"><button class="btn btn-herb" type="submit" aria-label="Hinzufügen">+</button></form>
    ${sugg.length ? `<div class="chips" style="margin:10px 0 4px">${sugg.map(k => `<button class="ing" data-action="shop-ing" data-k="${k}" ${onList(k)?'aria-pressed="true"':''}>${ING[k][1]} ${ING[k][0]}</button>`).join('')}</div>` : ''}
    ${planned.length ? `<button class="banner soft" data-action="shop-plan"><span style="font-size:22px">📅</span><span style="flex:1"><b>Für den Wochenplan fehlen ${planned.length} Zutaten</b><br><span class="muted" style="font-size:13px">${esc(planned.slice(0,4).map(ingName).join(', '))}${planned.length>4?' …':''}</span></span><span class="chip c-herb">Hinzufügen</span></button>` : ''}
    ${open.length ? `<div class="card list-card">${open.map(row).join('')}</div>`
      : `<div class="card empty"><div class="g">🛒</div><b>Die Liste ist leer</b>Füge oben etwas hinzu – oder tippe in einem Rezept auf „Fehlende Zutaten auf die Einkaufsliste".</div>`}
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
function setPlan(iso, rid){
  const ex = planFor(iso);
  if (ex) ex.recipe_id = rid; else D.plan.push({ family_id:D.family.id, day:iso, recipe_id:rid, set_by:D.user.id });
  paintSoft();
  return save(() => sb.from('meal_plan').upsert({ family_id:D.family.id, day:iso, recipe_id:rid, set_by:D.user.id, updated_at:new Date().toISOString() }, { onConflict:'family_id,day' }));
}
function clearPlan(iso){
  D.plan = D.plan.filter(p => p.day !== iso); paintSoft();
  return save(() => sb.from('meal_plan').delete().eq('family_id', D.family.id).eq('day', iso));
}
async function fillWeek(){
  const used = new Set(D.plan.map(p => p.recipe_id)), cands = planCandidates(), rows = [];
  let prev = null, fast = D.plan.filter(p => rec(p.recipe_id)?.m === 'fast').length;
  for (const d of nextDays(7)){
    const iso = isoDay(d), ex = planFor(iso);
    if (ex){ const r = rec(ex.recipe_id); prev = r ? mainKey(r) : null; continue; }
    const pick = cands.find(c => !used.has(c.r.id) && mainKey(c.r) !== prev && (c.r.m !== 'fast' || fast < 2)) || cands.find(c => !used.has(c.r.id));
    if (!pick) break;
    used.add(pick.r.id); prev = mainKey(pick.r); if (pick.r.m === 'fast') fast++;
    const row = { family_id:D.family.id, day:iso, recipe_id:pick.r.id, set_by:D.user.id };
    rows.push(row); D.plan.push({ ...row });
  }
  if (!rows.length) return 0;
  paintSoft();
  await save(() => sb.from('meal_plan').upsert(rows, { onConflict:'family_id,day' }));
  return rows.length;
}
function viewWeek(){
  const fr = new Set(D.fridge), days = nextDays(7), empty = days.filter(d => !planFor(isoDay(d))).length, miss = plannedMissing().length;
  return `<div class="week">${days.map((d, i) => { const iso = isoDay(d), p = planFor(iso), r = p && rec(p.recipe_id);
      const m = r ? r.i.filter(k => !fr.has(k)).length : 0;
      return `<div class="week-row ${i===0?'today':''}"><div class="wd"><b>${dayShort(d, i)}</b><small>${d.getDate()}.${d.getMonth()+1}.</small></div>
        ${r ? `<button class="rc" data-action="plan-day" data-v="${iso}">${photoEm(r)}<div class="main"><div class="t">${esc(r.n)}</div><div class="s"><span>⏱ ${r.t} Min</span>${m ? `<span class="chip c-yolk">🛒 ${m} fehlt</span>` : '<span class="chip c-herb">✅ alles da</span>'}${p.set_by && p.set_by !== D.user.id ? `<span>· ${esc(prof(p.set_by).name)}</span>` : ''}</div></div>${I.chev}</button>`
          : `<button class="week-empty" data-action="plan-day" data-v="${iso}">＋ Gericht wählen</button>`}</div>`; }).join('')}</div>
    <div class="week-actions">
      ${empty ? `<button class="btn btn-herb" data-action="plan-fill">✨ ${empty===7?'Woche planen':`${empty} ${empty===1?'Tag':'Tage'} füllen`}</button>` : ''}
      ${miss ? `<button class="btn btn-line" data-action="shop-plan">🛒 ${miss} Zutaten einkaufen</button>` : ''}
    </div>
    ${plusHint('week')}
    <p class="muted" style="font-size:13px;margin-top:12px">Die App wählt abwechslungsreich: Wünsche zuerst, passend für alle in der Familie, nicht zweimal hintereinander dasselbe Fleisch und höchstens zwei Fastfood-Tage.</p>`;
}
function openPlanDay(iso, keep){
  sheetFn = k => openPlanDay(iso, k);
  const d = new Date(iso + 'T12:00:00'), i = Math.round((d - new Date(isoDay(new Date()) + 'T12:00:00')) / 864e5);
  const p = planFor(iso), r = p && rec(p.recipe_id), q = (UI.pq || '').trim().toLowerCase();
  const list = q ? RX().filter(x => x.n.toLowerCase().includes(q)).slice(0, 12).map(x => ({ r:x })) : planCandidates().filter(c => !r || c.r.id !== r.id).slice(0, 8);
  openSheet(`${sheetHead(`${dayLabel(d, i)}, ${d.getDate()}.${d.getMonth()+1}.`)}
    ${r ? `<div class="card" style="display:flex;gap:12px;align-items:center;margin-bottom:12px">${photoEm(r)}<div style="flex:1;min-width:0"><b>${esc(r.n)}</b><div class="muted" style="font-size:13px">⏱ ${r.t} Min</div></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px"><button class="btn btn-ghost" data-action="open-recipe" data-id="${r.id}">Rezept öffnen</button><button class="btn btn-ghost" style="color:var(--tomato)" data-action="plan-clear" data-v="${iso}">Entfernen</button></div>` : ''}
    <div class="h2">${r ? 'Tauschen gegen' : 'Was gibt\'s an dem Tag?'}</div>
    <input id="planSearch" class="input" type="search" placeholder="Rezept suchen …" value="${esc(UI.pq||'')}" autocomplete="off" style="margin-bottom:10px">
    <div class="stack">${list.map(c => `<button class="rc" data-action="plan-set" data-v="${iso}" data-id="${c.r.id}">${photoEm(c.r)}<div class="main"><div class="t">${esc(c.r.n)}</div><div class="s"><span>⏱ ${c.r.t} Min</span>${wishersOf(c.r.id).length?`<span class="chip c-tomato">🙋 ${wishersOf(c.r.id).length}</span>`:''}</div></div></button>`).join('') || '<div class="card empty">Nichts gefunden</div>'}</div>`, keep);
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
        <div class="s"><span class="avatar-stack">${who.map(w=>`<span class="avatar sm">${prof(w).avatar}</span>`).join('')}</span><span>${esc(names(who.map(w=>prof(w).name)))}</span></div></div>${I.chev}</button>`; }).join('')}</div>`
      : `<div class="card empty"><div class="g">🙋</div><b>Noch keine Wünsche</b>Öffne ein Rezept unter „Alle" und tippe auf „Wünschen".</div>`;
  } else {
    const q = UI.q.trim().toLowerCase();
    let list = RX().filter(r => (t==='all' || (t==='favs' && favs.includes(r.id)) || (t==='fam' && r.custom)) && (!q || r.n.toLowerCase().includes(q)));
    let more = 0, hint = '';
    if (t==='all'){
      /* Nicht alle 600+ Rezepte auf einmal: nur was zu allen passt, sortiert nach dem Kühlschrank */
      const people = eatersNow().map(prof), fr = new Set(D.fridge), have = r => r.i.filter(k => fr.has(k)).length / (r.i.length || 1);
      if (!q) list = list.filter(r => people.every(p => conflicts(r,p).length===0));
      list = list.map(r => [r, have(r)]).sort((a,b) => b[1]-a[1] || a[0].n.localeCompare(b[0].n, 'de')).map(x => x[0]);
      const lim = UI.rlimit || 30; more = Math.max(0, list.length - lim); list = list.slice(0, lim);
      hint = q ? '' : `<div style="color:var(--muted);font-size:13px;margin:-4px 2px 10px">Passt zu allen, die mitessen · Was ihr schon da habt, steht oben</div>`;
    }
    body = (t==='fam' ? `<button class="btn btn-herb btn-block" style="margin-bottom:12px" data-action="new-recipe">📖 Eigenes Rezept eintragen</button>` : '') + (t==='all' ? `<input id="search" class="input" type="search" placeholder="In allen ${RX().length} Rezepten suchen" value="${esc(UI.q)}" aria-label="Rezept suchen" style="margin-bottom:12px">` + hint : '') +
      (list.length ? `<div class="stack">${list.map(r=>`<button class="rc" data-action="open-recipe" data-id="${r.id}">${photoEm(r)}<div class="main"><div class="t">${esc(r.n)}</div><div class="s"><span>⏱ ${r.t} Min</span>${r.custom?'<span class="chip c-herb">Familie</span>':''}${favs.includes(r.id)?'<span class="chip c-tomato">❤️</span>':''}${t==='all'&&D.fridge.length?(m => m===0?'<span class="chip c-herb">✅ alles da</span>':m===1?'<span class="chip c-yolk">🛒 1 fehlt</span>':'')(r.i.filter(k=>!D.fridge.includes(k)).length):''}</div></div>${I.chev}</button>`).join('')}</div>${more?`<button class="btn btn-line btn-block" style="margin-top:12px" data-action="more-recipes">Weitere ${Math.min(30, more)} anzeigen</button>`:''}`
      : t==='fam' ? `<div class="card empty"><div class="g">📖</div><b>Noch keine Familienrezepte</b>Tragt eure eigenen Lieblingsgerichte ein, zum Beispiel Omas Gulasch.</div>`
      : `<div class="card empty"><div class="g">${t==='favs'?'❤️':'🔍'}</div><b>${t==='favs'?'Noch keine Lieblingsessen':'Nichts gefunden'}</b>${t==='favs'?'Tippe in einem Rezept auf das Herz.':'Versuch es mit einem anderen Wort.'}</div>`);
  }
  return header('Planen & Rezepte', `${RX().length} Rezepte`) +
    `<div class="seg" role="group" aria-label="Ansicht">${[['week','Woche'],['wishes','Wünsche'],['favs','Lieblinge'],['fam','Familie'],['all','Alle']].map(([k,l])=>`<button data-action="rtab" data-v="${k}" aria-pressed="${t===k}">${l}</button>`).join('')}</div>
    <div style="margin-top:14px">${body}</div>`;
}
function prefText(a){ const parts=[]; if(a.picky) parts.push(`wählerisch · isst ${(a.likes||[]).length} Zutaten`); if(a.veg) parts.push('vegetarisch'); (a.dislikes||[]).forEach(d=>parts.push('keine '+(TRAITS[d]||ingName(d)))); (a.allergies||[]).forEach(x=>parts.push('ohne '+ALLERGENS[x])); return parts.join(' · ') || 'isst alles'; }
function viewFamily(){
  const p = isAdmin() ? pendingReq() : [];
  return header(esc(D.family.name), `${active().length} Mitglieder`) +
    (p.length ? `<div class="h2">Beitrittsanfragen</div><div class="stack">${p.map(m=>{ const a=prof(m.user_id); return `<div class="card" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <span class="avatar">${a.avatar}</span><div style="flex:1;min-width:140px"><b>${esc(a.name)}</b> hat sich einen Account erstellt und möchte deiner Familie beitreten.</div>
        <div style="display:flex;gap:8px;flex-basis:100%"><button class="btn btn-herb btn-sm" style="flex:1" data-action="accept" data-id="${a.id}">Annehmen</button><button class="btn btn-ghost btn-sm" style="flex:1" data-action="decline" data-id="${a.id}">Ablehnen</button></div></div>`; }).join('')}</div>` : '') +
    (isAdmin() ? `<button class="btn btn-herb btn-block" style="margin-top:6px" data-action="invite">${I.qr} Familienmitglied einladen</button>` : '') +
    `<div class="h2">Mitglieder</div>
    <div class="list">${active().map(m=>{ const a=prof(m.user_id), mine=a.id===D.user.id; return `<button class="row" data-action="edit-prefs" data-id="${a.id}"><span class="avatar">${a.avatar}</span><span class="grow"><b>${esc(a.name)}</b>${m.role==='admin'?' <span class="chip c-herb">Admin</span>':''}${mine?' <span class="chip c-muted">Du</span>':''}<small>${esc(prefText(a))}</small></span>${mine?I.chev:''}</button>`; }).join('')}</div>
    ${!isAdmin()?`<div class="list" style="margin-top:16px"><button class="row" data-action="ask-leave"><span class="grow"><b>Familie verlassen</b></span></button></div>`:''}
    ${UI.confirmLeave?`<div class="card" style="background:var(--tomato-soft);margin-top:10px"><b style="color:var(--tomato)">Familie wirklich verlassen?</b><div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-tomato btn-sm" style="flex:1" data-action="leave">Verlassen</button><button class="btn btn-ghost btn-sm" style="flex:1" data-action="cancel-leave">Abbrechen</button></div></div>`:''}
`;
}

/* ---------- Reiter „Mehr" ---------- */
const VERSION = '2.1';
const CHANGELOG = [
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
  ['Wie installiere ich die App?','iPhone: in Safari auf „Teilen" und dann „Zum Home-Bildschirm". Android: im Chrome-Menü auf „App installieren".'],
];
function viewMore(){
  return header('Mehr', `Version ${VERSION}`) +
    `<button class="plus-card" data-action="plus"><div class="pc-glow"></div><span class="plus-badge">✨ PLUS</span><b>Mehr für deine Familie</b><span>KI-Rezepte · unbegrenzt Fotos · Wochenplan-Assistent · sortierte Einkaufsliste</span><span class="pc-cta">${L.plusInterest ? '💚 Du bist vorgemerkt' : 'Ansehen und vormerken ›'}</span></button>` +
    `<div class="h2">Hilfe</div>
    ${FAQ.map(([q,a])=>`<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
    <div class="h2">Darstellung</div>
    <div class="seg" role="group" aria-label="Farbschema">${[['system','System'],['light','Hell'],['dark','Dunkel']].map(([k,l])=>`<button data-action="theme" data-v="${k}" aria-pressed="${(L.theme||'system')===k}">${l}</button>`).join('')}</div>
    <div class="h2">Benachrichtigungen</div>
    <div class="list">${pushRow()}</div>
    <div class="h2">Kontakt</div>
    <div class="list"><button class="row" data-action="feedback"><span style="font-size:22px">💬</span><span class="grow"><b>Feedback senden</b><small>Fehler melden, Ideen oder Lob</small></span>${I.chev}</button></div>
    <div class="h2">Konto</div>
    <div class="list">
      <button class="row" data-action="edit-prefs" data-id="${D.user.id}"><span class="avatar sm">${D.profile.avatar}</span><span class="grow"><b>Mein Profil</b><small>${esc(prefText(D.profile))}</small></span>${I.chev}</button>
      <button class="row" data-action="logout"><span class="grow"><b style="color:var(--tomato)">${UI.confirmLogout ? 'Wirklich abmelden? Nochmal tippen' : 'Abmelden'}</b><small>${esc(D.user.email||'')}</small></span></button>
    </div>
    ${D.appAdmin ? `<div class="h2">Betreiber</div><div class="list"><a class="row" href="admin.html" style="color:inherit;text-decoration:none"><span style="font-size:22px">🛠️</span><span class="grow"><b>Admin-Panel</b><small>Nur für dich sichtbar</small></span>${I.chev}</a></div>` : ''}
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
    <div class="h1" style="font-size:24px">Dein Account ist gesperrt</div>
    <p style="color:var(--muted);max-width:280px">Wenn du glaubst, dass das ein Fehler ist, melde dich über die Kontaktdaten im Impressum.</p>
    <button class="btn btn-line" data-action="logout">Abmelden</button></div>`;
}

/* ---------- Push-Benachrichtigungen ---------- */
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && location.protocol === 'https:';
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
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
  const sub = { on:'Neuigkeiten und Hinweise aufs Handy', off:'Aus – tippen zum Einschalten', install:'Zuerst die App zum Home-Bildschirm hinzufügen', denied:'In den Handy-Einstellungen blockiert', unsupported:'Dieser Browser unterstützt das nicht' }[st];
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
const PH_KEY = 'wasgibts.photos.v2';
let PH = {}; try { PH = JSON.parse(localStorage.getItem(PH_KEY)) || {}; } catch(e){}
const phSave = () => { try { localStorage.setItem(PH_KEY, JSON.stringify(PH)); } catch(e){} };
const phQueue = [], phWait = new Set(), phFail = {}; let phBusy = 0, phT = null;
const phOf = r => { const v = PH[r.n]; return v && v.u ? v : null; };
const STOPW = ['mit','aus','und','dem','der','die','das','vom','von','auf','art','pfanne','ofen','schnell','selbst','gemacht','einfach','klassisch','bunte','bunter','bunt','frische','frischem','frischen','cremige','cremiger','cremig','vegetarisch','vegetarische','kleine','heißer','heiße','warme','kalte'];
function wantPhoto(r){
  if (!r || r.n in PH || phWait.has(r.n) || !navigator.onLine || (phFail[r.n] && Date.now() - phFail[r.n] < 6e5)) return;
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
  const api = 'https://de.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*&';
  const words = name.toLowerCase().replace(/[^a-zäöüß\s-]/g, ' ').split(/[\s-]+/).filter(w => w.length >= 4 && !STOPW.includes(w));
  const stem = w => w.slice(0, Math.max(4, w.length - 2));
  // Erster Versuch: Titel enthält ein Wort aus dem Rezept. Spätere Versuche: Titel muss damit ANFANGEN (sonst kommen Denkmäler o. Ä.)
  // Artikel über rohe Zutaten oder Tiere zeigen kein Gericht (z. B. „Fische" → Walhai)
  const RAW = ['fisch','fische','lachs','lachse','haushuhn','huhn','hähnchen','hausrind','rind','hausschwein','schwein','garnelen','truthuhn','pute','linse','linsen','kartoffel','tomate','paprika','zwiebel','möhre','karotte','brokkoli','spinat','zucchini','reis','nudel','nudeln','ei','eier','käse','milch','butter','mehl','zucker','kürbis','apfel','banane','spargel','pilze','champignon','zuchtchampignon'];
  const fits = (title, strict) => { const t = title.toLowerCase(); if (/\((?!gericht|speise)[^)]*\)/.test(t) || RAW.includes(t)) return false;
    return words.some(w => strict ? t.startsWith(stem(w)) : t.includes(stem(w))); };
  const BAD = /logo|karte|map|wappen|flagge|illustration|zeichnung|platz|denkmal|statue|skulptur|brunnen|portrait|portr%C3%A4t|geb%C3%A4ude|stra%C3%9Fe|schild|diagram|chart/i;
  const tries = [...new Set([name, name.split(/ mit | aus | in | auf | und | vom /i)[0]].filter(Boolean))];
  try {
    for (const [n, q] of tries.entries()){
      const res = await fetch(api + 'action=query&generator=search&gsrnamespace=0&gsrlimit=4&prop=pageimages&piprop=thumbnail|name&pithumbsize=640&gsrsearch=' + encodeURIComponent(q)).then(r => r.json());
      const pages = ((res.query && res.query.pages) || []).sort((a, b) => a.index - b.index);
      const hit = pages.find(p => p.thumbnail && p.pageimage && !/\.(svg|gif|tif|tiff)$/i.test(p.pageimage) && !BAD.test(encodeURIComponent(p.pageimage)) && !BAD.test(p.pageimage) && fits(p.title, n > 0));
      if (!hit) continue;
      const info = await fetch(api + 'action=query&prop=imageinfo&iiprop=extmetadata&titles=' + encodeURIComponent('Datei:' + hit.pageimage)).then(r => r.json());
      const meta = (((info.query || {}).pages || [])[0] || {}).imageinfo?.[0]?.extmetadata || {};
      const strip = h => String(h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      return { u: hit.thumbnail.source, a: strip(meta.Artist && meta.Artist.value).slice(0, 70) || 'Wikimedia Commons', l: strip(meta.LicenseShortName && meta.LicenseShortName.value) || 'freie Lizenz', f: 'https://de.wikipedia.org/wiki/Datei:' + encodeURIComponent(hit.pageimage), t: hit.title };
    }
    return null;   // kein passendes Foto – Emoji bleibt
  } catch(e){ return undefined; }   // Netzfehler: später nochmal versuchen
}
/* Kleines Bild in Listen */
function photoEm(r){ const ph = phOf(r); if (!ph) wantPhoto(r);
  return `<div class="em${ph ? ' ph' : ''}" aria-hidden="true">${ph ? `<img src="${esc(ph.u)}" alt="" loading="lazy" decoding="async">` : r.e}</div>`; }
/* Bild im großen Vorschlag */
function pickArt(r){ const ph = phOf(r); if (!ph) wantPhoto(r);
  return ph ? `<span class="big ph" aria-hidden="true"><img src="${esc(ph.u)}" alt="" decoding="async"></span>` : `<span class="big" aria-hidden="true">${r.e}</span>`; }
/* Großes Bild im Rezept, mit Urheber */
function recipeHero(r){ const ph = phOf(r); if (!ph) wantPhoto(r);
  return ph ? `<figure class="r-photo"><img src="${esc(ph.u)}" alt="${esc(r.n)}" decoding="async"><figcaption><a href="${esc(ph.f)}" target="_blank" rel="noopener">Foto: ${esc(ph.a)} · ${esc(ph.l)}</a></figcaption></figure>`
    : `<div class="r-hero" aria-hidden="true">${r.e}</div>`; }

/* ---------- Haupt-Render ---------- */
const ORDER = ['home','fridge','recipes','family','more'];
let slideDx = 0;
function render(){
  applyTheme(); renderTabbar();
  let v;
  if (!configured) v = viewSetup();
  else if (UI.loading) v = `<div class="center" style="align-items:center"><span class="spin" style="width:32px;height:32px;color:var(--herb)"></span></div>`;
  else if (!D.user) v = viewAuth();
  else if (D.profile && D.profile.banned) v = viewBanned();
  else if (!isActive() || !D.family) v = viewNoFamily();
  else v = ({home:viewHome, fridge:viewFridge, recipes:viewRecipes, family:viewFamily, more:viewMore}[UI.tab])();
  const key = UI.tab + '|' + (!configured ? 'setup' : UI.loading ? 'load' : !D.user ? 'auth' : D.profile?.banned ? 'ban' : (!isActive() || !D.family) ? 'nofam' : 'app');
  const prev = $('#views .view');
  if (!slideDx && prev && prev.dataset.key === key){ const top = prev.scrollTop; morph(prev, v); if (prev.scrollTop !== top) prev.scrollTop = top; }
  else $('#views').innerHTML = `<div class="view" data-tab="${UI.tab}" data-key="${key}" style="${slideDx?`--dx:${slideDx}px;--dy:0px`:''}">${v}</div>`;
  slideDx = 0; syncTopFade();
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
});
document.addEventListener('submit', async e => {
  if (e.target.id === 'authForm') onAuth(e);
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
  if (D.user){ try { await loadAll(true); subscribe(); } catch(e){ UI.err = errText(e); } }
  else { UI.auth = UI.auth==='check' ? 'check' : 'login'; D.profile=null; D.membership=null; if (channel){ sb.removeChannel(channel); channel=null; } }
  UI.loading=false; render();
  if (D.user && !D.profile?.banned) syncPush();
  if (D.user && !UI.counted){ UI.counted = true; trackOpen(); setTimeout(maybePlusPopup, 8000); }
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
    <div style="display:flex;gap:6px;justify-content:center;margin:10px 0 16px;flex-wrap:wrap"><span class="chip c-muted">⏱ ${r.t} Min</span>${r.m==='fast'?'<span class="chip c-yolk">Fastfood-Abend</span>':r.m==='gesund'?'<span class="chip c-herb">Gesund</span>':''}${r.x.includes('scharf')?'<span class="chip c-tomato">Scharf</span>':''}</div>
    ${who.length?`<div class="card" style="display:flex;gap:10px;align-items:center;margin-bottom:12px"><span class="avatar-stack">${who.map(w=>`<span class="avatar sm">${prof(w).avatar}</span>`).join('')}</span><span><b>${esc(names(who.map(w=>prof(w).name)))}</b> ${who.length>1?'wünschen':'wünscht'} sich das</span></div>`:''}
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
    <div class="card" style="padding:6px 16px">${r.s.map((s,n)=>`<div class="step"><b>${n+1}</b><span>${esc(s)}</span></div>`).join('')}</div>
    <button class="btn btn-tomato btn-block" style="margin-top:16px" data-action="cook" data-id="${id}">👨‍🍳 Kochmodus starten</button>
    <button class="btn btn-herb btn-block" style="margin-top:8px" data-action="cooked" data-id="${id}">🍽️ Heute gekocht</button>
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
    <div class="field"><span class="lbl2">Bild</span><div class="emoji-pick">${AVS.map(x=>`<button type="button" data-action="set-av" data-v="${x}" aria-pressed="${a.avatar===x}">${x}</button>`).join('')}</div></div>
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
      <div class="card poll"><div style="font-weight:800;margin-bottom:10px">🗳️ Was essen wir heute?</div>
      <div class="stack" style="gap:8px">${P.options.filter(rec).map(id => { const r = rec(id), who = D.votes.filter(v=>v.recipe_id===id).map(v=>prof(v.user_id)), pct = D.votes.length ? (counts[id]||0)/D.votes.length*100 : 0;
        return `<button class="opt ${mine&&mine.recipe_id===id?'mine':''}" data-action="vote" data-id="${id}"><i style="width:${pct}%"></i><span class="oe">${r.e}</span><span class="on">${esc(r.n)}</span><span class="avatar-stack">${who.map(p=>`<span class="avatar sm">${p.avatar}</span>`).join('')}</span><b>${counts[id]||0}</b></button>`; }).join('')}</div>
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
    ${list.length < 2 ? `<div class="card empty"><div class="g">🧊</div><b>Zu wenig Auswahl</b>Trag im Kühlschrank mehr Zutaten ein.</div>` :
    `<div class="stack" style="gap:8px">${list.map(x => `<button class="opt pick-opt" data-action="poll-pick" data-id="${x.r.id}" aria-pressed="${pre.includes(x.r.id)}"><span class="oe">${x.r.e}</span><span class="on">${esc(x.r.n)}</span>${x.missing.length?'<span class="chip c-yolk">🛒 1</span>':''}<span class="tick">✓</span></button>`).join('')}</div>
    <button class="btn btn-herb btn-block" style="margin-top:16px" data-action="start-poll">Abstimmung starten</button>`}`);
}

/* ---------- Ablaufdaten eintragen ---------- */
function openExpiry(){
  sheetFn = null;
  const items = D.fridge.filter(k => ING[k]);
  openSheet(`${sheetHead('Haltbarkeit')}
    <p class="muted" style="margin-top:-6px">Trag ein, bis wann etwas haltbar ist. Die App schlägt dann zuerst Gerichte vor, die es aufbrauchen.</p>
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
  UI.cook = { id, step: 0, dir: 1 }; sheetFn = null; applyTheme();
  try { navigator.wakeLock && navigator.wakeLock.request('screen').then(l => wakeLock = l).catch(()=>{}); } catch(e){}
  // Auf dem Handy: Vollbild und Querformat versuchen (Android). iPhone zeigt den Dreh-Hinweis.
  if (!mq.matches){ try { const el = document.documentElement; (el.requestFullscreen ? el.requestFullscreen() : Promise.reject()).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape')).catch(()=>{}); } catch(e){} }
  document.documentElement.classList.add('cooking'); layout();
  clearInterval(clockT); clockT = setInterval(tickCookClock, 1000);
  renderCook(true);
}
function tickCookClock(){ const el = $('#cookClock'); if (!el) return; const d = new Date(); el.textContent = d.getHours() + ':' + String(d.getMinutes()).padStart(2,'0'); }
function renderCook(first){
  const c = UI.cook, r = rec(c.id); if (!r) return;
  const n = r.s.length, txt = r.s[c.step] || '', mins = stepMinutes(txt), last = c.step === n - 1, sc = sceneFor(txt, r);
  const pct = Math.round((c.step + 1) / n * 100);
  const stepHTML = `
      <div class="ck-orb glass">${sc.html}</div>
      <div class="ck-copy">
        <div class="ck-kicker"><span class="ck-pill">${sc.label}</span></div>
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
        <span id="cookTimer" class="ck-timer" ${UI.timer?'':'hidden'}></span>
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
function startTimer(m){ if (!m) return; UI.timer = { end: Date.now() + m*60e3 }; clearInterval(timerT); timerT = setInterval(tickTimer, 500); tickTimer(); beep(); buzz(20); toast(`⏱ Timer: ${m} Minuten`); }
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let voiceRec = null;
function speak(text){
  try { if (!('speechSynthesis' in window)) return; speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'de-DE'; u.rate = 1;
    const v = speechSynthesis.getVoices().find(x => /^de/i.test(x.lang)); if (v) u.voice = v;
    speechSynthesis.speak(u); } catch(e){}
}
function speakStep(){ const c = UI.cook; if (!c) return; const r = rec(c.id); if (!r) return; c.lastRead = c.step; speak(`Schritt ${c.step + 1}. ${r.s[c.step]}`); }
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
    const r = rec(UI.cook.id), m = num ? +num[1] : w ? NUMW[w] : stepMinutes(r.s[UI.cook.step]);
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
  const el = $('#cookTimer'); if (!UI.timer){ if (el) el.hidden = true; return; }
  const left = Math.max(0, UI.timer.end - Date.now()), m = Math.floor(left/60e3), sec = Math.floor(left%60e3/1e3);
  if (el){ el.hidden = false; el.innerHTML = `<i></i>${m}:${String(sec).padStart(2,'0')}`; }
  if (left <= 0){ clearInterval(timerT); UI.timer = null; beep(); buzz([300,150,300,150,300]); toast('⏰ Die Zeit ist um!'); if (el) el.hidden = true; }
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
    <h3>Rezeptfotos</h3><p>Fotos zu den Rezepten lädt die App von Wikipedia/Wikimedia Commons (Wikimedia Foundation). Dabei wird deine IP-Adresse an Wikimedia übertragen. Die Fotos stehen unter freien Lizenzen, Urheber und Lizenz stehen jeweils am Bild.</p>
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
  const today = new Date().toISOString().slice(0,10);
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
    <div class="plus-prices"><div><b>3,99 €</b><small>pro Monat</small></div><div class="best"><b>29,99 €</b><small>pro Jahr · spart 37 %</small></div></div>
    <p class="muted" style="font-size:13px;text-align:center;margin:4px 0 12px">Ein Abo gilt für die ganze Familie. Plus startet bald.</p>
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
    $('#scanArea').innerHTML = `<div class="card" style="margin-top:12px;background:var(--herb-soft)"><b>📸 ${found.length} Zutaten erkannt</b><br><span class="muted" style="font-size:14px">${found.length?esc(found.map(ingName).join(', ')):'Leider nichts Eindeutiges. Versuch ein helleres Foto.'}</span></div>`;
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
function keepName(){ const i = $('#p-name'); if (!i) return; const n = i.value.trim().slice(0,30); if (n && n !== D.profile.name) updateProfile({ name:n }); }
/* Familie per Push informieren (Wunsch, Abstimmung, Beitritt) – Server prüft Einstellungen und Missbrauch */
function notifyFamily(type, ref, label){ try { sb.functions.invoke('send-push', { body:{ action:'event', type, ref: ref || '', label: label || '' } }).catch(()=>{}); } catch(e){} }

/* ---------- Ereignisse ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-tab],[data-action]'); if (!t) return;
  if (t.dataset.tab){ go(t.dataset.tab); return; }
  const a = t.dataset.action, id = t.dataset.id;
  try { switch(a){
    case 'close': keepName(); closeSheet(); render(); break;
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
    case 'cooked': { const r=rec(id); burstAt(t); buzz([20,50,20]); D.wishes = D.wishes.filter(w=>w.recipe_id!==id);
      L.cookedCount = (L.cookedCount||0) + 1; saveLocal();
      setTimeout(()=>{ closeSheet(); render(); if (L.cookedCount % 3 === 0 && !L.plusInterest) setTimeout(() => openPlus(true), 1600); }, 450); toast(`Guten Appetit! ${r.e}`);
      await save(() => sb.from('wishes').delete().eq('family_id', D.family.id).eq('recipe_id', id)); break; }
    case 'ing': { const k=t.dataset.k; D.fridge = D.fridge.includes(k) ? D.fridge.filter(x=>x!==k) : [...D.fridge,k]; saveFridgeSoon(); buzz(6);
      L.recentIng = [k, ...(L.recentIng||[]).filter(x => x !== k)].slice(0, 12); saveLocal();
      t.setAttribute('aria-pressed', D.fridge.includes(k)); t.classList.remove('just'); void t.offsetWidth; if (D.fridge.includes(k)) t.classList.add('just');
      render(); break; }
    case 'clear-fridge': D.fridge=[]; D.expiries={}; saveFridgeSoon(); render(); toast('Alles abgewählt'); break;
    case 'photo': $('#photoInput').click(); break;
    case 'rtab': UI.rtab=t.dataset.v; UI.rlimit=30; buzz(6); render(); break;
    case 'edit-prefs': if (id===D.user.id) openPrefs(); else toast(`Nur ${prof(id).name} kann das eigene Profil ändern`); break;
    case 'set-av': document.querySelectorAll('[data-action=set-av]').forEach(b=>b.setAttribute('aria-pressed', b===t)); buzz(6); updateProfile({ avatar:t.dataset.v }); render(); break;
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
    case 'plus-hide': L.plusHideUntil = Date.now() + 2*DAY; saveLocal(); render(); toast('Plus-Hinweise für 2 Tage ausgeblendet'); break;
    case 'plus-interest': { L.plusInterest = true; saveLocal(); openPlus(false); buzz(20);
      try { await sb.from('feedback').insert({ user_id:D.user.id, kind:'plus', message:'Interesse an Was gibt\'s? Plus', app_version:VERSION }); } catch(err){} break; }
    case 'new-poll': openPollSetup(); break;
    case 'poll-pick': { const on = t.getAttribute('aria-pressed') !== 'true'; if (on && document.querySelectorAll('.pick-opt[aria-pressed=true]').length >= 4){ toast('Höchstens 4 Gerichte'); break; } t.setAttribute('aria-pressed', on); buzz(6); break; }
    case 'start-poll': { const ids = [...document.querySelectorAll('.pick-opt[aria-pressed=true]')].map(b => b.dataset.id);
      if (ids.length < 2){ toast('Bitte mindestens 2 Gerichte wählen'); break; }
      if (D.poll && D.poll.status === 'open' && (D.poll.created_by === D.user.id || isAdmin())) await sb.from('polls').update({ status:'closed' }).eq('id', D.poll.id);
      t.disabled = true; let res; try { res = await save(() => sb.from('polls').insert({ family_id:D.family.id, created_by:D.user.id, options:ids, status:'open' }).select().single()); } catch(err){ t.disabled = false; throw err; }
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
    case 'cook': openCook(id); break;
    case 'cook-next': UI.cook.step++; UI.cook.dir = 1; buzz(8); renderCook(); break;
    case 'cook-prev': UI.cook.step = Math.max(0, UI.cook.step - 1); UI.cook.dir = -1; buzz(8); renderCook(); break;
    case 'cook-force': UI.cookForce = true; $('.cook').classList.add('force'); break;
    case 'cook-close': closeCook(); render(); break;
    case 'cook-done': { const cid = UI.cook.id; closeCook(); render(); openRecipe(cid); setTimeout(() => { const b = $('[data-action=cooked]'); if (b) b.click(); }, 350); break; }
    case 'timer': startTimer(+t.dataset.v); break;
    case 'cook-voice': UI.voice ? stopVoice() : startVoice(); break;
    case 'cook-read': L.readAloud = !L.readAloud; saveLocal(); updVoice(); if (L.readAloud) speakStep(); else try { speechSynthesis.cancel(); } catch(e){} toast(L.readAloud ? '🔊 Schritte werden vorgelesen' : 'Vorlesen aus'); break;
    case 'legal': { const [title, html] = LEGAL[t.dataset.v]; sheetFn = null; openSheet(`${sheetHead(title)}<div class="legal">${html}</div>`); break; }
    case 'theme': L.theme=t.dataset.v; saveLocal(); render(); break;
    case 'push': { if (UI.push === 'on'){ await pushOff(); toast('Benachrichtigungen aus'); }
      else if (UI.push === 'off'){ t.disabled = true; const r = await pushOn(); toast(r === true ? 'Benachrichtigungen an 🔔' : r); }
      else if (UI.push === 'install') openPushHelp();
      else if (UI.push === 'denied') toast('Bitte erlaube Benachrichtigungen in den Einstellungen deines Handys');
      render(); break; }
    case 'ftab': UI.ftab = t.dataset.v; buzz(6); render(); $('#views .view').scrollTop = 0; break;
    case 'fonly': UI.fonly = t.dataset.v; buzz(6); render(); break;
    case 'shop-toggle': toggleShop(id); buzz(8); render(); break;
    case 'shop-del': { const it = D.shop.find(x => x.id === id); if (it) removeShop([it]); render(); break; }
    case 'shop-clear': removeShop(D.shop.filter(x => x.checked)); render(); toast('Erledigte gelöscht'); break;
    case 'shop-ing': { const k = t.dataset.k; if (onList(k)){ toast('Steht schon drauf'); break; } UI.sq = ''; await addToList([k]); buzz(10); toast(`${ingName(k)} auf der Liste ✓`); break; }
    case 'shop-free': { const v = t.dataset.v; UI.fq = ''; await addToList([], v); UI.ftab = 'shop'; render(); toast('Auf der Liste ✓'); break; }
    case 'shop-plan': { const n = await addToList(plannedMissing()); toast(`${n} Zutaten für den Wochenplan auf der Liste ✓`); buzz(15); break; }
    case 'shop-missing': { const r = rec(id); const miss = r.i.filter(k => !D.fridge.includes(k)); const n = await addToList(miss); burstAt(t); buzz(15); toast(n ? `${n} ${n===1?'Zutat':'Zutaten'} auf der Einkaufsliste 🛒` : 'Steht schon alles drauf'); break; }
    case 'plan-day': UI.pq = ''; openPlanDay(t.dataset.v); break;
    case 'plan-set': { const iso = t.dataset.v; await setPlan(iso, id); closeSheet(); render(); buzz(15); toast(`📅 ${rec(id).n} eingeplant`); break; }
    case 'plan-clear': await clearPlan(t.dataset.v); closeSheet(); render(); toast('Aus dem Plan genommen'); break;
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
  if (Math.abs(dx)>70 && Math.abs(dx)>Math.abs(dy)*1.6){ const r = rec(UI.cook.id); const k = UI.cook.step + (dx<0?1:-1); if (k>=0 && k<r.s.length){ UI.cook.dir = dx<0?1:-1; UI.cook.step=k; buzz(8); renderCook(); } } }, {passive:true});
$('#views').addEventListener('touchend', e=>{ if(!D.user || !isActive()) return;
  const dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty;
  if (Math.abs(dx)>70 && Math.abs(dx)>Math.abs(dy)*1.6){ const k=ORDER.indexOf(UI.tab)+(dx<0?1:-1); if(k>=0&&k<ORDER.length) go(ORDER[k]); } }, {passive:true});

/* ---------- Farbschema ---------- */
function applyTheme(){ const r=document.documentElement, th=L.theme||'system'; if(th==='system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', th);
  /* Oberer Rand (Statusleiste / Safari-Leiste) in derselben Farbe wie die App */
  const bg = r.classList.contains('splashing') ? '#1f5a37' : UI.cook ? '#0f1d14' : getComputedStyle(r).getPropertyValue(D.user ? '--band' : '--bg').trim();
  if (bg && applyTheme.last !== bg){ applyTheme.last = bg; document.querySelectorAll('meta[name=theme-color]').forEach(m => { if (th !== 'system') m.removeAttribute('media'); m.setAttribute('content', bg); }); } }
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

/* ---------- Start-Intro ---------- */
(() => { const sp = $('#splash'), root = document.documentElement; if (!sp) return;
  let done = false;
  const hide = () => { if (done) return; done = true; sp.classList.add('gone'); root.classList.remove('splashing'); applyTheme.last = null; applyTheme(); };
  // Nur beim ersten Öffnen zeigen – nicht noch einmal, wenn die App sich für ein Update kurz neu lädt
  let seen = false; try { seen = !!sessionStorage.getItem('wg.splash'); sessionStorage.setItem('wg.splash', '1'); } catch(e){}
  if (seen || window.matchMedia('(prefers-reduced-motion: reduce)').matches){ hide(); return; }
  root.classList.add('splashing'); applyTheme();   // oberer Rand grün wie das Intro
  sp.addEventListener('animationend', e => { if (e.target === sp && e.animationName === 'spOut') hide(); });
  sp.addEventListener('click', hide); setTimeout(hide, 3000); })();

/* ---------- Start ---------- */
/* Neue Versionen automatisch laden: sobald ein neuer Service Worker übernimmt, einmal neu laden */
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { const t = e.data && e.data.tab; if (t && D.user && ORDER.includes(t)){ closeSheet(); go(t); scheduleReload(50); } });
if ('serviceWorker' in navigator && location.protocol === 'https:'){
  const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded){ reloaded = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => { r.update(); document.addEventListener('visibilitychange', () => { if (!document.hidden) r.update(); }); }).catch(()=>{});
}
layout(); render();
if (configured){
  sb.auth.getSession().then(({ data }) => onSession(data.session));
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === 'SIGNED_IN' && session && D.user && D.user.id === session.user.id){ D.user = session.user; return; }   // gleiche Person: nur Token aufgefrischt
    if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') onSession(session);
  });
} else { UI.loading=false; render(); }
