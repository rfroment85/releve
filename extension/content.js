// Relève — orchestration de la collecte dans l'onglet impots.gouv (script de contenu)
// Reçoit les ordres du volet latéral, lit les dossiers, transmet avis, PDF et dettes au service d'arrière-plan qui les range sur le poste.
'use strict';

const AC = { running: false, stop: false, total: 0, done: 0, current: '' };

const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

function pageState() {
  const t = document.body ? document.body.innerText : '';
  const login = /cfspro-idp/.test(location.host) || (/Mot de passe/.test(t) && /Authentification/.test(t));
  const expired = /Session expirée/i.test(t) && /déconnexion/i.test(t);
  return { url: location.href, login, expired, running: AC.running, total: AC.total, done: AC.done, current: AC.current };
}

// Détection rapide : jeton de session + nombre de dossiers (1 à 2 requêtes)
async function detect() {
  const token = await getToken();
  const first = await fetchText(`${BASE}/mire/afficherSelectionDossier.do?idth=consulter.avis.cfe&p=1&token=${token}`);
  const total = parseInt((first.match(/(\d+)<\/span>\s*(?:&nbsp;|\s)*résultat/) || [])[1] || '0', 10);
  return { ok: true, total };
}

const avisId = (taxe, siren, row) => [taxe.key, siren, row.anneeImposition, (row.reference || '').replace(/\D/g, ''), row.role].join('|');

// Fenêtres de publication : pendant ces périodes, une page sans avis est relue (nouveaux avis possibles)
function enFenetre(taxeKey, now = new Date()) {
  const md = (now.getMonth() + 1) * 100 + now.getDate();
  if (taxeKey === 'TF') return md >= 801 && md <= 1031;
  return (md >= 501 && md <= 630) || (md >= 1020 && md <= 1231);
}
const H = 3600e3;
// Faut-il relire cette partie du dossier ? (mode rapide ; le mode complet relit tout)
function aLire(part, k, now) {
  if (!k) return true;
  const at = k[part + 'At'] || 0, age = now - at;
  if (part === 'amr') return age > (k.amrIndispo ? 30 * 24 * H : 7 * 24 * H);
  if (part === 'dettes') return age > 20 * H;
  if (age < 20 * H) return false; // déjà lu aujourd'hui (reprise après une pause)
  const vide = !((k.annees || {})[part.toUpperCase()] || []).length;
  if (vide && !enFenetre(part.toUpperCase()) && age < 30 * 24 * H) return false;
  return true;
}

// Écart qui prouve que le PDF n'est pas celui de la ligne (référence ou SIREN différents) ; une simple différence de dénomination ne suffit pas
const autreDossier = (inf) => { const c = (inf && inf.controle) || ''; return /SIREN PDF \d+ ≠|référence PDF \S+ ≠|référence .* absente du PDF/.test(c) || (/dénomination .* non trouvée/.test(c) && /montant PDF/.test(c)); };

