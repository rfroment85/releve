// Relève — volet latéral : un bouton, l'avancement, le résultat.
'use strict';
const HOST = 'https://cfspro.impots.gouv.fr/';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const V = { tab: null, page: null, total: 0, run: null, data: null, settings: null, error: '', checking: false };
const appUrl = (h = '') => chrome.runtime.getURL('app.html') + (h ? '#' + h : '');
const openApp = async (h) => {
  const url = appUrl(h);
  let ctx = [];
  try { ctx = await chrome.runtime.getContexts({ contextTypes: ['TAB'] }); } catch {}
  const c = ctx.find((x) => x.documentUrl && x.documentUrl.startsWith(chrome.runtime.getURL('app.html')));
  if (c) { await chrome.tabs.update(c.tabId, { active: true, url }); chrome.windows.update(c.windowId, { focused: true }).catch(() => {}); } else chrome.tabs.create({ url });
};
const toast = (t) => { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), 2600); };
const dur = (s) => { s = Math.max(30, Math.round(s)); if (s < 90) return 'environ 1 minute'; const m = Math.round(s / 60); if (m < 60) return `environ ${m} minutes`; const h = Math.floor(m / 60), r = Math.round((m % 60) / 5) * 5; return `environ ${h} h${r ? ' ' + String(r).padStart(2, '0') : ''}`; };
const ago = (t) => { const s = (Date.now() - t) / 1000; if (s < 90) return 'à l’instant'; if (s < 3600) return `il y a ${Math.round(s / 60)} min`; if (s < 86400) return `il y a ${Math.round(s / 3600)} h`; const d = Math.round(s / 86400); return d === 1 ? 'hier' : `il y a ${d} jours`; };
const plural = (n, a, b) => `${n.toLocaleString('fr-FR')} ${n > 1 ? (b || a + 's') : a}`;

$('#logo').innerHTML = IC.logo;
$('#lockIco').innerHTML = IC.lock;
$('#openApp').onclick = () => openApp();
$('#brand').onclick = () => openApp();
$('#expIco').innerHTML = IC.expand;

// ---- Onglet impots.gouv ----
async function findTab() {
  const tabs = await chrome.tabs.query({ url: HOST + '*' });
  if (!tabs.length) return null;
  const [act] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs.find((t) => act && t.id === act.id) || tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
}
const toTab = (msg) => chrome.tabs.sendMessage(V.tab.id, msg);
async function ping() {
  try { return await toTab({ type: 'ac:ping' }); } catch {}
  try { await chrome.scripting.executeScript({ target: { tabId: V.tab.id }, files: ['content.bundle.js'] }); return await toTab({ type: 'ac:ping' }); } catch { return null; }
}

async function loadData() {
  V.data = await ACDB.loadAll();
  V.settings = V.data.settings;
  V.list = await ACDB.get('meta', 'dossierList');
}
function scopeSirens() {
  const S = V.settings, c = S.correspondance || {};
  const mine = Object.entries(c).filter(([, v]) => S.moi && v.collaborateur === S.moi).map(([k]) => k);
  return [...new Set([...mine, ...(S.portefeuille || [])])];
}
const scopeMode = () => (V.settings.scope === 'moi' && scopeSirens().length ? 'moi' : 'tous');

async function check() {
  if (V.checking) return; V.checking = true;
  try {
    await loadData();
    V.run = (await chrome.runtime.sendMessage({ type: 'ac:getState' }))?.run || null;
    V.tab = await findTab();
    V.page = null; V.error = '';
    if (V.tab) {
      V.page = await ping();
      if (V.page && !V.page.login && !V.page.expired && !V.run?.running) {
        const d = await toTab({ type: 'ac:detect' }).catch((e) => ({ ok: false, error: e.message }));
        if (d && d.ok) V.total = d.total; else { V.page.expired = true; V.error = d?.error || ''; }
      }
    }
  } finally { V.checking = false; }
  render();
}

