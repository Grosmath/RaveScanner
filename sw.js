/* Service worker d'ENCORE : ouverture instantanee, sans jamais servir un
   planning perime.
 *
 * La regle tient en une phrase : **les fichiers du site peuvent venir du
 * cache, les donnees non**. Le cron publie deux fois par jour ; un planning
 * garde en cache ferait afficher les soirees d'avant-hier a quelqu'un qui a du
 * reseau, et c'est exactement le genre de panne silencieuse que ce projet
 * s'efforce d'eviter.
 *
 *   data/…json  -> reseau d'abord, cache seulement si le reseau ne repond pas
 *   le reste    -> cache d'abord, mais rafraichi en arriere-plan (la version
 *                  suivante est donc a jour, sans attendre un changement de
 *                  VERSION)
 *
 * Les photos d'artistes (i.scdn.co, dzcdn.net) et les polices Google ne sont
 * pas mises en cache ici : elles ont deja leur propre cache HTTP, et les
 * empiler doublerait la place occupee sur le telephone.
 */

const VERSION = 'encore-v6';
const SHELL = [
  './',
  './index.html',
  './encore.css',
  './encore.js',
  './cards.js',
  './manifest.webmanifest',
  './icones/icone-192.png',
];

self.addEventListener('install', (e) => {
  // `addAll` echouerait en entier si un seul fichier manquait : on tolere.
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Tout ce qui n'est pas chez nous passe sans intervention : photos
  // d'artistes, polices, et plus tard les statistiques.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(req)
        .then((rep) => {
          const copie = rep.clone();
          caches.open(VERSION).then((c) => c.put(req, copie));
          return rep;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((cache) => {
      const reseau = fetch(req)
        .then((rep) => {
          if (rep && rep.ok) {
            const copie = rep.clone();
            caches.open(VERSION).then((c) => c.put(req, copie));
          }
          return rep;
        })
        .catch(() => cache);
      return cache || reseau;
    })
  );
});
