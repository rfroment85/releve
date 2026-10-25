// Relève — service d'arrière-plan : range sur le poste ce que la collecte transmet, suit l'avancement, met à jour la pastille.
'use strict';
importScripts('lib/db.js', 'lib/analyse.js', 'lib/messages.js', 'lib/mcp.js');

const HOST = 'https://cfspro.impots.gouv.fr/';
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ---- État de la mise à jour en cours (gardé aussi en session pour survivre à une mise en veille du service) ----
const fresh = () => ({ running: false, phase: '', done: 0, total: 0, label: '', eta: null, feed: [], logs: [], startedAt: 0, nouveaux: 0, error: '', last: null });
let RUN = fresh();
const ready = chrome.storage.session.get('run').then((o) => { if (o && o.run) RUN = { ...fresh(), ...o.run }; }).catch(() => {});
let saveT = null;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => chrome.storage.session.set({ run: RUN }).catch(() => {}), 300); };
const broadcast = () => chrome.runtime.sendMessage({ type: 'ac:state', run: RUN }).catch(() => {});

const fromB64 = (s) => { const bin = atob(s); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; };
const eur = (n) => Math.round(n || 0).toLocaleString('fr-FR') + ' €';

async function refreshBadge() {
  try {
    const data = await ACDB.loadAll();
    if (!data.avis.length) { await chrome.action.setBadgeText({ text: '' }); return 0; }
    const c = ACA.campagne(data, { annee: ACA.anneeCampagne() });
    const open = c.taches.filter((t) => !t.done && !t.snoozed).length;
    await chrome.action.setBadgeBackgroundColor({ color: '#1F3B6E' });
    await chrome.action.setBadgeText({ text: open ? String(open > 999 ? '999+' : open) : '' });
    return open;
  } catch (e) { return 0; }
}