// ---- Vues ----
function statusPills() {
  const ok = V.page && !V.page.login && !V.page.expired;
  return `<div class="status">${ok ? '<span class="pill ok"><span class="dot"></span>Session impots.gouv active</span>' : V.tab ? '<span class="pill warn"><span class="dot"></span>Connexion requise</span>' : '<span class="pill"><span class="dot"></span>Espace professionnel fermé</span>'}<span class="pill">${IC.lock} Données sur ce poste</span></div>`;
}

function summaryBlock(c) {
  const annee = c.annee, open = c.taches.filter((t) => !t.done && !t.snoozed);
  if (!c.avis.length) return '';
  const last = V.data.runs[0];
  const neuf = last ? c.avis.filter((a) => a.firstSeenAt && a.firstSeenAt >= (V.data.runs[1]?.at || 0) && a.firstSeenAt <= last.at + 1000).length : 0;
  const tfN = c.N.filter((a) => a.taxe === 'TF'), acN = c.N.filter((a) => a.taxe === 'CFE' && a.acompte), cfeN = c.N.filter((a) => a.taxe === 'CFE' && !a.acompte);
  const doss = (arr) => new Set(arr.map((a) => a.siren)).size;
  const row = (t, s, pill) => `<div class="row"><div class="grow"><div class="t">${t}</div><div class="s">${s}</div></div>${pill}</div>`;
  return `<div class="card rows">
    ${row(`Taxe foncière ${annee}`, `${plural(doss(tfN), 'dossier')} · ${plural(tfN.length, 'avis', 'avis')}`, tfN.length ? '<span class="pill ok">Disponible</span>' : '<span class="pill">Aucun avis</span>')}
    ${row(`CFE ${annee} · acomptes`, acN.length ? `${plural(doss(acN), 'dossier')}` : 'Aucun acompte', acN.length ? '<span class="pill ok">À jour</span>' : '<span class="pill">—</span>')}
    ${row(`CFE ${annee} · soldes`, cfeN.length ? `${plural(doss(cfeN), 'dossier')} · ${plural(cfeN.length, 'avis', 'avis')}` : `Mise en ligne attendue début novembre${c.aVenir.length ? ` · ${plural(c.aVenir.length, 'montant')} déjà connu${c.aVenir.length > 1 ? 's' : ''}` : ''}`, cfeN.length ? '<span class="pill ok">Disponible</span>' : '<span class="pill warn">Attendue</span>')}
  </div>
  ${open.length ? `<button class="btn" id="goList">${IC.list} ${plural(open.length, 'action')} dans ma liste de travail</button>` : ''}
  ${last ? `<div class="cta-note">Dernière mise à jour ${ago(last.at)}${neuf ? ` · ${plural(neuf, 'nouvel avis', 'nouveaux avis')}` : ''}</div>` : ''}`;
}

function estimate(n) {
  const last = V.data.runs.find((r) => r.stats && r.stats.dossiers > 5 && r.duree && !r.complet);
  const per = last ? Math.max(0.25, last.duree / last.stats.dossiers) : (V.data.avis.length ? 0.6 : 1.5);
  return dur(n * per + (V.list && Date.now() - V.list.at < 12 * 3600e3 ? 0 : Math.ceil((V.total || n) / 40) * 0.6));
}

