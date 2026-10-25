// Relève — textes des messages clients et des réclamations (partagés par l'application et le connecteur Claude)
'use strict';
const ACM = (() => {
  const { eur, eur2, sgn, num, TAXE_LABEL } = ACA;
  const pcv = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(1).replace('.', ',') + ' %';
  const fmtSiren = (s) => String(s || '').replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
  let CTX = { settings: {}, annee: String(new Date().getFullYear()), ca: {} };
  const C = () => CTX;
  const setContext = (c) => { CTX = { ...CTX, ...c }; };
// Contexte « avis » minimal pour les messages sur une créance ou un avis de mise en recouvrement
const IMPOT_LIB = { CFE: 'cotisation foncière des entreprises (CFE)', PAS: 'prélèvement à la source', TVA: 'TVA', IS: 'impôt sur les sociétés', TF: 'taxe foncière', CVAE: 'CVAE' };
const detteCtx = (r) => ({ id: 'det:' + r.siren + r.reference, siren: r.siren, nom: r.nom, taxe: r.impot, label: IMPOT_LIB[r.impot] || r.impot, labelCourt: r.impot, annee: r.annee, commune: r.commune, montant: r.solde, dateLimite: r.dateLimite, reference: r.reference, hasPdf: false });
const amrCtx = (r) => ({ id: 'amr:' + r.siren + r.amr, siren: r.siren, nom: r.nom, taxe: 'AMR', label: 'avis de mise en recouvrement', labelCourt: 'AMR', annee: '', montant: r.montant, amr: r.amr, hasPdf: false });
// Une action « message » → élément de message { kind, a, task }
function mailItem(t) {
  if (!t || !t.action || !t.action.startsWith('mail')) return null;
  if (t.action === 'mail-dette') return t.dette ? { kind: 'dette', a: detteCtx(t.dette), task: t } : null;
  if (t.action === 'mail-amr') return t.amr ? { kind: 'amr', a: amrCtx(t.amr), task: t } : null;
  if (t.action === 'mail-prelevement') return { kind: 'prelevement', a: { ...t.avis, avisList: t.avisList }, task: t };
  return t.avis ? { kind: t.action.slice(5), a: t.avis, task: t } : null;
}

const LIBC = { Commune: 'la commune', 'Syndicat de communes': 'le syndicat de communes', 'Intercommunalité': 'l’intercommunalité', 'Taxes spéciales': 'les taxes spéciales', "Taxe d'ordures ménagères": 'la taxe d’ordures ménagères', 'Taxe GEMAPI': 'la taxe GEMAPI', 'Taxe additionnelle': 'la taxe additionnelle', "Chambre d'agriculture": 'la chambre d’agriculture' };
const libColl = (nom) => { const nb = / \(non bâti\)$/.test(nom), b = nom.replace(/ \(non bâti\)$/, ''); return (LIBC[b] || b.toLowerCase()) + (nb ? ' (terrains non bâtis)' : ''); };
const listeEt = (arr) => arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' et ' + arr[arr.length - 1];
function mailDraft(kind, a, detaille) {
  const S = C().settings, info = (S.correspondance || {})[a.siren] || {};
  const tx = a.label || (a.taxe === 'TF' ? 'taxe foncière' : 'cotisation foncière des entreprises (CFE)');
  const txc = a.labelCourt || (a.taxe === 'TF' ? 'Taxe foncière' : 'CFE');
  const lieu = a.commune ? ` (${a.commune})` : '';
  const mt = eur2(num(a.montant) || a.m);
  const sig = S.signature ? '\n' + S.signature : '';
  if (kind === 'auto') kind = a.hausse ? 'explication' : a.prel === 'NON' ? (a.delai === 'passée' ? 'verif' : 'rappel') : 'info';
  const pay = a.prel === 'OUI' ? `Le montant sera prélevé automatiquement sur votre compte à l’échéance : vous n’avez rien à faire.`
    : a.prel === 'MENSUEL' ? 'Vous êtes mensualisé : les prélèvements se poursuivent, le solde éventuel est ajusté sur les dernières mensualités.'
    : a.dateLimite ? `Ce montant n’est pas prélevé automatiquement : il est à régler avant le ${a.dateLimite} depuis votre espace professionnel sur impots.gouv.fr.` : '';
  let subject, body;
  if (kind === 'rappel') {
    subject = `${txc} ${a.annee} : paiement à effectuer avant le ${a.dateLimite}`;
    body = `Bonjour,\n\nVotre avis de ${tx} ${a.annee}${lieu} est disponible ; vous le trouverez en pièce jointe.\n\nMontant à payer : ${mt}, avant le ${a.dateLimite}.\n\nCet avis n’est pas prélevé automatiquement. Vous pouvez le régler en ligne depuis votre espace professionnel sur impots.gouv.fr (rubrique « Payer »), ou adhérer au prélèvement à l’échéance pour les prochaines années.\n\nN’hésitez pas à revenir vers nous pour toute question.\n\nBien cordialement,${sig}`;
  } else if (kind === 'verif') {
    subject = `${txc} ${a.annee} : confirmation de paiement`;
    body = `Bonjour,\n\nL’avis de ${tx} ${a.annee}${lieu} d’un montant de ${mt} devait être réglé avant le ${a.dateLimite}. Il n’est pas prélevé automatiquement.\n\nPouvez-vous nous confirmer que le paiement a bien été effectué ? À défaut, une majoration de 10 % s’applique ; le règlement reste possible depuis votre espace professionnel sur impots.gouv.fr.\n\nVous trouverez l’avis en pièce jointe.\n\nBien cordialement,${sig}`;
  } else if (kind === 'dette') {
    subject = `${txc} ${a.annee} : montant restant dû`;
    body = `Bonjour,\n\nUn montant de ${mt} au titre de : ${tx} ${a.annee}${a.reference ? ` (${a.reference})` : ''} apparaît toujours comme non réglé dans votre situation fiscale, alors que la date limite (${a.dateLimite}) est passée. Une majoration peut s’appliquer.\n\nPouvez-vous vérifier ce paiement et nous tenir informés ?\n\nBien cordialement,${sig}`;
  } else if (kind === 'amr') {
    subject = `Avis de mise en recouvrement n° ${a.amr} : ${mt} à payer`;
    body = `Bonjour,\n\nUn avis de mise en recouvrement (n° ${a.amr}) d’un montant de ${mt} est à payer dans votre espace professionnel sur impots.gouv.fr (rubrique « Payer › Dette fiscale »). Il s’agit en général d’une pénalité, d’une majoration ou d’un rappel d’impôt.\n\nAvez-vous reçu ce document ? Pouvez-vous nous en transmettre une copie ou nous confirmer son règlement ? Nous vérifierons avec vous s’il est fondé et, le cas échéant, si une demande de remise est envisageable.\n\nBien cordialement,${sig}`;
  } else if (kind === 'explication' && a.n1) {
    const d = a.d;
    subject = `Votre ${tx} ${a.annee}${lieu}`;
    const lines = [`Bonjour,\n\nVotre avis de ${tx} ${a.annee}${lieu} est disponible (en pièce jointe) : ${eur(d.mN)} contre ${eur(d.mN1)} en ${a.n1.annee}, soit ${sgn(d.delta)} (${pcv(d.pct)}).`];
    if (a.taxe === 'TF' && d.lignes.length) {
      const ch = d.lignes.filter((l) => l.tN1 && l.tN !== l.tN1 && Math.abs(l.effTaux) >= 1).sort((x, y) => y.effTaux - x.effTaux);
      if (d.taux > 0.5 && ch.length) lines.push(`${d.taux >= 0.6 * d.delta ? 'L’essentiel de cette hausse vient' : 'Une partie de cette hausse vient'} des taux votés cette année (${ch.map((l) => `${libColl(l.nom)} : ${l.tN1} % → ${l.tN} %`).join(' ; ')}), soit ${sgn(d.taux)}. Ces décisions s’appliquent à tous les contribuables de la commune et ne peuvent pas être contestées.`);
      if (d.verdictType === 'warn') lines.push(`Les bases d’imposition (valeur locative) augmentent également de ${d.basesPct.toFixed(1).replace('.', ',')} %, plus que la revalorisation annuelle. Nous allons vérifier ce point et reviendrons vers vous si une réclamation est possible.`);
      else if (d.bases > 0.5) lines.push(`Le reste (${sgn(d.bases)}) correspond à la revalorisation annuelle des bases, fixée par la loi.`);
      if (d.nouveaux > 0.5) lines.push(`${sgn(d.nouveaux)} concernent des biens imposés pour la première fois cette année (construction, acquisition ou fin d’exonération) : pouvez-vous nous le confirmer ?`);
    } else if (d.verdict) lines.push(d.verdict);
    if (detaille && a.taxe === 'TF' && d.lignes.length) lines.push(`Détail par collectivité (cotisation ${a.n1.annee} → ${a.annee}) :\n` + d.lignes.map((l) => `- ${l.nom} : ${eur(l.cN1)} → ${eur(l.cN)}${l.tN1 ? ` (taux ${l.tN1} % → ${l.tN} %)` : l.neuf ? ' (nouveau)' : ''}`).join('\n'));
    if (pay) lines.push(pay);
    body = lines.join('\n\n') + `\n\nBien cordialement,${sig}`;
  } else {
    subject = `Votre avis de ${tx} ${a.annee}${lieu}`;
    body = `Bonjour,\n\nVotre avis de ${tx} ${a.annee}${lieu} est disponible ; vous le trouverez en pièce jointe.\n\nMontant : ${mt}${a.dateLimite ? `, date limite de paiement le ${a.dateLimite}` : ''}.\n\n${pay}\n\nBien cordialement,${sig}`;
  }
  return { to: info.email || a.email || '', subject, body, avis: a };
}

// Paragraphe d'un point dans un message regroupé
function sectionText(kind, a, detaille) {
  const tx = a.label || (a.taxe === 'TF' ? 'taxe foncière' : 'cotisation foncière des entreprises (CFE)');
  const Tx = tx.charAt(0).toUpperCase() + tx.slice(1);
  const lieu = a.commune ? ` (${a.commune})` : '';
  const mt = eur2(num(a.montant) || a.m);
  if (kind === 'rappel') return `${Tx} ${a.annee}${lieu} : ${mt} à payer avant le ${a.dateLimite}. Cet avis n’est pas prélevé automatiquement : vous pouvez le régler en ligne depuis votre espace professionnel sur impots.gouv.fr (rubrique « Payer »).`;
  if (kind === 'verif') return `${Tx} ${a.annee}${lieu} : ${mt} à régler avant le ${a.dateLimite}, sans prélèvement automatique. Pouvez-vous nous confirmer que le paiement a été effectué ? À défaut, une majoration de 10 % s’applique.`;
  if (kind === 'dette') return `${Tx} ${a.annee}${a.reference ? ` (${a.reference})` : ''} : ${mt} restent dus depuis le ${a.dateLimite}. Pouvez-vous vérifier ce paiement ?`;
  if (kind === 'amr') return `Avis de mise en recouvrement n° ${a.amr} : ${mt} à payer (rubrique « Payer › Dette fiscale »). Il s’agit en général d’une pénalité, d’une majoration ou d’un rappel. Pouvez-vous nous en transmettre une copie ou nous confirmer son règlement ?`;
  if (kind === 'prelevement') return prelevementText(a);
  if ((kind === 'explication' || kind === 'auto') && a.n1) {
    const d = a.d, out = [`${Tx} ${a.annee}${lieu} : ${eur(d.mN)} contre ${eur(d.mN1)} en ${a.n1.annee} (${sgn(d.delta)}, ${pcv(d.pct)}).`];
    if (a.taxe === 'TF' && d.lignes.length) {
      const ch = d.lignes.filter((l) => l.tN1 && l.tN !== l.tN1 && Math.abs(l.effTaux) >= 1).sort((x, y) => y.effTaux - x.effTaux);
      if (d.taux > 0.5 && ch.length) out.push(`${d.taux >= 0.6 * d.delta ? 'L’essentiel' : 'Une partie'} vient des taux votés (${ch.map((l) => `${libColl(l.nom)} : ${l.tN1} % → ${l.tN} %`).join(' ; ')}), soit ${sgn(d.taux)}, qui ne peuvent pas être contestés.`);
      if (d.verdictType === 'warn') out.push(`Les bases augmentent aussi de ${d.basesPct.toFixed(1).replace('.', ',')} %, plus que la revalorisation annuelle : nous vérifions ce point.`);
      if (d.nouveaux > 0.5) out.push(`${sgn(d.nouveaux)} concernent des biens imposés pour la première fois : pouvez-vous nous le confirmer ?`);
      if (detaille) out.push('\n' + d.lignes.map((l) => `   - ${l.nom} : ${eur(l.cN1)} → ${eur(l.cN)}${l.tN1 ? ` (taux ${l.tN1} % → ${l.tN} %)` : l.neuf ? ' (nouveau)' : ''}`).join('\n'));
    } else if (d.verdict) out.push(d.verdict);
    out.push(a.prel === 'OUI' ? 'Prélèvement automatique à l’échéance.' : a.prel === 'MENSUEL' ? 'Vous êtes mensualisé.' : a.dateLimite ? `À régler avant le ${a.dateLimite}.` : '');
    return out.filter(Boolean).join(' ');
  }
  return `${Tx} ${a.annee}${lieu} : ${mt}${a.dateLimite ? `, à régler avant le ${a.dateLimite}` : ''}.`;
}
function prelevementText(a) {
  const l = a.avisList || [a];
  const quoi = listeEt([...new Set(l.map((x) => (x.taxe === 'TF' ? 'taxe foncière' : 'CFE') + (x.commune ? ` (${x.commune})` : '')))]);
  return `Prélèvement automatique : vos avis de ${quoi} ne sont ni prélevés ni mensualisés depuis deux ans, ce qui vous oblige à payer vous-même à chaque échéance. En adhérant au prélèvement à l’échéance (ou au prélèvement mensuel), vous n’aurez plus à y penser et éviterez tout risque de majoration. L’adhésion se fait en quelques minutes dans votre espace professionnel, rubrique « Gérer mon espace › Contrats de prélèvement automatique ». Nous pouvons vous accompagner si besoin.`;
}
// Message pour un client à partir d'un ou plusieurs points
function mailForItems(items, detaille) {
  const a0 = items[0].a, S = C().settings, info = (S.correspondance || {})[a0.siren] || {}, sig = S.signature ? '\n' + S.signature : '';
  const attach = items.map((x) => x.a).filter((a) => a && a.hasPdf);
  if (items.length === 1) {
    const it = items[0];
    if (it.kind === 'prelevement') return { to: info.email || a0.email || '', subject: 'Prélèvement automatique de vos impôts locaux', body: `Bonjour,\n\n${prelevementText(it.a)}\n\nBien cordialement,${sig}`, attach: [], avis: a0 };
    return { ...mailDraft(it.kind, it.a, detaille), attach };
  }
  const q = items.some((x) => ['verif', 'dette', 'amr'].includes(x.kind) || (x.a.d && x.a.d.nouveaux > 0.5));
  const body = `Bonjour,\n\nVoici le point sur vos impôts${items.every((x) => ['TF', 'CFE'].includes(x.a.taxe)) ? ' locaux' : ''} :\n\n`
    + items.map((x, i) => `${i + 1}. ${sectionText(x.kind, x.a, detaille)}`).join('\n\n')
    + `${attach.length ? `\n\nVous trouverez ${attach.length > 1 ? 'les avis' : 'l’avis'} en pièce jointe.` : ''}${q ? '\n\nMerci de nous apporter les confirmations demandées.' : ''}\n\nBien cordialement,${sig}`;
  return { to: info.email || a0.email || '', subject: `Vos impôts ${C().annee} : ${items.length} points à voir`, body, attach, avis: a0 };
}
const KIND_LIB = { rappel: 'à payer avant l’échéance', verif: 'confirmation de paiement', dette: 'solde restant dû', amr: 'avis de mise en recouvrement', prelevement: 'proposition de prélèvement', explication: 'explication de la hausse', auto: 'information', info: 'information' };
const itemLib = (x) => x.kind === 'amr' ? `AMR n° ${x.a.amr} · ${KIND_LIB.amr}` : x.kind === 'prelevement' ? KIND_LIB.prelevement : `${x.a.labelCourt || TAXE_LABEL[x.a.taxe] || x.a.taxe} ${x.a.annee || ''}${x.a.commune ? ' · ' + x.a.commune : ''} · ${KIND_LIB[x.kind] || ''}`;

// Brouillon de réclamation (à déposer par la messagerie sécurisée ou par courrier ; rien n'est déposé par l'outil)
function reclamationText(t) {
  const a = t.avis, S = C().settings, sig = S.signature ? '\n\n' + S.signature : '';
  const ref = a.reference ? `, avis réf. ${a.reference}` : '';
  const intro = `Madame, Monsieur,\n\nNous intervenons en qualité d’expert-comptable de la société ${a.nom} (SIREN ${fmtSiren(a.siren)}).`;
  const fin = `Cette réclamation est présentée dans le délai prévu à l’article R*196-2 du livre des procédures fiscales.\n\nNous vous prions d’agréer, Madame, Monsieur, l’expression de nos salutations distinguées.${sig}`;
  let objet, corps;
  if (a.taxe === 'TF') {
    const d = a.d;
    objet = `Réclamation – taxe foncière ${a.annee} – ${a.commune || ''} – ${a.role || ''}${ref}`;
    corps = `L’avis de taxe foncière ${a.annee} relatif aux propriétés situées sur la commune de ${a.commune || '[commune]'} (${a.role || ''}${ref}) fait apparaître une cotisation de ${eur2(d.mN)} contre ${eur2(d.mN1)} en ${a.n1 ? a.n1.annee : Number(a.annee) - 1}.\n\nÀ taux d’imposition constants, la base imposable progresse de ${d.basesPct !== null ? d.basesPct.toFixed(1).replace('.', ',') : '[x]'} %, au-delà de la seule revalorisation annuelle des valeurs locatives. À notre connaissance, aucune modification des locaux (construction, agrandissement, changement d’affectation) n’est intervenue. [À vérifier et compléter avant envoi.]\n\nNous vous remercions de bien vouloir nous communiquer le détail de la valeur locative retenue pour ${a.annee} et, si cette hausse ne trouve pas de justification, de prononcer le dégrèvement correspondant.`;
  } else {
    const c = a.cfe || {}, x = t.ctrl || {};
    objet = `Réclamation – cotisation foncière des entreprises ${a.annee} – ${a.commune || ''}${ref}`;
    const exo = c.exo ? `l’exercice clos le ${c.exo.cloture}${num(c.exo.duree) && num(c.exo.duree) !== 12 ? ` (${c.exo.duree} mois, montant ramené à douze mois)` : ''}` : 'la période de référence';
    if (x.type === 'cre') corps = `La société a été créée le ${(C().ca[a.siren] || {}).creation || '[date]'}. En application de l’article 1478 II du code général des impôts, la cotisation foncière des entreprises n’est due qu’à partir de l’année suivant celle de la création.\n\nOr un avis de CFE ${a.annee} (${a.commune || ''}${ref}) a été émis pour un montant de ${eur2(a.m)}. Nous vous demandons de bien vouloir prononcer le dégrèvement total de cette imposition.`;
    else if (c.caRef !== null && c.caRef <= 5000) corps = `Au cours de la période de référence (${exo}), la société a réalisé un chiffre d’affaires hors taxes de ${eur(c.caRef)}.\n\nEn application de l’article 1647 D du code général des impôts, les redevables dont le chiffre d’affaires ou les recettes n’excèdent pas 5 000 € sont exonérés de la cotisation minimum. Or l’avis de CFE ${a.annee} (${a.commune || ''}${ref}) retient une base minimum de ${eur(c.bmM)}.\n\nNous vous demandons de bien vouloir prononcer le dégrèvement de la cotisation correspondante.`;
    else corps = `Au cours de la période de référence (${exo}), la société a réalisé un chiffre d’affaires hors taxes de ${eur(c.caRef || 0)}, qui relève de la tranche « ${(c.tranche || '').replace(/^CA/, 'chiffre d’affaires')} » de l’article 1647 D du code général des impôts. Pour cette tranche, la base minimum ne peut excéder ${eur(c.plafond || 0)} au titre de ${a.annee}.\n\nOr l’avis de CFE ${a.annee} (${a.commune || ''}${ref}) retient une base minimum de ${eur(c.bmM)}, qui correspond à une tranche supérieure. Nous vous demandons de bien vouloir rectifier la base minimum en fonction du chiffre d’affaires réalisé et de prononcer le dégrèvement correspondant.`;
  }
  return { objet, texte: `Objet : ${objet}\n\n${intro}\n\n${corps}\n\n${fin}` };
}
  // Demande d'accès au client qui a son propre espace professionnel (désignation du cabinet comme administrateur suppléant)
function raccordementTexte({ nom, abonne, signature }) {
  const objet = 'Votre espace professionnel impots.gouv : accès pour le cabinet';
  const texte = `Bonjour,

Pour suivre vos impôts professionnels (taxe foncière, CFE, échéances et éventuelles relances du service des impôts) directement depuis notre espace professionnel, nous avons besoin que vous donniez accès au cabinet à votre espace impots.gouv${nom ? ` pour ${nom}` : ''}. La démarche prend deux minutes, une seule fois, et vous gardez la main : vous pouvez retirer cet accès à tout moment.

1. Connectez-vous à votre espace professionnel sur impots.gouv.fr.
2. Cliquez sur « Gérer mon espace », puis, dans la rubrique « Partage des services », sur « Gérer mes administrateurs suppléants ».
3. Choisissez « Désigner un administrateur suppléant » et saisissez notre numéro d'abonné : ${abonne || '[numéro d’abonné du cabinet]'}.
4. Cochez les services proposés (au minimum « Consulter le compte fiscal »), puis confirmez.

L'accès est immédiat : aucun code ne vous sera envoyé par courrier.

Si un autre cabinet est déjà désigné comme administrateur suppléant, il faut d'abord le retirer sur le même écran (un seul suppléant est possible par service). Vous pouvez aussi passer par « Gérer mes délégations » si vous préférez.

N'hésitez pas à nous appeler si vous avez la moindre question.

${signature || 'Bien cordialement,'}`;
  return { objet, texte };
}

return { raccordementTexte, setContext, IMPOT_LIB, detteCtx, amrCtx, mailItem, libColl, listeEt, mailDraft, sectionText, prelevementText, mailForItems, KIND_LIB, itemLib, reclamationText };
})();
if (typeof self !== 'undefined') self.ACM = ACM;
