# Odin & Rummikub

Jeux multijoueurs privés en français, avec photos personnalisables et classements Elo séparés. Client Vite/TypeScript et serveur NestJS/Socket.IO.

## Démarrer

Node.js 22.12+ (ou Node 24) et npm.

```sh
cd server
npm ci
npm run start:dev
```

Dans un second terminal :

```sh
cd client
npm ci
npm run dev
```

Ouvrir http://localhost:5173. Le client utilise `VITE_SERVER_URL` (http://localhost:3000 en développement ; origine courante sinon). Copier `client/.env.example` en `.env` pour le configurer.

Choisir le jeu, entrer son pseudo, créer une salle puis copier l’invitation. Le partenaire peut rejoindre depuis le lien ou le code. Deux navigateurs/profils distincts sont nécessaires pour simuler deux personnes : ouvrir deux onglets du même profil transfère la session au dernier onglet.

## Mot de passe du site

Sur Railway, définir **`SITE_PASSWORD` sur `Odin-Server`** puis redéployer le serveur. Le navigateur demande ce mot de passe avant d’afficher les jeux. L’accès est vérifié côté serveur avant toute connexion Socket.IO ; le mot de passe ne figure jamais dans le code client. Ne pas créer de variable `VITE_SITE_PASSWORD`.

Après connexion, seul un jeton d’accès signé est conservé dans ce navigateur pendant 30 jours. Un refresh ou un redémarrage ne redemande pas le mot de passe. Modifier `SITE_PASSWORD` invalide les accès précédents et demande une nouvelle connexion. La clé de signature est enregistrée dans le volume persistant (`/data/access-secret`). Le mot de passe n’est jamais écrit dans les sauvegardes.

Sans variable `SITE_PASSWORD`, l’accès reste ouvert pour le développement local. Le mot de passe protège les parties, les photos de salle et les classements ; les ressources statiques du client (dont les images d’origine déjà publiques) restent servies par le service web.

Les codes de salle comportent exactement **quatre chiffres**, zéros initiaux compris (ex. `0042`). Le mot de passe est commun au site ; le pseudo et la session de jeu restent individuels.

## Connexion et sauvegarde

Une clé de session aléatoire est conservée dans le stockage local du navigateur ; seul son hash est sauvegardé côté serveur. Ne partagez pas cette clé. Un refresh, une coupure réseau ou une fermeture d’onglet ne fait pas quitter la salle. La reconnexion restitue la main, les scores et le tour. Le brouillon Rummikub est conservé par onglet dans `sessionStorage` et restauré seulement si la table et la main correspondent toujours.

Les salles, profils, photos et classements sont sauvegardés après chaque action par remplacement atomique de `games.json`, dans `DATA_DIR`, sinon `RAILWAY_VOLUME_MOUNT_PATH`, sinon `server/data`. Une sauvegarde illisible bloque le démarrage au lieu de l’écraser. Une salle inactive est conservée sept jours. Les profils et classements restent conservés. Faites des sauvegardes du volume ; le fichier contient les mains privées et doit rester hors Git et hors des fichiers web publics.

Le rôle d’hôte est conservé pendant un refresh. Après 30 secondes de déconnexion de l’hôte, un autre joueur peut reprendre ce rôle explicitement. L’hôte peut retirer un joueur déconnecté (abandon). Quitter volontairement une partie en cours est également un abandon. Quand tout le monde est déconnecté, le chronomètre Rummikub est suspendu. À la reconnexion le temps restant reprend. Si un seul joueur se déconnecte, le chronomètre continue pour ne pas bloquer les autres.

## Gameplay

### Odin (2 à 6)

9 cartes par personne. Une couleur supplémentaire est activée si nécessaire pour disposer d’assez de cartes. À deux, deux couleurs sont retirées avec un minimum de quatre. Même couleur ou valeur ; même nombre de cartes que la combinaison précédente, ou une de plus ; valeur strictement supérieure. Après une pose, une carte précédente est reprise sauf si la main est vidée. Un passage n’exclut pas du pli. Tous les autres passages relancent avec le dernier joueur à avoir posé. Une main monochrome ou de même valeur à l’ouverture d’un pli termine automatiquement la manche.

Les résultats de manche sont affichés avant que l’hôte lance la suivante. Le plus petit score gagne dès qu’une personne atteint la limite (15 par défaut).

### Rummikub (2 à 4)

106 tuiles, 14 par joueur. Groupes de 3 ou 4 couleurs différentes ; suites ordonnées de 3 à 13 tuiles de même couleur ; pas de 13–1. Première pose d’au moins 30 points venant exclusivement du chevalet ; manipulation de la table à partir du tour suivant. Les jokers prennent la valeur de leur position et doivent rester sur la table lorsqu’ils sont libérés.

Sélectionner les tuiles puis cliquer sur **Nouvelle combinaison** ou un **+** à une position d’un groupe. Le glisser-déposer est également disponible. On peut réordonner, scinder et fusionner librement après l’ouverture. Pour reprendre une tuile jouée dans ce brouillon, la sélectionner puis cliquer sur la zone vide du chevalet (ou la faire glisser). Les anciennes tuiles de table ne peuvent jamais être reprises. **Annuler** et **Tout rétablir** n’affectent pas le serveur. **Valider le tour** soumet la table entière : le serveur vérifie les combinaisons, l’origine et l’unicité des tuiles et la première pose avant de modifier quoi que ce soit. Une action refusée conserve le brouillon.

