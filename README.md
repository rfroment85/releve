# Relève

Extension Chrome / Edge pour les cabinets d'expertise comptable. Elle lit dans l'**espace professionnel impots.gouv** (déjà ouvert et connecté par l'utilisateur) les avis de **taxe foncière** et de **CFE** de tous les dossiers, années N et N-1. Elle les analyse **sur le poste** et produit une liste de travail triée par urgence :

- paiements à vérifier et clients à prévenir ;
- créances échues ;
- réclamations possibles ;
- hausses expliquées (effet des taux, effet des bases, biens nouveaux) ;
- prélèvements à proposer.

Depuis la version 6, elle contrôle la **valeur locative des locaux professionnels** : lecture de la fiche de chaque local dans « Gérer mes biens immobiliers », recalcul de la base au tarif de la grille départementale (paramètres DGFiP des 101 départements embarqués), reconstitution du planchonnement depuis l'avis, signaux d'alerte (catégorie, surfaces, occupant, classement hôtelier), simulation et gain estimé. Elle lit aussi au cadastre (Géoplateforme IGN, référence de parcelle seule transmise) la surface de la parcelle et l'emprise du bâti pour repérer des surfaces déclarées incohérentes. Démarche détaillée : https://releveavis.netlify.app/valeur-locative.html

Elle propose aussi une vue des **habilitations** de l'espace (qui a accès à quel service, sur quel dossier, et ce qui manque) et le suivi des **clients à raccorder** (clients absents de l'espace du cabinet, avec un message prêt pour leur demander l'accès).

Version : 6.0.0 · Licence : [EUPL 1.2](LICENSE) · Outil indépendant, non affilié à la DGFiP.

## Version officielle

- Site, téléchargement et mode d'emploi pour les utilisateurs : **https://releveavis.netlify.app**
- Identifiant de l'extension officielle : `ifobkhlejligkpamefibhakpolcnbdcl` (visible dans `chrome://extensions`).
- Une copie obtenue ailleurs, ou portant un autre identifiant, n'est pas la version officielle : elle peut avoir été modifiée. N'installez une version modifiée que si vous en avez relu le code.

---

## Règles de conception (à respecter dans toute modification)

- **L'utilisateur se connecte lui-même.** Le code ne lit, ne saisit ni ne stocke jamais d'identifiant, de mot de passe ou de captcha.
- **Lecture seule sur impots.gouv.** Aucun paiement, aucune adhésion, aucun dépôt de réclamation, aucune déclaration, aucun message. La messagerie sécurisée n'est jamais ouverte. Dans « Gérer mes biens immobiliers », seules la liste des biens et la page « Consulter un bien » sont lues. Hors impots.gouv, deux échanges réseau seulement : le fichier de version sur releveavis.netlify.app, et la Géoplateforme de l'IGN (data.geopf.fr) pour le cadastre, avec la seule référence de parcelle.
- **Documents à payer (SATELIT).** La lecture s'arrête à la liste ; toute autre étape est refusée dans `lib/core.js` (`getAmr`).
- **Mails et réclamations.** Ce sont uniquement des brouillons locaux (`.eml`, texte), que l'utilisateur relit et envoie lui-même.
- **Données sur le poste uniquement** (IndexedDB de l'extension).
  - Seul appel réseau hors impots.gouv : `version.json` du site, au plus toutes les 6 h, sans aucune donnée envoyée.
  - La connexion à Claude est facultative, désactivée par défaut. Mode « noms masqués » : Claude ne voit que des pseudonymes.
- **Aucune imitation de la DGFiP** : nom, logo, couleurs.

---

## Contenu du dépôt

```
extension/            Extension Chrome / Edge (Manifest V3), sans dépendance ni étape de compilation
  manifest.json       permissions : sidePanel, storage, unlimitedStorage, scripting, alarms, notifications
                      hôte : https://cfspro.impots.gouv.fr/* uniquement
  background.js       service d'arrière-plan : stockage, état des mises à jour, pastille, alertes
  content.js          orchestration de la collecte dans l'onglet impots.gouv
  content.bundle.js   = lib/pdftext.js + lib/avistf.js + lib/core.js + content.js, généré par build.py (c'est lui qui est chargé)
  build.py            régénère content.bundle.js après modification de ces fichiers
  sidepanel.*         volet latéral
  app.*               application complète (À traiter, Demander, Clients, fiche, Collectivités,
                      Calendrier, Exports, Réglages)
  ui.css              styles communs (thème : variables --accent*)
  lib/core.js         moteur de lecture du site : jeton CSRF, liste des dossiers, sélection,
                      tableaux PrimeFaces, PDF, dettes fiscales, documents à payer, lecture des PDF
  lib/analyse.js      rapprochement N / N-1, décomposition des hausses, contrôle CFE,
                      liste de travail, collectivités (fonctions pures)
  lib/messages.js     textes des messages clients et des réclamations
  lib/files.js        ZIP, classeur Excel (xlsx écrit à la main), .eml, import CSV / xlsx
  lib/recherche.js    « Demander » : questions prêtes, filtres, rendu des réponses de Claude
                      (Habilitations et Clients à raccorder : dans app.js ; lecture dans lib/core.js, getHabilitations)
  lib/pdftext.js      extraction du texte des PDF (partagée collecte / application)
  lib/avistf.js       détail par adresse des avis de taxe foncière (base, cotisation, cotisation lissée)
  lib/vl.js           valeur locative des locaux professionnels : calcul, reconstitution de l'ancienne valeur
                      locative, signaux, simulation, analyse du portefeuille (fonctions pures + données)
  lib/cadastre.js     cadastre (IGN, WFS public) : surface de parcelle, emprise au sol et niveaux du bâti ; magasin « cadastre »
  vlui.js             page « Valeur locative », bloc de la fiche client, simulateur, brouillons, export, relecture des avis
  data/rvllp/         paramètres d'évaluation de chaque département (JSON) : tarifs 2025 et 2026, secteurs par
                      section cadastrale, coefficients de localisation 2024 et 2026, coefficients de neutralisation.
                      Source : https://www.impots.gouv.fr/portail/node/11406 (voir docs/ETAT.md)
  lib/db.js           IndexedDB (nom technique « avis-collector », à ne pas changer ; version 3 depuis la 6.0 : magasins « biens » et « cadastre »)
  lib/mcp.js          passerelle vers le connecteur Claude (outils exposés à Claude)
  lib/update.js       vérification de version
  lib/icons.js        icônes SVG

connecteur-claude/    Connecteur MCP local pour l'application Claude (paquet .mcpb)
  server/index.js     stdio (Claude) <-> WebSocket 127.0.0.1:47831 (extension)
  manifest.json       manifeste MCPB

site/                 Site statique (Netlify) : accueil, mode d'emploi, confidentialité, version.json

docs/ETAT.md          État détaillé de l'outil, règles d'analyse, historique, points ouverts
```

---

## Installer depuis les sources

1. Ouvrir `chrome://extensions` (ou `edge://extensions`) et activer le **Mode développeur**.
2. Cliquer sur **Charger l'extension non empaquetée** et choisir le dossier `extension/`.
3. Ouvrir l'espace professionnel impots.gouv, se connecter, puis cliquer sur l'icône Relève.

Après une modification de `lib/core.js`, `content.js`, `lib/pdftext.js` ou `lib/avistf.js` : lancer `python3 build.py` dans `extension/`, puis cliquer sur « Recharger » dans `chrome://extensions`. Aucun fichier ni dossier dont le nom commence par `_` dans `extension/` : Chrome refuserait de charger l'extension.

### Identifiant d'extension

La clé publique inscrite dans `manifest.json` (champ `key`) fixe l'identifiant `ifobkhlejligkpamefibhakpolcnbdcl`. C'est grâce à lui que les données sont conservées d'une mise à jour à l'autre, et que le connecteur Claude reconnaît l'extension.

- La clé privée correspondante n'est pas dans ce dépôt ; elle n'est pas nécessaire pour un chargement non empaqueté.
- Si vous diffusez votre propre version modifiée :
  - remplacez ou supprimez le champ `key`, pour ne pas entrer en conflit avec Relève sur un même poste ;
  - mettez à jour l'origine autorisée du connecteur (`AC_ORIGINS` dans `server/index.js`).
- **Ne jamais demander de supprimer l'extension ni de charger un autre dossier pour une mise à jour** : cela efface les données locales. Prévoir une sauvegarde : Réglages › Sauvegarde.

---

## Connecteur Claude

```
cd connecteur-claude
npm ci
npx @anthropic-ai/mcpb pack . Releve-Claude.mcpb
```

- Node 18 ou plus récent.
- Le connecteur n'accepte que l'origine de l'extension et écoute seulement sur 127.0.0.1.
- Si plusieurs exemplaires tournent, le premier est le principal et les autres passent en relais.

---

## Publier une nouvelle version

1. Incrémenter `version` dans `extension/manifest.json`.
2. `python3 build.py`, puis zipper le dossier sous le nom `Releve/` dans `site/Releve.zip`.
3. Mettre à jour `site/version.json` (version, notes) et le numéro affiché dans `site/index.html`.
4. Déployer le dossier `site/` (Netlify : glisser-déposer).
5. Si l'adresse du site change : publier d'abord une version dont `lib/update.js` pointe vers la nouvelle adresse, puis seulement changer l'adresse.

---

## Tests

Les tests ont été faits avec Playwright, sur une copie simulée de l'espace professionnel alimentée par de vrais avis. Ces jeux de données contiennent des informations de clients : ils ne sont pas inclus.

Pour tester une modification du moteur de lecture :

- utiliser un ou deux dossiers réels, avec sa propre session ;
- vérifier dans Réglages › Données que le nombre d'avis et de PDF est cohérent.

---

## Auteur

Relève est créé par **Romain Froment**, expert-comptable dans le Var : [LinkedIn](https://www.linkedin.com/in/romain-froment-expert-comptable-var/).

## Contribuer

Les contributions sont bienvenues : corrections, nouvelles analyses, adaptation à d'autres logiciels comptables, traductions du vocabulaire, tests. Lisez d'abord [CONTRIBUTING.md](CONTRIBUTING.md) : les règles de conception ci-dessus sont non négociables.

Une faille de sécurité se signale en privé, jamais dans une issue publique : voir [SECURITY.md](SECURITY.md).

## Licence

Copyright © 2026 Romain Froment.

Relève est distribué sous la **Licence publique de l'Union européenne (EUPL) v. 1.2** : vous pouvez l'utiliser, l'étudier, le modifier et le redistribuer ; une version modifiée que vous distribuez doit rester sous EUPL (ou une licence compatible listée par l'EUPL) et son code source doit être accessible. Texte complet (version anglaise, qui fait foi au même titre que les autres langues) : [LICENSE](LICENSE) ; versions officielles dans toutes les langues de l'UE, dont le français : https://interoperable-europe.ec.europa.eu/collection/eupl/eupl-text-eupl-12

Le logiciel est fourni « en l'état », sans garantie (articles 7 et 8 de l'EUPL). Chaque utilisateur vérifie les informations auprès des avis officiels et reste responsable de son usage de l'espace professionnel impots.gouv.

**Nom et logo.** La licence porte sur le code, pas sur le nom « Relève » ni sur son logo. Une version modifiée que vous distribuez doit porter un autre nom et un autre identifiant d'extension (voir « Identifiant d'extension » ci-dessus), pour qu'aucun utilisateur ne la confonde avec la version officielle.
