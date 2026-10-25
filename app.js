/* =========================================================================
   WAS GIBT'S? – Familien-Essensplaner
   Aufbau: Verbindung → Daten laden → Logik → Ansichten → Ereignisse
   Daten liegen in Supabase (siehe supabase/schema.sql).
   ========================================================================= */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { ING, ingName, ingEmoji, R, recipe, ALLERGENS, TRAITS, allergensOf } from './data.js';

const configured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/* ---------- Zustand ---------- */
const D = { user:null, profile:null, membership:null, family:null, members:[], profiles:{}, wishes:[], fridge:[], expiries:{}, custom:[], poll:null, votes:[] };
const UI = { tab:'home', time:60, mood:'egal', rtab:'wishes', q:'', auth:'login', busy:false, err:'', loading:true,
             joinCode: new URLSearchParams(location.search).get('join') || '' };
const LOCAL = 'wasgibts.local';
let L = (() => { try { return JSON.parse(localStorage.getItem(LOCAL)) || {}; } catch(e){ return {}; } })();
const saveLocal = () => { try { localStorage.setItem(LOCAL, JSON.stringify(L)); } catch(e){} };
if (UI.joinCode) { L.joinCode = UI.joinCode; saveLocal(); history.replaceState(null, '', location.pathname); }

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

/* ---------- Daten laden ---------- */
async function loadAll(){
  const uid = D.user.id;
  let { data: p } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (!p){ // Profil beim ersten Login aus den Registrierungsdaten anlegen
    const meta = D.user.user_metadata || {};
    const ins = await sb.from('profiles').insert({ id: uid, name: (meta.name || 'Ich').slice(0,30), avatar: meta.avatar || '🧑' }).select().single();
    p = ins.data;
  }
  D.profile = p; D.profiles = { [uid]: p };
  const { data: ms } = await sb.from('memberships').select('*').eq('user_id', uid).order('created_at').limit(1);
  D.membership = ms && ms[0] || null;
  D.family = null; D.members = []; D.wishes = []; D.fridge = []; D.expiries = {}; D.custom = []; D.poll = null; D.votes = [];
  if (!D.membership) return;
  const { data: fam } = await sb.from('families').select('*').eq('id', D.membership.family_id).maybeSingle();
  D.family = fam;
  if (!isActive()) return;
  const fid = D.membership.family_id;
  const [mem, wis, fr, cus, pol] = await Promise.all([
    sb.from('memberships').select('*').eq('family_id', fid).order('created_at'),
    sb.from('wishes').select('*').eq('family_id', fid),
    sb.from('fridges').select('*').eq('family_id', fid).maybeSingle(),
    sb.from('custom_recipes').select('*').eq('family_id', fid).order('created_at'),
    sb.from('polls').select('*').eq('family_id', fid).order('created_at', { ascending:false }).limit(1),
  ]);
  D.members = mem.data || []; D.wishes = wis.data || []; D.fridge = (fr.data && fr.data.items) || [];
  D.expiries = (fr.data && fr.data.expiries) || {};
  D.custom = (cus.data || []).map(c => ({ id:'c_'+c.id, dbid:c.id, n:c.name, e:c.emoji, t:c.minutes, m:c.mood, i:c.ingredients||[], o:c.optional||[], x:c.traits||[], s:c.steps||[], custom:true, by:c.created_by }));
  D.poll = (pol.data && pol.data[0]) || null;
  if (D.poll){ const { data: vs } = await sb.from('votes').select('*').eq('poll_id', D.poll.id); D.votes = vs || []; }
  const ids = D.members.map(m=>m.user_id);
  const { data: ps } = await sb.from('profiles').select('*').in('id', ids);
  (ps||[]).forEach(x => D.profiles[x.id] = x);
}
let reloadT = null, writing = 0;
function scheduleReload(){ clearTimeout(reloadT); reloadT = setTimeout(async () => {
  if (writing > 0 || fridgeT){ scheduleReload(); return; }   // eigene Änderung läuft noch: nicht überschreiben
  await loadAll().catch(()=>{}); if (!$('.sheet')) render(); else refreshSheet(); }, 450); }

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
    .subscribe();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && D.user) scheduleReload(); });

