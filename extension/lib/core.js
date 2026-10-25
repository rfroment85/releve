// Relève — moteur de lecture de l'espace professionnel (script de contenu, s'exécute dans l'onglet impots.gouv)
// Ne fait que rejouer les requêtes de consultation du site, dans la session ouverte par l'utilisateur. Aucune action sur le site.
'use strict';
const BASE = 'https://cfspro.impots.gouv.fr';
const AVIS_URL = BASE + '/adelie2mapi/xhtml/impots/cfe/avis_cfe.xhtml';
const TF_URL = BASE + '/adelie2mapi/xhtml/impots/tf/avisTaxeFonciere.xhtml';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parseHTML = (h) => new DOMParser().parseFromString(h, 'text/html');
const clean = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().replace(/\s+/g, '_').slice(0, 60);
const isAcompte = (row) => /acompte/i.test(row.role + ' ' + row.type);
// ======================================================================
// 1. Accès au site (mêmes requêtes que les clics d'un utilisateur)
// ======================================================================
// Session expirée : le site redirige vers la page de connexion (autre domaine), ce que fetch signale par « Failed to fetch »
async function safeFetch(url, opts = {}) {
  try { return await fetch(url, { credentials: 'include', ...opts }); }
  catch (e) {
    let redirige = false;
    try { const p = await fetch(BASE + '/mire/accueil.do', { credentials: 'include', redirect: 'manual' }); redirige = p.type === 'opaqueredirect'; } catch {}
    throw new Error(redirige ? 'Session expirée : reconnectez-vous à l’espace professionnel' : 'Réseau indisponible (' + e.message + ')');
  }
}
async function fetchText(url, opts = {}) {
  const r = await safeFetch(url, opts);
  if (r.status === 401 || r.status === 403) throw new Error('Session expirée (HTTP ' + r.status + ')');
  const t = await r.text();
  if (/cfspro-idp\.impots\.gouv\.fr|Authentification des professionnels/.test(t) && /Mot de passe/.test(t)) {
    throw new Error('Session expirée : reconnectez-vous à l’espace professionnel');
  }
  return t;
}

