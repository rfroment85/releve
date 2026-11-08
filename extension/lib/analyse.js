// Relève — analyse de la campagne : rapprochement N / N-1, explication des hausses, liste de travail, collectivités.
// Fonctions pures (aucun accès au DOM) : utilisées par le volet, l'application et le service d'arrière-plan.
'use strict';
const ACA = (() => {
  const num = (s) => typeof s === 'number' ? s : (parseFloat(String(s || '').replace(/[\s  ]/g, '').replace(',', '.')) || 0);
  const eur = (n) => Math.round(n || 0).toLocaleString('fr-FR') + ' €';
  const eur2 = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const sgn = (n) => (n > 0.5 ? '+' : n < -0.5 ? '−' : '') + eur(Math.abs(n));
  const pc = (x, d = 1) => (x > 0 ? '+' : '') + x.toFixed(d).replace('.', ',') + ' %';
  const dkey = (d) => String(d || '').split('/').reverse().join('');
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
  const daysUntil = (d) => { const m = String(d || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); if (!m) return null; const t = new Date(+m[3], +m[2] - 1, +m[1]); const n = new Date(); n.setHours(0, 0, 0, 0); return Math.round((t - n) / 86400000); };
  const TAXE_LABEL = { TF: 'Taxe foncière', CFE: 'CFE' };
  // Pseudonyme stable d'un client (connexion à Claude, noms masqués) : « Client 4F2A »
  const pseudo = (siren) => { let h = 0x811c9dc5; for (const c of String(siren)) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return 'Client ' + h.toString(36).toUpperCase().slice(-4).padStart(4, '0'); };
  // Année de campagne : l'année civile en cours (avis de l'année)
  const anneeCampagne = () => new Date().getFullYear();

  // Calendrier fiscal indicatif (mises en ligne et échéances habituelles)
  function calendrier(annee) {
    return [
      { date: `15/06/${annee}`, titre: 'Échéance des acomptes de CFE', texte: 'Pour les cotisations importantes de l’année précédente.' },
      { date: `15/10/${annee}`, titre: 'Échéance de la taxe foncière', texte: 'Paiement en ligne le 20/10 ; prélèvement à l’échéance quelques jours plus tard.' },
      { date: `03/11/${annee}`, titre: 'Mise en ligne habituelle des avis de solde de CFE', texte: 'Date indicative : début novembre.' },
      { date: `15/12/${annee}`, titre: 'Échéance du solde de CFE', texte: 'Majoration de 10 % en cas de retard.' },
      { date: `31/12/${annee}`, titre: `Réclamations sur les avis mis en recouvrement en ${annee - 1}`, texte: 'Dernier jour pour contester une base (valeur locative, base minimum).' },
    ].map((e) => ({ ...e, jours: daysUntil(e.date) })).filter((e) => e.jours === null || e.jours >= -1);
  }

  // Décomposition d'une variation N-1 → N : effet des taux (à base constante), effet des bases, biens nouvellement imposés, reste (frais)
  function decompose(a, n1) {
    const mN = a.m, mN1 = n1 ? n1.m : 0, delta = n1 ? mN - mN1 : 0;
    const out = { mN, mN1, delta, pct: mN1 ? delta / mN1 * 100 : 0, taux: 0, bases: 0, nouveaux: 0, autres: 0, lignes: [], basesPct: null, verdict: '', verdictType: 'info' };
    const det = a.infos && a.infos.detail;
    if (a.taxe === 'TF' && det && det.lignes && det.lignes.length) {
      for (const l of det.lignes) {
        const cN = num(l.cotN), cN1 = num(l.cotN1), tN = num(l.tauxN), tN1 = num(l.tauxN1);
        if (!cN && !cN1) continue;
        const neuf = !cN1 && cN > 0;
        const effTaux = tN1 && !neuf ? cN1 * (tN / tN1 - 1) : 0, effBase = (cN - cN1) - effTaux;
        out.taux += effTaux; if (neuf) out.nouveaux += cN; else out.bases += effBase;
        out.lignes.push({ nom: l.nom, cN1, cN, tN1: l.tauxN1, tN: l.tauxN, effTaux, effBase: neuf ? 0 : effBase, neuf });
      }
      if (n1) out.autres = delta - out.taux - out.bases - out.nouveaux;
      const com = out.lignes.find((l) => l.nom === 'Commune' && num(l.tN1) && l.cN1);
      if (com) out.basesPct = (com.cN / num(com.tN)) / (com.cN1 / num(com.tN1)) * 100 - 100;
      if (out.basesPct !== null && out.basesPct > 3) { out.verdictType = 'warn'; out.verdict = `Bases en hausse de ${out.basesPct.toFixed(1).replace('.', ',')} % (${sgn(out.bases)}), au-delà de la revalorisation annuelle : vérifier la valeur locative (local modifié, fin d’exonération, erreur). Réclamation possible jusqu’au 31/12/${Number(a.annee) + 1}.${out.taux > 50 ? ` Le reste vient des taux votés (${sgn(out.taux)}).` : ''}`; }
      else if (out.nouveaux > 0.5 && out.nouveaux >= 0.5 * Math.max(delta, 1)) { out.verdictType = 'info'; out.verdict = `Hausse due surtout à des biens imposés pour la première fois (${sgn(out.nouveaux)}) : construction, acquisition ou fin d’exonération à confirmer avec le client.`; }
      else if (delta > 0 && out.taux >= 0.6 * delta) { out.verdictType = 'ok'; out.verdict = `Hausse votée par les collectivités (${sgn(out.taux)} dus aux taux) : à expliquer au client, pas de réclamation possible.`; }
      else if (delta > 0) { out.verdictType = 'info'; out.verdict = `Hausse mixte : ${sgn(out.taux)} dus aux taux, ${sgn(out.bases)} aux bases.`; }
    } else if (a.taxe === 'CFE') {
      const n = det || {}, p = (n1 && n1.infos && n1.infos.detail) || {};
      if (n.baseMinimum === 'OUI') { out.verdictType = p.baseMinimum === 'NON' ? 'warn' : 'info'; out.verdict = `Imposition sur la base minimum (${n.baseMinimumMontant || '?'} €)${p.baseMinimum === 'NON' ? ' alors que l’an dernier était sur la valeur locative : vérifier le chiffre d’affaires retenu.' : ' : elle dépend du chiffre d’affaires.'}`; }
      else if (n.valeurLocative && p.valeurLocative) {
        const v = num(n.valeurLocative) / num(p.valeurLocative) * 100 - 100; out.basesPct = v;
        if (Math.abs(v) > 3) { out.verdictType = 'warn'; out.verdict = `Valeur locative ${p.valeurLocative} → ${n.valeurLocative} (${pc(v)}) : changement de locaux ou de base à vérifier. Réclamation possible jusqu’au 31/12/${Number(a.annee) + 1}.`; }
        else if (n.tauxCommuneN && n.tauxCommuneN !== n.tauxCommuneN1) { out.verdictType = 'ok'; out.verdict = `Taux communal ${n.tauxCommuneN1} → ${n.tauxCommuneN} % : hausse votée, à expliquer au client.`; }
      }
      if (!out.verdict && delta > 0) out.verdict = 'Comparer les deux avis (détail de calcul non disponible).';
    }
    return out;
  }

  // Rapprochement d'un avis N avec l'avis N-1 du même établissement (CFE : NIC ; TF : commune et rôle, sinon commune)
  function matchN1(a, pool) {
    const c = pool.filter((x) => x.taxe === a.taxe && x.siren === a.siren && !x.acompte);
    if (!c.length) return null;
    if (a.taxe === 'CFE') return c.find((x) => x.nic && x.nic === a.nic) || (c.length === 1 ? c[0] : null);
    return c.find((x) => x.commune === a.commune && x.role === a.role) || c.find((x) => x.commune === a.commune) || (c.length === 1 ? c[0] : null);
  }

  // Base minimum de CFE : plafond légal de la base par tranche de chiffre d'affaires HT (art. 1647 D CGI), revalorisé chaque année
  const BAREME_BM = { 2026: [[10000, 597], [32600, 1194], [100000, 2509], [250000, 4183], [500000, 5974], [Infinity, 7769]] };
  const trancheLib = (b, i) => i === 0 ? `CA ≤ ${b[0][0].toLocaleString('fr-FR')} €` : b[i][0] === Infinity ? `CA > ${b[i - 1][0].toLocaleString('fr-FR')} €` : `CA de ${(b[i - 1][0] + 1).toLocaleString('fr-FR')} à ${b[i][0].toLocaleString('fr-FR')} €`;
  // Contrôle de la CFE d'un avis à partir du chiffre d'affaires de la période de référence (N-2) et de la date de création importés
  function controleCfe(a, caInfo, annee) {
    const det = (a.infos && a.infos.detail) || {};
    const out = { bm: det.baseMinimum === 'OUI', bmM: num(det.baseMinimumMontant), ref: String(Number(annee) - 2), exo: null, caRef: null, tranche: '', plafond: null, anomalies: [], infos: [] };
    if (!caInfo) return out;
    const exos = (caInfo.exos || []).filter((e) => String(e.cloture || '').slice(-4) === out.ref).sort((x, y) => dkey(y.cloture).localeCompare(dkey(x.cloture)));
    // La base minimum dépend du chiffre d'affaires du REDEVABLE (toutes activités et tous établissements du SIREN : art. 1647 D du CGI).
    // CA saisi à la main par établissement (fiche client) : leur somme est le CA du redevable ; ils servent aussi à repérer le principal établissement.
    const saisis = Object.values(caInfo.parNic || {}).filter((v) => v !== '' && v !== null && v !== undefined).map(num);
    const codes = [...new Set(exos.map((e) => e.code).filter(Boolean))];
    out.multi = exos.length > 1 && (codes.length > 1 || new Set(exos.map((e) => e.cloture)).size < exos.length);
    if (saisis.length) { const t = saisis.reduce((x, y) => x + y, 0); out.exo = { cloture: out.ref, duree: 12, ca: t, saisi: true }; out.caRef = Math.round(t); out.source = saisis.length > 1 ? 'somme' : 'saisi'; }
    else if (out.multi) {
      // Plusieurs exercices clos la même année (plusieurs dossiers fiscaux sous ce SIREN : BNC + LMNP…) : le CA du redevable est leur somme
      out.caRef = Math.round(exos.reduce((t, e) => t + num(e.ca) * 12 / (num(e.duree) || 12), 0)); out.exo = exos[0]; out.source = 'cumul';
      out.infos.push(`${exos.length} exercices clos en ${out.ref}${codes.length > 1 ? ` (dossiers ${codes.join(', ')})` : ''} sous ce SIREN : la base minimum se calcule sur leur chiffre d’affaires cumulé, ${eur(out.caRef)}.`);
    }
    if (exos.length && out.caRef === null) {
      const e = exos[0]; out.exo = e; out.caRef = Math.round(num(e.ca) * 12 / (num(e.duree) || 12)); out.source = 'import';
    }
    if (out.caRef !== null) {
      const e = out.exo;
      const b = BAREME_BM[annee];
      if (b) { const i = b.findIndex((t) => out.caRef <= t[0]); out.tranche = trancheLib(b, i); out.plafond = b[i][1]; }
      const cumul = false; // CA cumulé ou saisi : c'est bien celui du redevable
      if (out.bm && out.caRef <= 5000) out.anomalies.push({ type: 'cfm', certain: !cumul, texte: `Chiffre d’affaires ${out.ref} de ${eur(out.caRef)}${num(e.duree) && num(e.duree) !== 12 ? ' (ramené à 12 mois)' : ''} : exonération de plein droit de la cotisation minimum (CA ≤ 5 000 €), mais imposition sur une base minimum de ${eur(out.bmM)}.` });
      else if (out.bm && out.plafond && out.bmM > out.plafond + 1) {
        if (cumul) out.infos.push(`Base minimum de ${eur(out.bmM)} au-dessus du plafond de la tranche du CA cumulé (${eur(out.plafond)}) : à confirmer après saisie du CA de cet établissement.`);
        else out.anomalies.push({ type: 'cfm', certain: true, texte: `Base minimum de ${eur(out.bmM)} supérieure au plafond légal de ${eur(out.plafond)} pour un ${out.tranche.replace(/^CA/, 'chiffre d’affaires')} (CA ${out.ref}${out.source === 'saisi' || out.source === 'somme' ? ' saisi' : out.source === 'cumul' ? ' cumulé' : ''} : ${eur(out.caRef)}) : tranche supérieure appliquée.` });
      }
    } else if (out.bm) out.infos.push(`Chiffre d’affaires ${out.ref} non importé : contrôle de la base minimum impossible.`);
    const cr = caInfo.creation || '', crY = String(cr).slice(-4);
    if (crY === String(annee)) out.anomalies.push({ type: 'cre', certain: true, texte: `Entreprise créée le ${cr} : pas de CFE l’année de création (art. 1478 II du CGI), or un avis ${annee} a été émis.` });
    else if (crY === String(Number(annee) - 1)) out.infos.push(`Créée le ${cr} : première année d’imposition, la base doit être réduite de moitié (art. 1478 II du CGI). À vérifier sur l’avis.`);
    return out;
  }

  const PAIEMENT = { OUI: 'Prélevé à l’échéance', MENSUEL: 'Mensualisé', NON: 'À payer par le client' };
  const plural = (n, a, b) => `${n.toLocaleString('fr-FR')} ${n > 1 ? (b || a + 's') : a}`;

  // Situation des dettes d'un client, lisible : en retard (dettes échues, AMR rapprochés, majorations), à venir (non échues), payées récemment.
  // dettes : lignes de la synthèse des dettes (avec siren/nom/collab) ; amr : documents à payer ; renvoie { [siren]: { siren, nom, collab, retard, aVenir, payees, totalRetard, totalAVenir } }
  function situationDettes(dettes, amr, seuilDette, today) {
    const out = {};
    const get = (r) => out[r.siren] || (out[r.siren] = { siren: r.siren, nom: r.nom, collab: r.collab || '', retard: [], aVenir: [], payees: [], totalRetard: 0, totalAVenir: 0 });
    const libres = amr.map((x) => ({ ...x, pris: false }));
    // Mois d'émission d'un AMR, lu dans son numéro quand il commence par AAAAMM (ex. 20260805165 : août 2026)
    const moisAmr = (x) => { const m = String(x.amr || '').replace(/\D/g, '').match(/^(20\d{2})(0[1-9]|1[0-2])\d{3,}$/); return m ? m[1] + m[2] : ''; };
    const moisDette = (r) => { const m = String(r.dateLimite || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? m[3] + m[2] : ''; };
    const enRetard = [];
    for (const r of dettes) {
      const sc = get(r), dl = dkey(r.dateLimite), due = dl && dl < today;
      if (num(r.paiementMontant) > 0 && r.solde <= 0) { sc.payees.push({ impot: r.impot, annee: r.annee, commune: r.commune, reference: r.reference, montant: num(r.paiementMontant), date: r.paiementDate, nature: r.paiementNature, dette: r }); continue; }
      if (r.solde <= 0) continue;
      if (!due) { sc.aVenir.push({ impot: r.impot, annee: r.annee, commune: r.commune, reference: r.reference, dateLimite: r.dateLimite, montant: r.solde, jours: daysUntil(r.dateLimite), dette: r }); sc.totalAVenir += r.solde; continue; }
      enRetard.push(r);
    }
    // Rapprochement dette échue ↔ avis de mise en recouvrement (même client) : montant entre le solde et le solde majoré (majoration de 5 % ou 10 %,
    // intérêts, frais : au plus +15 % + 50 €), AMR émis au plus tôt le mois de l'échéance ; on retient d'abord les couples dont le taux est le plus proche de 5 % ou 10 %
    const couples = [];
    for (const r of enRetard) for (const x of libres) {
      if (x.siren !== r.siren || x.montant < r.solde - 1 || x.montant > r.solde * 1.15 + 50) continue;
      const ma = moisAmr(x), md = moisDette(r); if (ma && md && ma < md) continue;
      const t = r.solde ? x.montant / r.solde - 1 : 0;
      couples.push({ r, x, score: Math.min(Math.abs(t - 0.05), Math.abs(t - 0.10)) });
    }
    couples.sort((u, v) => u.score - v.score);
    const amrDe = new Map();
    for (const c of couples) if (!c.x.pris && !amrDe.has(c.r)) { c.x.pris = true; amrDe.set(c.r, c.x); }
    for (const r of enRetard) {
      const sc = get(r), a = amrDe.get(r) || null;
      sc.retard.push({ impot: r.impot, annee: r.annee, commune: r.commune, reference: r.reference, dateLimite: r.dateLimite, jours: -(daysUntil(r.dateLimite) || 0), montant: r.solde, majoration: a ? Math.max(0, a.montant - r.solde) : 0, exigible: a ? a.montant : r.solde, amr: a ? a.amr : '', amrRow: a, dette: r, petit: r.solde < seuilDette });
    }
    for (const a of libres) {
      if (a.pris) continue;
      const sc = get(a);
      const ma = moisAmr(a), MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
      sc.retard.push({ impot: 'AMR', annee: '', commune: '', reference: `n° ${a.amr}`, emis: ma ? `${MOIS[+ma.slice(4) - 1]} ${ma.slice(0, 4)}` : '', dateLimite: '', jours: 0, montant: a.montant, majoration: 0, exigible: a.montant, amr: a.amr, amrRow: a, dette: null, petit: a.montant < seuilDette, seul: true });
    }
    for (const sc of Object.values(out)) { sc.retard = sc.retard.filter((l) => !l.petit); sc.retard.sort((x, y) => y.exigible - x.exigible); sc.totalRetard = sc.retard.reduce((t, l) => t + l.exigible, 0); }
    return out;
  }

  // Campagne complète à partir des données stockées
  function campagne(data, opts = {}) {
    const S = data.settings || {};
    const annee = String(opts.annee || anneeCampagne()), anneeN1 = String(Number(annee) - 1);
    const corresp = S.correspondance || {};
    const info = (siren) => corresp[siren] || {};
    let scopeSet = null;
    if (opts.scope === 'moi') {
      const mine = Object.entries(corresp).filter(([, v]) => S.moi && v.collaborateur === S.moi).map(([k]) => k);
      scopeSet = new Set([...mine, ...(S.portefeuille || [])]);
    }
    // Filtre « compte impots.gouv » : dossiers rattachés à ce compte lors d'une mise à jour (les données jamais retaguées restent hors filtre jusqu'à la prochaine mise à jour)
    let compteSet = null;
    const compte = opts.compte !== undefined ? opts.compte : (S.compte || '');
    if (compte) {
      compteSet = new Set();
      for (const d of data.dossiers || []) if ((d.comptes || []).includes(compte)) compteSet.add(d.siren);
      for (const a of data.avis) if ((a.comptes || []).includes(compte)) compteSet.add(a.siren);
    }
    const inScope = (siren) => (!scopeSet || scopeSet.has(siren)) && (!compteSet || compteSet.has(siren));
    const avis = data.avis.filter((a) => inScope(a.siren)).map((a) => ({ ...a, m: num(a.infos && a.infos.montantImpot) || num(a.montant), code: info(a.siren).code || '', collab: info(a.siren).collaborateur || '', email: info(a.siren).email || '' }));
    // Paiements d'impôts locaux lus à la source (Compte fiscal › Synthèses › Paiements impôts locaux)
    const normCom = (x) => String(x || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
    const paiements = {}; for (const p of data.paiements || []) paiements[p.siren] = p;
    const paiementDe = (a) => {
      const p = paiements[a.siren]; if (!p) return null;
      let c = (p.rows || []).filter((r) => r.impot === a.taxe && (r.periode === a.annee || r.anneeLue === a.annee) && (!r.commune || !a.commune || normCom(r.commune) === normCom(a.commune)));
      if (a.taxe === 'CFE' && a.nic) c = c.filter((r) => !r.nic || String(r.nic).slice(-5) === String(a.nic).slice(-5));
      if (a.taxe === 'TF' && a.role) { const n = String(a.role).replace(/\D/g, ''); const cr = c.filter((r) => n && String(r.reference || '').replace(/\D/g, '').includes(n)); if (cr.length) c = cr; }
      const ac = c.filter((r) => /acompte/i.test(r.natureDette || '')); c = a.acompte ? (ac.length ? ac : c) : c.filter((r) => !/acompte/i.test(r.natureDette || ''));
      if (!c.length) return null;
      const m = num(a.infos && a.infos.montantAPayer) || num(a.montant);
      c.sort((x, y) => Math.abs(num(x.montant) - m) - Math.abs(num(y.montant) - m));
      const tot = c.reduce((t, r) => t + num(r.montant), 0);
      return { date: c[0].datePaiement, montant: num(c[0].montant), total: tot, nature: c[0].nature, n: c.length, complet: tot >= m - 1 };
    };
    const dettesLuesA = (siren) => { const d = (data.dettes || []).find((x) => x.siren === siren); return d ? d.at || 0 : 0; };
    const poolN1 = avis.filter((a) => a.annee === anneeN1);
    const today = todayKey();
    const N = avis.filter((a) => a.annee === annee).map((a) => {
      const n1 = a.acompte ? null : matchN1(a, poolN1);
      const d = decompose(a, n1);
      const prel = a.infos ? a.infos.prelevement : '';
      const delai = !a.dateLimite ? '' : dkey(a.dateLimite) < today ? 'passée' : 'à venir';
      const hausse = !!(n1 && n1.m > 0 && d.pct >= (S.seuilPct || 10) && d.delta >= (S.seuilEur || 100));
      const baisse = !!(n1 && n1.m > 0 && d.pct <= -(S.seuilPct || 10) && -d.delta >= (S.seuilEur || 100));
      const cfe = a.taxe === 'CFE' && !a.acompte ? controleCfe(a, (data.ca || {})[a.siren], annee) : null;
      const paye = paiementDe(a);
      return { ...a, n1, d, prel, cfe, paye, paiement: paye && paye.complet ? `Payé le ${paye.date}${/prélèvement/i.test(paye.nature || '') ? ' (prélèvement)' : ''}` : paye ? `Payé en partie (${eur(paye.total)} le ${paye.date})` : PAIEMENT[prel] || 'Non déterminé', delai, hausse, baisse, jours: daysUntil(a.dateLimite), situation: a.acompte ? 'Acompte' : hausse ? 'Hausse' : baisse ? 'Baisse' : n1 ? 'Stable' : 'Nouveau' };
    });
    const seuilDette = S.seuilDette ?? 5;
    const dettes = data.dettes.filter((x) => inScope(x.siren)).flatMap((x) => (x.rows || []).map((r) => ({ ...r, siren: x.siren, nom: x.nom, solde: num(r.solde), montantDu: num(r.montantDu), collab: info(x.siren).collaborateur || '' })));
    // Avis de mise en recouvrement à payer (« Payer › Dette fiscale ») : pénalités, rappels, etc. — exigibles
    const amr = data.dettes.filter((x) => inScope(x.siren)).flatMap((x) => (x.amr || []).map((r) => ({ ...r, siren: x.siren, nom: x.nom, montant: num(r.montant), collab: info(x.siren).collaborateur || '' })));

    // ---- Liste de travail ----
    const T = [];
    const add = (t) => { const st = data.tasks[t.id]; const snoozed = st && st.status === 'snooze' && st.until && st.until > Date.now(); T.push({ ...t, done: !!(st && st.status === 'done'), snoozed, doneAt: st && st.at, note: (st && st.note) || '' }); };
    // Plusieurs établissements d'un même SIREN imposés sur la base minimum : la cotisation minimum n'est due qu'une fois, au principal établissement
    // (art. 1647 D, I-1 du CGI ; BOI-IF-CFE-20-20-40-10 § 30-40) ; les autres établissements sont imposés sur leur propre base (valeur locative)
    const bmParSiren = {};
    for (const a of N) if (a.cfe && a.cfe.bm) (bmParSiren[a.siren] = bmParSiren[a.siren] || []).push(a);
    for (const [siren, l] of Object.entries(bmParSiren)) {
      if (l.length < 2) continue;
      const pn = ((data.ca || {})[siren] || {}).parNic || {};
      const caDe = (a) => (a.nic && pn[a.nic] !== undefined && pn[a.nic] !== '' ? num(pn[a.nic]) : null);
      const principal = l.every((a) => caDe(a) !== null) ? l.reduce((m, a) => (caDe(a) > caDe(m) ? a : m)) : null;
      for (const a of l) {
        if (principal && a === principal) { a.cfe.infos.push(`Principal établissement (chiffre d’affaires le plus élevé) : la cotisation minimum y est due.`); continue; }
        a.cfe.anomalies.push({ type: 'cfp', certain: false, groupe: principal ? '' : siren, texte: principal
          ? `Établissement secondaire (CA ${eur(caDe(a))}) imposé sur la base minimum de ${eur(a.cfe.bmM)} : la cotisation minimum n’est due qu’au principal établissement (${principal.commune}). Ici, la base devrait être la valeur locative du local (art. 1647 D, I-1 du CGI).`
          : `${l.length} établissements de ce SIREN sont imposés sur la base minimum (${l.map((x) => x.commune).join(', ')}) : la cotisation minimum n’est due qu’une fois, au principal établissement (art. 1647 D, I-1 du CGI). Indiquez le chiffre d’affaires de chaque établissement sur la fiche pour savoir lequel est le principal.` });
      }
    }
    // Un avis échu figure-t-il dans la dette fiscale ? (impôt, année, commune ; sinon montant)
    const detteDe = (a) => dettes.find((r) => r.siren === a.siren && new RegExp(a.taxe === 'TF' ? 'TF|FONCI' : 'CFE', 'i').test(r.impot || '') && String(r.annee) === String(a.annee) && (!r.commune || !a.commune || normCom(r.commune) === normCom(a.commune)) && r.solde > 0);
    for (const a of N) {
      const lieu = `${TAXE_LABEL[a.taxe]}${a.acompte ? ' (acompte)' : ''} · ${a.commune || ''}`;
      if (a.prel === 'NON') {
        if (a.delai === 'passée') {
          // Payé ? D'abord la synthèse des paiements, sinon la dette fiscale lue après l'échéance (+3 jours de délai de remontée) : rien n'y figure → payé
          const dl = String(a.dateLimite || '').match(/(\d{2})\/(\d{2})\/(\d{4})/), dlMs = dl ? new Date(+dl[3], +dl[2] - 1, +dl[1]).getTime() + 3 * 864e5 : 0;
          const enDette = detteDe(a), dettesFraiches = dettesLuesA(a.siren) > dlMs;
          if (a.paye && a.paye.complet) a.etatPaiement = 'paye';
          else if (enDette) a.etatPaiement = 'impaye';
          else if (dettesFraiches) { a.etatPaiement = 'paye'; a.payeDeduit = true; a.paiement = `Payé (aucune créance au ${new Date(dettesLuesA(a.siren)).toLocaleDateString('fr-FR')})`; }
          else a.etatPaiement = 'inconnu';
          if (a.etatPaiement === 'inconnu') add({ id: 'pay:' + a.id, cat: 'paiement', siren: a.siren, nom: a.nom, collab: a.collab, avis: a, lieu, quoi: `Sans prélèvement automatique, à payer avant le ${a.dateLimite} : paiement non vérifiable sur le site, demander confirmation au client.`, montant: a.montant, echeance: a.jours !== null ? `Échue depuis ${-a.jours} j` : '', urgence: 10, action: 'mail-verif' });
          // impayé : traité par la créance échue ci-dessous (une seule action par client) ; payé : rien à faire
        }
        else add({ id: 'rem:' + a.id, cat: 'prevenir', siren: a.siren, nom: a.nom, collab: a.collab, avis: a, lieu, quoi: `Sans prélèvement automatique : le client doit payer en ligne avant le ${a.dateLimite}.`, montant: a.montant, echeance: a.jours !== null ? (a.jours === 0 ? 'Aujourd’hui' : `Dans ${a.jours} j`) : '', urgence: a.jours !== null && a.jours <= 7 ? 9 : 6, action: 'mail-rappel' });
      } else if (a.delai === 'passée' && a.paye && a.paye.complet) a.etatPaiement = 'paye';
      if (a.hausse) {
        const warn = a.d.verdictType === 'warn';
        add({ id: (warn ? 'bas:' : 'hau:') + a.id, cat: warn ? 'bases' : 'hausse', siren: a.siren, nom: a.nom, collab: a.collab, avis: a, lieu, quoi: `${sgn(a.d.delta)} (${pc(a.d.pct)}). ${a.d.verdict || ''}`, montant: a.m, echeance: warn ? `Réclamation avant le 31/12/${Number(a.annee) + 1}` : (PAIEMENT[a.prel] || ''), urgence: warn ? 7 : 5, action: warn ? 'reclamation' : 'mail-explication' });
      }
      if (a.cfe) for (const x of a.cfe.anomalies) if (!x.groupe || !T.some((t) => t.id === `${x.type}:${x.groupe}`)) add({ id: x.groupe ? `${x.type}:${x.groupe}` : `${x.type}:${a.id}`, cat: 'bases', siren: a.siren, nom: a.nom, collab: a.collab, avis: a, lieu, quoi: x.texte, montant: a.m, echeance: `Réclamation avant le 31/12/${Number(a.annee) + 1}`, urgence: 7, action: 'reclamation', ctrl: x });
      if (a.cfe && !a.cfe.anomalies.length) for (const t of a.cfe.infos.filter((x) => /Créée le/.test(x))) add({ id: `crv:${a.id}`, cat: 'verif', siren: a.siren, nom: a.nom, collab: a.collab, avis: a, lieu, quoi: t, montant: a.m, echeance: '', urgence: 3, action: 'pdf' });
      if (a.infos && a.infos.controle && a.infos.controle !== 'OK') add({ id: 'ver:' + a.id, cat: 'verif', siren: a.siren, nom: a.nom, collab: a.collab, avis: a, lieu, quoi: a.infos.controle, montant: a.montant, echeance: '', urgence: 4, action: 'pdf' });
    }
    // Clients ni prélevés ni mensualisés deux années de suite : proposer l'adhésion (une action par client)
    const sansPrel = {};
    for (const a of N) if (!a.acompte && a.prel === 'NON' && a.n1 && a.n1.infos && a.n1.infos.prelevement === 'NON') (sansPrel[a.siren] = sansPrel[a.siren] || []).push(a);
    for (const [siren, l] of Object.entries(sansPrel)) add({ id: 'pre:' + siren + '|' + annee, cat: 'prelevement', siren, nom: l[0].nom, collab: l[0].collab, avis: l[0], avisList: l, lieu: [...new Set(l.map((a) => TAXE_LABEL[a.taxe]))].join(' et '), quoi: `Ni prélevé ni mensualisé en ${anneeN1} et ${annee} (${l.length} avis) : proposer le prélèvement à l’échéance ou mensuel évite de vérifier le paiement chaque année.`, montant: l.reduce((x, a) => x + num(a.montant), 0), echeance: '', urgence: 2, action: 'mail-prelevement' });
    // Créances : une seule action par client, qui regroupe les dettes échues et les avis de mise en recouvrement.
    // Un AMR est le plus souvent la même dette passée en recouvrement avec majoration : il est rapproché de la dette (montant entre le solde et le solde + 15 % + 50 €) et n'est pas compté deux fois.
    const situation = situationDettes(dettes, amr, seuilDette, today);
    for (const sc of Object.values(situation)) {
      if (!sc.retard.length) continue;
      const lignes = sc.retard;
      const total = lignes.reduce((t, l) => t + l.exigible, 0);
      if (total < seuilDette) continue;
      const plusAncienne = lignes.reduce((m, l) => (l.jours > m ? l.jours : m), 0);
      const libs = lignes.map((l) => `${l.seul ? 'avis de mise en recouvrement' : l.impot + ' ' + l.annee}${l.commune ? ' ' + l.commune : ''} ${eur(l.exigible)}`);
      add({ id: `det:${sc.siren}`, cat: 'dette', siren: sc.siren, nom: sc.nom, collab: sc.collab, lieu: `${lignes.length > 1 ? plural(lignes.length, 'dette en retard', 'dettes en retard') : lignes[0].impot + ' ' + lignes[0].annee}${lignes.some((l) => l.amr) ? ' · mise en recouvrement' : ''}`,
        quoi: `${eur(total)} exigibles${lignes.some((l) => l.majoration > 0) ? ' (majorations comprises)' : ''} : ${libs.slice(0, 4).join(', ')}${libs.length > 4 ? '…' : ''}. ${lignes.some((l) => l.amr) ? 'Le service des impôts a émis un avis de mise en recouvrement : à régler sans attendre.' : 'Une majoration peut s’appliquer.'}`,
        montant: total, echeance: plusAncienne ? `Échue depuis ${plusAncienne} j` : 'Exigible', urgence: lignes.some((l) => l.amr) ? 9 : 8, action: 'mail-dette', dettes: lignes, dette: lignes[0].dette || null, amr: lignes[0].amrRow || null });
    }
    // Valeur locative des locaux professionnels : résumé écrit par l'application (ou le service worker en fin de mise à jour) après analyse des locaux
    for (const l of ((data.vlResume && data.vlResume.locaux) || [])) {
      if (!inScope(l.siren) || !(l.statut === 'TROP' || l.statut === 'PISTE')) continue;
      const trop = l.statut === 'TROP';
      add({ id: `vl:${l.siren}|${l.invariant}`, cat: trop ? 'tropaye' : 'ecartvl', siren: l.siren, nom: l.nom, collab: info(l.siren).collaborateur || '', lieu: `Local ${l.adresse || ''}${l.ville ? ' · ' + l.ville.replace(/\s*\(.*\)\s*$/, '') : ''}`, quoi: l.phrase, montant: l.enjeu || 0, montantLib: l.enjeu ? `≈ ${Math.round(l.enjeu).toLocaleString('fr-FR')} € par an` : '', echeance: `Réclamer avant le 31/12/${Number(l.annee || annee) + 1}`, urgence: trop ? 7 : 5, action: trop ? 'vl-reclam' : 'vl-releve', vl: l });
    }
    T.sort((a, b) => (a.done - b.done) || (b.urgence - a.urgence) || (b.montant - a.montant));
    const CATS = [
      { key: 'paiement', titre: 'Paiement à vérifier', aide: 'échéance passée, paiement non vérifiable sur le site', couleur: '#B33C08' },
      { key: 'prevenir', titre: 'À prévenir avant l’échéance', aide: 'le client doit payer lui-même', couleur: '#D9480F' },
      { key: 'dette', titre: 'Créance échue', aide: 'dettes fiscales non soldées et avis de mise en recouvrement à payer', couleur: '#7A2E0E' },
      { key: 'bases', titre: 'Réclamation possible', aide: 'bases de taxe foncière en hausse, base minimum ou exonération de CFE', couleur: '#1D4ED8' },
      { key: 'tropaye', titre: 'Trop payé probable', aide: 'valeur locative : catégorie ou surfaces du local à corriger, réclamation à préparer', couleur: '#B42318' },
      { key: 'ecartvl', titre: 'Trop payé possible', aide: 'l’avis dépasse le recalcul au tarif officiel : relevé de propriété à demander', couleur: '#9A6200' },
      { key: 'hausse', titre: 'Hausse à expliquer', aide: 'votée par les collectivités', couleur: '#6D28D9' },
      { key: 'prelevement', titre: 'Prélèvement à proposer', aide: 'jamais prélevé ni mensualisé : une adhésion évite les relances chaque année', couleur: '#0F766E' },
      { key: 'verif', titre: 'Avis à vérifier', aide: 'écart entre le PDF et le site, exonération de création à contrôler', couleur: '#6B7280' },
    ];

    // Avis attendus : créances CFE de l'année déjà émises alors que l'avis de solde n'est pas en ligne
    const sirensCfeN = new Set(N.filter((a) => a.taxe === 'CFE' && !a.acompte).map((a) => a.siren));
    const aVenir = dettes.filter((r) => /CFE/.test(r.impot) && String(r.annee) === annee && !sirensCfeN.has(r.siren));

    const comparables = N.filter((a) => a.n1 && !a.acompte);
    const tot = { n: comparables.reduce((s, a) => s + a.m, 0), n1: comparables.reduce((s, a) => s + a.n1.m, 0) };
    return { annee, anneeN1, avis, N, dettes, amr, situation, paiements, seuilDette, taches: T, CATS, aVenir, tot, comparables: comparables.length, calendrier: calendrier(Number(annee)), compte, comptesConnus: Object.keys(S.comptes || {}) };
  }

  // Agrégation par commune et par collectivité (taxe foncière)
  function collectivites(N) {
    const mode = (arr) => { const c = {}; arr.filter(Boolean).forEach((x) => { c[x] = (c[x] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || ''; };
    const tf = N.filter((a) => a.taxe === 'TF' && a.d && a.d.lignes.length);
    const com = {};
    for (const a of tf) {
      const k = a.commune || '(commune inconnue)';
      const g = com[k] = com[k] || { nom: k, avis: 0, clients: new Set(), cN1: 0, cN: 0, taux: 0, bases: 0, nouveaux: 0, types: {}, list: [] };
      g.avis++; g.clients.add(a.siren); g.list.push(a);
      for (const l of a.d.lignes) {
        const t = g.types[l.nom] = g.types[l.nom] || { tN1: [], tN: [], cN1: 0, cN: 0, taux: 0, bases: 0, nouveaux: 0 };
        t.tN1.push(l.tN1); t.tN.push(l.tN); t.cN1 += l.cN1; t.cN += l.cN; t.taux += l.effTaux; if (l.neuf) t.nouveaux += l.cN; else t.bases += l.effBase;
        g.cN1 += l.cN1; g.cN += l.cN; g.taux += l.effTaux; if (l.neuf) g.nouveaux += l.cN; else g.bases += l.effBase;
      }
    }
    const groups = Object.values(com).map((g) => { for (const t of Object.values(g.types)) { t.mN1 = mode(t.tN1); t.mN = mode(t.tN); t.var = num(t.mN1) ? (num(t.mN) / num(t.mN1) - 1) * 100 : 0; } return g; }).sort((a, b) => (b.cN - b.cN1) - (a.cN - a.cN1));
    const P = groups.reduce((p, g) => ({ cN1: p.cN1 + g.cN1, cN: p.cN + g.cN, taux: p.taux + g.taux, bases: p.bases + g.bases, nouveaux: p.nouveaux + g.nouveaux, avis: p.avis + g.avis }), { cN1: 0, cN: 0, taux: 0, bases: 0, nouveaux: 0, avis: 0 });
    const shared = {};
    for (const g of groups) for (const [nom, t] of Object.entries(g.types)) { if (!t.mN1 || t.mN1 === t.mN) continue; const k = `${nom}|${t.mN1}|${t.mN}`; const s = shared[k] = shared[k] || { nom, tN1: t.mN1, tN: t.mN, var: t.var, communes: [], eff: 0, avis: 0 }; s.communes.push(g.nom); s.eff += t.taux; s.avis += g.avis; }
    const decisions = Object.values(shared).sort((a, b) => b.eff - a.eff);
    const LIB = { Commune: 'la commune', 'Syndicat de communes': 'le syndicat de communes', 'Intercommunalité': 'l’intercommunalité', 'Taxes spéciales': 'les taxes spéciales', "Taxe d'ordures ménagères": 'la taxe d’ordures ménagères', 'Taxe GEMAPI': 'la taxe GEMAPI', 'Taxe additionnelle': 'la taxe additionnelle', "Chambre d'agriculture": 'la chambre d’agriculture' };
    const lib = (nom) => { const b = nom.replace(/ \(non bâti\)$/, ''); return LIB[b] || b.toLowerCase(); };
    const phrase = (g) => {
      const ch = Object.entries(g.types).filter(([, t]) => t.mN1 && t.mN1 !== t.mN).sort((a, b) => b[1].taux - a[1].taux);
      const dit = ([nom, t]) => { const l = lib(nom), pl = /^les /.test(l); return `${l} ${t.var > 0 ? (pl ? 'passent' : 'passe') : (pl ? 'baissent' : 'baisse')} de ${t.mN1} % à ${t.mN} % (${pc(t.var)})`; };
      const bati = ch.filter(([n]) => !/non bâti/.test(n)).map(dit), nb = ch.filter(([n]) => /non bâti/.test(n)).map(dit);
      const bp = g.cN1 ? ((g.cN - g.taux - g.nouveaux) / g.cN1 - 1) * 100 : 0;
      return (bati.length ? `Décisions de l’année : ${bati.join(' ; ')}. ` : '') + (nb.length ? `Terrains non bâtis : ${nb.join(' ; ')}. ` : '') + (!ch.length ? 'Aucun changement de taux. ' : '')
        + `Pour vos ${g.avis} avis, les cotisations passent de ${eur(g.cN1)} à ${eur(g.cN)} (${sgn(g.cN - g.cN1)}) : ${sgn(g.taux)} dus aux taux, ${sgn(g.bases)} aux bases${g.cN1 ? ` (${pc(bp)}${Math.abs(bp) <= 3 ? ', revalorisation annuelle' : ', au-delà de la revalorisation : locaux modifiés, fins d’exonération ou révisions à examiner'})` : ''}${g.nouveaux > 0.5 ? ` et ${sgn(g.nouveaux)} de biens imposés pour la première fois` : ''}.`;
    };
    groups.forEach((g) => { g.phrase = phrase(g); g.nClients = g.clients.size; });
    return { groups, P, decisions };
  }

  return { pseudo, BAREME_BM, controleCfe, situationDettes, num, eur, eur2, sgn, pc, dkey, daysUntil, anneeCampagne, campagne, collectivites, decompose, calendrier, TAXE_LABEL, PAIEMENT };
})();
if (typeof self !== 'undefined') self.ACA = ACA;