async function collect(opts) {
  AC.running = true; AC.stop = false; AC.done = 0; AC.total = 0; AC.current = '';
  const t0 = Date.now(), now = Date.now();
  const stats = { dossiers: 0, avis: 0, nouveaux: 0, pdf: 0, erreurs: 0, dettes: 0, amr: 0, pagesEvitees: 0, requetes: 0 };
  const annee = String(opts.annee), anneeN1 = String(opts.annee - 1);
  const taxes = (opts.taxes || ['TF', 'CFE']).map((k) => TAXES[k]).filter(Boolean);
  const pause = Math.max(0, opts.delay ?? 60);
  const complet = !!opts.complet;
  try {
    const kr = (await send({ type: 'ac:getKnown' })) || {};
    const known = new Set(kr.ids || []), kd = kr.dossiers || {};
    let token = await getToken();
    send({ type: 'ac:progress', phase: 'liste', done: 0, total: 0, label: 'Lecture de la liste des dossiers…' });
    let dossiers = opts.dossiers && opts.dossiers.length ? opts.dossiers : await listDossiers(token, (p, n) => send({ type: 'ac:progress', phase: 'liste', done: p, total: n, label: `Liste des dossiers : page ${p} / ${n}` }));
    if (!opts.dossiers || !opts.dossiers.length) await send({ type: 'ac:dossierList', list: dossiers });
    if (opts.scope && opts.scope.length) { const sc = new Set(opts.scope); dossiers = dossiers.filter((d) => sc.has(d.siren)); }
    AC.total = dossiers.length;

    // Lecture d'un impôt pour le dossier sélectionné : tableau, puis PDF des avis absents du poste
    const lireTaxe = async (taxe, d, out) => {
      const { rows, siren, vs: vs0, curFirst: cf0 } = await getAvis(taxe);
      if (siren && siren !== d.siren) throw new Error('Dossier courant inattendu (' + siren + ')');
      out.annees[taxe.key] = [...new Set(rows.map((r) => r.anneeImposition))].sort();
      out[taxe.key.toLowerCase() + 'At'] = Date.now();
      let vs = vs0, curFirst = cf0;
      const sel = rows.filter((r) => r.anneeImposition === annee || (r.anneeImposition === anneeN1 && !isAcompte(r)) || (opts.toutesAnnees && !isAcompte(r)));
      for (const row of sel) {
        if (AC.stop) break;
        const id = avisId(taxe, d.siren, row);
        const record = { id, taxe: taxe.key, siren: d.siren, nom: d.nom, annee: row.anneeImposition, commune: row.commune, departement: row.departement, nic: row.nic, reference: row.reference, role: row.role, type: row.type, dateLimite: row.dateLimite, dateRecouvrement: row.dateRecouvrement, montant: numVal(row.montant), payer: !!row.payer, acompte: isAcompte(row), seenAt: Date.now() };
        stats.avis++;
        if (known.has(id)) { await send({ type: 'ac:avis', record }); continue; }
        // Téléchargement contrôlé : un PDF dont la référence (ou le SIREN) ne correspond pas à la ligne vient d'un autre dossier
        // (dossier changé côté site pendant la lecture) : on resélectionne le dossier et on recommence, sans jamais le garder.
        const telecharger = async (r) => {
          if (r.first !== curFirst) { const p = await ajaxPage(r.first, vs, taxe); vs = p.vs; curFirst = r.first; }
          const b = await downloadPdf(r.linkId, vs, taxe.url);
          let inf;
          try { inf = parseAvisPdf(taxe, await pdfText(b), d, r); } catch (e) { inf = { controle: 'Lecture impossible : ' + e.message, prelevement: 'À VÉRIFIER' }; }
          return { bytes: b, infos: inf };
        };
        let cible = row, { bytes, infos } = await telecharger(row);
        for (let essai = 0; autreDossier(infos) && essai < 2 && !AC.stop; essai++) {
          send({ type: 'ac:log', level: 'warn', text: `${d.nom} : le site a renvoyé l'avis d'un autre dossier, nouvel essai` });
          await sleep(600 * (essai + 1));
          await selectDossier(token, d.siren);
          const g = await getAvis(taxe);
          if (g.siren && g.siren !== d.siren) continue;
          vs = g.vs; curFirst = g.curFirst;
          cible = g.rows.find((x) => x.reference === row.reference && x.anneeImposition === row.anneeImposition) || row;
          ({ bytes, infos } = await telecharger(cible));
        }
        if (autreDossier(infos)) {
          record.infos = { controle: 'PDF non récupéré : le site a renvoyé l’avis d’un autre dossier (dossier changé sur le site pendant la mise à jour ?). Relancez une mise à jour sans naviguer sur le site.', prelevement: 'À VÉRIFIER' };
          await send({ type: 'ac:avis', record, rejet: true });
          stats.erreurs++; stats.pdfRejetes = (stats.pdfRejetes || 0) + 1;
          continue;
        }
        record.infos = { montantImpot: numVal(infos.montantImpot), acompteVerse: numVal(infos.acompteVerse), montantAPayer: numVal(infos.montantAPayer), prelevement: infos.prelevement, datePrelevement: infos.datePrelevement || '', controle: infos.controle, detail: infos.detail || null };
        let suite = null;
        if (cible.linkSuite) { try { suite = b64(await downloadPdf(cible.linkSuite, vs, taxe.url)); } catch { suite = null; } }
        await send({ type: 'ac:avis', record, pdf: b64(bytes), suite, nouveau: true });
        known.add(id); stats.pdf++; stats.nouveaux++;
      }
    };
    // Une partie avec reprise : en cas d'échec (sauf session expirée), on resélectionne le dossier et on recommence
    const avecReprise = async (label, d, fn) => {
      for (let essai = 0; ; essai++) {
        try { return await fn(); } catch (e) {
          if (/Session expirée/.test(e.message)) throw e;
          if (essai >= 2) { stats.erreurs++; send({ type: 'ac:log', level: 'warn', text: `${d.nom} (${label}) : ${e.message}` }); return null; }
          await sleep(800 * (essai + 1));
          if (/CSRF/.test(e.message)) token = await getToken();
          try { await selectDossier(token, d.siren); } catch (e2) { if (/Session expirée/.test(e2.message)) throw e2; }
        }
      }
    };

    for (let i = 0; i < dossiers.length; i++) {
      if (AC.stop) break;
      const d = dossiers[i], k = complet ? null : kd[d.siren];
      AC.done = i; AC.current = d.nom;
      const elapsed = (Date.now() - t0) / 1000, eta = i > 4 ? Math.round(elapsed / i * (dossiers.length - i)) : null;
      send({ type: 'ac:progress', phase: 'dossiers', done: i, total: dossiers.length, label: d.nom, eta });
      const lireT = taxes.filter((t) => aLire(t.key.toLowerCase(), k, now));
      const lireD = opts.dettes !== false && aLire('dettes', k, now);
      const lireA = opts.amr !== false && aLire('amr', k, now);
      stats.pagesEvitees += (taxes.length - lireT.length) + (opts.dettes !== false && !lireD ? 1 : 0) + (opts.amr !== false && !lireA ? 1 : 0);
      const out = { annees: { ...((kd[d.siren] || {}).annees || {}) } };
      if (lireT.length || lireD || lireA) {
        const ok = await avecReprise('sélection du dossier', d, () => selectDossier(token, d.siren));
        if (ok === null) { /* dossier non sélectionnable : on passe au suivant */ }
        else {
          // Les pages du dossier sont lues en parallèle (le dossier reste sélectionné côté serveur)
          // TF puis CFE (pour qu'un téléchargement de PDF n'en croise jamais un autre), dettes en parallèle ;
          // documents à payer (passage par une autre application du site) seulement après, pour ne pas perturber les PDF.
          let dt = null, am = null;
          const parts = [(async () => { for (const t of lireT) { if (AC.stop) break; await avecReprise(t.label, d, () => lireTaxe(t, d, out)); } })()];
          if (lireD) parts.push(avecReprise('dettes fiscales', d, async () => { dt = await getDettes(); out.dettesAt = Date.now(); stats.dettes += dt.rows.length; }));
          await Promise.all(parts);
          if (lireA && !AC.stop) await avecReprise('documents à payer', d, async () => { const a = await getAmr(token, d.siren); token = a.token; am = a; out.amrAt = Date.now(); out.amrIndispo = a.indispo || ''; stats.amr += a.rows.length; });
          if (dt || am) await send({ type: 'ac:dettes', siren: d.siren, nom: d.nom, rows: dt ? dt.rows : null, total: dt ? numVal(dt.total) : null, amr: am ? am.rows : null, amrIndispo: am ? (am.indispo || '') : undefined });
        }
      }
      await send({ type: 'ac:dossier', siren: d.siren, nom: d.nom, ...out, checkedAt: Date.now() });
      stats.dossiers++;
      if (pause) await sleep(pause);
    }
    AC.done = AC.total;
    await send({ type: 'ac:done', stats, stopped: AC.stop, duree: Math.round((Date.now() - t0) / 1000), annee: opts.annee, scope: opts.scope || null, complet });
  } catch (e) {
    await send({ type: 'ac:error', text: e.message, stats });
  } finally {
    AC.running = false;
  }
}

