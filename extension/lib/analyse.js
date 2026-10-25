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
    if (exos.length) {
      const e = exos[0]; out.exo = e; out.caRef = Math.round(num(e.ca) * 12 / (num(e.duree) || 12));
      const b = BAREME_BM[annee];
      if (b) { const i = b.findIndex((t) => out.caRef <= t[0]); out.tranche = trancheLib(b, i); out.plafond = b[i][1]; }
      if (out.bm && out.caRef <= 5000) out.anomalies.push({ type: 'cfm', certain: true, texte: `Chiffre d’affaires ${out.ref} de ${eur(out.caRef)}${num(e.duree) && num(e.duree) !== 12 ? ' (ramené à 12 mois)' : ''} : exonération de plein droit de la cotisation minimum (CA ≤ 5 000 €), mais imposition sur une base minimum de ${eur(out.bmM)}.` });
      else if (out.bm && out.plafond && out.bmM > out.plafond + 1) out.anomalies.push({ type: 'cfm', certain: true, texte: `Base minimum de ${eur(out.bmM)} supérieure au plafond légal de ${eur(out.plafond)} pour un ${out.tranche.replace(/^CA/, 'chiffre d’affaires')} (CA ${out.ref} : ${eur(out.caRef)}) : tranche supérieure appliquée.` });
    } else if (out.bm) out.infos.push(`Chiffre d’affaires ${out.ref} non importé : contrôle de la base minimum impossible.`);
    const cr = caInfo.creation || '', crY = String(cr).slice(-4);
    if (crY === String(annee)) out.anomalies.push({ type: 'cre', certain: true, texte: `Entreprise créée le ${cr} : pas de CFE l’année de création (art. 1478 II du CGI), or un avis ${annee} a été émis.` });
    else if (crY === String(Number(annee) - 1)) out.infos.push(`Créée le ${cr} : première année d’imposition, la base doit être réduite de moitié (art. 1478 II du CGI). À vérifier sur l’avis.`);
    return out;
  }

  const PAIEMENT = { OUI: 'Prélevé à l’échéance', MENSUEL: 'Mensualisé', NON: 'À payer par le client' };

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
    const inScope = (siren) => !scopeSet || scopeSet.has(siren);
    const avis = data.avis.filter((a) => inScope(a.siren)).map((a) => ({ ...a, m: num(a.infos && a.infos.montantImpot) || num(a.montant), code: info(a.siren).code || '', collab: info(a.siren).collaborateur || '', email: info(a.siren).email || '' }));
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
      return { ...a, n1, d, prel, cfe, paiement: PAIEMENT[prel] || 'Non déterminé', delai, hausse, baisse, jours: daysUntil(a.dateLimite), situation: a.acompte ? 'Acompte' : hausse ? 'Hausse' : baisse ? 'Baisse' : n1 ? 'Stable' : 'Nouveau' };
    });
    const seuilDette = S.seuilDette ?? 5;
    const dettes = data.dettes.filter((x) => inScope(x.siren)).flatMap((x) => (x.rows || []).map((r) => ({ ...r, siren: x.siren, nom: x.nom, solde: num(r.solde), montantDu: num(r.montantDu), collab: info(x.siren).collaborateur || '' })));
    // Avis de mise en recouvrement à payer (« Payer › Dette fiscale ») : pénalités, rappels, etc. — exigibles
    const amr = data.dettes.filter((x) => inScope(x.siren)).flatMap((x) => (x.amr || []).map((r) => ({ ...r, siren: x.siren, nom: x.nom, montant: num(r.montant), collab: info(x.siren).collaborateur || '' })));

    // ---- Liste de travail ----
    const T = [];
    const add = (t) => { const st = data.tasks[t.id]; const snoozed = st && st.status === 'snooze' && st.until && st.until > Date.now(); T.push({ ...t, done: !!(st && st.status === 'done'), snoozed, doneAt: st && st.at, note: (st && st.note) || '' }); };
    for (const a of N) {
      const lieu = `${TAXE_LABEL[a.taxe]}${a.acompte ? ' (acompte)' : ''} · ${a.commune || ''}`;
      if (a.prel === 'NON') {
        if (a.delai === 'passée') add({ id: 'pay:' + a.id, cat: 'paiement', siren: a.siren, nom: a.nom, collab: a.collab, avis: a, lieu, quoi: `Sans prélèvement automatique, à payer avant le ${a.dateLimite} : vérifier que le client a payé.`, montant: a.montant, echeance: a.jours !== null ? `Échue depuis ${-a.jours} j` : '', urgence: 10, action: 'mail-verif' });
        else add({ id: 'rem:' + a.id, cat: 'prevenir', siren: a.siren, nom: a.nom, collab: a.collab, avis: a, lieu, quoi: `Sans prélèvement automatique : le client doit payer en ligne avant le ${a.dateLimite}.`, montant: a.montant, echeance: a.jours !== null ? (a.jours === 0 ? 'Aujourd’hui' : `Dans ${a.jours} j`) : '', urgence: a.jours !== null && a.jours <= 7 ? 9 : 6, action: 'mail-rappel' });
      }
      if (a.hausse) {
        const warn = a.d.verdictType === 'warn';
        add({ id: (warn ? 'bas:' : 'hau:') + a.id, cat: warn ? 'bases' : 'hausse', siren: a.siren, nom: a.nom, collab: a.collab, avis: a, lieu, quoi: `${sgn(a.d.delta)} (${pc(a.d.pct)}). ${a.d.verdict || ''}`, montant: a.m, echeance: warn ? `Réclamation avant le 31/12/${Number(a.annee) + 1}` : (PAIEMENT[a.prel] || ''), urgence: warn ? 7 : 5, action: warn ? 'reclamation' : 'mail-explication' });
      }
      if (a.cfe) for (const x of a.cfe.anomalies) add({ id: `${x.type}:${a.id}`, cat: 'bases', siren: a.siren, nom: a.nom, collab: a.collab, avis: a, lieu, quoi: x.texte, montant: a.m, echeance: `Réclamation avant le 31/12/${Number(a.annee) + 1}`, urgence: 7, action: 'reclamation', ctrl: x });
      if (a.cfe && !a.cfe.anomalies.length) for (const t of a.cfe.infos.filter((x) => /Créée le/.test(x))) add({ id: `crv:${a.id}`, cat: 'verif', siren: a.siren, nom: a.nom, collab: a.collab, avis: a, lieu, quoi: t, montant: a.m, echeance: '', urgence: 3, action: 'pdf' });
      if (a.infos && a.infos.controle && a.infos.controle !== 'OK') add({ id: 'ver:' + a.id, cat: 'verif', siren: a.siren, nom: a.nom, collab: a.collab, avis: a, lieu, quoi: a.infos.controle, montant: a.montant, echeance: '', urgence: 4, action: 'pdf' });
    }
    // Clients ni prélevés ni mensualisés deux années de suite : proposer l'adhésion (une action par client)
    const sansPrel = {};
    for (const a of N) if (!a.acompte && a.prel === 'NON' && a.n1 && a.n1.infos && a.n1.infos.prelevement === 'NON') (sansPrel[a.siren] = sansPrel[a.siren] || []).push(a);
    for (const [siren, l] of Object.entries(sansPrel)) add({ id: 'pre:' + siren + '|' + annee, cat: 'prelevement', siren, nom: l[0].nom, collab: l[0].collab, avis: l[0], avisList: l, lieu: [...new Set(l.map((a) => TAXE_LABEL[a.taxe]))].join(' et '), quoi: `Ni prélevé ni mensualisé en ${anneeN1} et ${annee} (${l.length} avis) : proposer le prélèvement à l’échéance ou mensuel évite de vérifier le paiement chaque année.`, montant: l.reduce((x, a) => x + num(a.montant), 0), echeance: '', urgence: 2, action: 'mail-prelevement' });
    for (const r of dettes) {
      const dl = dkey(r.dateLimite);
      if (dl && dl < today && r.solde >= seuilDette) add({ id: `det:${r.siren}|${r.annee}|${r.impot}|${r.reference}`, cat: 'dette', siren: r.siren, nom: r.nom, collab: r.collab, lieu: `${r.impot} ${r.annee}${r.commune ? ' · ' + r.commune : ''}`, quoi: `Solde non réglé dans les dettes fiscales depuis le ${r.dateLimite}${r.reference ? ' (' + r.reference + ')' : ''} : une majoration peut s’appliquer.`, montant: r.solde, echeance: `Échue depuis ${-daysUntil(r.dateLimite)} j`, urgence: 8, action: 'mail-dette', dette: r });
    }
    for (const r of amr) {
      if (r.montant < seuilDette) continue;
      add({ id: `amr:${r.siren}|${r.amr}`, cat: 'dette', siren: r.siren, nom: r.nom, collab: r.collab, lieu: `Avis de mise en recouvrement n° ${r.amr}`, quoi: 'Document à payer dans « Payer › Dette fiscale » (pénalité, rappel ou majoration émis par le service des impôts). Le détail figure sur le site, à l’étape suivante du paiement.', montant: r.montant, echeance: 'Exigible', urgence: 9, action: 'mail-amr', amr: r });
    }
    T.sort((a, b) => (a.done - b.done) || (b.urgence - a.urgence) || (b.montant - a.montant));
    const CATS = [
      { key: 'paiement', titre: 'Paiement à vérifier', aide: 'échéance passée, pas de prélèvement automatique', couleur: '#B33C08' },
      { key: 'prevenir', titre: 'À prévenir avant l’échéance', aide: 'le client doit payer lui-même', couleur: '#D9480F' },
      { key: 'dette', titre: 'Créance échue', aide: 'dettes fiscales non soldées et avis de mise en recouvrement à payer', couleur: '#7A2E0E' },
      { key: 'bases', titre: 'Réclamation possible', aide: 'bases de taxe foncière en hausse, base minimum ou exonération de CFE', couleur: '#1D4ED8' },
      { key: 'hausse', titre: 'Hausse à expliquer', aide: 'votée par les collectivités', couleur: '#6D28D9' },
      { key: 'prelevement', titre: 'Prélèvement à proposer', aide: 'jamais prélevé ni mensualisé : une adhésion évite les relances chaque année', couleur: '#0F766E' },
      { key: 'verif', titre: 'Avis à vérifier', aide: 'écart entre le PDF et le site, exonération de création à contrôler', couleur: '#6B7280' },
    ];

    // Avis attendus : créances CFE de l'année déjà émises alors que l'avis de solde n'est pas en ligne
    const sirensCfeN = new Set(N.filter((a) => a.taxe === 'CFE' && !a.acompte).map((a) => a.siren));
    const aVenir = dettes.filter((r) => /CFE/.test(r.impot) && String(r.annee) === annee && !sirensCfeN.has(r.siren));

    const comparables = N.filter((a) => a.n1 && !a.acompte);
    const tot = { n: comparables.reduce((s, a) => s + a.m, 0), n1: comparables.reduce((s, a) => s + a.n1.m, 0) };
    return { annee, anneeN1, avis, N, dettes, amr, seuilDette, taches: T, CATS, aVenir, tot, comparables: comparables.length, calendrier: calendrier(Number(annee)) };
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

  return { pseudo, BAREME_BM, controleCfe, num, eur, eur2, sgn, pc, dkey, daysUntil, anneeCampagne, campagne, collectivites, decompose, calendrier, TAXE_LABEL, PAIEMENT };
})();
if (typeof self !== 'undefined') self.ACA = ACA;
