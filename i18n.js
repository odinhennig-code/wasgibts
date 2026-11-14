/* Was gibt's? – Sprachen (Deutsch, Englisch, Russisch)
   Deutsch ist die Grundsprache im Code. Für Englisch und Russisch werden beim Start
   die Übersetzungen geladen: Rezepte und Zutaten direkt in die Daten, die Bedienung
   über einen Übersetzer, der jeden angezeigten Text austauscht. */
import { R, ING, CATS, ALLERGENS, TRAITS } from './data.js';

export const LANGS = [['de', 'DE', 'Deutsch'], ['en', 'EN', 'English'], ['ru', 'RU', 'Русский']];
const pick = () => { try { const l = localStorage.getItem('wg.lang'); if (LANGS.some(x => x[0] === l)) return l; } catch(e){} return 'de'; };
export const LANG = pick();
export const LOCALE = { de:'de-DE', en:'en-GB', ru:'ru-RU' }[LANG];
document.documentElement.lang = LANG;

export function setLang(l){
  if (l === LANG) return;
  try { localStorage.setItem('wg.lang', l); } catch(e){}
  const i = LANGS.findIndex(x => x[0] === l);
  document.querySelectorAll('.lang-sw').forEach(s => { s.style.setProperty('--i', i); s.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', b.dataset.v === l)); });
  setTimeout(() => document.documentElement.classList.add('lang-switch'), 180);
  setTimeout(() => location.reload(), 420);
}

let UI_MAP = null, PATTERNS = [];
const LEAD = /^[\s⁠️‍\p{Extended_Pictographic}←-⇿⌀-⏿☀-➿·•›‹✓✕×+＋\-–—…:]+/u;
const TRAIL = /[\s⁠️\p{Extended_Pictographic}›✓]+$/u;
function norm(x){ x = String(x).replace(/\u2060/g, ''); const l = (x.match(LEAD) || [''])[0]; x = x.slice(l.length); const t = (x.match(TRAIL) || [''])[0]; return x.slice(0, x.length - t.length).replace(/\s+/g, ' '); }
const SMALL = {
  en: { cats:{ gemuese:'Vegetables', obst:'Fruit', fleisch:'Meat & fish', milch:'Milk, cheese & eggs', kuehl:'Chilled', getreide:'Pasta, rice & bread', dose:'Cans & jars', backen:'Baking & sweets', wuerz:'Sauces & seasoning' },
        all:{ laktose:'Lactose', gluten:'Gluten', nuesse:'Nuts' }, tr:{ scharf:'Spicy food', fisch:'Fish', fleisch:'Meat' } },
  ru: { cats:{ gemuese:'Овощи', obst:'Фрукты', fleisch:'Мясо и рыба', milch:'Молоко, сыр и яйца', kuehl:'Охлаждённое', getreide:'Макароны, рис и хлеб', dose:'Консервы и банки', backen:'Выпечка и сладкое', wuerz:'Соусы и приправы' },
        all:{ laktose:'Лактоза', gluten:'Глютен', nuesse:'Орехи' }, tr:{ scharf:'Острое', fisch:'Рыба', fleisch:'Мясо' } },
};

if (LANG !== 'de'){
  try {
    const [ui, rec] = await Promise.all([
      fetch(`i18n/ui.${LANG}.json`).then(r => r.json()),
      fetch(`i18n/rec.${LANG}.json`).then(r => r.json()),
    ]);
    // Rezepte, Zutaten, Kategorien direkt übersetzen – dann stimmt es überall, auch in Suche und Teilen
    for (const k in rec.i) if (ING[k]) ING[k][0] = rec.i[k];
    R.forEach(r => { if (rec.n[r.id]) r.n = rec.n[r.id]; if (r.s) r.s = r.s.map(s => rec.s[s] || s); });
    const sm = SMALL[LANG];
    CATS.forEach(c => { if (sm.cats[c[0]]) c[2] = sm.cats[c[0]]; });
    for (const k in sm.all) ALLERGENS[k] = sm.all[k];
    for (const k in sm.tr) TRAITS[k] = sm.tr[k];
    // Bedienung
    UI_MAP = new Map();
    for (const [k, v] of Object.entries(ui)){ const nk = norm(k); if (nk && !UI_MAP.has(nk)) UI_MAP.set(nk, norm(v)); }
    for (const [de, tr] of UI_MAP){
      if (!/\{\d+\}/.test(de)) continue;
      const lit = de.replace(/\{\d+\}/g, '').trim(); if (lit.length < 2) continue;   // nur Platzhalter – zu unsicher
      const order = [...de.matchAll(/\{(\d+)\}/g)].map(m => m[1]);
      const src = '^\\s*' + de.split(/\{\d+\}/).map(p => p.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*(.*?)\\s*') + '\\s*$';
      try { PATTERNS.push({ re: new RegExp(src, 's'), order, tr, lit: lit.split(/\s+/).sort((a, b) => b.length - a.length)[0], len: lit.length }); } catch(e){}
    }
    PATTERNS.sort((a, b) => b.len - a.len);
  } catch(e){ console.warn('Übersetzung konnte nicht geladen werden', e); }
}

/* ---------- Text austauschen ---------- */
export function tr(text){
  if (!UI_MAP || !text) return text;
  const t = text.replace(/⁠/g, '');
  const lead = (t.match(LEAD) || [''])[0], rest = t.slice(lead.length);
  const trail = (rest.match(TRAIL) || [''])[0], core0 = rest.slice(0, rest.length - trail.length);
  const core = core0.replace(/\s+/g, ' ');
  if (!core || !/[A-Za-zÄÖÜäöüß]/.test(core)) return text;
  const out = translateCore(core);
  return out == null ? text : lead + out + trail;
}
function translateCore(core){
  const hit = UI_MAP.get(core);
  if (hit != null) return hit;
  for (const p of PATTERNS){
    if (!core.includes(p.lit)) continue;
    const m = core.match(p.re); if (!m) continue;
    const vals = {}; p.order.forEach((n, i) => { const v = m[i + 1], vt = v.trim(); const t2 = vt && vt !== core ? (UI_MAP.get(vt) ?? translateCore(vt)) : null; vals[n] = t2 != null ? v.replace(vt, t2) : v; });
    return p.tr.replace(/\{(\d+)\}/g, (_, n) => vals[n] ?? '').replace(/\s{2,}/g, ' ').trim();
  }
  if (core.includes(' · ')){ const parts = core.split(' · '); const outp = parts.map(x => UI_MAP.get(x) ?? (x === core ? null : translateCore(x)) ?? x); if (outp.some((x, i) => x !== parts[i])) return outp.join(' · '); }
  const num = core.match(/^(\d+(?:[.,]\d+)?)\s+(\S.*)$/);
  if (num){ const w = UI_MAP.get(num[2]); if (w != null) return num[1] + ' ' + w; }
  if (MISS) MISS.add(core);
  return null;
}
const MISS = (() => { try { return localStorage.getItem('wg.i18ndebug') ? (window.__i18nMiss = new Set()) : null; } catch(e){ return null; } })();
const SKIP = 'script,style,textarea,input,svg,canvas,[data-noi18n],.sup-chat,.pin-msg,.note-body';
function doText(node){
  const p = node.parentElement; if (!p || p.closest(SKIP)) return;
  const v = node.nodeValue; if (!v || !v.trim()) return;
  const n = tr(v); if (n !== v) node.nodeValue = n;
}
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
function doAttrs(el){
  if (!el.parentElement || el.parentElement.closest(SKIP) || el.closest('[data-noi18n]')) return;
  for (const a of ATTRS){ const v = el.getAttribute && el.getAttribute(a); if (v){ const n = tr(v); if (n !== v) el.setAttribute(a, n); } }
}
function walk(root){
  if (root.nodeType === 3) return doText(root);
  if (root.nodeType !== 1 || root.closest?.(SKIP)) return;
  doAttrs(root);
  root.querySelectorAll?.('[placeholder],[aria-label],[title],[alt]').forEach(doAttrs);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = []; let n; while ((n = w.nextNode())) list.push(n); list.forEach(doText);
}
if (UI_MAP){
  new MutationObserver(ms => ms.forEach(m => {
    if (m.type === 'characterData') doText(m.target);
    else if (m.type === 'attributes') doAttrs(m.target);
    else m.addedNodes.forEach(walk);
  })).observe(document.body, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:ATTRS });
  walk(document.body);
  const ot = document.title; document.title = tr(ot);
}

/* ---------- Schieberegler DE · EN · RU ---------- */
export function langSwitch(){
  const i = LANGS.findIndex(x => x[0] === LANG);
  return `<div class="lang-sw" role="radiogroup" aria-label="Sprache · Language · Язык" data-noi18n style="--i:${i}"><span class="lang-pill" aria-hidden="true"></span>${LANGS.map(([k, s, full]) => `<button role="radio" aria-checked="${k === LANG}" aria-label="${full}" data-action="lang" data-v="${k}">${s}</button>`).join('')}</div>`;
}
