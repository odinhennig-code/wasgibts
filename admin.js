/* =========================================================================
   WAS GIBT'S? – Admin-Panel
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
function toast(m){ const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2800); }

const S = { user:null, admin:false, page:'home', stats:null, users:[], families:[], feedback:[], log:[], anns:[],
            q:'', fbFilter:'open', push:{ title:'', body:'', target:'all', fam:'' }, confirm:false, busy:false, err:'', menu:false };
try { S.page = sessionStorage.getItem('adm.page') || 'home'; } catch(e){}

const PAGES = [
  ['home','📊','Übersicht'], ['push','🔔','Push senden'], ['ann','📣','Ankündigung'],
  ['feedback','💬','Feedback'], ['users','👤','Nutzer'], ['families','👨‍👩‍👧','Familien'],
];

/* ---------- Daten ---------- */
async function load(what){
  const jobs = {
    stats:    async () => { const { data, error } = await sb.rpc('admin_stats'); if (error) throw error; S.stats = data; },
    users:    async () => { const { data, error } = await sb.rpc('admin_users'); if (error) throw error; S.users = data || []; },
    families: async () => { const { data, error } = await sb.rpc('admin_families'); if (error) throw error; S.families = data || []; },
    feedback: async () => { const { data, error } = await sb.rpc('admin_feedback'); if (error) throw error; S.feedback = data || []; },
    log:      async () => { const { data } = await sb.from('push_log').select('*').order('created_at', { ascending:false }).limit(30); S.log = data || []; },
    anns:     async () => { const { data } = await sb.from('announcements').select('*').order('created_at', { ascending:false }).limit(20); S.anns = data || []; },
  };
  await Promise.all((what || Object.keys(jobs)).map(k => jobs[k]().catch(e => { console.warn(k, e); })));
}

/* ---------- Ansichten ---------- */
function viewLogin(){
  return `<div class="login"><form id="loginForm">
    <div class="logo">🍳</div><h1>Admin-Bereich</h1><p>Was gibt's? · nur für Betreiber</p>
    <div class="field"><label for="m">E-Mail</label><input id="m" type="email" autocomplete="username" required></div>
    <div class="field"><label for="p">Passwort</label><input id="p" type="password" autocomplete="current-password" required></div>
    ${S.err ? `<div class="chip c-tomato" style="padding:8px 12px;border-radius:10px">${esc(S.err)}</div>` : ''}
    <button class="btn btn-herb" ${S.busy?'disabled':''}>${S.busy?'<span class="spin" style="width:16px;height:16px;border-width:2px"></span>':'Anmelden'}</button>
    <a href="./" class="muted" style="font-size:13px;text-align:center">← Zur App</a>
  </form></div>`;
}
function viewDenied(){
  return `<div class="login"><div class="card" style="max-width:380px;text-align:center;display:grid;gap:10px">
    <div style="font-size:44px">🔒</div><h1 style="font-size:24px">Kein Zugriff</h1>
    <p class="muted" style="margin:0">Dieser Account (${esc(S.user.email)}) ist kein App-Admin.</p>
    <button class="btn" data-a="logout">Abmelden</button><a href="./" class="muted" style="font-size:13px">← Zur App</a></div></div>`;
}