function viewReady(c) {
  const mode = scopeMode(), mine = scopeSirens();
  const n = mode === 'moi' ? mine.length : V.total;
  const first = !V.data.avis.length;
  return `${statusPills()}
  <div class="card hero">
    <div class="kpi num">${(V.total || 0).toLocaleString('fr-FR')}</div>
    <p>dossiers dans cet espace professionnel</p>
  </div>
  ${first ? `<div class="card hero"><h2>Première mise à jour</h2><p>Relève lit les avis de taxe foncière et de CFE ${c.annee} et ${c.anneeN1} de chaque dossier, les range sur ce poste et prépare votre liste de travail. Les fois suivantes, seuls les nouveaux avis sont lus.</p></div>` : summaryBlock(c)}
  <div class="scope"><div class="seg" id="scope"><button data-s="moi" class="${mode === 'moi' ? 'on' : ''}">Mon portefeuille${mine.length ? ` (${mine.length})` : ''}</button><button data-s="tous" class="${mode === 'tous' ? 'on' : ''}">Tout le cabinet (${(V.total || 0).toLocaleString('fr-FR')})</button></div></div>
  <button class="btn primary big" id="go">${IC.refresh} Mettre à jour mes clients</button>
  <div class="cta-note">${n ? `${estimate(n)[0].toUpperCase() + estimate(n).slice(1)} pour ${plural(n, 'dossier')}. ` : ''}Vous pouvez travailler dans un autre onglet pendant ce temps.</div>
  ${first ? '' : '<div class="cta-note tiny">Mise à jour rapide : seules les pages susceptibles d’avoir changé sont relues. <a href="#" id="goFull">Tout relire</a></div>'}
  ${V.run && V.run.error ? `<div class="errbox">La dernière mise à jour s’est arrêtée : ${esc(V.run.error)}${/Session/.test(V.run.error) ? '. Reconnectez-vous puis relancez : les avis déjà lus ne seront pas relus.' : ''}</div>` : ''}`;
}

function viewNoTab(c) {
  return `${statusPills()}
  <div class="card hero">
    <h2>Ouvrez votre espace professionnel</h2>
    <p>Relève travaille dans votre session impots.gouv, comme si vous consultiez vous-même chaque dossier.</p>
    <ol class="steps"><li>Connectez-vous à votre espace professionnel (vous saisissez vos identifiants, l’extension ne les voit pas).</li><li>Revenez sur ce volet et cliquez sur <b>Mettre à jour mes clients</b>.</li></ol>
  </div>
  <button class="btn primary big" id="openSite">${IC.ext} Ouvrir impots.gouv.fr</button>
  ${summaryBlock(c)}`;
}

function viewLogin(c) {
  return `${statusPills()}
  <div class="card hero">
    <h2>Connectez-vous à votre espace professionnel</h2>
    <p>${V.page && V.page.expired ? 'Votre session impots.gouv a expiré.' : 'L’onglet impots.gouv est ouvert mais la session n’est pas active.'} Connectez-vous dans l’onglet impots.gouv, ce volet se met à jour tout seul.</p>
  </div>
  <button class="btn big" id="showTab">${IC.ext} Aller sur l’onglet impots.gouv</button>
  ${summaryBlock(c)}`;
}

function viewRunning() {
  const r = V.run, pct = r.total ? Math.round(r.done / r.total * 100) : 0;
  const head = r.phase === 'liste' ? 'Lecture de la liste des dossiers' : `${r.done.toLocaleString('fr-FR')} / ${r.total.toLocaleString('fr-FR')} dossiers`;
  return `${statusPills()}
  <div class="card prog">
    <div class="small muted">Mise à jour en cours</div>
    <div class="big num">${head}</div>
    <div class="bar"><i style="width:${r.phase === 'liste' ? (r.total ? r.done / r.total * 100 : 5) : pct}%"></i></div>
    <div class="lbl">${esc(r.label || '')}</div>
    <div class="small muted" style="margin-top:6px">${r.eta ? `Encore ${dur(r.eta)} · ` : ''}${plural(r.nouveaux || 0, 'nouvel avis', 'nouveaux avis')} · vous pouvez fermer ce volet</div>
  </div>
  <div class="warnbox">Pendant la mise à jour, évitez de changer de dossier dans l’espace professionnel : le site ne suit qu’un dossier à la fois.</div>
  ${r.feed && r.feed.length ? `<div class="card feed"><h4>Repéré à l’instant</h4>${r.feed.map((f) => `<div class="it${V.vus && V.vus.has(f.title + f.sub) ? '' : ' new'}"><b>${esc(f.title)}</b><span>${esc(f.sub)}</span></div>`).join('')}</div>` : ''}
  <button class="btn" id="stop">${IC.pause} Mettre en pause</button>
  <div class="cta-note">La pause conserve tout ce qui est déjà lu ; la prochaine mise à jour reprend là où elle s’est arrêtée.</div>`;
}

