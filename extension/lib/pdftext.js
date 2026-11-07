// Relève — extraction du texte d'un PDF d'avis, sans bibliothèque (flux FlateDecode décompressés nativement, texte des opérateurs Tj/TJ).
// Partagé entre le script de contenu (collecte) et l'application (relecture des avis déjà sur le poste).
'use strict';
const ACPDF = (() => {
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
  return { pdfText, layoutText };
})();
if (typeof self !== 'undefined') self.ACPDF = ACPDF;
if (typeof module !== 'undefined') module.exports = ACPDF;
