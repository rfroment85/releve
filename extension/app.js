// Relève — application : liste de travail, clients, collectivités, calendrier, exports, réglages.
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const { eur, eur2, sgn, pc, num, TAXE_LABEL, PAIEMENT } = ACA;
const plural = (n, a, b) => `${Number(n).toLocaleString('fr-FR')} ${n > 1 ? (b || a + 's') : a}`;
const ago = (t) => { const s = (Date.now() - t) / 1000; if (s < 90) return 'à l’instant'; if (s < 3600) return `il y a ${Math.round(s / 60)} min`; if (s < 86400) return `il y a ${Math.round(s / 3600)} h`; const d = Math.round(s / 86400); return d === 1 ? 'hier' : `il y a ${d} jours`; };
const fmtSiren = (s) => String(s || '').replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
const pcv = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(1).replace('.', ',') + ' %';
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const toast = (t, undo) => {
  const e = $('#toast'); e.innerHTML = esc(t) + (undo ? ' <a href="#" id="undo" style="color:#A9C1EC;margin-left:8px;pointer-events:auto">Annuler</a>' : '');
  e.classList.add('on'); e.style.pointerEvents = undo ? 'auto' : 'none';
  if (undo) $('#undo').onclick = (ev) => { ev.preventDefault(); undo(); e.classList.remove('on'); };
  clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), undo ? 6000 : 3000);
};

const AUTEUR = { nom: 'Romain Froment', titre: 'expert-comptable', url: 'https://www.linkedin.com/in/romain-froment-expert-comptable-var/' };
const auteurLien = () => `<a href="${AUTEUR.url}" target="_blank" rel="noopener">${AUTEUR.nom}</a>`;
const jourISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const calme = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const A = { sel: new Set(), data: null, S: null, c: null, coll: null, q: '', showDone: false, sort: { k: 'open', dir: -1 }, expanded: new Set(), openCom: new Set(), mail: null };

// ======================================================================
// Données
// ======================================================================
async function load() { A.data = await ACDB.loadAll(); A.S = A.data.settings; compute(); await loadClaude(); const b = await ACDB.get('meta', 'backupAt'); A.backupAt = b && b.at; A.habil = await ACDB.get('meta', 'habil'); const dl = await ACDB.get('meta', 'dossierList'); A.dossierList = (dl && dl.list) || []; const rc = await ACDB.get('meta', 'raccord'); A.raccord = (rc && rc.data) || {}; }
function scopeSirens() {
  const S = A.S, c = S.correspondance || {};
  const mine = Object.entries(c).filter(([, v]) => S.moi && v.collaborateur === S.moi).map(([k]) => k);
  return [...new Set([...mine, ...(S.portefeuille || [])])];
}
const scopeMoi = () => A.S.scope === 'moi' && scopeSirens().length > 0;
function compute() {
  ACM.setContext({ settings: A.S, annee: String(ACA.anneeCampagne()), ca: A.data.ca || {} });
  A.c = ACA.campagne(A.data, { annee: ACA.anneeCampagne(), scope: scopeMoi() ? 'moi' : undefined });
  A.coll = ACA.collectivites(A.c.N);
}
const openTasks = () => A.c.taches.filter((t) => !t.done && !t.snoozed);
const match = (...vals) => !A.q || vals.join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(A.q);
// État d'une action (fait, reporté, note) ; plusieurs à la fois pour la sélection multiple
async function setTasks(ids, status, extra = {}) {
  for (const id of ids) {
    const old = A.data.tasks[id] || null;
    const rec = { ...(old || {}), id, ...extra };
    if (status !== undefined) { rec.status = status; rec.at = Date.now(); if (status !== 'snooze') delete rec.until; }
    if (!rec.status && !rec.note) await ACDB.del('tasks', id); else await ACDB.put('tasks', rec);
  }
  A.data.tasks = Object.fromEntries((await ACDB.all('tasks')).map((t) => [t.id, t]));
  compute(); render();
  chrome.runtime.sendMessage({ type: 'ac:refreshBadge' }).catch(() => {});
}
const setTask = (id, status, extra) => setTasks([id], status, extra);
const markDone = (id, label = 'Marqué comme fait') => setTasks([].concat(id), 'done').then(() => toast(label, () => setTasks([].concat(id), null)));
const snooze = (id) => setTasks([].concat(id), 'snooze', { until: Date.now() + 7 * 864e5 }).then(() => toast('Reporté de 7 jours', () => setTasks([].concat(id), null)));
const taskById = (id) => A.c.taches.find((t) => t.id === id);
const avisById = (id) => A.c.N.find((a) => a.id === id) || A.c.avis.find((a) => a.id === id) || A.data.avis.find((a) => a.id === id);

function download(data, name, type) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function openPdf(id, suite) {
  const u8 = await ACDB.pdfBlob(id, suite);
  if (!u8) { toast('PDF non disponible sur ce poste : relancez une mise à jour'); return; }
  window.open(URL.createObjectURL(new Blob([u8], { type: 'application/pdf' })), '_blank');
}
const pdfName = (a, suite) => `${a.taxe}_${a.annee}_${clean(a.nom)}_${clean(a.commune || '')}${a.taxe === 'CFE' && a.nic ? '_' + a.nic : ''}${a.acompte ? '_acompte' : ''}${suite ? '_suite' : ''}${String(a.reference || '').replace(/\D/g, '') ? '_' + String(a.reference).replace(/\D/g, '').slice(-6) : ''}.pdf`.replace(/_+\./, '.');

const { IMPOT_LIB, detteCtx, amrCtx, mailItem, libColl, listeEt, mailDraft, sectionText, prelevementText, mailForItems, KIND_LIB, itemLib, reclamationText } = ACM;

// ======================================================================
// Coquille : navigation et barre du haut
// ======================================================================
const ROUTES = [
  { k: 'a-traiter', t: 'À traiter', i: 'list' }, { k: 'demander', t: 'Demander', i: 'chat' }, { k: 'clients', t: 'Clients', i: 'users' }, { k: 'habilitations', t: 'Habilitations', i: 'shield' }, { k: 'collectivites', t: 'Collectivités', i: 'building' },
  { k: 'calendrier', t: 'Calendrier', i: 'cal' }, { k: 'exports', t: 'Exports', i: 'down' }, { k: 'reglages', t: 'Réglages', i: 'gear' },
];
const route = () => { const h = decodeURIComponent(location.hash.slice(1)) || 'a-traiter'; const [p, ...r] = h.split('/'); return { p, arg: r.join('/') }; };
function savedMinutes() { return A.data.avis.filter((a) => a.hasPdf).length * 2 + Object.values(A.data.tasks).filter((t) => t.status === 'done').length * 3; }
function shell() {
  const { p } = route(), open = openTasks().length;
  const m = savedMinutes(), h = Math.floor(m / 60);
  $('#nav').innerHTML = `<div class="brand"><span class="logo">${IC.logo}</span>Relève</div>
    ${ROUTES.map((r) => `<a href="#${r.k}" class="${p === r.k || (p === 'client' && r.k === 'clients') ? 'on' : ''}">${IC[r.i]} ${r.t}${r.k === 'a-traiter' && open ? `<span class="cnt">${open}</span>` : ''}</a>`).join('')}
    <div class="sp"></div>
    ${m >= 30 ? `<div class="saved"><span class="tiny muted">Temps économisé cette campagne</span><b class="num">${h ? h + ' h' : m + ' min'}</b><span class="tiny muted">Estimation : 2 min par avis lu et classé à la main</span></div>` : ''}
    ${Object.values(A.data.tasks).filter((t) => t.status || t.note).length >= 10 && (!A.backupAt || Date.now() - A.backupAt > 30 * 864e5) ? `<a class="bknudge" href="#reglages">${IC.down} Pensez à sauvegarder vos données</a>` : ''}
    <div class="tiny muted" style="padding:10px 8px 0;display:flex;gap:6px">${IC.lock} Données sur ce poste</div>
    <div class="tiny muted auteur" style="padding:4px 8px 0">Créé par ${auteurLien()}, ${AUTEUR.titre}</div>`;
  const last = A.data.runs[0], mine = scopeSirens();
  $('#topbar').innerHTML = `<label class="search">${IC.search}<input id="q" type="search" placeholder="Rechercher un client, un SIREN, une commune" value="${esc(A.qRaw || '')}"></label>
    <div class="seg" id="scope"><button data-s="moi" class="${scopeMoi() ? 'on' : ''}">Mon portefeuille${mine.length ? ` (${mine.length})` : ''}</button><button data-s="tous" class="${scopeMoi() ? '' : 'on'}">Tout le cabinet</button></div>
    <span class="fresh" id="fresh">${A.run && A.run.running ? `${IC.refresh} Mise à jour en cours · ${A.run.done}/${A.run.total || '…'} dossiers` : last ? `${IC.refresh} À jour · ${ago(last.at)}` : 'Aucune mise à jour'}</span>`;
  const q = $('#q');
  q.oninput = () => { A.qRaw = q.value; A.q = q.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); page(); };
  $$('#scope button').forEach((b) => b.onclick = async () => {
    if (b.dataset.s === 'moi' && !mine.length) { location.hash = 'reglages'; toast('Indiquez d’abord votre portefeuille (« Je suis » ou liste de SIREN)'); return; }
    A.S = await ACDB.saveSettings({ scope: b.dataset.s }); A.data.settings = A.S; compute(); render();
  });
}
function render() {
  const avant = A.cnt;
  shell(); page();
  const c = $('.nav a .cnt'); A.cnt = c ? c.textContent : '';
  if (c && avant && avant !== A.cnt && !calme()) c.classList.add('bump');
}
// Barre de progression : repart de sa valeur précédente pour glisser jusqu'à la nouvelle
function animerBarre() {
  const b = $('.progress .bar > i'); if (!b) return;
  const cible = b.style.width;
  if (A.barre && A.barre !== cible && !calme()) { b.style.width = A.barre; b.getBoundingClientRect(); requestAnimationFrame(() => { b.style.width = cible; }); }
  A.barre = cible;
}
function page() {
  const { p, arg } = route();
  const el = $('#page');
  if (!A.data.avis.length && !['reglages', 'bienvenue'].includes(p)) { el.innerHTML = pageVide(); return; }
  const fn = { 'a-traiter': pageTraiter, clients: pageClients, client: pageClient, collectivites: pageCollectivites, calendrier: pageCalendrier, exports: pageExports, demander: pageDemander, habilitations: pageHabil, reglages: pageReglages, bienvenue: pageBienvenue, synthese: pageSynthese }[p] || pageTraiter;
  el.innerHTML = fn(arg);
  bindPage(p, arg);
}
function pageVide() {
  return `<div class="welcome"><h1>Votre liste de travail apparaîtra ici</h1>
  <p class="lead" style="margin-top:8px">Aucune donnée sur ce poste pour l’instant.</p>
  <div class="steps"><div class="step card"><div><b>Connectez-vous à votre espace professionnel impots.gouv</b><div class="muted small">Vous saisissez vous-même vos identifiants.</div></div></div>
  <div class="step card"><div><b>Cliquez sur l’icône Relève</b> dans la barre du navigateur<div class="muted small">Épinglez-la (icône puzzle, puis punaise) pour l’avoir toujours sous la main.</div></div></div>
  <div class="step card"><div><b>Cliquez sur « Mettre à jour mes clients »</b><div class="muted small">Les avis sont lus et analysés ; cette page se remplit à la fin.</div></div></div></div>
  <a class="btn" href="#reglages">${IC.gear} Réglages (portefeuille, fichier des dossiers)</a></div>`;
}

// ======================================================================
// À traiter
// ======================================================================
const ACTION = { 'mail-verif': 'Demander confirmation', 'mail-rappel': 'Prévenir le client', 'mail-explication': 'Expliquer la hausse', 'mail-dette': 'Relancer le client', 'mail-amr': 'Prévenir le client', 'mail-prelevement': 'Proposer le prélèvement', reclamation: 'Préparer la réclamation', fiche: 'Voir l’analyse', pdf: 'Ouvrir l’avis' };
function itemHtml(t) {
  const late = /Échue/.test(t.echeance || '');
  const a = t.avis;
  return `<div class="item${t.done ? ' done' : ''}${A.sel.has(t.id) ? ' selected' : ''}" data-id="${esc(t.id)}">
    <input type="checkbox" class="selbox" data-act="sel" ${A.sel.has(t.id) ? 'checked' : ''} title="Sélectionner" aria-label="Sélectionner">
    <button class="tick" data-act="tick" title="${t.done ? 'Remettre à faire' : 'Marquer comme fait'}">${IC.check}</button>
    <div class="who"><b data-act="fiche" title="${esc(t.nom)}">${esc(t.nom)}</b><span>${esc(t.lieu)}${t.collab ? ' · ' + esc(t.collab) : ''}</span><span class="mini-acts">${a && a.hasPdf ? `<a href="#" data-act="pdf" title="Ouvrir l’avis PDF">${IC.doc}</a>` : ''}<a href="#" data-act="note" title="Ajouter une note">${IC.edit}</a><a href="#" data-act="snooze" title="Reporter de 7 jours">${IC.snooze}</a><a href="#" data-act="site" title="Ouvrir ce dossier sur impots.gouv">${IC.ext}</a></span></div>
    <div class="what"><div class="q" title="${esc(t.quoi)}">${esc(t.quoi)}</div>${t.note ? `<div class="tnote">${IC.edit} ${esc(t.note)}</div>` : ''}</div>
    <div class="amt num">${eur(t.montant)}<span class="due${late ? ' late' : ''}">${esc(t.echeance || '')}</span></div>
    <div class="acts"><button class="btn sm${t.done ? '' : ' primary'}" data-act="main">${t.action.startsWith('mail') ? IC.mail : ''}${ACTION[t.action] || 'Ouvrir'}</button></div>
  </div>`;
}
function pageTraiter(arg) {
  const all = A.c.taches.filter((t) => !t.snoozed && match(t.nom, t.siren, t.lieu, t.collab, t.avis && t.avis.code));
  const cat = arg || '';
  const total = A.c.taches.length, done = A.c.taches.filter((t) => t.done).length;
  const open = all.filter((t) => !t.done);
  const shown = all.filter((t) => (A.showDone || !t.done) && (!cat || t.cat === cat));
  const groups = A.c.CATS.map((k) => ({ ...k, items: shown.filter((t) => t.cat === k.key) })).filter((g) => g.items.length);
  const cal = A.c.calendrier.slice(0, 4);
  return `<div class="ph"><div><h1>À traiter</h1><div class="sub">${open.length ? `${plural(open.length, 'action')}, les plus urgentes en premier` : 'Tout est traité'}</div></div>
    <div class="r"><label class="small muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="showDone" ${A.showDone ? 'checked' : ''}> Afficher les actions faites</label></div></div>
  <div class="cols"><div>
    ${total ? `<div class="progress">Campagne ${A.c.annee} : <b>${Math.round(done / total * 100)} % traités</b><div class="bar"><i style="width:${done / total * 100}%"></i></div><span class="muted">${done} / ${total}</span></div>` : ''}
    <div class="chips"><a class="chip${cat ? '' : ' on'}" href="#a-traiter">Tout <b>${open.length}</b></a>${A.c.CATS.map((k) => { const n = open.filter((t) => t.cat === k.key).length; return n ? `<a class="chip${cat === k.key ? ' on' : ''}" href="#a-traiter/${k.key}"><span class="sw dot" style="color:${k.couleur}"></span>${esc(k.titre)} <b>${n}</b></a>` : ''; }).join('')}</div>
    ${groups.length ? groups.map((g) => {
      const lim = A.expanded.has(g.key) ? 1e9 : 40;
      return `<section class="group"><div class="gh"><span class="sw" style="background:${g.couleur}"></span><b>${esc(g.titre)}</b><span>${esc(g.aide)} · ${g.items.length}</span><a href="#" class="selall" data-selall="${g.key}">Tout sélectionner</a></div>
      <div class="card items">${g.items.slice(0, lim).map(itemHtml).join('')}${g.items.length > lim ? `<div class="more"><button class="btn sm" data-more="${g.key}">Afficher les ${g.items.length - lim} autres</button></div>` : ''}</div></section>`;
    }).join('') : `<div class="card empty">${A.q ? 'Aucune action pour cette recherche.' : 'Rien à traiter pour l’instant. Bravo !'}</div>`}
  </div>
  ${selBar()}
  <aside class="rail">
    <div class="card"><h3>Prochaines dates</h3>${cal.map(evHtml).join('') || '<div class="muted small">Aucune échéance proche.</div>'}<a class="small" href="#calendrier">Tout le calendrier</a></div>
    <div class="card"><h3>Exporter</h3><div style="display:flex;flex-direction:column;gap:6px">
      <button class="btn" data-exp="xlsx">${IC.down} Classeur Excel de la campagne</button>
      <button class="btn" data-exp="zip">${IC.doc} Avis PDF ${scopeMoi() ? 'de mon portefeuille' : 'du cabinet'} (.zip)</button>
      <a class="btn" href="#synthese">${IC.print} Synthèse pour l’associé</a></div></div>
  </aside></div>`;
}
function selBar() {
  if (!A.sel.size) return '';
  const ts = [...A.sel].map(taskById).filter(Boolean);
  const mails = ts.filter((t) => mailItem(t)), clients = new Set(mails.map((t) => t.siren));
  return `<div class="selbar"><b>${plural(ts.length, 'action sélectionnée', 'actions sélectionnées')}</b>
    ${clients.size ? `<button class="btn sm primary" data-bulk="mails">${IC.mail} Préparer ${plural(clients.size, 'message')} (un par client)</button>` : ''}
    <button class="btn sm" data-bulk="done">${IC.check} Marquer fait</button><button class="btn sm" data-bulk="snooze">${IC.snooze} Plus tard</button><button class="btn sm ghost" data-bulk="clear">Désélectionner</button></div>`;
}
function evHtml(e) {
  const [d, m] = e.date.split('/');
  return `<div class="ev${e.jours !== null && e.jours < 0 ? ' past' : ''}" style="padding:10px 0"><div class="date"><b>${+d}</b><span>${MOIS[+m - 1]}</span></div><div><b class="small">${esc(e.titre)}</b><div class="tiny muted">${esc(e.texte)}${e.jours !== null && e.jours >= 0 ? ` · ${e.jours === 0 ? 'aujourd’hui' : 'dans ' + plural(e.jours, 'jour')}` : ''}</div></div></div>`;
}
function bindTraiter() {
  const sd = $('#showDone'); if (sd) sd.onchange = () => { A.showDone = sd.checked; page(); };
  $$('[data-more]').forEach((b) => b.onclick = () => { A.expanded.add(b.dataset.more); page(); });
  $$('[data-selall]').forEach((a) => a.onclick = (ev) => { ev.preventDefault(); const ids = $$(`.group .item`).filter((r) => r.closest('.group') === a.closest('.group')).map((r) => r.dataset.id); const all = ids.every((i) => A.sel.has(i)); ids.forEach((i) => all ? A.sel.delete(i) : A.sel.add(i)); page(); });
  $$('[data-bulk]').forEach((b) => b.onclick = () => bulk(b.dataset.bulk));
  bindItems();
}
// Sortie d'une ligne : la coche se remplit, puis la ligne se replie (≈ 300 ms au total, les autres lignes restent cliquables)
function sortir(row, coche) {
  if (row.dataset.sortie) return new Promise(() => {});
  row.dataset.sortie = '1';
  if (calme()) return Promise.resolve();
  if (coche) row.classList.add('checking');
  const reste = coche && A.showDone;
  return new Promise((ok) => setTimeout(ok, coche ? 130 : 0)).then(() => {
    if (reste) return;
    row.classList.add('leaving');
    const h = row.offsetHeight;
    return row.animate([{ height: h + 'px', opacity: 1 }, { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' }], { duration: 190, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' }).finished.catch(() => {});
  });
}
function bindItems(root = document) {
  $$('.item', root).forEach((row) => row.onclick = (ev) => {
    const btn = ev.target.closest('[data-act]'); if (!btn) return; if (btn.tagName === 'A') ev.preventDefault();
    const t = taskById(row.dataset.id); if (!t) return;
    const act = btn.dataset.act;
    if (act === 'sel') { btn.checked ? A.sel.add(t.id) : A.sel.delete(t.id); page(); return; }
    if (act === 'tick') t.done ? setTask(t.id, null) : sortir(row, true).then(() => markDone(t.id));
    else if (act === 'snooze') sortir(row, false).then(() => snooze(t.id));
    else if (act === 'pdf') openPdf(t.avis.id);
    else if (act === 'note') editNote(row, t);
    else if (act === 'site') openOnSite(t.siren, sitePage(t));
    else if (act === 'fiche') location.hash = 'client/' + t.siren;
    else if (act === 'main') runAction(t);
  });
}
// Ouvrir le dossier du client sur impots.gouv, à la bonne page
const sitePage = (t) => t.cat === 'dette' && t.dette ? 'dettes' : t.avis && t.avis.taxe === 'TF' ? 'tf' : t.avis && t.avis.taxe === 'CFE' ? 'cfe' : 'accueil';
async function openOnSite(siren, page) {
  toast('Ouverture du dossier sur impots.gouv…');
  const r = await chrome.runtime.sendMessage({ type: 'ac:gotoSite', siren, page }).catch((e) => ({ ok: false, error: e.message }));
  if (!r || !r.ok) toast((r && r.error) || 'Impossible d’ouvrir le dossier');
}
// Note sur une action, saisie dans la ligne
function editNote(row, t) {
  const w = row.querySelector('.what');
  w.innerHTML = `<textarea class="noteed" rows="2" placeholder="Ex. : paiement confirmé par téléphone le 12/11">${esc(t.note || '')}</textarea><div style="display:flex;gap:6px;margin-top:4px"><button class="btn sm primary" data-n="ok">Enregistrer</button><button class="btn sm ghost" data-n="no">Annuler</button></div>`;
  const ta = w.querySelector('textarea'); ta.focus();
  w.onclick = (ev) => ev.stopPropagation();
  const save = () => setTask(t.id, undefined, { note: ta.value.trim() }).then(() => toast(ta.value.trim() ? 'Note enregistrée' : 'Note supprimée'));
  w.querySelector('[data-n=ok]').onclick = save;
  w.querySelector('[data-n=no]').onclick = () => page();
  ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); if (e.key === 'Escape') { e.stopPropagation(); page(); } };
}
// Actions sur la sélection
async function bulk(kind) {
  const ts = [...A.sel].map(taskById).filter(Boolean), ids = ts.map((t) => t.id);
  if (kind === 'clear') { A.sel.clear(); page(); return; }
  if (kind === 'done') { A.sel.clear(); return markDone(ids, `${plural(ids.length, 'action marquée', 'actions marquées')} comme faite${ids.length > 1 ? 's' : ''}`); }
  if (kind === 'snooze') { A.sel.clear(); return snooze(ids); }
  if (kind === 'mails') {
    const by = {};
    for (const t of ts) { const it = mailItem(t); if (it) (by[t.siren] = by[t.siren] || []).push(it); }
    const entries = [], doneIds = [];
    for (const items of Object.values(by)) {
      const m = mailForItems(items, false);
      entries.push({ path: `Brouillon_${clean(items[0].a.nom)}.eml`, data: await emlBytes(m) });
      doneIds.push(...items.map((x) => x.task.id));
    }
    if (!entries.length) { toast('Aucun message à préparer dans la sélection'); return; }
    download(entries.length === 1 ? entries[0].data : makeZip(entries), entries.length === 1 ? entries[0].path : `Brouillons_${jourISO()}.zip`, entries.length === 1 ? 'message/rfc822' : 'application/zip');
    A.sel.clear();
    markDone(doneIds, `${plural(entries.length, 'brouillon')} préparé${entries.length > 1 ? 's' : ''} · actions marquées comme faites`);
  }
}
// Toutes les actions « message » ouvertes d'un client (celle cliquée en premier)
function clientMailItems(siren, first) {
  const l = openTasks().filter((t) => t.siren === siren).map(mailItem).filter(Boolean);
  if (first) l.sort((x, y) => (y.task.id === first.id) - (x.task.id === first.id));
  return l;
}
function runAction(t) {
  if (t.action === 'fiche') location.hash = 'client/' + t.siren;
  else if (t.action === 'pdf') openPdf(t.avis.id);
  else if (t.action === 'reclamation') openReclamation(t);
  else if (t.action.startsWith('mail')) { const items = t.done ? [mailItem(t)].filter(Boolean) : clientMailItems(t.siren, t); openComposer(items, t); }
}

