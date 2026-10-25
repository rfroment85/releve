# Relève — description détaillée (version 5.2.2)

Anciennement « Avis Collector ». Extension Chrome / Edge qui lit dans l'espace professionnel impots.gouv les avis de **taxe foncière** et de **CFE** de tous les clients du cabinet (N et N-1), les analyse sur le poste et en tire une **liste de travail triée par urgence**.

- Site, mode d'emploi, téléchargement : https://releveavis.netlify.app
- Fichiers : `Releve.zip` (extension), `Releve-Claude.mcpb` (connecteur Claude, facultatif)
- Projet Netlify : `releveavis` (déploiement par glisser-déposer du dossier du site)

---

## 1. Ce que fait l'outil

### Volet latéral (à côté d'impots.gouv)
- Détecte l'espace professionnel et la session. L'utilisateur se connecte lui-même.
- Bouton « Mettre à jour mes clients », pour son portefeuille ou tout le cabinet. Mode rapide par défaut, lien « Tout relire ».
- Pendant la lecture : progression, temps restant, avis repérés, pause.
- À la fin : actions par catégorie, temps économisé, bouton « Ouvrir en grand ». Le logo ouvre aussi l'application.

### Application (onglet « Ouvrir en grand »)
- **À traiter.** Actions triées par urgence. Pour chaque action :
  - action principale ;
  - « fait » et « plus tard » ;
  - note ;
  - icônes pour ouvrir l'avis PDF ou le dossier sur impots.gouv.

  On peut aussi en sélectionner plusieurs pour préparer un brouillon par client.

  Les catégories :

  | Catégorie | Règle |
  |---|---|
  | Paiement à vérifier | sans prélèvement, échéance passée |
  | À prévenir avant l'échéance | sans prélèvement, échéance à venir |
  | Créance échue | dettes fiscales non soldées (seuil 5 €) et avis de mise en recouvrement à payer |
  | Réclamation possible | bases TF en hausse de plus de 3 %, base minimum CFE contestable, CFE l'année de création |
  | Hausse à expliquer | hausse votée par les collectivités (au-delà de 10 % et 100 €) |
  | Prélèvement à proposer | ni prélevé ni mensualisé en N-1 et en N |
  | Avis à vérifier | écart PDF / site, première année d'imposition |

- **Demander.**
  - Questions prêtes en un clic : à prévenir sous 7 jours, paiements à vérifier, créances échues, réclamations possibles, hausses à expliquer, plus fortes hausses, prélèvement à proposer, plus gros contribuables, bilan.
  - Filtres : taxe, commune, collaborateur, échéance, montant mini, tri.
  - Résultats exacts, calculés sur le poste, sans IA.
  - Onglet **Réponses de Claude** : les réponses envoyées par Claude, où les pseudonymes sont remplacés par les vrais noms sur le poste. Une case permet de coller une réponse à la main.
- **Clients.** Tableau triable : TF, CFE, évolution, mode de paiement, actions et créances.
- **Fiche client.**
  - Décomposition de chaque hausse : effet des taux, effet des bases, biens nouvellement imposés, frais.
  - Tableau par collectivité, historique, dettes, contrôle CFE, notes.
  - Message, réclamation, lien vers impots.gouv.
- **Collectivités.** Totaux du portefeuille, décisions de taux regroupées, explication commune par commune.
- **Calendrier** des échéances.
- **Exports.**
  - Classeur Excel de la campagne.
  - ZIP des PDF.
  - Brouillons .eml regroupés par client.
  - Synthèse imprimable pour l'associé.
- **Réglages.**
  - Fichier des dossiers (codes, collaborateurs, e-mails), « Je suis », portefeuille.
  - Seuils, signature, rythme de lecture.
  - Import des chiffres d'affaires pour le contrôle CFE.
  - Alertes et bandeau.
  - Connexion à Claude.
  - **Sauvegarde / restauration**.
  - Effacement des données.

### Sur impots.gouv
- Petit bandeau discret indiquant les actions en attente pour le dossier affiché (désactivable).
- Alertes Chrome :
  - échéances à J-7 et J-1 ;
  - avis de solde CFE attendus ;
  - fin d'une longue mise à jour.

### Messages et réclamations
- **Brouillons de mail .eml** : un par client, regroupant tous ses points, avec les avis joints, en version courte ou détaillée. L'utilisateur relit et envoie lui-même depuis Outlook.
- **Brouillons de réclamation chiffrés** (bases TF, base minimum CFE, création) : l'utilisateur les relit, les complète et les dépose lui-même par la messagerie sécurisée.