function kpi(l, v, s){ return `<div class="card kpi"><div class="l">${l}</div><div class="v">${v ?? '–'}</div>${s?`<div class="s">${s}</div>`:''}</div>`; }
function viewHome(){
  const st = S.stats || {};
  const days = []; for (let i = 13; i >= 0; i--){ const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i); days.push(d); }
  const map = {}; (st.signups || []).forEach(x => map[x.day] = x.n);
  const vals = days.map(d => { const k = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); return { d, n: map[k] || 0 }; });
  const max = Math.max(1, ...vals.map(v => v.n));
  const open = S.feedback.filter(f => !f.done).slice(0, 4);
  return head('Übersicht', 'So läuft „Was gibt\'s?" gerade', `<button class="btn btn-sm" data-a="refresh">↻ Aktualisieren</button>`) + `
    <div class="grid kpis">
      ${kpi('Nutzer', st.users, `+${st.users_7d ?? 0} in 7 Tagen`)}
      ${kpi('Heute aktiv', st.active_today, `${st.active_7d ?? 0} in 7 Tagen`)}
      ${kpi('Familien', st.families, `${st.members ?? 0} Mitglieder · ${st.pending ?? 0} Anfragen`)}
      ${kpi('Push-Geräte', st.push_devices, 'Benachrichtigungen an')}
      ${kpi('Eigene Rezepte', st.recipes, `${st.wishes ?? 0} Wünsche · ${st.polls ?? 0} Abstimmungen`)}
      ${kpi('Offenes Feedback', st.feedback_open, `${st.plus ?? 0} Plus-Interessenten`)}
    </div>
    <div class="grid two" style="margin-top:14px">
      <div class="card"><h2>Neue Nutzer · 14 Tage</h2>
        <div class="bars" role="img" aria-label="Neue Nutzer pro Tag">${vals.map(v => `<div title="${v.d.toLocaleDateString('de-DE')}: ${v.n}">${v.n?`<em>${v.n}</em>`:''}<i style="height:${Math.round(v.n/max*100)}%"></i><span>${v.d.getDate()}.</span></div>`).join('')}</div></div>
      <div class="card"><h2>Neuestes Feedback</h2>
        ${open.length ? `<div class="fb">${open.map(f => `<div><div class="meta">${kindChip(f.kind)} ${esc(f.name || 'Unbekannt')} · ${ago(f.created_at)}</div><div class="msg" style="margin-top:3px">${esc(f.message.length > 140 ? f.message.slice(0,140) + '…' : f.message)}</div></div>`).join('')}</div>
          <button class="btn btn-sm" style="margin-top:12px" data-page="feedback">Alle ansehen</button>`
        : `<div class="empty"><div class="g">📭</div>Kein offenes Feedback</div>`}</div>
    </div>`;
}