// ======================================================================
// Clients
// ======================================================================
function clientsAgg() {
  const m = new Map();
  const get = (a) => { let o = m.get(a.siren); if (!o) { o = { siren: a.siren, nom: a.nom, code: a.code || '', collab: a.collab || '', email: a.email || '', tf: 0, cfe: 0, n: 0, n1: 0, modes: new Set(), open: 0, dette: 0, avis: 0, communes: new Set() }; m.set(a.siren, o); } return o; };
  for (const a of A.c.N) {
    const o = get(a); o.avis++; if (a.commune) o.communes.add(a.commune);
    if (a.taxe === 'TF') o.tf += a.m; else o.cfe += a.m;
    if (a.n1) { o.n += a.m; o.n1 += a.n1.m; }
    if (a.prel) o.modes.add(a.prel);
  }
  for (const a of A.c.avis) if (!m.has(a.siren)) { const o = get(a); if (a.commune) o.communes.add(a.commune); }
  for (const t of openTasks()) { const o = m.get(t.siren); if (o) o.open++; }
  const today = ACA.dkey(new Date().toLocaleDateString('fr-FR'));
  for (const r of A.c.dettes) { const o = m.get(r.siren); if (o && r.solde >= A.c.seuilDette && ACA.dkey(r.dateLimite) < today) o.dette += r.solde; }
  for (const r of A.c.amr) { const o = m.get(r.siren); if (o && r.montant >= A.c.seuilDette) o.dette += r.montant; }
  return [...m.values()].map((o) => ({ ...o, evo: o.n1 ? (o.n / o.n1 - 1) * 100 : null, mode: o.modes.has('NON') ? 'NON' : o.modes.has('MENSUEL') ? 'MENSUEL' : o.modes.has('OUI') ? 'OUI' : '' }));
}
const MODE_PILL = { NON: '<span class="pill acc">À payer par le client</span>', MENSUEL: '<span class="pill">Mensualisé</span>', OUI: '<span class="pill ok">Prélevé</span>', '': '<span class="muted small">—</span>' };
function pageClients() {
  const s = A.sort;
  const rows = clientsAgg().filter((o) => match(o.nom, o.siren, o.code, o.collab, [...o.communes].join(' ')));
  const key = { nom: (o) => o.nom, code: (o) => o.code, collab: (o) => o.collab, tf: (o) => o.tf, cfe: (o) => o.cfe, evo: (o) => o.evo ?? -1e9, mode: (o) => o.mode, open: (o) => o.open * 1e6 + o.dette, dette: (o) => o.dette }[s.k] || ((o) => o.nom);
  rows.sort((a, b) => { const x = key(a), y = key(b); return (typeof x === 'string' ? x.localeCompare(y, 'fr') : x - y) * s.dir; });
  const th = (k, t, r) => `<th class="s${r ? ' r' : ''}" data-sort="${k}">${t}${s.k === k ? (s.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  const nbDoss = A.data.dossiers.length;
  return `<div class="ph"><div><h1>Clients</h1><div class="sub">${plural(rows.length, 'client')} avec des avis ${A.c.annee} ou ${A.c.anneeN1}${nbDoss ? ` · ${plural(nbDoss, 'dossier contrôlé', 'dossiers contrôlés')}` : ''}</div></div></div>
  <div class="card"><table class="t"><thead><tr>${th('nom', 'Client')}${th('code', 'Code')}${th('collab', 'Collaborateur')}${th('tf', `Taxe foncière ${A.c.annee}`, 1)}${th('cfe', `CFE ${A.c.annee}`, 1)}${th('evo', 'Évolution', 1)}${th('mode', 'Paiement')}${th('open', 'À traiter', 1)}</tr></thead>
  <tbody>${rows.slice(0, 600).map((o) => `<tr class="click" data-siren="${o.siren}"><td><b>${esc(o.nom)}</b><div class="tiny muted">${fmtSiren(o.siren)}${o.communes.size ? ' · ' + esc([...o.communes].slice(0, 3).join(', ')) + (o.communes.size > 3 ? '…' : '') : ''}</div></td>
    <td>${esc(o.code)}</td><td>${esc(o.collab)}</td><td class="r num">${o.tf ? eur(o.tf) : '<span class="muted">—</span>'}</td><td class="r num">${o.cfe ? eur(o.cfe) : '<span class="muted">—</span>'}</td>
    <td class="r num ${o.evo > 0.5 ? 'up' : o.evo < -0.5 ? 'dn' : ''}">${o.evo === null ? '<span class="muted">—</span>' : pcv(o.evo)}</td><td>${MODE_PILL[o.mode]}</td>
    <td class="r">${o.open ? `<span class="pill acc">${o.open}</span>` : ''}${o.dette ? ` <span class="pill bad" title="Créances non soldées">${eur(o.dette)}</span>` : ''}</td></tr>`).join('')}</tbody></table>
  ${rows.length > 600 ? `<div class="more">600 premiers clients affichés : affinez avec la recherche.</div>` : ''}${!rows.length ? '<div class="empty">Aucun client pour cette recherche.</div>' : ''}</div>`;
}
function bindClients() {
  $$('th[data-sort]').forEach((th) => th.onclick = () => { const k = th.dataset.sort; A.sort = { k, dir: A.sort.k === k ? -A.sort.dir : (['nom', 'code', 'collab', 'mode'].includes(k) ? 1 : -1) }; page(); });
  $$('tr[data-siren]').forEach((tr) => tr.onclick = () => { location.hash = 'client/' + tr.dataset.siren; });
}

// ======================================================================
// Fiche client
// ======================================================================
const COL = { taux: 'var(--taux)', bases: 'var(--bases)', nouveaux: 'var(--neuf)', autres: '#B9B8B0' };
function decompBlock(a) {
  const d = a.d;
  if (!a.n1) return `<div class="verdict info">${a.acompte ? 'Acompte : le solde arrivera avec l’avis de novembre.' : `Pas d’avis ${A.c.anneeN1} rapproché sur ce poste pour comparer.`}</div>`;
  const parts = [['taux', d.taux, 'Taux votés'], ['bases', d.bases, 'Bases'], ['nouveaux', d.nouveaux, 'Biens nouvellement imposés'], ['autres', d.autres, 'Frais de gestion et arrondis']].filter((p) => Math.abs(p[1]) >= 1);
  const pos = parts.filter((p) => p[1] > 0), tot = pos.reduce((s, p) => s + p[1], 0) || 1;
  return `${d.verdict ? `<div class="verdict ${d.verdictType}">${esc(d.verdict)}</div>` : ''}
  ${a.taxe === 'TF' && d.lignes.length ? `<div class="stack">${pos.map((p) => `<i style="width:${p[1] / tot * 100}%;background:${COL[p[0]]}"></i>`).join('')}</div>
  <div class="legend">${parts.map((p) => `<span><i style="background:${COL[p[0]]}"></i>${p[2]} <b class="num">${sgn(p[1])}</b></span>`).join('')}</div>` : ''}`;
}
function lignesTable(a) {
  if (a.taxe !== 'TF' || !a.d.lignes.length) return '';
  return `<table class="t" style="margin-top:14px"><thead><tr><th>Collectivité</th><th class="r">Taux ${A.c.anneeN1}</th><th class="r">Taux ${A.c.annee}</th><th class="r">Cotisation ${A.c.anneeN1}</th><th class="r">Cotisation ${A.c.annee}</th><th class="r">Écart</th></tr></thead><tbody>
  ${a.d.lignes.map((l) => `<tr><td>${esc(l.nom)}${l.neuf ? ' <span class="pill neuf">nouveau</span>' : ''}</td><td class="r num">${l.tN1 ? esc(l.tN1) + ' %' : '—'}</td><td class="r num ${l.tN1 && l.tN !== l.tN1 ? 'up' : ''}" style="${l.tN1 && l.tN !== l.tN1 ? 'color:var(--taux);font-weight:600' : ''}">${l.tN ? esc(l.tN) + ' %' : '—'}</td><td class="r num">${eur(l.cN1)}</td><td class="r num">${eur(l.cN)}</td><td class="r num ${l.cN - l.cN1 > 0.5 ? 'up' : ''}">${sgn(l.cN - l.cN1)}</td></tr>`).join('')}</tbody></table>`;
}
function pageClient(arg) {
  const siren = String(arg).split('/')[0];
  const all = A.data.avis.filter((a) => a.siren === siren);
  if (!all.length) return `<a class="back" href="#clients">${IC.arrowL} Clients</a><div class="card empty">Client introuvable sur ce poste.</div>`;
  const info = (A.S.correspondance || {})[siren] || {};
  const nom = all[0].nom;
  const N = A.c.N.filter((a) => a.siren === siren).sort((a, b) => (a.taxe > b.taxe ? -1 : 1) || b.m - a.m);
  const tasks = A.c.taches.filter((t) => t.siren === siren);
  const dettes = A.c.dettes.filter((r) => r.siren === siren);
  const today = ACA.dkey(new Date().toLocaleDateString('fr-FR'));
  const amrs = A.c.amr.filter((r) => r.siren === siren);
  const detteDue = dettes.filter((r) => r.solde >= A.c.seuilDette && ACA.dkey(r.dateLimite) < today).reduce((s, r) => s + r.solde, 0) + amrs.reduce((s, r) => s + r.montant, 0);
  const main = N.find((a) => a.hausse) || N.find((a) => !a.acompte) || N[0];
  const hist = {};
  for (const a of all.filter((x) => !x.acompte)) { const k = a.taxe; hist[k] = hist[k] || {}; hist[k][a.annee] = (hist[k][a.annee] || 0) + (num(a.infos && a.infos.montantImpot) || num(a.montant)); }
  const histHtml = Object.entries(hist).filter(([, y]) => Object.keys(y).length >= 2).map(([k, y]) => { const ys = Object.keys(y).sort().slice(-6), max = Math.max(...ys.map((x) => y[x])); return `<div class="card av"><h3>${TAXE_LABEL[k]} sur ${ys.length} ans</h3><div class="hist">${ys.map((x) => `<div class="b${x === A.c.annee ? ' cur' : ''}"><span class="num">${eur(y[x])}</span><i style="height:${Math.max(4, y[x] / max * 70)}px"></i>${x}</div>`).join('')}</div></div>`; }).join('');
  return `<a class="back" href="#a-traiter">${IC.arrowL} Retour à la liste de travail</a>
  <div class="ph"><div><h1>${esc(nom)}</h1><div class="meta"><span>SIREN ${fmtSiren(siren)}</span>${info.code ? `<span>Dossier ${esc(info.code)}</span>` : ''}${info.collaborateur ? `<span>Suivi par ${esc(info.collaborateur)}</span>` : ''}<span>${info.email ? esc(info.email) : '<a href="#" id="addMail">Ajouter l’e-mail du client</a>'}</span></div></div>
  <div class="r">${main ? `<button class="btn primary" id="mailMain">${IC.mail} Préparer le message${clientMailItems(siren).length > 1 ? ` (${clientMailItems(siren).length} points)` : ''}</button>` : ''}${main && main.hasPdf ? `<button class="btn" data-pdf="${esc(main.id)}">${IC.doc} Ouvrir l’avis ${A.c.annee}</button>` : ''}<button class="btn" id="onSite" title="Sélectionne ce dossier dans votre espace professionnel">${IC.ext} impots.gouv</button></div></div>
  <div class="badges">${N.filter((a) => a.n1 && !a.acompte).map((a) => `<span class="pill ${a.d.pct > 0.5 ? (a.hausse ? 'bad' : 'warn') : 'ok'}">${TAXE_LABEL[a.taxe]} ${esc(a.commune || '')} : ${pcv(a.d.pct)}</span>`).join('')}
    ${[...new Set(N.map((a) => a.prel).filter(Boolean))].map((p) => p === 'NON' ? '<span class="pill acc">À payer par le client</span>' : p === 'MENSUEL' ? '<span class="pill">Mensualisé : rien à payer en plus</span>' : '<span class="pill ok">Prélevé à l’échéance</span>').join('')}
    ${detteDue ? `<span class="pill bad">${eur(detteDue)} de créances échues</span>` : dettes.length || A.data.dettes.some((x) => x.siren === siren) ? '<span class="pill ok">Aucune créance en retard</span>' : ''}</div>
  ${tasks.length ? `<div class="card items" style="margin-bottom:16px">${tasks.map(itemHtml).join('')}</div>` : ''}
  ${N.map((a) => `<div class="card av"><div class="hd"><div><h2 style="margin:0">${TAXE_LABEL[a.taxe]} ${a.annee}${a.acompte ? ' · acompte' : ''} · ${esc(a.commune || '')}</h2><div class="small muted">${esc(a.role || '')}${a.reference ? ' · réf. ' + esc(a.reference) : ''} · ${esc(a.paiement)}${a.dateLimite ? ' · date limite ' + esc(a.dateLimite) : ''}</div></div>
    <div class="m"><b class="num">${eur(a.m)}</b>${a.n1 ? `<span class="small muted num">${eur(a.n1.m)} en ${A.c.anneeN1} · <span class="${a.d.delta > 0.5 ? 'up' : 'dn'}">${sgn(a.d.delta)} (${pcv(a.d.pct)})</span></span>` : ''}</div></div>
    ${decompBlock(a)}${lignesTable(a)}
    <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">${a.hasPdf ? `<button class="btn sm" data-pdf="${esc(a.id)}">${IC.doc} Avis ${a.annee}</button>` : ''}${a.n1 && a.n1.hasPdf ? `<button class="btn sm" data-pdf="${esc(a.n1.id)}">${IC.doc} Avis ${a.n1.annee}</button>` : ''}<button class="btn sm" data-mail="${esc(a.id)}">${IC.mail} Message sur cet avis</button></div></div>`).join('')}
  ${cfeBlock(N)}
  ${histHtml}
  ${notesBlock(siren)}
  <div class="card av"><h3>Tous les avis sur ce poste</h3><table class="t"><thead><tr><th>Année</th><th>Impôt</th><th>Commune</th><th>Rôle / type</th><th class="r">Montant</th><th>Paiement</th><th></th></tr></thead><tbody>
  ${all.sort((a, b) => b.annee.localeCompare(a.annee) || a.taxe.localeCompare(b.taxe)).map((a) => `<tr><td>${esc(a.annee)}</td><td>${TAXE_LABEL[a.taxe]}${a.acompte ? ' (acompte)' : ''}</td><td>${esc(a.commune || '')}</td><td class="small">${esc(a.role || a.type || '')}</td><td class="r num">${eur(num(a.infos && a.infos.montantImpot) || a.montant)}</td><td class="small">${esc(PAIEMENT[a.infos && a.infos.prelevement] || '')}</td><td class="r">${a.hasPdf ? `<button class="btn ghost sm" data-pdf="${esc(a.id)}">PDF</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
  ${amrs.length ? `<div class="card av"><h3>Documents à payer (Payer › Dette fiscale)</h3><p class="small muted" style="margin:0 0 8px">Avis de mise en recouvrement : pénalités, majorations ou rappels. Leur nature s’affiche sur le site, à l’étape suivante du paiement.</p><table class="t"><thead><tr><th>AMR n°</th><th>SIRET</th><th class="r">Montant</th></tr></thead><tbody>${amrs.map((r) => `<tr><td>${esc(r.amr)}</td><td>${esc(r.siret)}</td><td class="r num up">${eur2(r.montant)}</td></tr>`).join('')}</tbody></table></div>` : ''}
  ${dettes.length ? `<div class="card av"><h3>Dettes fiscales (Compte fiscal › Synthèses › Dettes fiscales)</h3><table class="t"><thead><tr><th>Année</th><th>Impôt</th><th>Commune</th><th>Référence</th><th>Date limite</th><th class="r">Montant dû</th><th class="r">Payé</th><th class="r">Solde</th></tr></thead><tbody>${dettes.map((r) => { const due = ACA.dkey(r.dateLimite) < today, small = r.solde > 0 && r.solde < A.c.seuilDette; return `<tr><td>${esc(r.annee)}</td><td>${esc(r.impot)}</td><td>${esc(r.commune)}</td><td class="small">${esc(r.reference)}</td><td>${esc(r.dateLimite)}${due ? '' : ' <span class="pill">à échoir</span>'}</td><td class="r num">${eur2(r.montantDu)}</td><td class="r num">${r.paiementMontant ? eur2(num(r.paiementMontant)) : ''}</td><td class="r num ${r.solde >= A.c.seuilDette && due ? 'up' : ''}">${eur2(r.solde)}${small ? ' <span class="pill" title="Sous le seuil des réglages : pas d’action proposée">reliquat</span>' : ''}</td></tr>`; }).join('')}</tbody></table></div>` : ''}`;
}
function cfeBlock(N) {
  const l = N.filter((a) => a.cfe);
  if (!l.length) return '';
  return `<div class="card av"><h3>Contrôle de la CFE (base minimum, création)</h3><table class="t"><thead><tr><th>Avis</th><th>Base minimum</th><th class="r">CA ${l[0].cfe.ref}</th><th>Tranche</th><th class="r">Plafond légal</th><th>Constat</th></tr></thead><tbody>
  ${l.map((a) => { const c = a.cfe; const st = c.anomalies.length ? `<span class="cst bad">${esc(c.anomalies[0].texte)}</span>` : c.infos.length ? `<span class="small muted">${esc(c.infos.join(' '))}</span>` : c.bm && c.plafond ? '<span class="cst ok">Conforme au barème</span>' : !c.bm ? '<span class="small muted">Imposition sur la valeur locative</span>' : ''; return `<tr><td style="white-space:nowrap">CFE ${a.annee}<div class="tiny muted">${esc(a.commune || '')}</div></td><td class="num">${c.bm ? eur(c.bmM) : 'non'}</td><td class="r num">${c.caRef !== null ? eur(c.caRef) : '<span class="muted">non importé</span>'}</td><td class="small" style="white-space:nowrap">${esc((c.tranche || '').replace(/^CA de /, '').replace(/^CA /, ''))}</td><td class="r num">${c.plafond ? eur(c.plafond) : ''}</td><td style="white-space:normal">${st}</td></tr>`; }).join('')}</tbody></table>
  ${l.every((a) => a.cfe.caRef === null) ? '<p class="small muted" style="margin:8px 0 0">Importez les chiffres d’affaires dans <a href="#reglages">Réglages</a> pour contrôler la base minimum.</p>' : ''}</div>`;
}
function notesBlock(siren) {
  const notes = (A.data.cnotes[siren] || []).slice().sort((a, b) => b.at - a.at);
  return `<div class="card av"><h3>Notes</h3>${notes.map((n, i) => `<div class="cnote"><span class="tiny muted">${new Date(n.at).toLocaleDateString('fr-FR')}</span> ${esc(n.text)} <a href="#" class="tiny" data-delnote="${n.at}">supprimer</a></div>`).join('') || '<p class="small muted" style="margin:0 0 8px">Aucune note.</p>'}
  <div style="display:flex;gap:8px;margin-top:8px"><input id="cnoteIn" placeholder="Ajouter une note (appel, accord du client, pièce reçue…)" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:7px 10px"><button class="btn sm" id="cnoteOk">Ajouter</button></div></div>`;
}
async function saveCnotes(siren, list) {
  const all = { ...(A.data.cnotes || {}) }; all[siren] = list; if (!list.length) delete all[siren];
  await ACDB.put('meta', { key: 'cnotes', data: all }); A.data.cnotes = all; page();
}
function bindClient(arg) {
  const [siren, sub] = String(arg).split('/');
  bindTraiter();
  if (sub === 'message') setTimeout(() => { const b = $('#mailMain'); if (b) b.click(); }, 50);
  const os = $('#onSite'); if (os) os.onclick = () => openOnSite(siren, 'accueil');
  const ci = $('#cnoteIn'), co = $('#cnoteOk');
  if (co) { const add = () => { const v = ci.value.trim(); if (v) saveCnotes(siren, [...(A.data.cnotes[siren] || []), { at: Date.now(), text: v }]).then(() => toast('Note ajoutée')); }; co.onclick = add; ci.onkeydown = (e) => { if (e.key === 'Enter') add(); }; }
  $$('[data-delnote]').forEach((a) => a.onclick = (ev) => { ev.preventDefault(); saveCnotes(siren, (A.data.cnotes[siren] || []).filter((n) => String(n.at) !== a.dataset.delnote)); });
  $$('[data-pdf]').forEach((b) => b.onclick = () => openPdf(b.dataset.pdf));
  $$('[data-mail]').forEach((b) => b.onclick = () => openMail({ kind: 'auto', avis: avisById(b.dataset.mail) }));
  const mm = $('#mailMain');
  if (mm) mm.onclick = () => { const items = clientMailItems(siren); if (items.length) openComposer(items); else { const N = A.c.N.filter((a) => a.siren === siren); openMail({ kind: 'auto', avis: N.find((a) => a.hausse) || N.find((a) => !a.acompte) || N[0] }); } };
  const am = $('#addMail');
  if (am) am.onclick = async (ev) => {
    ev.preventDefault();
    const sp = am.parentElement; sp.innerHTML = '<input type="email" id="mailIn" placeholder="adresse@client.fr" style="border:1px solid var(--line);border-radius:7px;padding:3px 8px"> <button class="btn sm" id="mailOk">Enregistrer</button>';
    $('#mailIn').focus();
    $('#mailOk').onclick = async () => { const v = $('#mailIn').value.trim(); if (!v) return; const c = { ...(A.S.correspondance || {}) }; c[siren] = { ...(c[siren] || {}), email: v }; A.S = await ACDB.saveSettings({ correspondance: c }); A.data.settings = A.S; compute(); page(); toast('E-mail enregistré'); };
  };
}

// ======================================================================
// Collectivités
// ======================================================================
function pageCollectivites() {
  const { groups, P, decisions } = A.coll;
  const tfN = A.c.N.filter((a) => a.taxe === 'TF');
  const cfeN = A.c.N.filter((a) => a.taxe === 'CFE' && !a.acompte);
  if (!groups.length) return `<div class="ph"><div><h1>Collectivités</h1></div></div><div class="card empty">Aucun avis de taxe foncière ${A.c.annee} détaillé sur ce poste pour l’instant.</div>`;
  const d = P.cN - P.cN1;
  const top = decisions.slice(0, 4);
  const lead = `Les cotisations de vos clients ${d >= 0 ? 'augmentent' : 'baissent'} de <b class="num">${sgn(d)}</b>${P.cN1 ? ` (${pcv(d / P.cN1 * 100)})` : ''}. ${P.taux > 0.5 ? `Les taux votés en expliquent <b class="num">${sgn(P.taux)}</b>${top.length ? `, dont ${plural(top.length, 'décision')} qui pèse${top.length > 1 ? 'nt' : ''} le plus : ${top.map((x) => `${esc(x.nom.toLowerCase())} de ${esc(x.communes.slice(0, 2).join(', '))}${x.communes.length > 2 ? ` et ${x.communes.length - 2} autre${x.communes.length > 3 ? 's' : ''}` : ''}`).join(' ; ')}` : ''}.` : 'Aucune hausse de taux significative.'}`;
  const qs = groups.filter((g) => match(g.nom, ...g.list.map((a) => a.nom)));
  const maxAbs = Math.max(1, ...qs.map((g) => Math.abs(g.taux) + Math.abs(g.bases) + Math.abs(g.nouveaux)));
  return `<div class="ph"><div><h1>Ce qui a changé dans vos collectivités</h1><div class="sub">Taxe foncière ${A.c.annee} · ${plural(P.avis, 'avis', 'avis')} ${scopeMoi() ? 'de votre portefeuille' : 'du cabinet'} · montants hors frais de gestion</div></div></div>
  <p class="lead">${lead}</p>
  <div class="kpis">
    <div class="card"><div class="l">Cotisations ${A.c.annee}</div><div class="v num">${eur(P.cN)}</div><div class="l num">${eur(P.cN1)} en ${A.c.anneeN1}${P.cN1 ? ` · ${pcv(d / P.cN1 * 100)}` : ''}</div></div>
    <div class="card"><div class="l">Dont taux votés</div><div class="v num" style="color:var(--taux)">${sgn(P.taux)}</div><div class="l">à expliquer, pas à contester</div></div>
    <div class="card"><div class="l">Dont bases</div><div class="v num" style="color:var(--bases)">${sgn(P.bases)}</div><div class="l">revalorisation et locaux modifiés</div></div>
    <div class="card"><div class="l">Dont biens nouvellement imposés</div><div class="v num" style="color:var(--neuf)">${sgn(P.nouveaux)}</div><div class="l">aucune cotisation l’an dernier</div></div>
  </div>
  ${decisions.length ? `<h2>Les décisions qui pèsent le plus</h2><div class="card" style="margin-bottom:22px">${decisions.slice(0, 8).map((x) => `<div class="dec"><span class="pill ${x.var > 0 ? 'taux' : 'ok'}">${pcv(x.var)}</span><div class="grow"><b>${esc(x.nom)} : ${esc(x.tN1)} % → ${esc(x.tN)} %</b><div class="w">${esc(x.communes.join(', '))} · ${plural(x.avis, 'avis', 'avis')}</div></div><b class="num">${sgn(x.eff)}</b></div>`).join('')}</div>` : ''}
  <h2>Commune par commune</h2>
  <div class="legend" style="margin-bottom:8px"><span><i style="background:var(--taux)"></i>taux votés</span><span><i style="background:var(--bases)"></i>bases</span><span><i style="background:var(--neuf)"></i>nouveaux biens</span></div>
  <div class="card">${qs.map((g) => {
    const w = (v) => Math.max(0, v) / maxAbs * 100;
    return `<div class="com${A.openCom.has(g.nom) ? ' open' : ''}" data-com="${esc(g.nom)}"><div class="h"><div><b>${esc(g.nom)}</b><div class="tiny muted">${plural(g.nClients, 'client')}</div></div><div class="small muted">${plural(g.avis, 'avis', 'avis')}</div>
      <div class="mini"><i style="width:${w(g.taux)}%;background:var(--taux)"></i><i style="width:${w(g.bases)}%;background:var(--bases)"></i><i style="width:${w(g.nouveaux)}%;background:var(--neuf)"></i></div>
      <b class="num" style="text-align:right">${sgn(g.cN - g.cN1)}</b><span class="chev">${IC.chevron}</span></div>
      <div class="body"><p style="margin:4px 0 12px;color:var(--ink2)">${esc(g.phrase)}</p>
      <table class="t"><thead><tr><th>Collectivité</th><th class="r">Taux ${A.c.anneeN1}</th><th class="r">Taux ${A.c.annee}</th><th class="r">Effet des taux</th><th class="r">Effet des bases</th><th class="r">Nouveaux biens</th></tr></thead><tbody>
      ${Object.entries(g.types).map(([nom, t]) => `<tr><td>${esc(nom)}</td><td class="r num">${t.mN1 ? esc(t.mN1) + ' %' : '—'}</td><td class="r num" style="${t.mN1 && t.mN1 !== t.mN ? 'color:var(--taux);font-weight:600' : ''}">${t.mN ? esc(t.mN) + ' %' : '—'}</td><td class="r num">${sgn(t.taux)}</td><td class="r num">${sgn(t.bases)}</td><td class="r num">${t.nouveaux > 0.5 ? sgn(t.nouveaux) : ''}</td></tr>`).join('')}</tbody></table>
      <div style="margin-top:10px"><a class="small" href="#" data-qcom="${esc(g.nom)}">Voir les ${plural(g.nClients, 'client concerné', 'clients concernés')}</a></div></div></div>`;
  }).join('')}</div>
  <div class="card av" style="margin-top:22px"><h3>CFE ${A.c.annee}</h3><p class="small muted" style="margin:0">${cfeN.length ? `${plural(cfeN.length, 'avis de solde', 'avis de solde')} sur ce poste. Les explications de hausse de CFE figurent dans la fiche de chaque client.` : `Les avis de solde arrivent début novembre.${A.c.aVenir.length ? ` Les montants de ${plural(new Set(A.c.aVenir.map((r) => r.siren)).size, 'client')} sont déjà connus par les dettes fiscales.` : ''} Relancez une mise à jour après la mise en ligne : seuls les nouveaux avis seront lus.`}</p></div>`;
}
function bindCollectivites() {
  $$('.com > .h').forEach((h) => h.onclick = () => { const c = h.parentElement, k = c.dataset.com; c.classList.toggle('open'); c.classList.contains('open') ? A.openCom.add(k) : A.openCom.delete(k); });
  $$('[data-qcom]').forEach((a) => a.onclick = (ev) => { ev.preventDefault(); A.qRaw = a.dataset.qcom; A.q = A.qRaw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); location.hash = 'clients'; });
}

// ======================================================================
// Calendrier
// ======================================================================
function pageCalendrier() {
  const byDate = {};
  for (const a of A.c.N) {
    if (!a.dateLimite || a.jours === null || a.jours < -31) continue;
    const g = byDate[a.dateLimite] = byDate[a.dateLimite] || { date: a.dateLimite, jours: a.jours, n: 0, total: 0, nonPrel: 0, montantNon: 0, taxes: new Set() };
    g.n++; g.total += num(a.montant); g.taxes.add(TAXE_LABEL[a.taxe]); if (a.prel === 'NON') { g.nonPrel++; g.montantNon += num(a.montant); }
  }
  const ech = Object.values(byDate).sort((a, b) => ACA.dkey(a.date).localeCompare(ACA.dkey(b.date)));
  const aV = A.c.aVenir;
  return `<div class="ph"><div><h1>Calendrier</h1><div class="sub">Échéances de vos clients et dates habituelles de la campagne ${A.c.annee}</div></div></div>
  <div class="cols"><div>
    <h2>Échéances de vos clients</h2>
    <div class="card" style="margin-bottom:20px">${ech.length ? ech.map((g) => { const [d, m] = g.date.split('/'); return `<div class="ev${g.jours < 0 ? ' past' : ''}"><div class="date"><b>${+d}</b><span>${MOIS[+m - 1]}</span></div><div style="flex:1"><b>${[...g.taxes].join(' et ')} · ${plural(g.n, 'avis', 'avis')}</b><div class="small muted">${eur(g.total)} au total${g.nonPrel ? ` · <b style="color:var(--accent-d)">${plural(g.nonPrel, 'avis')} sans prélèvement (${eur(g.montantNon)})</b>` : ''} · ${g.jours < 0 ? `échue depuis ${plural(-g.jours, 'jour')}` : g.jours === 0 ? 'aujourd’hui' : `dans ${plural(g.jours, 'jour')}`}</div></div>${g.nonPrel ? `<a class="btn sm" href="#a-traiter/${g.jours < 0 ? 'paiement' : 'prevenir'}">Voir</a>` : ''}</div>`; }).join('') : '<div class="empty">Aucune échéance dans les prochaines semaines.</div>'}</div>
    ${aV.length ? `<h2>Avis de CFE attendus</h2><div class="card" style="margin-bottom:20px"><div class="ev"><div class="date"><b>3</b><span>nov.</span></div><div><b>${plural(new Set(aV.map((r) => r.siren)).size, 'client')} : montant déjà connu</b><div class="small muted">Les créances de CFE ${A.c.annee} figurent dans les dettes fiscales avant la mise en ligne de l’avis : ${eur(aV.reduce((s, r) => s + r.montantDu, 0))} au total.</div></div></div></div>` : ''}
  </div><aside class="rail"><div class="card"><h3>Dates de la campagne</h3>${A.c.calendrier.map(evHtml).join('')}</div></aside></div>`;
}

// ======================================================================
// Exports
// ======================================================================
function pageExports() {
  const N = A.c.N, n1 = A.c.avis.filter((a) => a.annee === A.c.anneeN1);
  const port = scopeMoi() ? 'de votre portefeuille' : 'du cabinet';
  return `<div class="ph"><div><h1>Exports</h1><div class="sub">Fichiers créés sur ce poste, à la demande, ${port}</div></div></div>
  <div class="grid2">
    <div class="card exp"><h2>${IC.down} Classeur Excel de la campagne</h2><p>Une feuille par usage : À traiter, avis ${A.c.annee} avec l’analyse des hausses, collectivités, dettes fiscales. Filtres et volets figés prêts à l’emploi.</p><button class="btn primary" data-exp="xlsx">Télécharger le classeur</button></div>
    <div class="card exp"><h2>${IC.doc} Avis PDF (.zip)</h2><p>${plural(N.filter((a) => a.hasPdf).length, 'avis', 'avis')} ${A.c.annee} et ${plural(n1.filter((a) => a.hasPdf).length, 'avis', 'avis')} ${A.c.anneeN1}, rangés dans un dossier par client.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-exp="zip">Avis ${A.c.annee}</button><button class="btn" data-exp="zip2">Avis ${A.c.annee} et ${A.c.anneeN1}</button></div></div>
    <div class="card exp"><h2>${IC.mail} Brouillons de mails (.zip)</h2><p>Un seul brouillon par client, qui regroupe tous ses points ouverts (paiements, hausses, créances, prélèvement), avis en pièce jointe. Chaque fichier s’ouvre dans Outlook ; rien n’est envoyé sans vous.</p><button class="btn" data-exp="mails">Préparer ${plural(new Set(openTasks().filter((t) => mailItem(t)).map((t) => t.siren)).size, 'brouillon')}</button></div>
    <div class="card exp"><h2>${IC.print} Synthèse pour l’associé</h2><p>Une page : chiffres clés, actions par catégorie, plus fortes hausses, décisions des collectivités. À imprimer ou enregistrer en PDF.</p><a class="btn" href="#synthese">Ouvrir la synthèse</a></div>
  </div>`;
}
function bindExports() { $$('[data-exp]').forEach((b) => b.onclick = () => doExport(b.dataset.exp, b)); }
async function doExport(kind, btn) {
  const label = btn.innerHTML; btn.disabled = true; btn.textContent = 'Préparation…';
  try {
    const stamp = jourISO(), port = scopeMoi() ? (A.S.moi ? clean(A.S.moi) : 'portefeuille') : 'cabinet';
    if (kind === 'xlsx') { download(buildXlsxCampagne(), `Releve_${A.c.annee}_${port}_${stamp}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); toast('Classeur téléchargé'); }
    else if (kind === 'zip' || kind === 'zip2') {
      const list = A.c.avis.filter((a) => a.hasPdf && (a.annee === A.c.annee || (kind === 'zip2' && a.annee === A.c.anneeN1)));
      const entries = [];
      for (const a of list) {
        const p = await ACDB.get('pdfs', a.id); if (!p) continue;
        const dir = `${clean(a.nom)}_${a.siren}`;
        entries.push({ path: `${dir}/${pdfName(a)}`, data: p.blob });
        if (p.suite) entries.push({ path: `${dir}/${pdfName(a, true)}`, data: p.suite });
      }
      if (!entries.length) { toast('Aucun PDF sur ce poste'); return; }
      download(makeZip(entries), `Avis_${kind === 'zip2' ? A.c.anneeN1 + '-' : ''}${A.c.annee}_${port}_${stamp}.zip`, 'application/zip');
      toast(`${plural(entries.length, 'fichier')} dans le ZIP`);
    } else if (kind === 'mails') {
      const by = {};
      for (const t of openTasks()) { const it = mailItem(t); if (it) (by[t.siren] = by[t.siren] || []).push(it); }
      const entries = [];
      for (const items of Object.values(by)) entries.push({ path: `Brouillon_${clean(items[0].a.nom)}.eml`, data: await emlBytes(mailForItems(items, false)) });
      if (!entries.length) { toast('Aucun brouillon à préparer'); return; }
      download(makeZip(entries), `Brouillons_${A.c.annee}_${port}_${stamp}.zip`, 'application/zip');
      toast(`${plural(entries.length, 'brouillon')} : ouvrez-les dans Outlook pour les relire et les envoyer`);
    }
  } catch (e) { toast('Export impossible : ' + e.message); }
  finally { btn.disabled = false; btn.innerHTML = label; }
}
function buildXlsxCampagne() {
  const an = A.c.annee, anN1 = A.c.anneeN1;
  const CATT = Object.fromEntries(A.c.CATS.map((k) => [k.key, k.titre]));
  const sheets = [
    { name: 'À traiter', title: `À traiter · campagne ${an}`, subtitle: `${scopeMoi() ? 'Mon portefeuille' : 'Tout le cabinet'} · extrait le ${new Date().toLocaleDateString('fr-FR')} · Relève`, tab: true,
      cols: [{ h: 'Catégorie', w: 22 }, { h: 'Client', w: 34, style: () => 6 }, { h: 'SIREN', w: 12 }, { h: 'Code', w: 10 }, { h: 'Collaborateur', w: 16 }, { h: 'Avis', w: 30 }, { h: 'Ce qu’il faut faire', w: 70, t: 'long' }, { h: 'Montant', w: 13, t: 'eur' }, { h: 'Échéance', w: 18 }, { h: 'Statut', w: 10, style: (v) => v === 'Fait' ? 8 : 7 }, { h: 'Note', w: 40, t: 'long' }],
      rows: A.c.taches.filter((t) => !t.snoozed).map((t) => [CATT[t.cat], t.nom, t.siren, t.avis ? t.avis.code : '', t.collab, t.lieu, t.quoi, t.montant, t.echeance, t.done ? 'Fait' : 'À faire', t.note || '']) },
    { name: `Avis ${an}`, title: `Avis ${an} et évolution`,
      cols: [{ h: 'Client', w: 34, style: () => 6 }, { h: 'SIREN', w: 12 }, { h: 'Code', w: 10 }, { h: 'Collaborateur', w: 16 }, { h: 'Impôt', w: 13 }, { h: 'Commune', w: 22 }, { h: 'Rôle / type', w: 18 }, { h: `Montant ${an}`, w: 14, t: 'eur' }, { h: `Montant ${anN1}`, w: 14, t: 'eur' }, { h: 'Écart €', w: 13, t: 'eur', style: () => 10 }, { h: 'Variation', w: 11, t: 'pct' }, { h: 'Effet des taux', w: 13, t: 'eur' }, { h: 'Effet des bases', w: 13, t: 'eur' }, { h: 'Biens nouveaux', w: 13, t: 'eur' }, { h: 'Paiement', w: 20 }, { h: 'Date limite', w: 12 }, { h: 'Analyse', w: 80, t: 'long' }, { h: 'Base minimum CFE', w: 13, t: 'eur' }, { h: 'CA N-2', w: 13, t: 'eur' }, { h: 'Plafond légal', w: 13, t: 'eur' }, { h: 'Contrôle CFE', w: 60, t: 'long' }],
      rows: A.c.N.map((a) => [a.nom, a.siren, a.code, a.collab, TAXE_LABEL[a.taxe] + (a.acompte ? ' (acompte)' : ''), a.commune, a.role || a.type, a.m, a.n1 ? a.n1.m : '', a.n1 ? a.d.delta : '', a.n1 && a.n1.m ? a.d.pct / 100 : '', a.n1 && a.taxe === 'TF' ? a.d.taux : '', a.n1 && a.taxe === 'TF' ? a.d.bases : '', a.n1 && a.d.nouveaux ? a.d.nouveaux : '', a.paiement, a.dateLimite, a.d.verdict, a.cfe && a.cfe.bm ? a.cfe.bmM : '', a.cfe && a.cfe.caRef !== null ? a.cfe.caRef : '', a.cfe && a.cfe.plafond ? a.cfe.plafond : '', a.cfe ? [...a.cfe.anomalies.map((x) => x.texte), ...a.cfe.infos].join(' ') : '']) },
    { name: 'Collectivités', title: `Taxe foncière ${an} : évolution par commune`,
      cols: [{ h: 'Commune', w: 26, style: () => 6 }, { h: 'Avis', w: 8, t: 'n' }, { h: 'Clients', w: 8, t: 'n' }, { h: `Cotisations ${anN1}`, w: 15, t: 'eur' }, { h: `Cotisations ${an}`, w: 15, t: 'eur' }, { h: 'Écart €', w: 13, t: 'eur', style: () => 10 }, { h: 'Effet des taux', w: 13, t: 'eur' }, { h: 'Effet des bases', w: 13, t: 'eur' }, { h: 'Biens nouveaux', w: 13, t: 'eur' }, { h: 'Explication', w: 100, t: 'long' }],
      rows: A.coll.groups.map((g) => [g.nom, g.avis, g.nClients, g.cN1, g.cN, g.cN - g.cN1, g.taux, g.bases, g.nouveaux, g.phrase]) },
    { name: 'Dettes fiscales', title: 'Dettes fiscales et avis de mise en recouvrement à payer',
      cols: [{ h: 'Client', w: 34, style: () => 6 }, { h: 'SIREN', w: 12 }, { h: 'Collaborateur', w: 16 }, { h: 'Impôt', w: 12 }, { h: 'Année', w: 8 }, { h: 'Commune', w: 20 }, { h: 'Référence', w: 18 }, { h: 'Date limite', w: 12 }, { h: 'Montant dû', w: 13, t: 'eur' }, { h: 'Solde', w: 13, t: 'eur', style: (v) => v > 0 ? 9 : undefined }],
      rows: [...A.c.amr.map((r) => [r.nom, r.siren, r.collab, 'AMR', '', '', 'AMR n° ' + r.amr, 'Exigible', r.montant, r.montant]), ...A.c.dettes.map((r) => [r.nom, r.siren, r.collab, r.impot, r.annee, r.commune, r.reference, r.dateLimite, r.montantDu, r.solde])] },
  ];
  return buildWorkbook(sheets);
}

// ======================================================================
// Message au client : brouillon .eml (Outlook) ou texte à copier
// ======================================================================
async function emlBytes(m) {
  const att = [], seen = new Set();
  for (const a of (m.attach || (m.avis ? [m.avis] : []))) {
    if (!a || !a.hasPdf || seen.has(a.id)) continue; seen.add(a.id);
    const p = await ACDB.get('pdfs', a.id); if (p) att.push({ name: pdfName(a), bytes: p.blob });
  }
  return buildEml({ to: m.to, subject: m.subject, body: m.body, attachments: att });
}
// Fenêtre de message : un ou plusieurs points du même client, tous cochés par défaut
function openComposer(items, task) {
  items = items.filter(Boolean);
  if (!items.length) { toast('Rien à préparer pour ce client'); return; }
  const st = { on: items.map(() => true), detaille: false };
  const a0 = items[0].a;
  const canDetail = items.some((x) => x.a.taxe === 'TF' && x.a.n1 && x.a.d && x.a.d.lignes.length && (x.kind === 'explication' || x.kind === 'auto'));
  const sel = () => items.filter((_, i) => st.on[i]);
  const draft = () => mailForItems(sel().length ? sel() : [items[0]], st.detaille);
  let d = draft();
  $('#sheet').innerHTML = `<div style="display:flex;align-items:center;gap:10px"><h2 style="margin:0;flex:1">Message à ${esc(a0.nom)}</h2>${canDetail ? '<div class="seg" id="mlen"><button class="on" data-d="0">Court</button><button data-d="1">Détaillé</button></div>' : ''}<button class="btn ghost sm" id="mclose" title="Fermer">✕</button></div>
    ${items.length > 1 ? `<div class="pts"><div class="tiny muted" style="margin-bottom:4px">Points inclus dans ce message</div>${items.map((x, i) => `<label><input type="checkbox" data-pt="${i}" checked> ${esc(itemLib(x))}</label>`).join('')}</div>` : ''}
    <div class="fl"><span class="muted">À</span><input id="mto" type="email" value="${esc(d.to)}" placeholder="adresse du client (facultatif)"><span class="muted">Objet</span><input id="msub" value="${esc(d.subject)}"><span class="muted">Pièces jointes</span><div id="matt"></div></div>
    <textarea id="mbody">${esc(d.body)}</textarea>
    <div class="ft"><button class="btn primary" id="meml">${IC.mail} Ouvrir dans Outlook</button><button class="btn" id="mcopy">${IC.copy} Copier le texte</button><span class="tiny muted" style="margin-left:auto">Rien n’est envoyé sans votre clic dans Outlook.</span></div>
    <div class="tiny muted" style="margin-top:8px">« Ouvrir dans Outlook » télécharge un brouillon (.eml) : cliquez dessus dans la barre de téléchargements, il s’ouvre prêt à envoyer avec les avis joints.</div>`;
  const att = () => { const l = [...new Set((d.attach || []).map((a) => a.id))].map((id) => (d.attach || []).find((a) => a.id === id)); $('#matt').innerHTML = l.length ? l.map((a) => `<span class="att">${IC.doc} ${esc(pdfName(a))}</span>`).join('') : '<span class="muted small">Aucune</span>'; };
  const refresh = () => { d = draft(); $('#msub').value = d.subject; $('#mbody').value = d.body; att(); };
  att();
  $('#modal').hidden = false;
  const close = () => { $('#modal').hidden = true; };
  $('#mclose').onclick = close;
  $('#modal').onclick = (ev) => { if (ev.target.id === 'modal') close(); };
  $$('[data-pt]').forEach((c) => c.onchange = () => { st.on[+c.dataset.pt] = c.checked; refresh(); });
  $$('#mlen button').forEach((b) => b.onclick = () => { $$('#mlen button').forEach((x) => x.classList.toggle('on', x === b)); st.detaille = b.dataset.d === '1'; refresh(); });
  $('#meml').onclick = async () => {
    const c = { ...d, to: $('#mto').value.trim(), subject: $('#msub').value, body: $('#mbody').value };
    if (c.to && !(A.S.correspondance || {})[a0.siren]?.email) { const cc = { ...(A.S.correspondance || {}) }; cc[a0.siren] = { ...(cc[a0.siren] || {}), email: c.to }; A.S = await ACDB.saveSettings({ correspondance: cc }); A.data.settings = A.S; }
    download(await emlBytes(c), `Brouillon_${clean(a0.nom)}${sel().length === 1 ? `_${a0.taxe}_${a0.annee || ''}` : ''}.eml`, 'message/rfc822');
    close();
    const ids = sel().map((x) => x.task && !x.task.done && x.task.id).filter(Boolean);
    if (ids.length) markDone(ids, `Brouillon créé · ${plural(ids.length, 'action marquée', 'actions marquées')} comme faite${ids.length > 1 ? 's' : ''}`); else toast('Brouillon créé : ouvrez-le depuis la barre de téléchargements');
  };
  $('#mcopy').onclick = async () => { await navigator.clipboard.writeText($('#mbody').value); toast('Texte copié'); };
}
// Compatibilité : message sur un seul avis
const openMail = ({ kind, avis, task }) => avis ? openComposer([{ kind, a: avis, task }], task) : toast('Avis introuvable');

function openReclamation(t) {
  const r = reclamationText(t);
  $('#sheet').innerHTML = `<div style="display:flex;align-items:center;gap:10px"><h2 style="margin:0;flex:1">Réclamation · ${esc(t.nom)}</h2><button class="btn ghost sm" id="mclose" title="Fermer">✕</button></div>
    <p class="small muted" style="margin:8px 0 10px">${esc(t.quoi)}</p>
    <textarea id="rtext" style="min-height:340px">${esc(r.texte)}</textarea>
    <div class="ft"><button class="btn primary" id="rcopy">${IC.copy} Copier le texte</button><button class="btn" id="rdl">${IC.down} Télécharger (.txt)</button>${t.avis && t.avis.hasPdf ? `<button class="btn" id="rpdf">${IC.doc} Avis PDF</button>` : ''}<button class="btn" id="rdone">${IC.check} Marquer comme fait</button></div>
    <div class="tiny muted" style="margin-top:8px">Relisez et complétez les passages entre crochets, puis déposez la réclamation par la messagerie sécurisée de l’espace professionnel ou par courrier au service des impôts des entreprises. Relève ne dépose rien.</div>`;
  $('#modal').hidden = false;
  const close = () => { $('#modal').hidden = true; };
  $('#mclose').onclick = close;
  $('#modal').onclick = (ev) => { if (ev.target.id === 'modal') close(); };
  $('#rcopy').onclick = async () => { await navigator.clipboard.writeText($('#rtext').value); toast('Texte copié'); };
  $('#rdl').onclick = () => download(new TextEncoder().encode('﻿' + $('#rtext').value.replace(/\n/g, '\r\n')), `Reclamation_${clean(t.nom)}_${t.avis.taxe}_${t.avis.annee}.txt`, 'text/plain');
  const rp = $('#rpdf'); if (rp) rp.onclick = () => openPdf(t.avis.id);
  $('#rdone').onclick = () => { close(); markDone(t.id); };
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) $('#modal').hidden = true; });

// ======================================================================
// Réglages
// ======================================================================
function pageReglages() {
  const S = A.S, c = S.correspondance || {}, nC = Object.keys(c).length;
  const collabs = [...new Set(Object.values(c).map((v) => v.collaborateur).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  return `<div class="ph"><div><h1>Réglages</h1><div class="sub">Enregistrés sur ce poste uniquement</div></div></div>
  <div class="form">
    <div class="card"><label class="f">Fichier des dossiers du cabinet</label>
      <div class="help">Facultatif. Un export CSV ou Excel de votre logiciel avec au moins le SIREN, et si possible le nom du client, le code dossier, le collaborateur et l’e-mail. Il sert aussi à repérer les clients absents de votre espace (Habilitations › Clients à raccorder). Les en-têtes sont reconnus automatiquement (séparateur ; , ou tabulation).</div>
      <div class="inl"><input type="file" id="fCorr" accept=".csv,.txt,.xlsx,text/csv"><span class="small ${nC ? '' : 'muted'}">${nC ? `${plural(nC, 'dossier')} importé${nC > 1 ? 's' : ''}${collabs.length ? ` · ${plural(collabs.length, 'collaborateur')}` : ''}` : 'Aucun fichier importé'}</span>${nC ? '<button class="btn sm ghost" id="clrCorr">Retirer</button>' : ''}</div></div>
    <div class="card"><label class="f">Chiffres d’affaires (contrôle de la base minimum de CFE)</label>
      <div class="help">Facultatif. Un fichier CSV ou Excel avec une ligne par exercice : SIREN, date de clôture, durée en mois, chiffre d’affaires HT (ou recettes) et, si possible, date de création. Pour la CFE ${ACA.anneeCampagne()}, l’exercice utile est celui clos en ${ACA.anneeCampagne() - 2}.</div>
      <div class="inl"><input type="file" id="fCa" accept=".csv,.txt,.xlsx,text/csv"><span class="small ${caCount() ? '' : 'muted'}">${caCount() ? `${plural(caCount(), 'client')} · ${plural(caRefCount(), 'exercice')} clos en ${ACA.anneeCampagne() - 2}` : 'Aucun fichier importé'}</span>${caCount() ? '<button class="btn sm ghost" id="clrCa">Retirer</button>' : ''}<a href="#" id="caModele" class="small">Télécharger un modèle</a></div></div>
    <div class="card"><label class="f">Mon portefeuille</label>
      <div class="help">Pour travailler sur « Mon portefeuille » : choisissez votre nom (d’après le fichier des dossiers) et/ou collez la liste de vos SIREN.</div>
      <div class="inl" style="margin-bottom:10px"><span>Je suis</span><select id="moi" style="max-width:260px"><option value="">—</option>${collabs.map((x) => `<option ${x === S.moi ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>${!collabs.length ? '<span class="tiny muted">importez d’abord le fichier des dossiers</span>' : ''}</div>
      <textarea id="port" placeholder="SIREN ou SIRET, un par ligne ou séparés par des espaces">${esc((S.portefeuille || []).join('\n'))}</textarea>
      <div class="inl" style="margin-top:8px"><button class="btn sm" id="savePort">Enregistrer le portefeuille</button><span class="small muted">${plural(scopeSirens().length, 'dossier')} dans mon portefeuille</span></div></div>
    <div class="card"><label class="f">Seuils d’alerte des hausses</label>
      <div class="help">Une hausse entre dans la liste de travail si elle dépasse les deux seuils.</div>
      <div class="inl"><span>Au moins</span><input type="number" id="sPct" min="0" step="1" value="${S.seuilPct}"><span>% et</span><input type="number" id="sEur" min="0" step="10" value="${S.seuilEur}"><span>€</span><button class="btn sm" id="saveSeuil">Enregistrer</button></div></div>
    <div class="card"><label class="f">Créances</label>
      <div class="help">Les soldes inférieurs à ce montant (reliquats de quelques centimes) restent visibles dans la fiche client mais n’entrent pas dans la liste de travail.</div>
      <div class="inl"><span>Ignorer les soldes inférieurs à</span><input type="number" id="sDette" min="0" step="1" value="${S.seuilDette ?? 5}"><span>€</span><button class="btn sm" id="saveDette">Enregistrer</button></div>
      <label class="inl" style="margin-top:10px;font-weight:400"><input type="checkbox" id="amrOn" ${S.amr !== false ? 'checked' : ''}> Lire aussi les documents à payer de « Payer › Dette fiscale » (avis de mise en recouvrement : pénalités, rappels). Lecture seule, aucun paiement.</label></div>
    <div class="card" id="mcpCard"><label class="f">Connexion à Claude (facultative)</label>
      <div class="help">Permet de poser des questions à Claude sur vos avis (« quels clients doivent payer avant le 15/12 ? », « prépare le message pour… ») depuis l’application Claude, grâce au connecteur Relève à installer dans Claude (<a href="https://releveavis.netlify.app/mode-emploi.html#claude" target="_blank">mode d’emploi</a>). Avec les noms masqués, Claude envoie ses réponses dans « Demander › Réponses de Claude », où les vrais noms sont remis sur ce poste.</div>
      <div class="warnbox" style="background:var(--warn-bg);color:#6B4500;padding:10px 12px;border-radius:9px;font-size:13px;margin:6px 0 10px">Quand cette connexion est active, les informations demandées par Claude (noms, montants, situation fiscale des clients) lui sont transmises pour produire ses réponses : elles quittent alors le poste. À n’activer qu’avec un compte Claude du cabinet et dans le respect de votre charte IA et du secret professionnel.</div>
      <label class="inl" style="font-weight:400"><input type="checkbox" id="mcpOn" ${A.S.mcp ? 'checked' : ''}> Activer la connexion à Claude sur ce poste</label>
      <label class="inl" style="font-weight:400;margin-top:6px"><input type="checkbox" id="mcpAnon" ${A.S.mcpAnon ? 'checked' : ''}> Masquer les noms et SIREN des clients (Claude voit « Client 4F2A »)</label>
      <div class="small" id="mcpState" style="margin-top:8px"></div></div>
    <div class="card"><label class="f">Alertes et bandeau</label>
      <label class="inl" style="font-weight:400"><input type="checkbox" id="notifOn" ${A.S.notif !== false ? 'checked' : ''}> Me prévenir par une notification : échéance dans 7 jours et la veille, avis de solde de CFE attendus, fin d’une longue mise à jour</label>
      <label class="inl" style="font-weight:400;margin-top:6px"><input type="checkbox" id="bannerOn" ${A.S.banner !== false ? 'checked' : ''}> Afficher un bandeau sur impots.gouv quand le dossier consulté a des actions en attente</label></div>
    <div class="card"><label class="f">Signature des messages</label>
      <textarea id="sig" placeholder="Prénom Nom&#10;Cabinet …&#10;Téléphone">${esc(S.signature || '')}</textarea>
      <div class="inl" style="margin-top:8px"><button class="btn sm" id="saveSig">Enregistrer</button></div></div>
    <div class="card"><label class="f">Rythme de lecture</label>
      <div class="help">Pause entre deux dossiers. 60 ms par défaut ; augmentez si le site des impôts répond mal.</div>
      <div class="inl"><input type="number" id="delai" min="80" max="2000" step="20" value="${S.delai}"><span>ms</span><button class="btn sm" id="saveDelai">Enregistrer</button></div></div>
    <div class="card"><label class="f">À propos</label>
      <div class="help">Relève ${esc(chrome.runtime.getManifest().version)} · créé par ${auteurLien()}, ${AUTEUR.titre} dans le Var.</div>
      <div class="help">Outil indépendant, non affilié à la DGFiP. Code source ouvert sous licence EUPL 1.2 : <a href="https://github.com/rfroment85/releve" target="_blank" rel="noopener">github.com/rfroment85/releve</a>. Seule la version téléchargée sur <a href="https://releveavis.netlify.app/" target="_blank" rel="noopener">releveavis.netlify.app</a> est la version officielle.</div></div>
    <div class="card" id="saveCard"><label class="f">Sauvegarde</label>
      <div class="help">Enregistre dans un fichier ce qui ne peut pas être relu sur impots.gouv : actions faites ou reportées, notes, réglages, fichier des dossiers, chiffres d’affaires, réponses de Claude, suivi des demandes d’accès. À faire de temps en temps, et toujours avant de changer de poste ou de réinstaller l’extension.</div>
      <div class="help" id="saveInfo">${A.backupAt ? `Dernière sauvegarde : ${ago(A.backupAt)}` : 'Aucune sauvegarde pour l’instant.'}</div>
      <div class="inl"><button class="btn primary sm" id="bkSave">${IC.down} Sauvegarder mes données</button><button class="btn sm" id="bkLoad">Restaurer une sauvegarde…</button><input type="file" id="bkFile" accept=".json,application/json" hidden></div></div>
    <div class="card"><label class="f">Données sur ce poste</label>
      <div class="help" id="usage">${plural(A.data.avis.length, 'avis', 'avis')} · ${plural(A.data.avis.filter((a) => a.hasPdf).length, 'PDF')} · ${plural(A.data.dettes.length, 'situation fiscale', 'situations fiscales')} · ${plural(A.data.runs.length, 'mise à jour', 'mises à jour')}</div>
      <div class="help">Version ${esc(chrome.runtime.getManifest().version)} · <a href="https://releveavis.netlify.app/mode-emploi.html" target="_blank">mode d’emploi</a></div>
      <div class="help">Tout est stocké dans le navigateur de ce poste, rien n’est envoyé à un serveur. Désinstaller l’extension efface ces données.</div>
      <button class="btn" id="wipe">${IC.trash} Effacer toutes les données</button></div>
  </div>`;
}
const caCount = () => Object.keys(A.data.ca || {}).length;
const caRefCount = () => Object.values(A.data.ca || {}).filter((o) => (o.exos || []).some((e) => String(e.cloture).slice(-4) === String(ACA.anneeCampagne() - 2))).length;
function bindReglages() {
  $('#fCa').onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      const map = parseCa(await fileToText(f)), n = Object.keys(map).length;
      if (!n) { toast('Aucun SIREN reconnu dans ce fichier'); return; }
      const all = { ...(A.data.ca || {}) };
      for (const [k, v] of Object.entries(map)) { const o = all[k] || { exos: [], creation: '' }; const keep = o.exos.filter((e) => !v.exos.some((x) => x.cloture === e.cloture)); all[k] = { exos: [...keep, ...v.exos], creation: v.creation || o.creation }; }
      await ACDB.put('meta', { key: 'ca', data: all }); A.data.ca = all; compute(); render();
      toast(`${plural(n, 'client')} importé${n > 1 ? 's' : ''} · ${plural(caRefCount(), 'exercice')} clos en ${ACA.anneeCampagne() - 2}`);
    } catch (e) { toast('Import impossible : ' + e.message); }
  };
  const cc2 = $('#clrCa'); if (cc2) cc2.onclick = async () => { await ACDB.del('meta', 'ca'); A.data.ca = {}; compute(); render(); toast('Chiffres d’affaires retirés'); };
  $('#caModele').onclick = (ev) => { ev.preventDefault(); const y = ACA.anneeCampagne() - 2; download(new TextEncoder().encode('\ufeffSIREN;Date de clôture;Durée (mois);Chiffre d’affaires HT;Date de création\r\n123456789;31/12/' + y + ';12;186450;15/03/2015\r\n'), 'Modele_chiffres_affaires.csv', 'text/csv'); };
  const save = async (patch, msg = 'Enregistré') => { A.S = await ACDB.saveSettings(patch); A.data.settings = A.S; compute(); render(); toast(msg); };
  navigator.storage && navigator.storage.estimate && navigator.storage.estimate().then((e) => { const u = $('#usage'); if (u) u.textContent += ` · ${(e.usage / 1048576).toFixed(0)} Mo utilisés`; });
  $('#fCorr').onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    const map = parseCorrespondance(await fileToText(f)), n = Object.keys(map).length;
    if (!n) { toast('Aucun SIREN reconnu dans ce fichier'); return; }
    save({ correspondance: map }, `${plural(n, 'dossier')} importé${n > 1 ? 's' : ''}`);
  };
  const cc = $('#clrCorr'); if (cc) cc.onclick = () => save({ correspondance: {}, moi: '' }, 'Fichier retiré');
  $('#moi').onchange = (ev) => save({ moi: ev.target.value }, ev.target.value ? `Portefeuille de ${ev.target.value}` : 'Enregistré');
  $('#savePort').onclick = () => { const l = [...new Set(($('#port').value.match(/\d[\d ]{8,16}/g) || []).map((x) => x.replace(/\D/g, '')).filter((x) => x.length === 9 || x.length === 14).map((x) => x.slice(0, 9)))]; save({ portefeuille: l }, `${plural(l.length, 'SIREN')} enregistré${l.length > 1 ? 's' : ''}`); };
  $('#saveSeuil').onclick = () => save({ seuilPct: Math.max(0, +$('#sPct').value || 0), seuilEur: Math.max(0, +$('#sEur').value || 0) });
  const showMcp = (st) => { const e = $('#mcpState'); if (!e) return; const lib = { connecte: '<span class="pill ok"><span class="dot"></span>Connecté à Claude</span>', connexion: '<span class="pill">Connexion…</span>', deconnecte: '<span class="pill warn"><span class="dot"></span>Connecteur Claude introuvable</span> <span class="tiny muted">Installez le connecteur dans l’application Claude et laissez-la ouverte ; nouvel essai chaque minute.</span>', off: '<span class="pill">Désactivée</span>' }; e.innerHTML = lib[st && st.state] || ''; };
  chrome.runtime.sendMessage({ type: 'ac:mcpStatus' }).then(showMcp).catch(() => {});
  A.showMcp = showMcp;
  $('#mcpOn').onchange = async (ev) => {
    const on = ev.target.checked;
    if (on && !A.mcpConfirm) { A.mcpConfirm = true; }
    A.S = await ACDB.saveSettings({ mcp: on }); A.data.settings = A.S;
    showMcp(await chrome.runtime.sendMessage({ type: 'ac:mcpToggle', on }).catch(() => null));
    toast(on ? 'Connexion à Claude activée sur ce poste' : 'Connexion à Claude désactivée');
  };
  $('#mcpAnon').onchange = async (ev) => { A.S = await ACDB.saveSettings({ mcpAnon: ev.target.checked }); A.data.settings = A.S; toast(ev.target.checked ? 'Noms et SIREN masqués pour Claude' : 'Noms visibles par Claude'); };
  $('#notifOn').onchange = (ev) => save({ notif: ev.target.checked });
  $('#bannerOn').onchange = (ev) => save({ banner: ev.target.checked });
  $('#saveDette').onclick = () => save({ seuilDette: Math.max(0, +$('#sDette').value || 0) });
  $('#amrOn').onchange = (ev) => save({ amr: ev.target.checked }, ev.target.checked ? 'Documents à payer : lus à la prochaine mise à jour' : 'Documents à payer : non lus');
  $('#saveSig').onclick = () => save({ signature: $('#sig').value.trim() });
  $('#saveDelai').onclick = () => save({ delai: Math.min(2000, Math.max(80, +$('#delai').value || 120)) });
  $('#bkSave').onclick = sauvegarder;
  $('#bkLoad').onclick = () => $('#bkFile').click();
  $('#bkFile').onchange = (ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) lireSauvegarde(f); };
  const w = $('#wipe');
  w.onclick = async () => {
    if (!w.dataset.armed) { w.dataset.armed = '1'; w.classList.add('primary'); w.textContent = 'Cliquez à nouveau pour tout effacer'; setTimeout(() => { if (w.isConnected) { delete w.dataset.armed; w.classList.remove('primary'); w.innerHTML = `${IC.trash} Effacer toutes les données`; } }, 5000); return; }
    for (const s of ['avis', 'pdfs', 'dossiers', 'dettes', 'tasks', 'runs']) await ACDB.clear(s);
    await ACDB.del('meta', 'dossierList');
    await load(); render(); chrome.runtime.sendMessage({ type: 'ac:refreshBadge' }).catch(() => {}); chrome.runtime.sendMessage({ type: 'ac:resetState' }).catch(() => {});
    toast('Données effacées (les réglages sont conservés)');
  };
}

// ======================================================================
// Bienvenue
// ======================================================================
function pageBienvenue() {
  return `<div class="welcome"><span class="logo" style="width:44px;height:44px;border-radius:12px">${IC.logo}</span>
  <h1 style="margin-top:14px">Bienvenue dans Relève</h1>
  <p class="lead" style="margin-top:8px">Les avis de taxe foncière et de CFE de tous vos clients, lus dans votre espace professionnel impots.gouv, analysés et rangés par urgence.</p>
  <div class="steps">
    <div class="step card"><div><b>Épinglez l’icône</b><div class="muted small">Cliquez sur l’icône puzzle à droite de la barre d’adresse, puis sur la punaise à côté de Relève.</div></div></div>
    <div class="step card"><div><b>Connectez-vous à votre espace professionnel impots.gouv</b><div class="muted small">Comme d’habitude : vous saisissez vous-même vos identifiants, l’extension ne les voit jamais.</div></div></div>
    <div class="step card"><div><b>Cliquez sur l’icône, puis sur « Mettre à jour mes clients »</b><div class="muted small">La première fois prend quelques dizaines de minutes pour un gros cabinet ; ensuite seuls les nouveaux avis sont lus.</div></div></div>
  </div>
  <div class="card av"><h3>${IC.shield} Confidentialité</h3><p class="small" style="margin:0;color:var(--ink2)">Relève lit uniquement les pages « avis de CFE », « avis de taxe foncière », « situation de la dette fiscale » et, à votre demande, la liste de vos habilitations. Il ne paie rien, n’envoie aucun message, ne modifie rien sur le site. Les avis et analyses restent dans le navigateur de ce poste ; aucun serveur ne les reçoit.</p></div>
  <div style="display:flex;gap:8px"><a class="btn primary" href="https://cfspro.impots.gouv.fr/mire/accueil.do" target="_blank">${IC.ext} Ouvrir mon espace professionnel</a><a class="btn" href="#reglages">Réglages facultatifs</a></div></div>
  <p class="tiny muted" style="margin-top:18px">Relève est créé par ${auteurLien()}, ${AUTEUR.titre}. Code source ouvert (EUPL 1.2).</p>`;
}

// ======================================================================
// Synthèse imprimable
// ======================================================================
function pageSynthese() {
  const open = openTasks(), C = A.c, P = A.coll.P;
  const hausses = C.N.filter((a) => a.n1 && a.d.delta > 0.5).sort((a, b) => b.d.delta - a.d.delta).slice(0, 10);
  const dette = C.dettes.filter((r) => r.solde >= C.seuilDette && ACA.dkey(r.dateLimite) < ACA.dkey(new Date().toLocaleDateString('fr-FR'))).reduce((s, r) => s + r.solde, 0) + C.amr.filter((r) => r.montant >= C.seuilDette).reduce((s, r) => s + r.montant, 0);
  return `<div class="noprint" style="display:flex;gap:8px;margin-bottom:14px"><a class="btn" href="#a-traiter">${IC.arrowL} Retour</a><button class="btn primary" id="printBtn">${IC.print} Imprimer ou enregistrer en PDF</button></div>
  <div class="synth"><div class="tiny muted">${scopeMoi() ? 'Mon portefeuille' : 'Tout le cabinet'} · ${new Date().toLocaleDateString('fr-FR')} · Relève</div>
  <h1>Campagne taxe foncière et CFE ${C.annee}</h1>
  <div class="kpis" style="margin-top:16px">
    <div class="card"><div class="l">Avis ${C.annee}</div><div class="v num">${C.N.length}</div><div class="l">${plural(new Set(C.N.map((a) => a.siren)).size, 'client')}</div></div>
    <div class="card"><div class="l">Évolution à périmètre comparable</div><div class="v num">${C.tot.n1 ? pcv((C.tot.n / C.tot.n1 - 1) * 100) : '—'}</div><div class="l num">${eur(C.tot.n1)} → ${eur(C.tot.n)}</div></div>
    <div class="card"><div class="l">Actions ouvertes</div><div class="v num">${open.length}</div><div class="l">${C.CATS.map((k) => { const n = open.filter((t) => t.cat === k.key).length; return n ? `${n} ${k.titre.toLowerCase()}` : ''; }).filter(Boolean).slice(0, 2).join(' · ')}</div></div>
    <div class="card"><div class="l">Créances échues</div><div class="v num">${eur(dette)}</div><div class="l">dettes fiscales et AMR à payer</div></div>
  </div>
  <h2>Actions par catégorie</h2><table class="t"><tbody>${C.CATS.map((k) => { const n = open.filter((t) => t.cat === k.key); return `<tr><td><b>${esc(k.titre)}</b><div class="tiny muted">${esc(k.aide)}</div></td><td class="r num">${n.length}</td><td class="r num">${eur(n.reduce((s, t) => s + (t.montant || 0), 0))}</td></tr>`; }).join('')}</tbody></table>
  ${P.avis ? `<h2 style="margin-top:20px">Taxe foncière : origine de l’évolution</h2><p>${eur(P.cN1)} → ${eur(P.cN)} (${sgn(P.cN - P.cN1)}) : taux votés ${sgn(P.taux)}, bases ${sgn(P.bases)}, biens nouvellement imposés ${sgn(P.nouveaux)}.</p>
  ${A.coll.decisions.length ? `<table class="t"><thead><tr><th>Décision</th><th>Communes</th><th class="r">Impact</th></tr></thead><tbody>${A.coll.decisions.slice(0, 6).map((x) => `<tr><td>${esc(x.nom)} : ${esc(x.tN1)} % → ${esc(x.tN)} %</td><td class="small">${esc(x.communes.slice(0, 4).join(', '))}${x.communes.length > 4 ? '…' : ''}</td><td class="r num">${sgn(x.eff)}</td></tr>`).join('')}</tbody></table>` : ''}` : ''}
  ${hausses.length ? `<h2 style="margin-top:20px">Plus fortes hausses</h2><table class="t"><thead><tr><th>Client</th><th>Avis</th><th class="r">${C.anneeN1}</th><th class="r">${C.annee}</th><th class="r">Écart</th><th>Analyse</th></tr></thead><tbody>${hausses.map((a) => `<tr><td><b>${esc(a.nom)}</b></td><td class="small">${TAXE_LABEL[a.taxe]} ${esc(a.commune || '')}</td><td class="r num">${eur(a.n1.m)}</td><td class="r num">${eur(a.m)}</td><td class="r num up">${sgn(a.d.delta)}</td><td class="tiny">${esc((a.d.verdict || '').length > 150 ? a.d.verdict.slice(0, 150).replace(/\s+\S*$/, '') + '…' : (a.d.verdict || ''))}</td></tr>`).join('')}</tbody></table>` : ''}
  </div>`;
}

// ======================================================================
// Demander : questions prêtes et filtres (résultats exacts, sans IA), réponses de Claude avec les vrais noms
// ======================================================================
A.f = { ...ACR.F0 }; A.claude = [];
const QUOI = [['actions', 'Actions à traiter'], ['hausses', 'Hausses d’impôt'], ['baisses', 'Baisses d’impôt'], ['clients', 'Clients'], ['bilan', 'Bilan de la campagne']];
const TRIS = { actions: [['', 'Urgence'], ['montant', 'Montant'], ['echeance', 'Échéance']], hausses: [['euros', 'Écart en euros'], ['pct', 'Écart en %']], baisses: [['euros', 'Écart en euros'], ['pct', 'Écart en %']], clients: [['montant', 'Montant d’impôt'], ['euros', 'Hausse en euros'], ['pct', 'Hausse en %']] };
async function loadClaude() { const r = await ACDB.get('meta', 'claude'); A.claude = (r && r.list) || []; }
function annuaireLocal() { return ACR.annuaire([...A.data.avis.map((a) => [a.siren, a.nom]), ...A.data.dossiers.map((d) => [d.siren, d.nom])]); }
function pageDemander(arg) {
  const onglet = arg === 'claude' ? 'claude' : 'questions';
  return `<div class="ph"><div><h1>Demander</h1><div class="sub">${onglet === 'claude' ? 'Les réponses que Claude vous envoie, avec les vrais noms de vos clients.' : 'Choisissez une question ou réglez les filtres : la réponse vient des avis lus sur ce poste.'}</div></div>
    <div class="r"><div class="seg"><a class="${onglet === 'questions' ? 'on' : ''}" href="#demander">Questions</a><a class="${onglet === 'claude' ? 'on' : ''}" href="#demander/claude">Réponses de Claude${A.claude.length ? ` (${A.claude.length})` : ''}</a></div></div></div>
    ${onglet === 'claude' ? pageClaude() : pageQuestions()}`;
}
function pageQuestions() {
  const f = A.f, communes = [...new Set(A.c.avis.map((a) => a.commune).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'fr'));
  const collabs = [...new Set(Object.values(A.S.correspondance || {}).map((v) => v.collaborateur).filter(Boolean))].sort();
  const sel = (id, opts, v, lib) => `<label class="flt"><span>${lib}</span><select id="${id}">${opts.map(([k, t]) => `<option value="${esc(k)}"${String(v) === String(k) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  const actif = ACR.QUESTIONS.findIndex((q) => JSON.stringify({ ...ACR.F0, ...q.f }) === JSON.stringify(f));
  const r = ACR.executer(f, donneesRecherche());
  return `<div class="chips">${ACR.QUESTIONS.map((q, i) => `<a class="chip${i === actif ? ' on' : ''}" href="#" data-q="${i}">${esc(q.lib)}</a>`).join('')}</div>
  <div class="card filtres">
    ${sel('fQuoi', QUOI, f.quoi, 'Afficher')}
    ${f.quoi === 'actions' ? sel('fCat', [['', 'Toutes'], ...A.c.CATS.map((k) => [k.key, k.titre])], f.categorie, 'Catégorie') : ''}
    ${f.quoi !== 'bilan' ? sel('fTaxe', [['', 'Les deux'], ['TF', 'Taxe foncière'], ['CFE', 'CFE']], f.taxe, 'Taxe') : ''}
    ${f.quoi !== 'bilan' ? sel('fCom', [['', 'Toutes'], ...communes.map((c) => [c, c])], f.commune, 'Commune') : ''}
    ${collabs.length ? sel('fCol', [['', 'Tous'], ...collabs.map((c) => [c, c])], f.collaborateur, 'Collaborateur') : ''}
    ${f.quoi === 'actions' ? sel('fJours', [['0', 'Toutes'], ['7', 'Sous 7 jours'], ['15', 'Sous 15 jours'], ['31', 'Sous un mois']], f.jours, 'Échéance') : ''}
    ${f.quoi !== 'bilan' ? `<label class="flt"><span>Montant mini</span><input id="fMin" type="number" min="0" step="50" value="${f.min || ''}" placeholder="0 €"></label>` : ''}
    ${TRIS[f.quoi] ? sel('fTri', TRIS[f.quoi], f.tri || TRIS[f.quoi][0][0], 'Trier par') : ''}
    <button class="btn sm ghost" id="fReset" type="button">Effacer les filtres</button>
  </div>
  <div class="card rep" id="res"><p class="small" style="margin:0 0 10px"><b>${esc(r.texte)}</b></p>${resultatHtml(r.bloc)}</div>`;
}
function resultatHtml(b) {
  const lim = 100, plus = b.items.length > lim ? `<div class="more">${lim} premiers résultats affichés : affinez avec les filtres.</div>` : '';
  if (b.kind === 'taches') return b.items.length ? `<div class="card items" style="box-shadow:none">${b.items.slice(0, lim).map(itemHtml).join('')}</div>${plus}` : '';
  if (b.kind === 'cats') return `<table class="t"><tbody>${b.items.map((x) => `<tr class="click" data-href="a-traiter/${x.cat}"><td><b>${esc(x.titre)}</b></td><td class="r num">${x.n}</td><td class="r num">${eur(x.montant)}</td></tr>`).join('')}</tbody></table>`;
  if (b.kind === 'hausses') return b.items.length ? `<table class="t"><thead><tr><th>Client</th><th>Avis</th><th class="r">${A.c.anneeN1}</th><th class="r">${A.c.annee}</th><th class="r">Écart</th><th>Origine</th></tr></thead><tbody>${b.items.slice(0, lim).map((a) => `<tr class="click" data-href="client/${a.siren}"><td><b>${esc(a.nom)}</b></td><td class="small">${TAXE_LABEL[a.taxe]} ${esc(a.commune || '')}</td><td class="r num">${eur(a.n1.m)}</td><td class="r num">${eur(a.m)}</td><td class="r num ${a.d.delta > 0 ? 'up' : 'dn'}">${sgn(a.d.delta)}<div class="tiny muted">${pcv(a.d.pct)}</div></td><td class="tiny">${esc(origine(a))}</td></tr>`).join('')}</tbody></table>${plus}` : '';
  if (b.kind === 'clients') return `<table class="t"><thead><tr><th>Client</th><th class="r">Taxe foncière</th><th class="r">CFE</th><th class="r">Évolution</th><th>Paiement</th></tr></thead><tbody>${b.items.slice(0, lim).map((o) => `<tr class="click" data-href="client/${o.siren}"><td><b>${esc(o.nom)}</b><div class="tiny muted">${esc([...o.communes].slice(0, 3).join(', '))}</div></td><td class="r num">${o.tf ? eur(o.tf) : '—'}</td><td class="r num">${o.cfe ? eur(o.cfe) : '—'}</td><td class="r num ${o.evo > 0.5 ? 'up' : o.evo < -0.5 ? 'dn' : ''}">${o.evo === null ? '—' : pcv(o.evo)}</td><td>${MODE_PILL[o.mode]}</td></tr>`).join('')}</tbody></table>${plus}`;
  return '';
}
function origine(a) { const v = a.d.verdict || ''; return v.length > 140 ? v.slice(0, 140).replace(/\s+\S*$/, '') + '…' : v; }
function donneesRecherche() { return { taches: openTasks(), N: A.c.N, clients: clientsAgg(), CATS: A.c.CATS, tot: A.c.tot, annee: A.c.annee }; }
function pageClaude() {
  const ann = annuaireLocal();
  const etapes = `<ol class="howto"><li><b>Dans Claude</b>, posez votre question sur Relève (noms masqués : Claude ne voit que « Client 4F2A »).</li><li><b>Claude envoie sa réponse ici</b> : cette page s’ouvre toute seule.</li><li><b>Vous lisez la réponse avec les vrais noms</b>, remis sur ce poste. Cliquez un nom pour ouvrir la fiche du client.</li></ol>`;
  const coller = `<details class="coller"><summary>Coller une réponse de Claude</summary><p class="tiny muted">Si Claude ne l’a pas envoyée lui-même : copiez sa réponse, collez-la ici.</p><textarea id="cTxt" rows="5" placeholder="Collez ici le texte de Claude"></textarea><button class="btn sm primary" id="cGo" type="button">Afficher avec les vrais noms</button></details>`;
  if (!A.claude.length) return `<div class="card rep"><h3>Comment ça marche</h3>${etapes}<p class="small muted">${A.S.mcp ? (A.S.mcpAnon ? 'Connexion à Claude activée, noms masqués.' : 'Connexion à Claude activée. Conseil : cochez « Masquer les noms et SIREN » dans Réglages.') : 'La connexion à Claude est désactivée : activez-la dans <a href="#reglages">Réglages</a>.'}</p>${coller}</div>`;
  return `${coller}${A.claude.map((x, i) => { const r = ACR.rendre(x.texte, ann);
    return `<div class="card rep claude"><div class="rh"><b>${esc(x.titre || 'Réponse de Claude')}</b><span class="tiny muted">${ago(x.at)}${r.clients.length ? ` · ${plural(r.clients.length, 'client cité', 'clients cités')}` : ''}</span><a href="#" class="tiny" data-cdel="${i}">Effacer</a></div><div class="md">${r.html}</div></div>`; }).join('')}
    <details class="coller"><summary>Comment ça marche</summary>${etapes}</details>`;
}
async function saveClaude() { await ACDB.put('meta', { key: 'claude', list: A.claude }); }
function bindDemander(arg) {
  $$('[data-q]').forEach((a) => a.onclick = (ev) => { ev.preventDefault(); A.f = { ...ACR.F0, ...ACR.QUESTIONS[+a.dataset.q].f }; page(); });
  const on = (id, k, conv = (x) => x) => { const e = $('#' + id); if (e) e.onchange = () => { A.f = { ...A.f, [k]: conv(e.value) }; if (k === 'quoi') A.f = { ...ACR.F0, quoi: e.value, collaborateur: A.f.collaborateur }; page(); }; };
  on('fQuoi', 'quoi'); on('fCat', 'categorie'); on('fTaxe', 'taxe'); on('fCom', 'commune'); on('fCol', 'collaborateur'); on('fJours', 'jours', Number); on('fMin', 'min', (v) => Math.max(0, Number(v) || 0)); on('fTri', 'tri');
  const rs = $('#fReset'); if (rs) rs.onclick = () => { A.f = { ...ACR.F0 }; page(); };
  $$('#page tr[data-href]').forEach((tr) => tr.onclick = () => { location.hash = tr.dataset.href; });
  bindItems($('#page'));
  $$('[data-cdel]').forEach((a) => a.onclick = async (ev) => { ev.preventDefault(); const i = +a.dataset.cdel, x = A.claude[i]; A.claude.splice(i, 1); await saveClaude(); page(); toast('Réponse effacée', async () => { A.claude.splice(i, 0, x); await saveClaude(); page(); }); });
  const cg = $('#cGo'); if (cg) cg.onclick = async () => { const t = $('#cTxt').value.trim(); if (!t) return; A.claude.unshift({ at: Date.now(), titre: 'Réponse collée', texte: t }); A.claude = A.claude.slice(0, 30); await saveClaude(); page(); };
}


// ======================================================================
// Habilitations (lecture seule de « Gérer mon espace › Consulter mes services ») et clients à raccorder
// ======================================================================
A.hf = { q: '', service: '', role: '', etat: '1', collab: '', mode: 'avec' }; A.rf = { q: '', collab: '', statut: '' }; A.rsel = new Set();
const ROLE_LIB = { AT: 'Titulaire', AS: 'Suppléant', N1: 'Délégant', N2: 'Acteur' }, ETAT_LIB = { 1: 'Actif', 2: 'En veille', 3: 'Supprimé' };
const SERVICE_CLE = 'Consulter le Compte fiscal';
function nomDe(siren) {
  const c = (A.S.correspondance || {})[siren] || {};
  return (A.habil && A.habil.noms && A.habil.noms[siren]) || (A.dossierList.find((d) => d.siren === siren) || {}).nom || (A.data.avis.find((a) => a.siren === siren) || {}).nom || c.nom || '';
}
// SIREN raccordés (au moins un service actif) et SIREN dont le compte fiscal est consultable
function etatRaccord() {
  const base = new Set(), cf = new Set();
  if (A.habil) { const icf = A.habil.services.indexOf(SERVICE_CLE); for (const [s, i, , e] of A.habil.rows) if (e === 1) { base.add(s); if (i === icf) cf.add(s); } }
  else for (const d of A.dossierList) { base.add(d.siren); cf.add(d.siren); }
  return { base, cf, source: A.habil ? 'habilitations' : (A.dossierList.length ? 'liste des dossiers' : '') };
}
function clientsARaccorder() {
  const corr = A.S.correspondance || {}, { base, cf } = etatRaccord(), now = Date.now(), out = [];
  for (const [siren, c] of Object.entries(corr)) {
    const r = A.raccord[siren] || {};
    const manque = !base.has(siren) ? 'absent' : !cf.has(siren) ? 'compte fiscal' : '';
    if (!manque && !r.demandeAt) continue;
    const statut = !manque ? 'raccorde' : r.ignore ? 'ignore' : !r.demandeAt ? 'a-demander' : now - (r.relanceAt || r.demandeAt) > 7 * 864e5 ? 'relancer' : 'demande';
    out.push({ siren, nom: c.nom || nomDe(siren), code: c.code || '', collab: c.collaborateur || '', email: c.email || '', manque, statut, r });
  }
  const ordre = { relancer: 0, 'a-demander': 1, demande: 2, raccorde: 3, ignore: 4 };
  return out.sort((a, b) => ordre[a.statut] - ordre[b.statut] || a.nom.localeCompare(b.nom, 'fr'));
}
// Un client demandé qui apparaît désormais dans l'espace : « raccordé », daté une fois
async function noterRaccordes() {
  const { base, cf } = etatRaccord(); let chg = false;
  for (const [siren, r] of Object.entries(A.raccord)) if (r.demandeAt && !r.raccordeAt && base.has(siren) && cf.has(siren)) { r.raccordeAt = Date.now(); chg = true; }
  if (chg) await ACDB.put('meta', { key: 'raccord', data: A.raccord });
}
async function majRaccord(sirens, patch) {
  for (const s of sirens) { A.raccord[s] = { ...(A.raccord[s] || {}), ...patch }; if (patch === null) delete A.raccord[s]; }
  await ACDB.put('meta', { key: 'raccord', data: A.raccord });
}
const STATUT_PILL = { 'a-demander': '<span class="pill">À demander</span>', demande: (r) => `<span class="pill">Demandé le ${new Date(r.demandeAt).toLocaleDateString('fr-FR')}</span>`, relancer: (r) => `<span class="pill acc">À relancer · demandé il y a ${Math.round((Date.now() - r.demandeAt) / 864e5)} j</span>`, raccorde: (r) => `<span class="pill ok">Raccordé${r.raccordeAt ? ' le ' + new Date(r.raccordeAt).toLocaleDateString('fr-FR') : ''}</span>`, ignore: '<span class="pill">Ignoré</span>' };
const pill = (x) => { const p = STATUT_PILL[x.statut]; return typeof p === 'function' ? p(x.r) : p; };

function pageHabil(arg) {
  const onglet = arg === 'raccorder' ? 'raccorder' : 'liste';
  const nR = clientsARaccorder().filter((x) => ['a-demander', 'relancer'].includes(x.statut)).length;
  return `<div class="ph"><div><h1>Habilitations</h1><div class="sub">${onglet === 'raccorder' ? 'Clients du cabinet absents de votre espace professionnel, et suivi des demandes d’accès.' : 'Les services auxquels votre compte a accès, dossier par dossier. Lecture seule : rien n’est modifié sur le site.'}</div></div>
    <div class="r"><div class="seg"><a class="${onglet === 'liste' ? 'on' : ''}" href="#habilitations">Habilitations</a><a class="${onglet === 'raccorder' ? 'on' : ''}" href="#habilitations/raccorder">Clients à raccorder${nR ? ` (${nR})` : ''}</a></div></div></div>
    <div id="habStep" class="small muted" style="margin:-6px 0 12px;min-height:18px">${A.habRun ? esc(A.habRun) : ''}</div>
    ${onglet === 'raccorder' ? pageRaccorder() : pageHabListe()}`;
}
// Dossiers de référence : tous ceux où le compte a au moins un service actif, plus ceux du fichier des dossiers
function universHabil() {
  const u = new Set(); for (const [s, , , e] of A.habil.rows) if (e === 1) u.add(s);
  for (const s of Object.keys(A.S.correspondance || {})) u.add(s);
  return u;
}
// Dossiers SANS un service donné (actif) : jamais attribué, supprimé ou en veille
function sansService(iS) {
  const etat = new Map(); for (const [s, i, , e] of A.habil.rows) if (i === iS) { const p = etat.get(s); if (!p || e < p) etat.set(s, e); }
  const autres = new Map(); for (const [s, , , e] of A.habil.rows) if (e === 1) autres.set(s, (autres.get(s) || 0) + 1);
  return [...universHabil()].filter((s) => etat.get(s) !== 1).map((s) => ({ siren: s, etat: etat.get(s) || 0, autres: autres.get(s) || 0 }));
}
// Ce qui est affiché avec les filtres en cours (sert aussi à l'export de la sélection)
function habVue() {
  const H = A.habil, f = A.hf, corr = A.S.correspondance || {};
  const iS = f.service === '' ? -1 : +f.service;
  const sansMode = f.mode === 'sans' && iS >= 0;
  const q = f.q.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const okQ = (t) => !q || t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q);
  if (sansMode) {
    let l = sansService(iS).map((x) => ({ ...x, nom: nomDe(x.siren), code: (corr[x.siren] || {}).code || '', collab: (corr[x.siren] || {}).collaborateur || '' }));
    l = l.filter((x) => (!f.collab || x.collab === f.collab) && okQ(x.nom + ' ' + x.siren + ' ' + x.code + ' ' + x.collab));
    l.sort((a, b) => (a.nom || 'zz').localeCompare(b.nom || 'zz', 'fr'));
    return { iS, sansMode, q, sans: l, dossiers: [], nLignes: 0 };
  }
  const okRow = ([s, i, r, e]) => (iS < 0 || i === iS) && (!f.role || r === f.role) && (!f.etat || e === +f.etat) && (!f.collab || (corr[s] || {}).collaborateur === f.collab);
  const parSiren = new Map();
  for (const row of H.rows) { if (!okRow(row)) continue; let o = parSiren.get(row[0]); if (!o) { o = []; parSiren.set(row[0], o); } o.push(row); }
  let dossiers = [...parSiren.entries()].map(([s, l]) => ({ siren: s, nom: nomDe(s), code: (corr[s] || {}).code || '', collab: (corr[s] || {}).collaborateur || '', l }));
  dossiers = dossiers.filter((d) => okQ(d.nom + ' ' + d.siren + ' ' + d.code + ' ' + d.collab));
  dossiers.sort((a, b) => (a.nom || 'zz').localeCompare(b.nom || 'zz', 'fr'));
  return { iS, sansMode, q, dossiers, nLignes: dossiers.reduce((n, d) => n + d.l.length, 0), sans: null };
}
function habFiltresTexte() {
  const H = A.habil, f = A.hf, iS = f.service === '' ? -1 : +f.service, t = [];
  if (iS >= 0) t.push((f.mode === 'sans' ? 'sans « ' : 'service « ') + H.services[iS] + ' »');
  if (f.mode !== 'sans' || iS < 0) { if (f.role) t.push('rôle ' + ROLE_LIB[f.role]); if (f.etat) t.push('état ' + ETAT_LIB[f.etat]); }
  if (f.collab) t.push('collaborateur ' + f.collab); if (f.q.trim()) t.push('recherche « ' + f.q.trim() + ' »');
  return t.length ? t.join(' · ') : 'aucun filtre';
}
// Affichage de toute la liste sans bloquer l'écran : les 150 premières lignes tout de suite, la suite par paquets
function lignesProgressives(id, rows) { A.prog = A.prog || {}; A.prog[id] = rows.slice(150); return `<tbody id="${id}">${rows.slice(0, 150).join('')}</tbody>`; }
function runProg() {
  const all = A.prog || {}; A.prog = {}; const tok = (A.progTok = (A.progTok || 0) + 1);
  for (const [id, rest] of Object.entries(all)) {
    const tb = document.getElementById(id); if (!tb || !rest.length) continue;
    let i = 0; const step = () => { if (A.progTok !== tok || !tb.isConnected) return; tb.insertAdjacentHTML('beforeend', rest.slice(i, i + 250).join('')); i += 250; if (i < rest.length) setTimeout(step, 16); };
    setTimeout(step, 16);
  }
}
function pageHabListe() {
  const H = A.habil;
  if (!H) return `<div class="card rep"><h3>Lire les habilitations de votre espace</h3>
    <p class="small">Relève lit la page « Gérer mon espace › Consulter mes services » de l’espace professionnel ouvert et connecté : pour chaque dossier, les services accessibles, votre rôle (titulaire, suppléant, délégant, acteur) et leur état. Environ 30 secondes. Rien n’est modifié.</p>
    <p class="small muted">Ce sont les habilitations du compte connecté. À relire de temps en temps, par exemple une fois par mois.</p>
    <button class="btn primary" id="habGo">${IC.refresh} Lire mes habilitations</button></div>`;
  const f = A.hf, corr = A.S.correspondance || {};
  const collabs = [...new Set(Object.values(corr).map((v) => v.collaborateur).filter(Boolean))].sort();
  const { iS, sansMode, q, dossiers, nLignes, sans } = habVue();
  const tot = { 1: 0, 2: 0, 3: 0 }, roles = { AT: 0, AS: 0, N1: 0, N2: 0 }; for (const [, , r, e] of H.rows) { tot[e]++; if (e === 1 && roles[r] !== undefined) roles[r]++; }
  const parService = H.services.map((nom, i) => ({ nom, i, n: H.rows.filter((x) => x[1] === i && (!f.role || x[2] === f.role) && (!f.etat || x[3] === +f.etat) && (!f.collab || (corr[x[0]] || {}).collaborateur === f.collab)).length })).filter((x) => x.n).sort((a, b) => b.n - a.n);
  const sel = (id, opts, v, lib) => `<label class="flt"><span>${lib}</span><select id="${id}">${opts.map(([k, t]) => `<option value="${esc(k)}"${String(v) === String(k) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  return `<div class="card" style="padding:12px 14px;margin-bottom:12px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      <span class="small">Lu ${ago(H.at)} · <b>${plural(new Set(H.rows.map((x) => x[0])).size, 'dossier')}</b> · ${plural(tot[1], 'habilitation active', 'habilitations actives')}${tot[2] ? ` · ${tot[2]} en veille` : ''}${tot[3] ? ` · ${tot[3]} supprimées` : ''}</span>
      <span class="small muted">Rôles actifs : titulaire ${roles.AT} · suppléant ${roles.AS} · délégant ${roles.N1} · acteur ${roles.N2}</span>
      <span style="margin-left:auto;display:flex;gap:8px"><button class="btn sm" id="habGo">${IC.refresh} Actualiser</button><button class="btn sm" id="habXlsx" title="Toutes les habilitations, la matrice dossiers × services et les clients à raccorder">${IC.down} Tout exporter</button></span></div>
    <div class="card filtres">
      <label class="flt"><span>Rechercher</span><input id="hq" type="search" value="${esc(f.q)}" placeholder="Client, SIREN, code" style="width:180px"></label>
      ${sel('hService', [['', 'Tous les services'], ...H.services.map((x, i) => [i, x])], f.service, 'Service')}
      ${iS >= 0 ? sel('hMode', [['avec', 'Dossiers avec ce service'], ['sans', 'Dossiers SANS ce service']], f.mode, 'Afficher') : ''}
      ${sansMode ? '' : sel('hRole', [['', 'Tous'], ...Object.entries(ROLE_LIB)], f.role, 'Rôle')}
      ${sansMode ? '' : sel('hEtat', [['', 'Tous'], ['1', 'Actif'], ['2', 'En veille'], ['3', 'Supprimé']], f.etat, 'État')}
      ${collabs.length ? sel('hCollab', [['', 'Tous'], ...collabs.map((c) => [c, c])], f.collab, 'Collaborateur') : ''}
      <button class="btn sm ghost" id="hReset" type="button">Effacer les filtres</button></div>
    <div class="cols"><div class="card rep">${sansMode ? sansHtml(iS, sans, corr) : `
      <div class="selhead"><p class="small" style="margin:0"><b>${plural(dossiers.length, 'dossier')}</b> · ${plural(nLignes, 'habilitation')}</p>${dossiers.length ? `<button class="btn sm" id="habSelXlsx">${IC.down} Exporter la sélection</button>` : ''}</div>
      ${dossiers.length ? `<table class="t"><thead><tr><th>Client</th><th>Collaborateur</th><th>Services</th></tr></thead>${lignesProgressives('habBody', dossiers.map((d) => `<tr><td><b>${esc(d.nom || '—')}</b><div class="tiny muted">${fmtSiren(d.siren)}${d.code ? ' · ' + esc(d.code) : ''}</div></td><td class="small">${esc(d.collab)}</td><td>${d.l.map(([, i, r, e]) => `<span class="hchip e${e}" title="${esc(H.services[i])} · ${ROLE_LIB[r] || '?'} · ${ETAT_LIB[e]}">${esc(H.services[i])}<i>${ROLE_LIB[r] || ''}</i></span>`).join('')}</td></tr>`))}</table>` : '<div class="empty">Aucune habilitation avec ces filtres.</div>'}`}
    </div>
    <aside class="rail"><div class="card"><h3>Par service</h3><div class="tiny muted" style="margin:-4px 0 6px">avec / sans, sur ${plural(universHabil().size, 'dossier')}</div><table class="t"><tbody>${couverture().map((x) => `<tr><td class="small">${esc(x.nom)}</td><td class="r num"><a href="#" data-svc="${x.i}" data-mode="avec" title="Dossiers avec ce service">${x.avec}</a></td><td class="r num"><a href="#" data-svc="${x.i}" data-mode="sans" title="Dossiers sans ce service" style="color:var(--bad)">${x.sans}</a></td></tr>`).join('')}</tbody></table></div>
      <div class="card"><h3>Modifier une habilitation</h3><p class="small muted" style="margin:0 0 8px">Relève ne modifie rien. Sur impots.gouv : « Gérer mon espace », puis « Gérer mes délégations » ou « Gérer mes administrateurs suppléants ».</p><a class="btn sm" href="https://cfspro.impots.gouv.fr/mire/accueil.do" target="_blank">${IC.ext} Ouvrir impots.gouv</a></div></aside></div>`;
}
function couverture() {
  const H = A.habil, u = universHabil(), actif = H.services.map(() => new Set());
  for (const [s, i, , e] of H.rows) if (e === 1) actif[i].add(s);
  return H.services.map((nom, i) => ({ nom, i, avec: actif[i].size, sans: u.size - [...actif[i]].filter((s) => u.has(s)).length })).sort((a, b) => b.avec - a.avec);
}
function sansHtml(iS, l, corr) {
  const H = A.habil;
  const ETAT_SANS = { 0: 'Jamais attribué', 2: 'En veille', 3: 'Supprimé' };
  const n = (e) => l.filter((x) => x.etat === e).length;
  return `<div class="selhead"><p class="small" style="margin:0"><b>${plural(l.length, 'dossier')} sans « ${esc(H.services[iS])} »</b> · ${n(0)} jamais attribué${n(0) > 1 ? 's' : ''}${n(3) ? ` · ${n(3)} supprimé${n(3) > 1 ? 's' : ''}` : ''}${n(2) ? ` · ${n(2)} en veille` : ''}</p>${l.length ? `<button class="btn sm" id="habSelXlsx">${IC.down} Exporter la sélection</button>` : ''}</div>
    <p class="tiny muted" style="margin:0 0 10px">Parmi les dossiers où vous avez au moins un service actif${Object.keys(corr).length ? ', et ceux du fichier des dossiers' : ''}.</p>
    ${l.length ? `<table class="t"><thead><tr><th>Client</th><th>Collaborateur</th><th>Ce service</th><th class="r">Autres services actifs</th></tr></thead>${lignesProgressives('habBody', l.map((x) => `<tr><td><b>${esc(x.nom || '—')}</b><div class="tiny muted">${fmtSiren(x.siren)}${x.code ? ' · ' + esc(x.code) : ''}</div></td><td class="small">${esc(x.collab)}</td><td>${x.etat === 0 ? '<span class="pill">Jamais attribué</span>' : `<span class="pill acc">${ETAT_SANS[x.etat]}</span>`}</td><td class="r num">${x.autres || '<span class="muted">aucun</span>'}</td></tr>`))}</table>` : '<div class="empty">Tous les dossiers ont ce service.</div>'}`;
}
function pageRaccorder() {
  const corr = A.S.correspondance || {};
  if (!Object.keys(corr).length) return `<div class="card rep"><h3>Importez d’abord le fichier des dossiers du cabinet</h3><p class="small">Relève compare la liste de vos clients (export de votre logiciel comptable : SIREN, et si possible nom, e-mail et collaborateur) à votre espace professionnel, et liste ceux qui n’y sont pas.</p><a class="btn primary" href="#reglages">${IC.gear} Importer dans Réglages</a></div>`;
  const { source } = etatRaccord();
  if (!source) return `<div class="card rep"><h3>Lisez d’abord votre espace professionnel</h3><p class="small">Lancez une mise à jour depuis le volet, ou lisez vos habilitations (onglet Habilitations), pour que Relève sache quels dossiers sont déjà dans votre espace.</p></div>`;
  const all = clientsARaccorder(), f = A.rf;
  const collabs = [...new Set(all.map((x) => x.collab).filter(Boolean))].sort();
  const l = raccordVue(all);
  const cnt = (st) => all.filter((x) => x.statut === st).length;
  const sel = (id, opts, v, lib) => `<label class="flt"><span>${lib}</span><select id="${id}">${opts.map(([k, t]) => `<option value="${esc(k)}"${String(v) === String(k) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  return `<div class="card" style="padding:12px 14px;margin-bottom:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <span class="small"><b>${cnt('a-demander')}</b> à demander · <b>${cnt('relancer')}</b> à relancer · ${cnt('demande')} en attente · ${cnt('raccorde')} raccordés</span>
      <span class="small muted">Comparaison avec : ${source}${A.habil ? ` (lue ${ago(A.habil.at)})` : ''}</span>
      <label class="small" style="margin-left:auto;display:flex;gap:6px;align-items:center">N° d’abonné communiqué aux clients <input id="rAbonne" value="${esc(A.S.abonne || '')}" placeholder="à renseigner" style="width:130px;border:1px solid var(--line);border-radius:7px;padding:4px 7px"></label></div>
    <div class="card filtres">
      <label class="flt"><span>Rechercher</span><input id="rq" type="search" value="${esc(f.q)}" placeholder="Client, SIREN, code" style="width:180px"></label>
      ${sel('rStatut', [['', 'À traiter et suivis'], ['a-demander', 'À demander'], ['relancer', 'À relancer'], ['demande', 'Demandés'], ['raccorde', 'Raccordés'], ['ignore', 'Ignorés']], f.statut, 'Statut')}
      ${collabs.length ? sel('rCollab', [['', 'Tous'], ...collabs.map((c) => [c, c])], f.collab, 'Collaborateur') : ''}</div>
    ${A.rsel.size ? `<div class="selbar"><b>${plural(A.rsel.size, 'client sélectionné', 'clients sélectionnés')}</b><button class="btn sm primary" id="rBulkMail">${IC.mail} Préparer les messages</button><button class="btn sm" id="rBulkDone">${IC.check} Marquer demandé</button><button class="btn sm ghost" id="rBulkClear">Désélectionner</button></div>` : ''}
    <div class="card rep">${l.length ? `<div class="selhead"><p class="small" style="margin:0"><b>${plural(l.length, 'client')}</b></p><button class="btn sm" id="rXlsx">${IC.down} Exporter la sélection</button></div><table class="t"><thead><tr><th style="width:20px"><input type="checkbox" id="rAll"></th><th>Client</th><th>Collaborateur</th><th>Ce qui manque</th><th>Suivi</th><th></th></tr></thead>${lignesProgressives('rBody', l.map((x) => `<tr data-r="${x.siren}"><td><input type="checkbox" class="rsel" ${A.rsel.has(x.siren) ? 'checked' : ''}></td><td><b>${esc(x.nom || '—')}</b><div class="tiny muted">${fmtSiren(x.siren)}${x.code ? ' · ' + esc(x.code) : ''}${x.email ? ' · ' + esc(x.email) : ' · <span style="color:var(--bad)">e-mail manquant</span>'}</div></td><td class="small">${esc(x.collab)}</td><td class="small">${x.manque === 'absent' ? 'Absent de votre espace' : x.manque === 'compte fiscal' ? 'Pas d’accès au compte fiscal' : '—'}</td><td>${pill(x)}</td>
      <td class="r" style="white-space:nowrap">${x.statut === 'raccorde' ? '<a href="#" class="tiny" data-ract="clear">Retirer du suivi</a>' : `<button class="btn sm${['a-demander', 'relancer'].includes(x.statut) ? ' primary' : ''}" data-ract="mail">${IC.mail} ${x.statut === 'relancer' ? 'Relancer' : 'Message'}</button> <a href="#" class="tiny" data-ract="${x.statut === 'ignore' ? 'unignore' : 'ignore'}">${x.statut === 'ignore' ? 'Rétablir' : 'Ignorer'}</a>`}</td></tr>`))}</table>` : `<div class="empty">${all.length ? 'Rien pour ce filtre.' : 'Tous les clients du fichier sont dans votre espace professionnel.'}</div>`}</div>`;
}
function raccordVue(all = clientsARaccorder()) {
  const f = A.rf, q = f.q.trim().toLowerCase();
  return all.filter((x) => (!f.collab || x.collab === f.collab) && (f.statut ? x.statut === f.statut : x.statut !== 'ignore') && (!q || (x.nom + ' ' + x.siren + ' ' + x.code).toLowerCase().includes(q)));
}
const RSTATUT_LIB = { 'a-demander': 'À demander', demande: 'Demandé', relancer: 'À relancer', raccorde: 'Raccordé', ignore: 'Ignoré' };
function xlsxSelection() {
  const corr = A.S.correspondance || {}, H = A.habil, d = new Date().toLocaleDateString('fr-FR');
  if (route().arg === 'raccorder') {
    const l = raccordVue();
    return { nom: 'clients_a_raccorder', wb: buildWorkbook([{ name: 'Clients à raccorder', title: 'Clients à raccorder (sélection)', subtitle: `Extrait le ${d} · ${plural(l.length, 'client')} · Relève`, tab: true,
      cols: [{ h: 'Client', w: 34, style: () => 6 }, { h: 'SIREN', w: 12 }, { h: 'Code', w: 10 }, { h: 'Collaborateur', w: 16 }, { h: 'E-mail', w: 28 }, { h: 'Ce qui manque', w: 28 }, { h: 'Suivi', w: 16 }, { h: 'Demandé le', w: 12 }, { h: 'Raccordé le', w: 12 }],
      rows: l.map((x) => [x.nom, x.siren, x.code, x.collab, x.email, x.manque === 'absent' ? 'Absent de l’espace' : x.manque ? 'Pas d’accès au compte fiscal' : '', RSTATUT_LIB[x.statut], x.r.demandeAt ? new Date(x.r.demandeAt).toLocaleDateString('fr-FR') : '', x.r.raccordeAt ? new Date(x.r.raccordeAt).toLocaleDateString('fr-FR') : '']) }]) };
  }
  const v = habVue(), filtres = habFiltresTexte();
  if (v.sansMode) return { nom: 'sans_' + clean(H.services[v.iS]).toLowerCase(), wb: buildWorkbook([{ name: 'Sélection', title: `Dossiers sans « ${H.services[v.iS]} »`, subtitle: `Lu le ${new Date(H.at).toLocaleDateString('fr-FR')} · filtres : ${filtres} · ${plural(v.sans.length, 'dossier')} · Relève`, tab: true,
    cols: [{ h: 'Client', w: 34, style: () => 6 }, { h: 'SIREN', w: 12 }, { h: 'Code', w: 10 }, { h: 'Collaborateur', w: 16 }, { h: 'Service manquant', w: 36 }, { h: 'État du service', w: 16 }, { h: 'Autres services actifs', w: 12, t: 'n' }],
    rows: v.sans.map((x) => [x.nom, x.siren, x.code, x.collab, H.services[v.iS], { 0: 'Jamais attribué', 2: 'En veille', 3: 'Supprimé' }[x.etat], x.autres]) }]) };
  return { nom: 'selection', wb: buildWorkbook([{ name: 'Sélection', title: 'Habilitations (sélection)', subtitle: `Lu le ${new Date(H.at).toLocaleDateString('fr-FR')} · filtres : ${filtres} · ${plural(v.dossiers.length, 'dossier')}, ${plural(v.nLignes, 'habilitation')} · Relève`, tab: true,
    cols: [{ h: 'Client', w: 34, style: () => 6 }, { h: 'SIREN', w: 12 }, { h: 'Code', w: 10 }, { h: 'Collaborateur', w: 16 }, { h: 'Service', w: 42 }, { h: 'Rôle', w: 22 }, { h: 'État', w: 12 }],
    rows: v.dossiers.flatMap((dd) => dd.l.map(([, i, r, e]) => [dd.nom, dd.siren, dd.code, dd.collab, H.services[i], { AT: 'Administrateur titulaire', AS: 'Administrateur suppléant', N1: 'Acteur délégant', N2: 'Acteur' }[r] || '', ETAT_LIB[e]])) }]) };
}
function messageRaccord(sirens) {
  const corr = A.S.correspondance || {};
  return sirens.map((s) => { const c = corr[s] || {}, nom = c.nom || nomDe(s), m = ACM.raccordementTexte({ nom, abonne: A.S.abonne, signature: A.S.signature }); return { siren: s, nom, to: c.email || '', subject: m.objet, body: m.texte }; });
}
function ouvrirMessageRaccord(siren) {
  const [m] = messageRaccord([siren]), deja = (A.raccord[siren] || {}).demandeAt;
  $('#sheet').innerHTML = `<h2>${deja ? 'Relancer' : 'Demander l’accès'} : ${esc(m.nom || fmtSiren(siren))}</h2>
    ${A.S.abonne ? '' : '<div class="warnbox" style="background:var(--warn-bg);color:#6B4500;padding:10px 12px;border-radius:9px;font-size:13px;margin:8px 0">Numéro d’abonné du cabinet non renseigné : indiquez-le en haut de la liste (il est lu automatiquement avec les habilitations).</div>'}
    <div class="fl"><label>À</label><input id="rmTo" value="${esc(m.to)}" placeholder="adresse du client"><label>Objet</label><input id="rmSub" value="${esc(m.subject)}"></div>
    <textarea id="rmBody">${esc(m.body)}</textarea>
    <div class="ft"><button class="btn primary" id="rmEml">${IC.mail} Ouvrir dans Outlook (.eml)</button><button class="btn" id="rmCopy">${IC.copy} Copier le texte</button><button class="btn ghost" id="rmClose">Fermer</button><span class="tiny muted" style="margin-left:auto">Le client sera marqué « demandé ».</span></div>`;
  $('#modal').hidden = false;
  const fait = async () => { const avant = A.raccord[siren] ? { ...A.raccord[siren] } : null; await majRaccord([siren], deja ? { relanceAt: Date.now(), relances: [...((A.raccord[siren] || {}).relances || []), Date.now()], ignore: false } : { demandeAt: Date.now(), ignore: false }); $('#modal').hidden = true; page(); toast(deja ? 'Relance notée' : 'Marqué « demandé »', async () => { A.raccord[siren] = avant; if (!avant) delete A.raccord[siren]; await ACDB.put('meta', { key: 'raccord', data: A.raccord }); page(); }); };
  $('#rmClose').onclick = () => { $('#modal').hidden = true; };
  $('#rmEml').onclick = () => { download(buildEml({ to: $('#rmTo').value.trim(), subject: $('#rmSub').value, body: $('#rmBody').value, attachments: [] }), `Acces_impots_${clean(m.nom || siren)}.eml`, 'message/rfc822'); fait(); };
  $('#rmCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#rmBody').value); } catch {} fait(); };
}
function buildXlsxHabil() {
  const H = A.habil, corr = A.S.correspondance || {};
  const sheets = [{ name: 'Habilitations', title: 'Habilitations de votre espace professionnel', subtitle: `Lu le ${new Date(H.at).toLocaleDateString('fr-FR')} · Relève`, tab: true,
    cols: [{ h: 'Client', w: 34, style: () => 6 }, { h: 'SIREN', w: 12 }, { h: 'Code', w: 10 }, { h: 'Collaborateur', w: 16 }, { h: 'Service', w: 42 }, { h: 'Rôle', w: 22 }, { h: 'État', w: 12 }],
    rows: H.rows.map(([s, i, r, e]) => [nomDe(s), s, (corr[s] || {}).code || '', (corr[s] || {}).collaborateur || '', H.services[i], { AT: 'Administrateur titulaire', AS: 'Administrateur suppléant', N1: 'Acteur délégant', N2: 'Acteur' }[r] || '', ETAT_LIB[e]]) }];
  // Matrice : une ligne par dossier, une colonne par service (Actif / En veille / Supprimé / vide = jamais attribué)
  const u = [...universHabil()], cell = new Map();
  for (const [s, i, , e] of H.rows) { const k = s + '|' + i, p = cell.get(k); if (!p || e < p) cell.set(k, e); }
  sheets.push({ name: 'Matrice', title: 'Services par dossier (vide = pas d’habilitation)', cols: [{ h: 'Client', w: 34, style: () => 6 }, { h: 'SIREN', w: 12 }, { h: 'Collaborateur', w: 16 }, ...H.services.map((x) => ({ h: x, w: 14 }))],
    rows: u.map((s) => [nomDe(s), s, (corr[s] || {}).collaborateur || '', ...H.services.map((x, i) => { const e = cell.get(s + '|' + i); return e ? ETAT_LIB[e] : ''; })]) });
  const rac = clientsARaccorder();
  if (rac.length) sheets.push({ name: 'Clients à raccorder', title: 'Clients du cabinet à raccorder',
    cols: [{ h: 'Client', w: 34, style: () => 6 }, { h: 'SIREN', w: 12 }, { h: 'Code', w: 10 }, { h: 'Collaborateur', w: 16 }, { h: 'E-mail', w: 28 }, { h: 'Ce qui manque', w: 28 }, { h: 'Suivi', w: 24 }],
    rows: rac.map((x) => [x.nom, x.siren, x.code, x.collab, x.email, x.manque === 'absent' ? 'Absent de l’espace' : x.manque ? 'Pas d’accès au compte fiscal' : '', { 'a-demander': 'À demander', demande: 'Demandé le ' + new Date(x.r.demandeAt).toLocaleDateString('fr-FR'), relancer: 'À relancer', raccorde: 'Raccordé', ignore: 'Ignoré' }[x.statut]]) });
  return buildWorkbook(sheets);
}
function bindHabil(arg) {
  noterRaccordes();
  runProg();
  const go = $('#habGo'); if (go) go.onclick = async () => {
    go.disabled = true; A.habRun = 'Démarrage…'; const st = $('#habStep'); if (st) st.textContent = A.habRun;
    const r = await chrome.runtime.sendMessage({ type: 'ac:habilRun' }).catch((e) => ({ ok: false, error: e.message }));
    if (!r || !r.ok) { A.habRun = ''; go.disabled = false; if (st) st.textContent = ''; toast((r && r.error) || 'Lecture impossible'); }
  };
  const x = $('#habXlsx'); if (x) x.onclick = () => download(buildXlsxHabil(), `Releve_habilitations_${jourISO()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const on = (id, o, k, ev = 'onchange') => { const e = $('#' + id); if (e) e[ev] = () => { A[o] = { ...A[o], [k]: e.value }; page(); if (ev === 'oninput') { const n = $('#' + id); n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }; };
  on('hService', 'hf', 'service'); on('hMode', 'hf', 'mode'); on('hRole', 'hf', 'role'); on('hEtat', 'hf', 'etat'); on('hCollab', 'hf', 'collab'); on('hq', 'hf', 'q', 'oninput');
  on('rStatut', 'rf', 'statut'); on('rCollab', 'rf', 'collab'); on('rq', 'rf', 'q', 'oninput');
  const rs = $('#hReset'); if (rs) rs.onclick = () => { A.hf = { q: '', service: '', role: '', etat: '1', collab: '', mode: 'avec' }; page(); };
  $$('[data-svc]').forEach((a) => a.onclick = (ev) => { ev.preventDefault(); A.hf = { ...A.hf, service: a.dataset.svc, mode: a.dataset.mode || 'avec' }; page(); window.scrollTo(0, 0); });
  const ab = $('#rAbonne'); if (ab) ab.onchange = async () => { A.S = await ACDB.saveSettings({ abonne: ab.value.replace(/\D/g, '') }); A.data.settings = A.S; toast('Numéro d’abonné enregistré'); };
  for (const id of ['habSelXlsx', 'rXlsx']) { const b = $('#' + id); if (b) b.onclick = () => { const x = xlsxSelection(); download(x.wb, `Releve_${x.nom}_${jourISO()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); toast('Sélection exportée'); }; }
  const rb = $('#rBody'); if (rb) rb.onclick = async (ev) => {
    const tr = ev.target.closest('tr[data-r]'); if (!tr) return;
    const s = tr.dataset.r, b = ev.target.closest('[data-ract]'), cb = ev.target.closest('.rsel');
    if (cb) { cb.checked ? A.rsel.add(s) : A.rsel.delete(s); page(); return; }
    if (!b) return; ev.preventDefault();
    const act = b.dataset.ract;
    if (act === 'mail') ouvrirMessageRaccord(s);
    else if (act === 'ignore') { await majRaccord([s], { ignore: true }); page(); toast('Client ignoré (Statut › Ignorés pour le rétablir)'); }
    else if (act === 'unignore') { await majRaccord([s], { ignore: false }); page(); }
    else if (act === 'clear') { delete A.raccord[s]; await ACDB.put('meta', { key: 'raccord', data: A.raccord }); page(); }
  };
  const all = $('#rAll'); if (all) all.onchange = () => { raccordVue().forEach((x) => all.checked ? A.rsel.add(x.siren) : A.rsel.delete(x.siren)); page(); };
  const bc = $('#rBulkClear'); if (bc) bc.onclick = () => { A.rsel.clear(); page(); };
  const bd = $('#rBulkDone'); if (bd) bd.onclick = async () => { const l = [...A.rsel]; for (const s of l) { const r = A.raccord[s] || {}; await majRaccord([s], r.demandeAt ? { relanceAt: Date.now(), ignore: false } : { demandeAt: Date.now(), ignore: false }); } A.rsel.clear(); page(); toast(`${plural(l.length, 'client marqué', 'clients marqués')} « demandé »`); };
  const bm = $('#rBulkMail'); if (bm) bm.onclick = async () => {
    const ms = messageRaccord([...A.rsel]);
    const entries = ms.map((m) => ({ path: `Acces_impots_${clean(m.nom || m.siren)}.eml`, data: buildEml({ to: m.to, subject: m.subject, body: m.body, attachments: [] }) }));
    download(entries.length === 1 ? entries[0].data : makeZip(entries), entries.length === 1 ? entries[0].path : `Demandes_acces_${jourISO()}.zip`, entries.length === 1 ? 'message/rfc822' : 'application/zip');
    for (const m of ms) { const r = A.raccord[m.siren] || {}; await majRaccord([m.siren], r.demandeAt ? { relanceAt: Date.now(), ignore: false } : { demandeAt: Date.now(), ignore: false }); }
    const sansMail = ms.filter((m) => !m.to).length; A.rsel.clear(); page();
    toast(`${plural(ms.length, 'brouillon prêt', 'brouillons prêts')}${sansMail ? ` (${sansMail} sans e-mail : adresse à compléter)` : ''}`);
  };
}