function viewDone(c) {
  const open = c.taches.filter((t) => !t.done && !t.snoozed);
  const last = V.run.last || {};
  const counts = c.CATS.map((k) => ({ ...k, n: open.filter((t) => t.cat === k.key).length })).filter((k) => k.n);
  const minutes = (last.stats ? last.stats.pdf : 0) * 2 + c.taches.length;
  return `${statusPills()}
  <div class="card hero">
    <h2>${last.stopped ? 'Mise à jour en pause' : 'Vos clients sont à jour'}</h2>
    <p>${plural(last.stats ? last.stats.dossiers : 0, 'dossier lu', 'dossiers lus')} en ${dur(last.duree || 0).replace('environ ', '')} · ${plural(last.stats ? last.stats.nouveaux : 0, 'nouvel avis', 'nouveaux avis')}${last.stats && last.stats.erreurs ? ` · ${plural(last.stats.erreurs, 'dossier', 'dossiers')} à relancer` : ''}</p>
  </div>
  ${open.length ? `<div class="kpi" style="font-size:20px">${plural(open.length, 'action vous attend', 'actions vous attendent')}</div>
  <div class="cats">${counts.map((k) => `<button class="cat" data-cat="${k.key}"><div class="n num" style="color:${k.couleur}">${k.n}</div><div class="l">${esc(k.titre)}</div></button>`).join('')}</div>` : '<div class="card hero"><h2>Rien à traiter</h2><p>Aucun paiement à vérifier, aucune hausse au-delà de vos seuils.</p></div>'}
  <button class="btn primary big" id="goList2">${IC.list} Ouvrir ma liste de travail</button>
  ${minutes > 10 ? `<div class="cta-note">${IC.clock} Temps économisé : ${dur(minutes * 60).replace('environ ', 'environ ')}</div>` : ''}
  <button class="btn ghost sm" id="back">Revenir à l’accueil</button>`;
}

function render() {
  const c = ACA.campagne(V.data, { annee: ACA.anneeCampagne(), scope: scopeMode() === 'moi' ? 'moi' : undefined });
  let html, cle;
  if (V.run && V.run.running) { html = viewRunning(); cle = 'run'; }
  else if (V.run && V.run.last && V.showDone) { html = viewDone(c); cle = 'done'; }
  else if (!V.tab) { html = viewNoTab(c); cle = 'notab'; }
  else if (!V.page || V.page.login || V.page.expired) { html = viewLogin(c); cle = 'login'; }
  else { html = viewReady(c); cle = 'ready'; }
  const vueAvant = V.vue; V.vue = cle;
  $('#view').innerHTML = html;
  bind();
  mouvement(c, vueAvant !== V.vue);
}
function calme() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
function mouvement(c, nouvelleVue) {
  // Les blocs d'entrée ne s'animent qu'au changement d'écran, pas à chaque rafraîchissement
  if (!nouvelleVue) document.querySelectorAll('.hero, .cats, .kpi').forEach((e) => { e.style.animation = 'none'; });
  if (V.run && V.run.running) {
    V.vus = new Set((V.run.feed || []).map((f) => f.title + f.sub));
    const b = document.querySelector('.prog .bar > i');
    if (b) { const cible = b.style.width; if (V.barre && V.barre !== cible && !calme()) { b.style.width = V.barre; b.getBoundingClientRect(); requestAnimationFrame(() => { b.style.width = cible; }); } V.barre = cible; }
  } else V.barre = null;
  // Fin de mise à jour : les compteurs défilent une fois
  const last = V.run && V.run.last;
  if (last && V.showDone && !(V.run && V.run.running) && V.compte !== last.at) {
    V.compte = last.at;
    if (calme()) return;
    const els = [...document.querySelectorAll('.cat .n')], fin = els.map((e) => +e.textContent || 0), t0 = performance.now(), D = 550;
    const pas = (t) => { const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3); els.forEach((el, i) => { el.textContent = Math.round(fin[i] * e).toLocaleString('fr-FR'); }); if (k < 1) requestAnimationFrame(pas); };
    els.forEach((el) => { el.textContent = '0'; }); requestAnimationFrame(pas);
  }
}

