// Relève — Valeur locative : page « Valeur locative », bloc de la fiche client, simulateur, export, relecture des avis.
// S'appuie sur lib/vl.js (calcul), lib/avistf.js (détail par adresse des avis) et lib/pdftext.js (relecture des PDF déjà sur le poste).
'use strict';
const VL = { dep: {}, locaux: [], erreursDep: {}, migration: null };
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
const catPill = (c, cls = 'pill') => c ? `<span class="${cls}" title="${esc(ACVL.CATEGORIES[c] || '')}">${esc(c)}</span>${ACVL.COURT[c] ? ` <span class="tiny muted">${esc(ACVL.COURT[c])}</span>` : ''}` : '';
const fmtK = (n) => Math.round(n || 0).toLocaleString('fr-FR');

// ---- Préparation : analyse de tous les locaux professionnels lus dans GMBI (lib/vl.js) ----
async function vlCompute() {
  VL.locaux = await ACVL.portefeuille({ biens: A.data.biens || [], avis: A.data.avis, saisies: A.data.vl || {}, annee: A.c.annee, correspondance: A.S.correspondance || {}, cache: VL.dep, erreurs: VL.erreursDep });
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

// ---- Page « Valeur locative » ----
function pageValeurLocative() {
  const st = vlBiensStats(), L = vlScope();
  const an = A.c.annee;
  const n = (c) => L.filter((l) => l.analyse && l.analyse.verdict && l.analyse.verdict.code === c).length;
  const nErr = L.filter((l) => !l.analyse || !l.analyse.verdict).length;
  const gainTot = L.filter((l) => l.analyse && l.analyse.verdict && l.analyse.verdict.code === 'ROUGE').reduce((s, l) => s + l.gain, 0);
  const aRelire = A.data.avis.filter((a) => a.taxe === 'TF' && a.hasPdf && !(a.infos && a.infos.detail && Array.isArray(a.infos.detail.locaux)) && !(a.infos && a.infos.vlRelu)).length;
  if (!st.dossiers) return `<div class="ph"><div><h1>Valeur locative des locaux professionnels</h1><div class="sub">Contrôle du calcul de la taxe foncière, local par local</div></div></div>
  <div class="card empty"><b>Aucun bien immobilier lu pour l’instant.</b><p class="small muted" style="margin:6px 0 0">Lancez une mise à jour depuis le volet latéral : Relève lit désormais « Gérer mes biens immobiliers » pour chaque dossier (surfaces, catégorie, parcelle de chaque local professionnel), puis recalcule la base de chaque avis de taxe foncière au tarif de la grille départementale. Vérifiez dans Réglages que la lecture des biens immobiliers est activée.</p><p class="small muted" style="margin:6px 0 0">${vlMethodeLien()}</p></div>`;
  return `<div class="ph"><div><h1>Valeur locative des locaux professionnels</h1><div class="sub">${plural(st.pro, 'local professionnel', 'locaux professionnels')} dans ${plural(st.dossiers, 'dossier')} · base ${an} recalculée au tarif de la grille et rapprochée de l’avis</div></div>
    <div class="r"><button class="btn" data-exp="vlxlsx">${IC.down} Classeur des locaux</button></div></div>
  ${aRelire ? `<div class="verdict info" id="vlMig" style="margin-bottom:12px">${plural(aRelire, 'avis de taxe foncière')} déjà sur ce poste ${aRelire > 1 ? 'sont relus' : 'est relu'} pour en extraire le détail par adresse… Les résultats se complètent au fur et à mesure.</div>` : ''}
  <div class="kpis" style="margin-bottom:14px">
    <div class="kpi card"><span class="tiny muted">Anomalies probables</span><b class="num" style="color:var(--bad)">${n('ROUGE')}</b><span class="tiny muted">gain estimé ${fmtK(gainTot)} € par an</span></div>
    <div class="kpi card"><span class="tiny muted">À vérifier</span><b class="num" style="color:var(--warn)">${n('ORANGE')}</b><span class="tiny muted">question au client ou pièce à demander</span></div>
    <div class="kpi card"><span class="tiny muted">Conformes</span><b class="num" style="color:var(--ok)">${n('VERT')}</b><span class="tiny muted">base de l’avis reproduite au tarif</span></div>
    <div class="kpi card"><span class="tiny muted">Sans résultat</span><b class="num">${n('GRIS') + nErr}</b><span class="tiny muted">${[n('GRIS') ? plural(n('GRIS'), 'local sans avis rapproché', 'locaux sans avis rapproché') : '', nErr ? plural(nErr, 'non calculé') : '', st.indispo ? plural(st.indispo, 'dossier') + ' sans accès aux biens' : ''].filter(Boolean).join(' · ') || 'tous les locaux ont un résultat'}</span></div>
  </div>
  <div class="card"><table class="t"><thead><tr><th>Client</th><th>Local</th><th>Catégorie</th><th class="r">Surface pondérée</th><th class="r">Base avis</th><th class="r">Base calculée</th><th class="r">Écart</th><th>Verdict</th><th class="r">Gain estimé</th></tr></thead><tbody>
  ${L.map((l) => { const v = (l.analyse && l.analyse.verdict) || { code: 'ERREUR', texte: l.analyse && l.analyse.erreur }; const [cls, lib] = VERDICT[v.code] || VERDICT.GRIS; const ref = l.analyse && l.analyse.ref; const calc = l.analyse && l.analyse.calcul;
    return `<tr><td><a href="#client/${l.siren}/vl"><b>${esc(l.nom)}</b></a>${l.code ? `<div class="tiny muted">Dossier ${esc(l.code)}${l.collab ? ' · ' + esc(l.collab) : ''}</div>` : ''}</td><td>${esc(l.adresse)}<div class="tiny muted">${esc(l.ville)}${l.droit && !/Propri/.test(l.droit) ? ' · ' + esc(l.droit) : ''}</div></td><td class="small">${l.categorie && l.categorie !== 'HORS' ? `<b title="${esc(l.categorieLibelle)}">${l.categorie}</b><div class="tiny muted">${esc(ACVL.COURT[l.categorie] || l.categorieLibelle)}</div>` : esc(l.categorieLibelle)}</td><td class="r num">${fmtM2(l.sp)}</td><td class="r num">${ref ? fmtK(ref.base) : '—'}${l.analyse && l.analyse.groupe ? `<div class="tiny muted">${l.analyse.groupe.nb} locaux</div>` : (ref && ref.partage ? ' <span class="pill" title="Adresse partagée par plusieurs biens">partagée</span>' : '')}</td><td class="r num">${calc ? fmtK(calc.base) : '—'}${l.analyse && l.analyse.groupe ? `<div class="tiny muted">${l.analyse.groupe.nb} locaux : ${fmtK(l.analyse.groupe.base)}</div>` : ''}</td><td class="r num">${l.analyse && l.analyse.ecart !== null && l.analyse.ecart !== undefined ? pcv(l.analyse.ecart * 100) : ''}</td><td><span class="pill ${cls}" title="${esc(v.texte || '')}">${lib}</span>${v.code === 'ERREUR' ? `<div class="tiny muted">${esc(v.texte || '')}</div>` : ''}</td><td class="r num ${l.gain > 100 ? 'up' : ''}">${l.gain > 100 ? fmtK(l.gain) + ' €' : ''}</td></tr>`; }).join('')}
  ${!L.length ? '<tr><td colspan="9" class="muted">Aucun local professionnel dans ce périmètre.</td></tr>' : ''}</tbody></table></div>
  ${st.indispo ? `<div class="card av" style="margin-top:14px"><h3>Dossiers sans accès aux biens immobiliers (${st.indispo})</h3><p class="small muted" style="margin:0 0 8px">Le service « Gérer mes biens immobiliers » n’est pas délégué au cabinet pour ces dossiers : demandez au client la délégation (ou le descriptif de ses locaux).</p><div class="small">${vlDossiersSans().slice(0, 60).map((r) => `<a href="#client/${r.siren}">${esc(r.nom)}</a>`).join(' · ')}${st.indispo > 60 ? ' …' : ''}</div></div>` : ''}
  ${vlLexique()}
  <p class="tiny muted" style="margin-top:14px">${vlMethodeLien()}</p>`;
}
const vlLexique = () => `<details class="card" style="margin-top:14px" id="lexique"><summary><b>Comprendre les termes</b> <span class="small muted">catégories, surface pondérée, tarif, neutralisation, planchonnement…</span></summary>
  <div class="grid2 small" style="margin-top:10px;gap:14px">
    <div>
      <p><b>Catégorie (MAG1, BUR2, ATE1…)</b> — l’administration range chaque local professionnel dans une des 38 catégories de la grille (magasins, bureaux, ateliers, dépôts, hôtels…). <b>MAG</b> = magasins, <b>BUR</b> = bureaux, <b>DEP</b> = dépôts et parkings, <b>ATE</b> = ateliers, <b>HOT</b> = hôtels, <b>SPE</b> = sport et spectacle, <b>ENS</b> = enseignement, <b>CLI</b> = cliniques. Le chiffre précise le type : MAG1 boutique de moins de 400 m², MAG4 magasin de 400 à 2 499 m², MAG5 au-delà. Chaque catégorie a son tarif au m² : une erreur de catégorie change la taxe du simple au double. Passez la souris sur un code pour lire son libellé complet.</p>
      <p><b>Surface pondérée</b> — la surface principale compte pour 1, les surfaces secondaires couvertes (réserves, sanitaires) pour 0,5, les non couvertes pour 0,2, les parkings couverts 0,5 et non couverts 0,2. C’est elle qui est multipliée par le tarif.</p>
      <p><b>Secteur tarifaire</b> — chaque commune est découpée en secteurs ; le tarif d’une catégorie dépend du secteur où se trouve la section cadastrale du local. <b>Coefficient de localisation</b> : ajustement de ± 30 % au plus, parcelle par parcelle.</p>
    </div>
    <div>
      <p><b>Valeur locative brute</b> — surface pondérée × tarif × coefficient de localisation : le loyer annuel théorique du local selon la grille.</p>
      <p><b>Neutralisation</b> — coefficient propre à chaque commune (souvent 0,2 à 0,4) qui ramène la valeur révisée de 2017 au niveau des anciennes valeurs, pour ne pas faire exploser les taxes.</p>
      <p><b>Planchonnement</b> — pour les locaux qui existaient au 1<sup>er</sup> janvier 2017, la valeur retenue est la moyenne entre la valeur révisée neutralisée et l’ancienne valeur locative (dite « 1970 »). Relève reconstitue cette ancienne valeur à partir de la ligne « cotisation lissée » de l’avis.</p>
      <p><b>Base</b> — moitié de la valeur locative retenue ; c’est le montant imprimé sur l’avis, auquel s’appliquent les taux des collectivités. <b>Gain estimé</b> : taxe réelle × (1 − base corrigée ÷ base de l’avis), c’est-à-dire l’économie annuelle si l’hypothèse est retenue.</p>
      <p><b>Verdicts</b> — <span class="pill bad">Anomalie probable</span> un signal chiffré fait gagner plus de 100 €/an ; <span class="pill warn">À vérifier</span> un point à confirmer avec le client ou un écart inexpliqué ; <span class="pill ok">Conforme</span> la base de l’avis est reproduite au tarif ; <span class="pill">Sans avis rapproché</span> calcul au tarif seul, aucun avis à cette adresse sur le poste.</p>
    </div>
  </div></details>`;
const vlMethodeLien = () => `Méthode : surface pondérée × tarif de la catégorie dans le secteur de la section cadastrale × coefficient de localisation, puis coefficient de neutralisation de la commune et, pour les locaux existant au 1<sup>er</sup> janvier 2017, planchonnement avec l’ancienne valeur locative reconstituée depuis la ligne de lissage de l’avis (art. 1498 et 1518 A quinquies CGI). Paramètres : impots.gouv.fr, « Révision des valeurs locatives des locaux professionnels ». <a href="https://releveavis.netlify.app/valeur-locative.html" target="_blank" rel="noopener">La démarche en détail</a>.`;
function bindValeurLocative(arg) { $$('[data-exp]').forEach((b) => b.onclick = () => doExport(b.dataset.exp, b)); vlMigrer(); if (String(arg || '') === 'lexique') { const e = $('#lexique'); if (e) { e.open = true; setTimeout(() => e.scrollIntoView({ block: 'start' }), 50); } } }

// ---- Bloc de la fiche client ----
function vlClientBlock(siren) {
  const rec = (A.data.biens || []).find((r) => r.siren === siren);
  if (!rec) return '';
  const L = VL.locaux.filter((l) => l.siren === siren);
  const hab = (rec.biens || []).filter((b) => !b.pro);
  if (rec.indispo) return `<div class="card av" id="vl"><h3>Valeur locative des locaux professionnels</h3><div class="verdict warn">Service « Gérer mes biens immobiliers » indisponible pour ce dossier : ${esc(rec.indispo)}. Demandez au client la délégation de ce service au cabinet, ou le descriptif de ses locaux.</div></div>`;
  return `<div class="card av" id="vl"><div class="hd"><div><h3 style="margin:0">Valeur locative des locaux professionnels</h3><div class="small muted"><a href="#valeur-locative/lexique" title="Comprendre les termes : catégories, surface pondérée, planchonnement…">Comprendre les termes</a> · ${plural(L.length, 'local professionnel', 'locaux professionnels')}${hab.length ? ` · ${plural(hab.length, 'autre bien')} (${[...new Set(hab.map((b) => b.type))].join(', ').toLowerCase()}) hors contrôle` : ''} · biens lus ${ago(rec.at)}</div></div></div>
  ${(rec.attendues || []).length ? `<div class="verdict warn" style="margin-top:10px"><b>${plural(rec.attendues.length, 'déclaration attendue')} par l’administration</b> : ${rec.attendues.map((x) => esc(x.numero) + ' (' + esc(x.adresse) + ')').join(', ')}. Une construction ou des travaux non déclarés exposent à un rehaussement et font perdre l’exonération temporaire : à régulariser avant toute réclamation.</div>` : ''}
  ${L.map(vlLocalHtml).join('')}
  ${!L.length ? '<p class="small muted" style="margin:10px 0 0">Aucun local professionnel dans « Gérer mes biens immobiliers » pour ce dossier.</p>' : ''}</div>`;
}
function vlLocalHtml(l) {
  const an = l.analyse, v = (an && an.verdict) || { code: 'ERREUR', texte: an && an.erreur }; const [cls, lib] = VERDICT[v.code] || VERDICT.GRIS;
  const id = esc(l.invariant), S = l.surfaces, calc = an && an.calcul, rec = an && an.reconstitution, ref = an && an.ref;
  const chaine = calc ? `<table class="t vlchain"><tbody>
    <tr><td>Secteur tarifaire de la section ${esc(l.section || '')} <span class="muted" title="Chaque commune est découpée en secteurs d’évaluation ; le tarif d’une catégorie dépend du secteur de la section cadastrale.">?</span></td><td class="r">${calc.secteur}${calc.coefLoc !== 1 ? ` · coefficient de localisation ${Number(calc.coefLoc).toLocaleString('fr-FR')}` : ''}</td></tr>
    ${calc.detail.map((d) => `<tr><td>${esc(ACVL.nomCat(d.categorie))} : ${fmtM2(d.sp)} pondérés × ${Number(d.tarif).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/m²</td><td class="r num">${fmtK(d.vl)} €</td></tr>`).join('')}
    <tr><td>Valeur locative brute</td><td class="r num">${fmtK(calc.brute)} €</td></tr>
    <tr><td>× coefficient de neutralisation (${Number(calc.coefNeut).toLocaleString('fr-FR', { maximumFractionDigits: 6 })})</td><td class="r num">${fmtK(calc.neutralisee)} €</td></tr>
    ${calc.vl70 ? `<tr><td>Planchonnement : moyenne avec l’ancienne valeur locative ${fmtK(calc.vl70)} € (reconstituée depuis le lissage de l’avis ${rec && ref ? (ref.annee === an.annee ? an.annee : an.annee - 1) : ''})</td><td class="r num">${fmtK(calc.planchonnee)} €</td></tr>` : (rec && !rec.planchonnement ? '<tr><td class="muted">Pas de ligne de lissage sur l’avis : local récent ou avis postérieur à 2025 sans avis 2025 sur le poste</td><td></td></tr>' : '')}
    <tr><td><b>Base ${calc.annee} calculée (valeur locative ÷ 2)</b>${an.groupe ? ' <span class="muted">— ce local seul</span>' : ''}</td><td class="r num"><b>${fmtK(calc.base)} €</b></td></tr>
    ${an.groupe ? `<tr><td colspan="2" class="tiny muted" style="padding-top:10px">L’avis ne donne qu’une base pour les ${an.groupe.nb} locaux de cette adresse : comparaison sur l’ensemble</td></tr>
    <tr><td>Valeur locative neutralisée des ${an.groupe.calcules} locaux calculés${an.groupe.calcules < an.groupe.nb ? ` (sur ${an.groupe.nb})` : ''}</td><td class="r num">${fmtK(an.groupe.neutralisee)} €</td></tr>
    ${an.groupe.vl70 ? `<tr><td>Planchonnement : moyenne avec l’ancienne valeur locative de l’ensemble ${fmtK(an.groupe.vl70)} € (reconstituée depuis le lissage de l’avis)</td><td class="r num">${fmtK(an.groupe.planchonnee)} €</td></tr>` : '<tr><td class="muted">Pas de ligne de lissage sur l’avis : planchonnement non reconstitué</td><td></td></tr>'}
    <tr><td><b>Base ${calc.annee} calculée pour l’ensemble (valeur locative ÷ 2)</b></td><td class="r num"><b>${fmtK(an.groupe.base)} €</b></td></tr>` : ''}
    ${ref ? `<tr><td>Base ${ref.annee} de l’avis${an.groupe ? ` (${an.groupe.nb} locaux)` : (ref.partage ? ' (adresse partagée)' : '')}${ref.avisId ? ` · <button class="btn ghost sm" data-pdf="${esc(ref.avisId)}">Voir l’avis</button>` : ''}</td><td class="r num">${fmtK(ref.base)} € <span class="${Math.abs(an.ecart) > 0.05 ? 'up' : 'muted'}">(${pcv(an.ecart * 100)})</span></td></tr>` : '<tr><td class="muted">Aucun avis de taxe foncière rapproché à cette adresse sur ce poste</td><td></td></tr>'}
  </tbody></table>` : `<p class="small muted" style="margin:0">${v.code === 'HORS' ? 'Pas de calcul au tarif pour ce local.' : 'Calcul impossible tant que le point ci-dessus n’est pas résolu.'}</p>`;
  const signaux = an && an.signaux ? an.signaux : [];
  const occ = l.occupant || {};
  return `<div class="vlocal" data-vl="${id}">
    <div class="hd" style="margin-top:14px"><div><b>${esc(l.adresse)}</b> <span class="small muted">${esc(l.ville)} · parcelle ${esc(l.prefixe ? l.prefixe + ' ' : '')}${esc(l.section || '?')} ${esc(l.parcelle || '')}${l.lot ? ' · lot ' + esc(l.lot) : ''}${l.batiment ? ' · bât. ' + esc(l.batiment) : ''} · n° ${id}</span><div class="small">${l.categorieDeclaree && l.categorie !== l.categorieDeclaree ? `Catégorie retenue ${catPill(l.categorie, 'pill acc')} <span class="muted">(fiche : ${ACVL.nomCat(l.categorieDeclaree)})</span>` : `${esc(l.categorieLibelle)}${l.categorie && l.categorie !== 'HORS' ? ` <span class="pill" title="${esc(ACVL.CATEGORIES[l.categorie] || '')}">${l.categorie}</span>` : ''}`}${l.droit && !/^Propri/.test(l.droit) ? ` <span class="pill acc">${esc(l.droit)}</span>` : ''}</div></div><div><span class="pill ${cls}">${lib}</span></div></div>
    <div class="verdict ${cls === 'bad' ? 'bad' : cls === 'warn' ? 'warn' : cls === 'ok' ? 'ok' : 'info'}" style="margin-top:8px">${esc(v.texte || '')}</div>
    <div class="grid2" style="margin-top:10px;align-items:start">
      <div><div class="tiny muted" style="margin-bottom:4px">${an && an.hypothese ? 'Surfaces retenues (votre hypothèse)' : 'Surfaces déclarées (fiche « Gérer mes biens immobiliers »)'}</div><table class="t"><tbody>${Object.keys(ACVL.POND).filter((k) => S[k]).map((k) => `<tr><td>${ACVL.LIB_SURF[k]}</td><td class="r num">${fmtM2(S[k])}</td><td class="r muted small">× ${ACVL.POND[k]}</td></tr>`).join('')}<tr><td><b>Surface pondérée</b></td><td class="r num"><b>${fmtM2(l.sp)}</b></td><td></td></tr></tbody></table></div>
      <div><div class="tiny muted" style="margin-bottom:4px">Calcul au tarif de la grille</div>${chaine}</div>
    </div>
    ${signaux.length ? `<div style="margin-top:10px"><div class="tiny muted" style="margin-bottom:4px">Points à vérifier</div>${signaux.map((s) => `<div class="sig ${s.gravite >= 3 ? 'bad' : s.gravite === 2 ? 'warn' : ''}"><b>${esc(s.titre)}</b>${s.simulation && s.simulation.gain !== null ? ` — <span class="num ${s.simulation.gain > 0 ? 'ok' : 'muted'}">${s.simulation.gain > 0 ? 'gain estimé ' + fmtK(s.simulation.gain) + ' € par an' : 'hypothèse défavorable (' + fmtK(-s.simulation.gain) + ' € de plus)'}</span>` : ''}<div class="small muted">${esc(s.texte)}</div>${s.question ? `<div class="small">→ ${esc(s.question)}</div>` : ''}</div>`).join('')}</div>` : ''}
    <details class="vlsim" style="margin-top:10px"><summary class="small">Simuler une autre hypothèse, renseigner l’occupant</summary>
      <div class="grid2" style="margin-top:8px">
        <div><label class="tiny muted">Catégorie</label><select data-sim="categorie" style="width:100%">${Object.entries(ACVL.CATEGORIES).map(([c, lb]) => `<option value="${c}" ${c === l.categorie ? 'selected' : ''}>${c} — ${esc(lb)}</option>`).join('')}</select>
          <div class="grid2" style="margin-top:6px;gap:6px">${Object.keys(ACVL.POND).map((k) => `<label class="tiny muted">${ACVL.LIB_SURF[k]}<input type="number" min="0" step="1" data-sim="${k}" value="${S[k] || 0}" style="width:100%"></label>`).join('')}</div></div>
        <div><label class="tiny muted">Occupant (nom)<input data-sim="occNom" value="${esc(occ.nom || '')}" placeholder="Enseigne ou société" style="width:100%"></label>
          <label class="tiny muted" style="display:block;margin-top:6px">Code NAF de l’occupant<input data-sim="occNaf" value="${esc(occ.naf || '')}" placeholder="ex. 45.20A" style="width:100%"></label>
          <label class="tiny muted" style="display:block;margin-top:6px">Classement hôtelier (étoiles, 0 = non classé)<input type="number" min="0" max="5" data-sim="etoiles" value="${l.etoiles ?? ''}" style="width:100%"></label>
          <label class="tiny muted" style="display:block;margin-top:6px">Note<input data-sim="note" value="${esc(l.note || '')}" placeholder="Réponse du client, pièce reçue…" style="width:100%"></label>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn sm primary" data-simok="${id}">Enregistrer et recalculer</button><button class="btn sm" data-simreset="${id}">Revenir à la fiche déclarée</button><button class="btn sm" data-simexcl="${id}">${l.exclu ? 'Réintégrer' : 'Écarter ce local'}</button></div>
          <div class="small num" data-simres="${id}" style="margin-top:8px"></div></div>
      </div></details>
  </div>`;
}
function bindVl(siren) {
  $$('[data-simok]').forEach((b) => b.onclick = async () => {
    const root = b.closest('.vlocal'), inv = b.dataset.simok, g = (k) => root.querySelector(`[data-sim="${k}"]`);
    const surfaces = {}; for (const k of Object.keys(ACVL.POND)) { const v = Number(g(k).value) || 0; if (v) surfaces[k] = v; }
    const occNom = g('occNom').value.trim(), occNaf = g('occNaf').value.trim().toUpperCase().replace(/^(\d{2})(\d{2}[A-Z])$/, '$1.$2'), et = g('etoiles').value;
    await vlSave(siren, inv, { categorie: g('categorie').value, surfaces, occupant: occNom || occNaf ? { nom: occNom, naf: occNaf } : null, etoiles: et === '' ? null : Number(et), note: g('note').value.trim() });
    await vlCompute(); page(); toast('Hypothèse enregistrée : calcul mis à jour');
  });
  $$('[data-simreset]').forEach((b) => b.onclick = async () => { await vlSave(siren, b.dataset.simreset, { categorie: null, surfaces: null }); await vlCompute(); page(); toast('Fiche déclarée rétablie'); });
  $$('[data-simexcl]').forEach((b) => b.onclick = async () => { const cur = vlSaisie(siren, b.dataset.simexcl); await vlSave(siren, b.dataset.simexcl, { exclu: !cur.exclu }); await vlCompute(); page(); });
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
      const cot = ref ? ACVL.cotisationPour(baseCmp, ref.base, ref.cotisationTotale || ref.cotisation) : null;
      res.innerHTML = `Base ${e.annee} avec cette hypothèse : <b>${fmtK(e.base)} €</b>${g ? ` pour ce local, <b>${fmtK(baseCmp)} €</b> pour les ${g.nb} locaux de l’adresse` : ''}${ref ? ` (avis : ${fmtK(ref.base)} €) · taxe estimée <b>${fmtK(cot)} €</b> au lieu de ${fmtK(ref.cotisationTotale || ref.cotisation)} € → <b class="${(ref.cotisationTotale || ref.cotisation) - cot > 0 ? 'ok' : 'up'}">${sgn((ref.cotisationTotale || ref.cotisation) - cot)} par an</b>` : ''}`;
    };
    root.querySelectorAll('[data-sim]').forEach((i) => { i.oninput = maj; i.onchange = maj; });
  });
}

