#!/usr/bin/env node
// Relève — connecteur MCP local.
// Claude (application de bureau) lance ce programme ; il expose les outils Relève à Claude (stdio)
// et attend la connexion de l'extension Chrome/Edge sur ws://127.0.0.1:<port>. Aucune donnée n'est stockée ici :
// chaque appel est transmis à l'extension, qui répond à partir des données du poste.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';

const PORT = Number(process.env.AC_PORT || 47831);
// Identifiant fixe de l'extension (clé du manifeste) : seule cette origine peut se connecter
const ORIGINES = (process.env.AC_ORIGINS || 'chrome-extension://ifobkhlejligkpamefibhakpolcnbdcl').split(',').map((x) => x.trim()).filter(Boolean);
const log = (...a) => process.stderr.write('[avis-collector] ' + a.join(' ') + '\n');

// ---- Passerelle WebSocket vers l'extension ----
// L'application Claude peut lancer plusieurs exemplaires du connecteur (plusieurs fenêtres, sessions Cowork…).
// Le premier qui obtient le port devient « principal » : l'extension se connecte à lui. Les suivants deviennent
// des « relais » : ils se connectent au principal (jeton local) qui transmet leurs appels à l'extension.
// Si le principal s'arrête, un relais reprend le port.
const DOSSIER = path.join(os.homedir(), '.avis-collector');
const FICHIER_JETON = path.join(DOSSIER, 'relais.jeton');
const JETON = crypto.randomBytes(24).toString('hex');
let role = 'aucun', wss = null, ext = null, up = null, seq = 0;
const pending = new Map(), routes = new Map();
const PAS_CONNECTEE = 'Relève n’est pas joignable. Vérifiez que Chrome (ou Edge) est ouvert avec l’extension Relève, et que « Connexion à Claude » est activée dans ses Réglages. La connexion se rétablit seule en moins d’une minute.';
const envoyer = (sock, o) => { try { sock.send(JSON.stringify(o)); } catch {} };

function demarrer() {
  const srv = new WebSocketServer({
    host: '127.0.0.1', port: PORT,
    verifyClient: (info, cb) => {
      const u = new URL(info.req.url || '/', 'http://127.0.0.1');
      if (u.pathname === '/avis-collector') { const ok = ORIGINES.includes(info.origin); if (!ok) log('connexion refusée, origine', info.origin || '(aucune)'); return cb(ok, 403); }
      if (u.pathname === '/relais') return cb(!info.origin && u.searchParams.get('jeton') === JETON, 403);
      return cb(false, 404);
    },
  });
  srv.on('listening', () => {
    wss = srv; role = 'principal'; log(`principal sur le port ${PORT}`);
    try { fs.mkdirSync(DOSSIER, { recursive: true }); fs.writeFileSync(FICHIER_JETON, JETON, { mode: 0o600 }); } catch (e) { log('jeton non écrit :', e.message); }
  });
  srv.on('error', (e) => {
    if (e.code === 'EADDRINUSE') { try { srv.close(); } catch {} devenirRelais(); }
    else log('passerelle :', e.message);
  });
  srv.on('connection', (sock, req) => {
    const relais = (req.url || '').startsWith('/relais');
    if (relais) {
      log('relais connecté');
      sock.on('message', (buf) => {
        let m; try { m = JSON.parse(buf.toString()); } catch { return; }
        if (m.type !== 'call') return;
        if (!ext || ext.readyState !== 1) return envoyer(sock, { type: 'result', id: m.id, error: PAS_CONNECTEE });
        const id = 'r' + (++seq); routes.set(id, { sock, id: m.id });
        envoyer(ext, { type: 'call', id, tool: m.tool, params: m.params });
      });
      return;
    }
    if (ext && ext.readyState === 1) { try { ext.close(); } catch {} }
    ext = sock; log('extension connectée');
    sock.on('message', (buf) => {
      let m; try { m = JSON.parse(buf.toString()); } catch { return; }
      if (m.type !== 'result') return;
      if (routes.has(m.id)) { const r = routes.get(m.id); routes.delete(m.id); return envoyer(r.sock, { ...m, id: r.id }); }
      if (pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.t); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result); }
    });
    sock.on('close', () => { if (ext === sock) { ext = null; log('extension déconnectée'); } });
  });
}
function devenirRelais() {
  role = 'relais';
  let jeton = ''; try { jeton = fs.readFileSync(FICHIER_JETON, 'utf8').trim(); } catch {}
  const c = new WebSocket(`ws://127.0.0.1:${PORT}/relais?jeton=${encodeURIComponent(jeton)}`);
  c.on('open', () => { up = c; log('relais vers le connecteur principal'); });
  c.on('message', (buf) => {
    let m; try { m = JSON.parse(buf.toString()); } catch { return; }
    if (m.type === 'result' && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.t); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result); }
  });
  const perdu = () => { if (up === c) up = null; role = 'aucun'; setTimeout(demarrer, 1500 + Math.random() * 1500); };
  c.on('close', perdu);
  c.on('error', () => {});
}
function appeler(tool, params, delai = 30000) {
  const cible = role === 'principal' ? ext : role === 'relais' ? up : null;
  if (!cible || cible.readyState !== 1) return Promise.reject(new Error(PAS_CONNECTEE));
  const id = String(++seq);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error('Relève n’a pas répondu à temps.')); }, delai);
    pending.set(id, { resolve, reject, t });
    envoyer(cible, { type: 'call', id, tool, params });
  });
}

