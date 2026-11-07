// Relève — Valeur locative : page « Valeur locative », bloc de la fiche client, simulateur, brouillons, export, relecture des avis.
// S'appuie sur lib/vl.js (calcul et statuts), lib/avistf.js (détail par adresse des avis) et lib/pdftext.js (relecture des PDF déjà sur le poste).
// Deux niveaux de lecture : « Essentiel » (phrase simple, calcul en escalier, questions à poser) et « Expert » (chaîne de calcul complète).
'use strict';
const VL = { dep: {}, locaux: [], erreursDep: {}, migration: null, filtre: null };
const VERDICT = { ROUGE: ['bad', 'Anomalie probable'], ORANGE: ['warn', 'À vérifier'], VERT: ['ok', 'Conforme'], GRIS: ['', 'Sans avis rapproché'], EXCLU: ['', 'Écarté'], HORS: ['', 'Hors champ'], ERREUR: ['', 'Non calculé'] };
const vlKey = (siren, inv) => siren + '|' + inv;
const vlSaisie = (siren, inv) => (A.data.vl || {})[vlKey(siren, inv)] || {};
async function vlSave(siren, inv, patch) {
  const all = { ...(A.data.vl || {}) }; const k = vlKey(siren, inv);
  all[k] = { ...(all[k] || {}), ...patch, at: Date.now() };
  for (const [kk, v] of Object.entries(patch)) if (v === null || v === '' || v === undefined) delete all[k][kk];
  await ACDB.put('meta', { key: 'vl', data: all }); A.data.vl = all;
}
const fmtM2 = (n) => (Number(n) || 0).toLocaleString('fr-FR') + ' m²';
const fmtK = (n) => Math.round(n || 0).toLocaleString('fr-FR');
const fmt2 = (n) => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const catPill = (c, cls = 'pill') => c ? `<span class="${cls}" title="${esc(ACVL.CATEGORIES[c] || '')}">${esc(c)}</span>${ACVL.COURT[c] ? ` <span class="tiny muted">${esc(ACVL.COURT[c])}</span>` : ''}` : '';
const vlExpert = () => A.S.vlNiveau === 'expert';
const vlStatut = (l) => ACVL.statut(l);

// ---- Préparation : analyse de tous les locaux professionnels lus dans GMBI (lib/vl.js) ----
async function vlCompute() {
  VL.locaux = await ACVL.portefeuille({ biens: A.data.biens || [], avis: A.data.avis, saisies: A.data.vl || {}, annee: A.c.annee, correspondance: A.S.correspondance || {}, cache: VL.dep, erreurs: VL.erreursDep });
  for (const l of VL.locaux) l.st = vlStatut(l);
  VL.locaux.sort((x, y) => x.st.ordre - y.st.ordre || (y.st.enjeu || 0) - (x.st.enjeu || 0) || (y.analyse && y.analyse.ref ? y.analyse.ref.base : 0) - (x.analyse && x.analyse.ref ? x.analyse.ref.base : 0));
  return VL.locaux;
}
const vlScope = () => { const s = scopeMoi() ? new Set(scopeSirens()) : null; return VL.locaux.filter((l) => (!s || s.has(l.siren)) && match(l.nom, l.siren, l.adresse, l.ville, l.categorie)); };
const vlDossiersSans = () => (A.data.biens || []).filter((r) => r.indispo);
const vlBiensStats = () => { const recs = A.data.biens || []; return { dossiers: recs.length, pro: recs.reduce((s, r) => s + (r.biens || []).filter((b) => b.pro).length, 0), autres: recs.reduce((s, r) => s + (r.biens || []).filter((b) => !b.pro).length, 0), attendues: recs.reduce((s, r) => s + (r.attendues || []).length, 0), indispo: vlDossiersSans().length }; };

// ---- Relecture des avis déjà sur le poste (avis lus avant la 6.0 : le détail par adresse n'était pas extrait) ----
async function vlMigrer() {
  if (VL.migration) return VL.migration;
  const aFaire = A.data.avis.filter((a) => a.taxe === 'TF' && a.hasPdf && !(a.infos && a.infos.detail && Array.isArray(a.infos.detail.locaux)) && !(a.infos && a.infos.vlRelu));
  if (!aFaire.length) return null;
  VL.migration = (async () => {
    let n = 0;
    for (const a of aFaire) {
      try {
        const p = await ACDB.get('pdfs', a.id); if (!p || !p.blob) { a.infos = { ...(a.infos || {}), vlRelu: 1 }; await ACDB.put('avis', a); continue; }
        const txt = await ACPDF.pdfText(p.blob);
        let locaux = ACTF.locaux(txt);
        if (!locaux.length && p.suite) locaux = ACTF.feuillets(await ACPDF.pdfText(p.suite));
        const detail = { ...((a.infos && a.infos.detail) || { anneeN1: '', anneeN: '', lignes: [] }), locaux, entete: ACTF.enTete(txt) };
        a.infos = { ...(a.infos || {}), detail, vlRelu: 1 };
        await ACDB.put('avis', a);
      } catch (e) { a.infos = { ...(a.infos || {}), vlRelu: 1 }; try { await ACDB.put('avis', a); } catch {} }
      n++;
      if (n % 25 === 0) { const e = $('#vlMig'); if (e) e.textContent = `Relecture des avis déjà sur ce poste : ${n} / ${aFaire.length}…`; }
    }
    VL.migration = null;
    await load(); render();
    toast(`${plural(n, 'avis relu')} : contrôle de la valeur locative à jour`);
  })();
  return VL.migration;
}

// ---- Ce qu'il faut faire pour un local, en une ligne ----
function vlAction(l) {
  const st = l.st || vlStatut(l), k = st.k;
  if (k === 'TROP') return { lib: 'Préparer la réclamation', do: 'reclam', ico: 'edit', detail: 'Faire confirmer l’usage et les surfaces par le client, puis réclamer (délai : 31/12 de l’année suivant l’avis).' };
  if (k === 'PISTE') return { lib: 'Demander le relevé de propriété', do: 'releve', ico: 'doc', detail: 'Le relevé de propriété donne la base de chaque local : il dira d’où vient l’écart.' };
  if (k === 'QUESTION') return { lib: 'Poser la question au client', do: 'question', ico: 'mail', detail: st.signal ? st.signal.question : '' };
  if (k === 'MANQUE') return { lib: 'Attendre l’avis', do: null, ico: 'clock', detail: 'Relève comparera dès qu’un avis de taxe foncière à cette adresse sera lu.' };
  if (k === 'NONCALC') return { lib: 'Compléter la fiche', do: 'sim', ico: 'edit', detail: st.raison || '' };
  if (k === 'FAVORABLE') return { lib: 'Ne rien faire', do: null, ico: 'check', detail: 'Une réclamation risquerait d’augmenter la taxe.' };
  if (k === 'OK') return { lib: 'Rien à faire', do: null, ico: 'check', detail: '' };
  return { lib: '', do: null, ico: '', detail: '' };
}
const vlPillHtml = (st, cls = '') => `<span class="pill vlst ${st.ton} ${cls}" title="${esc(st.phrase)}">${esc(st.lib)}</span>`;