Piocher termine immédiatement le tour. Chronomètre configurable : 60 secondes, 120 secondes ou sans limite. À expiration, le brouillon non validé est abandonné, le serveur pioche une tuile et passe le tour. En cas de pioche vide, une ronde complète de passages termine la partie : le plus petit total en main gagne. Les jokers valent 30 points en main. Le gagnant reçoit la somme des pénalités, ou des différences si la partie est bloquée. Les ex æquo se partagent les gains.

Référence : [règles classiques officielles](https://rummikub.com/rules/). Les mécaniques classiques sont implémentées ; les variantes internes, monnaies et modes commerciaux de rummikub-apps.com ne sont pas reproduits.

### Photos et classement

L’éditeur **Photos** est réservé au propriétaire. Dans Railway, définir **`ADMIN_PASSWORD` sur `Odin-Server`**, distinct du mot de passe partagé `SITE_PASSWORD`. Depuis l’accueil, cliquer sur le petit bouton **⚙ en bas à droite**, puis saisir ce mot de passe. L’éditeur de personnalisation s’ouvre directement. L’accès est mémorisé dans ce navigateur. Le serveur vérifie le droit administrateur à chaque enregistrement, y compris si un joueur tente d’appeler directement les événements réseau. Un hôte ordinaire ne peut pas modifier les photos. Sans `ADMIN_PASSWORD`, l’éditeur reste désactivé pour tout le monde.

L’éditeur propose les onglets **Odin**, **Rummikub** et **Fond d’écran**. Chaque numéro de Rummikub peut recevoir sa propre photo, indépendamment d’Odin. Importer jusqu’à 9 photos pour Odin ou 13 pour Rummikub en une sélection, ou déposer les fichiers dans l’éditeur. Les noms commençant par un numéro (ex. `01.jpg`, `13-vacances.png`) sont associés au numéro correspondant ; sinon l’ordre de sélection est utilisé. Cliquer sur une photo pour la remplacer, la déplacer par glisser-déposer ou avec les flèches, puis **Enregistrer**. **Photos d’origine** et **Annuler les changements** permettent de rétablir la sélection avant enregistrement.

Les photos et le fond sont compressés localement puis enregistrés sur le volume serveur. Le fond s’applique à toute l’application. Toutes les salles et tous les joueurs reprennent les modifications. L’administrateur peut aussi les modifier pendant une partie ; tous les joueurs reçoivent les nouvelles images, sans toucher aux mains ni au tour en cours. En l’absence de photo dédiée, Rummikub reprend les photos existantes d’Odin ; les valeurs 10–13 reprennent les photos 1–4 si nécessaire. Chaque joueur peut masquer les photos pour privilégier la lisibilité.

Classement Elo par jeu (1000 au départ, facteur 32, moyenne des confrontations en multijoueur), parties jouées, victoires et ex æquo. Une partie terminée est comptée une seule fois ; un abandon avant toute action jouée ne fait pas gagner d’Elo. Le profil dépend de ce navigateur, sans compte ni synchronisation entre appareils. Effacer le stockage local crée un nouveau profil. Ce classement convient à un cercle d’amis, pas à une compétition avec identités vérifiées.

## Railway existant

Le projet **Odin Nono** possède deux services GitHub : `Odin-Client` (`/client`) et `Odin-Server` (`/server`). Conserver cette structure.

1. Monter un **volume persistant** sur `Odin-Server` à `/data`. Le serveur détecte `RAILWAY_VOLUME_MOUNT_PATH` automatiquement, ou définir `DATA_DIR=/data`.
2. Conserver **une seule instance serveur** : la sauvegarde est conçue pour un processus. Plusieurs instances demanderaient une base partagée et un adaptateur Socket.IO.
3. Client : `VITE_SERVER_URL=https://odin-server-production.up.railway.app` (variable de build). Ne pas déployer le `.env` local.
4. Serveur : `PORT=3000`, build `npm run build`, démarrage `npm run start:prod`, healthcheck `/health`. Le fichier `server/railway.json` fournit les commandes.
5. La veille Railway peut rester activée avec un volume : au réveil, les parties sont rechargées ; une première connexion peut demander quelques secondes. Désactiver la veille si un démarrage immédiat est souhaité.
6. Déployer les deux services depuis le même commit. L’ancien client n’utilise pas le nouveau protocole de session ; inviter les joueurs à rafraîchir la page après la mise à jour.

Le correctif de refresh fonctionne tant que le processus vit ; **sans volume Railway, les parties et classements ne survivent pas aux redéploiements**. Le déploiement remplace l’ancien serveur qui ne sauvegardait aucune partie : faire la mise à jour hors partie active.

## Vérifications

```sh
cd server
npm test -- --runInBand
npm run build
cd ../client
npm run build
```

`work` et les fichiers de données ne font pas partie du déploiement. Les tests ciblent la reprise, les règles, l’isolation des mains, les délais et le comptage des classements.