function bind() {
  const on = (sel, fn) => { const e = $(sel); if (e) e.onclick = fn; };
  on('#openSite', async () => { const t = await chrome.tabs.create({ url: HOST + 'mire/accueil.do' }); V.tab = t; });
  on('#showTab', () => V.tab && chrome.tabs.update(V.tab.id, { active: true }));
  on('#goList', () => openApp('a-traiter'));
  on('#goList2', () => openApp('a-traiter'));
  on('#back', () => { V.showDone = false; check(); });
  on('#stop', async () => { try { await toTab({ type: 'ac:stop' }); toast('Pause demandée : fin du dossier en cours…'); } catch { toast('Onglet impots.gouv introuvable'); } });
  on('#go', () => start(false));
  on('#goFull', (ev) => { ev.preventDefault(); start(true); });
  document.querySelectorAll('#scope button').forEach((b) => b.onclick = async () => {
    if (b.dataset.s === 'moi' && !scopeSirens().length) { openApp('reglages'); toast('Indiquez d’abord votre portefeuille dans les réglages'); return; }
    V.settings = await ACDB.saveSettings({ scope: b.dataset.s }); V.data.settings = V.settings; render();
  });
  document.querySelectorAll('.cat[data-cat]').forEach((b) => b.onclick = () => openApp('a-traiter/' + b.dataset.cat));
}

async function start(complet) {
  if (!V.tab) return;
  const page = await ping();
  if (!page || page.login || page.expired) { V.page = page; render(); return; }
  if (page.running) { toast('Une mise à jour est déjà en cours'); return; }
  const mode = scopeMode();
  const list = V.list && V.list.list && V.list.list.length && Date.now() - V.list.at < 12 * 3600e3 ? V.list.list : null;
  const opts = { annee: ACA.anneeCampagne(), taxes: ['TF', 'CFE'], delay: V.settings.delai === 120 || !V.settings.delai ? 60 : V.settings.delai, complet: !!complet, dettes: true, amr: V.settings.amr !== false, scope: mode === 'moi' ? scopeSirens() : null, dossiers: list };
  await chrome.runtime.sendMessage({ type: 'ac:started' });
  await toTab({ type: 'ac:start', opts });
  V.showDone = true;
}

// ---- Événements ----
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'ac:state') {
    const was = V.run && V.run.running;
    V.run = msg.run;
    if (was && !msg.run.running) { V.showDone = !msg.run.error; loadData().then(render); }
    else if (msg.run.running) { if (!V.data) return; V.showDone = true; render(); }
  }
});
let t = null;
const recheck = () => { if (V.run && V.run.running) return; clearTimeout(t); t = setTimeout(check, 400); };
chrome.tabs.onUpdated.addListener((id, info, tab) => { if (info.status === 'complete' && tab.url && tab.url.startsWith(HOST)) recheck(); });
chrome.tabs.onActivated.addListener(recheck);
chrome.tabs.onRemoved.addListener((id) => { if (V.tab && id === V.tab.id) recheck(); });
window.addEventListener('focus', recheck);
check();
ACUP.check().then((u) => { if (!u.available) return; $('#upd').innerHTML = `<div class="upd"><b>Nouvelle version ${esc(u.version)} disponible</b>${u.notes ? `<span>${esc(u.notes)}</span>` : ''}<div class="l"><a class="btn sm" href="${esc(u.zip)}" target="_blank">Télécharger</a><a class="btn sm sec" href="${esc(u.guide)}" target="_blank">Comment mettre à jour (1 min)</a></div></div>`; });