async function handle(msg, sender) {
  await ready;
  switch (msg.type) {
    case 'ac:getKnown': {
      // Un avis dont le PDF n'était pas le bon (autre dossier) n'est pas « connu » : il sera retéléchargé
      const lus = (await ACDB.all('avis')).filter((a) => { const c = (a.infos && a.infos.controle) || ''; return /SIREN PDF \d+ ≠|référence PDF \S+ ≠|référence .* absente du PDF|PDF non récupéré/.test(c) || (/dénomination .* non trouvée/.test(c) && /montant PDF/.test(c)); });
      const douteux = new Set(lus.map((a) => a.id));
      const ids = (await ACDB.keys('pdfs')).filter((id) => !douteux.has(id));
      const dossiers = Object.fromEntries((await ACDB.all('dossiers')).map((x) => [x.siren, { annees: x.annees, checkedAt: x.checkedAt, tfAt: x.tfAt, cfeAt: x.cfeAt, dettesAt: x.dettesAt, amrAt: x.amrAt, amrIndispo: x.amrIndispo }]));
      // … et la page de l'impôt concerné est relue dès la prochaine mise à jour, même rapide
      for (const a of lus) { const k = dossiers[a.siren]; if (k) k[a.taxe === 'TF' ? 'tfAt' : 'cfeAt'] = 0; }
      return { ids, dossiers };
    }
    case 'ac:avis': {
      const r = msg.record, old = await ACDB.get('avis', r.id);
      const rec = { ...(old || {}), ...r, infos: r.infos || (old && old.infos) || null, firstSeenAt: (old && old.firstSeenAt) || Date.now(), hasPdf: !!((old && old.hasPdf) || msg.pdf) };
      if (msg.rejet) { rec.hasPdf = false; await ACDB.del('pdfs', r.id); } // PDF d'un autre dossier : jamais conservé
      await ACDB.put('avis', rec);
      if (msg.pdf) await ACDB.put('pdfs', { id: r.id, blob: fromB64(msg.pdf), suite: msg.suite ? fromB64(msg.suite) : null, at: Date.now() });
      if (msg.nouveau) {
        RUN.nouveaux++;
        RUN.feed.unshift({ at: Date.now(), title: `${r.nom}`, sub: `${ACA.TAXE_LABEL[r.taxe]} ${r.annee}${r.acompte ? ' (acompte)' : ''} · ${r.commune || ''} · ${eur(r.infos && r.infos.montantImpot || r.montant)}` });
        RUN.feed = RUN.feed.slice(0, 8);
        save(); broadcast();
      }
      return { ok: true };
    }
    case 'ac:dettes':
    {
      const old = await ACDB.get('dettes', msg.siren);
      await ACDB.put('dettes', { siren: msg.siren, nom: msg.nom, rows: msg.rows || (old && old.rows) || [], total: msg.total ?? (old && old.total) ?? 0, amr: msg.amr || (msg.amr === null && old ? old.amr : []) || [], amrIndispo: msg.amrIndispo !== undefined ? msg.amrIndispo : (old && old.amrIndispo) || '', at: Date.now() });
    }
      return { ok: true };
    case 'ac:dossier': {
      const old = await ACDB.get('dossiers', msg.siren);
      const { type, ...rest } = msg;
      await ACDB.put('dossiers', { ...(old || {}), ...rest, annees: { ...((old && old.annees) || {}), ...(msg.annees || {}) }, checkedAt: msg.checkedAt || Date.now() });
      return { ok: true };
    }
    case 'ac:dossierList':
      await ACDB.put('meta', { key: 'dossierList', list: msg.list || [], at: Date.now() });
      return { ok: true };
    case 'ac:started':
      RUN = { ...fresh(), running: true, startedAt: Date.now(), phase: 'liste', label: 'Démarrage…', last: RUN.last };
      save(); broadcast();
      return { ok: true };
    case 'ac:progress':
      Object.assign(RUN, { running: true, phase: msg.phase, done: msg.done, total: msg.total, label: msg.label, eta: msg.eta ?? null });
      if (!RUN.startedAt) RUN.startedAt = Date.now();
      save(); broadcast();
      return { ok: true };
    case 'ac:log':
      RUN.logs.unshift({ at: Date.now(), level: msg.level, text: msg.text }); RUN.logs = RUN.logs.slice(0, 50);
      save();
      return { ok: true };
    case 'ac:done': {
      const run = { at: Date.now(), stats: msg.stats, duree: msg.duree, annee: msg.annee, scope: msg.scope ? msg.scope.length : null, stopped: !!msg.stopped, complet: !!msg.complet, logs: RUN.logs.slice(0, 50) };
      await ACDB.put('runs', run);
      const open = await refreshBadge();
      RUN = { ...RUN, running: false, done: RUN.total, eta: null, last: { ...run, open } };
      if ((msg.duree || 0) > 60) notify('fin', 'Mise à jour terminée', `${run.stats.dossiers} dossiers lus · ${open} action${open > 1 ? 's' : ''} dans votre liste de travail.`, 'a-traiter');
      save(); broadcast();
      return { ok: true };
    }
    case 'ac:error':
      RUN = { ...RUN, running: false, error: msg.text || 'Erreur', eta: null };
      if (msg.stats && msg.stats.dossiers) await ACDB.put('runs', { at: Date.now(), stats: msg.stats, error: msg.text, stopped: true });
      await refreshBadge();
      save(); broadcast();
      return { ok: true };
    case 'ac:siteInfo': {
      const hidden = (await chrome.storage.session.get('hideBanner')).hideBanner || {};
      if (hidden[msg.siren]) return { n: 0 };
      const data = await ACDB.loadAll();
      if (data.settings.banner === false || !data.avis.length) return { n: 0 };
      const c = ACA.campagne(data, { annee: ACA.anneeCampagne() });
      const open = c.taches.filter((t) => t.siren === msg.siren && !t.done && !t.snoozed);
      const lib = Object.fromEntries(c.CATS.map((k) => [k.key, k.titre.toLowerCase()]));
      const cnt = {}; open.forEach((t) => { cnt[t.cat] = (cnt[t.cat] || 0) + 1; });
      return { n: open.length, resume: Object.entries(cnt).map(([k, v]) => `${v > 1 ? v + ' × ' : ''}${lib[k]}`).join(' · ') };
    }
    case 'ac:hideBanner': {
      const hidden = (await chrome.storage.session.get('hideBanner')).hideBanner || {};
      hidden[msg.siren] = true; await chrome.storage.session.set({ hideBanner: hidden });
      return { ok: true };
    }
    case 'ac:openApp':
      await openApp(msg.hash || '');
      return { ok: true };
    case 'ac:gotoSite': {
      // Sélectionne le dossier dans l'onglet impots.gouv (ouvert ou à ouvrir), puis affiche la page demandée
      // Jamais pendant une mise à jour : changer de dossier sur le site fausserait la lecture en cours
      if (RUN.running) return { ok: false, error: 'Mise à jour en cours : ouvrez le dossier sur impots.gouv une fois la mise à jour terminée.' };
      let [tab] = await chrome.tabs.query({ url: HOST + '*' });
      if (!tab) { tab = await chrome.tabs.create({ url: HOST + 'mire/accueil.do' }); return { ok: false, error: 'Espace professionnel ouvert : connectez-vous puis cliquez à nouveau.' }; }
      await chrome.tabs.update(tab.id, { active: true }); chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      const ask = () => chrome.tabs.sendMessage(tab.id, { type: 'ac:goto', siren: msg.siren, page: msg.page });
      try { return await ask(); } catch {}
      try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.bundle.js'] }); return await ask(); } catch (e) { return { ok: false, error: 'Onglet impots.gouv injoignable : rechargez-le.' }; }
    }
    case 'ac:habilRun': {
      // Lecture des habilitations dans l'onglet impots.gouv (jamais pendant une mise à jour)
      if (RUN.running) return { ok: false, error: 'Mise à jour en cours : lisez les habilitations une fois terminée.' };
      const [tab] = await chrome.tabs.query({ url: HOST + '*' });
      if (!tab) return { ok: false, error: 'Ouvrez d’abord votre espace professionnel impots.gouv et connectez-vous.' };
      const ask = () => chrome.tabs.sendMessage(tab.id, { type: 'ac:habilitations' });
      try { return await ask(); } catch {}
      try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.bundle.js'] }); return await ask(); } catch (e) { return { ok: false, error: 'Onglet impots.gouv injoignable : rechargez-le.' }; }
    }
    case 'ac:habil': {
      const d = msg.data || {};
      const services = [...new Set((d.rows || []).map((r) => r.service))].sort((a, b) => a.localeCompare(b, 'fr'));
      const ix = Object.fromEntries(services.map((x, i) => [x, i]));
      await ACDB.put('meta', { key: 'habil', at: d.at || Date.now(), abonne: d.abonne || '', services, noms: d.noms || {}, rows: (d.rows || []).map((r) => [r.siren, ix[r.service], r.role, r.etat === 'Actif' ? 1 : r.etat === 'En veille' ? 2 : 3]) });
      if (d.abonne) { const S = await ACDB.settings(); if (!S.abonne) await ACDB.saveSettings({ abonne: d.abonne }); }
      chrome.runtime.sendMessage({ type: 'ac:habilDone', n: (d.rows || []).length }).catch(() => {});
      return { ok: true };
    }
    case 'ac:mcpToggle':
      if (msg.on) await ACMCP.connect(true); else ACMCP.disconnect('off');
      return ACMCP.status();
    case 'ac:mcpStatus':
      return ACMCP.status();
    case 'ac:getState':
      return { run: RUN };
    case 'ac:resetState':
      RUN = { ...fresh(), last: RUN.last }; save(); broadcast();
      return { ok: true };
    case 'ac:refreshBadge':
      return { open: await refreshBadge() };
    case 'ac:pageSeen':
      return { ok: true };
    default:
      return undefined;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('ac:')) return;
  if (['ac:ping', 'ac:detect', 'ac:start', 'ac:stop', 'ac:state', 'ac:goto', 'ac:mcpState', 'ac:dataChanged'].includes(msg.type)) return; // destinés à l'onglet ou au volet
  handle(msg, sender).then((r) => reply(r), (e) => reply({ ok: false, error: e.message }));
  return true;
});