// ---- Export : classeur des locaux ----
function buildXlsxVl() {
  const L = vlScope();
  return buildWorkbook([{ name: 'Locaux', title: `Valeur locative des locaux professionnels · campagne ${A.c.annee}`, subtitle: `${scopeMoi() ? 'Mon portefeuille' : 'Tout le cabinet'} · extrait le ${new Date().toLocaleDateString('fr-FR')} · Relève`, tab: true,
    cols: [{ h: 'Client', w: 30, style: () => 6 }, { h: 'SIREN', w: 12 }, { h: 'Code', w: 10 }, { h: 'Collaborateur', w: 14 }, { h: 'Adresse', w: 30 }, { h: 'Commune', w: 22 }, { h: 'Parcelle', w: 12 }, { h: 'N° local', w: 14 }, { h: 'Droit', w: 16 }, { h: 'Catégorie', w: 9 }, { h: 'Libellé', w: 34 }, { h: 'P1', w: 8, t: 'n' }, { h: 'P2 couv.', w: 8, t: 'n' }, { h: 'P2 non couv.', w: 9, t: 'n' }, { h: 'PK couv.', w: 8, t: 'n' }, { h: 'PK non couv.', w: 9, t: 'n' }, { h: 'Surface pondérée', w: 10, t: 'n' }, { h: 'Secteur', w: 8 }, { h: 'Tarif €/m²', w: 9, t: 'n' }, { h: 'VL brute', w: 11, t: 'eur' }, { h: 'VL neutralisée', w: 11, t: 'eur' }, { h: 'VL 1970 reconstituée', w: 12, t: 'eur' }, { h: 'Base calculée', w: 11, t: 'eur' }, { h: 'Base avis', w: 11, t: 'eur' }, { h: 'Écart', w: 8, t: 'pct' }, { h: 'Verdict', w: 14, style: (v) => v === 'Anomalie probable' ? 9 : v === 'Conforme' ? 8 : undefined }, { h: 'Gain estimé / an', w: 12, t: 'eur' }, { h: 'Points à vérifier', w: 90, t: 'long' }, { h: 'Questions au client', w: 90, t: 'long' }, { h: 'Note', w: 40, t: 'long' }],
    rows: L.map((l) => { const a = l.analyse || {}, c = a.calcul, v = a.verdict || {}; return [l.nom, l.siren, l.code, l.collab, l.adresse, l.ville, `${l.section || ''} ${l.parcelle || ''}`.trim(), l.invariant, l.droit, l.categorie, l.categorieLibelle, l.surfaces.p1 || '', l.surfaces.p2c || '', l.surfaces.p2nc || '', l.surfaces.pk1 || '', l.surfaces.pk2 || '', Math.round(l.sp * 10) / 10, c ? c.secteur : '', c && c.detail[0] ? c.detail[0].tarif : '', c ? Math.round(c.brute) : '', c ? Math.round(c.neutralisee) : '', c && c.vl70 ? Math.round(c.vl70) : '', c ? Math.round(c.base) : '', a.ref ? a.ref.base : '', a.ecart !== null && a.ecart !== undefined ? a.ecart : '', (VERDICT[v.code] || VERDICT.GRIS)[1], l.gain > 100 ? Math.round(l.gain) : '', (a.signaux || []).map((s) => s.titre).join(' ; '), (a.signaux || []).map((s) => s.question).filter(Boolean).join(' ; '), l.note || '']; }) }]);
}
