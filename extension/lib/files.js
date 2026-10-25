// Relève — exports : ZIP, classeur Excel, brouillons de mails, fichier de correspondance
'use strict';
const clean = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().replace(/\s+/g, '_').slice(0, 60);
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function makeZip(entries) {
  const enc = new TextEncoder(), chunks = [], central = []; let offset = 0;
  const now = new Date(), dosT = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dosD = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const { path, data } of entries) {
    const name = enc.encode(path), u8 = typeof data === 'string' ? enc.encode(data) : data, crc = crc32(u8);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(10, dosT, true); h.setUint16(12, dosD, true); h.setUint32(14, crc, true); h.setUint32(18, u8.length, true); h.setUint32(22, u8.length, true); h.setUint16(26, name.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(12, dosT, true); c.setUint16(14, dosD, true); c.setUint32(16, crc, true); c.setUint32(20, u8.length, true); c.setUint32(24, u8.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    chunks.push(new Uint8Array(h.buffer), name, u8); central.push(new Uint8Array(c.buffer), name); offset += 30 + name.length + u8.length;
  }
  const cd = central.reduce((a, x) => a + x.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true); e.setUint32(12, cd, true); e.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((a, x) => a + x.length, 0)); let k = 0;
  for (const x of all) { out.set(x, k); k += x.length; }
  return out;
}

// Styles : 0 normal · 1 en-tête · 2 euros · 3 % · 4 lien · 5 titre · 6 gras · 7 orange · 8 vert · 9 rouge · 10 euros gras · 11 texte long · 12 jaune · 13 sous-titre
const XLSX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/><numFmt numFmtId="165" formatCode="+0.0%;-0.0%;0.0%"/></numFmts>
<fonts count="6"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="18"/><color rgb="FF1F3B6E"/><name val="Calibri"/></font><font><u/><sz val="11"/><color rgb="FF2B4C8C"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="11"/><color rgb="FF6B6B6B"/><name val="Calibri"/></font></fonts>
<fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F3B6E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFDDBF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDF5D3"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFD4D4"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF1B8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD5DDEA"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="14">
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1"><alignment vertical="top"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" applyFont="1" applyBorder="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="1" applyFont="1" applyBorder="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" applyFill="1" applyBorder="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="5" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="top"/></xf>
<xf numFmtId="164" fontId="4" fillId="0" borderId="1" applyNumberFormat="1" applyFont="1" applyBorder="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="6" borderId="1" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const xmlEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colL = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

