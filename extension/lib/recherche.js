// Relève — « Demander » : questions prêtes et filtres sur les données du poste (sans IA, résultats exacts),
// et affichage des réponses de Claude avec les vrais noms (les pseudonymes « Client 4F2A » sont remplacés sur le poste).
'use strict';
const ACR = (() => {
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const F0 = { quoi: 'actions', categorie: '', taxe: '', commune: '', collaborateur: '', jours: 0, min: 0, tri: '' };
  const QUESTIONS = [
    { lib: 'À prévenir sous 7 jours', f: { quoi: 'actions', categorie: 'prevenir', jours: 7, tri: 'echeance' } },
    { lib: 'Paiements à vérifier', f: { quoi: 'actions', categorie: 'paiement', tri: 'montant' } },
    { lib: 'Créances échues', f: { quoi: 'actions', categorie: 'dette', tri: 'montant' } },
    { lib: 'Réclamations possibles', f: { quoi: 'actions', categorie: 'bases', tri: 'montant' } },
    { lib: 'Hausses à expliquer', f: { quoi: 'actions', categorie: 'hausse', tri: 'montant' } },
    { lib: 'Plus fortes hausses', f: { quoi: 'hausses', tri: 'euros' } },
    { lib: 'Prélèvement à proposer', f: { quoi: 'actions', categorie: 'prelevement', tri: 'montant' } },
    { lib: 'Plus gros contribuables', f: { quoi: 'clients', tri: 'montant' } },
    { lib: 'Bilan de la campagne', f: { quoi: 'bilan' } },
  ];
  // D = { taches (ouvertes), N, clients (agrégats), CATS, tot, annee }
  function executer(f0, D) {
    const f = { ...F0, ...f0 };
    const eur = ACA.eur, sgn = ACA.sgn, pc = ACA.pc;
    const okCom = (c) => !f.commune || norm(c) === norm(f.commune);
    const okCol = (c) => !f.collaborateur || c === f.collaborateur;
    const okTaxe = (t) => !f.taxe || t === f.taxe;
    if (f.quoi === 'bilan') {
      const parCat = D.CATS.map((k) => { const l = D.taches.filter((t) => t.cat === k.key && okCol(t.collab)); return { cat: k.key, titre: k.titre, n: l.length, montant: l.reduce((s, t) => s + (t.montant || 0), 0) }; }).filter((x) => x.n);
      const evo = D.tot.n1 ? (D.tot.n / D.tot.n1 - 1) * 100 : 0;
      return { texte: `${D.N.length} avis ${D.annee} lus. À périmètre comparable, les impôts passent de ${eur(D.tot.n1)} à ${eur(D.tot.n)} (${pc(evo)}). ${parCat.reduce((s, x) => s + x.n, 0)} actions restent à traiter.`, bloc: { kind: 'cats', items: parCat } };
    }
    if (f.quoi === 'hausses' || f.quoi === 'baisses') {
      const sens = f.quoi === 'hausses' ? 1 : -1;
      const l = D.N.filter((a) => a.n1 && !a.acompte && a.d.delta * sens > 0.5 && okTaxe(a.taxe) && okCom(a.commune) && okCol(a.collab) && Math.abs(a.d.delta) >= (f.min || 0));
      l.sort(f.tri === 'pct' ? (a, b) => (b.d.pct - a.d.pct) * sens : (a, b) => (b.d.delta - a.d.delta) * sens);
      return { texte: l.length ? `${l.length} avis en ${sens > 0 ? 'hausse' : 'baisse'}, ${sgn(l.reduce((s, a) => s + a.d.delta, 0))} au total.` : `Aucun avis en ${sens > 0 ? 'hausse' : 'baisse'} avec ces filtres.`, bloc: { kind: 'hausses', items: l } };
    }
    if (f.quoi === 'clients') {
      const v = (c) => f.taxe === 'TF' ? c.tf : f.taxe === 'CFE' ? c.cfe : c.tf + c.cfe;
      const l = D.clients.filter((c) => (!f.commune || [...c.communes].some(okCom)) && okCol(c.collab) && v(c) >= (f.min || 0) && v(c) > 0);
      l.sort(f.tri === 'pct' ? (a, b) => (b.evo ?? -1e9) - (a.evo ?? -1e9) : f.tri === 'euros' ? (a, b) => (b.n - b.n1) - (a.n - a.n1) : (a, b) => v(b) - v(a));
      return { texte: `${l.length} client${l.length > 1 ? 's' : ''}.`, bloc: { kind: 'clients', items: l } };
    }
    const filtre = (avecJours) => D.taches.filter((t) => (!f.categorie || t.cat === f.categorie)
      && (!f.taxe || (t.avis ? t.avis.taxe === f.taxe : f.taxe === 'CFE' && /CFE/.test(t.lieu)))
      && okCol(t.collab) && (!f.commune || (t.avis && okCom(t.avis.commune)) || norm(t.lieu).includes(norm(f.commune)))
      && (t.montant || 0) >= (f.min || 0)
      && (!avecJours || !f.jours || (t.avis && t.avis.jours !== null && t.avis.jours >= 0 && t.avis.jours <= f.jours)));
    let l = filtre(true), avant = '';
    if (!l.length && f.jours) { l = filtre(false).filter((t) => !t.avis || t.avis.jours === null || t.avis.jours > f.jours); if (l.length) avant = `Aucune échéance dans les ${f.jours} prochains jours. Plus tard : `; }
    const j = (t) => (t.avis && t.avis.jours !== null && t.avis.jours >= 0 ? t.avis.jours : 1e6);
    if (f.tri === 'montant') l.sort((a, b) => (b.montant || 0) - (a.montant || 0));
    else if (f.tri === 'echeance' || avant) l.sort((a, b) => j(a) - j(b));
    const tot = l.reduce((s, t) => s + (t.montant || 0), 0);
    return { texte: avant + (l.length ? `${l.length} action${l.length > 1 ? 's' : ''}${tot ? `, ${eur(tot)} en jeu` : ''}.` : 'Rien à traiter avec ces filtres.'), bloc: { kind: 'taches', items: l } };
  }

  // ---- Réponses de Claude : Markdown simple, pseudonymes remplacés par les vrais noms ----
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function annuaire(paires) { // [[siren, nom]] → { '4F2A': [{siren, nom}] }
    const m = {};
    for (const [siren, nom] of paires) { if (!siren) continue; const k = ACA.pseudo(siren).slice(7); (m[k] = m[k] || []); if (!m[k].some((x) => x.siren === siren)) m[k].push({ siren, nom }); }
    return m;
  }
  function inline(s, ann, vus) {
    let h = esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    return h.replace(/Client ([0-9A-Z]{4})\b/g, (all, k) => {
      const l = ann[k]; if (!l) return `<span class="pseudo" title="Pseudonyme inconnu sur ce poste">${all}</span>`;
      vus.add(k);
      return l.map((x) => `<a class="vrai" href="#client/${x.siren}" title="${all}">${esc(x.nom)}</a>`).join(' ou ');
    });
  }
  function rendre(texte, ann) {
    const vus = new Set(), out = [], L = String(texte || '').replace(/\r/g, '').split('\n');
    let i = 0;
    while (i < L.length) {
      const l = L[i];
      if (/^\s*\|/.test(l)) {
        const rows = []; while (i < L.length && /^\s*\|/.test(L[i])) { rows.push(L[i]); i++; }
        const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const body = rows.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
        const [hd, ...rest] = body;
        out.push(`<table class="t"><thead><tr>${cells(hd).map((c) => `<th>${inline(c, ann, vus)}</th>`).join('')}</tr></thead><tbody>${rest.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c, ann, vus)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
        continue;
      }
      if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
        const ol = /^\s*\d/.test(l), items = [];
        while (i < L.length && /^\s*([-*•]|\d+[.)])\s+/.test(L[i])) { items.push(L[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '')); i++; }
        out.push(`<${ol ? 'ol' : 'ul'}>${items.map((x) => `<li>${inline(x, ann, vus)}</li>`).join('')}</${ol ? 'ol' : 'ul'}>`);
        continue;
      }
      const m = l.match(/^\s*(#{1,4})\s+(.*)/);
      if (m) out.push(`<h4>${inline(m[2], ann, vus)}</h4>`);
      else if (l.trim()) { const p = [l]; i++; while (i < L.length && L[i].trim() && !/^\s*(\||#|[-*•]\s|\d+[.)]\s)/.test(L[i])) { p.push(L[i]); i++; } out.push(`<p>${p.map((x) => inline(x, ann, vus)).join('<br>')}</p>`); continue; }
      i++;
    }
    return { html: out.join(''), clients: [...vus].flatMap((k) => ann[k]) };
  }
  return { F0, QUESTIONS, executer, annuaire, rendre };
})();
if (typeof self !== 'undefined') self.ACR = ACR;