### Habilitations et clients à raccorder (depuis 5.2)
- **Habilitations** : lecture à la demande de « Gérer mon espace › Consulter mes services » (une page qui liste tous les couples SIREN × service du compte connecté, puis la même page filtrée par rôle et par état, bouton « Filtrer » uniquement). Environ 30 s pour un millier de dossiers. Vue par dossier, décompte par service (avec / sans), liste des dossiers **sans** un service (jamais attribué, supprimé, en veille), export de la sélection et matrice dossiers × services.
- **Clients à raccorder** : comparaison du fichier des dossiers du cabinet avec l'espace ; message au client pour qu'il désigne le cabinet comme administrateur suppléant (avec le numéro d'abonné du cabinet, lu automatiquement) ; suivi demandé / à relancer à 7 jours / raccordé automatiquement.
- **Fiabilité des PDF (5.1.1)** : chaque PDF est contrôlé (référence ou SIREN) ; un PDF d'un autre dossier est retéléchargé, et jamais conservé.

---

## 2. Règles de sécurité et de confidentialité (non négociables)

- L'utilisateur se connecte lui-même. L'outil ne lit ni ne saisit jamais d'identifiant, de mot de passe ou de captcha.
- **Lecture seule** sur impots.gouv : aucun paiement, aucune adhésion, aucune réclamation déposée, aucun message.
- La messagerie sécurisée n'est jamais touchée.
- La lecture des documents à payer (SATELIT) s'arrête à la liste et refuse toute autre étape.
- Les mails sont des brouillons locaux, jamais envoyés.
- Les données restent sur le poste (IndexedDB de l'extension).
- Seul échange réseau hors impots.gouv : lecture de `version.json` sur le site, toutes les 6 h, sans aucune donnée envoyée.
- La connexion à Claude est facultative, désactivée par défaut, avec avertissement. Mode « noms masqués » : Claude ne voit que « Client 4F2A ».
- Rien qui imite la DGFiP. L'outil est présenté comme indépendant et non affilié.

---

## 3. Installer, mettre à jour, sauvegarder

- **Installer** :
  1. Décompresser `Releve.zip` dans Documents.
  2. Ouvrir `chrome://extensions` et activer le Mode développeur.
  3. Cliquer sur « Charger l'extension non empaquetée » et choisir `Documents › Releve`.
  4. Épingler l'icône bleue.
- **Mettre à jour** :
  1. Le bandeau « Nouvelle version » apparaît.
  2. Télécharger la nouvelle version et remplacer le contenu du dossier `Releve`.
  3. Cliquer sur la flèche « Recharger » de la carte Relève.
- **Pour les mises à jour, ne jamais** « Supprimer » la carte, ni charger un autre dossier : les données seraient perdues.
- **Sauvegarder** :
  - « Sauvegarder mes données » (Réglages › Sauvegarde) crée un fichier `Releve-sauvegarde-AAAA-MM-JJ.json`.
  - Il contient : actions faites ou reportées, notes, réglages, fichier des dossiers, chiffres d'affaires, réponses de Claude. Les avis n'y sont pas : ils se relisent.
  - La restauration ajoute le contenu sans rien effacer et sans doublons.
  - Un rappel apparaît si au moins 10 actions ont été traitées sans sauvegarde depuis 30 jours.
- Le fichier de sauvegarde contient des noms de clients : il faut le ranger comme un document client.

---

## 4. Connexion à Claude (facultative)

- Connecteur local `Releve-Claude.mcpb`, version 1.1.1, à installer dans l'application Claude.
- Il communique avec l'extension par `127.0.0.1:47831` ; seule l'extension Relève est acceptée.
- Il gère plusieurs exemplaires du connecteur (un principal, les autres en relais).
- Activation : Réglages › Connexion à Claude, puis cocher « Masquer les noms et SIREN ».
- Outils disponibles :
  - `resume`, `lister_actions`, `lister_clients`, `fiche_client`, `collectivites` ;
  - `preparer_message`, `preparer_reclamation`, `marquer_actions`, `noter_client` ;
  - `ouvrir_dans_releve`, `afficher_dans_releve` ;
  - `lancer_mise_a_jour`, `etat_mise_a_jour`.
- En mode masqué, Claude envoie sa réponse dans Relève (Demander › Réponses de Claude), où les vrais noms sont remis sur le poste.
- Abandonné après essai, car pas assez fiable : l'IA intégrée à Chrome (Gemini Nano) et la compréhension des questions par mots-clés. Écartée pour son coût : l'API Claude intégrée dans l'outil.

---

## 5. Règles d'analyse

- **Effet des taux** = cotisation N-1 × (taux N / taux N-1 − 1). **Effet des bases** = le reste, hors biens nouveaux et frais.
- **Bases TF en hausse de plus de 3 %** (au-delà de la revalorisation) : réclamation possible jusqu'au 31/12/N+1 (art. R*196-2 LPF).
- **Contrôle CFE**, à partir des chiffres d'affaires importés (exercice clos en N-2, ramené à 12 mois) :
  - CA ≤ 5 000 € : exonération de la cotisation minimum.
  - Base minimum au-dessus du plafond légal de la tranche. Barème 2026 (art. 1647 D) : 597 / 1 194 / 2 509 / 4 183 / 5 974 / 7 769 € pour un CA ≤ 10 000 / 32 600 / 100 000 / 250 000 / 500 000 / au-delà.
  - Création (art. 1478 II) : pas de CFE l'année de création ; réduction de moitié la première année d'imposition (signalée pour information).
- **Seuils par défaut** : hausse à signaler à partir de 10 % et 100 € ; créances ignorées sous 5 €.
- **Mise à jour rapide** :
  - parties lues il y a moins de 20 h ignorées ;
  - impôt sans avis relu seulement pendant les périodes de publication (TF : août–octobre ; CFE : mai–juin et 20 octobre–décembre), ou tous les 30 jours ;
  - dettes relues après 20 h ;
  - documents à payer relus chaque semaine.
- **Temps mesurés sur le vrai site** : environ 1,3 s par dossier en lecture complète, environ 0,3 s en mode rapide. Une première lecture d'environ 900 dossiers avec les PDF prend 30 à 40 minutes.

---

## 6. Technique (à ne pas modifier sans précaution)

- **Identifiant d'extension fixe** : `ifobkhlejligkpamefibhakpolcnbdcl` (clé dans le manifeste). Le connecteur Claude n'accepte que cet identifiant.
- **Base de données locale** : IndexedDB `avis-collector`. Ce nom technique est conservé volontairement.
- **Nom du dossier d'installation** : `Releve`. **Ne plus le changer.**
- **Adresse de vérification des mises à jour** : `https://releveavis.netlify.app/version.json`. Si l'adresse du site change, il faut d'abord publier une version qui pointe vers la nouvelle adresse, puis seulement renommer.
- **Sources de l'extension** (dans la session de travail) :
  - `manifest.json`, `background.js`, `content.js` + `lib/core.js` (assemblés par `build.py` en `content.bundle.js`) ;
  - `sidepanel.*`, `app.*`, `ui.css` ;
  - `lib/` : db, analyse, messages, files, recherche, mcp, update, icons.
- **Connecteur** : Node, `@modelcontextprotocol/sdk` 1.32.1, `ws` 8.22.0, `zod` 4.6.5. Empaqueté avec `mcpb pack`. Son identifiant interne reste « avis-collector », ce qui permet de l'installer par-dessus l'ancien.
- **Publier une nouvelle version** :
  1. Incrémenter la version dans le manifeste.
  2. Régénérer `Releve.zip` (dossier `Releve/`).
  3. Mettre à jour `version.json` et le numéro affiché sur la page d'accueil.
  4. Redéposer le dossier du site sur Netlify.

---

## 7. Historique résumé

| Version | Apport |
|---|---|
| v1 – v3.2 | Script navigateur (Tampermonkey), tableau de bord HTML, classeur Excel, page Collectivités, lecture fiable du détail TF (216/216 avis cohérents) |
| 4.0 | Extension Chrome / Edge, volet latéral, liste de travail, données sur le poste |
| 4.0.1 | Distribution sans boutique, identifiant fixe, bandeau de mise à jour, site et mode d'emploi |
| 4.0.2 | Créances au centime, seuil 5 €, avis de mise en recouvrement (SATELIT), gestion de la session expirée |
| 4.1 | Message groupé par client, notes, prélèvement à proposer, contrôle CFE, réclamations, lien impots.gouv, bandeau, alertes |
| 4.1.1 | Collecte environ 2 fois plus rapide, mise à jour rapide |
| 4.2 | Connecteur Claude (MCP), noms masqués, relais multi-instances, reconnexion espacée |
| 4.3 → 4.4 | Essai de l'IA de Chrome (abandonné), puis Demander : questions prêtes, filtres et réponses de Claude avec les vrais noms |
| 4.4.1 | « Ouvrir en grand » et logo cliquable |
| 4.5 | Thème bleu foncé, mise en page pour écrans étroits |
| 4.6 | Animations discrètes, réglage « réduire les animations » respecté, correction du premier clic perdu |
| 5.0 / 5.0.1 | Renommage en **Relève**, nouveau site releveavis.netlify.app |
| 5.1 | **Sauvegarde et restauration** |

---

## 8. Incident et leçon

Lors du passage d'Avis Collector à Relève (changement de dossier d'installation), les données locales ont été effacées. Le test préalable passait par une autre voie que la manipulation réelle dans Chrome. Il a fallu une relecture complète, et les actions marquées faites et les notes ont été perdues.

Mesures prises :
- ajout de la sauvegarde et de la restauration ;
- règle : ne plus jamais changer le nom du dossier ni l'identifiant ;
- toujours sauvegarder avant une réinstallation ou un changement de poste.

---

## 9. Pistes

- Contrôle de tranche de base minimum CFE sous le plafond : nécessite les délibérations communales (fichier REI).
- « Qui d'autre a accès » à un dossier (droits d'accès par service), consultable dossier par dossier.
- Mode « espace d'un client » : lecture ponctuelle de l'espace d'une entreprise ouvert par l'utilisateur lui-même (sans jamais gérer ses identifiants).
- Import direct des exports des principaux logiciels comptables (fichier des dossiers, chiffres d'affaires).