// Jeton anti-CSRF : injecté dans les liens par le JS de la page « Mes services » : injectTokens("token", "XXXX-....", [...])
async function getToken() {
  const h = await fetchText(BASE + '/mire/accueil.do');
  if (!/idth=consulter\.avis\.cfe/.test(h)) throw new Error('Service « Avis CFE » introuvable dans le menu (droits insuffisants ?)');
  const m = h.match(/injectTokens\(\s*"token"\s*,\s*"([\w-]+)"/) || h.match(/[?&](?:amp;)?token=([\w-]{8,})/);
  if (!m) throw new Error('Jeton de session introuvable sur la page « Mes services »');
  return m[1];
}

// Liste de tous les dossiers rattachés au service Avis CFE (pagination 10 par page)
async function listDossiers(token, onProgress, idth = 'consulter.avis.cfe') {
  const first = await fetchText(`${BASE}/mire/afficherSelectionDossier.do?idth=${encodeURIComponent(idth)}&p=1&token=${token}`);
  const mPages = first.replace(/&nbsp;|\u00a0/g, ' ').match(/Page\s+1\s+sur\s+(\d+)/);
  const nPages = mPages ? parseInt(mPages[1], 10) : 1;
  const nTotal = parseInt((first.match(/(\d+)<\/span>\s*(?:&nbsp;|\s)*résultat/) || [])[1] || '0', 10);
  const extract = (h) => [...parseHTML(h).querySelectorAll('a[href*="dossierSelect.do"]')]
    .map((a) => ({ siren: (a.getAttribute('href').match(/idDossier=(\w+)/) || [])[1], nom: a.textContent.trim() }))
    .filter((d) => d.siren);
  const all = extract(first);
  // Pages lues 4 par 4 (la liste ne dépend pas du dossier sélectionné)
  for (let p = 2; p <= nPages; p += 4) {
    const lot = [];
    for (let q = p; q < p + 4 && q <= nPages; q++) lot.push(fetchText(`${BASE}/mire/afficherSelectionDossier.do?idth=${encodeURIComponent(idth)}&p=${q}&token=${token}`));
    for (const h of await Promise.all(lot)) all.push(...extract(h));
    onProgress?.(Math.min(p + 3, nPages), nPages);
  }
  const seen = new Set();
  const list = all.filter((d) => !seen.has(d.siren) && seen.add(d.siren));
  if (nTotal && list.length < nTotal) onProgress?.(nPages, nPages, `attention : ${list.length} dossiers lus sur ${nTotal} annoncés`);
  return list;
}

async function selectDossier(token, siren) {
  const r = await safeFetch(`${BASE}/mire/dossierSelect.do?idth=consulter.avis.cfe&idDossier=${siren}&token=${token}`);
  if (/erreurCsrf/.test(r.url) || r.status >= 500) throw new Error('CSRF : jeton de session refusé (HTTP ' + r.status + ')');
  const t = await r.text();
  if (/Authentification des professionnels/.test(t) && /Mot de passe/.test(t)) throw new Error('Session expirée : reconnectez-vous à l’espace professionnel');
}

// ----------------------------------------------------------------------
// Impôts pris en charge : page, tableau, colonnes, nommage, lecture du PDF
// ----------------------------------------------------------------------
const TAXES = {
  CFE: {
    key: 'CFE', label: 'CFE', prefix: 'CFE', url: AVIS_URL, tableId: 'form:tableauAvisImposition', acomptes: true,
    // Colonnes : année recouvrement, année imposition, dépt, commune, NIC, type, référence, lien (rôle), mise en recouvrement, date limite, montant dû, payer
    parseRow: (td, links) => ({ anneeRecouvrement: td[0], anneeImposition: td[1], departement: td[2], commune: td[3], nic: td[4], type: td[5], reference: td[6], role: td[7], dateRecouvrement: td[8], dateLimite: td[9], montant: td[10], payer: td[11] || '', linkId: links[0], linkSuite: null }),
    etab: (row) => row.nic, // clé de rapprochement N / N-1
    suffix: (row) => `${clean(row.commune)}_${row.nic}`,
  },
  TF: {
    key: 'TF', label: 'Taxe foncière', prefix: 'TF', url: TF_URL, tableId: 'form:tableauAvisTaxeFonciere', acomptes: false,
    // Colonnes : type avis, année, dépt, commune, référence, n° rôle, date limite, montant, avis principal (lien), avis suite (lien), paiement
    parseRow: (td, links, linkCols) => ({ anneeRecouvrement: td[1], anneeImposition: td[1], departement: td[2], commune: td[3], nic: '', type: td[0], reference: td[4], role: 'Rôle n°' + td[5], dateRecouvrement: '', dateLimite: td[6], montant: td[7], payer: td[10] || '', linkId: links[0], linkSuite: linkCols.includes(9) ? links[linkCols.indexOf(9)] : null }),
    etab: (row) => row.departement + ' ' + row.commune + ' ' + row.role,
    suffix: (row) => `${clean(row.commune)}_${row.role.replace(/\D/g, '')}`,
  },
};

// Lignes du tableau des avis -> objets (selon l'impôt)
function parseRows(container, taxe) {
  return [...container.querySelectorAll('tr')].map((tr) => {
    const tds = [...tr.querySelectorAll('td')];
    const td = tds.map((x) => x.textContent.trim().replace(/\s+/g, ' '));
    const links = [], linkCols = [];
    tds.forEach((x, i) => { const a = x.querySelector(`a[id*="${taxe.tableId.split(':').pop()}"]`); if (a) { links.push(a.id); linkCols.push(i); } });
    if (td.length < 11 || !links.length) return null;
    return taxe.parseRow(td, links, linkCols);
  }).filter(Boolean);
}

// Page des avis du dossier courant : lignes + ViewState (gère >15 avis via la pagination ajax)
async function getAvis(taxe) {
  const h = await fetchText(taxe.url);
  const doc = parseHTML(h);
  const siren = (doc.body.textContent.match(/SIREN ou IDSP\s*:?\s*(\w{9})/) || [])[1];
  let vs = doc.querySelector('input[name="javax.faces.ViewState"]')?.value;
  if (h.includes('Aucune information')) return { rows: [], vs, siren, curFirst: 0 };
  let rows = parseRows(doc.querySelector('tbody') || doc, taxe).map((r) => ({ ...r, first: 0 }));
  // Nombre total d'avis : dans la config du widget PrimeFaces (…paginator:{rows:15,rowCount:52,…})
  const total = parseInt((h.match(/rowCount:(\d+)/) || [])[1] || '0', 10);
  let curFirst = 0; // page (offset) affichée côté serveur : un lien n'est cliquable que si sa ligne y figure
  if (rows.length >= 15 && (total > rows.length || !total)) {
    rows = [];
    let first = 0;
    for (;;) {
      const r = await ajaxPage(first, vs, taxe);
      vs = r.vs; curFirst = first;
      rows.push(...r.rows.map((x) => ({ ...x, first })));
      if (r.rows.length === 0 || (total && rows.length >= total) || (!total && r.rows.length < 50)) break;
      first += 50;
    }
  }
  return { rows, vs, siren, curFirst };
}

// Pagination ajax PrimeFaces du tableau (50 lignes à partir de `first`) ; renvoie les lignes et le nouveau ViewState
async function ajaxPage(first, vs, taxe) {
  const T = taxe.tableId;
  const p = new URLSearchParams({
    'javax.faces.partial.ajax': 'true', 'javax.faces.source': T,
    'javax.faces.partial.execute': T, 'javax.faces.partial.render': T,
    [T]: T, [T + '_pagination']: 'true',
    [T + '_first']: String(first), [T + '_rows']: '50',
    [T + '_skipChildren']: 'true', [T + '_encodeFeature']: 'true',
    form: 'form', 'javax.faces.ViewState': vs,
  });
  const x = await fetchText(taxe.url, {
    method: 'POST', body: p.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Faces-Request': 'partial/ajax', 'X-Requested-With': 'XMLHttpRequest' },
  });
  const xml = new DOMParser().parseFromString(x, 'text/xml');
  const upd = [...xml.querySelectorAll('update')];
  const tbl = upd.find((u) => u.getAttribute('id') === T)?.textContent || '';
  const newVs = upd.find((u) => /ViewState/.test(u.getAttribute('id')))?.textContent || vs;
  const tmp = document.createElement('table'); tmp.innerHTML = '<tbody>' + tbl + '</tbody>';
  return { rows: parseRows(tmp, taxe), vs: newVs };
}

async function downloadPdf(linkId, vs, url = AVIS_URL) {
  const p = new URLSearchParams({ form: 'form', 'javax.faces.ViewState': vs, [linkId]: linkId });
  const r = await safeFetch(url, { method: 'POST', body: p.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('pdf')) throw new Error('Réponse non PDF (' + ct.split(';')[0] + ')');
  return new Uint8Array(await r.arrayBuffer());
}

// Synthèse des dettes fiscales du dossier courant (créances non soldées : CFE, TF, impôts d'État…)
const DETTES_URL = BASE + '/adelie2mapi/xhtml/syntheses/voir_situationdettefiscale.xhtml?emetteur=ADELIE_2';
async function getDettes() {
  const h = await fetchText(DETTES_URL);
  const doc = parseHTML(h);
  const total = (doc.body.textContent.replace(/\s+/g, ' ').match(/Situation de la dette fiscale à la date du \d{2}\/\d{2}\/\d{4}\s*([\d\s]*\d,\d{2})/) || [])[1] || '';
  if (h.includes('Aucune information')) return { rows: [], total };
  const rows = [...doc.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((x) => x.textContent.trim().replace(/\s+/g, ' ')))
    .filter((td) => td.length >= 14).map((td) => ({ annee: td[0], impot: td[1], departement: td[2], commune: td[3], nic: td[4], role: td[5], reference: td[6], nature: td[7], dateLimite: td[8], montantDu: td[9], paiementNature: td[10], paiementDate: td[11], paiementMontant: td[12], solde: td[13] }));
  return { rows, total };
}

// Avis de mise en recouvrement à payer (rubrique « Payer › Dette fiscale ») : pénalités, rappels… absents de la synthèse des dettes.
// Lecture seule : on n'affiche que la page d'accueil du service (liste des documents à payer), jamais une étape de paiement.
async function getAmr(token, siren) {
  for (let essai = 0; essai < 2; essai++) {
    const r = await safeFetch(`${BASE}/mire/redirection.do?idth=payer.satelit.dette&token=${token}`);
    if (/erreurCsrf/.test(r.url) || r.status >= 500) { token = await getToken(); continue; }
    const h1 = await r.text();
    const route = (h1.match(/location\.replace\s*\(\s*["']([^"']*routageamr[^"']*)["']/) || [])[1];
    if (!route) throw new Error('service « Payer › Dette fiscale » indisponible');
    const doc2 = parseHTML(await fetchText(BASE + route));
    const f = doc2.querySelector('form[name="formAccueilMenuAMR"]');
    if (!f) {
      // Service de paiement fermé pour ce dossier (ex. aucun compte bancaire connu) : pas de liste consultable
      const msg = (doc2.body.textContent.replace(/\s+/g, ' ').match(/Vous ne pouvez pas effectuer de paiement\.?\s*([^.(]{0,120})/) || [])[1];
      if (msg !== undefined) return { rows: [], nb: 0, token, indispo: msg.trim() || 'paiement en ligne indisponible' };
      throw new Error('page d’accueil du paiement introuvable');
    }
    const body = new URLSearchParams([...f.querySelectorAll('input[name]')].map((i) => [i.name, i.value]));
    if (body.get('pagedemande') !== 'paiementamr0') throw new Error('page inattendue (' + body.get('pagedemande') + ')');
    if (siren && body.get('SIREN') && body.get('SIREN') !== siren) throw new Error('dossier courant inattendu (' + body.get('SIREN') + ')');
    const h3 = await fetchText(BASE + '/stl/satelit.web?', { method: 'POST', body: body.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const doc3 = parseHTML(h3);
    const txt = doc3.body.textContent.replace(/\s+/g, ' ');
    const rows = [...doc3.querySelectorAll('#listeFacturesAMRNonSoldees li')].map((li) => {
      const sp = [...li.querySelectorAll('span')].map((x) => x.textContent.replace(/\s+/g, ' ').trim());
      const m = (li.querySelector('a')?.getAttribute('onclick') || '').match(/allerVersLePaiement\(\s*'(\d+)'\s*,\s*'(\w*)'\s*,\s*'(\d*)'\s*,\s*'(\d*)'/);
      return { amr: m ? m[1] : ((sp.find((x) => /AMR/.test(x)) || '').match(/\d{6,}/) || [''])[0], siret: (sp.find((x) => /SIRET/.test(x)) || '').replace(/\D/g, ''), montant: numVal((sp.find((x) => /€/.test(x)) || '').replace(/[^\d,]/g, '')) };
    }).filter((x) => x.amr || x.montant);
    const nb = parseInt((txt.match(/Vous avez actuellement (\d+) document/) || [])[1] || String(rows.length), 10);
    return { rows, nb, token };
  }
  throw new Error('jeton de session refusé');
}

// ======================================================================
// 2. Lecture du PDF (sans bibliothèque : flux FlateDecode décompressés nativement, texte des opérateurs Tj/TJ)
// ======================================================================
async function inflate(u8) {
  try { const ds = new DecompressionStream('deflate'); const w = ds.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); } catch { return null; }
}
// Largeurs Helvetica (AFM, millièmes d'em) : servent à détecter les espaces entre lettres positionnées une à une
const HW = { ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 222, '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 222, a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500, '{': 334, '|': 260, '}': 334, '~': 584, '°': 400, '€': 556, '«': 556, '»': 556 };
const glyphW = (ch) => { if (/\d/.test(ch)) return 556; const b = ch.normalize('NFD')[0]; return HW[b] ?? 556; };
const textW = (t, size) => [...t].reduce((a, c) => a + glyphW(c), 0) * size / 1000;
const decPdf = (t) => t.replace(/\\([()\\])/g, '$1').replace(/\\(\d{3})/g, (a, b) => String.fromCharCode(parseInt(b, 8))).replace(/\\[nrt]/g, ' ');
// Reconstitue le texte d'un flux de contenu : lettres positionnées une à une (Td) recollées, espace inséré quand l'écart dépasse l'avance du glyphe
function layoutText(content) {
  let size = 10, x = 0, out = '';
  const re = /\/[\w.-]+\s+(-?[\d.]+)\s+Tf|(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]|T\*|BT|ET|(?:-?[\d.]+\s+){6}Tm|\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^)\\]|\\.)*)\)\s*(?:Tj|'|")/g;
  let m;
  while ((m = re.exec(content))) {
    if (m[1] !== undefined) { size = parseFloat(m[1]) || size; continue; }
    if (m[2] !== undefined) {
      const dx = parseFloat(m[2]), dy = parseFloat(m[3]);
      if (Math.abs(dy) > 0.01) { out += '\n'; } else if (dx - x > 0.15 * size || dx < 0) { out += ' '; }
      x = 0; continue;
    }
    if (m[4] !== undefined) {
      for (const p of m[4].match(/\(((?:[^)\\]|\\.)*)\)|-?[\d.]+/g) || []) {
        if (p[0] === '(') { const t = decPdf(p.slice(1, -1)); out += t; x += textW(t, size); }
        else { const k = parseFloat(p); if (k < -150) out += ' '; x -= k / 1000 * size; }
      }
      continue;
    }
    if (m[5] !== undefined) { const t = decPdf(m[5]); out += t; x += textW(t, size); continue; }
    out += '\n'; x = 0; // T*, BT, ET, Tm
  }
  return out;
}
async function pdfText(bytes) {
  const s = new TextDecoder('latin1').decode(bytes);
  const parts = []; const re = /(?<!end)stream\r?\n/g; let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length; const end = s.indexOf('endstream', start); if (end < 0) break;
    const head = s.slice(Math.max(0, m.index - 300), m.index);
    if (/\/Subtype\s*\/Image|FontFile|\/Length1/.test(head)) { re.lastIndex = end + 9; continue; }
    // Longueur exacte du flux si déclarée ("/Length 1540", pas "/Length1"), sinon on retire la fin de ligne avant "endstream"
    const lm = head.match(/\/Length\s+(\d+)(?!\d)(?!\s+\d+\s+R)/);
    let e = end; while (e > start && (s[e - 1] === '\n' || s[e - 1] === '\r')) e--;
    const candidates = lm ? [start + parseInt(lm[1], 10), e, end] : [e, end];
    let inf = null;
    for (const c of candidates) { const u8 = bytes.slice(start, Math.min(c, end)); inf = /FlateDecode/.test(head) ? await inflate(u8) : u8; if (inf) break; }
    if (inf) { const t = new TextDecoder('windows-1252').decode(inf); if (/\b(Tj|TJ)\b/.test(t)) parts.push(t); }
    re.lastIndex = end + 9;
  }
  return parts.map(layoutText).join('\n').replace(/\u0080/g, '€').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
}
const numVal = (s) => parseFloat(String(s || '').replace(/[\s\u00a0]/g, '').replace(',', '.')) || 0;
const fmtEur = (n) => (Math.round(n * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Extrait les informations de l'avis de CFE et les confronte à la ligne du tableau du site
function parseAvisPdfCfe(txt, siren, row) {
  const g = (re) => { const m = txt.match(re); return m ? m[1].trim() : ''; };
  // Regex tolérantes aux espaces manquants ou surnuméraires ; NIC parfois non numérique (établissement provisoire : 9Z00R, BE00Q…)
  const siret = (g(/Num[ée]ro\s*fiscal\s*:?\s*(\d{9}\s?[0-9A-Z]{5})/i) || g(/N°\s*SIRET\s*:?\s*(\d{9}\s?[0-9A-Z]{5})/i)).replace(/\s/g, '');
  const reference = g(/R[ée]f[ée]rence\s*de\s*l.?avis\s*:?\s*([\d ]{10,20}?)(?=\s?[A-Za-zÀ-ÿ(])/i).replace(/\s/g, '');
  const montantAPayer = g(/MONTANT\s*A\s*PAYER\s*:?\s*([\d\s]*\d,\d{2})/i) || g(/Somme\s*[àa]\s*payer\s*:?\s*([\d\s]*\d(?:,\d{2})?)(?=\s*[A-Za-zÀ-ÿ€])/i);
  const montantImpot = g(/MONTANT\s*DE\s*VOTRE\s*IMP[ÔO]T\s*:?\s*([\d\s]*\d,\d{2})/i) || g(/Imp[ôo]t\s*de\s*r[ée]f[ée]rence\s*:?\s*([\d\s]*\d(?:,\d{2})?)(?=\s*[A-Za-zÀ-ÿ€])/i);
  const acompteVerse = g(/Versement\s*sur\s*acompte\s*:?\s*([\d\s]*\d,\d{2})/i);
  const dateLimite = g(/Au\s*plus\s*tard\s*le\s*(\d{2}\/\d{2}\/\d{4})/i) || g(/Date\s*limite\s*de\s*paiement\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
  const prel = txt.match(/PR[ÉE]L[ÈE]VEMENT\s*[ÀA]\s*L.?[ÉE]CH[ÉE]ANCE\.?\s*Le\s*montant\s*[àa]\s*payer\s*sera\s*pr[ée]lev[ée]\s*le\s*(\d{2}\/\d{2}\/\d{4})/i);
  let prelevement, datePrelevement = '';
  if (!txt || txt.length < 100) prelevement = 'À VÉRIFIER';
  else if (prel) { prelevement = 'OUI'; datePrelevement = prel[1]; }
  else if (/n.?avez\s*pas\s*adh[ée]r[ée]\s*[àa]\s*un\s*pr[ée]l[èe]vement/i.test(txt)) prelevement = 'NON';
  // L'avis sans adhésion propose « le prélèvement mensuel » comme option : ne retenir MENSUEL que si l'adhésion est affirmée
  else if (/(avez\s*(choisi|opt[ée]\s*pour)\s*le\s*pr[ée]l[èe]vement\s*mensuel|PR[ÉE]L[ÈE]VEMENT\s*MENSUEL\.|mensualis[ée])/i.test(txt)) prelevement = 'MENSUEL';
  else prelevement = 'NON';
  const ecarts = [];
  if (!txt || txt.length < 100) ecarts.push('texte PDF illisible');
  else {
    const anneeAvis = (txt.match(/AVIS\s*D.IMP[ÔO]T\s*(\d{4})/i) || [])[1];
    if (anneeAvis && row.anneeImposition && anneeAvis !== row.anneeImposition) ecarts.push(`année PDF ${anneeAvis} ≠ ${row.anneeImposition}`);
    if (!siret) ecarts.push('SIRET absent'); else if (siret.slice(0, 9) !== siren) ecarts.push(`SIREN PDF ${siret.slice(0, 9)} ≠ ${siren}`);
    if (reference && row.reference && reference !== row.reference.replace(/\D/g, '')) ecarts.push(`référence PDF ${reference} ≠ ${row.reference}`);
    if (montantAPayer && row.montant && Math.abs(numVal(montantAPayer) - numVal(row.montant)) > 0.01) ecarts.push(`montant PDF ${montantAPayer} ≠ ${row.montant}`);
    if (dateLimite && row.dateLimite && dateLimite !== row.dateLimite) ecarts.push(`échéance PDF ${dateLimite} ≠ ${row.dateLimite}`);
  }
  // Détail du calcul (avis de solde) : valeur locative, base minimum, taux communal N et N-1
  const detail = {
    valeurLocative: g(/1\s*-\s*Valeur\s*locative\s*des\s*biens\s*passibles\s*de\s*taxe\s*fonci[èe]re\s*([\d\s]+?)(?=\s*\d+\s*-|\s*7\s*-)/i).replace(/\s/g, ''),
    baseMinimum: g(/9\s*-\s*Imposition\s*sur\s*la\s*base\s*minimum\s*\(9\)\s*(OUI|NON)/i),
    baseMinimumMontant: g(/12\s*-\s*Base\s*minimum\s*applicable\s*\(9\)\s*([\d\s]+?)(?=\s*El[ée]ments|\s*\d+\s*-)/i).replace(/\s/g, ''),
    tauxCommuneN1: g(/16\s*-\s*Rappel\s*taux\s*d.?imposition\s*\d{4}\s*([\d,]+)\s*%/i),
    tauxCommuneN: g(/17\s*-\s*Taux\s*d.?imposition\s*\d{4}\s*([\d,]+)\s*%/i),
    cotisationMinimum: g(/189\s*-\s*INFORMATION\s*:\s*COTISATION\s*MINIMUM\s*CFE\s*\(28\)\s*([\d\s]+?)(?=\s*\d{3}\s*-)/i).replace(/\s/g, ''),
  };
  return { siret, reference, montantImpot, acompteVerse, montantAPayer, dateLimite, prelevement, datePrelevement, detail, controle: ecarts.length ? 'ÉCART : ' + ecarts.join(' ; ') : 'OK' };
}
const normTxt = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
// Avis de taxe foncière : libellés et valeurs sont dans des blocs séparés ; on s'appuie sur les phrases de paiement et sur la référence du tableau
function parseAvisPdfTf(txt, d, row) {
  const g = (re) => { const m = txt.match(re); return m ? m[1].trim() : ''; };
  const sommeAPayer = g(/Somme\s*[àa]\s*(?:pr[ée]lever|payer)\s*:?\s*([\d\s]*\d,\d{2})/i);
  const montantImpot = g(/Montant\s*de\s*vos\s*taxes\s*fonci[èe]res\s*:?\s*([\d\s]*\d,\d{2})/i) || sommeAPayer;
  const acompteVerse = g(/Acomptes\s*mensuels\s*d[ée]j[àa]\s*vers[ée]s\s*-?\s*([\d\s]*\d,\d{2})/i);
  const dateLimite = g(/Date\s*limite\s*de\s*paiement\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
  const anneeAvis = g(/Taxes\s*fonci[èe]res\s*pour\s*(\d{4})/i);
  const refDigits = (row.reference || '').replace(/\D/g, '');
  const refTrouvee = refDigits ? new RegExp(refDigits.split('').join('\\s?')).test(txt) : true;
  let prelevement, datePrelevement = '';
  if (!txt || txt.length < 100) prelevement = 'À VÉRIFIER';
  else if (/choisi\s*le\s*pr[ée]l[èe]vement\s*[àa]\s*l.?[ée]ch[ée]ance/i.test(txt)) { prelevement = 'OUI'; datePrelevement = g(/pr[ée]lev[ée]e?\s*automatiquement\s*le\s*(\d{2}\/\d{2}\/\d{4})/i); }
  else if (/pr[ée]l[èe]vements\s*mensuels\s*seront|Acomptes\s*mensuels|choisi\s*le\s*pr[ée]l[èe]vement\s*mensuel/i.test(txt)) prelevement = 'MENSUEL';
  else prelevement = 'NON';
  const ecarts = [];
  if (!txt || txt.length < 100) ecarts.push('texte PDF illisible');
  else {
    if (anneeAvis && row.anneeImposition && anneeAvis !== row.anneeImposition) ecarts.push(`année PDF ${anneeAvis} ≠ ${row.anneeImposition}`);
    if (!refTrouvee) ecarts.push(`référence ${row.reference} absente du PDF`);
    const nomN = normTxt(d.nom).replace(/^(SCI|SARL|SAS|SASU|EURL|SNC|SC|SELARL|M|MME|MR|SA|SCM|SCP|GFA|GAEC|EARL)\s+/, '').split(' ').slice(0, 2).join(' ');
    if (nomN.length >= 4 && !normTxt(txt).includes(nomN)) ecarts.push(`dénomination « ${nomN} » non trouvée dans le PDF`);
    if (montantImpot && row.montant && Math.abs(numVal(montantImpot) - numVal(row.montant)) > 0.01) ecarts.push(`montant PDF ${montantImpot} ≠ ${row.montant}`);
    if (dateLimite && row.dateLimite && dateLimite !== row.dateLimite) ecarts.push(`échéance PDF ${dateLimite} ≠ ${row.dateLimite}`);
  }
  return { siret: '', reference: row.reference, montantImpot, acompteVerse, montantAPayer: sommeAPayer, dateLimite, prelevement, datePrelevement, detail: parseTfDetail(txt), controle: ecarts.length ? 'ÉCART : ' + ecarts.join(' ; ') : 'OK' };
}
// Tableau « Propriétés bâties » de l'avis de TF : taux N-1 / N puis cotisation N-1 / N / variation par collectivité
// Détail de calcul de l'avis de TF : pour chaque collectivité, taux N-1 / N et cotisation N-1 / N.
// Deux tableaux possibles : propriétés bâties (6 collectivités) et propriétés non bâties (7 collectivités).
const TF_VAR = /^[+-]?\d+(?:,\d+)?\s*%$/;
// Colonne « Cotisation N-1 / Cotisation N / Variation » : une ligne par collectivité. Formes rencontrées :
// « 7358 9501 +29,12 % » · « % » (collectivité sans cotisation) · « - 1286 - % » (nouvelle cotisation) · « 13 -100 % » (cotisation supprimée) · « 0 % » (nulle les deux années).
// Elle peut être précédée des bases et cotisations N de chaque local (2 nombres par collectivité + le total) : on essaie chaque point de départ possible
// et on retient celui dont la somme des cotisations N retombe sur le total imprimé juste après.
function tfRows(segment, max, skips) {
  const tok = segment.match(/[+-]?\d+(?:,\d+)?\s*%|\d+|%|-/g) || [];
  const isInt = (x) => /^\d+$/.test(x || ''), isVar = (x) => x !== undefined && x !== '%' && TF_VAR.test(x);
  const parse = (i0) => {
    const rows = []; let i = i0;
    while (rows.length < max && i < tok.length) {
      const t = tok[i];
      if (t === '%') { rows.push(null); i++; }
      else if (isInt(t) && isInt(tok[i + 1]) && isVar(tok[i + 2])) { rows.push({ cotN1: t, cotN: tok[i + 1], var: tok[i + 2].replace(/\s*%$/, '') }); i += 3; }
      else if (isInt(t) && isInt(tok[i + 1]) && tok[i + 2] === '-') { rows.push({ cotN1: t, cotN: tok[i + 1], var: '' }); i += tok[i + 3] === '%' ? 4 : 3; } // variation non calculée
      else if (t === '-' && isInt(tok[i + 1]) && tok[i + 2] === '-' && tok[i + 3] === '%') { rows.push({ cotN1: '0', cotN: tok[i + 1], var: 'nouveau' }); i += 4; }
      else if (isInt(t) && isVar(tok[i + 1])) { rows.push({ cotN1: t, cotN: '0', var: tok[i + 1].replace(/\s*%$/, '') }); i += 2; }
      else if (isInt(t) && tok[i + 1] === '%') { rows.push({ cotN1: '0', cotN: t, var: 'nouveau' }); i += 2; } // cotisation N sans N-1 imprimée
      else if (/^[1-9]\d*\s*%$/.test(t)) { rows.push({ cotN1: '0', cotN: t.replace(/\s*%$/, ''), var: 'nouveau' }); i++; } // « 1850 % » : cotisation N, pas de N-1 (colonne variation vide)
      else if (isVar(t)) { rows.push({ cotN1: '0', cotN: '0', var: t.replace(/\s*%$/, '') }); i++; }
      else return null;
    }
    if (rows.length < max) return null;
    const total = isInt(tok[i]) ? +tok[i] : null, sum = rows.reduce((x, r) => x + (r ? +r.cotN : 0), 0);
    return { rows, exact: total !== null && total === sum };
  };
  // 1) un point de départ dont la somme des cotisations N égale le total imprimé ; 2) à défaut, les points de départ attendus
  for (let i = 0; i < tok.length; i++) { const c = parse(i); if (c && c.exact) return c.rows; }
  const cands = [...new Set([...skips, 0])].filter((k) => k >= 0 && k < tok.length).map(parse).filter(Boolean);
  return (cands[0] || { rows: [] }).rows;
}
function tfTaux(segment, n) { const out = []; const re = /(?:([\d]+,[\d]+)\s*)?%/g; let t; while (out.length < n && (t = re.exec(segment))) out.push(t[1] || ''); return { taux: out, rest: segment.slice(re.lastIndex) }; }
function parseTfDetail(txt) {
  const lignes = []; let anneeN1 = '', anneeN = '';
  const bati = txt.match(/Taux\s*(\d{4})\s*Taux\s*(\d{4})\s*Adresse\s*Base\s*Cotisation\s*Adresse\s*Base\s*Cotisation\s*Cotisation\s*\d{4}\s*Cotisation\s*\d{4}\s*Variation\s*([\s\S]{0,700}?)P\s*r\s*o\s*p\s*r/i);
  if (bati) {
    anneeN1 = bati[1]; anneeN = bati[2];
    const noms = ['Commune', 'Syndicat de communes', 'Intercommunalité', 'Taxes spéciales', "Taxe d'ordures ménagères", 'Taxe GEMAPI'];
    // Avant la colonne des variations : bases et cotisations N de chaque local (2 nombres par collectivité + total), pour 0 à n locaux
    const { taux, rest } = tfTaux(bati[3], 12), k = noms.filter((_, j) => taux[2 * j] || taux[2 * j + 1]).length, rows = tfRows(rest, 6, Array.from({ length: 12 }, (_, j) => j * (2 * k + 1)));
    noms.forEach((nom, k) => { const tN1 = taux[2 * k] || '', tN = taux[2 * k + 1] || '', c = rows[k] || {}; if (tN1 || tN || c.cotN) lignes.push({ nom, tauxN1: tN1, tauxN: tN, cotN1: c.cotN1 || '', cotN: c.cotN || '', variation: c.var || '' }); });
  }
  // Tableau « non bâti » : on part de « Bases terres non agricoles » et on remonte au dernier « Taux N-1 Taux N » (les en-têtes se répètent plus haut)
  let nb = null; const iNb = txt.search(/Bases\s*terres\s*non\s*agricoles/i);
  if (iNb > 0) {
    const pre = txt.slice(Math.max(0, iNb - 600), iNb); let mt, last = null; const reT = /Taux\s*(\d{4})\s*Taux\s*(\d{4})/g; while ((mt = reT.exec(pre))) last = { m: mt, end: reT.lastIndex };
    const post = txt.slice(iNb).match(/Cotisation\s*\d{4}\s*Cotisation\s*\d{4}\s*Variation\s*([\s\S]{0,500}?)(?:D[ée]gr[èe]vement|$)/i);
    if (last && post) nb = [null, last.m[1], last.m[2], pre.slice(last.end), post[1]];
  }
  if (nb) {
    anneeN1 = anneeN1 || nb[1]; anneeN = anneeN || nb[2];
    const noms = ['Commune', 'Syndicat de communes', 'Intercommunalité', 'Taxe additionnelle', 'Taxes spéciales', "Chambre d'agriculture", 'Taxe GEMAPI'];
    const { taux } = tfTaux(nb[3], 14), rows = tfRows(nb[4], 7, [0]);
    noms.forEach((nom, k) => { const tN1 = taux[2 * k] || '', tN = taux[2 * k + 1] || '', c = rows[k] || {}; if ((tN1 || tN) && c.cotN) lignes.push({ nom: nom + ' (non bâti)', tauxN1: tN1, tauxN: tN, cotN1: c.cotN1 || '', cotN: c.cotN || '', variation: c.var || '' }); });
  }
  return bati || nb ? { anneeN1, anneeN, lignes } : null;
}
// Explique une variation N-1 → N à partir du détail des avis (taux vs bases)
function expliquer(taxe, infosN, infosN1, mN, mN1) {
  const out = [];
  if (taxe.key === 'TF' && infosN?.detail?.lignes?.length) {
    for (const l of infosN.detail.lignes) {
      const cN = numVal(l.cotN), cN1 = numVal(l.cotN1), tN = numVal(l.tauxN), tN1 = numVal(l.tauxN1);
      if (!cN1 && !cN) continue;
      const dCot = cN - cN1;
      if (Math.abs(dCot) < 15) continue;
      const vt = tN1 ? (tN / tN1 - 1) * 100 : 0;
      const partTaux = !tN1 ? '' : Math.abs(tN - tN1) < 0.0005 ? `taux ${l.tauxN} % inchangé` : `taux ${l.tauxN1} → ${l.tauxN} %, soit ${vt >= 0 ? '+' : ''}${vt.toFixed(1).replace('.', ',')} %`;
      out.push(`${l.nom} ${cN1} → ${cN} € (${dCot >= 0 ? '+' : ''}${dCot} €${partTaux ? ' ; ' + partTaux : ''})`);
    }
    // Bases : à taux constant, la cotisation évolue comme la base (revalorisation forfaitaire ≈ +1 à 2 %/an, plus si nouveau local ou révision)
    const com = infosN.detail.lignes.find((l) => l.nom === 'Commune');
    if (com && numVal(com.tauxN1) && numVal(com.cotN1)) {
      const baseVar = (numVal(com.cotN) / numVal(com.tauxN)) / (numVal(com.cotN1) / numVal(com.tauxN1)) * 100 - 100;
      out.unshift(`bases ${baseVar >= 0 ? '+' : ''}${baseVar.toFixed(1).replace('.', ',')} %` + (baseVar > 3 ? ' (révision de valeur locative, nouveau local ou fin d’exonération : à vérifier, contestable jusqu’au 31/12/N+1)' : baseVar < -3 ? ' (local sorti ou base réduite)' : ' (revalorisation forfaitaire)'));
    }
    return out.join(' ; ');
  }
  if (taxe.key === 'CFE') {
    const dN = infosN?.detail || {}, dN1 = infosN1?.detail || {};
    if (dN.baseMinimum === 'OUI') out.push(`imposition sur la base minimum (${dN.baseMinimumMontant || ''} €)` + (dN1.baseMinimum === 'NON' ? ' alors que N-1 était sur la valeur locative' : ''));
    if (dN.valeurLocative && dN1.valeurLocative) { const v = numVal(dN.valeurLocative) / numVal(dN1.valeurLocative) * 100 - 100; out.push(`valeur locative ${dN1.valeurLocative} → ${dN.valeurLocative} (${v >= 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} %)` + (Math.abs(v) > 3 ? ' : changement de base à vérifier' : '')); }
    if (dN.tauxCommuneN && dN.tauxCommuneN1) out.push(`taux communal ${dN.tauxCommuneN1} → ${dN.tauxCommuneN} %` + (dN.tauxCommuneN === dN.tauxCommuneN1 ? ' (inchangé)' : ''));
    if (!out.length && mN1) out.push('détail non lu : comparer les deux avis');
    return out.join(' ; ');
  }
  return '';
}
const parseAvisPdf = (taxe, txt, d, row) => taxe.key === 'TF' ? parseAvisPdfTf(txt, d, row) : parseAvisPdfCfe(txt, d.siren, row);

// ======================================================================
// Habilitations du compte connecté (« Gérer mon espace › Consulter mes services »)
// Lecture seule : une page, puis la même page filtrée par rôle et par état (bouton « Filtrer »). Aucun autre bouton n'est utilisé.
// ======================================================================
const HAB_URL = BASE + '/opale_usager/xhtml/consultation-services/consultation-services.xhtml';
const HAB_ROLES = { AT: 'Administrateur titulaire', AS: 'Administrateur suppléant', N1: 'Acteur délégant', N2: 'Acteur' };
const HAB_ETATS = { hab2: 'En veille', hab3: 'Supprimé' };
const decodeEnt = (t) => t.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
function habLignes(h) {
  const out = [], re = /<div class="text-center">\s*([0-9A-Z]{9,14})\s*<\/div>\s*<\/td>\s*<td>\s*<div class="text-left">([^<]*?)\s*<\/div>/g;
  let m; while ((m = re.exec(h))) out.push([m[1], decodeEnt(m[2]).replace(/\s+/g, ' ').trim()]);
  return out;
}
const habViewState = (h) => (h.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/) || h.match(/value="([^"]+)"[^>]*name="javax\.faces\.ViewState"/) || [])[1];
async function getHabilitations(token, onStep) {
  onStep?.('Ouverture de « Gérer mon espace »…');
  await fetchText(`${BASE}/mire/redirection.do?idth=gerer.services&token=${encodeURIComponent(token)}`);
  onStep?.('Lecture de la liste des services (la page est lourde : 10 à 20 s)…');
  let h = await fetchText(HAB_URL);
  let vs = habViewState(h);
  const tous = habLignes(h);
  if (!vs || !/tableau-services/.test(h)) throw new Error('Page « Consulter mes services » non reconnue');
  const abonne = ((h.replace(/<[^>]+>/g, ' ').match(/N°\s*d.abonn[ée]\s*:?\s*([0-9]{6,})/i)) || [])[1] || '';
  h = null;
  const filtrer = async (role, etat) => {
    const body = new URLSearchParams({
      'form-consultation-services': 'form-consultation-services', 'form-consultation-services:initTableauServices': 'true',
      'form-consultation-services:siren': 'Aucun filtre', 'form-consultation-services:libelle-service': 'Aucun filtre', 'form-consultation-services:code-service': 'Aucun filtre',
      'form-consultation-services:libelle-etat': etat ? HAB_ETATS[etat] : 'Aucun filtre', 'form-consultation-services:code-etat': etat || 'Aucun filtre',
      'form-consultation-services:libelle-role': role ? HAB_ROLES[role] : 'Aucun filtre', 'form-consultation-services:code-role': role || 'Aucun filtre',
      'form-consultation-services:filtre-id': 'Filtrer', 'javax.faces.ViewState': vs,
    });
    const x = await fetchText(HAB_URL, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    vs = habViewState(x) || vs;
    return habLignes(x);
  };
  const cle = (l) => l[0] + '|' + l[1];
  const role = {}, etat = {};
  for (const r of Object.keys(HAB_ROLES)) { onStep?.(`Rôles : ${HAB_ROLES[r]}…`); for (const l of await filtrer(r, null)) role[cle(l)] = r; }
  for (const e of Object.keys(HAB_ETATS)) { onStep?.(`États : ${HAB_ETATS[e]}…`); for (const l of await filtrer(null, e)) etat[cle(l)] = e; }
  await filtrer(null, null); // remet la page sans filtre, comme on l'a trouvée
  // Noms des entreprises : liste des dossiers du service « Compte fiscal » (la page des habilitations ne donne que le SIREN)
  let noms = {};
  try { onStep?.('Noms des dossiers…'); noms = Object.fromEntries((await listDossiers(token, null, 'consulter.adelie.le_compte_fiscal')).map((d) => [d.siren, d.nom])); } catch {}
  const vus = new Set(), rows = [];
  for (const l of tous) { const k = cle(l); if (vus.has(k)) continue; vus.add(k); rows.push({ siren: l[0], service: l[1], role: role[k] || '', etat: etat[k] === 'hab3' ? 'Supprimé' : etat[k] === 'hab2' ? 'En veille' : 'Actif' }); }
  return { at: Date.now(), abonne, rows, noms };
}
