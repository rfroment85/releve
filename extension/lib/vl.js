// Relève — valeur locative des locaux professionnels (révision 2017, art. 1498 et 1518 A quinquies CGI)
// Calcul sur le poste, à partir des paramètres départementaux publiés par la DGFiP (data/rvllp/<dép>.json, générés depuis
// https://www.impots.gouv.fr/portail/node/11406 : grilles tarifaires, secteurs par section cadastrale, coefficients de localisation
// et de neutralisation). Fonctions pures, sauf `charger` qui lit le fichier du département embarqué dans l'extension.
'use strict';
const ACVL = (() => {
  // Catégories (art. 310 Q annexe II CGI)
  const CATEGORIES = {
    MAG1: 'Boutiques et magasins sur rue (moins de 400 m²)', MAG2: 'Commerces sans accès direct sur la rue', MAG3: 'Magasins en ensemble commercial (moins de 400 m²)',
    MAG4: 'Magasins de grande surface (400 à 2 499 m²)', MAG5: 'Magasins de très grande surface (2 500 m² et plus)', MAG6: 'Stations-service, stations de lavage', MAG7: 'Marchés',
    BUR1: 'Bureaux dans un immeuble ancien', BUR2: 'Bureaux dans un immeuble récent', BUR3: 'Locaux de professions libérales',
    DEP1: 'Lieux de dépôt à ciel ouvert', DEP2: 'Lieux de dépôt couverts', DEP3: 'Parcs de stationnement à ciel ouvert', DEP4: 'Parcs de stationnement couverts', DEP5: 'Installations de stockage (silos, citernes…)',
    ATE1: 'Ateliers artisanaux', ATE2: 'Locaux à usage industriel ou artisanal', ATE3: 'Chenils, viviers et autres locaux assimilables',
    HOT1: 'Hôtels de luxe (4 étoiles et plus) et complexes hôteliers', HOT2: 'Hôtels 2 ou 3 étoiles', HOT3: 'Hôtels 1 étoile', HOT4: 'Foyers d’hébergement, centres d’accueil', HOT5: 'Hôtels-clubs, villages de vacances',
    SPE1: 'Salles de spectacle, cinémas', SPE2: 'Établissements de sport couverts', SPE3: 'Établissements de sport de plein air', SPE4: 'Terrains de camping', SPE5: 'Terrains de golf', SPE6: 'Établissements de détente et de loisirs', SPE7: 'Centres de loisirs, de colonies de vacances',
    ENS1: 'Écoles et institutions privées', ENS2: 'Établissements d’enseignement privés',
    CLI1: 'Cliniques et établissements hospitaliers', CLI2: 'Centres médicaux, maisons de retraite', CLI3: 'Établissements de soins (thalassothérapie…)', CLI4: 'Centres de rééducation, foyers médicalisés',
    IND1: 'Établissements industriels n’étant pas évalués selon la méthode comptable', IND2: 'Carrières et établissements assimilables',
    EXC1: 'Locaux ne relevant d’aucune catégorie',
  };
  // Code de catégorie à partir du libellé affiché par « Gérer mes biens immobiliers »
  const LIBELLES = [
    [/boutiques? et magasins? sur rue/i, 'MAG1'], [/sans acc[èe]s direct/i, 'MAG2'], [/ensemble commercial/i, 'MAG3'], [/grande surface.*400/i, 'MAG4'], [/tr[èe]s grande surface|2 ?500/i, 'MAG5'], [/station/i, 'MAG6'], [/march[ée]s/i, 'MAG7'],
    [/bureaux?.*ancien/i, 'BUR1'], [/bureaux?.*r[ée]cent/i, 'BUR2'], [/professions? lib[ée]rales?/i, 'BUR3'],
    [/d[ée]p[ôo]ts? [àa] ciel ouvert/i, 'DEP1'], [/d[ée]p[ôo]ts? couverts?/i, 'DEP2'], [/stationnement.*ciel ouvert/i, 'DEP3'], [/stationnement.*couvert/i, 'DEP4'], [/stockage|silo|citerne/i, 'DEP5'],
    [/ateliers? artisana/i, 'ATE1'], [/industriel ou artisanal/i, 'ATE2'], [/chenil|vivier/i, 'ATE3'],
    [/h[ôo]tels?.*(luxe|4 ?[ée]toiles|sup[ée]rieur [àa] 3|complexe)/i, 'HOT1'], [/h[ôo]tels?.*(2 ou 3|2 ?[ée]toiles|3 ?[ée]toiles)/i, 'HOT2'], [/h[ôo]tels?.*(1 ?[ée]toile|ordinaire|non class)/i, 'HOT3'], [/foyer|centre d.accueil|h[ée]bergement/i, 'HOT4'], [/club|village de vacances/i, 'HOT5'],
    [/spectacle|cin[ée]ma/i, 'SPE1'], [/sport.*couvert/i, 'SPE2'], [/sport.*plein air/i, 'SPE3'], [/camping/i, 'SPE4'], [/golf/i, 'SPE5'], [/d[ée]tente|loisirs?(?! de)/i, 'SPE6'], [/centres? de loisirs|colonies/i, 'SPE7'],
    [/[ée]coles?|institutions? priv/i, 'ENS1'], [/enseignement/i, 'ENS2'],
    [/cliniques?|hospital/i, 'CLI1'], [/centres? m[ée]dicaux|maisons? de retraite/i, 'CLI2'], [/soins/i, 'CLI3'], [/r[ée][ée]ducation|m[ée]dicalis/i, 'CLI4'],
    [/carri[èe]res?/i, 'IND2'], [/industriels?/i, 'IND1'], [/exceptionnel|aucune/i, 'EXC1'],
  ];
  // Libellés courts, pour les phrases (« classé MAG1 (boutique < 400 m²) »)
  const COURT = {
    MAG1: 'boutique sur rue < 400 m²', MAG2: 'commerce sans accès sur rue', MAG3: 'magasin en centre commercial < 400 m²', MAG4: 'magasin de 400 à 2 499 m²', MAG5: 'magasin ≥ 2 500 m²', MAG6: 'station-service', MAG7: 'marché',
    BUR1: 'bureaux, immeuble ancien', BUR2: 'bureaux, immeuble récent', BUR3: 'profession libérale', DEP1: 'dépôt à ciel ouvert', DEP2: 'dépôt couvert', DEP3: 'parking à ciel ouvert', DEP4: 'parking couvert', DEP5: 'silo, citerne',
    ATE1: 'atelier artisanal', ATE2: 'local industriel ou artisanal', ATE3: 'chenil, vivier', HOT1: 'hôtel 4 étoiles et plus', HOT2: 'hôtel 2 ou 3 étoiles', HOT3: 'hôtel 1 étoile ou non classé', HOT4: 'foyer d’hébergement', HOT5: 'hôtel-club, village de vacances',
    SPE1: 'salle de spectacle, cinéma', SPE2: 'sport couvert', SPE3: 'sport de plein air', SPE4: 'camping', SPE5: 'golf', SPE6: 'détente et loisirs', SPE7: 'centre de loisirs', ENS1: 'école privée', ENS2: 'enseignement privé',
    CLI1: 'clinique', CLI2: 'centre médical, maison de retraite', CLI3: 'établissement de soins', CLI4: 'rééducation, foyer médicalisé', IND1: 'établissement industriel (hors méthode comptable)', IND2: 'carrière', EXC1: 'local exceptionnel',
  };
  const nomCat = (c) => c ? (COURT[c] ? `${c} (${COURT[c]})` : c) : 'catégorie inconnue';
  const categorieCode = (lib) => { const t = String(lib || ''); if (/^[A-Z]{3}\d$/.test(t)) return t; if ((/m[ée]thode comptable/i.test(t) && !/pas|non /i.test(t)) || /appr[ée]ciation directe/i.test(t)) return 'HORS'; for (const [re, c] of LIBELLES) if (re.test(t)) return c; return ''; };
  const DEPARTEMENTS = { '01': 'AIN', '02': 'AISNE', '03': 'ALLIER', '04': 'ALPES-DE-HAUTE-PROVENCE', '05': 'HAUTES-ALPES', '06': 'ALPES-MARITIMES', '07': 'ARDECHE', '08': 'ARDENNES', '09': 'ARIEGE', '10': 'AUBE', '11': 'AUDE', '12': 'AVEYRON', '13': 'BOUCHES-DU-RHONE', '14': 'CALVADOS', '15': 'CANTAL', '16': 'CHARENTE', '17': 'CHARENTE-MARITIME', '18': 'CHER', '19': 'CORREZE', '2A': 'CORSE-DU-SUD', '2B': 'HAUTE-CORSE', '21': 'COTE-D\'OR', '22': 'COTES-D\'ARMOR', '23': 'CREUSE', '24': 'DORDOGNE', '25': 'DOUBS', '26': 'DROME', '27': 'EURE', '28': 'EURE-ET-LOIR', '29': 'FINISTERE', '30': 'GARD', '31': 'HAUTE-GARONNE', '32': 'GERS', '33': 'GIRONDE', '34': 'HERAULT', '35': 'ILLE-ET-VILAINE', '36': 'INDRE', '37': 'INDRE-ET-LOIRE', '38': 'ISERE', '39': 'JURA', '40': 'LANDES', '41': 'LOIR-ET-CHER', '42': 'LOIRE', '43': 'HAUTE-LOIRE', '44': 'LOIRE-ATLANTIQUE', '45': 'LOIRET', '46': 'LOT', '47': 'LOT-ET-GARONNE', '48': 'LOZERE', '49': 'MAINE-ET-LOIRE', '50': 'MANCHE', '51': 'MARNE', '52': 'HAUTE-MARNE', '53': 'MAYENNE', '54': 'MEURTHE-ET-MOSELLE', '55': 'MEUSE', '56': 'MORBIHAN', '57': 'MOSELLE', '58': 'NIEVRE', '59': 'NORD', '60': 'OISE', '61': 'ORNE', '62': 'PAS-DE-CALAIS', '63': 'PUY-DE-DOME', '64': 'PYRENEES-ATLANTIQUES', '65': 'HAUTES-PYRENEES', '66': 'PYRENEES-ORIENTALES', '67': 'BAS-RHIN', '68': 'HAUT-RHIN', '69': 'RHONE', '70': 'HAUTE-SAONE', '71': 'SAONE-ET-LOIRE', '72': 'SARTHE', '73': 'SAVOIE', '74': 'HAUTE-SAVOIE', '75': 'PARIS', '76': 'SEINE-MARITIME', '77': 'SEINE-ET-MARNE', '78': 'YVELINES', '79': 'DEUX-SEVRES', '80': 'SOMME', '81': 'TARN', '82': 'TARN-ET-GARONNE', '83': 'VAR', '84': 'VAUCLUSE', '85': 'VENDEE', '86': 'VIENNE', '87': 'HAUTE-VIENNE', '88': 'VOSGES', '89': 'YONNE', '90': 'TERRITOIRE DE BELFORT', '91': 'ESSONNE', '92': 'HAUTS-DE-SEINE', '93': 'SEINE-SAINT-DENIS', '94': 'VAL-DE-MARNE', '95': 'VAL-D\'OISE', '971': 'GUADELOUPE', '972': 'MARTINIQUE', '973': 'GUYANE', '974': 'LA REUNION', '976': 'MAYOTTE' };
  const normNom = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\bSAINT\b/g, 'ST').replace(/\bSAINTE\b/g, 'STE').replace(/[^A-Z0-9]+/g, ' ').trim();
  // Code du département à partir de ce qu'affiche impots.gouv : « 83 - Var », « 083 », « 2A », « 974 - La Réunion », « Var », « (HTE GARONNE) »…
  const esc0 = (x) => String(x).replace(/[<>&"]/g, '');
  const depNom = (x) => normNom(x).replace(/\bHTES\b/g, 'HAUTES').replace(/\bHTE\b/g, 'HAUTE').replace(/\bHTS\b/g, 'HAUTS').replace(/\bHT\b/g, 'HAUT').replace(/^(LA|LE|LES|L)\s+/, '').replace(/\s+/g, ' ');
  const DEP_NOMS = Object.entries(DEPARTEMENTS).map(([c, l]) => [c, depNom(l)]).sort((a, b) => b[1].length - a[1].length);
  const depCode = (x) => {
    const s = String(x || '').toUpperCase().trim(); if (!s) return '';
    const m = s.match(/(?:^|\(|\s)(0?9[78]\d|0?\d{2}|2[AB])(?=$|\)|\s|-|–|:)/);
    if (m) { let c = m[1]; if (c.length === 3 && c[0] === '0') c = c.slice(1); if (DEPARTEMENTS[c]) return c; }
    const n = depNom(s.replace(/\b(0?9[78]\d|0?\d{2}|2[AB])\b/g, ' '));
    if (!n) return '';
    for (const [c, l] of DEP_NOMS) if (l === n) return c;
    for (const [c, l] of DEP_NOMS) if (l.length >= 3 && new RegExp(`(^| )${l}( |$)`).test(n)) return c; // nom contenu (« VAR FRANCE », « DEPARTEMENT DU VAR »)
    return '';
  };
  // Code INSEE (3 chiffres) d'une commune à partir de son nom, dans les données du département
  function communeCode(data, nom) {
    // Arrondissements (Paris, Lyon, Marseille) : « LYON 03 », « LYON 3EME », « LYON 3E ARRONDISSEMENT » → « LYON 3 »
    const arr = (x) => x.replace(/\b0*(\d{1,2})\s*(?:ER|EME|E)?\b(?:\s*ARRONDISSEMENT)?/, ' $1').replace(/\s+/g, ' ').trim();
    const n = normNom(String(nom || '').replace(/\s*\(.*\)\s*$/, '')), na = arr(n);
    for (const [c, e] of Object.entries(data.secteurs)) if (normNom(e.n) === n) return c;
    for (const [c, e] of Object.entries(data.secteurs)) if (arr(normNom(e.n)) === na) return c;
    for (const [c, e] of Object.entries(data.secteurs)) if (normNom(e.n).replace(/\s/g, '') === n.replace(/\s/g, '')) return c;
    return '';
  }
  // Pondération des surfaces (art. 324 Z annexe III CGI, révision 2017)
  const POND = { p1: 1, p2c: 0.5, p2nc: 0.2, pk1: 0.5, pk2: 0.2 };
  const LIB_SURF = { p1: 'Surface principale', p2c: 'Surfaces secondaires couvertes', p2nc: 'Surfaces secondaires non couvertes', pk1: 'Parking couvert', pk2: 'Parking non couvert' };
  const surfacePonderee = (s) => Object.keys(POND).reduce((t, k) => t + POND[k] * (Number(s[k]) || 0), 0);
  const round = (x, d = 0) => { const p = 10 ** d; return Math.round(x * p) / p; };

  // Chargement du fichier du département (une fois par département, gardé en mémoire)
  const cache = {};
  async function charger(dep) {
    dep = normDep(dep);
    if (cache[dep]) return cache[dep];
    const url = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL(`data/rvllp/${dep}.json`) : `data/rvllp/${dep}.json`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Paramètres d’évaluation du département ${dep} introuvables`);
    return (cache[dep] = await r.json());
  }
  const normDep = (d) => { d = String(d || '').trim().toUpperCase(); if (/^\d$/.test(d)) d = '0' + d; return d; };
  // Secteur d'évaluation de la section cadastrale (ou de la commune si la commune n'est pas sectorisée)
  function secteur(data, commune, section, prefixe) {
    const c = data.secteurs[String(Number(commune))]; if (!c) return null;
    const key = (prefixe ? prefixe + ':' : '') + String(section || '').toUpperCase();
    const s = c.s[key] ?? c.s[String(section || '').toUpperCase()] ?? c.d;
    return s ? { secteur: s, commune: c.n } : null;
  }
  function coefLoc(data, annee, commune, section, parcelle, prefixe) {
    const a = annee >= 2026 ? '2026' : '2024', m = data.coefLoc[a] || {};
    const sec = (prefixe ? prefixe + ':' : '') + String(section || '').toUpperCase(), cc = String(Number(commune));
    const p = String(parcelle || '').replace(/^0+/, '');
    for (const k of [`${cc}|${sec}|${p}`, `${cc}|${sec}|${String(parcelle || '')}`, `${cc}|${sec}|`]) if (m[k] !== undefined) return m[k];
    return 1;
  }
  function tarif(data, annee, categorie, sec) {
    const t = (data.tarifs[String(annee)] || {})[categorie]; if (!t) return null;
    return t[sec - 1] ?? null;
  }
  const neut = (data, commune) => (data.neut[String(Number(commune))] || [null])[0];

  // Évaluation d'une parcelle : locaux = [{ categorie, surfaces:{p1,p2c,p2nc,pk1,pk2} | sp }] ; vl70 = ancienne valeur locative (revalorisée) si local existant au 1/1/2017
  function evaluer(data, { commune, section, parcelle, prefixe, locaux, annee = 2025, vl70 = null }) {
    const s = secteur(data, commune, section, prefixe);
    if (!s) return { erreur: `Secteur introuvable (commune ${commune}, section ${section})` };
    const cn = neut(data, commune);
    if (!cn) return { erreur: `Coefficient de neutralisation introuvable (commune ${commune})` };
    const cl = coefLoc(data, annee, commune, section, parcelle, prefixe);
    const detail = [];
    for (const l of locaux) {
      const sp = l.sp !== undefined ? Number(l.sp) : surfacePonderee(l.surfaces || {});
      const t = tarif(data, annee, l.categorie, s.secteur);
      if (t === null) return { erreur: `Tarif ${annee} introuvable pour ${l.categorie} (secteur ${s.secteur})` };
      detail.push({ categorie: l.categorie, libelle: CATEGORIES[l.categorie] || l.categorie, sp: round(sp, 1), tarif: t, vl: sp * t * cl });
    }
    const brute = detail.reduce((a, d) => a + d.vl, 0), neutralisee = brute * cn;
    const planchonnee = vl70 ? 0.5 * (neutralisee + vl70) : neutralisee;
    return { commune: s.commune, secteur: s.secteur, coefLoc: cl, coefNeut: cn, annee, detail, brute, neutralisee, vl70, planchonnee, base: planchonnee / 2 };
  }

  // Reconstitution de l'ancienne valeur locative (1970) depuis la part communale d'un avis 2017-2025 :
  // l'écart « cotisation lissée − cotisation » vaut (2026 − année)/10 de l'écart initial entre l'impôt sur la VL 1970 et l'impôt révisé.
  function vl70DepuisAvis({ base, cotisation, cotisationLissee, annee }) {
    const frac = (2026 - Number(annee)) / 10;
    if (!(frac > 0) || !(cotisation > 0) || !(base > 0) || cotisationLissee === undefined || cotisationLissee === null) return null;
    const ecart = (cotisationLissee - cotisation) / frac;
    const vl70 = 2 * base * (cotisation + ecart) / cotisation;
    return { vl70, neutraliseeImplicite: 4 * base - vl70, planchonnee: 2 * base, lissage: cotisationLissee - cotisation, planchonnement: Math.abs(cotisationLissee - cotisation) >= 1 };
  }
  // Cotisation estimée à partir d'une base, au prorata de la cotisation réellement payée (taux de la commune et des autres collectivités, frais compris)
  const cotisationPour = (base, baseAvis, cotisationAvis) => baseAvis > 0 ? cotisationAvis * base / baseAvis : null;

  // Signaux d'alerte : ce que la fiche déclarée (GMBI) laisse soupçonner. Chaque signal propose une hypothèse corrigée à simuler.
  // local = { categorie, surfaces, occupant:{naf, nom}, etoiles, emprise (m² au sol du bâti, cadastre), niveaux }
  const NAF_CAT = [
    [/^45\.2|^45\.4/, ['ATE1', 'ATE2'], 'garage, réparation automobile'], [/^10\.|^11\.|^13\.|^14\.|^15\.|^16\.|^17\.|^18\.|^22\.|^23\.|^25\.|^31\.|^32\.|^33\./, ['ATE1', 'ATE2'], 'activité de fabrication ou d’artisanat'],
    [/^43\./, ['ATE1', 'DEP2'], 'entreprise du bâtiment'], [/^49\.4|^52\.1|^52\.2/, ['DEP2', 'DEP1'], 'transport, logistique, entreposage'],
    [/^55\.1/, ['HOT1', 'HOT2', 'HOT3'], 'hôtellerie'], [/^55\.2|^55\.3/, ['HOT5', 'SPE4'], 'hébergement de vacances, camping'],
    [/^56\./, ['MAG1', 'MAG3', 'MAG2'], 'restauration'], [/^47\./, ['MAG1', 'MAG2', 'MAG3', 'MAG4', 'MAG5'], 'commerce de détail'], [/^47\.3/, ['MAG6'], 'station-service'],
    [/^86\.1/, ['CLI1'], 'hôpital, clinique'], [/^86\.2|^86\.9/, ['BUR3'], 'profession médicale'], [/^87\.|^88\.1/, ['CLI2', 'CLI4'], 'hébergement médico-social'],
    [/^85\./, ['ENS1', 'ENS2'], 'enseignement'], [/^93\.1/, ['SPE2', 'SPE3', 'SPE6'], 'activités sportives ou de loisirs'], [/^59\.1|^90\./, ['SPE1'], 'spectacle'],
    [/^69\.|^70\.|^71\.|^73\.|^74\.|^62\.|^63\.|^64\.|^65\.|^66\.|^68\.|^78\.|^82\./, ['BUR1', 'BUR2', 'BUR3'], 'activité de bureau'],
  ];
  function signaux(local, ctx = {}) {
    const out = [], cat = local.categorie || '', s = local.surfaces || {}, sp = surfacePonderee(s), p1 = Number(s.p1) || 0;
    const naf = (local.occupant && local.occupant.naf) || '';
    if (/^MAG[13]$/.test(cat) && p1 >= 400) out.push({ code: 'MAG_400', gravite: 3, titre: `Classé ${nomCat(cat)} avec ${round(p1)} m² de surface principale`, texte: `La catégorie ${cat} est réservée aux surfaces de moins de 400 m² ; au-delà, le local relève de ${nomCat('MAG4')} ou ${nomCat('MAG5')}, dont les tarifs sont en général beaucoup plus bas.`, hypothese: { categorie: p1 >= 2500 ? 'MAG5' : 'MAG4' }, question: 'Confirmer la surface de vente réelle et l’usage du local (vente, stockage, atelier).' });
    if (naf) {
      const r = NAF_CAT.find((x) => x[0].test(naf));
      if (r && !r[1].includes(cat) && !(cat === 'EXC1')) out.push({ code: 'NAF_CAT', gravite: 2, titre: `Occupant « ${esc(local.occupant.nom || naf)} » (${r[2]}) dans un local classé ${nomCat(cat)}`, texte: `L’activité de l’occupant correspond plutôt aux catégories ${r[1].map(nomCat).join(', ')}. La catégorie se juge sur l’usage réel du local, pas sur l’activité déclarée en 2013 : un atelier classé en magasin peut voir son tarif divisé par deux.`, hypothese: { categorie: r[1][0] }, question: 'Décrire l’usage réel de chaque zone (vente, atelier, stockage, bureaux) avec un plan.' });
    }
    if (/^HOT[12]$/.test(cat) && local.etoiles !== undefined && local.etoiles !== null && Number(local.etoiles) <= 1) out.push({ code: 'HOT_ETOILES', gravite: 2, titre: `Hôtel ${local.etoiles ? local.etoiles + ' étoile' : 'non classé'} évalué en ${nomCat(cat)}`, texte: `Les hôtels 1 étoile ou non classés relèvent de ${nomCat('HOT3')}, dont le tarif est inférieur à celui de HOT2.`, hypothese: { categorie: 'HOT3' }, question: 'Fournir l’arrêté de classement Atout France (ou l’absence de classement).' });
    if (local.emprise && local.niveaux && p1 > local.emprise * local.niveaux * 1.10 + 10) out.push({ code: 'P1_EMPRISE', gravite: 2, titre: `${round(p1)} m² de surface principale pour ${round(local.emprise)} m² de bâti au sol × ${local.niveaux} niveau${local.niveaux > 1 ? 'x' : ''}${local.niveauxSource === 'ign' ? ' (estimation IGN)' : ''}`, texte: `La surface principale déclarée dépasse l’emprise au sol du bâti relevée au cadastre, multipliée par le nombre de niveaux : une partie est peut-être du parking, de la voirie ou du terrain, à pondérer 0,2 au lieu de 1${local.niveauxSource === 'ign' ? ' — ou le bâtiment a plus de niveaux que ne l’estime l’IGN' : ''}.`, hypothese: { surfaces: { ...s, p1: Math.round(local.emprise * local.niveaux), p2nc: (Number(s.p2nc) || 0) + Math.round(p1 - local.emprise * local.niveaux) } }, question: `Combien de niveaux compte le local, et les ${round(p1)} m² sont-ils tous couverts ? (plan coté ou relevé de surfaces par nature)` });
    if (local.contenance) {
      const libre = Math.max(0, local.contenance - (local.emprise || 0)), nonCouvert = (Number(s.p2nc) || 0) + (Number(s.pk2) || 0);
      if (nonCouvert > libre * 1.10 + 20) { const f = libre / nonCouvert; out.push({ code: 'NONCOUVERT_PARCELLE', gravite: 2, titre: `${round(nonCouvert)} m² non couverts déclarés pour ${round(libre)} m² de parcelle non bâtie`, texte: `D’après le cadastre, la parcelle fait ${round(local.contenance)} m² dont ${round(local.emprise || 0)} m² de bâti : il ne reste que ${round(libre)} m² au sol pour les surfaces non couvertes et le parking déclarés.`, hypothese: { surfaces: { ...s, p2nc: Math.round((Number(s.p2nc) || 0) * f), pk2: Math.round((Number(s.pk2) || 0) * f) } }, question: 'Les surfaces non couvertes déclarées sont-elles sur cette parcelle ou sur une parcelle voisine (à vérifier sur le relevé de propriété) ?' }); }
      if (/^(DEP1|DEP3|SPE3|SPE4)$/.test(cat) && p1 > local.contenance * 1.05 + 20) out.push({ code: 'P1_PARCELLE', gravite: 3, titre: `${round(p1)} m² déclarés pour une parcelle de ${round(local.contenance)} m²`, texte: 'La surface principale déclarée dépasse la surface totale de la parcelle relevée au cadastre.', hypothese: { surfaces: { ...s, p1: Math.max(0, Math.round(local.contenance - (local.emprise || 0))) } }, question: 'Le local s’étend-il sur plusieurs parcelles ? Sinon la surface déclarée est à corriger.' });
    }
    if (cat === 'DEP1' && p1 >= 3000 && !s.pk2) out.push({ code: 'DEP1_P1', gravite: 1, titre: `${round(p1)} m² de dépôt à ciel ouvert déclarés en surface principale`, texte: 'Sur un terrain d’activité, seules les surfaces réellement aménagées et utilisées comptent en principal ; les zones de circulation ou de stationnement se pondèrent 0,2, et la partie non aménagée relève du foncier non bâti.', hypothese: null, question: 'Préciser la part du terrain réellement aménagée et son usage (orthophoto, bail).' });
    if (p1 > 0 && !s.p2c && !s.p2nc && !s.pk1 && !s.pk2 && /^(MAG|ATE|DEP2|IND)/.test(cat) && p1 >= 300) out.push({ code: 'SANS_SECONDAIRE', gravite: 1, titre: 'Aucune surface secondaire déclarée', texte: 'Un local de cette taille a presque toujours des réserves, locaux techniques, sanitaires ou quais, qui se pondèrent 0,5 (couverts) ou 0,2 (non couverts) au lieu de 1 en surface principale.', hypothese: null, question: 'Vérifier sur plan la répartition surface principale / réserves / annexes.' });
    if (local.demarcheAttendue) out.push({ code: 'DEMARCHE', gravite: 2, titre: 'Déclaration attendue par l’administration', texte: 'Une construction ou des travaux non déclarés exposent à un rehaussement et font perdre l’exonération temporaire des constructions nouvelles (déclaration dans les 90 jours de l’achèvement). À régulariser avant toute réclamation.', hypothese: null, question: 'Nature et date d’achèvement des travaux ; déposer la déclaration (6660-REV, H1/H2 ou IL).' });
    if (!cat) out.push({ code: 'SANS_CAT', gravite: 1, titre: 'Catégorie non lue', texte: 'La fiche ne donne pas la catégorie d’évaluation : vérifier dans « Gérer mes biens immobiliers ».', hypothese: null, question: '' });
    return out.sort((a, b) => b.gravite - a.gravite);
  }
  const esc = (x) => String(x ?? '');

  // Rapprochement avis ↔ calcul et simulation.
  // local = { commune, section, parcelle, prefixe, categorie, surfaces, occupant, etoiles, demarcheAttendue }
  // avis = { annee, base, cotisation, cotisationLissee, cotisationTotale } de l'année analysée ; avisN1 = même chose pour l'année précédente (porte le lissage jusqu'en 2025)
  function analyser(data, local, { avis = null, avisN1 = null, annee = 2025 } = {}) {
    const an = Number(annee);
    const rec = (avisN1 && vl70DepuisAvis(avisN1)) || (avis && vl70DepuisAvis(avis)) || null;
    const vl70 = rec && rec.planchonnement ? rec.vl70 : null;
    const ref = avis || avisN1, anRef = avis ? an : (avisN1 ? Number(avisN1.annee) : an);
    const base = evaluer(data, { commune: local.commune, section: local.section, parcelle: local.parcelle, prefixe: local.prefixe, locaux: [{ categorie: local.categorie, surfaces: local.surfaces }], annee: anRef, vl70 });
    if (base.erreur) return { erreur: base.erreur, signaux: signaux(local), reconstitution: rec };
    const ecart = ref && ref.base ? (base.base - ref.base) / ref.base : null;
    const cotRef = ref ? (ref.cotisationTotale || ref.cotisation) : null;
    const sims = signaux(local).map((sg) => {
      if (!sg.hypothese) return { ...sg };
      const l2 = { categorie: sg.hypothese.categorie || local.categorie, surfaces: sg.hypothese.surfaces || local.surfaces };
      const e = evaluer(data, { commune: local.commune, section: local.section, parcelle: local.parcelle, prefixe: local.prefixe, locaux: [l2], annee: anRef, vl70 });
      if (e.erreur) return { ...sg, simulation: null };
      const cot = ref && ref.base ? cotisationPour(e.base, ref.base, cotRef) : null;
      return { ...sg, simulation: { base: e.base, neutralisee: e.neutralisee, cotisation: cot, gain: cot !== null && cotRef ? cotRef - cot : null, hypothese: l2 } };
    });
    // Hypothèse de l'utilisateur (catégorie ou surfaces saisies différentes de la fiche) : son effet est chiffré comme un signal, avec le gain correspondant
    const surfDiff = Object.keys(POND).some((k) => (Number((local.surfaces || {})[k]) || 0) !== (Number((local.surfacesDeclarees || {})[k]) || 0));
    const modif = (local.categorieDeclaree && local.categorie !== local.categorieDeclaree) || (local.surfacesDeclarees && surfDiff);
    if (modif && ref && ref.base) {
      const cot = cotisationPour(base.base, ref.base, cotRef), g = cotRef && cot !== null ? cotRef - cot : null;
      const quoi = [local.categorie !== local.categorieDeclaree ? `catégorie ${nomCat(local.categorie)} au lieu de ${nomCat(local.categorieDeclaree)}` : '', surfDiff ? 'surfaces corrigées' : ''].filter(Boolean).join(', ');
      sims.unshift({ code: 'SAISIE', gravite: g > 100 ? 3 : 1, hypothese: { categorie: local.categorie !== local.categorieDeclaree ? local.categorie : null, surfaces: surfDiff ? local.surfaces : null }, titre: `Avec votre hypothèse (${quoi})`, texte: `Base recalculée ${Math.round(base.base).toLocaleString('fr-FR')} € contre ${Math.round(ref.base).toLocaleString('fr-FR')} € sur l’avis ${ref.annee}.`, simulation: { base: base.base, cotisation: cot, gain: g, hypothese: { categorie: local.categorie, surfaces: local.surfaces } }, question: 'À étayer par des pièces (plan, bail, photos) avant réclamation.' });
    }
    return { annee: anRef, calcul: base, reconstitution: rec, ecart, ref, signaux: sims, verdict: verdict(ecart, sims, rec, ref), hypothese: !!modif };
  }
  // Verdict : ROUGE = signal grave chiffré avec gain ; ORANGE = signal à vérifier ou écart inexpliqué ; VERT = base reproduite et aucun signal
  const minu = (t) => t.replace(/^(\S+)/, (m) => (/^[A-Z]{3}\d$/.test(m) ? m : m.toLowerCase()));
  function verdict(ecart, sims, rec, ref) {
    const gain = sims.filter((s) => s.simulation && s.simulation.gain > 100);
    if (gain.length) return { code: 'ROUGE', texte: `Anomalie probable : ${minu(gain[0].titre)} — gain estimé ${Math.round(gain[0].simulation.gain).toLocaleString('fr-FR')} € par an` };
    if (sims.some((s) => s.gravite >= 2)) return { code: 'ORANGE', texte: 'À vérifier avec le client : ' + minu(sims.find((s) => s.gravite >= 2).titre) };
    if (ecart !== null && Math.abs(ecart) > 0.05) return { code: 'ORANGE', texte: `La base calculée est ${ecart < 0 ? 'inférieure' : 'supérieure'} de ${Math.abs(ecart * 100).toFixed(0)} % à l’avis${ref && ref.partage ? ' (adresse partagée avec d’autres biens : la base de l’avis les inclut)' : rec && !rec.planchonnement ? ' (pas de trace de planchonnement : local récent ou avis sans lissage)' : ''} : surfaces ou catégorie à confirmer` };
    if (ecart !== null) return { code: 'VERT', texte: 'Base de l’avis reproduite au tarif de la grille (écart ' + (ecart * 100).toFixed(1).replace('.', ',') + ' %) : pas d’erreur de calcul' + (rec && rec.planchonnement ? ' ; le planchonnement explique l’écart avec le tarif brut' : '') };
    return { code: 'GRIS', texte: 'Pas d’avis rapproché : calcul au tarif seul' };
  }
  // Analyse de tout le portefeuille : biens lus dans GMBI × avis de taxe foncière du poste × saisies de l'utilisateur.
  // biens = enregistrements { siren, nom, biens, attendues, indispo } ; avis = avis Relève (taxe TF, infos.detail.locaux) ; saisies = meta/vl ; correspondance = codes dossier
  async function portefeuille({ biens = [], avis = [], saisies = {}, annee, correspondance = {}, cache = {}, erreurs = {}, cadastre = {} }) {
    const an = Number(annee), anN1 = an - 1, out = [];
    const num = (x) => typeof x === 'number' ? x : (parseFloat(String(x || '').replace(/[\s\u00a0]/g, '').replace(',', '.')) || 0);
    const fmtK = (n) => Math.round(n || 0).toLocaleString('fr-FR');
    const depAvis = {};
    for (const a of avis) if (a.taxe === 'TF' && a.departement) { const d = depCode(a.departement) || depCode((a.infos && a.infos.detail && a.infos.detail.entete && a.infos.detail.entete.departement) || ''); if (d) (depAvis[a.siren] = depAvis[a.siren] || []).push({ d, commune: normNom(a.commune) }); }
    const depDe = (b, siren) => {
      const d = depCode((b.fiche || {}).departement) || depCode(((b.ville || '').match(/\(([^)]+)\)/) || [])[1]);
      if (d || !siren || !depAvis[siren]) return d;
      const v = normNom(String(b.ville || '').replace(/\s*\(.*\)\s*$/, '')), l = depAvis[siren];
      const meme = l.find((x) => x.commune && (x.commune === v || v.includes(x.commune) || x.commune.includes(v)));
      if (meme) return meme.d;
      const tous = [...new Set(l.map((x) => x.d))];
      return tous.length === 1 ? tous[0] : '';
    };
    // Alsace : impots.gouv peut afficher « Collectivité européenne d'Alsace » (Bas-Rhin et Haut-Rhin réunis) sans le numéro ;
    // on cherche alors la commune dans les grilles du 67 puis du 68
    const ALS = /ALSACE|\bCEA\b/;
    const alsace = (b) => ALS.test(normNom(`${(b.fiche || {}).departement || ''} ${b.ville || ''}`));
    const depDe0 = depDe;
    const depLocal = (b, siren) => {
      const d = depDe0(b, siren); if (d || !alsace(b)) return d;
      for (const c of ['67', '68']) if (cache[c] && communeCode(cache[c], b.ville)) return c;
      return '';
    };
    for (const r of biens) for (const b of r.biens || []) if (b.pro && b.fiche && !depDe(b, r.siren) && alsace(b)) for (const c of ['67', '68']) if (!cache[c] && !erreurs[c]) { try { cache[c] = await charger(c); } catch (e) { erreurs[c] = e.message; } }
    for (const r of biens) for (const b of r.biens || []) if (b.pro && b.fiche) { const d = depDe(b, r.siren); if (d && !cache[d] && !erreurs[d]) { try { cache[d] = await charger(d); } catch (e) { erreurs[d] = e.message; } } }
    for (const rec of biens) {
      const E = [];
      for (const a of avis) {
        if (a.siren !== rec.siren || a.taxe !== 'TF' || a.acompte) continue;
        for (const e of ((a.infos && a.infos.detail && a.infos.detail.locaux) || [])) E.push({ ...e, annee: Number(a.annee), avisId: a.id, commune: a.commune, entete: a.infos.detail.entete || {} });
      }
      const parAdresse = {};
      for (const b of rec.biens || []) { const k = ACTF.cle(b.adresse) + '|' + normNom(b.ville); parAdresse[k] = (parAdresse[k] || 0) + 1; }
      const info = correspondance[rec.siren] || {};
      for (const b of rec.biens || []) {
        if (!b.pro) continue;
        const f = b.fiche || { surfaces: {} }, saisie = saisies[rec.siren + '|' + b.invariant] || {};
        const dep = depLocal(b, rec.siren), data = cache[dep];
        const cleA = ACTF.cle(b.adresse), villeN = normNom(b.ville);
        const memeCommune = (e) => !e.commune || normNom(e.commune) === villeN || villeN.includes(normNom(e.commune));
        const trouve = (y) => E.find((e) => e.annee === y && ACTF.cle(e.adresse) === cleA && memeCommune(e));
        const eN = trouve(an), eN1 = trouve(anN1);
        const partage = parAdresse[cleA + '|' + villeN] > 1;
        const mkAvis = (e) => e ? { annee: e.annee, base: e.base, cotisation: e.cotisation, cotisationLissee: e.cotisationLissee, cotisationTotale: e.total || null, partage, avisId: e.avisId, adresse: e.adresse } : null;
        const cc = (eN && eN.entete.communeCode) || (eN1 && eN1.entete.communeCode) || (data ? communeCode(data, b.ville) : '');
        const inseeC = dep && cc ? (dep.length === 3 ? dep.slice(0, 2) : dep) + String(cc).padStart(3, '0') : '';
        const cad0 = inseeC && f.section && f.numParcelle ? cadastre[`${inseeC}${String(f.prefixe || '000').padStart(3, '0')}${String(f.section).toUpperCase().padStart(2, '0')}${String(f.numParcelle).padStart(4, '0')}`] : null;
        const cad = cad0 && !cad0.erreur ? cad0 : null;
        const local = {
          siren: rec.siren, nom: rec.nom, invariant: b.invariant, adresse: b.adresse, ville: b.ville, dep, commune: cc ? Number(cc) : null, section: f.section, parcelle: f.numParcelle, prefixe: f.prefixe,
          cadastre: cad, cadastreErreur: cad0 && cad0.erreur ? cad0.erreur : '', contenance: cad ? cad.contenance : null, emprise: cad ? cad.emprise : null, niveaux: saisie.niveaux || (cad && cad.niveaux) || null, niveauxSource: saisie.niveaux ? 'saisie' : (cad && cad.niveaux ? 'ign' : ''),
          categorie: saisie.categorie || categorieCode(f.categorieLibelle), categorieLibelle: f.categorieLibelle || '', categorieDeclaree: categorieCode(f.categorieLibelle), surfaces: saisie.surfaces || f.surfaces || {}, surfacesDeclarees: f.surfaces || {},
          droit: f.droit || '', lot: f.lot || b.lot, niveau: f.niveau || b.niveau, batiment: f.batiment || '',
          occupant: saisie.occupant || null, etoiles: saisie.etoiles ?? null, demarcheAttendue: (rec.attendues || []).some((x) => ACTF.cle(x.adresse) === cleA || /^0+ /.test(x.adresse)),
          exclu: !!saisie.exclu, note: saisie.note || '', code: info.code || '', collab: info.collaborateur || '',
        };
        let analyse;
        if (local.categorie === 'HORS') analyse = { verdict: { code: 'HORS', texte: 'Local évalué selon la méthode comptable ou par appréciation directe (art. 1499 et 1498 3° CGI) : la grille tarifaire ne s’applique pas.' }, signaux: [] };
        else if (!data) analyse = { erreur: dep ? (erreurs[dep] || `Département ${dep} : paramètres non chargés`) : `Département non reconnu (impots.gouv indique « ${esc0((b.fiche || {}).departement || b.ville || 'rien')} »)`, signaux: signaux(local) };
        else if (!local.commune || !local.section) analyse = { erreur: !local.commune ? `Commune « ${b.ville} » introuvable dans les secteurs d’évaluation` : 'Références cadastrales non lues', signaux: signaux(local) };
        else analyse = analyser(data, local, { avis: partage ? null : mkAvis(eN), avisN1: partage ? null : mkAvis(eN1), annee: eN ? an : (eN1 ? anN1 : an) });
        if (!analyse.erreur && partage && (eN || eN1)) { const e = eN || eN1; analyse.partage = { base: e.base, annee: e.annee, nb: parAdresse[cleA + '|' + villeN] }; if (analyse.verdict.code === 'GRIS') analyse.verdict = { code: 'ORANGE', texte: `Adresse partagée par ${analyse.partage.nb} biens : la base de l’avis (${fmtK(e.base)} €) ne peut pas être isolée local par local` }; }
        if (local.exclu) analyse.verdict = { code: 'EXCLU', texte: 'Écarté par vous' + (local.note ? ' : ' + local.note : '') };
        const gain = !analyse.erreur ? Math.max(0, ...analyse.signaux.map((x) => (x.simulation && x.simulation.gain) || 0)) : 0;
        out.push({ ...local, bien: b, analyse, gain, avisN: mkAvis(eN), avisN1: mkAvis(eN1), sp: surfacePonderee(local.surfaces), _grp: partage ? cleA + '|' + villeN : null, _eN: eN, _eN1: eN1 });
      }
      // Adresses partagées : l'avis ne donne qu'une base pour tous les locaux de l'adresse. On compare donc la somme des valeurs
      // calculées (planchonnée avec l'ancienne valeur locative reconstituée depuis cette ligne) à la base de l'avis, et les gains
      // des signaux se chiffrent sur le groupe.
      const groupes = {};
      for (const l of out) if (l.siren === rec.siren && l._grp) (groupes[l._grp] = groupes[l._grp] || []).push(l);
      for (const G of Object.values(groupes)) {
        const ok = G.filter((l) => l.analyse && l.analyse.calcul && !l.exclu);
        const e = G[0]._eN || G[0]._eN1; if (!e || !ok.length) continue;
        const ref = { annee: e.annee, base: e.base, cotisation: e.cotisation, cotisationLissee: e.cotisationLissee, cotisationTotale: e.total || null, partage: true, avisId: e.avisId, adresse: e.adresse };
        const mk = (x) => ({ annee: x.annee, base: x.base, cotisation: x.cotisation, cotisationLissee: x.cotisationLissee });
        const recon = (G[0]._eN1 && vl70DepuisAvis(mk(G[0]._eN1))) || vl70DepuisAvis(ref) || null, vl70 = recon && recon.planchonnement ? recon.vl70 : null;
        const neutSum = ok.reduce((a, l) => a + l.analyse.calcul.neutralisee, 0);
        const baseDe = (n) => (vl70 ? 0.5 * (n + vl70) : n) / 2;
        const baseG = baseDe(neutSum), ecart = ref.base ? (baseG - ref.base) / ref.base : null, cotRef = ref.cotisationTotale || ref.cotisation;
        for (const l of G) {
          const an = l.analyse; if (!an || !an.calcul) continue;
          an.groupe = { nb: G.length, calcules: ok.length, neutralisee: neutSum, vl70, planchonnee: vl70 ? 0.5 * (neutSum + vl70) : neutSum, base: baseG, ecart, ref, reconstitution: recon, part: neutSum ? an.calcul.neutralisee / neutSum : 0 };
          an.ref = ref; an.ecart = ecart; an.reconstitution = recon;
          for (const sg of an.signaux) if (sg.simulation && sg.simulation.neutralisee !== undefined) {
            const bh = baseDe(neutSum - an.calcul.neutralisee + sg.simulation.neutralisee), cot = cotisationPour(bh, ref.base, cotRef);
            sg.simulation.baseGroupe = bh; sg.simulation.cotisation = cot; sg.simulation.gain = cot !== null && cotRef ? cotRef - cot : null;
          }
          if (l.exclu) continue;
          const v = verdict(ecart, an.signaux, recon, ref);
          if (v.code === 'VERT') v.texte = `Base de l’avis reproduite au tarif pour les ${G.length} locaux de cette adresse (écart ${(ecart * 100).toFixed(1).replace('.', ',')} %) : pas d’erreur de calcul d’ensemble` + (vl70 ? ' ; le planchonnement explique l’écart avec le tarif brut' : '');
          else if (v.code === 'ORANGE' && ecart !== null && Math.abs(ecart) > 0.05 && !an.signaux.some((x) => x.gravite >= 2)) v.texte = `Pour les ${G.length} locaux de cette adresse, la base calculée (${Math.round(baseG).toLocaleString('fr-FR')} €) est ${ecart < 0 ? 'inférieure' : 'supérieure'} de ${Math.abs(ecart * 100).toFixed(0)} % à la base de l’avis (${Math.round(ref.base).toLocaleString('fr-FR')} €)` + (ok.length < G.length ? ` ; ${G.length - ok.length} local${G.length - ok.length > 1 ? 'aux' : ''} non calculé${G.length - ok.length > 1 ? 's' : ''}` : '') + (vl70 ? '' : ' ; sans ligne de lissage sur l’avis, le planchonnement n’a pas pu être reconstitué');
          an.verdict = v;
          l.gain = Math.max(0, ...an.signaux.map((x) => (x.simulation && x.simulation.gain) || 0));
        }
      }
      for (const l of out) { delete l._grp; delete l._eN; delete l._eN1; }
    }
    const ordre = { ROUGE: 0, ORANGE: 1, GRIS: 2, VERT: 3, HORS: 4, EXCLU: 5 };
    out.sort((x, y) => (ordre[(x.analyse.verdict || {}).code] ?? 2) - (ordre[(y.analyse.verdict || {}).code] ?? 2) || y.gain - x.gain || (y.avisN ? y.avisN.base : 0) - (x.avisN ? x.avisN.base : 0));
    void num;
    return out;
  }
  const VERDICTS = { ROUGE: 'Anomalie probable', ORANGE: 'À vérifier', VERT: 'Conforme', GRIS: 'Sans avis rapproché', EXCLU: 'Écarté', HORS: 'Hors champ', ERREUR: 'Non calculé' };
  // ---- Statut lisible par un non-spécialiste (partagé application / outil Claude) ----
  // k : clé du statut ; enjeu : € par an en jeu ; certitude : 'probable' | 'possible' | null
  const STATUTS = {
    TROP: { lib: 'Trop payé probable', court: 'Trop payé', ton: 'bad', ordre: 0, phrase: 'Votre taxe est probablement trop élevée.' },
    PISTE: { lib: 'Trop payé possible', court: 'Écart à creuser', ton: 'warn', ordre: 1, phrase: 'La taxe de l’avis dépasse notre recalcul au tarif officiel : erreur possible en votre faveur, ou élément que nous ne voyons pas.' },
    QUESTION: { lib: 'Question au client', court: 'Question', ton: 'acc', ordre: 2, phrase: 'Un point de la déclaration mérite une question au client avant de conclure.' },
    MANQUE: { lib: 'Avis manquant', court: 'Avis manquant', ton: '', ordre: 3, phrase: 'Recalcul fait au tarif officiel, mais aucun avis de taxe foncière à cette adresse pour comparer.' },
    NONCALC: { lib: 'Non calculé', court: 'Non calculé', ton: '', ordre: 4, phrase: 'Relève n’a pas pu refaire le calcul.' },
    FAVORABLE: { lib: 'Avis plus bas que la grille', court: 'Ne pas réclamer', ton: 'ok', ordre: 5, phrase: 'L’avis est plus bas que le tarif officiel : rien à réclamer, et une révision pourrait même augmenter la taxe.' },
    OK: { lib: 'Rien à signaler', court: 'Rien à signaler', ton: 'ok', ordre: 6, phrase: 'Notre recalcul au tarif officiel retrouve la base de l’avis : pas d’erreur de calcul.' },
    HORS: { lib: 'Hors champ', court: 'Hors champ', ton: '', ordre: 7, phrase: 'Local industriel évalué selon une autre méthode (comptable) : la grille ne s’applique pas.' },
    ECARTE: { lib: 'Écarté', court: 'Écarté', ton: '', ordre: 8, phrase: 'Vous avez écarté ce local du contrôle.' },
  };
  function statut(l) {
    const a = l.analyse || {}, v = a.verdict, sig = a.signaux || [];
    const mk = (k, extra = {}) => ({ k, ...STATUTS[k], enjeu: null, certitude: null, ...extra });
    if (l.exclu) return mk('ECARTE');
    if (!v) return mk('NONCALC', { raison: a.erreur || '' });
    if (v.code === 'HORS') return mk('HORS');
    const cotRef = a.ref ? (a.ref.cotisationTotale || a.ref.cotisation) : null;
    const grave = sig.find((x) => x.gravite >= 2 && !(x.simulation && x.simulation.gain > 100));
    if (v.code === 'ROUGE') { const s0 = sig.filter((x) => x.simulation && x.simulation.gain > 100).sort((x, y) => y.simulation.gain - x.simulation.gain)[0]; return mk('TROP', { enjeu: l.gain, certitude: 'probable', signal: s0 || null }); }
    if (a.ecart !== null && a.ecart !== undefined && a.ecart < -0.05 && cotRef) return mk('PISTE', { enjeu: cotRef * -a.ecart, certitude: 'possible', signal: grave || null });
    if (grave) return mk('QUESTION', { signal: grave });
    if (v.code === 'ORANGE' && a.ecart !== null && a.ecart !== undefined && a.ecart > 0.05) return mk('FAVORABLE');
    if (v.code === 'VERT') return mk('OK');
    if (v.code === 'GRIS') return mk('MANQUE');
    return mk(a.ecart > 0.05 ? 'FAVORABLE' : 'OK');
  }
  // Résumé compact d'un local analysé, écrit dans meta/vlResume : c'est lui que lit la liste de travail (ACA.campagne), sans refaire le calcul
  const k = (n) => Math.round(n || 0).toLocaleString('fr-FR');
  function resume(l) {
    const st = statut(l), a = l.analyse || {}, ref = a.ref, g = a.groupe, calc = a.calcul;
    let phrase = st.phrase;
    if (st.k === 'TROP') { const sim = st.signal && st.signal.simulation; phrase = `${st.signal ? st.signal.titre : 'Base de l’avis supérieure au recalcul'} : environ ${k(st.enjeu)} € de trop par an${ref && sim ? ` (base ${k(ref.base)} € sur l’avis, ${k(sim.baseGroupe || sim.base)} € une fois corrigée)` : ''}.`; }
    else if (st.k === 'PISTE') phrase = `L’avis (base ${k(ref.base)} €) dépasse de ${Math.abs(Math.round(a.ecart * 100))} % le recalcul au tarif officiel (${k(g ? g.base : calc.base)} €)${g ? ` pour les ${g.nb} locaux de l’adresse` : ''} : environ ${k(st.enjeu)} € par an à creuser. Le relevé de propriété dira d’où vient l’écart.`;
    return { siren: l.siren, nom: l.nom, invariant: l.invariant, adresse: l.adresse, ville: l.ville, categorie: l.categorie, statut: st.k, libelle: st.lib, enjeu: st.enjeu ? Math.round(st.enjeu) : 0, certitude: st.certitude, annee: ref ? ref.annee : null, phrase };
  }
  return { STATUTS, statut, resume, CATEGORIES, COURT, nomCat, POND, LIB_SURF, DEPARTEMENTS, VERDICTS, portefeuille, categorieCode, depCode, communeCode, normNom, surfacePonderee, charger, normDep, secteur, coefLoc, tarif, neut, evaluer, vl70DepuisAvis, cotisationPour, signaux, analyser, verdict };
})();
if (typeof self !== 'undefined') self.ACVL = ACVL;
if (typeof module !== 'undefined') module.exports = ACVL;