// ---- Outils exposés à Claude ----
const server = new McpServer({ name: 'avis-collector', version: '1.1.2' }, {
  instructions: 'Relève rassemble les avis de taxe foncière et de CFE des clients d’un cabinet d’expertise comptable, lus dans l’espace professionnel impots.gouv, et propose une liste de travail. Commencez par « resume » pour une vue d’ensemble. Les montants sont en euros. Les outils ne paient rien, n’envoient aucun message et ne modifient rien sur le site des impôts : les messages et réclamations sont des brouillons que l’utilisateur relit et envoie lui-même. Si les noms sont masqués (« Client 4F2A »), utilisez ces pseudonymes tels quels, sans les modifier. Dans ce cas, dès que votre réponse cite des clients, terminez en appelant « afficher_dans_releve » avec votre réponse complète : l’utilisateur la lit dans Relève avec les vrais noms (ils sont remis sur son poste, vous ne les voyez jamais).',
});
const texte = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }] });
const outil = (name, config, params = (x) => x) => server.registerTool(name, config, async (args) => {
  try { return texte(await appeler(name, params(args || {}))); }
  catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
});
const lecture = { readOnlyHint: true, openWorldHint: false };

outil('resume', { title: 'Vue d’ensemble de la campagne', description: 'Synthèse de la campagne en cours : nombre d’avis, évolution, actions ouvertes par catégorie, créances échues, prochaines dates.', inputSchema: {}, annotations: lecture });
outil('lister_actions', {
  title: 'Liste de travail', description: 'Actions à traiter (paiements à vérifier, clients à prévenir, créances échues, réclamations possibles, hausses à expliquer, prélèvements à proposer, avis à vérifier), les plus urgentes en premier.',
  inputSchema: { categorie: z.string().optional().describe('Filtre sur la catégorie (ex. « paiement », « prévenir », « créance », « réclamation », « hausse », « prélèvement »)'), client: z.string().optional().describe('Nom, SIREN ou pseudonyme'), collaborateur: z.string().optional(), inclure_faites: z.boolean().optional(), limite: z.number().int().min(1).max(300).optional() },
  annotations: lecture,
});
outil('lister_clients', {
  title: 'Clients', description: 'Clients avec avis de l’année : montants de taxe foncière et de CFE, évolution, mode de paiement, communes, actions ouvertes. Filtres et tri.',
  inputSchema: { recherche: z.string().optional(), commune: z.string().optional(), hausse_min_pct: z.number().optional().describe('Ne garder que les hausses supérieures ou égales à ce pourcentage'), tri: z.enum(['montant', 'evolution', 'actions', 'nom']).optional(), limite: z.number().int().min(1).max(500).optional() },
  annotations: lecture,
});
outil('fiche_client', {
  title: 'Fiche client', description: 'Tout sur un client : avis de l’année et de l’an dernier, explication de la hausse (taux votés, bases, biens nouveaux, détail par collectivité), contrôle de la CFE, dettes fiscales, documents à payer, actions et notes.',
  inputSchema: { client: z.string().describe('Nom (ou partie), SIREN ou pseudonyme') }, annotations: lecture,
});
outil('collectivites', {
  title: 'Évolution par collectivité', description: 'Taxe foncière : effet des taux votés, des bases et des biens nouveaux sur le portefeuille, décisions de taux les plus coûteuses, explication commune par commune.',
  inputSchema: { commune: z.string().optional() }, annotations: lecture,
});
outil('preparer_message', {
  title: 'Préparer un message client', description: 'Rédige le message à envoyer au client, regroupant ses points ouverts (paiement, hausse, créance, prélèvement…). Renvoie un brouillon texte ; rien n’est envoyé.',
  inputSchema: { client: z.string(), actions: z.array(z.string()).optional().describe('Identifiants d’actions à inclure (par défaut : toutes les actions « message » ouvertes du client)'), detaille: z.boolean().optional().describe('Ajoute le détail par collectivité') },
  annotations: lecture,
});
outil('preparer_reclamation', {
  title: 'Préparer une réclamation', description: 'Rédige le brouillon de réclamation pour une action de la catégorie « Réclamation possible » (bases de taxe foncière en hausse, base minimum de CFE, CFE l’année de création). À relire et déposer par l’utilisateur.',
  inputSchema: { action: z.string().optional().describe('Identifiant de l’action'), client: z.string().optional() }, annotations: lecture,
});
outil('marquer_actions', {
  title: 'Marquer des actions', description: 'Marque des actions comme faites, à faire ou reportées de 7 jours, et/ou y ajoute une note. Ne modifie rien sur le site des impôts.',
  inputSchema: { actions: z.array(z.string()).min(1), statut: z.enum(['fait', 'a_faire', 'plus_tard']).optional(), note: z.string().max(500).optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});
outil('noter_client', {
  title: 'Ajouter une note client', description: 'Ajoute une note datée dans la fiche du client (appel, accord, pièce reçue…).',
  inputSchema: { client: z.string(), note: z.string().min(1).max(1000) },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
});
outil('ouvrir_dans_releve', {
  title: 'Ouvrir dans Relève', description: 'Ouvre l’application Relève sur une vue (liste, collectivités, calendrier, exports) ou sur la fiche d’un client ; avec vue « message », ouvre la fenêtre de message du client pour créer le brouillon Outlook avec les avis joints.',
  inputSchema: { client: z.string().optional(), vue: z.enum(['liste', 'fiche', 'message', 'collectivites', 'calendrier', 'exports']).optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
});
outil('afficher_dans_releve', {
  title: 'Afficher la réponse avec les vrais noms', description: 'Affiche votre réponse dans Relève (menu Demander › Réponses de Claude), où chaque pseudonyme « Client XXXX » est remplacé par le vrai nom du client, cliquable vers sa fiche. À appeler à la fin de chaque réponse qui cite des clients quand les noms sont masqués. Texte en Markdown simple (titres, listes, gras, tableaux).',
  inputSchema: { titre: z.string().optional().describe('Titre court de la réponse'), texte: z.string().describe('La réponse complète, avec les pseudonymes « Client XXXX » inchangés') },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
});
outil('lancer_mise_a_jour', {
  title: 'Lancer une mise à jour', description: 'Relit les avis dans l’espace professionnel impots.gouv (déjà ouvert et connecté par l’utilisateur). Mode rapide par défaut.',
  inputSchema: { perimetre: z.enum(['portefeuille', 'cabinet']).optional(), complet: z.boolean().optional().describe('Tout relire (plus long)') },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
});
outil('etat_mise_a_jour', { title: 'État de la mise à jour', description: 'Avancement de la mise à jour en cours, ou résultat de la dernière.', inputSchema: {}, annotations: lecture });

demarrer();
await server.connect(new StdioServerTransport());
log('prêt');
const fin = () => { try { wss && wss.close(); } catch {} process.exit(0); };
process.stdin.on('close', fin);
process.on('SIGTERM', fin);
