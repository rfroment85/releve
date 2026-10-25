// Relève — passerelle vers le connecteur Claude (MCP local).
// Le service d'arrière-plan se connecte au connecteur installé dans l'application Claude (ws://127.0.0.1:47831),
// exécute les outils demandés sur les données du poste et renvoie le résultat. Désactivé par défaut (Réglages).
'use strict';
const ACMCP = (() => {
  const PORT = 47831;
  let ws = null, state = 'off', lastError = '', pingT = null, connecting = false, echecs = 0, prochain = 0, etaitOuvert = false;
  const { eur, eur2, num, TAXE_LABEL } = ACA;

  // ---- Pseudonymisation (option) : « Client 4F2A » à la place du nom et du SIREN ----
  const pseudo = ACA.pseudo;

  async function ctx() {
    const data = await ACDB.loadAll();
    const S = data.settings;
    ACM.setContext({ settings: S, annee: String(ACA.anneeCampagne()), ca: data.ca || {} });
    const scope = S.scope === 'moi' ? 'moi' : undefined;
    const c = ACA.campagne(data, { annee: ACA.anneeCampagne(), scope });
    const anon = !!S.mcpAnon;
    const nomOf = (siren, nom) => anon ? pseudo(siren) : nom;
    const sirenOf = (siren) => anon ? undefined : siren;
    // Résolution d'un client désigné par Claude : SIREN, nom (ou partie), pseudonyme
    const sirens = [...new Set(c.avis.map((a) => a.siren).concat(data.dossiers.map((d) => d.siren)))];
    const noms = Object.fromEntries(c.avis.map((a) => [a.siren, a.nom]).concat(data.dossiers.map((d) => [d.siren, d.nom])));
    const resolve = (q) => {
      const t = String(q || '').trim(); if (!t) return [];
      const digits = t.replace(/\s/g, '');
      if (/^\d{9}$/.test(digits) && sirens.includes(digits)) return [digits];
      const p = sirens.filter((s) => pseudo(s).toLowerCase() === t.toLowerCase()); if (p.length) return p;
      if (anon) return [];
      const n = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const exact = sirens.filter((s) => norm(noms[s]) === n); if (exact.length) return exact;
      return sirens.filter((s) => norm(noms[s]).includes(n));
    };
    return { data, S, c, anon, nomOf, sirenOf, resolve, noms };
  }
  // En mode masqué, l'identifiant d'une action ne doit pas contenir le SIREN : il est remplacé par le code du pseudonyme
  const idOut = (X, t) => X.anon ? String(t.id).split(t.siren).join(pseudo(t.siren).replace('Client ', '')) : t.id;
  const idIn = (X, id) => { const t = X.c.taches.find((x) => x.id === id || idOut({ anon: true }, x) === id); return t ? t.id : null; };
  const catTitre = (c, k) => (c.CATS.find((x) => x.key === k) || {}).titre || k;
  const taskOut = (X, t) => ({ id: idOut(X, t), client: X.nomOf(t.siren, t.nom), siren: X.sirenOf(t.siren), categorie: catTitre(X.c, t.cat), avis: t.lieu, a_faire: t.quoi, montant: Math.round(t.montant || 0), echeance: t.echeance || undefined, collaborateur: t.collab || undefined, statut: t.done ? 'fait' : t.snoozed ? 'reporté' : 'à faire', note: t.note || undefined, message_possible: !!ACM.mailItem(t) });
  const unClient = (X, q) => {
    const l = X.resolve(q);
    if (!l.length) throw new Error(`Client introuvable : « ${q} ».${X.anon ? ' (Les noms sont masqués : utilisez le pseudonyme « Client XXXX ».)' : ''}`);
    if (l.length > 1) throw new Error(`Plusieurs clients correspondent à « ${q} » : ${l.slice(0, 8).map((s) => X.nomOf(s, X.noms[s]) + (X.anon ? '' : ` (${s})`)).join(', ')}${l.length > 8 ? '…' : ''}. Précisez.`);
    return l[0];
  };

  // ---- Outils ----
  const tools = {
    async resume() {
      const X = await ctx(), c = X.c, open = c.taches.filter((t) => !t.done && !t.snoozed);
      const last = X.data.runs[0];
      return {
        campagne: c.annee, perimetre: X.S.scope === 'moi' ? 'mon portefeuille' : 'tout le cabinet', noms_masques: X.anon, ...(X.anon ? { consigne: 'Noms masqués : quand votre réponse cite des clients, appelez afficher_dans_releve avec la réponse complète pour que l’utilisateur la lise avec les vrais noms.' } : {}),
        derniere_mise_a_jour: last ? new Date(last.at).toLocaleString('fr-FR') : 'aucune',
        avis: { total: c.avis.length, annee_N: c.N.length, clients: new Set(c.N.map((a) => a.siren)).size },
        evolution_a_perimetre_comparable: c.tot.n1 ? { annee_N_1: Math.round(c.tot.n1), annee_N: Math.round(c.tot.n), pct: Math.round((c.tot.n / c.tot.n1 - 1) * 1000) / 10 } : null,
        actions_ouvertes: Object.fromEntries(c.CATS.map((k) => [k.titre, open.filter((t) => t.cat === k.key).length]).filter(([, n]) => n)),
        creances_echues: Math.round(open.filter((t) => t.cat === 'dette').reduce((s, t) => s + (t.montant || 0), 0)),
        prochaines_dates: c.calendrier.slice(0, 4).map((e) => `${e.date} : ${e.titre}`),
        avis_cfe_attendus: c.aVenir.length,
      };
    },
    async lister_actions(p = {}) {
      const X = await ctx();
      let l = X.c.taches.filter((t) => (p.inclure_faites ? true : !t.done && !t.snoozed));
      if (p.categorie) { const q = p.categorie.toLowerCase(); l = l.filter((t) => t.cat === q || catTitre(X.c, t.cat).toLowerCase().includes(q)); }
      if (p.client) { const s = new Set(X.resolve(p.client)); l = l.filter((t) => s.has(t.siren)); }
      if (p.collaborateur) { const q = p.collaborateur.toLowerCase(); l = l.filter((t) => (t.collab || '').toLowerCase().includes(q)); }
      const lim = Math.min(p.limite || 50, 300);
      return { total: l.length, affichees: Math.min(l.length, lim), categories: X.c.CATS.map((k) => k.titre), actions: l.slice(0, lim).map((t) => taskOut(X, t)) };
    },
    async lister_clients(p = {}) {
      const X = await ctx(), m = new Map();
      for (const a of X.c.N) {
        const o = m.get(a.siren) || { siren: a.siren, nom: a.nom, collab: a.collab, tf: 0, cfe: 0, n: 0, n1: 0, prel: new Set(), communes: new Set() };
        if (a.taxe === 'TF') o.tf += a.m; else o.cfe += a.m;
        if (a.n1) { o.n += a.m; o.n1 += a.n1.m; }
        if (a.prel) o.prel.add(ACA.PAIEMENT[a.prel] || a.prel); if (a.commune) o.communes.add(a.commune);
        m.set(a.siren, o);
      }
      const open = X.c.taches.filter((t) => !t.done && !t.snoozed);
      let l = [...m.values()].map((o) => ({ client: X.nomOf(o.siren, o.nom), siren: X.sirenOf(o.siren), collaborateur: o.collab || undefined, taxe_fonciere: Math.round(o.tf), cfe: Math.round(o.cfe), evolution_pct: o.n1 ? Math.round((o.n / o.n1 - 1) * 1000) / 10 : null, paiement: [...o.prel].join(', '), communes: [...o.communes].join(', '), actions_ouvertes: open.filter((t) => t.siren === o.siren).length }));
      if (p.recherche) { const q = p.recherche.toLowerCase(); l = l.filter((x) => `${x.client} ${x.siren || ''} ${x.communes} ${x.collaborateur || ''}`.toLowerCase().includes(q)); }
      if (p.commune) { const q = p.commune.toLowerCase(); l = l.filter((x) => x.communes.toLowerCase().includes(q)); }
      if (p.hausse_min_pct !== undefined) l = l.filter((x) => x.evolution_pct !== null && x.evolution_pct >= p.hausse_min_pct);
      const tri = { evolution: (x) => -(x.evolution_pct ?? -1e9), montant: (x) => -(x.taxe_fonciere + x.cfe), actions: (x) => -x.actions_ouvertes, nom: null }[p.tri || 'montant'];
      if (tri) l.sort((a, b) => tri(a) - tri(b)); else l.sort((a, b) => a.client.localeCompare(b.client, 'fr'));
      const lim = Math.min(p.limite || 50, 500);
      return { total: l.length, clients: l.slice(0, lim) };
    },
    async fiche_client(p = {}) {
      const X = await ctx(), s = unClient(X, p.client);
      const N = X.c.N.filter((a) => a.siren === s);
      const info = (X.S.correspondance || {})[s] || {};
      return {
        client: X.nomOf(s, X.noms[s]), siren: X.sirenOf(s), code_dossier: X.anon ? undefined : info.code || undefined, collaborateur: info.collaborateur || undefined, email_connu: !!info.email,
        avis_annee_N: N.map((a) => ({
          impot: TAXE_LABEL[a.taxe] + (a.acompte ? ' (acompte)' : ''), commune: a.commune, montant: Math.round(a.m), montant_N_1: a.n1 ? Math.round(a.n1.m) : null, evolution_pct: a.n1 ? Math.round(a.d.pct * 10) / 10 : null,
          paiement: a.paiement, date_limite: a.dateLimite, analyse: a.d.verdict || undefined,
          decomposition: a.n1 && a.taxe === 'TF' ? { effet_taux: Math.round(a.d.taux), effet_bases: Math.round(a.d.bases), biens_nouveaux: Math.round(a.d.nouveaux), frais_et_arrondis: Math.round(a.d.autres) } : undefined,
          collectivites: a.taxe === 'TF' && a.d.lignes.length ? a.d.lignes.map((l) => ({ collectivite: l.nom, taux_N_1: l.tN1, taux_N: l.tN, cotisation_N_1: Math.round(l.cN1), cotisation_N: Math.round(l.cN) })) : undefined,
          controle_cfe: a.cfe ? { base_minimum: a.cfe.bm ? a.cfe.bmM : null, ca_reference: a.cfe.caRef, plafond_legal: a.cfe.plafond, anomalies: a.cfe.anomalies.map((x) => x.texte), informations: a.cfe.infos } : undefined,
        })),
        dettes_fiscales: X.c.dettes.filter((r) => r.siren === s).map((r) => ({ impot: r.impot, annee: r.annee, reference: r.reference, date_limite: r.dateLimite, montant_du: r.montantDu, solde: r.solde })),
        documents_a_payer: X.c.amr.filter((r) => r.siren === s).map((r) => ({ amr: r.amr, montant: r.montant })),
        actions: X.c.taches.filter((t) => t.siren === s).map((t) => taskOut(X, t)),
        notes: (X.data.cnotes[s] || []).map((n) => `${new Date(n.at).toLocaleDateString('fr-FR')} : ${n.text}`),
      };
    },
    async collectivites(p = {}) {
      const X = await ctx(), col = ACA.collectivites(X.c.N);
      let g = col.groups; if (p.commune) { const q = p.commune.toLowerCase(); g = g.filter((x) => x.nom.toLowerCase().includes(q)); }
      return {
        total: { cotisations_N_1: Math.round(col.P.cN1), cotisations_N: Math.round(col.P.cN), effet_taux: Math.round(col.P.taux), effet_bases: Math.round(col.P.bases), biens_nouveaux: Math.round(col.P.nouveaux), avis: col.P.avis },
        decisions: col.decisions.slice(0, 15).map((d) => ({ collectivite: d.nom, taux: `${d.tN1} % → ${d.tN} %`, communes: d.communes, impact: Math.round(d.eff), avis: d.avis })),
        communes: g.slice(0, p.commune ? 50 : 30).map((x) => ({ commune: x.nom, avis: x.avis, clients: x.nClients, cotisations_N_1: Math.round(x.cN1), cotisations_N: Math.round(x.cN), explication: x.phrase })),
      };
    },
    async preparer_message(p = {}) {
      const X = await ctx(), s = unClient(X, p.client);
      let items = X.c.taches.filter((t) => t.siren === s && !t.done && !t.snoozed).map(ACM.mailItem).filter(Boolean);
      if (p.actions && p.actions.length) { const ids = new Set(p.actions.map((a) => idIn(X, a)).filter(Boolean)); items = items.filter((x) => ids.has(x.task.id)); }
      if (!items.length) {
        const a = X.c.N.find((x) => x.siren === s && x.hausse) || X.c.N.find((x) => x.siren === s && !x.acompte);
        if (!a) throw new Error('Aucun avis ni action pour ce client.');
        items = [{ kind: 'auto', a, task: null }];
      }
      const m = ACM.mailForItems(items, !!p.detaille);
      return { client: X.nomOf(s, X.noms[s]), destinataire_connu: !!m.to, objet: m.subject, texte: m.body, pieces_jointes: (m.attach || []).map((a) => `${a.taxe} ${a.annee} ${a.commune || ''}`.trim()), actions_couvertes: items.filter((x) => x.task).map((x) => idOut(X, x.task)),
        rappel: 'Brouillon à relire. Pour l’ouvrir dans Outlook avec les avis joints, utilisez l’outil ouvrir_dans_releve (vue « message ») : l’utilisateur valide l’envoi.' };
    },
    async preparer_reclamation(p = {}) {
      const X = await ctx();
      const t = X.c.taches.find((x) => x.id === idIn(X, p.action)) || (p.client ? X.c.taches.find((x) => x.siren === unClient(X, p.client) && x.action === 'reclamation' && !x.done) : null);
      if (!t || t.action !== 'reclamation') throw new Error('Aucune réclamation possible trouvée (catégorie « Réclamation possible »).');
      const r = ACM.reclamationText(t);
      return { client: X.nomOf(t.siren, t.nom), motif: t.quoi, objet: r.objet, texte: X.anon ? r.texte.replace(new RegExp(t.nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), pseudo(t.siren)).replace(/\d{3} \d{3} \d{3}/g, '[SIREN]') : r.texte, rappel: 'À relire et compléter (passages entre crochets), puis à déposer par l’utilisateur. Relève ne dépose rien.' };
    },
    async marquer_actions(p = {}) {
      const X = await ctx(); const ids = [...new Set((p.actions || []).map((a) => idIn(X, a)).filter(Boolean))];
      if (!ids.length) throw new Error('Aucune action reconnue (utilisez les identifiants renvoyés par lister_actions).');
      const status = { fait: 'done', a_faire: null, plus_tard: 'snooze' }[p.statut];
      if (status === undefined && !p.note) throw new Error('Statut attendu : fait, a_faire ou plus_tard.');
      for (const id of ids) {
        const old = (await ACDB.get('tasks', id)) || { id };
        const rec = { ...old, id };
        if (status !== undefined) { rec.status = status; rec.at = Date.now(); if (status === 'snooze') rec.until = Date.now() + 7 * 864e5; else delete rec.until; }
        if (p.note !== undefined) rec.note = String(p.note).slice(0, 500);
        if (!rec.status && !rec.note) await ACDB.del('tasks', id); else await ACDB.put('tasks', rec);
      }
      chrome.runtime.sendMessage({ type: 'ac:dataChanged' }).catch(() => {});
      return { mises_a_jour: ids.length, statut: p.statut || 'inchangé', note: p.note !== undefined ? 'enregistrée' : undefined };
    },
    async noter_client(p = {}) {
      const X = await ctx(), s = unClient(X, p.client);
      const rec = (await ACDB.get('meta', 'cnotes')) || { key: 'cnotes', data: {} };
      rec.data[s] = [...(rec.data[s] || []), { at: Date.now(), text: String(p.note || '').slice(0, 1000) }];
      await ACDB.put('meta', rec);
      chrome.runtime.sendMessage({ type: 'ac:dataChanged' }).catch(() => {});
      return { client: X.nomOf(s, X.noms[s]), notes: rec.data[s].length };
    },
    async ouvrir_dans_releve(p = {}) {
      const X = await ctx();
      const vues = { liste: 'a-traiter', collectivites: 'collectivites', calendrier: 'calendrier', exports: 'exports' };
      let hash = vues[p.vue] || 'a-traiter';
      if (p.client) { const s = unClient(X, p.client); hash = 'client/' + s + (p.vue === 'message' ? '/message' : ''); }
      await self.openApp(hash);
      return { ouvert: hash.startsWith('client/') ? (p.vue === 'message' ? 'fenêtre de message du client' : 'fiche du client') : hash };
    },
    async afficher_dans_releve(p = {}) {
      const texte = String(p.texte || '').slice(0, 30000);
      if (!texte.trim()) throw new Error('Texte vide.');
      const rec = (await ACDB.get('meta', 'claude')) || { key: 'claude', list: [] };
      rec.list = [{ at: Date.now(), titre: String(p.titre || '').slice(0, 200), texte }, ...(rec.list || [])].slice(0, 30);
      await ACDB.put('meta', rec);
      chrome.runtime.sendMessage({ type: 'ac:claudeReponse' }).catch(() => {});
      await self.openApp('demander/claude');
      return { affiche: true, ou: 'Relève › Demander › Réponses de Claude, avec les vrais noms' };
    },
    async lancer_mise_a_jour(p = {}) {
      const X = await ctx();
      const tabs = await chrome.tabs.query({ url: 'https://cfspro.impots.gouv.fr/*' });
      if (!tabs.length) throw new Error('L’espace professionnel impots.gouv n’est pas ouvert : l’utilisateur doit l’ouvrir et se connecter lui-même.');
      const tab = tabs[0];
      const ask = (msg) => chrome.tabs.sendMessage(tab.id, msg);
      let page = null; try { page = await ask({ type: 'ac:ping' }); } catch { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.bundle.js'] }); page = await ask({ type: 'ac:ping' }).catch(() => null); }
      if (!page || page.login || page.expired) throw new Error('Session impots.gouv non active : l’utilisateur doit se connecter (l’extension ne saisit jamais d’identifiants).');
      if (page.running) return { deja_en_cours: true };
      const S = X.S, corr = S.correspondance || {};
      const mine = [...new Set([...Object.entries(corr).filter(([, v]) => S.moi && v.collaborateur === S.moi).map(([k]) => k), ...(S.portefeuille || [])])];
      const scope = p.perimetre === 'cabinet' || !mine.length ? null : mine;
      const list = await ACDB.get('meta', 'dossierList');
      await self.handleRun({ type: 'ac:started' });
      await ask({ type: 'ac:start', opts: { annee: ACA.anneeCampagne(), taxes: ['TF', 'CFE'], delay: 60, dettes: true, amr: S.amr !== false, scope, complet: !!p.complet, dossiers: list && list.list && Date.now() - list.at < 12 * 3600e3 ? list.list : null } });
      return { lancee: true, perimetre: scope ? `mon portefeuille (${scope.length} dossiers)` : 'tout le cabinet', suivi: 'Utilisez etat_mise_a_jour pour suivre l’avancement.' };
    },
    async etat_mise_a_jour() {
      const r = self.getRun ? self.getRun() : {};
      return { en_cours: !!r.running, dossiers_lus: r.done, total: r.total, en_cours_sur: r.running ? r.label : undefined, reste_secondes: r.eta || undefined, nouveaux_avis: r.nouveaux, erreur: r.error || undefined, derniere: r.last ? { date: new Date(r.last.at).toLocaleString('fr-FR'), dossiers: r.last.stats && r.last.stats.dossiers, nouveaux: r.last.stats && r.last.stats.nouveaux, actions_ouvertes: r.last.open } : undefined };
    },
  };

  // ---- Connexion ----
  // force : essai immédiat (activation dans les réglages) ; sinon on respecte l'espacement après des échecs
  async function connect(force) {
    const s = await ACDB.settings();
    if (!s.mcp) { disconnect('off'); return; }
    if (connecting || (ws && (ws.readyState === 0 || ws.readyState === 1))) return;
    // L'espacement survit à la mise en veille du service d'arrière-plan
    try { const b = (await chrome.storage.session.get('mcpBackoff')).mcpBackoff; if (b) { echecs = Math.max(echecs, b.echecs || 0); prochain = Math.max(prochain, b.prochain || 0); } } catch {}
    if (!force && Date.now() < prochain) return;
    if (force) { echecs = 0; prochain = 0; }
    connecting = true; state = 'connexion';
    try {
      ws = new WebSocket(`ws://127.0.0.1:${PORT}/avis-collector`);
      ws.onopen = () => { connecting = false; state = 'connecte'; lastError = ''; echecs = 0; prochain = 0; etaitOuvert = true; chrome.storage.session.set({ mcpBackoff: { echecs: 0, prochain: 0 } }).catch(() => {}); ws.send(JSON.stringify({ type: 'hello', version: chrome.runtime.getManifest().version, anon: !!s.mcpAnon })); clearInterval(pingT); pingT = setInterval(() => { try { ws.send(JSON.stringify({ type: 'ping' })); } catch {} }, 20000); broadcast(); };
      ws.onmessage = async (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type !== 'call' || !msg.id) return;
        const st = await ACDB.settings();
        let reply;
        if (!st.mcp) reply = { id: msg.id, error: 'Connexion à Claude désactivée dans les réglages de Relève.' };
        else if (!tools[msg.tool]) reply = { id: msg.id, error: 'Outil inconnu : ' + msg.tool };
        else { try { reply = { id: msg.id, result: await tools[msg.tool](msg.params || {}) }; } catch (e) { reply = { id: msg.id, error: e.message }; } }
        try { ws.send(JSON.stringify({ type: 'result', ...reply })); } catch {}
      };
      ws.onerror = () => { lastError = 'Connecteur Claude introuvable sur ce poste'; };
      ws.onclose = () => {
        connecting = false; clearInterval(pingT);
        if (state !== 'off') {
          state = 'deconnecte';
          // Coupure d'une liaison établie (Claude redémarré) : un seul nouvel essai rapide.
          // Échec de connexion (connecteur absent) : essais espacés de 1, 2, 4 puis 5 minutes, pour ne pas encombrer la console.
          if (etaitOuvert) { etaitOuvert = false; setTimeout(() => connect(true), 3000); }
          else { echecs++; prochain = Date.now() + Math.min(5, 2 ** (echecs - 1)) * 60e3 - 5e3; chrome.storage.session.set({ mcpBackoff: { echecs, prochain } }).catch(() => {}); }
        }
        broadcast();
      };
    } catch (e) { connecting = false; state = 'deconnecte'; lastError = e.message; }
  }
  function disconnect(st = 'off') { state = st; clearInterval(pingT); try { ws && ws.close(); } catch {} ws = null; broadcast(); }
  const broadcast = () => chrome.runtime.sendMessage({ type: 'ac:mcpState', state, error: lastError }).catch(() => {});
  // Anciens noms (connecteur 1.0.x)
  tools.ouvrir_dans_avis_collector = tools.ouvrir_dans_releve; tools.afficher_dans_avis_collector = tools.afficher_dans_releve;
  return { connect, disconnect, status: () => ({ state, error: lastError }), tools, pseudo };
})();
if (typeof self !== 'undefined') self.ACMCP = ACMCP;
