/* =========================================================================
   WAS GIBT'S? – Admin-Panel (Version 1.8)
   Nur für App-Admins (Tabelle app_admins). Alle Daten kommen über
   geschützte Datenbank-Funktionen, die den Zugriff selbst prüfen.
   ========================================================================= */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = d => d ? new Date(d).toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '–';
const fmtTime = d => d ? new Date(d).toLocaleString('de-DE', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '–';
function ago(d){
  if (!d) return 'nie';
  const m = Math.round((Date.now() - new Date(d)) / 6e4);
  if (m < 2) return 'gerade eben'; if (m < 60) return `vor ${m} Min`;
  const h = Math.round(m / 60); if (h < 24) return `vor ${h} Std`;
  const t = Math.round(h / 24); return t === 1 ? 'gestern' : `vor ${t} Tagen`;
}
function toast(m){ const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200); }
const localInput = d => { const x = new Date(d - new Date().getTimezoneOffset() * 6e4); return x.toISOString().slice(0, 16); };

const S = { user:null, admin:false, page:'home', stats:null, counts:null, users:[], families:[], feedback:[], log:[], anns:[], templates:[], scheduled:[], auto:null,
            q:'', fbFilter:'open', logFilter:'all', errors:{},
            push:{ title:'', body:'', target:'all', fam:'', user:'', url:'home', later:false, at:'' },
            confirm:false, busy:false, err:'', menu:false, confirmOut:false };
try { S.page = sessionStorage.getItem('adm.page') || 'home'; } catch(e){}

const PAGES = [
  ['home','📊','Übersicht'], ['push','🔔','Push senden'], ['auto','🤖','Automatisch'], ['ann','📣','Ankündigung'],
  ['feedback','💬','Feedback'], ['users','👤','Nutzer'], ['families','👨‍👩‍👧','Familien'],
];
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

/* ---------- Daten ---------- */
async function load(what){
  const rpc = async (fn) => { const { data, error } = await sb.rpc(fn); if (error) throw error; return data; };
  const tbl = async (q) => { const { data, error } = await q; if (error) throw error; return data || []; };
  const jobs = {
    stats:     async () => { S.stats = await rpc('admin_stats'); },
    counts:    async () => { S.counts = await rpc('admin_push_counts'); },
    users:     async () => { S.users = await rpc('admin_users') || []; },
    families:  async () => { S.families = await rpc('admin_families') || []; },
    feedback:  async () => { S.feedback = await rpc('admin_feedback') || []; },
    log:       async () => { S.log = await tbl(sb.from('push_log').select('*').order('created_at', { ascending:false }).limit(60)); },
    anns:      async () => { S.anns = await tbl(sb.from('announcements').select('*').order('created_at', { ascending:false }).limit(20)); },
    templates: async () => { S.templates = await tbl(sb.from('push_templates').select('*').order('created_at', { ascending:false })); },
    scheduled: async () => { S.scheduled = await tbl(sb.from('push_scheduled').select('*').order('send_at', { ascending:true }).limit(50)); },
    auto:      async () => { const r = await tbl(sb.from('app_settings').select('value').eq('key','auto_push')); S.auto = (r[0] && r[0].value) || { wish:true, poll:true, join:true, accept:true }; },
  };
  await Promise.all((what || Object.keys(jobs)).map(async k => {
    try { await jobs[k](); delete S.errors[k]; }
    catch(e){ S.errors[k] = e.message || String(e); console.warn(k, e); }
  }));
}

/* ---------- Ansichten ---------- */
function viewLogin(){
  return `<div class="login"><form id="loginForm">
    <div class="logo">🍳</div><h1>Admin-Bereich</h1><p>Was gibt's? · nur für Betreiber</p>
    <div class="field"><label for="m">E-Mail</label><input id="m" type="email" autocomplete="username" required></div>
    <div class="field"><label for="p">Passwort</label><input id="p" type="password" autocomplete="current-password" required></div>
    <div id="loginErr">${S.err ? `<div class="chip c-tomato" style="padding:8px 12px;border-radius:10px;white-space:normal">${esc(S.err)}</div>` : ''}</div>
    <button class="btn btn-herb" id="loginBtn">Anmelden</button>
    <a href="./" class="muted" style="font-size:13px;text-align:center">← Zur App</a>
  </form></div>`;
}
function viewDenied(){
  return `<div class="login"><div class="card" style="max-width:380px;text-align:center;display:grid;gap:10px">
    <div style="font-size:44px">🔒</div><h1 style="font-size:24px">Kein Zugriff</h1>
    <p class="muted" style="margin:0">Dieser Account (${esc(S.user.email)}) ist kein App-Admin.</p>
    <button class="btn" data-a="logout">Abmelden</button><a href="./" class="muted" style="font-size:13px">← Zur App</a></div></div>`;
}
function errBox(keys){
  const list = keys.filter(k => S.errors[k]);
  if (!list.length) return '';
  return `<div class="card" style="background:var(--tomato-soft);color:var(--tomato);margin-bottom:14px;font-weight:600">⚠️ Konnte nicht laden: ${list.map(k => `<b>${esc(k)}</b> (${esc(S.errors[k])})`).join(', ')}<br><button class="btn btn-sm" style="margin-top:8px" data-a="refresh">Erneut versuchen</button></div>`;
}