// ======================================================================
// Sauvegarde et restauration (fichier JSON sur le poste ; les avis se relisent sur impots.gouv)
// ======================================================================
const FORMAT_BK = 'releve-sauvegarde';
async function sauvegarder() {
  const [settings, tasks, cnotes, ca, claude, raccord] = await Promise.all([ACDB.settings(), ACDB.all('tasks'), ACDB.get('meta', 'cnotes'), ACDB.get('meta', 'ca'), ACDB.get('meta', 'claude'), ACDB.get('meta', 'raccord')]);
  const bk = { format: FORMAT_BK, version: 1, application: chrome.runtime.getManifest().version, date: new Date().toISOString(), settings, tasks, cnotes: (cnotes && cnotes.data) || {}, ca: (ca && ca.data) || {}, claude: (claude && claude.list) || [], raccord: (raccord && raccord.data) || {} };
  const d = new Date(), j = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  download(JSON.stringify(bk, null, 1), `Releve-sauvegarde-${j}.json`, 'application/json');
  A.backupAt = Date.now(); await ACDB.put('meta', { key: 'backupAt', at: A.backupAt });
  const i = $('#saveInfo'); if (i) i.textContent = 'Dernière sauvegarde : à l’instant';
  shell();
  toast('Sauvegarde enregistrée dans vos Téléchargements : gardez-la dans un dossier sûr');
}
function resumeSauvegarde(bk) {
  const t = bk.tasks || [], faites = t.filter((x) => x.status === 'done').length, rep = t.filter((x) => x.status === 'snooze').length, notes = Object.values(bk.cnotes || {}).reduce((n, l) => n + l.length, 0);
  return [faites && plural(faites, 'action faite', 'actions faites'), rep && plural(rep, 'action reportée', 'actions reportées'), notes && plural(notes, 'note client', 'notes client'),
    Object.keys((bk.settings || {}).correspondance || {}).length && `fichier des dossiers (${plural(Object.keys(bk.settings.correspondance).length, 'dossier')})`,
    Object.keys(bk.ca || {}).length && `chiffres d’affaires (${plural(Object.keys(bk.ca).length, 'client')})`, (bk.claude || []).length && plural(bk.claude.length, 'réponse de Claude', 'réponses de Claude'), Object.keys(bk.raccord || {}).length && `suivi des demandes d’accès (${plural(Object.keys(bk.raccord).length, 'client')})`, 'réglages'].filter(Boolean);
}
async function lireSauvegarde(file) {
  let bk;
  try { bk = JSON.parse(await file.text()); } catch { toast('Fichier illisible : choisissez un fichier Releve-sauvegarde-….json'); return; }
  if (!bk || bk.format !== FORMAT_BK) { toast('Ce fichier n’est pas une sauvegarde Relève'); return; }
  const date = new Date(bk.date);
  $('#sheet').innerHTML = `<h2>Restaurer la sauvegarde du ${date.toLocaleDateString('fr-FR')} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} ?</h2>
    <p class="small">Contenu : ${esc(resumeSauvegarde(bk).join(', '))}.</p>
    <p class="small muted">Rien n’est effacé : les éléments de la sauvegarde s’ajoutent à ce qui se trouve déjà sur ce poste (pour une même action, l’état sauvegardé l’emporte). Les avis ne sont pas dans la sauvegarde : ils se relisent avec une mise à jour.</p>
    <div class="ft"><button class="btn primary" id="bkGo">Restaurer</button><button class="btn ghost" id="bkNo">Annuler</button></div>`;
  $('#modal').hidden = false;
  $('#bkNo').onclick = () => { $('#modal').hidden = true; };
  $('#bkGo').onclick = async () => { $('#bkGo').disabled = true; await restaurer(bk); $('#modal').hidden = true; };
}
async function restaurer(bk) {
  const cur = await ACDB.settings();
  await ACDB.put('meta', { ...cur, ...(bk.settings || {}), key: 'settings' });
  for (const t of bk.tasks || []) if (t && t.id) await ACDB.put('tasks', t);
  const cn = ((await ACDB.get('meta', 'cnotes')) || {}).data || {};
  for (const [siren, l] of Object.entries(bk.cnotes || {})) { const vu = new Set((cn[siren] || []).map((n) => n.at + '|' + n.text)); cn[siren] = [...(cn[siren] || []), ...l.filter((n) => !vu.has(n.at + '|' + n.text))].sort((a, b) => a.at - b.at); }
  await ACDB.put('meta', { key: 'cnotes', data: cn });
  if (Object.keys(bk.ca || {}).length) { const ca = ((await ACDB.get('meta', 'ca')) || {}).data || {}; await ACDB.put('meta', { key: 'ca', data: { ...ca, ...bk.ca } }); }
  if ((bk.claude || []).length) { const cl = ((await ACDB.get('meta', 'claude')) || {}).list || [], vu = new Set(cl.map((x) => x.at)); await ACDB.put('meta', { key: 'claude', list: [...cl, ...bk.claude.filter((x) => !vu.has(x.at))].sort((a, b) => b.at - a.at).slice(0, 30) }); }
  if (Object.keys(bk.raccord || {}).length) { const rc = ((await ACDB.get('meta', 'raccord')) || {}).data || {}; await ACDB.put('meta', { key: 'raccord', data: { ...bk.raccord, ...rc } }); }
  await load(); render();
  chrome.runtime.sendMessage({ type: 'ac:refreshBadge' }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'ac:mcpToggle', on: !!A.S.mcp }).catch(() => {});
  toast('Sauvegarde restaurée : ' + resumeSauvegarde(bk).slice(0, 3).join(', '));
}

