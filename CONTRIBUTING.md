# Contribuer à Relève

Merci de votre intérêt ! Relève est un outil fait par et pour des cabinets d'expertise comptable. Toute amélioration est bienvenue, à condition de respecter quelques règles.

## Règles non négociables

Une contribution qui ne respecte pas l'une de ces règles sera refusée, quel que soit son intérêt par ailleurs.

1. **Aucun identifiant.** Le code ne lit, ne saisit, ne demande ni ne stocke jamais d'identifiant, de mot de passe ou de captcha, ni ceux du cabinet ni ceux d'un client. L'utilisateur se connecte lui-même.
2. **Lecture seule sur impots.gouv.** Aucun paiement, aucune adhésion, aucune déclaration, aucune réclamation déposée, aucune modification d'habilitation ou de délégation, aucun message. La messagerie sécurisée n'est jamais ouverte. Seules des requêtes de consultation sont rejouées ; les seuls formulaires envoyés sont des filtres d'affichage.
3. **Données sur le poste.** Les données des clients restent dans le navigateur de l'utilisateur. Aucun envoi vers un serveur tiers, aucune mesure d'audience, aucun traceur. Toute connexion facultative à un service externe (comme la connexion à Claude) est désactivée par défaut, clairement signalée, et proposée avec une option de pseudonymisation.
4. **Brouillons seulement.** Les messages aux clients et les réclamations sont des brouillons que l'utilisateur relit et envoie lui-même.
5. **Pas d'imitation de la DGFiP.** Ni nom, ni logo, ni couleurs, ni présentation qui laisseraient croire à un outil officiel.
6. **Prudence avec le site.** Pas de rafales de requêtes : le rythme actuel (pauses entre dossiers, pages lues en petits lots) a été mesuré pour ne pas charger l'espace professionnel.

## Proposer une amélioration

1. Ouvrez d'abord une *issue* (modèle « Idée ») pour en discuter, surtout si le changement touche la lecture du site (`lib/core.js`, `content.js`).
2. Faites un *fork*, créez une branche, puis proposez une *pull request* courte et ciblée.
3. Décrivez ce que vous avez testé et comment (voir ci-dessous).

## Tester

- Chargez le dossier `extension/` dans `chrome://extensions` (Mode développeur, « Charger l'extension non empaquetée »).
- Après une modification de `lib/core.js` ou `content.js` : `python3 build.py` dans `extension/`, puis « Recharger ».
- Testez sur un ou deux dossiers réels, avec votre propre session, avant toute lecture complète. Vérifiez dans Réglages › Données que les nombres d'avis et de PDF sont cohérents, et qu'aucun avis n'apparaît en « Avis à vérifier » sans raison.
- **Ne publiez jamais de données réelles** : pas de captures d'écran, de PDF, de SIREN ou de noms de clients dans une issue ou une pull request. Utilisez des données fictives.

## Style

- Pas de dépendance externe ni d'étape de compilation : du JavaScript lisible, directement chargeable par le navigateur.
- Textes de l'interface en français clair, sans jargon technique, en phrases complètes.
- Les fonctions d'analyse (`lib/analyse.js`, `lib/recherche.js`) restent pures : pas d'accès au DOM ni au réseau.

## Licence des contributions

En proposant une contribution, vous acceptez qu'elle soit distribuée sous la licence du projet, l'EUPL 1.2.