function viewPush(){
  const P = S.push, devices = S.stats?.push_devices ?? 0;
  const famOpts = S.families.map(f => `<option value="${f.id}" ${P.fam===f.id?'selected':''}>${esc(f.name)} (${f.members})</option>`).join('');
  const targetLabel = P.target === 'test' ? 'nur an deine eigenen Geräte' : P.target === 'family' ? 'an die ausgewählte Familie' : `an alle ${devices} Geräte`;
  return head('Push senden', 'Nachricht auf die Handys aller angemeldeten Nutzer mit eingeschalteten Benachrichtigungen') + `
    <div class="grid two">
      <div class="card" style="display:grid;gap:14px">
        <div class="field"><label>An wen?</label>
          <div class="seg" role="group">${[['all','Alle'],['family','Eine Familie'],['test','Test an mich']].map(([k,l]) => `<button data-a="target" data-v="${k}" aria-pressed="${P.target===k}">${l}</button>`).join('')}</div></div>
        ${P.target === 'family' ? `<div class="field"><label for="pf">Familie</label><select id="pf" data-in="fam"><option value="">Bitte wählen …</option>${famOpts}</select></div>` : ''}
        <div class="field"><label for="pt">Titel</label><input id="pt" maxlength="80" data-in="title" value="${esc(P.title)}" placeholder="z. B. Neue Rezepte sind da 🍝"><div class="hint">${P.title.length}/80</div></div>
        <div class="field"><label for="pb">Text</label><textarea id="pb" maxlength="240" data-in="body" placeholder="Was möchtest du sagen?">${esc(P.body)}</textarea><div class="hint">${P.body.length}/240</div></div>
        <div class="row">
          ${S.confirm
            ? `<button class="btn btn-tomato" data-a="send" ${S.busy?'disabled':''}>${S.busy?'Sende …':'Ja, jetzt senden'}</button><button class="btn" data-a="cancel">Abbrechen</button>`
            : `<button class="btn btn-herb" data-a="ask-send">Senden …</button>`}
          <span class="muted" style="font-size:13px">Geht ${targetLabel}</span>
        </div>
        ${S.confirm ? `<div class="chip c-yolk" style="padding:8px 12px;border-radius:10px;white-space:normal">Wirklich senden? Die Nachricht lässt sich danach nicht zurückholen.</div>` : ''}
      </div>
      <div class="card"><h2>Vorschau</h2>
        <div class="preview"><div class="notif"><div class="ic">🍳</div><div><b>${esc(P.title || 'Titel der Nachricht')}<span>jetzt</span></b><p>${esc(P.body || 'Hier steht dein Text.')}</p></div></div></div>
        <p class="muted" style="font-size:13px;margin:12px 0 0">Am iPhone kommt die Nachricht nur an, wenn „Was gibt's?" auf dem Home-Bildschirm installiert ist und Benachrichtigungen unter „Mehr" eingeschaltet sind.</p>
      </div>
    </div>
    <div class="card" style="margin-top:14px"><h2>Gesendet</h2>
      ${S.log.length ? `<div class="table-wrap"><table><thead><tr><th>Wann</th><th>Nachricht</th><th>An</th><th>Angekommen</th><th>Fehler</th></tr></thead><tbody>
        ${S.log.map(l => `<tr><td>${fmtTime(l.created_at)}</td><td><b>${esc(l.title)}</b><div class="muted" style="font-size:13px">${esc(l.body)}</div></td><td>${esc(l.target)}</td><td class="num">${l.sent}</td><td class="num">${l.failed}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty"><div class="g">🔕</div>Noch nichts gesendet</div>`}
    </div>`;
}

function viewAnn(){
  const cur = S.anns.find(a => a.active);
  return head('Ankündigung', 'Ein Banner oben auf „Heute" in der App, für alle Nutzer') + `
    <div class="grid two">
      <div class="card" style="display:grid;gap:14px">
        <h2 style="margin:0">Neue Ankündigung</h2>
        <div class="row" style="flex-wrap:nowrap">
          <div class="field" style="width:80px"><label for="ae">Emoji</label><input id="ae" maxlength="4" value="📣" style="text-align:center;font-size:20px"></div>
          <div class="field" style="flex:1"><label for="at">Text</label><input id="at" maxlength="200" placeholder="z. B. Neu: über 580 Rezepte!"></div>
        </div>
        <div class="row"><button class="btn btn-herb" data-a="ann-save" ${S.busy?'disabled':''}>Veröffentlichen</button><span class="muted" style="font-size:13px">Ersetzt die aktuelle Ankündigung</span></div>
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
  return head('Feedback', 'Alles, was über „Mehr → Feedback senden" und „Plus" reinkommt') + `
    <div class="seg" role="group" style="margin-bottom:14px;flex-wrap:wrap">${[['open','Offen'],['all','Alle'],['fehler','Fehler'],['idee','Ideen'],['lob','Lob'],['plus','Plus']].map(([k,l]) => `<button data-a="fb-filter" data-v="${k}" aria-pressed="${f===k}">${l} · ${n(k)}</button>`).join('')}</div>
    <div class="card">${list.length ? `<div class="fb">${list.map(x => `<div class="item ${x.done?'done':''}">
        <div><div class="meta">${kindChip(x.kind)} <b>${esc(x.name || 'Unbekannt')}</b> ${x.email?`<a href="mailto:${esc(x.email)}" class="muted">${esc(x.email)}</a>`:''} · ${fmtTime(x.created_at)} ${x.app_version?`· v${esc(x.app_version)}`:''}</div>
          <div class="msg" style="margin-top:4px">${esc(x.message)}</div></div>
        <div class="row" style="align-items:flex-start"><button class="btn btn-sm" data-a="fb-done" data-id="${x.id}" data-v="${!x.done}">${x.done?'↺ Wieder öffnen':'✓ Erledigt'}</button><button class="btn btn-sm" data-a="fb-del" data-id="${x.id}" aria-label="Löschen">🗑</button></div>
      </div>`).join('')}</div>` : `<div class="empty"><div class="g">📭</div>Nichts in dieser Ansicht</div>`}</div>`;
}

function viewUsers(){
  const q = S.q.toLowerCase();
  const list = S.users.filter(u => !q || [u.name, u.email, u.family].some(v => (v || '').toLowerCase().includes(q)));
  return head('Nutzer', `${S.users.length} Accounts`, `<input class="search" id="q" placeholder="Suchen: Name, E-Mail, Familie" value="${esc(S.q)}">`) + `
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Nutzer</th><th>Familie</th><th>Registriert</th><th>Zuletzt aktiv</th><th>🔔</th><th></th></tr></thead><tbody>
    ${list.map(u => `<tr>
      <td><div class="who"><span class="av">${esc(u.avatar || '🙂')}</span><span><b>${esc(u.name || '(ohne Profil)')}</b> ${u.banned?'<span class="chip c-tomato">gesperrt</span>':''}<small>${esc(u.email)}</small></span></div></td>
      <td>${u.family ? `${esc(u.family)} ${u.role==='admin'?'<span class="chip">Admin</span>':''}` : '<span class="muted">–</span>'}</td>
      <td>${fmtDate(u.created_at)}</td><td>${ago(u.last_seen)}</td><td class="num">${u.devices || ''}</td>
      <td style="text-align:right">${u.id === S.user.id ? '<span class="muted" style="font-size:13px">Du</span>' : `<button class="btn btn-sm ${u.banned?'':'btn-tomato'}" data-a="ban" data-id="${u.id}" data-v="${!u.banned}">${u.banned?'Entsperren':'Sperren'}</button>`}</td>
    </tr>`).join('') || `<tr><td colspan="6"><div class="empty">Niemand gefunden</div></td></tr>`}
    </tbody></table></div></div>`;
}

function viewFamilies(){
  return head('Familien', `${S.families.length} Familien`) + `
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
  if (!S.user){ app.innerHTML = viewLogin(); $('#loginForm').addEventListener('submit', onLogin); return; }
  if (!S.admin){ app.innerHTML = viewDenied(); return; }
  const open = S.feedback.filter(f => !f.done).length;
  const v = { home:viewHome, push:viewPush, ann:viewAnn, feedback:viewFeedback, users:viewUsers, families:viewFamilies }[S.page] || viewHome;
  const focus = document.activeElement && document.activeElement.id, pos = focus && document.activeElement.selectionStart;
  app.innerHTML = `<div class="shell ${S.menu?'open':''}">
    <nav class="side" aria-label="Bereiche">
      <div class="brand"><span style="font-size:26px">🍳</span><span>Was gibt's?<small>Admin-Panel</small></span></div>
      ${PAGES.map(([k,i,l]) => `<button class="nav" data-page="${k}" ${S.page===k?'aria-current="page"':''}><span class="ico">${i}</span>${l}${k==='feedback'&&open?`<span class="count">${open}</span>`:''}</button>`).join('')}
      <div class="foot"><span>${esc(S.user.email)}</span><a href="./">← Zur App</a><button data-a="logout">Abmelden</button></div>
    </nav>
    <main>${v()}</main></div>`;
  if (focus){ const el = document.getElementById(focus); if (el){ el.focus(); try { el.setSelectionRange(pos, pos); } catch(e){} } }
}

/* ---------- Ereignisse ---------- */
async function onLogin(e){
  e.preventDefault(); S.err=''; S.busy=true; render();
  const { error } = await sb.auth.signInWithPassword({ email:$('#m').value.trim(), password:$('#p').value });
  S.busy=false;
  if (error){ S.err = /Invalid login/i.test(error.message) ? 'E-Mail oder Passwort stimmt nicht.' : error.message; render(); }
}

document.addEventListener('input', e => {
  const k = e.target.dataset.in;
  if (k){ S.push[k] = e.target.value; S.confirm = false;
    if (k !== 'fam'){ // nur Vorschau und Zähler neu zeichnen, ohne den Fokus zu verlieren
      const prev = $('.notif'); if (prev){ prev.querySelector('b').firstChild.textContent = S.push.title || 'Titel der Nachricht'; prev.querySelector('p').textContent = S.push.body || 'Hier steht dein Text.'; }
      const h = e.target.parentElement.querySelector('.hint'); if (h) h.textContent = `${e.target.value.length}/${e.target.maxLength}`;
      return;
    }
    render(); return; }
  if (e.target.id === 'q'){ S.q = e.target.value; render(); }
});
document.addEventListener('change', e => { if (e.target.dataset.in === 'fam'){ S.push.fam = e.target.value; render(); } });

document.addEventListener('click', async e => {
  const nav = e.target.closest('[data-page]');
  if (nav){ S.page = nav.dataset.page; S.menu = false; S.confirm = false; try { sessionStorage.setItem('adm.page', S.page); } catch(err){} render(); window.scrollTo(0,0); return; }
  if (S.menu && e.target.closest('main')){ S.menu = false; render(); return; }
  const t = e.target.closest('[data-a]'); if (!t) return;
  const id = t.dataset.id, v = t.dataset.v;
  switch (t.dataset.a){
    case 'menu': S.menu = !S.menu; render(); break;
    case 'logout': await sb.auth.signOut(); break;
    case 'refresh': t.disabled = true; await load(); render(); toast('Aktualisiert'); break;
    case 'target': S.push.target = v; S.confirm = false; render(); break;
    case 'push-fam': S.push.target = 'family'; S.push.fam = id; S.page = 'push'; render(); break;
    case 'ask-send': {
      if (!S.push.title.trim() || !S.push.body.trim()){ toast('Bitte Titel und Text ausfüllen'); break; }
      if (S.push.target === 'family' && !S.push.fam){ toast('Bitte eine Familie wählen'); break; }
      if (S.push.target === 'test'){ await sendPush(); break; }
      S.confirm = true; render(); break; }
    case 'cancel': S.confirm = false; render(); break;
    case 'send': await sendPush(); break;
    case 'ann-save': {
      const text = $('#at').value.trim(), emoji = $('#ae').value.trim() || '📣';
      if (!text){ toast('Bitte einen Text eingeben'); $('#at').focus(); break; }
      S.busy = true; render();
      await sb.from('announcements').update({ active:false }).eq('active', true);
      const { error } = await sb.from('announcements').insert({ text, emoji, active:true });
      S.busy = false; await load(['anns']); render(); toast(error ? 'Hat nicht geklappt: ' + error.message : 'Ankündigung ist jetzt in der App sichtbar'); break; }
    case 'ann-off': await sb.from('announcements').update({ active:false }).eq('id', id); await load(['anns']); render(); toast('Ausgeblendet'); break;
    case 'ann-on': await sb.from('announcements').update({ active:false }).eq('active', true); await sb.from('announcements').update({ active:true }).eq('id', id); await load(['anns']); render(); toast('Wieder sichtbar'); break;
    case 'ann-del': if (!confirmTwice(t)) break; await sb.from('announcements').delete().eq('id', id); await load(['anns']); render(); break;
    case 'fb-filter': S.fbFilter = v; render(); break;
    case 'fb-done': { const x = S.feedback.find(f => f.id === id); if (x) x.done = v === 'true'; render(); await sb.from('feedback').update({ done: v === 'true' }).eq('id', id); load(['stats']); break; }
    case 'fb-del': if (!confirmTwice(t)) break; S.feedback = S.feedback.filter(f => f.id !== id); render(); await sb.from('feedback').delete().eq('id', id); break;
    case 'ban': {
      const u = S.users.find(x => x.id === id), on = v === 'true';
      if (on && !confirmTwice(t, 'Wirklich sperren?')) break;
      const { error } = await sb.rpc('admin_set_banned', { uid:id, val:on });
      if (error){ toast(error.message); break; }
      await load(['users','stats']); render(); toast(on ? `${u?.name || 'Nutzer'} ist gesperrt` : `${u?.name || 'Nutzer'} ist entsperrt`); break; }
  }
});
/* Zerstörende Knöpfe: erst beim zweiten Klick ausführen */
function confirmTwice(btn, label='Sicher?'){
  if (btn.dataset.sure){ return true; }
  btn.dataset.sure = '1'; const old = btn.innerHTML; btn.innerHTML = label; btn.classList.add('btn-tomato');
  setTimeout(() => { if (btn.isConnected){ delete btn.dataset.sure; btn.innerHTML = old; btn.classList.remove('btn-tomato'); } }, 3000);
  return false;
}

async function sendPush(){
  const P = S.push; S.busy = true; render();
  const body = { action: P.target === 'test' ? 'test' : 'send', title:P.title, body:P.body };
  if (P.target === 'family') body.familyId = P.fam;
  const { data, error } = await sb.functions.invoke('send-push', { body });
  S.busy = false; S.confirm = false;
  if (error || !data || data.error){
    const c = data && data.error;
    toast(c === 'forbidden' ? 'Kein Zugriff' : c === 'empty' ? 'Titel und Text fehlen' : 'Senden fehlgeschlagen' + (data && data.detail ? ': ' + data.detail : ''));
  } else {
    toast(data.sent ? `Angekommen auf ${data.sent} ${data.sent === 1 ? 'Gerät' : 'Geräten'}${data.failed ? ` · ${data.failed} Fehler` : ''}` : P.target === 'test' ? 'Auf deinen Geräten sind keine Benachrichtigungen an' : 'Keine Geräte mit Benachrichtigungen gefunden');
    if (P.target !== 'test' && data.sent){ P.title = ''; P.body = ''; }
  }
  await load(['log','stats']); render();
}

/* ---------- Start ---------- */
async function onSession(session){
  S.user = session ? session.user : null; S.admin = false;
  if (S.user){
    const { data } = await sb.rpc('is_app_admin');
    S.admin = data === true;
    if (S.admin) await load();
  }
  render();
}
sb.auth.getSession().then(({ data }) => onSession(data.session));
sb.auth.onAuthStateChange((ev, session) => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') onSession(session); });