// ======================================================================
// Démarrage
// ======================================================================
function bindPage(p, arg) {
  if (p === 'a-traiter' || !p) { bindTraiter(); animerBarre(); }
  if (p === 'clients') bindClients();
  if (p === 'client') bindClient(arg);
  if (p === 'collectivites') bindCollectivites();
  if (p === 'reglages') bindReglages();
  if (p === 'demander') bindDemander(arg);
  if (p === 'habilitations') bindHabil(arg);
  if (p === 'synthese') { const b = $('#printBtn'); if (b) b.onclick = () => window.print(); }
  $$('[data-exp]').forEach((b) => b.onclick = () => doExport(b.dataset.exp, b));
}
window.addEventListener('hashchange', () => {
  const go = () => { A.sel.clear(); shell(); page(); window.scrollTo(0, 0); };
  if (document.startViewTransition && !calme() && A.data) { const vt = document.startViewTransition(go); for (const pr of [vt.ready, vt.finished, vt.updateCallbackDone]) if (pr) pr.catch(() => {}); } else go();
});
let liveT = 0;
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'ac:mcpState') { if (A.showMcp) A.showMcp(msg); return; }
  if (msg && msg.type === 'ac:dataChanged') { load().then(render); return; }
  if (msg && msg.type === 'ac:claudeReponse') { load().then(render); return; }
  if (msg && msg.type === 'ac:habilStep') { A.habRun = msg.error ? '' : msg.text; const e = $('#habStep'); if (e) e.textContent = msg.error ? '' : msg.text; if (msg.error) { toast('Habilitations : ' + msg.error); const g = $('#habGo'); if (g) g.disabled = false; } return; }
  if (msg && msg.type === 'ac:habilDone') { A.habRun = ''; load().then(() => { render(); toast(`Habilitations lues : ${plural(msg.n, 'ligne')}`); }); return; }
  if (msg && msg.type === 'ac:state' && msg.run && msg.run.running) {
    A.run = msg.run;
    const f = $('#fresh'); if (f) f.innerHTML = `${IC.refresh} Mise à jour en cours · ${msg.run.done}/${msg.run.total || '…'} dossiers`;
    const tranquille = $('#modal').hidden && !A.sel.size && !document.activeElement.matches('textarea, input[type=text], input[type=email], input:not([type])');
    if (tranquille && Date.now() - liveT > 5000 && ['a-traiter', 'clients', ''].includes(route().p)) { liveT = Date.now(); const y = window.scrollY, avant = new Set(A.c.taches.map((t) => t.id)); load().then(() => { render(); window.scrollTo(0, y); $$('.item').forEach((r) => { if (!avant.has(r.dataset.id)) r.classList.add('new'); }); }); }
    return;
  }
  if (msg && msg.type === 'ac:state' && msg.run && !msg.run.running) { const was = A.run && A.run.running; A.run = msg.run; if (was) shell(); }
  if (msg && msg.type === 'ac:state' && msg.run && !msg.run.running && msg.run.last && msg.run.last.at !== A.lastRun) {
    A.lastRun = msg.run.last.at;
    load().then(() => { render(); toast('Mise à jour terminée : la liste de travail est à jour'); });
  }
});
let lastFocusLoad = Date.now();
// Retour sur l'onglet : on ne redessine que si les données ont changé (sinon le premier clic pourrait tomber dans le vide)
const signature = () => A.data ? [A.data.avis.length, A.data.runs[0] && A.data.runs[0].at, Object.values(A.data.tasks).reduce((m, t) => Math.max(m, t.at || 0), 0), Object.keys(A.data.tasks).length, A.claude.length, JSON.stringify(A.S)].join('|') : '';
window.addEventListener('focus', () => {
  if (Date.now() - lastFocusLoad < 5000 || !$('#modal').hidden) return;
  lastFocusLoad = Date.now();
  const avant = signature();
  load().then(() => { if (signature() !== avant) { const y = window.scrollY; render(); window.scrollTo(0, y); } });
});
chrome.runtime.sendMessage({ type: 'ac:getState' }).then((r) => { A.run = r && r.run; }).catch(() => {}).finally(() => load().then(render));
ACUP.check().then((u) => {
  if (!u.available) return;
  const b = document.createElement('div'); b.className = 'updbar';
  b.innerHTML = `<b>Nouvelle version ${esc(u.version)} disponible</b>${u.notes ? `<span>${esc(u.notes)}</span>` : ''}<a href="${esc(u.zip)}" target="_blank">Télécharger</a><a href="${esc(u.guide)}" target="_blank">Comment mettre à jour (1 min)</a>`;
  $('.main').prepend(b);
});