/* ---------- Rezepte: feste Sammlung + eigene Familienrezepte ---------- */
const RX = () => [...R, ...D.custom];
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
  const n=[]; people.forEach(p => { (p.dislikes||[]).forEach(d => { if (r.o.includes(d)) n.push(`${ingName(d)} bei ${p.name} weglassen`); }); if (p.veg && r.o.includes('schinken')) n.push(`Schinken bei ${p.name} weglassen`);
    if (p.picky) r.o.filter(k => !(p.likes||[]).includes(k)).forEach(k => n.push(`${ingName(k)} bei ${p.name} weglassen`)); });
  return [...new Set(n)];
}
const wishersOf = rid => [...new Set(D.wishes.filter(w=>w.recipe_id===rid).map(w=>w.user_id))].filter(id => active().some(m=>m.user_id===id));
function suggest(){
  const people = eatersNow().map(prof), fr = new Set(D.fridge);
  return RX().filter(r => r.t <= UI.time && (UI.mood==='egal' || r.m===UI.mood))
    .filter(r => people.every(p => conflicts(r,p).length===0))
    .map(r => {
      const missing = r.i.filter(k=>!fr.has(k)), wishers = wishersOf(r.id), favs = people.filter(p=>(p.favs||[]).includes(r.id));
      const cover = r.i.length ? (r.i.length-missing.length)/r.i.length : 1;
      const uses = [...r.i, ...r.o].filter(k => fr.has(k) && (d => d !== null && d >= 0 && d <= 3)(daysLeft(k)));
      return { r, missing, wishers, favs, cover, uses, score: wishers.length*40 + favs.length*14 + cover*60 - missing.length*8 + uses.length*30 };
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
  const tabs = [['home','Heute',I.home],['fridge','Kühlschrank',I.fridge],['recipes','Wünsche',I.book],['family','Familie',I.family],['more','Mehr',I.more]];
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
    <div class="em" aria-hidden="true">${s.r.e}</div>
    <div class="main"><div class="t">${esc(s.r.n)}</div>
      <div class="s"><span>⏱ ${s.r.t} Min</span>${s.wishers.length?`<span class="chip c-tomato">🙋 ${s.wishers.length}</span>`:''}${s.favs.length?`<span class="chip c-tomato">❤️ ${s.favs.length}</span>`:''}${s.r.m==='fast'?'<span class="chip c-yolk">Fastfood</span>':s.r.m==='gesund'?'<span class="chip c-herb">Gesund</span>':''}</div>
      ${s.missing.length?`<div class="s" style="margin-top:4px"><span class="chip c-yolk">🛒 ${s.missing.map(ingName).join(', ')}</span></div>`:'<div class="meter"><i style="width:100%"></i></div>'}</div>${I.chev}</button>`;
}
function viewHome(){
  const eat = eatersNow(), all = suggest();
  /* Nur zeigen, was mit dem Kühlschrank wirklich geht – plus Ideen mit genau einem Einkauf */
  const ready = all.filter(s => s.missing.length===0), almost = all.filter(s => s.missing.length===1), top = ready[0];
  const h = new Date().getHours(), greet = h<11?'Guten Morgen':h<17?'Hallo':'Guten Abend';
  const p = isAdmin() ? pendingReq() : [];
  return header(`Was gibt's heute, ${esc(D.profile.name)}?`, greet) +
    (p.length ? `<button class="banner" data-tab="family"><span class="avatar sm">${prof(p[0].user_id).avatar}</span><span style="flex:1"><b>${esc(prof(p[0].user_id).name)}</b> möchte deiner Familie beitreten</span>${I.chev}</button>` : '') +
    (expiringSoon().length ? `<button class="banner" style="background:var(--tomato-soft)" data-tab="fridge"><span style="font-size:22px">⏰</span><span style="flex:1"><b>Bald aufbrauchen:</b> ${expiringSoon().map(x=>`${esc(ingName(x.k))} (${expLabel(x.d)})`).join(', ')}</span>${I.chev}</button>` : '') +
    `<div class="h2">Wer isst mit?</div>
    <div class="who" role="group" aria-label="Wer isst mit">${active().map(m=>{ const a=prof(m.user_id); return `<button data-action="eater" data-id="${a.id}" aria-pressed="${eat.includes(a.id)}"><span class="avatar">${a.avatar}</span>${esc(a.name)}</button>`; }).join('')}</div>
    <div class="h2">Wie viel Zeit?</div>
    <div class="seg" role="group" aria-label="Zeit">${[[15,'15 Min'],[30,'30 Min'],[60,'Egal']].map(([v,l])=>`<button data-action="time" data-v="${v}" aria-pressed="${UI.time===v}">${l}</button>`).join('')}</div>
    <div class="h2">Worauf habt ihr Lust?</div>
    <div class="seg" role="group" aria-label="Stimmung">${[['gesund','🥗 Gesund'],['egal','Egal'],['fast','🍔 Fastfood']].map(([v,l])=>`<button data-action="mood" data-v="${v}" aria-pressed="${UI.mood===v}">${l}</button>`).join('')}</div>
    ${pollBlock(all)}
    <div class="h2">Du könntest machen</div>
    ${top ? `<button class="pick" data-action="open-recipe" data-id="${top.r.id}"><span class="big" aria-hidden="true">${top.r.e}</span>
        <div class="lbl">UNSER VORSCHLAG</div><div class="name">${esc(top.r.n)}</div>
        <div class="why">${whyLines(top).map(l=>`<span>${l}</span>`).join('')}</div>
        <div class="meta"><span class="chip">⏱ ${top.r.t} Min</span><span class="chip">Passt für ${eat.length===active().length?'alle':eat.length+' Personen'}</span></div></button>
      ${ready.length>1?`<div class="h2">Geht auch <span class="chip c-muted">${ready.length-1}</span></div><div class="stack">${ready.slice(1,8).map(suggestionCard).join('')}</div>`:''}`
    : `<div class="card empty"><div class="g">🧊</div><b>Mit dem, was da ist, passt noch kein Rezept</b>Trag im Kühlschrank ein, was du hast, oder schau unten, was mit einem Einkauf geht.<button class="btn btn-line btn-block" style="margin-top:12px" data-tab="fridge">Kühlschrank öffnen</button></div>`}
    ${almost.length?`<div class="h2">Mit einem kleinen Einkauf <span class="chip c-muted">${almost.length}</span></div><div class="stack">${almost.slice(0,6).map(suggestionCard).join('')}</div>`:''}`;
}
function expTag(k){ const d = daysLeft(k); if (d === null) return ''; return ` <span class="exp ${d<=1?'hot':''}">${d<0?'abgelaufen':d===0?'heute':d+' T'}</span>`; }
function viewFridge(){
  const fr = new Set(D.fridge);
  const group = (g, title) => `<div class="h2">${title} <span class="chip c-muted" data-count="${g}">${Object.keys(ING).filter(k=>ING[k][2]===g&&fr.has(k)).length} da</span></div>
    <div class="chips">${Object.keys(ING).filter(k=>ING[k][2]===g).map(k=>`<button class="ing ${UI.justAdded&&UI.justAdded.includes(k)?'just':''}" data-action="ing" data-k="${k}" aria-pressed="${fr.has(k)}">${ING[k][1]} ${ING[k][0]}${expTag(k)}</button>`).join('')}</div>`;
  const html = header('Was ist da?', `${D.fridge.length} Zutaten · für alle sichtbar`) +
    `<button class="photo-card" data-action="photo"><span class="cam">${I.cam}</span><span style="flex:1"><b style="font-size:17px">Kühlschrank fotografieren</b><br><span style="opacity:.9;font-size:14px">Die App erkennt deine Zutaten automatisch</span></span></button>
    <div id="scanArea"></div>
    <button class="btn btn-line btn-block" style="margin-top:12px" data-action="expiry">📅 Haltbarkeit eintragen</button>
    ${group('k','Kühlschrank')}${group('v','Vorrat')}
    <p class="muted" style="font-size:13px;margin-top:16px">Salz, Pfeffer, Öl, Zucker und Gewürze setzen wir als vorhanden voraus.</p>
    <button class="btn btn-line btn-block" style="margin-top:6px" data-action="clear-fridge">Alles abwählen</button>`;
  UI.justAdded = null; return html;
}
function viewRecipes(){
  const t = UI.rtab, favs = D.profile.favs || [];
  let body = '';
  if (t==='wishes'){
    const ids = [...new Set(D.wishes.map(w=>w.recipe_id))].filter(id=>rec(id) && wishersOf(id).length).sort((a,b)=>wishersOf(b).length-wishersOf(a).length);
    body = ids.length ? `<div class="stack">${ids.map(id=>{ const r=rec(id), who=wishersOf(id);
      return `<button class="rc" data-action="open-recipe" data-id="${id}"><div class="em">${r.e}</div><div class="main"><div class="t">${esc(r.n)}</div>
        <div class="s"><span class="avatar-stack">${who.map(w=>`<span class="avatar sm">${prof(w).avatar}</span>`).join('')}</span><span>${esc(names(who.map(w=>prof(w).name)))}</span></div></div>${I.chev}</button>`; }).join('')}</div>`
      : `<div class="card empty"><div class="g">🙋</div><b>Noch keine Wünsche</b>Öffne ein Rezept unter „Alle" und tippe auf „Wünschen".</div>`;
  } else {
    const q = UI.q.trim().toLowerCase();
    const list = RX().filter(r => (t==='all' || (t==='favs' && favs.includes(r.id)) || (t==='fam' && r.custom)) && (!q || r.n.toLowerCase().includes(q)));
    body = (t==='fam' ? `<button class="btn btn-herb btn-block" style="margin-bottom:12px" data-action="new-recipe">📖 Eigenes Rezept eintragen</button>` : '') + (t==='all' ? `<input id="search" class="input" type="search" placeholder="Rezept suchen" value="${esc(UI.q)}" aria-label="Rezept suchen" style="margin-bottom:12px">` : '') +
      (list.length ? `<div class="stack">${list.map(r=>`<button class="rc" data-action="open-recipe" data-id="${r.id}"><div class="em">${r.e}</div><div class="main"><div class="t">${esc(r.n)}</div><div class="s"><span>⏱ ${r.t} Min</span>${r.custom?'<span class="chip c-herb">Familie</span>':''}${favs.includes(r.id)?'<span class="chip c-tomato">❤️</span>':''}</div></div>${I.chev}</button>`).join('')}</div>`
      : t==='fam' ? `<div class="card empty"><div class="g">📖</div><b>Noch keine Familienrezepte</b>Tragt eure eigenen Lieblingsgerichte ein, zum Beispiel Omas Gulasch.</div>`
      : `<div class="card empty"><div class="g">${t==='favs'?'❤️':'🔍'}</div><b>${t==='favs'?'Noch keine Lieblingsessen':'Nichts gefunden'}</b>${t==='favs'?'Tippe in einem Rezept auf das Herz.':'Versuch es mit einem anderen Wort.'}</div>`);
  }
  return header('Wünsche & Rezepte', `${RX().length} Rezepte`) +
    `<div class="seg" role="group" aria-label="Ansicht">${[['wishes','Wünsche'],['favs','Lieblinge'],['fam','Familie'],['all','Alle']].map(([k,l])=>`<button data-action="rtab" data-v="${k}" aria-pressed="${t===k}">${l}</button>`).join('')}</div>
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
const VERSION = '1.3';
const CHANGELOG = [
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
  ['Wie installiere ich die App?','iPhone: in Safari auf „Teilen" und dann „Zum Home-Bildschirm". Android: im Chrome-Menü auf „App installieren".'],
];
function viewMore(){
  return header('Mehr', `Version ${VERSION}`) +
    `<div class="h2">Hilfe</div>
    ${FAQ.map(([q,a])=>`<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
    <div class="h2">Darstellung</div>
    <div class="seg" role="group" aria-label="Farbschema">${[['system','System'],['light','Hell'],['dark','Dunkel']].map(([k,l])=>`<button data-action="theme" data-v="${k}" aria-pressed="${(L.theme||'system')===k}">${l}</button>`).join('')}</div>
    <div class="h2">Kontakt</div>
    <div class="list"><button class="row" data-action="feedback"><span style="font-size:22px">💬</span><span class="grow"><b>Feedback senden</b><small>Fehler melden, Ideen oder Lob</small></span>${I.chev}</button></div>
    <div class="h2">Konto</div>
    <div class="list">
      <button class="row" data-action="edit-prefs" data-id="${D.user.id}"><span class="avatar sm">${D.profile.avatar}</span><span class="grow"><b>Mein Profil</b><small>${esc(prefText(D.profile))}</small></span>${I.chev}</button>
      <button class="row" data-action="logout"><span class="grow"><b style="color:var(--tomato)">Abmelden</b><small>${esc(D.user.email||'')}</small></span></button>
    </div>
    <div class="h2">Rechtliches</div>
    <div class="list">
      <button class="row" data-action="legal" data-v="impressum"><span class="grow"><b>Impressum</b></span>${I.chev}</button>
      <button class="row" data-action="legal" data-v="privacy"><span class="grow"><b>Datenschutz</b></span>${I.chev}</button>
    </div>
    <div style="text-align:center;margin-top:22px"><button class="linkbtn" style="color:var(--muted);font-size:12px;font-weight:700" data-action="changelog">Version ${VERSION} · Update-Log${L.seenVersion!==VERSION?' <span class="new-badge">NEU</span>':''}</button></div>`;
}

/* ---------- Haupt-Render ---------- */
const ORDER = ['home','fridge','recipes','family','more'];
let slideDx = 0;
function render(){
  applyTheme(); renderTabbar();
  let v;
  if (!configured) v = viewSetup();
  else if (UI.loading) v = `<div class="center" style="align-items:center"><span class="spin" style="width:32px;height:32px;color:var(--herb)"></span></div>`;
  else if (!D.user) v = viewAuth();
  else if (!isActive() || !D.family) v = viewNoFamily();
  else v = ({home:viewHome, fridge:viewFridge, recipes:viewRecipes, family:viewFamily, more:viewMore}[UI.tab])();
  const prev = $('#views .view'), same = !slideDx && prev && prev.dataset.tab === UI.tab, top = same ? prev.scrollTop : 0;
  $('#views').innerHTML = `<div class="view${same?' still':''}" data-tab="${UI.tab}" style="${slideDx?`--dx:${slideDx}px;--dy:0px`:''}">${v}</div>`;
  if (same) $('#views .view').scrollTop = top;
  slideDx = 0;
  const s = $('#search'); if (s) s.addEventListener('input', e=>{ UI.q=e.target.value; const pos=e.target.selectionStart; render(); const n=$('#search'); n.focus(); n.setSelectionRange(pos,pos); });
  const f = $('#authForm'); if (f) f.addEventListener('submit', onAuth);
}
function go(tab){ if (tab===UI.tab) return; const a=ORDER.indexOf(UI.tab), b=ORDER.indexOf(tab); slideDx=b>a?36:-36; UI.tab=tab; UI.confirmLeave=false; buzz(8); closeSheet(); render(); }

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
  if (D.user){ try { await loadAll(); subscribe(); } catch(e){ UI.err = errText(e); } }
  else { UI.auth = UI.auth==='check' ? 'check' : 'login'; D.profile=null; D.membership=null; if (channel){ sb.removeChannel(channel); channel=null; } }
  UI.loading=false; render();
}

/* ---------- Sheets ---------- */
let sheetFn = null;
function openSheet(html, keep){
  const old = $('.sheet');
  if (keep && old){ const top = old.scrollTop; old.classList.add('still'); old.innerHTML = `<div class="grabber"></div>${html}`; old.scrollTop = top; return; }
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
    <div class="r-hero" aria-hidden="true">${r.e}</div><div class="h1" style="text-align:center">${esc(r.n)}</div>
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

/* ---------- Kochmodus ---------- */
let wakeLock = null, timerT = null, audioCtx = null;
function stepMinutes(txt){ const m = txt.match(/(\d+)\s*Minuten/); return m ? +m[1] : 0; }
function openCook(id){
  UI.cook = { id, step: 0 }; sheetFn = null;
  try { navigator.wakeLock && navigator.wakeLock.request('screen').then(l => wakeLock = l).catch(()=>{}); } catch(e){}
  renderCook();
}
function renderCook(){
  const c = UI.cook, r = rec(c.id); if (!r) return;
  const n = r.s.length, txt = r.s[c.step] || '', mins = stepMinutes(txt), last = c.step === n - 1;
  $('#overlay').innerHTML = `<div class="cook" role="dialog" aria-label="Kochmodus">
    <div class="cook-top"><button class="icon-btn" data-action="cook-close" aria-label="Kochmodus beenden">${I.x}</button>
      <div style="flex:1;min-width:0"><div class="muted" style="font-size:12px;font-weight:800;letter-spacing:.08em">KOCHMODUS</div><b style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block">${r.e} ${esc(r.n)}</b></div>
      <span id="cookTimer" class="chip c-tomato" ${UI.timer?'':'hidden'}></span></div>
    <div class="cook-bar"><i style="width:${(c.step+1)/n*100}%"></i></div>
    <div class="cook-body" key="${c.step}">
      <div class="cook-num">Schritt ${c.step+1} von ${n}</div>
      <div class="cook-text">${esc(txt)}</div>
      ${mins ? `<button class="btn btn-ghost" style="margin-top:22px" data-action="timer" data-v="${mins}">⏱ ${mins}-Minuten-Timer starten</button>` : ''}
    </div>
    <div class="cook-nav">
      <button class="btn btn-ghost" data-action="cook-prev" ${c.step===0?'disabled':''}>Zurück</button>
      ${last ? `<button class="btn btn-herb" data-action="cook-done">Fertig! 🍽️</button>` : `<button class="btn btn-herb" data-action="cook-next">Weiter</button>`}
    </div></div>`;
  tickTimer();
}
function beep(){
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [0, .35, .7].forEach(t => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(.25, audioCtx.currentTime + t); g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + t + .3); o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + .3); }); } catch(e){}
}
function tickTimer(){
  const el = $('#cookTimer'); if (!UI.timer){ if (el) el.hidden = true; return; }
  const left = Math.max(0, UI.timer.end - Date.now()), m = Math.floor(left/60e3), sec = Math.floor(left%60e3/1e3);
  if (el){ el.hidden = false; el.textContent = `⏱ ${m}:${String(sec).padStart(2,'0')}`; }
  if (left <= 0){ clearInterval(timerT); UI.timer = null; beep(); buzz([300,150,300,150,300]); toast('⏰ Die Zeit ist um!'); if (el) el.hidden = true; }
}
function closeCook(){ UI.cook = null; try { wakeLock && wakeLock.release(); } catch(e){} wakeLock = null; $('#overlay').innerHTML = ''; }