// sheet = { name, cols: [{ h, w, t: 's'|'eur'|'pct'|'link'|'long', style?(row) }], rows: [[...]], title?, subtitle?, filter:true }
function sheetXml(sh, rels) {
  const rowsXml = [], links = []; let r = 0;
  const cell = (ci, ri, v, s, t) => {
    const ref = colL(ci) + ri;
    if (v === null || v === undefined || v === '') return s ? `<c r="${ref}" s="${s}"/>` : '';
    if (t === 'n' && typeof v === 'number' && isFinite(v)) return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  };
  if (sh.title) { r++; rowsXml.push(`<row r="${r}" ht="28" customHeight="1">${cell(0, r, sh.title, 5)}</row>`); }
  if (sh.subtitle) { r++; rowsXml.push(`<row r="${r}">${cell(0, r, sh.subtitle, 13)}</row>`); }
  if (sh.title || sh.subtitle) { r++; rowsXml.push(`<row r="${r}"/>`); }
  const headRow = ++r;
  rowsXml.push(`<row r="${r}" ht="30" customHeight="1">${sh.cols.map((c, i) => cell(i, r, c.h, 1)).join('')}</row>`);
  for (const row of sh.rows) {
    r++;
    rowsXml.push(`<row r="${r}">${sh.cols.map((c, i) => {
      let v = row[i], s = 0, t = 's';
      if (c.t === 'eur') { s = 2; t = 'n'; } else if (c.t === 'pct') { s = 3; t = 'n'; } else if (c.t === 'long') s = 11; else if (c.t === 'n') t = 'n';
      if (c.t === 'link' && v) { s = 4; links.push({ ref: colL(i) + r, target: v.target }); v = v.label; }
      if (c.style) { const st = c.style(v, row); if (st !== undefined) s = st; }
      return cell(i, r, v, s, t);
    }).join('')}</row>`);
  }
  const lastCol = colL(sh.cols.length - 1);
  let hl = '';
  if (links.length) {
    hl = '<hyperlinks>' + links.map((l, k) => { const id = 'rId' + (k + 1); rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEsc(encodeURI(l.target))}" TargetMode="External"/>`); return `<hyperlink ref="${l.ref}" r:id="${id}"/>`; }).join('') + '</hyperlinks>';
  }
  return {
    headRow, lastRow: r, lastCol,
    xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0"${sh.tab ? ' tabSelected="1"' : ''} showGridLines="0"><pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${sh.cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.w || 14}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rowsXml.join('')}</sheetData>
${sh.filter !== false && sh.rows.length ? `<autoFilter ref="A${headRow}:${lastCol}${r}"/>` : ''}${hl}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`,
  };
}

// Fichier de correspondance cabinet : SIREN ; code dossier ; collaborateur ; agence ; email client (en-têtes libres, séparateur ; , ou tabulation)
function parseCorrespondance(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return {};
  const sep = [';', ',', '\t'].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const norm = (h) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const head = lines[0].split(sep).map(norm);
  const find = (...keys) => head.findIndex((h) => keys.some((k) => h.includes(k)));
  const iS = find('siren', 'siret'), iC = find('codedossier', 'code', 'dossier'), iK = find('collab', 'gestionnaire', 'responsable'), iA = find('agence', 'site', 'bureau'), iE = find('mail', 'courriel');
  const iN = head.findIndex((h, i) => i !== iC && ['raisonsociale', 'denomination', 'nomclient', 'client', 'societe', 'entreprise', 'nom'].some((k) => h.includes(k)));
  const map = {};
  for (const l of lines.slice(iS >= 0 ? 1 : 0)) {
    const c = l.split(sep).map((x) => x.replace(/^"|"$/g, '').trim());
    const siren = (c[iS >= 0 ? iS : 0] || '').replace(/\D/g, '').slice(0, 9);
    if (siren.length !== 9) continue;
    map[siren] = { code: iC >= 0 ? c[iC] : '', nom: iN >= 0 ? c[iN] : '', collaborateur: iK >= 0 ? c[iK] : '', agence: iA >= 0 ? c[iA] : '', email: iE >= 0 ? (c[iE] || '').match(/[^\s;,]+@[^\s;,]+/)?.[0] || '' : '' };
  }
  return map;
}

// Brouillon de mail au format .eml (s'ouvre dans Outlook / Thunderbird comme un brouillon, pièces jointes incluses)
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const wrap76 = (s) => s.replace(/(.{76})/g, '$1\r\n');
function buildEml({ to, subject, body, attachments }) {
  const bd = 'AVISCOLLECTOR-' + Math.random().toString(36).slice(2);
  const enc = (s) => '=?UTF-8?B?' + btoa(unescape(encodeURIComponent(s))) + '?=';
  const parts = [`--${bd}\r\nContent-Type: text/plain; charset="utf-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(btoa(unescape(encodeURIComponent(body.replace(/\r?\n/g, '\r\n')))))}\r\n`];
  for (const a of attachments) parts.push(`--${bd}\r\nContent-Type: application/pdf; name="${a.name}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${a.name}"\r\n\r\n${wrap76(b64(a.bytes))}\r\n`);
  const eml = `X-Unsent: 1\r\nTo: ${to}\r\nSubject: ${enc(subject)}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${bd}"\r\n\r\n${parts.join('')}--${bd}--\r\n`;
  return new TextEncoder().encode(eml);
}

// Classeur .xlsx à partir d'une liste de feuilles (voir sheetXml)
function buildWorkbook(sheets) {
  const files = [], wbSheets = [], wbRels = [], ct = [], defNames = [];
    sheets.forEach((sh, i) => {
      const rels = [], { xml, headRow, lastRow, lastCol } = sheetXml(sh, rels), n = i + 1;
      files.push({ path: `xl/worksheets/sheet${n}.xml`, data: xml });
      if (rels.length) files.push({ path: `xl/worksheets/_rels/sheet${n}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>` });
      wbSheets.push(`<sheet name="${xmlEsc(sh.name)}" sheetId="${n}" r:id="rId${n}"/>`);
      wbRels.push(`<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`);
      ct.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
      if (sh.filter !== false && sh.rows.length) defNames.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xmlEsc(sh.name).replace(/'/g, "''")}'!$A$${headRow}:$${lastCol}$${lastRow}</definedName>`);
    });
    const n = sheets.length;
    files.unshift(
      { path: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${ct.join('')}</Types>` },
      { path: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { path: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${wbSheets.join('')}</sheets>${defNames.length ? `<definedNames>${defNames.join('')}</definedNames>` : ''}</workbook>` },
      { path: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wbRels.join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { path: 'xl/styles.xml', data: XLSX_STYLES },
    );
    return makeZip(files);
}

// Lecture d'un classeur .xlsx (première feuille) sans bibliothèque → lignes de cellules (texte)
async function readXlsxRows(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('fichier Excel illisible');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const files = {}, dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    files[name] = { method, csize, off }; p += 46 + nl + el + cl;
  }
  const read = async (name) => {
    const f = files[name]; if (!f) return '';
    const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true), raw = u8.subarray(start, start + f.csize);
    if (f.method === 0) return dec.decode(raw);
    const out = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    return dec.decode(out);
  };
  const xml = (t) => new DOMParser().parseFromString(t, 'application/xml');
  const ss = [...xml(await read('xl/sharedStrings.xml')).getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
  const wb = xml(await read('xl/workbook.xml')), rels = xml(await read('xl/_rels/workbook.xml.rels'));
  const first = wb.getElementsByTagName('sheet')[0], rid = first && (first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
  let target = 'worksheets/sheet1.xml';
  for (const r of rels.getElementsByTagName('Relationship')) if (r.getAttribute('Id') === rid) target = r.getAttribute('Target').replace(/^\/?xl\//, '');
  const sh = xml(await read('xl/' + target));
  const col = (ref) => { let c = 0; for (const ch of ref.replace(/\d+/g, '')) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };
  return [...sh.getElementsByTagName('row')].map((row) => {
    const cells = [];
    for (const c of row.getElementsByTagName('c')) {
      const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0], is = c.getElementsByTagName('is')[0];
      let val = t === 's' ? ss[+(v && v.textContent)] : t === 'inlineStr' ? (is ? is.textContent : '') : (v ? v.textContent : '');
      cells[col(c.getAttribute('r') || 'A1')] = val ?? '';
    }
    return [...cells].map((x) => x ?? '');
  });
}
// Fichier importé (CSV ou Excel) → texte « ; » pour les analyseurs ci-dessous
async function fileToText(file) {
  const buf = await file.arrayBuffer();
  if (/\.xlsx$/i.test(file.name)) return (await readXlsxRows(buf)).map((r) => r.map((x) => String(x).replace(/[;\r\n]+/g, ' ')).join(';')).join('\n');
  let txt = new TextDecoder('utf-8').decode(buf);
  if (txt.includes('�')) txt = new TextDecoder('windows-1252').decode(buf);
  return txt;
}
// Date tapée ou numéro de série Excel → jj/mm/aaaa
function normDate(v) {
  const s = String(v || '').trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 864e5); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; }
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); if (m) return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3].length === 2 ? '20' + m[3] : m[3]}`;
  return s;
}
// Chiffres d'affaires par exercice : SIREN ; date de clôture ; durée (mois) ; CA HT ; [date de création]. Plusieurs exercices possibles par client.
function parseCa(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return {};
  const sep = [';', ',', '\t'].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const norm = (h) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const head = lines[0].split(sep).map(norm);
  const used = new Set();
  const find = (...keys) => { for (const k of keys) { const i = head.findIndex((h, j) => !used.has(j) && (k.length <= 2 ? h === k : h.includes(k))); if (i >= 0) { used.add(i); return i; } } return -1; };
  const iS = find('siren', 'siret'), iD = find('duree', 'mois'), iCr = find('creation', 'debutactivite', 'immatriculation'), iCl = find('clotur', 'finexercice', 'datefin', 'exercice'), iCa = find('chiffre', 'recette', 'ca', 'cahtc', 'caht', 'ventes', 'produit');
  if (iS < 0 || iCa < 0) throw new Error('colonnes SIREN et chiffre d’affaires introuvables');
  const nb = (x) => parseFloat(String(x || '').replace(/[\s  €]/g, '').replace(',', '.')) || 0;
  const map = {};
  for (const l of lines.slice(1)) {
    const c = l.split(sep).map((x) => x.replace(/^"|"$/g, '').trim());
    const siren = (c[iS] || '').replace(/\D/g, '').slice(0, 9);
    if (siren.length !== 9) continue;
    const o = map[siren] = map[siren] || { exos: [], creation: '' };
    if (iCr >= 0 && c[iCr]) o.creation = normDate(c[iCr]);
    if (c[iCa] !== '' && c[iCa] !== undefined) o.exos.push({ cloture: iCl >= 0 ? normDate(c[iCl]) : '', duree: iD >= 0 ? nb(c[iD]) || 12 : 12, ca: nb(c[iCa]) });
  }
  return map;
}