function kpi(l, v, s){ return `<div class="card kpi"><div class="l">${l}</div><div class="v">${v ?? '–'}</div>${s?`<div class="s">${s}</div>`:''}</div>`; }
function viewHome(){
  const st = S.stats || {}, c = S.counts || {};
  const days = []; for (let i = 13; i >= 0; i--){ const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i); days.push(d); }
  const map = {}; (st.signups || []).forEach(x => map[x.day] = x.n);
  const vals = days.map(d => { const k = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); return { d, n: map[k] || 0 }; });
  const max = Math.max(1, ...vals.map(v => v.n));
  const open = S.feedback.filter(f => !f.done).slice(0, 4);
  const next = S.scheduled.find(p => p.status === 'geplant');
  return head('Übersicht', 'So läuft „Was gibt\'s?" gerade', `<button class="btn btn-sm" data-a="refresh">↻ Aktualisieren</button>`) + errBox(['stats','counts','feedback']) + `
    <div class="grid kpis">
      ${kpi('Nutzer', st.users, `+${st.users_7d ?? 0} in 7 Tagen`)}
      ${kpi('Heute aktiv', st.active_today, `${st.active_7d ?? 0} in 7 Tagen`)}
      ${kpi('Familien', st.families, `${st.members ?? 0} Mitglieder · ${st.pending ?? 0} Anfragen`)}
      ${kpi('Push-Geräte', c.all ?? st.push_devices, `${c.users ?? 0} Personen · ${c.auto_7d ?? 0} automatisch in 7 Tagen`)}
      ${kpi('Eigene Rezepte', st.recipes, `${st.wishes ?? 0} Wünsche · ${st.polls ?? 0} Abstimmungen`)}
      ${kpi('Offenes Feedback', st.feedback_open, `${st.plus ?? 0} Plus-Interessenten`)}
    </div>
    <div class="grid two" style="margin-top:14px">
      <div class="card"><h2>Neue Nutzer · 14 Tage</h2>
        <div class="bars" role="img" aria-label="Neue Nutzer pro Tag">${vals.map(v => `<div title="${v.d.toLocaleDateString('de-DE')}: ${v.n}">${v.n?`<em>${v.n}</em>`:''}<i style="height:${Math.round(v.n/max*100)}%"></i><span>${v.d.getDate()}.</span></div>`).join('')}</div></div>
      <div class="card"><h2>Neuestes Feedback</h2>
        ${open.length ? `<div class="fb">${open.map(f => `<div><div class="meta">${kindChip(f.kind)} ${esc(f.name || 'Unbekannt')} · ${ago(f.created_at)}</div><div class="msg" style="margin-top:3px">${esc(f.message.length > 140 ? f.message.slice(0,140) + '…' : f.message)}</div></div>`).join('')}</div>
          <button class="btn btn-sm" style="margin-top:12px" data-page="feedback">Alle ansehen</button>`
        : `<div class="empty"><div class="g">📭</div>Kein offenes Feedback</div>`}
        ${next ? `<div class="meta" style="margin-top:14px;font-size:13px">⏰ Nächste geplante Nachricht: <b>${esc(next.title)}</b> · ${fmtTime(next.send_at)}</div>` : ''}</div>
    </div>`;
}