// ---- Page « Valeur locative » ----
function pageValeurLocative() {
  const st = vlBiensStats(), L = vlScope();
  const an = A.c.annee;
  const parK = {}; for (const l of L) (parK[l.st.k] = parK[l.st.k] || []).push(l);
  const n = (k) => (parK[k] || []).length;
  const enjeuTrop = (parK.TROP || []).reduce((s, l) => s + (l.st.enjeu || 0), 0), enjeuPiste = (parK.PISTE || []).reduce((s, l) => s + (l.st.enjeu || 0), 0);
  const aRelire = A.data.avis.filter((a) => a.taxe === 'TF' && a.hasPdf && !(a.infos && a.infos.detail && Array.isArray(a.infos.detail.locaux)) && !(a.infos && a.infos.vlRelu)).length;
  const niveau = `<div class="seg vlniv" title="Niveau de lecture"><button class="${vlExpert() ? '' : 'on'}" data-niv="essentiel">Essentiel</button><button class="${vlExpert() ? 'on' : ''}" data-niv="expert">Expert</button></div>`;
  if (!st.dossiers) return `<div class="ph"><div><h1>Valeur locative des locaux professionnels</h1><div class="sub">Vos clients paient-ils la bonne taxe foncière ? Relève refait le calcul de l’administration, local par local.</div></div></div>
  <div class="card empty"><b>Aucun bien immobilier lu pour l’instant.</b><p class="small muted" style="margin:6px 0 0">Lancez une mise à jour depuis le volet latéral : Relève lit « Gérer mes biens immobiliers » pour chaque dossier (surfaces, catégorie, parcelle de chaque local professionnel), puis recalcule la base de chaque avis de taxe foncière au tarif officiel du département. Vérifiez dans Réglages que la lecture des biens immobiliers est activée.</p><p class="small muted" style="margin:6px 0 0">${vlMethodeLien()}</p></div>`;
  const F = VL.filtre, Lf = F ? L.filter((l) => l.st.k === F) : L;
  const tuile = (k, extra = '') => { const S = ACVL.STATUTS[k]; return `<button class="kpi card vlt ${S.ton} ${F === k ? 'on' : ''} ${n(k) ? '' : 'vide'}" data-filtre="${k}"><span class="tiny muted">${esc(S.lib)}</span><b class="num" data-count="${n(k)}">${n(k)}</b><span class="tiny muted">${extra || esc(S.phrase)}</span></button>`; };
  const todo = [['TROP', 'Préparer la réclamation', 'edit'], ['PISTE', 'Demander le relevé de propriété', 'doc'], ['QUESTION', 'Poser la question au client', 'mail'], ['NONCALC', 'Compléter la fiche', 'edit']].filter(([k]) => n(k));
  return `<div class="ph"><div><h1>Valeur locative des locaux professionnels</h1><div class="sub">Vos clients paient-ils la bonne taxe foncière ? Relève refait le calcul de l’administration pour ${plural(st.pro, 'local professionnel', 'locaux professionnels')} dans ${plural(st.dossiers, 'dossier')} (base ${an}).</div></div>
    <div class="r">${niveau}<button class="btn" id="vlTourBtn" title="Visite guidée de 2 minutes">${IC.chat} Visite guidée</button><button class="btn" data-exp="vlxlsx">${IC.down} Classeur des locaux</button></div></div>
  ${aRelire ? `<div class="verdict info" id="vlMig" style="margin-bottom:12px">${plural(aRelire, 'avis de taxe foncière')} déjà sur ce poste ${aRelire > 1 ? 'sont relus' : 'est relu'} pour en extraire le détail par adresse… Les résultats se complètent au fur et à mesure.</div>` : ''}
  <div class="card vlhero ${enjeuTrop ? 'bad' : enjeuPiste ? 'warn' : 'ok'}" id="vlHero">
    <div class="vlhero-main">${enjeuTrop ? `<div class="tiny">Trop payé probable, chaque année</div><div class="vlhero-num num"><span data-count="${Math.round(enjeuTrop)}">${fmtK(enjeuTrop)}</span> €</div><div class="small">sur ${plural(n('TROP'), 'local')} : la base de l’avis est supérieure à ce que donne la grille officielle avec les bonnes catégories et surfaces. ${enjeuPiste ? `Et ${fmtK(enjeuPiste)} € de plus à creuser sur ${plural(n('PISTE'), 'local')}.` : ''}</div>`
      : enjeuPiste ? `<div class="tiny">À creuser, chaque année</div><div class="vlhero-num num"><span data-count="${Math.round(enjeuPiste)}">${fmtK(enjeuPiste)}</span> €</div><div class="small">sur ${plural(n('PISTE'), 'local')} : l’avis dépasse notre recalcul, sans que la fiche du local explique pourquoi. Le relevé de propriété tranchera.</div>`
      : `<div class="tiny">Résultat</div><div class="vlhero-num">Rien d’anormal</div><div class="small">Les bases des avis sont retrouvées au tarif officiel${n('QUESTION') ? `, avec ${plural(n('QUESTION'), 'question')} à poser` : ''}.</div>`}</div>
    <div class="vlhero-how small"><b>Comment ça marche</b><ol><li>Relève lit la fiche de chaque local (surfaces, catégorie) dans « Gérer mes biens immobiliers ».</li><li>Elle refait le calcul de l’administration avec la grille officielle du département.</li><li>Elle compare à la base imprimée sur l’avis : si l’avis est plus haut, le client paie trop.</li></ol></div>
  </div>
  <div class="kpis vlkpis" id="vlStatuts" style="margin-bottom:14px">
    ${tuile('TROP', enjeuTrop ? `${fmtK(enjeuTrop)} € par an, réclamation à préparer` : '')}${tuile('PISTE', enjeuPiste ? `${fmtK(enjeuPiste)} € par an à confirmer` : '')}${tuile('QUESTION')}${tuile('OK', `${n('FAVORABLE') ? plural(n('FAVORABLE'), 'avis plus bas que la grille', 'avis plus bas que la grille') + ' · ' : ''}${n('MANQUE') ? plural(n('MANQUE'), 'avis manquant') + ' · ' : ''}${n('NONCALC') ? plural(n('NONCALC'), 'non calculé') + ' · ' : ''}${st.indispo ? plural(st.indispo, 'dossier') + ' sans accès' : ''}`.replace(/ · $/, '') || 'rien à faire')}
  </div>
  ${todo.length ? `<div class="card vltodo" id="vlTodo"><div class="hd"><h3 style="margin:0">À faire</h3><span class="small muted">dans l’ordre des enjeux</span></div><div class="vltodo-list">${todo.map(([k, lib, ico], i) => `<button class="vltodo-item" data-filtre="${k}" style="--i:${i}"><span class="vltodo-n ${ACVL.STATUTS[k].ton}">${n(k)}</span><span><b>${lib}</b><div class="tiny muted">${esc(ACVL.STATUTS[k].lib)} · ${(parK[k] || []).slice(0, 3).map((l) => esc(l.nom)).join(', ')}${n(k) > 3 ? '…' : ''}</div></span><span class="muted">${IC.chevron}</span></button>`).join('')}</div></div>` : ''}
  <div class="card" id="vlTable">${F ? `<div class="vlfiltre small"><span>${vlPillHtml(ACVL.STATUTS[F] ? { ...ACVL.STATUTS[F] } : {})} ${plural(Lf.length, 'local')}</span><button class="btn ghost sm" data-filtre="">Tout afficher</button></div>` : ''}
  <table class="t vltab"><thead><tr><th>Client</th><th>Local</th><th>Catégorie</th><th>Résultat</th><th class="r">Avis</th><th class="r">Recalcul</th><th class="r">Enjeu / an</th><th>À faire</th></tr></thead><tbody>
  ${Lf.map((l, i) => { const s = l.st, ref = l.analyse && l.analyse.ref, calc = l.analyse && l.analyse.calcul, g = l.analyse && l.analyse.groupe, act = vlAction(l);
    return `<tr class="vlrow" style="--i:${Math.min(i, 20)}" data-go="#client/${l.siren}/vl"><td><a href="#client/${l.siren}/vl"><b>${esc(l.nom)}</b></a>${l.code ? `<div class="tiny muted">Dossier ${esc(l.code)}${l.collab ? ' · ' + esc(l.collab) : ''}</div>` : ''}</td><td>${esc(l.adresse)}<div class="tiny muted">${esc(l.ville)}${l.droit && !/Propri/.test(l.droit) ? ' · ' + esc(l.droit) : ''}</div></td><td class="small">${l.categorie && l.categorie !== 'HORS' ? `${esc(ACVL.COURT[l.categorie] || l.categorieLibelle)}<div class="tiny muted" title="${esc(l.categorieLibelle)}">${l.categorie}</div>` : esc(l.categorieLibelle)}</td><td>${vlPillHtml(s)}${s.k === 'NONCALC' ? `<div class="tiny muted">${esc(s.raison || '')}</div>` : ''}</td><td class="r num">${ref ? fmtK(ref.base) : '—'}${g ? `<div class="tiny muted">${g.nb} locaux</div>` : ''}</td><td class="r num">${s.k === 'TROP' && s.signal && s.signal.simulation ? `<span class="ok">${fmtK(s.signal.simulation.baseGroupe || s.signal.simulation.base)}</span><div class="tiny muted">si corrigé</div>` : `${g ? fmtK(g.base) : calc ? fmtK(calc.base) : '—'}`}${s.k !== 'TROP' && l.analyse && l.analyse.ecart !== null && l.analyse.ecart !== undefined ? `<div class="tiny ${l.analyse.ecart < -0.05 ? 'up' : 'muted'}">${pcv(l.analyse.ecart * 100)}</div>` : ''}</td><td class="r num ${s.enjeu > 100 ? (s.ton === 'bad' ? 'up' : 'warnc') : ''}">${s.enjeu > 100 ? (s.certitude === 'possible' ? '≈ ' : '') + fmtK(s.enjeu) + ' €' : ''}</td><td class="small">${act.do ? `<a href="#client/${l.siren}/vl" class="vlact">${IC[act.ico] || ''} ${act.lib}</a>` : `<span class="muted">${act.lib}</span>`}</td></tr>`; }).join('')}
  ${!Lf.length ? '<tr><td colspan="8" class="muted">Aucun local professionnel dans ce périmètre.</td></tr>' : ''}</tbody></table></div>
  ${st.indispo ? `<div class="card av" style="margin-top:14px"><h3>Dossiers sans accès aux biens immobiliers (${st.indispo})</h3><p class="small muted" style="margin:0 0 8px">Le service « Gérer mes biens immobiliers » n’est pas délégué au cabinet pour ces dossiers : demandez au client la délégation (ou le descriptif de ses locaux).</p><div class="small">${vlDossiersSans().slice(0, 60).map((r) => `<a href="#client/${r.siren}">${esc(r.nom)}</a>`).join(' · ')}${st.indispo > 60 ? ' …' : ''}</div></div>` : ''}
  ${vlLexique()}
  <p class="tiny muted" style="margin-top:14px">${vlMethodeLien()}</p>`;
}
const vlLexique = () => `<details class="card" style="margin-top:14px" id="lexique"><summary><b>Comprendre les termes</b> <span class="small muted">catégories, surface pondérée, tarif, neutralisation, planchonnement, statuts…</span></summary>
  <div class="grid2 small" style="margin-top:10px;gap:14px">
    <div>
      <p><b>Les statuts</b> — ${vlPillHtml(ACVL.STATUTS.TROP)} un défaut précis de la fiche (catégorie, surface, classement) fait payer plus de 100 € de trop par an : on sait quoi réclamer. ${vlPillHtml(ACVL.STATUTS.PISTE)} l’avis dépasse notre recalcul de plus de 5 % sans que la fiche l’explique : l’enjeu est réel mais il faut le relevé de propriété pour en trouver la cause. ${vlPillHtml(ACVL.STATUTS.QUESTION)} un point de la fiche mérite confirmation du client avant de conclure. ${vlPillHtml(ACVL.STATUTS.OK)} la base de l’avis est retrouvée. ${vlPillHtml(ACVL.STATUTS.FAVORABLE)} l’avis est plus bas que la grille : surtout ne rien réclamer. ${vlPillHtml(ACVL.STATUTS.MANQUE)} pas d’avis à cette adresse sur le poste.</p>
      <p><b>Catégorie (MAG1, BUR2, ATE1…)</b> — l’administration range chaque local professionnel dans une des 38 catégories de la grille. <b>MAG</b> = magasins, <b>BUR</b> = bureaux, <b>DEP</b> = dépôts et parkings, <b>ATE</b> = ateliers, <b>HOT</b> = hôtels, <b>SPE</b> = sport et spectacle, <b>ENS</b> = enseignement, <b>CLI</b> = cliniques. Le chiffre précise le type : MAG1 boutique de moins de 400 m², MAG4 magasin de 400 à 2 499 m², MAG5 au-delà. Chaque catégorie a son tarif au m² : une erreur de catégorie change la taxe du simple au double.</p>
      <p><b>Surface pondérée</b> — la surface principale compte pour 1, les surfaces secondaires couvertes (réserves, sanitaires) pour 0,5, les non couvertes pour 0,2, les parkings couverts 0,5 et non couverts 0,2. C’est elle qui est multipliée par le tarif.</p>
    </div>
    <div>
      <p><b>Secteur tarifaire</b> — chaque commune est découpée en secteurs ; le tarif d’une catégorie dépend du secteur où se trouve la section cadastrale du local. <b>Coefficient de localisation</b> : ajustement de ± 30 % au plus, parcelle par parcelle.</p>
      <p><b>Valeur locative brute</b> — surface pondérée × tarif × coefficient de localisation : le loyer annuel théorique du local selon la grille. <b>Neutralisation</b> : coefficient propre à chaque commune (souvent 0,2 à 0,4) qui ramène la valeur révisée de 2017 au niveau des anciennes valeurs.</p>
      <p><b>Planchonnement</b> — pour les locaux qui existaient au 1<sup>er</sup> janvier 2017, la valeur retenue est la moyenne entre la valeur révisée neutralisée et l’ancienne valeur locative (dite « 1970 »). Relève reconstitue cette ancienne valeur à partir de la ligne « cotisation lissée » de l’avis.</p>
      <p><b>Base</b> — moitié de la valeur locative retenue ; c’est le montant imprimé sur l’avis, auquel s’appliquent les taux des collectivités. <b>Enjeu par an</b> : taxe réelle × (1 − base corrigée ÷ base de l’avis), c’est-à-dire l’économie annuelle si l’hypothèse est retenue. Une réclamation porte sur l’année en cours et la précédente.</p>
    </div>
  </div></details>`;
