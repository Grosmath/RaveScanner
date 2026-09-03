# Rave Scanner — Montréal

Le planning des soirées house / techno / électro de Montréal, sur une grille
**lieux × jours**, avec une mise en valeur automatique de ce qui vaut vraiment
le déplacement.

**[Voir le planning](https://grosmath.github.io/RaveScanner/)**

---

Ce repo ne contient que le site statique (`index.html`, `app.js`,
`styles.css`) et les données qu'il affiche (`data/events.json`) — mis à jour
automatiquement, plusieurs fois par jour, par un moteur qui tourne ailleurs.
Aucun build, aucune dépendance : `index.html` charge `app.js`, qui charge
`data/events.json`.

Chaque événement affiché renvoie vers sa page d'origine (Resident Advisor,
Piknic Électronik…) plutôt que de republier leur contenu.