// Ouvrir un dossier sur le site (bouton « impots.gouv » de l'application) : sélection du dossier puis page demandée
const PAGES = { accueil: () => BASE + '/mire/accueil.do', tf: () => TF_URL, cfe: () => AVIS_URL, dettes: () => DETTES_URL };
async function gotoDossier(siren, page) {
  if (AC.running) return { ok: false, error: 'Une mise à jour est en cours dans cet onglet : réessayez à la fin.' };
  const token = await getToken();
  await selectDossier(token, siren);
  setTimeout(() => { location.href = (PAGES[page] || PAGES.accueil)(); }, 60);
  return { ok: true };
}

// Bandeau discret sur le site : actions en attente pour le dossier affiché
function siretAffiche() {
  const t = document.body ? document.body.innerText : '';
  return (t.match(/SIREN ou IDSP\s*:?\s*(\d{9})/) || t.match(/Dossier sélectionné[\s\S]{0,120}?SIREN\s*(\d{9})/) || [])[1] || null;
}
async function bandeau() {
  try {
    if (window.top !== window || document.getElementById('avis-collector-bandeau')) return;
    const siren = siretAffiche(); if (!siren) return;
    const r = await chrome.runtime.sendMessage({ type: 'ac:siteInfo', siren }).catch(() => null);
    if (!r || !r.n) return;
    const host = document.createElement('div'); host.id = 'avis-collector-bandeau';
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483000;';
    const sh = host.attachShadow({ mode: 'closed' });
    const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    sh.innerHTML = `<style>
      .b{font:13.5px/1.4 "Segoe UI",system-ui,sans-serif;background:#16181D;color:#fff;border-radius:12px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.25);max-width:340px;display:flex;gap:10px;align-items:flex-start}
      .l{width:26px;height:26px;border-radius:7px;background:#1F3B6E;display:grid;place-items:center;flex:none}
      .t b{display:block;font-size:14px} .t span{color:#C9CBD1;font-size:12.5px}
      .a{display:flex;gap:8px;margin-top:8px} button{font:inherit;border:0;border-radius:8px;padding:6px 11px;cursor:pointer}
      .o{background:#1F3B6E;color:#fff} .x{background:transparent;color:#C9CBD1}
    </style><div class="b"><div class="l"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l4 4v14H7z"/><path d="M10 13l2 2 4-4"/></svg></div>
      <div class="t"><b>${r.n} action${r.n > 1 ? 's' : ''} pour ce client</b><span>${esc(r.resume)}</span><div class="a"><button class="o">Ouvrir la fiche</button><button class="x">Masquer</button></div></div></div>`;
    sh.querySelector('.o').onclick = () => chrome.runtime.sendMessage({ type: 'ac:openApp', hash: 'client/' + siren }).catch(() => {});
    sh.querySelector('.x').onclick = () => { host.remove(); chrome.runtime.sendMessage({ type: 'ac:hideBanner', siren }).catch(() => {}); };
    document.documentElement.appendChild(host);
  } catch {}
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'ac:habilitations') {
    if (AC.running) { reply({ ok: false, error: 'Une mise à jour est en cours : lisez les habilitations une fois terminée.' }); return; }
    AC.running = true; reply({ ok: true });
    (async () => {
      try { const token = await getToken(); const r = await getHabilitations(token, (t) => send({ type: 'ac:habilStep', text: t })); await send({ type: 'ac:habil', data: r }); }
      catch (e) { send({ type: 'ac:habilStep', error: e.message }); }
      finally { AC.running = false; }
    })();
    return;
  }
  if (msg.type === 'ac:goto') { gotoDossier(msg.siren, msg.page).then(reply, (e) => reply({ ok: false, error: e.message })); return true; }
  if (msg.type === 'ac:ping') { reply(pageState()); return; }
  if (msg.type === 'ac:detect') { detect().then(reply, (e) => reply({ ok: false, error: e.message })); return true; }
  if (msg.type === 'ac:start') { if (!AC.running) collect(msg.opts || {}); reply({ started: true }); return; }
  if (msg.type === 'ac:stop') { AC.stop = true; reply({ ok: true }); return; }
});

// Signale au service d'arrière-plan qu'une page de l'espace professionnel est ouverte (pastille sur l'icône)
send({ type: 'ac:pageSeen', state: pageState() });
setTimeout(bandeau, 600);