const vlMethodeLien = () => `Méthode : surface pondérée × tarif de la catégorie dans le secteur de la section cadastrale × coefficient de localisation, puis coefficient de neutralisation de la commune et, pour les locaux existant au 1<sup>er</sup> janvier 2017, planchonnement avec l’ancienne valeur locative reconstituée depuis la ligne de lissage de l’avis (art. 1498 et 1518 A quinquies CGI). Paramètres : impots.gouv.fr, « Révision des valeurs locatives des locaux professionnels ». <a href="https://releveavis.netlify.app/valeur-locative.html" target="_blank" rel="noopener">La démarche en détail</a>.`;
function bindValeurLocative(arg) {
  $$('[data-exp]').forEach((b) => b.onclick = () => doExport(b.dataset.exp, b));
  $$('[data-filtre]').forEach((b) => b.onclick = () => { VL.filtre = b.dataset.filtre || null; page(); const t = $('#vlTable'); if (t && VL.filtre) t.scrollIntoView({ behavior: calme() ? 'auto' : 'smooth', block: 'start' }); });
  $$('[data-niv]').forEach((b) => b.onclick = async () => { A.S = await ACDB.saveSettings({ vlNiveau: b.dataset.niv }); A.data.settings = A.S; page(); });
  $$('.vlrow').forEach((r) => r.onclick = (ev) => { if (ev.target.closest('a')) return; location.hash = r.dataset.go; });
  const tb = $('#vlTourBtn'); if (tb) tb.onclick = () => vlTour(true);
  vlCountUp(); vlMigrer();
  if (String(arg || '') === 'lexique') { const e = $('#lexique'); if (e) { e.open = true; setTimeout(() => e.scrollIntoView({ block: 'start' }), 50); } }
  else if (!A.S.vlTourVu && vlBiensStats().dossiers) setTimeout(() => vlTour(false), 600);
}
// Compteurs qui montent (respecte la préférence « réduire les animations »)
function vlCountUp() {
  if (calme()) return;
  $$('[data-count]').forEach((e) => {
    const fin = Number(e.dataset.count) || 0; if (!fin) return;
    const t0 = performance.now(), d = Math.min(900, 300 + fin / 10);
    const f = (t) => { const p = Math.min(1, (t - t0) / d), v = Math.round(fin * (1 - Math.pow(1 - p, 3))); e.textContent = v.toLocaleString('fr-FR'); if (p < 1) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
}
// Visite guidée : 5 étapes sur l'écran réel
function vlTour(force) {
  const etapes = [
    ['#vlHero', 'Le résultat d’abord', 'Cette carte résume en une phrase ce que Relève a trouvé : combien vos clients paient probablement de trop, chaque année, et pourquoi. Le détail vient après, pour qui veut.'],
    ['#vlStatuts', 'Quatre statuts, pas plus', '« Trop payé probable » : on sait quoi réclamer et combien. « Trop payé possible » : l’avis dépasse notre recalcul, il faut le relevé de propriété pour trouver pourquoi. « Question au client » : un point à confirmer. « Rien à signaler » : la base est retrouvée. Cliquez sur une tuile pour filtrer la liste.'],
    ['#vlTodo', 'Ce qu’il reste à faire', 'Les actions sont triées par enjeu : préparer une réclamation, demander un relevé, poser une question. Relève rédige les brouillons ; vous relisez et envoyez.'],
    ['#vlTable', 'La liste des locaux', 'Chaque ligne compare la base de l’avis à notre recalcul. Cliquez sur une ligne : la fiche du local montre le calcul en escalier, les questions à poser au client et un simulateur pour tester une hypothèse.'],
    ['.vlniv', 'Deux niveaux de lecture', '« Essentiel » montre l’explication simple et le calcul en escalier. « Expert » ajoute la chaîne de calcul complète (tarif, coefficients, planchonnement) pour vérifier chaque chiffre. Le bouton « Visite guidée » rejoue ce parcours.'],
  ].filter(([sel]) => $(sel));
  if (!etapes.length) return;
  let i = 0; const ov = document.createElement('div'); ov.className = 'vltour'; ov.innerHTML = '<div class="vltour-spot"></div><div class="vltour-card card"><div class="tiny muted" data-n></div><h3 data-t></h3><p class="small" data-p></p><div class="vltour-ft"><button class="btn ghost sm" data-skip>Passer</button><span class="sp"></span><button class="btn sm" data-prev>Précédent</button><button class="btn sm primary" data-next>Suivant</button></div></div>';
  document.body.appendChild(ov);
  const fin = async () => { ov.classList.add('out'); setTimeout(() => ov.remove(), calme() ? 0 : 220); if (!A.S.vlTourVu) { A.S = await ACDB.saveSettings({ vlTourVu: Date.now() }); A.data.settings = A.S; } };
  const show = () => {
    const [sel, t, p] = etapes[i], el = $(sel); el.scrollIntoView({ behavior: calme() ? 'auto' : 'smooth', block: 'center' });
    setTimeout(() => {
      const r = el.getBoundingClientRect(), sp = ov.querySelector('.vltour-spot'), c = ov.querySelector('.vltour-card');
      Object.assign(sp.style, { top: r.top - 8 + 'px', left: r.left - 8 + 'px', width: r.width + 16 + 'px', height: r.height + 16 + 'px' });
      ov.querySelector('[data-n]').textContent = `Étape ${i + 1} sur ${etapes.length}`; ov.querySelector('[data-t]').textContent = t; ov.querySelector('[data-p]').textContent = p;
      const bas = r.bottom + 16 + 220 < innerHeight; c.style.top = (bas ? r.bottom + 16 : Math.max(16, r.top - 16 - c.offsetHeight)) + 'px'; c.style.left = Math.max(16, Math.min(innerWidth - 400, r.left)) + 'px';
      ov.querySelector('[data-prev]').disabled = i === 0; ov.querySelector('[data-next]').textContent = i === etapes.length - 1 ? 'Terminer' : 'Suivant';
    }, calme() ? 0 : 350);
  };
  ov.querySelector('[data-skip]').onclick = fin;
  ov.querySelector('[data-prev]').onclick = () => { if (i > 0) { i--; show(); } };
  ov.querySelector('[data-next]').onclick = () => { if (i < etapes.length - 1) { i++; show(); } else fin(); };
  ov.onclick = (ev) => { if (ev.target === ov) fin(); };
  requestAnimationFrame(() => ov.classList.add('in')); show();
}

// ---- Bloc de la fiche client ----
function vlClientBlock(siren) {
  const rec = (A.data.biens || []).find((r) => r.siren === siren);
  if (!rec) return '';
  const L = VL.locaux.filter((l) => l.siren === siren);
  const hab = (rec.biens || []).filter((b) => !b.pro);
  const enjeu = L.reduce((s, l) => s + (l.st.k === 'TROP' ? l.st.enjeu || 0 : 0), 0);
  if (rec.indispo) return `<div class="card av" id="vl"><h3>Valeur locative des locaux professionnels</h3><div class="verdict warn">Service « Gérer mes biens immobiliers » indisponible pour ce dossier : ${esc(rec.indispo)}. Demandez au client la délégation de ce service au cabinet, ou le descriptif de ses locaux.</div></div>`;
  return `<div class="card av" id="vl"><div class="hd"><div><h3 style="margin:0">Valeur locative des locaux professionnels</h3><div class="small muted"><a href="#valeur-locative/lexique" title="Comprendre les termes : catégories, surface pondérée, planchonnement…">Comprendre les termes</a> · ${plural(L.length, 'local professionnel', 'locaux professionnels')}${hab.length ? ` · ${plural(hab.length, 'autre bien')} (${[...new Set(hab.map((b) => b.type))].join(', ').toLowerCase()}) hors contrôle` : ''} · biens lus ${ago(rec.at)}</div></div>
    <div style="margin-left:auto;display:flex;gap:8px;align-items:center">${enjeu > 100 ? `<span class="pill bad vlst">Trop payé probable : ${fmtK(enjeu)} € par an</span>` : ''}<div class="seg vlniv"><button class="${vlExpert() ? '' : 'on'}" data-niv="essentiel">Essentiel</button><button class="${vlExpert() ? 'on' : ''}" data-niv="expert">Expert</button></div></div></div>
  ${(rec.attendues || []).length ? `<div class="verdict warn" style="margin-top:10px"><b>${plural(rec.attendues.length, 'déclaration attendue')} par l’administration</b> : ${rec.attendues.map((x) => esc(x.numero) + ' (' + esc(x.adresse) + ')').join(', ')}. Une construction ou des travaux non déclarés exposent à un rehaussement et font perdre l’exonération temporaire : à régulariser avant toute réclamation.</div>` : ''}
  ${L.map((l, i) => vlLocalHtml(l, i)).join('')}
  ${!L.length ? '<p class="small muted" style="margin:10px 0 0">Aucun local professionnel dans « Gérer mes biens immobiliers » pour ce dossier.</p>' : ''}</div>`;
}
// Phrase simple qui ouvre la fiche d'un local
function vlPhrase(l) {
  const st = l.st, a = l.analyse || {}, ref = a.ref, cot = ref ? (ref.cotisationTotale || ref.cotisation) : null, g = a.groupe;
  const ens = g ? ` (pour les ${g.nb} locaux de cette adresse)` : '';
  if (st.k === 'TROP') return `<b>Ce client paie probablement ≈ ${fmtK(st.enjeu)} € de trop par an.</b> ${st.signal ? esc(st.signal.titre) + '. ' : ''}En corrigeant, la base passerait de ${fmtK(ref.base)} € à ${fmtK(st.signal && st.signal.simulation ? (st.signal.simulation.baseGroupe || st.signal.simulation.base) : 0)} €${ens}, soit une taxe d’environ ${fmtK(cot - st.enjeu)} € au lieu de ${fmtK(cot)} €.`;
  if (st.k === 'PISTE') return `<b>L’avis est ${Math.abs(Math.round(a.ecart * 100))} % plus haut que notre recalcul</b>${ens} : base ${fmtK(ref.base)} € sur l’avis, ${fmtK(g ? g.base : a.calcul.base)} € d’après la grille officielle. Ça représente ≈ ${fmtK(st.enjeu)} € par an. Soit l’administration retient une surface ou une catégorie que la fiche ne montre pas, soit elle s’est trompée : le relevé de propriété le dira.`;
  if (st.k === 'QUESTION') return `<b>Un point à confirmer avant de conclure.</b> ${st.signal ? esc(st.signal.titre) + '. ' + esc(st.signal.texte) : ''}`;
  if (st.k === 'OK') return `<b>Rien d’anormal.</b> Notre recalcul au tarif officiel retrouve la base de l’avis${ens} (${fmtK(ref.base)} €, écart ${pcv(a.ecart * 100)})${a.reconstitution && a.reconstitution.planchonnement ? ' ; le planchonnement explique l’écart avec le tarif brut' : ''}.`;
  if (st.k === 'FAVORABLE') return `<b>L’avis est plus bas que ce que donnerait la grille</b>${ens} (${fmtK(ref.base)} € contre ${fmtK(g ? g.base : a.calcul.base)} €). C’est à l’avantage du client : ne rien réclamer, une révision pourrait augmenter la taxe.`;
  if (st.k === 'MANQUE') return `<b>Pas d’avis de taxe foncière à cette adresse sur ce poste.</b> Le recalcul est fait (base ${fmtK(a.calcul.base)} €) ; la comparaison se fera dès qu’un avis sera lu.`;
  if (st.k === 'NONCALC') return `<b>Relève n’a pas pu refaire le calcul.</b> ${esc(st.raison || '')}`;
  if (st.k === 'HORS') return `<b>Hors champ.</b> ${esc(st.phrase)}`;
  if (st.k === 'ECARTE') return `<b>Local écarté du contrôle.</b> ${l.note ? esc(l.note) : ''}`;
  return esc(st.phrase);
}
// Calcul « en escalier » : 5 marches lisibles
function vlEscalier(l) {
  const a = l.analyse || {}, c = a.calcul, g = a.groupe, ref = a.ref; if (!c) return '';
  const cot = ref ? (ref.cotisationTotale || ref.cotisation) : null, baseCmp = g ? g.base : c.base, baseAvis = ref ? ref.base : null;
  const taux = ref && baseAvis ? cot / baseAvis : null;
  const m = (i, t, v, s, cls = '') => `<div class="vlstep ${cls}" style="--i:${i}"><div class="tiny muted">${t}</div><div class="num vlstep-v">${v}</div><div class="tiny muted">${s}</div></div>`;
  const fl = '<div class="vlstep-arrow muted">→</div>';
  return `<div class="vlesc">
    ${m(0, 'Surface pondérée', fmtM2(l.sp), `${fmtM2(l.surfaces.p1 || 0)} principale${Object.keys(ACVL.POND).filter((k) => k !== 'p1' && l.surfaces[k]).length ? ' + annexes comptées 0,5 ou 0,2' : ''}`)}${fl}
    ${m(1, '× tarif de la catégorie', `${fmt2(c.detail[0] ? c.detail[0].tarif : 0)} €/m²`, `${esc(ACVL.COURT[l.categorie] || l.categorie)}, secteur ${c.secteur}${c.coefLoc !== 1 ? `, × ${Number(c.coefLoc).toLocaleString('fr-FR')} localisation` : ''}`)}${fl}
    ${m(2, 'Valeur locative', `${fmtK(c.neutralisee)} €`, `${fmtK(c.brute)} € bruts × ${Number(c.coefNeut).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} (neutralisation)`)}${fl}
    ${g ? m(3, `Base des ${g.nb} locaux`, `${fmtK(g.base)} €`, g.vl70 ? `moyenne avec l’ancienne valeur ${fmtK(g.vl70)} €, ÷ 2` : 'sans planchonnement, ÷ 2') : m(3, 'Base calculée', `${fmtK(c.base)} €`, c.vl70 ? `moyenne avec l’ancienne valeur ${fmtK(c.vl70)} €, ÷ 2` : 'valeur locative ÷ 2')}${fl}
    ${l.st.k === 'TROP' && l.st.signal && l.st.signal.simulation ? m(4, 'Base si corrigée', `${fmtK(l.st.signal.simulation.baseGroupe || l.st.signal.simulation.base)} €`, `${esc(l.st.signal.hypothese && l.st.signal.hypothese.categorie ? ACVL.COURT[l.st.signal.hypothese.categorie] || l.st.signal.hypothese.categorie : 'surfaces corrigées')} · ≈ ${fmtK(l.st.enjeu)} € de moins par an`, 'ok') + fl : ''}
    ${ref ? m(5, `Base ${ref.annee} de l’avis`, `${fmtK(baseAvis)} €`, `écart ${pcv(a.ecart * 100)} · taxe ${fmtK(cot)} €${taux ? ` (${(taux * 100).toFixed(1).replace('.', ',')} % de la base)` : ''}`, l.st.k === 'TROP' ? 'bad' : a.ecart < -0.05 ? 'bad' : a.ecart > 0.05 ? 'ok' : 'okk') : m(5, 'Base de l’avis', '—', 'aucun avis à cette adresse')}
  </div>`;
}
function vlChaine(l) {
  const an = l.analyse, calc = an && an.calcul, rec = an && an.reconstitution, ref = an && an.ref;
  if (!calc) return '';
  return `<details class="vlexp" ${vlExpert() ? 'open' : ''}><summary class="small">Chaîne de calcul complète</summary><table class="t vlchain"><tbody>
    <tr><td>Secteur tarifaire de la section ${esc(l.section || '')} <span class="muted" title="Chaque commune est découpée en secteurs d’évaluation ; le tarif d’une catégorie dépend du secteur de la section cadastrale.">?</span></td><td class="r">${calc.secteur}${calc.coefLoc !== 1 ? ` · coefficient de localisation ${Number(calc.coefLoc).toLocaleString('fr-FR')}` : ''}</td></tr>
    ${calc.detail.map((d) => `<tr><td>${esc(ACVL.nomCat(d.categorie))} : ${fmtM2(d.sp)} pondérés × ${fmt2(d.tarif)} €/m²</td><td class="r num">${fmtK(d.vl)} €</td></tr>`).join('')}
    <tr><td>Valeur locative brute</td><td class="r num">${fmtK(calc.brute)} €</td></tr>
    <tr><td>× coefficient de neutralisation (${Number(calc.coefNeut).toLocaleString('fr-FR', { maximumFractionDigits: 6 })})</td><td class="r num">${fmtK(calc.neutralisee)} €</td></tr>
    ${calc.vl70 ? `<tr><td>Planchonnement : moyenne avec l’ancienne valeur locative ${fmtK(calc.vl70)} € (reconstituée depuis le lissage de l’avis)</td><td class="r num">${fmtK(calc.planchonnee)} €</td></tr>` : (rec && !rec.planchonnement && !an.groupe ? '<tr><td class="muted">Pas de ligne de lissage sur l’avis : local récent ou avis postérieur à 2025 sans avis 2025 sur le poste</td><td></td></tr>' : '')}
    <tr><td><b>Base ${calc.annee} calculée (valeur locative ÷ 2)</b>${an.groupe ? ' <span class="muted">— ce local seul</span>' : ''}</td><td class="r num"><b>${fmtK(calc.base)} €</b></td></tr>
    ${an.groupe ? `<tr><td colspan="2" class="tiny muted" style="padding-top:10px">L’avis ne donne qu’une base pour les ${an.groupe.nb} locaux de cette adresse : comparaison sur l’ensemble</td></tr>
    <tr><td>Valeur locative neutralisée des ${an.groupe.calcules} locaux calculés${an.groupe.calcules < an.groupe.nb ? ` (sur ${an.groupe.nb})` : ''}</td><td class="r num">${fmtK(an.groupe.neutralisee)} €</td></tr>
    ${an.groupe.vl70 ? `<tr><td>Planchonnement : moyenne avec l’ancienne valeur locative de l’ensemble ${fmtK(an.groupe.vl70)} € (reconstituée depuis le lissage de l’avis)</td><td class="r num">${fmtK(an.groupe.planchonnee)} €</td></tr>` : '<tr><td class="muted">Pas de ligne de lissage sur l’avis : planchonnement non reconstitué</td><td></td></tr>'}
    <tr><td><b>Base ${calc.annee} calculée pour l’ensemble (valeur locative ÷ 2)</b></td><td class="r num"><b>${fmtK(an.groupe.base)} €</b></td></tr>` : ''}
    ${ref ? `<tr><td>Base ${ref.annee} de l’avis${an.groupe ? ` (${an.groupe.nb} locaux)` : ''}${ref.avisId ? ` · <button class="btn ghost sm" data-pdf="${esc(ref.avisId)}">Voir l’avis</button>` : ''}</td><td class="r num">${fmtK(ref.base)} € <span class="${Math.abs(an.ecart) > 0.05 ? 'up' : 'muted'}">(${pcv(an.ecart * 100)})</span></td></tr>` : '<tr><td class="muted">Aucun avis de taxe foncière rapproché à cette adresse sur ce poste</td><td></td></tr>'}
  </tbody></table></details>`;
}
function vlLocalHtml(l, i = 0) {
  const an = l.analyse || {}, st = l.st, id = esc(l.invariant), S = l.surfaces, act = vlAction(l), ref = an.ref, calc = an.calcul;
  const signaux = an.signaux || [], saisie = vlSaisie(l.siren, l.invariant), coches = saisie.coches || {};
  const occ = l.occupant || {};
  const catOpts = (() => { const fam = {}; for (const [c, lb] of Object.entries(ACVL.CATEGORIES)) (fam[c.slice(0, 3)] = fam[c.slice(0, 3)] || []).push([c, lb]); const noms = { MAG: 'Magasins et commerces', BUR: 'Bureaux', DEP: 'Dépôts et parkings', ATE: 'Ateliers', HOT: 'Hôtels et hébergement', SPE: 'Sport, spectacle, loisirs', ENS: 'Enseignement', CLI: 'Santé', IND: 'Industrie', EXC: 'Autres' }; return Object.entries(fam).map(([f, arr]) => `<optgroup label="${noms[f] || f}">${arr.map(([c, lb]) => `<option value="${c}" ${c === l.categorie ? 'selected' : ''}>${esc(ACVL.COURT[c] || lb)} (${c})</option>`).join('')}</optgroup>`).join(''); })();
  const questions = signaux.filter((s) => s.question).map((s) => ({ code: s.code, q: s.question, sim: s.hypothese && s.simulation ? s : null, gain: s.simulation && s.simulation.gain }));
  if (!questions.length && calc && st.k !== 'HORS') questions.push({ code: 'USAGE', q: `Le local sert-il bien de ${ACVL.COURT[l.categorie] || 'ce type de local'} ? (une partie en atelier, stockage ou bureaux change le tarif)` }, { code: 'SURF', q: `Les ${fmtM2(S.p1 || 0)} de surface principale sont-ils tous utilisés pour l’activité ? (réserves, sanitaires, parkings comptent moins)` });
  return `<div class="vlocal ${st.ton}" data-vl="${id}" style="--i:${i}">
    <div class="hd" style="margin-top:14px"><div><b>${esc(l.adresse)}</b> <span class="small muted">${esc(l.ville)} · parcelle ${esc(l.prefixe ? l.prefixe + ' ' : '')}${esc(l.section || '?')} ${esc(l.parcelle || '')}${l.lot ? ' · lot ' + esc(l.lot) : ''}${l.batiment ? ' · bât. ' + esc(l.batiment) : ''} · n° ${id}</span>
      <div class="small">${l.categorieDeclaree && l.categorie !== l.categorieDeclaree ? `Catégorie retenue ${catPill(l.categorie, 'pill acc')} <span class="muted">(fiche : ${ACVL.nomCat(l.categorieDeclaree)})</span>` : `${esc(ACVL.COURT[l.categorie] || l.categorieLibelle)}${l.categorie && l.categorie !== 'HORS' ? ` <span class="pill" title="${esc(l.categorieLibelle)}">${l.categorie}</span>` : ''}`}${l.droit && !/^Propri/.test(l.droit) ? ` <span class="pill acc">${esc(l.droit)}</span>` : ''}</div></div>
      <div>${vlPillHtml(st, st.k === 'TROP' ? 'pulse' : '')}</div></div>
    <div class="verdict vlverdict ${st.ton || 'info'}" style="margin-top:8px">${vlPhrase(l)}</div>
    ${vlEscalier(l)}
    <div class="grid2 vlgrid" style="margin-top:10px;align-items:start">
      <div><div class="tiny muted" style="margin-bottom:4px">${an.hypothese ? 'Surfaces retenues (votre hypothèse)' : 'Ce que dit la fiche « Gérer mes biens immobiliers »'}</div><table class="t"><tbody>${Object.keys(ACVL.POND).filter((k) => S[k]).map((k) => `<tr><td>${ACVL.LIB_SURF[k]}</td><td class="r num">${fmtM2(S[k])}</td><td class="r muted small">× ${ACVL.POND[k]}</td></tr>`).join('')}<tr><td><b>Surface pondérée</b></td><td class="r num"><b>${fmtM2(l.sp)}</b></td><td></td></tr></tbody></table>${vlChaine(l)}</div>
      <div>${questions.length ? `<div class="tiny muted" style="margin-bottom:4px">Questions à poser au client</div><div class="vlq">${questions.map((q) => `<label class="vlq-item"><input type="checkbox" data-coche="${esc(q.code)}" ${coches[q.code] ? 'checked' : ''}><span>${esc(q.q)}${q.sim ? ` <button class="btn ghost sm vlq-sim" data-simuler="${esc(q.code)}" title="Tester cette hypothèse dans le simulateur">Simuler${q.gain > 0 ? ` · ${fmtK(q.gain)} €/an` : ''}</button>` : ''}</span></label>`).join('')}</div>` : ''}
        ${signaux.length ? `<div class="tiny muted" style="margin:10px 0 4px">Pourquoi</div>${signaux.map((s) => `<div class="sig ${s.gravite >= 3 ? 'bad' : s.gravite === 2 ? 'warn' : ''}"><b>${esc(s.titre)}</b>${s.simulation && s.simulation.gain !== null ? ` — <span class="num ${s.simulation.gain > 0 ? 'ok' : 'muted'}">${s.simulation.gain > 0 ? 'enjeu ' + fmtK(s.simulation.gain) + ' € par an' : 'hypothèse défavorable (' + fmtK(-s.simulation.gain) + ' € de plus)'}</span>` : ''}<div class="small muted">${esc(s.texte)}</div></div>`).join('')}` : ''}
        <div class="vlactions">${act.do ? `<button class="btn primary sm" data-act="${act.do}" data-inv="${id}">${IC[act.ico] || ''} ${act.lib}</button>` : ''}${act.do !== 'question' && st.k !== 'OK' && st.k !== 'FAVORABLE' && calc ? `<button class="btn sm" data-act="question" data-inv="${id}">${IC.mail} Question au client</button>` : ''}${act.do !== 'releve' && ref ? `<button class="btn sm" data-act="releve" data-inv="${id}">${IC.doc} Relevé de propriété</button>` : ''}${act.do !== 'reclam' && st.k === 'PISTE' ? `<button class="btn sm" data-act="reclam" data-inv="${id}">${IC.edit} Brouillon de réclamation</button>` : ''}<button class="btn ghost sm" data-simexcl="${id}">${l.exclu ? 'Réintégrer ce local' : 'Écarter ce local'}</button></div>
        ${act.detail ? `<div class="tiny muted" style="margin-top:4px">${esc(act.detail)}</div>` : ''}</div>
    </div>
    <details class="vlsim" style="margin-top:10px" id="sim-${id}"><summary class="small">Tester une hypothèse (catégorie, surfaces), renseigner l’occupant</summary>
      <p class="tiny muted" style="margin:6px 0">Changez une valeur : l’effet sur la taxe s’affiche aussitôt. « Enregistrer » garde l’hypothèse et recalcule le statut ; la fiche déclarée reste consultable.</p>
      <div class="grid2" style="margin-top:4px">
        <div><label class="tiny muted">Type de local (catégorie)</label><select data-sim="categorie" style="width:100%">${catOpts}</select>
          <div class="grid2" style="margin-top:6px;gap:6px">${Object.keys(ACVL.POND).map((k) => `<label class="tiny muted">${ACVL.LIB_SURF[k]} <span class="muted">(× ${ACVL.POND[k]})</span><input type="number" min="0" step="1" data-sim="${k}" value="${S[k] || 0}" style="width:100%"></label>`).join('')}</div></div>
        <div><label class="tiny muted">Occupant (nom)<input data-sim="occNom" value="${esc(occ.nom || '')}" placeholder="Enseigne ou société" style="width:100%"></label>
          <label class="tiny muted" style="display:block;margin-top:6px">Code NAF de l’occupant <span class="muted">(sert à détecter un atelier classé en magasin, etc.)</span><input data-sim="occNaf" value="${esc(occ.naf || '')}" placeholder="ex. 45.20A" style="width:100%"></label>
          <label class="tiny muted" style="display:block;margin-top:6px">Classement hôtelier (étoiles, 0 = non classé)<input type="number" min="0" max="5" data-sim="etoiles" value="${l.etoiles ?? ''}" style="width:100%"></label>
          <label class="tiny muted" style="display:block;margin-top:6px">Note<input data-sim="note" value="${esc(l.note || '')}" placeholder="Réponse du client, pièce reçue…" style="width:100%"></label>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn sm primary" data-simok="${id}">Enregistrer et recalculer</button><button class="btn sm" data-simreset="${id}">Revenir à la fiche déclarée</button></div>
          <div class="small num vlsimres" data-simres="${id}"></div></div>
      </div></details>
  </div>`;
}
function bindVl(siren) {
  $$('[data-niv]').forEach((b) => b.onclick = async () => { A.S = await ACDB.saveSettings({ vlNiveau: b.dataset.niv }); A.data.settings = A.S; page(); });
  $$('[data-simok]').forEach((b) => b.onclick = async () => {
    const root = b.closest('.vlocal'), inv = b.dataset.simok, g = (k) => root.querySelector(`[data-sim="${k}"]`);
    const surfaces = {}; for (const k of Object.keys(ACVL.POND)) { const v = Number(g(k).value) || 0; if (v) surfaces[k] = v; }
    const occNom = g('occNom').value.trim(), occNaf = g('occNaf').value.trim().toUpperCase().replace(/^(\d{2})(\d{2}[A-Z])$/, '$1.$2'), et = g('etoiles').value;
    await vlSave(siren, inv, { categorie: g('categorie').value, surfaces, occupant: occNom || occNaf ? { nom: occNom, naf: occNaf } : null, etoiles: et === '' ? null : Number(et), note: g('note').value.trim() });
    await vlCompute(); page(); toast('Hypothèse enregistrée : statut recalculé');
  });
  $$('[data-simreset]').forEach((b) => b.onclick = async () => { await vlSave(siren, b.dataset.simreset, { categorie: null, surfaces: null }); await vlCompute(); page(); toast('Fiche déclarée rétablie'); });
  $$('[data-simexcl]').forEach((b) => b.onclick = async () => { const cur = vlSaisie(siren, b.dataset.simexcl); await vlSave(siren, b.dataset.simexcl, { exclu: !cur.exclu }); await vlCompute(); page(); });
  $$('[data-coche]').forEach((c) => c.onchange = async () => { const inv = c.closest('.vlocal').dataset.vl, cur = vlSaisie(siren, inv), coches = { ...(cur.coches || {}) }; if (c.checked) coches[c.dataset.coche] = Date.now(); else delete coches[c.dataset.coche]; await vlSave(siren, inv, { coches }); });
  $$('[data-simuler]').forEach((b) => b.onclick = (ev) => {
    ev.preventDefault(); const root = b.closest('.vlocal'), inv = root.dataset.vl, l = VL.locaux.find((x) => x.siren === siren && x.invariant === inv); if (!l) return;
    const s = (l.analyse.signaux || []).find((x) => x.code === b.dataset.simuler); if (!s || !s.hypothese) return;
    const d = root.querySelector('.vlsim'); d.open = true;
    if (s.hypothese.categorie) root.querySelector('[data-sim="categorie"]').value = s.hypothese.categorie;
    if (s.hypothese.surfaces) for (const k of Object.keys(ACVL.POND)) root.querySelector(`[data-sim="${k}"]`).value = Math.round(s.hypothese.surfaces[k] || 0);
    root.querySelector('[data-sim="categorie"]').dispatchEvent(new Event('change'));
    d.scrollIntoView({ behavior: calme() ? 'auto' : 'smooth', block: 'center' }); root.querySelector('.vlsimres').classList.add('flash'); setTimeout(() => root.querySelector('.vlsimres').classList.remove('flash'), 900);
  });
  $$('[data-act]').forEach((b) => b.onclick = () => { const l = VL.locaux.find((x) => x.siren === siren && x.invariant === b.dataset.inv); if (!l) return; if (b.dataset.act === 'sim') { const d = $(`#sim-${b.dataset.inv}`); if (d) { d.open = true; d.scrollIntoView({ behavior: calme() ? 'auto' : 'smooth', block: 'center' }); } } else vlBrouillon(b.dataset.act, l); });
  // Aperçu immédiat de l'hypothèse (sans enregistrer)
  $$('.vlocal').forEach((root) => {
    const inv = root.dataset.vl, l = VL.locaux.find((x) => x.siren === siren && x.invariant === inv); if (!l || !VL.dep[l.dep]) return;
    const res = root.querySelector('[data-simres]');
    const maj = () => {
      const surfaces = {}; for (const k of Object.keys(ACVL.POND)) { const v = Number(root.querySelector(`[data-sim="${k}"]`).value) || 0; if (v) surfaces[k] = v; }
      const cat = root.querySelector('[data-sim="categorie"]').value;
      const e = ACVL.evaluer(VL.dep[l.dep], { commune: l.commune, section: l.section, parcelle: l.parcelle, prefixe: l.prefixe, locaux: [{ categorie: cat, surfaces }], annee: l.analyse && l.analyse.calcul ? l.analyse.calcul.annee : Number(A.c.annee), vl70: l.analyse && l.analyse.calcul ? l.analyse.calcul.vl70 : null });
      if (e.erreur) { res.textContent = e.erreur; return; }
      const ref = l.analyse && l.analyse.ref, g = l.analyse && l.analyse.groupe;
      // Adresse partagée : l'effet se mesure sur la base de l'ensemble des locaux de l'adresse
      const baseCmp = g ? (g.vl70 ? 0.5 * (g.neutralisee - l.analyse.calcul.neutralisee + e.neutralisee + g.vl70) : g.neutralisee - l.analyse.calcul.neutralisee + e.neutralisee) / 2 : e.base;
      const cotRef = ref ? (ref.cotisationTotale || ref.cotisation) : null, cot = ref ? ACVL.cotisationPour(baseCmp, ref.base, cotRef) : null, delta = ref ? cotRef - cot : 0;
      res.innerHTML = `Avec cette hypothèse : base <b>${fmtK(e.base)} €</b>${g ? ` pour ce local, <b>${fmtK(baseCmp)} €</b> pour les ${g.nb} locaux de l’adresse` : ''}${ref ? ` (avis : ${fmtK(ref.base)} €) → taxe d’environ <b>${fmtK(cot)} €</b> au lieu de ${fmtK(cotRef)} €, soit <b class="${delta > 0 ? 'ok' : 'up'}">${delta > 0 ? fmtK(delta) + ' € de moins' : fmtK(-delta) + ' € de plus'} par an</b>` : ''}`;
      res.classList.remove('flash'); void res.offsetWidth; res.classList.add('flash');
    };
    root.querySelectorAll('[data-sim]').forEach((i) => { i.oninput = maj; i.onchange = maj; });
  });
}

// ---- Brouillons : réclamation, question au client, demande de relevé de propriété ----
function vlBrouillon(kind, l) {
  const a = l.analyse || {}, ref = a.ref, st = l.st, sig = A.S.signature ? '\n\n' + A.S.signature : '', nom = l.nom, siren = fmtSiren(l.siren), an = ref ? ref.annee : A.c.annee;
  const adresse = `${l.adresse}, ${l.ville}`, parc = `${l.prefixe ? l.prefixe + ' ' : ''}${l.section || ''} ${l.parcelle || ''}`.trim();
  let titre, texte, fichier, aide;
  if (kind === 'reclam') {
    const s = st.signal, hyp = s && s.hypothese, sim = s && s.simulation;
    const motif = hyp && hyp.categorie ? `ce local est évalué dans la catégorie ${ACVL.nomCat(l.categorieDeclaree || l.categorie)}, alors que son usage réel relève de la catégorie ${ACVL.nomCat(hyp.categorie)} [décrire l’usage : surface de vente, atelier, stockage, bureaux]` : hyp && hyp.surfaces ? `la surface principale retenue (${fmtM2(l.surfacesDeclarees.p1 || l.surfaces.p1)}) ne correspond pas à la consistance réelle du local [détailler les surfaces par nature : principale, secondaires couvertes et non couvertes, stationnement]` : `la base retenue (${ref ? fmtK(ref.base) + ' €' : '[base]'}) excède celle qui résulte de l’application de la grille tarifaire aux caractéristiques réelles du local [préciser : catégorie, surfaces]`;
    titre = `Réclamation · ${nom}`; fichier = `Reclamation_VL_${clean(nom)}_${an}.txt`;
    texte = `Objet : Réclamation – taxe foncière ${an} – ${l.ville} – local situé ${adresse} (n° ${l.invariant})\n\nMadame, Monsieur,\n\nNous intervenons en qualité d’expert-comptable de la société ${nom} (SIREN ${siren}), propriétaire du local professionnel situé ${adresse} (parcelle ${parc || '[parcelle]'}, local n° ${l.invariant}).\n\nL’avis de taxe foncière ${an} retient pour ce local une base d’imposition de ${ref ? fmtK(ref.base) + ' €' : '[base]'}. Or ${motif}.\n\nEn application des articles 1498 et 1518 A quinquies du code général des impôts et de l’article 310 Q de l’annexe II, la valeur locative d’un local professionnel résulte de l’application du tarif de sa catégorie, dans le secteur d’évaluation de la commune, à sa surface pondérée. Sur ces bases, la valeur locative de ce local ${sim ? `s’établit à environ ${fmtK((sim.baseGroupe || sim.base) * 2)} € (base ${fmtK(sim.baseGroupe || sim.base)} €)` : 'doit être réduite'}, soit une cotisation ${sim && sim.gain ? `inférieure d’environ ${fmtK(sim.gain)} € par an` : 'réduite en conséquence'}.\n\nNous vous demandons en conséquence de bien vouloir rectifier la catégorie et la surface pondérée de ce local, de prononcer le dégrèvement correspondant au titre de ${an}${an > 2017 ? ` et de ${an - 1}` : ''}, et de nous communiquer la fiche de calcul de la valeur locative révisée de ce local.\n\nPièces jointes : [plan coté / relevé de surfaces, bail, photographies, extrait Kbis, avis d’imposition].\n\nCette réclamation est présentée dans le délai prévu à l’article R*196-2 du livre des procédures fiscales.\n\nNous vous prions d’agréer, Madame, Monsieur, l’expression de nos salutations distinguées.${sig}`;
    aide = 'Relisez et complétez les passages entre crochets. À déposer par la messagerie sécurisée de l’espace professionnel (« Je dépose une réclamation ») ou par courrier au service des impôts. Relève ne dépose rien. Délai : jusqu’au 31 décembre de l’année qui suit l’avis.';
  } else if (kind === 'question') {
    const qs = (a.signaux || []).filter((s) => s.question).map((s) => '– ' + s.question);
    if (!qs.length) qs.push(`– À quoi sert exactement ce local aujourd’hui (vente, atelier, stockage, bureaux) et dans quelles proportions ?`, `– Les ${fmtM2(l.surfaces.p1 || 0)} de surface principale sont-ils tous utilisés pour l’activité ? Y a-t-il des réserves, sanitaires, parkings, surfaces non couvertes ?`);
    titre = `Question au client · ${nom}`; fichier = `Question_VL_${clean(nom)}.txt`;
    texte = `Objet : Votre taxe foncière – local ${l.adresse}\n\nBonjour,\n\nNous vérifions le calcul de la taxe foncière de ${nom} pour le local situé ${adresse}. L’administration l’évalue comme « ${ACVL.COURT[l.categorieDeclaree || l.categorie] || l.categorieLibelle} » avec ${fmtM2(l.surfacesDeclarees.p1 || l.surfaces.p1 || 0)} de surface principale${ref ? `, ce qui donne une taxe de ${fmtK(ref.cotisationTotale || ref.cotisation)} € par an` : ''}.\n\n${st.enjeu > 100 ? `Si la réalité est différente, la taxe pourrait baisser d’environ ${fmtK(st.enjeu)} € par an, pour cette année et la précédente. ` : ''}Pour le vérifier, pourriez-vous nous préciser :\n${qs.join('\n')}\n\nUn plan, le bail ou quelques photos nous aideraient beaucoup. Nous nous chargeons ensuite de la réclamation si elle est justifiée.\n\nMerci d’avance,${sig}`;
    aide = 'À envoyer au client par e-mail. Les réponses se notent dans « Tester une hypothèse » (note, occupant), et chaque question cochée est mémorisée.';
  } else {
    titre = `Demande de relevé de propriété · ${nom}`; fichier = `Demande_releve_propriete_${clean(nom)}.txt`;
    texte = `Objet : Demande de relevé de propriété – ${nom} – commune de ${l.ville}\n\nMadame, Monsieur,\n\nNous intervenons en qualité d’expert-comptable de la société ${nom} (SIREN ${siren}), propriétaire de locaux professionnels situés ${adresse} (parcelle ${parc || '[parcelle]'}).\n\nAfin de vérifier l’évaluation de ces locaux, nous vous remercions de bien vouloir nous communiquer le relevé de propriété de la société sur la commune de ${l.ville} (détail des locaux avec leur valeur locative et leur base d’imposition), ainsi que, pour le local n° ${l.invariant}, la fiche de calcul de sa valeur locative révisée (catégorie, surfaces pondérées, secteur, coefficients, planchonnement).\n\nNous vous prions d’agréer, Madame, Monsieur, l’expression de nos salutations distinguées.${sig}`;
    aide = 'À envoyer par la messagerie sécurisée de l’espace professionnel (« Je demande un document » ou message au service des impôts fonciers). Le relevé de propriété est gratuit et donne la base de chaque local : il tranche les écarts qu’un avis global ne permet pas d’expliquer.';
  }
  $('#sheet').innerHTML = `<div style="display:flex;align-items:center;gap:10px"><h2 style="margin:0;flex:1">${esc(titre)}</h2><button class="btn ghost sm" id="mclose" title="Fermer">✕</button></div>
    <p class="small muted" style="margin:8px 0 10px">${esc(adresse)} · ${vlPillHtml(st)}${st.enjeu > 100 ? ` · enjeu ≈ ${fmtK(st.enjeu)} € par an` : ''}</p>
    <textarea id="rtext" style="min-height:340px">${esc(texte)}</textarea>
    <div class="ft"><button class="btn primary" id="rcopy">${IC.copy} Copier le texte</button><button class="btn" id="rdl">${IC.down} Télécharger (.txt)</button>${ref && ref.avisId ? `<button class="btn" id="rpdf">${IC.doc} Avis PDF</button>` : ''}</div>
    <div class="tiny muted" style="margin-top:8px">${esc(aide)}</div>`;
  $('#modal').hidden = false;
  const close = () => { $('#modal').hidden = true; };
  $('#mclose').onclick = close; $('#modal').onclick = (ev) => { if (ev.target.id === 'modal') close(); };
  $('#rcopy').onclick = async () => { await navigator.clipboard.writeText($('#rtext').value); toast('Texte copié'); };
  $('#rdl').onclick = () => download(new TextEncoder().encode('﻿' + $('#rtext').value.replace(/\n/g, '\r\n')), fichier, 'text/plain');
  const rp = $('#rpdf'); if (rp) rp.onclick = () => openPdf(ref.avisId);
}

// ---- Export : classeur des locaux ----
function buildXlsxVl() {
  const L = vlScope();
  return buildWorkbook([{ name: 'Locaux', title: `Valeur locative des locaux professionnels · campagne ${A.c.annee}`, subtitle: `${scopeMoi() ? 'Mon portefeuille' : 'Tout le cabinet'} · extrait le ${new Date().toLocaleDateString('fr-FR')} · Relève`, tab: true,
    cols: [{ h: 'Client', w: 30, style: () => 6 }, { h: 'SIREN', w: 12 }, { h: 'Code', w: 10 }, { h: 'Collaborateur', w: 14 }, { h: 'Adresse', w: 30 }, { h: 'Commune', w: 22 }, { h: 'Parcelle', w: 12 }, { h: 'N° local', w: 14 }, { h: 'Droit', w: 16 }, { h: 'Statut', w: 22, style: (v) => /Trop payé probable/.test(v) ? 9 : /Rien à signaler/.test(v) ? 8 : undefined }, { h: 'Enjeu / an', w: 12, t: 'eur' }, { h: 'À faire', w: 30 }, { h: 'Catégorie', w: 9 }, { h: 'Libellé', w: 34 }, { h: 'P1', w: 8, t: 'n' }, { h: 'P2 couv.', w: 8, t: 'n' }, { h: 'P2 non couv.', w: 9, t: 'n' }, { h: 'PK couv.', w: 8, t: 'n' }, { h: 'PK non couv.', w: 9, t: 'n' }, { h: 'Surface pondérée', w: 10, t: 'n' }, { h: 'Secteur', w: 8 }, { h: 'Tarif €/m²', w: 9, t: 'n' }, { h: 'VL brute', w: 11, t: 'eur' }, { h: 'VL neutralisée', w: 11, t: 'eur' }, { h: 'VL 1970 reconstituée', w: 12, t: 'eur' }, { h: 'Base calculée', w: 11, t: 'eur' }, { h: 'Base avis', w: 11, t: 'eur' }, { h: 'Écart', w: 8, t: 'pct' }, { h: 'Points à vérifier', w: 90, t: 'long' }, { h: 'Questions au client', w: 90, t: 'long' }, { h: 'Note', w: 40, t: 'long' }],
    rows: L.map((l) => { const a = l.analyse || {}, c = a.calcul, st = l.st, g = a.groupe; return [l.nom, l.siren, l.code, l.collab, l.adresse, l.ville, `${l.section || ''} ${l.parcelle || ''}`.trim(), l.invariant, l.droit, st.lib, st.enjeu > 100 ? Math.round(st.enjeu) : '', vlAction(l).lib, l.categorie, l.categorieLibelle, l.surfaces.p1 || '', l.surfaces.p2c || '', l.surfaces.p2nc || '', l.surfaces.pk1 || '', l.surfaces.pk2 || '', Math.round(l.sp * 10) / 10, c ? c.secteur : '', c && c.detail[0] ? c.detail[0].tarif : '', c ? Math.round(c.brute) : '', c ? Math.round(c.neutralisee) : '', c && (c.vl70 || (g && g.vl70)) ? Math.round(c.vl70 || g.vl70) : '', c ? Math.round(g ? g.base : c.base) : '', a.ref ? a.ref.base : '', a.ecart !== null && a.ecart !== undefined ? a.ecart : '', (a.signaux || []).map((s) => s.titre).join(' ; '), (a.signaux || []).map((s) => s.question).filter(Boolean).join(' ; '), l.note || '']; }) }]);
}