// Après installation ou mise à jour : injecter le script dans les onglets impots.gouv déjà ouverts (évite de devoir recharger la page)
chrome.runtime.onInstalled.addListener(async (d) => {
  try {
    const tabs = await chrome.tabs.query({ url: HOST + '*' });
    for (const t of tabs) chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.bundle.js'] }).catch(() => {});
  } catch {}
  refreshBadge();
  if (d.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('app.html#bienvenue') });
});
chrome.runtime.onStartup.addListener(refreshBadge);

// ---- Ouvrir l'application (onglet déjà ouvert de préférence) ----
async function openApp(hash) {
  const url = chrome.runtime.getURL('app.html') + (hash ? '#' + hash : '');
  let ctx = []; try { ctx = await chrome.runtime.getContexts({ contextTypes: ['TAB'] }); } catch {}
  const c = ctx.find((x) => x.documentUrl && x.documentUrl.startsWith(chrome.runtime.getURL('app.html')));
  if (c) { await chrome.tabs.update(c.tabId, { active: true, url }); chrome.windows.update(c.windowId, { focused: true }).catch(() => {}); }
  else await chrome.tabs.create({ url });
}

// ---- Alertes (notifications du navigateur) ----
async function notify(id, title, message, hash) {
  try {
    const s = await ACDB.settings(); if (s.notif === false) return;
    await chrome.notifications.create('ac:' + id + ':' + Date.now(), { type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 1 });
    const m = (await chrome.storage.local.get('notifHash')).notifHash || {}; m[id] = hash || ''; await chrome.storage.local.set({ notifHash: m });
  } catch {}
}
chrome.notifications.onClicked.addListener(async (nid) => {
  const id = nid.split(':')[1]; const m = (await chrome.storage.local.get('notifHash')).notifHash || {};
  openApp(m[id] || 'a-traiter'); chrome.notifications.clear(nid);
});
// Une fois par alerte : échéances proches (J-7 et J-1) pour les clients qui paient eux-mêmes, avis de solde de CFE attendus
async function verifierAlertes() {
  try {
    const data = await ACDB.loadAll(); if (!data.avis.length || data.settings.notif === false) return;
    const annee = ACA.anneeCampagne(), c = ACA.campagne(data, { annee, scope: data.settings.scope === 'moi' ? 'moi' : undefined });
    const sent = (await chrome.storage.local.get('notifSent')).notifSent || {};
    const once = async (key, title, text, hash) => { if (sent[key]) return; sent[key] = Date.now(); await notify(key.replace(/[^a-z0-9]/gi, ''), title, text, hash); };
    const rem = c.taches.filter((t) => t.cat === 'prevenir' && !t.done && !t.snoozed && t.avis && t.avis.jours !== null);
    const byDate = {}; rem.forEach((t) => { (byDate[t.avis.dateLimite] = byDate[t.avis.dateLimite] || []).push(t); });
    for (const [date, l] of Object.entries(byDate)) {
      const j = l[0].avis.jours, cl = new Set(l.map((t) => t.siren)).size;
      if (j >= 0 && j <= 1) await once(`ech1:${date}`, `Échéance du ${date} ${j === 0 ? 'aujourd’hui' : 'demain'}`, `${cl} client${cl > 1 ? 's' : ''} sans prélèvement automatique n’${cl > 1 ? 'ont' : 'a'} pas encore été prévenu${cl > 1 ? 's' : ''}.`, 'a-traiter/prevenir');
      else if (j >= 2 && j <= 7) await once(`ech7:${date}`, `Échéance du ${date} dans ${j} jours`, `${cl} client${cl > 1 ? 's' : ''} doi${cl > 1 ? 'vent' : 't'} payer eux-mêmes : prévenez-les en un clic.`, 'a-traiter/prevenir');
    }
    const auj = new Date(), d3 = new Date(annee, 10, 3), d15 = new Date(annee, 11, 15);
    const cfeN = c.N.filter((a) => a.taxe === 'CFE' && !a.acompte).length;
    if (auj >= d3 && auj <= d15 && !cfeN) { const k = `cfe:${annee}:${Math.floor((auj - d3) / (3 * 864e5))}`; await once(k, 'Avis de solde de CFE attendus', 'Les avis de solde de CFE sont mis en ligne début novembre : lancez une mise à jour depuis votre espace professionnel.', 'a-traiter'); }
    await chrome.storage.local.set({ notifSent: sent });
  } catch {}
}
chrome.alarms.create('ac-alertes', { delayInMinutes: 1, periodInMinutes: 360 });
// Connexion à Claude : tentative au démarrage puis chaque minute tant qu'elle est activée et absente
chrome.alarms.create('ac-mcp', { delayInMinutes: 1, periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'ac-alertes') verifierAlertes(); if (a.name === 'ac-mcp') ACMCP.connect(); });
self.handleRun = (m) => handle(m);
self.getRun = () => RUN;
ACMCP.connect();