/* ---------- Rechtliches ---------- */
const LEGAL = {
  impressum: ['Impressum', `<p class="muted" style="font-size:13px">Platzhalter: Vor der Veröffentlichung durch die echten Angaben des Betreibers ersetzen. Bei Minderjährigen müssen das die Eltern übernehmen.</p>
    <h3>Angaben gemäß § 5 DDG</h3><p>[Vor- und Nachname]<br>[Straße und Hausnummer]<br>[PLZ und Ort]</p>
    <h3>Kontakt</h3><p>E-Mail: [E-Mail-Adresse]</p>
    <h3>Verantwortlich für den Inhalt</h3><p>[Vor- und Nachname, Anschrift wie oben]</p>`],
  privacy: ['Datenschutz', `<p class="muted" style="font-size:13px">Entwurf. Vor der Veröffentlichung prüfen und die Platzhalter ersetzen.</p>
    <h3>Verantwortlich</h3><p>[Vor- und Nachname, Anschrift, E-Mail wie im Impressum]</p>
    <h3>Welche Daten wir speichern</h3><p>Für dein Konto: E-Mail-Adresse und verschlüsseltes Passwort. In der App: Name, Profilbild-Emoji, Essensvorlieben und Unverträglichkeiten, Familienzugehörigkeit, Wünsche, Lieblingsgerichte, Kühlschrank-Inhalt mit Ablaufdaten, eigene Rezepte, Abstimmungen und Feedback. Diese Daten sehen nur die Mitglieder deiner Familie.</p>
    <h3>Wo die Daten liegen</h3><p>Die Daten werden bei Supabase in einem Rechenzentrum in Frankfurt (EU) gespeichert.</p>
    <h3>Kühlschrank-Foto</h3><p>Fotos werden nur zur Erkennung der Zutaten an Google (Gemini) gesendet und von der App nicht gespeichert.</p>
    <h3>Hosting und Bibliotheken</h3><p>Die App wird über GitHub Pages ausgeliefert. Dabei werden technisch notwendige Daten wie deine IP-Adresse verarbeitet. Eine Programmbibliothek wird über jsDelivr geladen. Schriften liegen direkt in der App.</p>
    <h3>Deine Rechte</h3><p>Du hast das Recht auf Auskunft, Berichtigung und Löschung deiner Daten. Schreib uns dazu an die E-Mail-Adresse im Impressum. Du kannst die Familie jederzeit verlassen.</p>`],
};

