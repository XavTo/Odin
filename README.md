# Odin (jeu en ligne)

Jeu de défausse en temps réel (2 à 6 joueurs) basé sur les [règles détaillées](./regle.txt).

## Prérequis
- Node.js 18+
- npm

## Démarrage rapide

### Serveur (NestJS + Socket.IO)
```bash
cd server
npm install
npm run start:dev
```

### Client (Vite + TypeScript)
```bash
cd client
npm install
npm run dev
```

Ouvrir `http://localhost:5173` et se connecter au serveur `http://localhost:3000`.

## Règles implémentées (résumé)
- 54 cartes (1 à 9, 6 couleurs), 9 cartes par joueur.
- Début d’un tour : le joueur pose 1 carte.
- Ensuite : jouer le même nombre de cartes ou +1, et plus fort que la combinaison précédente.
- Combinaison valide: meme couleur ou meme valeur.
- Valeur: chiffres tries par ordre decroissant (ex: 2 et 8 -> 82).
- Apres avoir joue: recuperer 1 carte de la table precedente.
- Un tour finit quand tout le monde passe (sauf le dernier joueur a avoir joue).
- Fin de manche: main vide en jouant, ou debut de tour avec toutes les cartes meme couleur ou meme valeur.
- Scoring: 1 point par carte restante. Fin de partie a 15 points.
