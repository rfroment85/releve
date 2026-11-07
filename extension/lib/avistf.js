// Relève — lecture du détail par adresse d'un avis de taxe foncière (texte extrait par ACPDF)
// Sert au contrôle de la valeur locative : base, cotisation et cotisation lissée de la part communale, adresse par adresse.
// Partagé entre le script de contenu et l'application. Fonctions pures.
'use strict';
const ACTF = (() => {
  const COLL = ['Commune', 'Syndicat de communes', 'Intercommunalité', 'Taxes spéciales', "Taxe d'ordures ménagères", 'Taxe GEMAPI'];
  const toks = (s) => s.match(/[+-]?\d+(?:,\d+)?\s*%|\d+|%|-/g) || [];
  const isInt = (x) => /^\d+$/.test(x || '');
  // Adresses d'un segment de texte : « 9001 RUE POL FABRE », « 0353A RUE DE BRETAGNE », « 0012 PL LAMARTINE »
  const adresses = (seg) => (seg.match(/\d{1,4}[A-Z]?\s+[A-Z][A-Z'’ .-]{2,60}?(?=\s+\d{1,4}[A-Z]?\s+[A-Z]|\s*$)/g) || []).map((a) => a.trim());
  // Numéro de voie normalisé pour rapprocher une adresse d'avis avec une fiche de bien : « 0353A RUE DE BRETAGNE » ↔ « 353 A RUE DE BRETAGNE »
  const cle = (a) => String(a || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^0+(\d)/, '$1').replace(/^(\d+)\s*([A-Z])\b/, '$1$2').replace(/\b(CHEM|CHE)\b/g, 'CHEMIN').replace(/\b(AV|AVE)\b/g, 'AVENUE').replace(/\bBD\b/g, 'BOULEVARD').replace(/\bPL\b/g, 'PLACE').replace(/\bRTE\b/g, 'ROUTE').replace(/\bIMP\b/g, 'IMPASSE').replace(/\bALL\b/g, 'ALLEE').replace(/[^A-Z0-9]+/g, ' ').trim();

  // En-tête : département et commune d'imposition (« 107 ROQUEBRUNE-SUR-ARGENS 221 11/08/2025 »), montant de l'impôt
  function enTete(txt) {
    const m = txt.match(/\b(\d{2,3})\s+([A-Z][A-Z'’ -]{2,40}?)\s+(\d{3})\s+(\d{2}\/\d{2}\/\d{4})/);
    const dep = (txt.match(/\b(\d{2,3})\s+(?:VAR|[A-Z-]{3,30})\s+\d{3}\s+[A-Z]/) || [])[1] || '';
    const ref = txt.match(/R[ée]f[ée]rences\s*administratives\s*:\s*(\d{3})\s*(\d{2})\s*(\d{3})\s*(\d{3})\s*(\d{3})/);
    return { communeCode: m ? m[1] : (ref ? ref[5] : ''), communeNom: m ? m[2].trim() : '', departement: ref ? ref[1].slice(0, 2) : dep.slice(0, 2), montant: Number((txt.match(/Montant\s*de\s*votre\s*imp[ôo]t\s*(\d+)/) || [])[1] || 0) };
  }

  // Détail par adresse de la page principale : [{ adresse, base, cotisation, cotisationLissee, total }] (part communale ; total = toutes collectivités)
  function locaux(txt) {
    const out = [];
    const h = txt.match(/Taux\s*(\d{4})\s*Taux\s*(\d{4})\s*((?:Adresse\s*Base\s*Cotisation\s*(?:Cotisation\s*lissée\s*)?)+)Cotisation\s*\d{4}\s*Cotisation\s*\d{4}\s*Variation\s*([\s\S]{0,900}?)P\s*r\s*o\s*p\s*r/i);
    if (!h) return feuillets(txt);
    const lisse = /lissée/i.test(h[3]), g = lisse ? 3 : 2;
    const t = toks(h[4]);
    // 12 colonnes de taux (6 collectivités × N-1 / N) : une collectivité est présente si l'un de ses deux taux est imprimé
    let i = 0, k = 0;
    for (let c = 0; c < 6; c++) { let pres = false; for (let j = 0; j < 2; j++) { const x = t[i++]; if (x !== undefined && x !== '%' && /%/.test(x)) pres = true; } if (pres) k++; }
    if (!k) return feuillets(txt);
    const ints = []; while (isInt(t[i])) ints.push(+t[i++]);
    // m adresses × k collectivités × g valeurs, puis le total ; on retient le m dont le total recoupe la somme imprimée
    const adr = adresses((txt.match(/b\s*â\s*t\s*i\s*e\s*s\s*([\s\S]{0,300}?)D[ÉE]BITEUR/) || [])[1] || '');
    for (let m = Math.min(4, Math.floor((ints.length - 1) / (k * g))); m >= 1; m--) {
      const n = m * k * g, total = ints[n];
      const sum = Array.from({ length: m }, (_, a) => ints[a * k * g + (g - 1)]).reduce((s, x) => s + x, 0); // colonne commune seulement : pas de total imprimé par collectivité
      let tot = 0; for (let a = 0; a < m; a++) for (let c = 0; c < k; c++) tot += ints[a * k * g + c * g + (g - 1)];
      if (total === tot || (m === 1 && ints.length >= n + 1)) {
        for (let a = 0; a < m; a++) { const b = a * k * g; out.push({ adresse: adr[a] || (m === 1 ? adr[0] || '' : ''), base: ints[b], cotisation: ints[b + 1], cotisationLissee: lisse ? ints[b + 2] : null, total: m === 1 ? total : null }); }
        void sum; break;
      }
    }
    return out.length ? out : feuillets(txt);
  }
  // Feuillets annexes (avis multi-adresses, « suite ») : « 0353A RUE DE BRETAGNE 6715 7161 7219 7161 2999 26 571 12 3608 » = bases par collectivité, cotisations, total
  function feuillets(txt) {
    const out = [];
    const seg = (txt.match(/D[ÉE]TAIL\s*DU\s*CALCUL\s*DES\s*COTISATIONS([\s\S]{0,6000}?)(?:Rendez-vous|Vos r[ée]f[ée]rences|$)/i) || [])[1];
    if (!seg) return out;
    const re = /(\d{1,4}[A-Z]?\s+[A-Z][A-Z'’ .-]{2,60}?)\s+((?:\d+\s+)+)(?=\d{1,4}[A-Z]?\s+[A-Z]|$)/g;
    let m;
    while ((m = re.exec(seg))) {
      const nums = m[2].trim().split(/\s+/).map(Number);
      if (nums.length < 3) continue;
      const k = Math.floor((nums.length - 1) / 2);
      // bases (k) puis cotisations (k) puis total : la somme des cotisations doit retomber sur le total
      const cots = nums.slice(k, 2 * k), total = nums[2 * k];
      if (cots.reduce((s, x) => s + x, 0) !== total) continue;
      out.push({ adresse: m[1].trim(), base: nums[0], cotisation: cots[0], cotisationLissee: null, total });
    }
    return out;
  }
  return { locaux, feuillets, enTete, cle, adresses, COLL };
})();
if (typeof self !== 'undefined') self.ACTF = ACTF;
if (typeof module !== 'undefined') module.exports = ACTF;