/* ---------- Speichern in der Datenbank ---------- */
async function updateProfile(patch){
  Object.assign(D.profile, patch); D.profiles[D.profile.id] = D.profile;
  writing++;
  try { const { error } = await sb.from('profiles').update(patch).eq('id', D.profile.id); if (error) toast(errText(error)); }
  finally { writing--; }
}
let fridgeT = null;
function saveFridgeSoon(){ clearTimeout(fridgeT); fridgeT = setTimeout(async () => {
  writing++; Object.keys(D.expiries).forEach(k => { if (!D.fridge.includes(k)) delete D.expiries[k]; });
  try { const { error } = await sb.from('fridges').update({ items: D.fridge, expiries: D.expiries, updated_at: new Date().toISOString() }).eq('family_id', D.family.id); if (error) toast(errText(error)); }
  finally { writing--; fridgeT = null; } }, 500); }

/* ---------- Kühlschrank-Foto ---------- */
function shrink(file){ // Bild verkleinern, damit es schnell hochlädt
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => {
    const s = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width*s); c.height = Math.round(img.height*s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    res(c.toDataURL('image/jpeg', .82).split(',')[1]); }; img.onerror = rej; img.src = URL.createObjectURL(file); });
}
async function handlePhoto(file){
  if (UI.tab!=='fridge'){ UI.tab='fridge'; render(); }
  const area = $('#scanArea'), url = URL.createObjectURL(file);
  area.innerHTML = `<div class="scan" style="margin-top:12px"><img src="${url}" alt="Dein Kühlschrank-Foto"></div><p class="muted" style="display:flex;gap:8px;align-items:center;justify-content:center"><span class="spin"></span> Zutaten werden erkannt …</p>`;
  $('#island').classList.add('wide'); const done = () => $('#island').classList.remove('wide');
  try {
    const image = await shrink(file);
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
    if (a) a.innerHTML = `<div class="card" style="margin-top:12px">${msg}</div>`;
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

/* ---------- Ereignisse ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-tab],[data-action]'); if (!t) return;
  if (t.dataset.tab){ go(t.dataset.tab); return; }
  const a = t.dataset.action, id = t.dataset.id;
  try { switch(a){
    case 'close': closeSheet(); render(); break;
    case 'auth-mode': UI.auth=t.dataset.v; UI.err=''; render(); break;
    case 'pick-av': L.av=t.dataset.v; saveLocal(); document.querySelectorAll('[data-action=pick-av]').forEach(b=>b.setAttribute('aria-pressed', b.dataset.v===L.av)); buzz(6); break;
    case 'logout': UI.auth='login'; UI.err=''; await sb.auth.signOut(); UI.tab='home'; break;
    case 'join': { const c=$('#join-code').value.trim(); if(!c){ UI.err='Bitte gib den Familien-Code ein.'; render(); break; }
      UI.err=''; t.disabled=true; const { error } = await sb.rpc('request_join', { join_code:c }); if (error) throw error;
      L.joinCode=''; saveLocal(); await loadAll(); subscribe(); render(); toast('Anfrage gesendet'); buzz(20); break; }
    case 'create-family': { const n=$('#fam-name').value.trim(); if(!n){ UI.err='Bitte gib einen Namen für die Familie ein.'; render(); break; }
      UI.err=''; t.disabled=true; const { error } = await sb.rpc('create_family', { fam_name:n }); if (error) throw error;
      await loadAll(); subscribe(); render(); burstAt($('.pick')||$('.h1')); toast('Familie gegründet 🎉'); break; }
    case 'accept': { const { error } = await sb.from('memberships').update({ status:'active' }).eq('family_id', D.family.id).eq('user_id', id); if (error) throw error;
      burstAt(t); buzz(30); toast(`${prof(id).name} ist jetzt in der Familie 🎉`); await loadAll(); render(); break; }
    case 'decline': { const { error } = await sb.from('memberships').delete().eq('family_id', D.family.id).eq('user_id', id); if (error) throw error;
      toast(`Anfrage von ${prof(id).name} abgelehnt`); await loadAll(); render(); break; }
    case 'ask-leave': UI.confirmLeave=true; render(); break;
    case 'cancel-leave': UI.confirmLeave=false; render(); break;
    case 'leave': { const { error } = await sb.from('memberships').delete().eq('family_id', D.membership.family_id).eq('user_id', D.user.id); if (error) throw error;
      UI.confirmLeave=false; UI.tab='home'; await loadAll(); subscribe(); render(); break; }
    case 'invite': openInvite(); break;
    case 'copy': try { await navigator.clipboard.writeText(t.dataset.text); toast('Kopiert'); } catch(err){ toast(t.dataset.text); } break;
    case 'share-link': if (navigator.share){ navigator.share({ title:"Was gibt's?", text:'Komm in unsere Familie bei „Was gibt\'s?"', url:t.dataset.text }).catch(()=>{}); }
      else { try { await navigator.clipboard.writeText(t.dataset.text); toast('Link kopiert'); } catch(err){ toast(t.dataset.text); } } break;
    case 'eater': { let e2 = eatersNow(); e2 = e2.includes(id) ? e2.filter(x=>x!==id) : [...e2,id]; if(!e2.length){ toast('Mindestens eine Person muss mitessen'); break; } L.eaters=e2; saveLocal(); buzz(6); render(); break; }
    case 'time': UI.time=+t.dataset.v; buzz(6); render(); break;
    case 'mood': UI.mood=t.dataset.v; buzz(6); render(); break;
    case 'open-recipe': openRecipe(id); break;
    case 'wish': { const mine = D.wishes.find(w=>w.recipe_id===id && w.user_id===D.user.id);
      if (mine){ D.wishes = D.wishes.filter(w=>w!==mine); openRecipe(id, true); const { error } = await sb.from('wishes').delete().eq('id', mine.id); if (error) throw error; toast('Wunsch zurückgenommen'); }
      else { burstAt(t); buzz(25); writing++; let res; try { res = await sb.from('wishes').insert({ family_id:D.family.id, user_id:D.user.id, recipe_id:id }).select().single(); } finally { writing--; } if (res.error) throw res.error;
        D.wishes.push(res.data); openRecipe(id, true); toast('Gewünscht! Die Familie sieht es jetzt.'); } break; }
    case 'fav': { const f = new Set(D.profile.favs||[]); f.has(id) ? f.delete(id) : (f.add(id), buzz(20)); D.profile.favs=[...f]; openRecipe(id, true); await updateProfile({ favs:[...f] }); break; }
    case 'cooked': { const r=rec(id); burstAt(t); buzz([20,50,20]); D.wishes = D.wishes.filter(w=>w.recipe_id!==id);
      const { error } = await sb.from('wishes').delete().eq('family_id', D.family.id).eq('recipe_id', id); if (error) throw error;
      setTimeout(()=>{ closeSheet(); render(); }, 450); toast(`Guten Appetit! ${r.e}`); break; }
    case 'ing': { const k=t.dataset.k; D.fridge = D.fridge.includes(k) ? D.fridge.filter(x=>x!==k) : [...D.fridge,k]; saveFridgeSoon(); buzz(6);
      t.setAttribute('aria-pressed', D.fridge.includes(k)); t.classList.remove('just'); void t.offsetWidth; if (D.fridge.includes(k)) t.classList.add('just');
      document.querySelectorAll('[data-count]').forEach(c=>{ const g=c.dataset.count; c.textContent = Object.keys(ING).filter(x=>ING[x][2]===g&&D.fridge.includes(x)).length+' da'; }); break; }
    case 'clear-fridge': D.fridge=[]; saveFridgeSoon(); render(); toast('Alles abgewählt'); break;
    case 'photo': $('#photoInput').click(); break;
    case 'rtab': UI.rtab=t.dataset.v; buzz(6); render(); break;
    case 'edit-prefs': if (id===D.user.id) openPrefs(); else toast(`Nur ${prof(id).name} kann das eigene Profil ändern`); break;
    case 'set-av': document.querySelectorAll('[data-action=set-av]').forEach(b=>b.setAttribute('aria-pressed', b===t)); buzz(6); await updateProfile({ avatar:t.dataset.v }); break;
    case 'veg': t.setAttribute('aria-checked', !D.profile.veg); buzz(); await updateProfile({ veg: !D.profile.veg }); break;
    case 'picky': { const n=$('#p-name').value.trim(); if (n) D.profile.name=n.slice(0,30); buzz(); const pr = updateProfile({ picky: !D.profile.picky }); openPrefs(true); await pr; break; }
    case 'like': { const k=t.dataset.k, s=new Set(D.profile.likes||[]); s.has(k)?s.delete(k):s.add(k); t.setAttribute('aria-pressed', s.has(k)); const c=$('[data-count=likes]'); if (c) c.textContent = s.size+' gewählt'; buzz(6); await updateProfile({ likes:[...s] }); break; }
    case 'dis': { const k=t.dataset.k, s=new Set(D.profile.dislikes||[]); s.has(k)?s.delete(k):s.add(k); t.setAttribute('aria-pressed', s.has(k)); buzz(6); await updateProfile({ dislikes:[...s] }); break; }
    case 'alg': { const k=t.dataset.k, s=new Set(D.profile.allergies||[]); s.has(k)?s.delete(k):s.add(k); t.setAttribute('aria-pressed', s.has(k)); buzz(6); await updateProfile({ allergies:[...s] }); break; }
    case 'save-prefs': { const n=$('#p-name').value.trim(); if (n && n!==D.profile.name) await updateProfile({ name:n.slice(0,30) }); closeSheet(); render(); toast('Gespeichert'); break; }
    case 'changelog': L.seenVersion = VERSION; saveLocal();
      openSheet(`${sheetHead('Update-Log')}<div class="card" style="padding:4px 16px">${CHANGELOG.map((c,n)=>`<div class="log"><span class="v">${c.v}</span><div><b>${n===0?'<span class="new-badge">NEU</span> ':''}${c.d}</b><ul>${c.items.map(i=>`<li>${esc(i)}</li>`).join('')}</ul></div></div>`).join('')}</div>`);
      $('[data-action=changelog] .new-badge')?.remove(); break;
    case 'new-poll': openPollSetup(); break;
    case 'poll-pick': { const on = t.getAttribute('aria-pressed') !== 'true'; if (on && document.querySelectorAll('.pick-opt[aria-pressed=true]').length >= 4){ toast('Höchstens 4 Gerichte'); break; } t.setAttribute('aria-pressed', on); buzz(6); break; }
    case 'start-poll': { const ids = [...document.querySelectorAll('.pick-opt[aria-pressed=true]')].map(b => b.dataset.id);
      if (ids.length < 2){ toast('Bitte mindestens 2 Gerichte wählen'); break; }
      if (D.poll && D.poll.status === 'open' && (D.poll.created_by === D.user.id || isAdmin())) await sb.from('polls').update({ status:'closed' }).eq('id', D.poll.id);
      writing++; let res; try { res = await sb.from('polls').insert({ family_id:D.family.id, created_by:D.user.id, options:ids, status:'open' }).select().single(); } finally { writing--; }
      if (res.error) throw res.error; D.poll = res.data; D.votes = []; closeSheet(); render(); buzz(25); toast('Abstimmung gestartet 🗳️'); break; }
    case 'vote': { if (!D.poll || D.poll.status !== 'open') break;
      D.votes = D.votes.filter(v => v.user_id !== D.user.id).concat({ poll_id:D.poll.id, family_id:D.family.id, user_id:D.user.id, recipe_id:id });
      buzz(15); render(); writing++;
      try { const { error } = await sb.from('votes').upsert({ poll_id:D.poll.id, family_id:D.family.id, user_id:D.user.id, recipe_id:id }, { onConflict:'poll_id,user_id' }); if (error) throw error; } finally { writing--; } break; }
    case 'end-poll': { const counts = {}; D.votes.forEach(v => counts[v.recipe_id] = (counts[v.recipe_id]||0) + 1);
      const winner = D.poll.options.slice().sort((a,b) => (counts[b]||0) - (counts[a]||0))[0];
      writing++; try { const { error } = await sb.from('polls').update({ status:'closed', winner }).eq('id', D.poll.id); if (error) throw error; } finally { writing--; }
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
      t.disabled = true; writing++; let res; try { res = await sb.from('custom_recipes').insert(row).select().single(); } finally { writing--; }
      if (res.error){ t.disabled = false; throw res.error; }
      await loadAll(); closeSheet(); UI.rtab = 'fam'; render(); burstAt($('.rc')); toast('Rezept gespeichert 📖'); break; }
    case 'ask-del': UI.confirmDel = id; openRecipe(id, true); break;
    case 'cancel-del': UI.confirmDel = null; openRecipe(id, true); break;
    case 'del-recipe': { const r = rec(id); const { error } = await sb.from('custom_recipes').delete().eq('id', r.dbid); if (error) throw error;
      UI.confirmDel = null; await loadAll(); closeSheet(); render(); toast('Rezept gelöscht'); break; }
    case 'feedback': openFeedback(); break;
    case 'send-feedback': { const msg = $('#fb-text').value.trim(); if (!msg){ toast('Bitte schreib kurz etwas'); $('#fb-text').focus(); break; }
      t.disabled = true; const { error } = await sb.from('feedback').insert({ user_id:D.user.id, kind:$('[data-action=fb-kind][aria-pressed=true]')?.dataset.v || 'idee', message:msg, app_version:VERSION });
      if (error){ t.disabled = false; throw error; } closeSheet(); toast('Danke für dein Feedback! 💚'); break; }
    case 'cook': openCook(id); break;
    case 'cook-next': UI.cook.step++; buzz(8); renderCook(); break;
    case 'cook-prev': UI.cook.step = Math.max(0, UI.cook.step - 1); buzz(8); renderCook(); break;
    case 'cook-close': closeCook(); render(); break;
    case 'cook-done': { const cid = UI.cook.id; closeCook(); render(); openRecipe(cid); setTimeout(() => { const b = $('[data-action=cooked]'); if (b) b.click(); }, 350); break; }
    case 'timer': { const m = +t.dataset.v; UI.timer = { end: Date.now() + m*60e3 }; clearInterval(timerT); timerT = setInterval(tickTimer, 500); tickTimer(); beep(); buzz(20); toast(`Timer: ${m} Minuten`); break; }
    case 'legal': { const [title, html] = LEGAL[t.dataset.v]; sheetFn = null; openSheet(`${sheetHead(title)}<div class="legal">${html}</div>`); break; }
    case 'theme': L.theme=t.dataset.v; saveLocal(); render(); break;
  } } catch(err){ UI.err = errText(err); toast(UI.err); render(); }
});

/* Wischen zwischen den Tabs */
let tx=0, ty=0;
$('#views').addEventListener('touchstart', e=>{ tx=e.touches[0].clientX; ty=e.touches[0].clientY; }, {passive:true});
$('#overlay').addEventListener('touchstart', e=>{ tx=e.touches[0].clientX; ty=e.touches[0].clientY; }, {passive:true});
$('#overlay').addEventListener('touchend', e=>{ if (!UI.cook) return; const dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty;
  if (Math.abs(dx)>70 && Math.abs(dx)>Math.abs(dy)*1.6){ const r = rec(UI.cook.id); const k = UI.cook.step + (dx<0?1:-1); if (k>=0 && k<r.s.length){ UI.cook.step=k; buzz(8); renderCook(); } } }, {passive:true});
$('#views').addEventListener('touchend', e=>{ if(!D.user || !isActive()) return;
  const dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty;
  if (Math.abs(dx)>70 && Math.abs(dx)>Math.abs(dy)*1.6){ const k=ORDER.indexOf(UI.tab)+(dx<0?1:-1); if(k>=0&&k<ORDER.length) go(ORDER[k]); } }, {passive:true});

/* ---------- Farbschema ---------- */
function applyTheme(){ const r=document.documentElement, th=L.theme||'system'; if(th==='system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', th); }

/* ---------- Geräte-Modus: iPhone-Simulator am Computer ---------- */
const mq = window.matchMedia('(min-width: 820px) and (pointer: fine)');
function layout(){
  const framed = mq.matches; document.documentElement.classList.toggle('framed', framed);
  const w=$('#phoneWrap'), p=$('#phone');
  if (framed){ const s=Math.min(1,(window.innerHeight-40)/874); w.style.width=(420*s)+'px'; w.style.height=(874*s)+'px'; p.style.transform=`scale(${s})`; }
  else { w.style.width=''; w.style.height=''; p.style.transform=''; }
}
try { mq.addEventListener('change', layout); } catch(e){ mq.addListener && mq.addListener(layout); }
window.addEventListener('resize', layout);
const tickClock = () => { const d=new Date(); $('#clock').textContent=d.getHours()+':'+String(d.getMinutes()).padStart(2,'0'); };
setInterval(tickClock, 1000); tickClock();

/* ---------- Start-Intro ---------- */
(() => { const sp = $('#splash'); if (!sp) return;
  const hide = () => { sp.classList.add('gone'); };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches){ hide(); return; }
  sp.addEventListener('animationend', e => { if (e.animationName === 'spOut') hide(); });
  sp.addEventListener('click', hide); setTimeout(hide, 3200); })();

/* ---------- Start ---------- */
/* Neue Versionen automatisch laden: sobald ein neuer Service Worker übernimmt, einmal neu laden */
if ('serviceWorker' in navigator && location.protocol === 'https:'){
  const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded){ reloaded = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => { r.update(); document.addEventListener('visibilitychange', () => { if (!document.hidden) r.update(); }); }).catch(()=>{});
}
layout(); render();
if (configured){
  sb.auth.getSession().then(({ data }) => onSession(data.session));
  sb.auth.onAuthStateChange((ev, session) => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') onSession(session); });
} else { UI.loading=false; render(); }