/* ----- Push senden ----- */
function reach(){
  const P = S.push, c = S.counts || {};
  if (P.target === 'test') return 'nur an deine eigenen Geräte';
  if (P.target === 'family'){ const f = S.families.find(x => x.id === P.fam); return f ? `an Familie ${esc(f.name)}` : 'an die gewählte Familie'; }
  if (P.target === 'user'){ const u = S.users.find(x => x.id === P.user); return u ? `an ${esc(u.name || u.email)} (${u.devices || 0} ${u.devices === 1 ? 'Gerät' : 'Geräte'})` : 'an die gewählte Person'; }
  const n = { all:c.all, active7:c.active7, inactive14:c.inactive14 }[P.target] ?? 0;
  return `an ${n} ${n === 1 ? 'Gerät' : 'Geräte'}`;
}
function viewPush(){
  const P = S.push;
  const famOpts = S.families.map(f => `<option value="${f.id}" ${P.fam===f.id?'selected':''}>${esc(f.name)} (${f.members})</option>`).join('');
  const userOpts = S.users.filter(u => u.devices > 0 || u.id === P.user).map(u => `<option value="${u.id}" ${P.user===u.id?'selected':''}>${esc(u.name || '(ohne Namen)')} · ${esc(u.email)} · 🔔 ${u.devices}</option>`).join('');
  const tpls = [...S.templates.map(t => ({ ...t, own:true })), ...BUILTIN];
  const minAt = localInput(Date.now() + 2*6e4);
  const planned = S.scheduled.filter(p => p.status === 'geplant');
  const logList = S.log.filter(l => S.logFilter === 'all' || l.kind === S.logFilter);
  return head('Push senden', 'Nachricht aufs Handy aller Nutzer mit eingeschalteten Benachrichtigungen') + errBox(['counts','log','templates','scheduled']) + `
    <div class="grid two">
      <div class="card" style="display:grid;gap:14px">
        <div class="field"><label>Vorlage</label>
          <div class="tpls">${tpls.map((t,i) => `<span class="tpl"><button class="btn btn-sm" data-a="tpl" data-i="${i}" title="${esc(t.body)}">${esc(t.title)}</button>${t.own?`<button class="btn btn-sm tpl-x" data-a="tpl-del" data-id="${t.id}" aria-label="Vorlage löschen">✕</button>`:''}</span>`).join('')}</div></div>
        <div class="field"><label>An wen?</label>
          <div class="seg wrap" role="group">${TARGETS.map(([k,l]) => `<button data-a="target" data-v="${k}" aria-pressed="${P.target===k}">${l}</button>`).join('')}</div>
          <div class="hint" style="text-align:left">${{ all:'Alle Geräte mit eingeschalteten Benachrichtigungen', active7:'Nur wer in den letzten 7 Tagen in der App war', inactive14:'Nur wer seit 14 Tagen nicht mehr da war – gut für „Wir vermissen dich"', family:'Alle in einer Familie', user:'Eine einzelne Person', test:'Nur deine eigenen Geräte – zum Ausprobieren' }[P.target]}</div></div>
        ${P.target === 'family' ? `<div class="field"><label for="pf">Familie</label><select id="pf" data-in="fam"><option value="">Bitte wählen …</option>${famOpts}</select></div>` : ''}
        ${P.target === 'user' ? `<div class="field"><label for="pu">Person</label><select id="pu" data-in="user"><option value="">Bitte wählen …</option>${userOpts}</select>${!userOpts?'<div class="hint" style="text-align:left">Noch niemand hat Benachrichtigungen eingeschaltet.</div>':''}</div>` : ''}
        <div class="field"><label for="pt">Titel</label><input id="pt" maxlength="80" data-in="title" value="${esc(P.title)}" placeholder="z. B. Neue Rezepte sind da 🍝"><div class="hint" data-hint="title">${P.title.length}/80</div></div>
        <div class="field"><label for="pb">Text</label><textarea id="pb" maxlength="240" data-in="body" placeholder="Was möchtest du sagen?">${esc(P.body)}</textarea><div class="hint" data-hint="body">${P.body.length}/240</div></div>
        <div class="field"><label for="pl">Beim Antippen öffnen</label><select id="pl" data-in="url">${LINKS.map(([k,l]) => `<option value="${k}" ${P.url===k?'selected':''}>${l}</option>`).join('')}</select></div>
        ${P.target !== 'test' ? `<label class="check"><input type="checkbox" data-a="later" ${P.later?'checked':''}> Später senden</label>
        ${P.later ? `<div class="field"><label for="pa">Wann?</label><input id="pa" type="datetime-local" data-in="at" min="${minAt}" value="${esc(P.at || localInput(Date.now() + 60*6e4))}"></div>` : ''}` : ''}
        <div class="row">
          ${S.confirm
            ? `<button class="btn btn-tomato" data-a="send" ${S.busy?'disabled':''}>${S.busy?'Sende …':P.later?'Ja, so planen':'Ja, jetzt senden'}</button><button class="btn" data-a="cancel">Abbrechen</button>`
            : `<button class="btn btn-herb" data-a="ask-send" ${S.busy?'disabled':''}>${S.busy?'Sende …':P.target==='test'?'Test senden':P.later?'Planen …':'Senden …'}</button>`}
          <button class="btn btn-sm" data-a="tpl-save">☆ Als Vorlage speichern</button>
        </div>
        <div class="muted" style="font-size:13px" id="reach">Geht ${reach()}</div>
        ${S.confirm ? `<div class="chip c-yolk" style="padding:8px 12px;border-radius:10px;white-space:normal">${P.later?'Die Nachricht wird zur gewählten Zeit automatisch gesendet.':'Wirklich senden? Die Nachricht lässt sich danach nicht zurückholen.'}</div>` : ''}
      </div>
      <div class="card"><h2>Vorschau</h2>
        <div class="preview"><div class="notif"><div class="ic">🍳</div><div><b><span class="nt">${esc(P.title || 'Titel der Nachricht')}</span><span>jetzt</span></b><p class="nb">${esc(P.body || 'Hier steht dein Text.')}</p></div></div></div>
        <p class="muted" style="font-size:13px;margin:12px 0 0">Am iPhone kommt die Nachricht nur an, wenn „Was gibt's?" auf dem Home-Bildschirm installiert ist und Benachrichtigungen unter „Mehr" eingeschaltet sind.</p>
        ${planned.length ? `<h2 style="margin-top:18px">Geplant</h2><div class="fb">${planned.map(p => `<div class="item"><div><div class="meta">⏰ ${fmtTime(p.send_at)} · ${esc(targetLabel(p))}</div><b>${esc(p.title)}</b><div class="muted" style="font-size:13px">${esc(p.body)}</div></div><div><button class="btn btn-sm" data-a="sched-cancel" data-id="${p.id}">Abbrechen</button></div></div>`).join('')}</div>` : ''}
      </div>
    </div>
    <div class="card" style="margin-top:14px"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h2 style="margin:0">Gesendet</h2>
      <div class="seg">${[['all','Alle'],['manuell','Von dir'],['geplant','Geplant'],['auto','Automatisch'],['test','Tests']].map(([k,l]) => `<button data-a="log-filter" data-v="${k}" aria-pressed="${S.logFilter===k}">${l}</button>`).join('')}</div></div>
      ${logList.length ? `<div class="table-wrap"><table><thead><tr><th>Wann</th><th>Nachricht</th><th>An</th><th>Art</th><th>Angekommen</th><th>Fehler</th></tr></thead><tbody>
        ${logList.map(l => `<tr><td>${fmtTime(l.created_at)}</td><td><b>${esc(l.title)}</b><div class="muted" style="font-size:13px">${esc(l.body)}</div></td><td>${esc(l.target)}</td><td>${kindLabel(l.kind)}</td><td class="num">${l.sent}</td><td class="num">${l.failed || ''}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty"><div class="g">🔕</div>Noch nichts in dieser Ansicht</div>`}
    </div>`;
}
const kindLabel = k => ({ manuell:'<span class="chip">Von dir</span>', geplant:'<span class="chip c-yolk">Geplant</span>', auto:'<span class="chip c-herb">Automatisch</span>', test:'<span class="chip">Test</span>' })[k] || esc(k);
function targetLabel(p){
  if (p.target === 'family'){ const f = S.families.find(x => x.id === p.family_id); return 'Familie ' + (f ? f.name : '?'); }
  if (p.target === 'user'){ const u = S.users.find(x => x.id === p.user_id); return u ? (u.name || u.email) : 'Person'; }
  return ({ all:'Alle', active7:'Aktive', inactive14:'Inaktive' })[p.target] || p.target;
}

/* ----- Automatische Benachrichtigungen ----- */
function viewAuto(){
  const a = S.auto || {};
  const sent = S.log.filter(l => l.kind === 'auto');
  return head('Automatisch', 'Nachrichten, die die App von selbst an Familien schickt') + errBox(['auto','log']) + `
    <div class="card"><h2>Was soll automatisch verschickt werden?</h2>
      <div class="auto-list">${AUTO.map(([k,t,d]) => `<div class="auto-row"><div><b>${t}</b><div class="muted" style="font-size:13px">${d}</div></div>
        <button class="switch" role="switch" aria-checked="${a[k] !== false}" data-a="auto" data-v="${k}" aria-label="${esc(t)}"></button></div>`).join('')}</div>
      <p class="muted" style="font-size:13px;margin:14px 0 0">Schutz gegen Nerven: Dieselbe Meldung geht höchstens alle 10 Minuten raus, und pro Person höchstens 15 pro Stunde. Wer Benachrichtigungen in der App ausschaltet, bekommt nichts.</p>
    </div>
    <div class="card" style="margin-top:14px"><h2>Zuletzt automatisch gesendet</h2>
      ${sent.length ? `<div class="table-wrap"><table><thead><tr><th>Wann</th><th>Nachricht</th><th>An</th><th>Angekommen</th></tr></thead><tbody>
        ${sent.map(l => `<tr><td>${fmtTime(l.created_at)}</td><td><b>${esc(l.title)}</b><div class="muted" style="font-size:13px">${esc(l.body)}</div></td><td>${esc(l.target)}</td><td class="num">${l.sent}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty"><div class="g">🤖</div>Noch keine automatischen Nachrichten</div>`}
    </div>`;
}

function viewAnn(){
  const cur = S.anns.find(a => a.active);
  return head('Ankündigung', 'Ein Banner oben auf „Heute" in der App, für alle Nutzer') + errBox(['anns']) + `
    <div class="grid two">
      <div class="card" style="display:grid;gap:14px">
        <h2 style="margin:0">Neue Ankündigung</h2>
        <div class="row" style="flex-wrap:nowrap">
          <div class="field" style="width:80px"><label for="ae">Emoji</label><input id="ae" maxlength="4" value="📣" style="text-align:center;font-size:20px"></div>
          <div class="field" style="flex:1"><label for="at">Text</label><input id="at" maxlength="200" placeholder="z. B. Neu: über 580 Rezepte!"></div>
        </div>
        <div class="row"><button class="btn btn-herb" data-a="ann-save">Veröffentlichen</button><span class="muted" style="font-size:13px">Ersetzt die aktuelle Ankündigung</span></div>
      </div>
      <div class="card"><h2>Gerade sichtbar</h2>
        ${cur ? `<div class="ann-prev"><span style="font-size:22px">${esc(cur.emoji)}</span><span style="flex:1">${esc(cur.text)}</span></div>
          <div class="row" style="margin-top:12px"><span class="muted" style="font-size:13px">seit ${fmtTime(cur.created_at)}</span><button class="btn btn-sm" data-a="ann-off" data-id="${cur.id}">Ausblenden</button></div>`
        : `<div class="empty"><div class="g">🙈</div>Gerade keine Ankündigung</div>`}
      </div>
    </div>
    <div class="card" style="margin-top:14px"><h2>Frühere Ankündigungen</h2>
      ${S.anns.length ? `<div class="table-wrap"><table><thead><tr><th>Text</th><th>Erstellt</th><th>Status</th><th></th></tr></thead><tbody>
      ${S.anns.map(a => `<tr><td>${esc(a.emoji)} ${esc(a.text)}</td><td>${fmtTime(a.created_at)}</td><td>${a.active?'<span class="chip c-herb">sichtbar</span>':'<span class="chip">aus</span>'}</td>
        <td style="text-align:right;white-space:nowrap">${a.active?`<button class="btn btn-sm" data-a="ann-off" data-id="${a.id}">Ausblenden</button>`:`<button class="btn btn-sm" data-a="ann-on" data-id="${a.id}">Wieder zeigen</button>`} <button class="btn btn-sm" data-a="ann-del" data-id="${a.id}" aria-label="Löschen">🗑</button></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">Noch keine</div>`}
    </div>`;
}

function kindChip(k){ return ({ fehler:'<span class="chip c-tomato">🐞 Fehler</span>', idee:'<span class="chip c-yolk">💡 Idee</span>', lob:'<span class="chip c-herb">💚 Lob</span>', plus:'<span class="chip c-herb">✨ Plus</span>' })[k] || `<span class="chip">${esc(k)}</span>`; }
function viewFeedback(){
  const f = S.fbFilter;
  const list = S.feedback.filter(x => f === 'all' ? true : f === 'open' ? !x.done : x.kind === f);
  const n = k => S.feedback.filter(x => k === 'all' ? true : k === 'open' ? !x.done : x.kind === k).length;
  return head('Feedback', 'Alles, was über „Mehr → Feedback senden" und „Plus" reinkommt') + errBox(['feedback']) + `
    <div class="seg wrap" role="group" style="margin-bottom:14px">${[['open','Offen'],['all','Alle'],['fehler','Fehler'],['idee','Ideen'],['lob','Lob'],['plus','Plus']].map(([k,l]) => `<button data-a="fb-filter" data-v="${k}" aria-pressed="${f===k}">${l} · ${n(k)}</button>`).join('')}</div>
    <div class="card">${list.length ? `<div class="fb">${list.map(x => `<div class="item ${x.done?'done':''}">
        <div><div class="meta">${kindChip(x.kind)} <b>${esc(x.name || 'Unbekannt')}</b> ${x.email?`<a href="mailto:${esc(x.email)}" class="muted">${esc(x.email)}</a>`:''} · ${fmtTime(x.created_at)} ${x.app_version?`· v${esc(x.app_version)}`:''}</div>
          <div class="msg" style="margin-top:4px">${esc(x.message)}</div></div>
        <div class="row" style="align-items:flex-start"><button class="btn btn-sm" data-a="fb-done" data-id="${x.id}" data-v="${!x.done}">${x.done?'↺ Wieder öffnen':'✓ Erledigt'}</button><button class="btn btn-sm" data-a="fb-del" data-id="${x.id}" aria-label="Löschen">🗑</button></div>
      </div>`).join('')}</div>` : `<div class="empty"><div class="g">📭</div>Nichts in dieser Ansicht</div>`}</div>`;
}

function viewUsers(){
  const q = S.q.toLowerCase();
  const list = S.users.filter(u => !q || [u.name, u.email, u.family].some(v => (v || '').toLowerCase().includes(q)));
  return head('Nutzer', `${S.users.length} Accounts`, `<input class="search" id="q" placeholder="Suchen: Name, E-Mail, Familie" value="${esc(S.q)}">`) + errBox(['users']) + `
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Nutzer</th><th>Familie</th><th>Registriert</th><th>Zuletzt aktiv</th><th>🔔</th><th></th></tr></thead><tbody id="userRows">
    ${userRows(list)}
    </tbody></table></div></div>`;
}
function userRows(list){
  return list.map(u => `<tr>
      <td><div class="who"><span class="av">${esc(u.avatar || '🙂')}</span><span><b>${esc(u.name || '(ohne Profil)')}</b> ${u.banned?'<span class="chip c-tomato">gesperrt</span>':''}<small>${esc(u.email)}</small></span></div></td>
      <td>${u.family ? `${esc(u.family)} ${u.role==='admin'?'<span class="chip">Admin</span>':''}` : '<span class="muted">–</span>'}</td>
      <td>${fmtDate(u.created_at)}</td><td>${ago(u.last_seen)}</td><td class="num">${u.devices || ''}</td>
      <td style="text-align:right;white-space:nowrap">${u.devices ? `<button class="btn btn-sm" data-a="push-user" data-id="${u.id}" title="Nachricht an diese Person">🔔</button> ` : ''}${u.id === S.user.id ? '<span class="muted" style="font-size:13px">Du</span>' : `<button class="btn btn-sm ${u.banned?'':'btn-tomato'}" data-a="ban" data-id="${u.id}" data-v="${!u.banned}">${u.banned?'Entsperren':'Sperren'}</button>`}</td>
    </tr>`).join('') || `<tr><td colspan="6"><div class="empty">Niemand gefunden</div></td></tr>`;
}

function viewFamilies(){
  return head('Familien', `${S.families.length} Familien`) + errBox(['families']) + `
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Familie</th><th>Code</th><th>Mitglieder</th><th>Anfragen</th><th>Eigene Rezepte</th><th>Seit</th><th></th></tr></thead><tbody>
    ${S.families.map(f => `<tr><td><b>${esc(f.name)}</b></td><td><code>${esc(f.code)}</code></td><td class="num">${f.members}</td><td class="num">${f.pending || ''}</td><td class="num">${f.recipes || ''}</td><td>${fmtDate(f.created_at)}</td>
      <td style="text-align:right"><button class="btn btn-sm" data-a="push-fam" data-id="${f.id}">🔔 Nachricht</button></td></tr>`).join('') || `<tr><td colspan="7"><div class="empty">Noch keine Familien</div></td></tr>`}
    </tbody></table></div></div>`;
}

function head(t, sub, right=''){
  return `<div class="head"><div class="row" style="gap:12px;flex-wrap:nowrap"><button class="btn btn-sm menu-btn" data-a="menu" aria-label="Menü">☰</button><div><h1>${t}</h1>${sub?`<p>${sub}</p>`:''}</div></div>${right}</div>`;
}

function render(){
  const app = $('#app');
  if (!S.user){ if (!$('#loginForm')) app.innerHTML = viewLogin(); else $('#loginErr').innerHTML = S.err ? `<div class="chip c-tomato" style="padding:8px 12px;border-radius:10px;white-space:normal">${esc(S.err)}</div>` : ''; const b = $('#loginBtn'); if (b){ b.disabled = S.busy; b.textContent = S.busy ? 'Melde an …' : 'Anmelden'; } return; }
  if (!S.admin){ app.innerHTML = viewDenied(); return; }
  const open = S.feedback.filter(f => !f.done).length;
  const v = { home:viewHome, push:viewPush, auto:viewAuto, ann:viewAnn, feedback:viewFeedback, users:viewUsers, families:viewFamilies }[S.page] || viewHome;
  const focus = document.activeElement && document.activeElement.id, pos = focus && document.activeElement.selectionStart, y = window.scrollY;
  app.innerHTML = `<div class="shell ${S.menu?'open':''}">
    <nav class="side" aria-label="Bereiche">
      <div class="brand"><span style="font-size:26px">🍳</span><span>Was gibt's?<small>Admin-Panel</small></span></div>
      ${PAGES.map(([k,i,l]) => `<button class="nav" data-page="${k}" ${S.page===k?'aria-current="page"':''}><span class="ico">${i}</span>${l}${k==='feedback'&&open?`<span class="count">${open}</span>`:''}</button>`).join('')}
      <div class="foot"><span>${esc(S.user.email)}</span><a href="./">← Zur App</a><button data-a="logout">${S.confirmOut ? 'Wirklich abmelden? (meldet auch die App ab)' : 'Abmelden'}</button></div>
    </nav>
    <main>${v()}</main></div>`;
  window.scrollTo(0, y);
  if (focus){ const el = document.getElementById(focus); if (el){ el.focus(); try { el.setSelectionRange(pos, pos); } catch(e){} } }
}

/* ---------- Ereignisse ---------- */
async function onLogin(e){
  e.preventDefault();
  const email = $('#m').value.trim(), password = $('#p').value;   // ZUERST auslesen, dann neu zeichnen
  if (!email || !password){ S.err = 'Bitte E-Mail und Passwort eingeben.'; render(); return; }
  S.err = ''; S.busy = true; render();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  S.busy = false;
  if (error){ S.err = /Invalid login/i.test(error.message) ? 'E-Mail oder Passwort stimmt nicht.' : error.message; render(); }
}
document.addEventListener('submit', e => { if (e.target.id === 'loginForm') onLogin(e); });

document.addEventListener('input', e => {
  const k = e.target.dataset.in;
  if (k){
    S.push[k] = e.target.value; S.confirm = false;
    if (k === 'title' || k === 'body'){ // nur Vorschau und Zähler anpassen, ohne den Fokus zu verlieren
      const n = $('.notif'); if (n){ n.querySelector('.nt').textContent = S.push.title || 'Titel der Nachricht'; n.querySelector('.nb').textContent = S.push.body || 'Hier steht dein Text.'; }
      const h = $(`[data-hint=${k}]`); if (h) h.textContent = `${e.target.value.length}/${e.target.maxLength}`;
      return;
    }
    if (k === 'at') return;
    render(); return;
  }
  if (e.target.id === 'q'){ S.q = e.target.value; const q = S.q.toLowerCase(); const tb = $('#userRows'); if (tb) tb.innerHTML = userRows(S.users.filter(u => !q || [u.name, u.email, u.family].some(v => (v || '').toLowerCase().includes(q)))); }
});
document.addEventListener('change', e => { const k = e.target.dataset.in; if (k === 'fam' || k === 'user' || k === 'url'){ S.push[k] = e.target.value; const r = $('#reach'); if (r) r.textContent = 'Geht ' + reach().replace(/<[^>]+>/g,''); } });

document.addEventListener('click', async e => {
  const nav = e.target.closest('[data-page]');
  if (nav){ S.page = nav.dataset.page; S.menu = false; S.confirm = false; try { sessionStorage.setItem('adm.page', S.page); } catch(err){} render(); window.scrollTo(0,0); return; }
  if (S.menu && e.target.closest('main')){ S.menu = false; render(); return; }
  const t = e.target.closest('[data-a]'); if (!t) return;
  const id = t.dataset.id, v = t.dataset.v;
  try {
    switch (t.dataset.a){
      case 'menu': S.menu = !S.menu; render(); break;
      case 'logout':
        if (!S.confirmOut){ S.confirmOut = true; render(); setTimeout(() => { if (S.confirmOut){ S.confirmOut = false; render(); } }, 5000); break; }
        S.confirmOut = false; await sb.auth.signOut(); break;
      case 'refresh': t.disabled = true; await load(); render(); toast(Object.keys(S.errors).length ? 'Einiges konnte nicht geladen werden' : 'Aktualisiert'); break;
      case 'target': S.push.target = v; S.confirm = false; if (v === 'test') S.push.later = false; render(); break;
      case 'later': S.push.later = t.checked; S.confirm = false; render(); break;
      case 'push-fam': S.push.target = 'family'; S.push.fam = id; S.page = 'push'; render(); window.scrollTo(0,0); break;
      case 'push-user': S.push.target = 'user'; S.push.user = id; S.page = 'push'; render(); window.scrollTo(0,0); break;
      case 'tpl': { const all = [...S.templates, ...BUILTIN], tp = all[+t.dataset.i]; if (!tp) break;
        S.push.title = tp.title; S.push.body = tp.body; S.push.url = (tp.url || 'home').replace('./?tab=',''); if (!LINKS.some(([k]) => k === S.push.url)) S.push.url = 'home'; S.confirm = false; render(); break; }
      case 'tpl-save': {
        if (!S.push.title.trim() || !S.push.body.trim()){ toast('Bitte erst Titel und Text ausfüllen'); break; }
        const { error } = await sb.from('push_templates').insert({ title:S.push.title.trim(), body:S.push.body.trim(), url:S.push.url });
        if (error) throw error; await load(['templates']); render(); toast('Als Vorlage gespeichert'); break; }
      case 'tpl-del': { if (!confirmTwice(t, '✕?')) break; const { error } = await sb.from('push_templates').delete().eq('id', id); if (error) throw error; await load(['templates']); render(); break; }
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
      case 'log-filter': S.logFilter = v; render(); break;
      case 'auto': {
        const next = { ...(S.auto || {}) }; next[v] = !(next[v] !== false); S.auto = next;
        t.setAttribute('aria-checked', next[v]);
        const { error } = await sb.from('app_settings').upsert({ key:'auto_push', value:next }, { onConflict:'key' });
        if (error){ next[v] = !next[v]; t.setAttribute('aria-checked', next[v]); throw error; }
        toast(next[v] ? 'Eingeschaltet' : 'Ausgeschaltet'); break; }
      case 'ann-save': {
        const text = $('#at').value.trim(), emoji = $('#ae').value.trim() || '📣';
        if (!text){ toast('Bitte einen Text eingeben'); $('#at').focus(); break; }
        t.disabled = true;
        const off = await sb.from('announcements').update({ active:false }).eq('active', true); if (off.error) throw off.error;
        const { error } = await sb.from('announcements').insert({ text, emoji, active:true }); if (error) throw error;
        await load(['anns']); render(); toast('Ankündigung ist jetzt in der App sichtbar'); break; }
      case 'ann-off': { const { error } = await sb.from('announcements').update({ active:false }).eq('id', id); if (error) throw error; await load(['anns']); render(); toast('Ausgeblendet'); break; }
      case 'ann-on': { await sb.from('announcements').update({ active:false }).eq('active', true); const { error } = await sb.from('announcements').update({ active:true }).eq('id', id); if (error) throw error; await load(['anns']); render(); toast('Wieder sichtbar'); break; }
      case 'ann-del': { if (!confirmTwice(t)) break; const { error } = await sb.from('announcements').delete().eq('id', id); if (error) throw error; await load(['anns']); render(); break; }
      case 'fb-filter': S.fbFilter = v; render(); break;
      case 'fb-done': { const x = S.feedback.find(f => f.id === id), on = v === 'true'; if (x) x.done = on; render();
        const { error } = await sb.from('feedback').update({ done:on }).eq('id', id); if (error){ if (x) x.done = !on; render(); throw error; } load(['stats']); break; }
      case 'fb-del': { if (!confirmTwice(t)) break; const keep = S.feedback; S.feedback = S.feedback.filter(f => f.id !== id); render();
        const { error } = await sb.from('feedback').delete().eq('id', id); if (error){ S.feedback = keep; render(); throw error; } break; }
      case 'ban': {
        const u = S.users.find(x => x.id === id), on = v === 'true';
        if (on && !confirmTwice(t, 'Wirklich sperren?')) break;
        const { error } = await sb.rpc('admin_set_banned', { uid:id, val:on }); if (error) throw error;
        await load(['users','stats']); render(); toast(on ? `${u?.name || 'Nutzer'} ist gesperrt` : `${u?.name || 'Nutzer'} ist entsperrt`); break; }
    }
  } catch(err){
    t.disabled = false;
    toast('Hat nicht geklappt: ' + (err && (err.message || err.error_description) || err));
  }
});
/* Zerstörende Knöpfe: erst beim zweiten Klick ausführen */
function confirmTwice(btn, label='Sicher?'){
  if (btn.dataset.sure) return true;
  btn.dataset.sure = '1'; const old = btn.innerHTML; btn.innerHTML = label; btn.classList.add('btn-tomato');
  setTimeout(() => { if (btn.isConnected){ delete btn.dataset.sure; btn.innerHTML = old; btn.classList.remove('btn-tomato'); } }, 3000);
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
    toast(data.sent ? `Angekommen auf ${data.sent} ${data.sent === 1 ? 'Gerät' : 'Geräten'}${data.failed ? ` · ${data.failed} Fehler` : ''}` : P.target === 'test' ? 'Auf deinen Geräten sind keine Benachrichtigungen an – schalte sie in der App unter „Mehr" ein' : 'Keine Geräte mit Benachrichtigungen gefunden');
    if (P.target !== 'test' && data.sent){ P.title = ''; P.body = ''; }
  }
  await load(['log','stats','counts','scheduled']); render();
}

/* ---------- Start ---------- */
let current;   // undefined = noch nichts gezeichnet
async function onSession(session){
  const uid = session ? session.user.id : null;
  if (uid && uid === current) return;   // nur Token aufgefrischt – nichts neu laden
  current = uid;
  S.user = session ? session.user : null; S.admin = false;
  if (S.user){
    $('#app').innerHTML = '<div class="boot"><span class="spin"></span></div>';
    const { data, error } = await sb.rpc('is_app_admin');
    if (error){ S.err = 'Konnte Zugriff nicht prüfen: ' + error.message; }
    S.admin = data === true;
    if (S.admin) await load();
  }
  render();
}
sb.auth.getSession().then(({ data }) => onSession(data.session));
sb.auth.onAuthStateChange((ev, session) => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') onSession(session); });
