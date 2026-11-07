// Relève — cadastre (6.0) : surface de la parcelle et emprise au sol du bâti, lues sur la Géoplateforme de l'IGN
// (service WFS public, sans clé : parcellaire express pour la parcelle, BD TOPO pour les bâtiments).
// Seule la référence cadastrale (code INSEE de la commune, section, numéro) est transmise : jamais le nom du client, ni le SIREN, ni l'adresse.
// Résultat conservé sur le poste (magasin « cadastre »), relu au plus une fois par an.
'use strict';
const ACCAD = (() => {
  const WFS = 'https://data.geopf.fr/wfs/ows';
  const UN_AN = 365 * 86400e3;
  // Clé = identifiant unique de parcelle (IDU) : INSEE (5) + préfixe de section (3, « 000 » sauf communes fusionnées) + section (2) + numéro (4)
  const cle = (insee, section, numero, prefixe) => `${insee}${String(prefixe || '000').padStart(3, '0')}${String(section || '').toUpperCase().padStart(2, '0')}${String(numero || '').padStart(4, '0')}`;
  // Code INSEE à partir du département (2 caractères, « 2A », ou 971…) et du code commune des fichiers RVLLP (3 chiffres ; DOM : 3 chiffres déjà préfixés)
  const insee = (dep, communeCode) => { const d = String(dep || ''), c = String(communeCode || '').padStart(3, '0'); if (!d || !communeCode) return ''; return (d.length === 3 ? d.slice(0, 2) : d) + c; };
  // Surface plane d'un anneau [lon, lat] en m² (projection locale équirectangulaire : précision largement suffisante pour une parcelle)
  function aire(ring) {
    if (!ring || ring.length < 3) return 0;
    const lat0 = ring[0][1] * Math.PI / 180, kx = 111320 * Math.cos(lat0), ky = 110540;
    let s = 0;
    for (let i = 0; i < ring.length; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length]; s += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky); }
    return Math.abs(s) / 2;
  }
  const dedans = (pt, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c; } return c; };
  const anneaux = (geom) => geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.type === 'MultiPolygon' ? geom.coordinates.map((p) => p[0]) : [];
  const surfacePolys = (geom) => anneaux(geom).reduce((s, r) => s + aire(r), 0);
  // Part d'un bâtiment située dans la parcelle : échantillonnage sur une grille (les bâtiments peuvent chevaucher plusieurs parcelles)
  function part(batGeom, parcRings) {
    const rings = anneaux(batGeom); if (!rings.length) return 0;
    let xs = Infinity, xe = -Infinity, ys = Infinity, ye = -Infinity;
    for (const r of rings) for (const [x, y] of r) { xs = Math.min(xs, x); xe = Math.max(xe, x); ys = Math.min(ys, y); ye = Math.max(ye, y); }
    let n = 0, k = 0; const N = 24;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const p = [xs + (xe - xs) * (i + 0.5) / N, ys + (ye - ys) * (j + 0.5) / N]; if (!rings.some((r) => dedans(p, r))) continue; n++; if (parcRings.some((r) => dedans(p, r))) k++; }
    return n ? k / n : 0;
  }
  async function wfs(params) {
    const u = WFS + '?' + new URLSearchParams({ SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature', OUTPUTFORMAT: 'application/json', SRSNAME: 'EPSG:4326', COUNT: 100, ...params });
    const r = await fetch(u, { credentials: 'omit', cache: 'no-store' });
    if (!r.ok) throw new Error(`IGN : HTTP ${r.status}`);
    const j = await r.json();
    if (!j || !Array.isArray(j.features)) throw new Error('IGN : réponse inattendue');
    return j.features;
  }
  // Lecture d'une parcelle : { contenance, emprise, nb, niveaux, batiments[], at } ou { erreur, at }
  async function lire(inseeCode, section, numero, prefixe) {
    const idu = cle(inseeCode, section, numero, prefixe);
    const P = await wfs({ TYPENAMES: 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle', CQL_FILTER: `idu='${idu}'` });
    if (!P.length) return { erreur: 'parcelle introuvable au cadastre', idu, at: Date.now() };
    const p = P[0], rings = anneaux(p.geometry), contenance = Number(p.properties.contenance) || Math.round(surfacePolys(p.geometry));
    let xs = Infinity, xe = -Infinity, ys = Infinity, ye = -Infinity;
    for (const r of rings) for (const [x, y] of r) { xs = Math.min(xs, x); xe = Math.max(xe, x); ys = Math.min(ys, y); ye = Math.max(ye, y); }
    const B = await wfs({ TYPENAMES: 'BDTOPO_V3:batiment', BBOX: `${xs},${ys},${xe},${ye},EPSG:4326` });
    const batiments = [];
    for (const b of B) {
      const pr = b.properties || {}, s = surfacePolys(b.geometry), q = part(b.geometry, rings);
      if (s * q < 5) continue;
      batiments.push({ surface: Math.round(s), part: Math.round(q * 100) / 100, dans: Math.round(s * q), niveaux: Math.max(1, Number(pr.nombre_d_etages) || 1), hauteur: pr.hauteur != null ? Number(pr.hauteur) : null, nature: pr.nature || '', usage: pr.usage_1 || '', leger: !!pr.construction_legere });
    }
    const emprise = batiments.reduce((s, b) => s + b.dans, 0), niveaux = batiments.length ? Math.max(...batiments.map((b) => b.niveaux)) : null;
    return { idu, contenance, emprise: Math.round(emprise), nb: batiments.length, niveaux, plancher: Math.round(batiments.reduce((s, b) => s + b.dans * b.niveaux, 0)), batiments, at: Date.now() };
  }
  // Complète le magasin « cadastre » pour les locaux professionnels d'enregistrements « biens » : { insee, section, numero } sans entrée récente
  // depDe(b) et inseeDe(b) sont fournis par l'appelant (dépend des paramètres RVLLP chargés) ; opts.pause en ms entre deux parcelles
  async function completer(recs, { inseeDe, pause = 150, onStep } = {}) {
    const vues = new Set(); let n = 0, erreurs = 0;
    for (const rec of recs) for (const b of rec.biens || []) {
      if (!b.pro || !b.fiche || !b.fiche.section || !b.fiche.numParcelle) continue;
      const code = await inseeDe(b); if (!code) continue;
      const k = cle(code, b.fiche.section, b.fiche.numParcelle, b.fiche.prefixe); if (vues.has(k)) continue; vues.add(k);
      const cur = await ACDB.get('cadastre', k);
      if (cur && cur.at && Date.now() - cur.at < (cur.erreur ? 30 * 86400e3 : UN_AN)) continue;
      try { const r = await lire(code, b.fiche.section, b.fiche.numParcelle, b.fiche.prefixe); await ACDB.put('cadastre', { cle: k, ...r }); n++; }
      catch (e) { await ACDB.put('cadastre', { cle: k, erreur: e.message, at: Date.now() }); erreurs++; }
      if (onStep) onStep(n, erreurs);
      await new Promise((r) => setTimeout(r, pause));
    }
    return { lus: n, erreurs };
  }
  return { cle, insee, lire, completer, aire };
})();
if (typeof self !== 'undefined') self.ACCAD = ACCAD;
if (typeof module !== 'undefined') module.exports = ACCAD;
