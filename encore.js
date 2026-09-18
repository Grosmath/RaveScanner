/* ENCORE — l'interface du site.
 *
 * Autonome : ne touche ni app.js ni styles.css, qui font tourner l'ancienne
 * page conservee sous /classic.html. Revenir en arriere reste gratuit.
 *
 * Deux sections, deux besoins opposes que la meme fenetre ne pouvait pas
 * servir : le planning (dense, court terme, tous niveaux) et le rail « a ne
 * pas rater » (le haut du panier, loin, en image).
 *
 * Le rail ne fabrique pas ses cartes : il dessine `payload.spotlight`, produit
 * par le moteur avec la meme fonction que le carrousel Instagram. Les deriver
 * une seconde fois ici, en JavaScript, aurait garanti la divergence - c'est le
 * mode de panne le plus frequent de ce projet.
 */

// Le planning d'une ville. `data/<ville>/events.json` depuis que le moteur est
// multi-villes ; l'ancienne page, elle, lit toujours `data/events.json`, que le
// build alimente avec la ville par defaut.
const dataUrl = (city) => `./data/${city}/events.json`;
const VILLES = ['montreal', 'paris'];
const VILLE_DEFAUT = 'montreal';

const DOW = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTHS = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc'];

const COLLAPSE_AT = 4;

const state = { city: VILLE_DEFAUT, tier: 0, genres: [], q: '', event: null, favoris: false };
const store = { data: null, venues: new Map(), artists: new Map(), events: new Map() };
const expanded = new Set();

const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ------------------------------------------------------------------ dates */

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function dayLabel(iso) {
  const d = parseDay(iso);
  return `${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const isWeekend = (iso) => [0, 5, 6].includes(parseDay(iso).getDay());

/* Heure murale telle qu'ecrite par la source : pas de conversion de fuseau,
   « 22:00 a Montreal » doit s'afficher 22:00 partout. */
function wallTime(iso) {
  if (!iso) return '';
  const m = String(iso).match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

function timeRange(ev) {
  const a = wallTime(ev.start);
  const b = wallTime(ev.end);
  return b ? `${a} → ${b}` : a;
}

/* ------------------------------------------------------------------- état */

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.has('n')) state.tier = Number(p.get('n')) || 0;
  if (p.has('g')) state.genres = p.get('g').split(',').filter(Boolean);
  if (p.has('q')) state.q = p.get('q');
  if (p.has('e')) state.event = p.get('e');
  // La ville vient de l'URL si elle y est, sinon du dernier choix retenu.
  // Un lien partage impose donc sa ville, ce qui compte quand on envoie une
  // soiree parisienne a quelqu'un.
  const ville = p.get('ville') || lireVilleGardee();
  if (VILLES.includes(ville)) state.city = ville;
}

function writeHash() {
  const p = new URLSearchParams();
  if (state.city !== VILLE_DEFAUT) p.set('ville', state.city);
  if (state.tier) p.set('n', state.tier);
  if (state.genres.length) p.set('g', state.genres.join(','));
  if (state.q) p.set('q', state.q);
  // La fiche vit dans l'URL : un lien vers une soiree precise se partage.
  if (state.event) p.set('e', state.event);
  const next = p.toString();
  history.replaceState(null, '', next ? `#${next}` : location.pathname);
}

/* Le choix de ville survit au rechargement. `localStorage` peut lever (mode
   prive, cookies bloques) : on retombe alors sur la ville par defaut plutot
   que de casser la page. */
function lireVilleGardee() {
  try { return localStorage.getItem('encore.ville') || ''; } catch { return ''; }
}

function garderVille(ville) {
  try { localStorage.setItem('encore.ville', ville); } catch { /* tant pis */ }
}

async function chargerVille(city) {
  const res = await fetch(dataUrl(city), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  store.data = await res.json();
  store.venues.clear(); store.artists.clear(); store.events.clear();
  for (const v of store.data.venues || []) store.venues.set(v.id, v);
  for (const a of store.data.artists || []) store.artists.set(a.id, a);
  for (const e of store.data.events || []) store.events.set(e.id, e);
}

/* --------------------------------------------------------------- sélection */

/* Toute la fenetre scannee, a partir d'aujourd'hui. Le choix « 7 / 14 jours /
   3 mois » a ete retire : personne n'a de raison de preferer voir moins, et un
   jour sans rien n'est de toute facon pas affiche. Le seul arbitrage qui reste
   est le niveau de mise en avant. */
function joursConnus(events) {
  const aujourdhui = todayISO();
  return [...new Set(events.map((e) => e.night))].filter((j) => j >= aujourdhui).sort();
}

/* ---------------------------------------------------------------- favoris */

/* Deux listes, sur l'appareil seulement : les soirees enregistrees (par
   `event.id`) et les artistes suivis (par `artist_id`). Pas de compte, pas de
   serveur : ce qu'on aime ne quitte pas le telephone. Le prix a assumer : rien
   n'est synchronise d'un appareil a l'autre.

   `event.id` est un hachage lieu + nuit + titre, stable a 99,5 % d'un scan a
   l'autre (mesure sur l'historique publie). Un titre reecrit par la source
   fait perdre le favori de la soiree, jamais celui de l'artiste. Un artiste
   suivi vaut pour les deux villes : `artist_id` est partage.

   Deux usages prevus plus tard, qui expliquent la forme : compter les soirees
   enregistrees pour mesurer l'interet (il faudra alors un serveur, donc une
   vraie question de vie privee), et prevenir quand un artiste suivi annonce
   une date. */
const FAVORIS_CLE = 'encore.favoris';

function lireFavoris() {
  try {
    const brut = JSON.parse(localStorage.getItem(FAVORIS_CLE) || '{}');
    return { soirees: new Set(brut.soirees || []), artistes: new Set(brut.artistes || []) };
  } catch {
    return { soirees: new Set(), artistes: new Set() };
  }
}

const favoris = lireFavoris();

function garderFavoris() {
  try {
    localStorage.setItem(FAVORIS_CLE, JSON.stringify({
      version: 1,
      soirees: [...favoris.soirees],
      artistes: [...favoris.artistes],
    }));
  } catch { /* mode prive : les favoris vivront le temps de la page */ }
}

const soireeEnregistree = (ev) => favoris.soirees.has(ev.id);
const artisteSuiviDans = (ev) => (ev.lineup || []).some((s) => favoris.artistes.has(s.artist_id));
const dansMesFavoris = (ev) => soireeEnregistree(ev) || artisteSuiviDans(ev);

function basculer(ensemble, cle) {
  if (ensemble.has(cle)) ensemble.delete(cle); else ensemble.add(cle);
  garderFavoris();
}

function renderFavoris() {
  const bouton = $('#fav-filtre');
  const aVenir = store.data.events.filter((e) => e.night >= todayISO() && dansMesFavoris(e)).length;
  const rien = !favoris.soirees.size && !favoris.artistes.size;
  bouton.hidden = rien && !state.favoris;
  bouton.classList.toggle('is-active', state.favoris);
  bouton.setAttribute('aria-pressed', String(state.favoris));
  $('#fav-label').textContent = aVenir ? `Mes favoris (${aVenir})` : 'Mes favoris';
}

function matches(ev, { sansGenres = false } = {}) {
  // Le filtre des favoris passe avant le niveau et les genres : « mes
  // favoris » doit tout montrer, meme une petite soiree enregistree exprès.
  // La recherche, elle, reste active.
  if (state.favoris) {
    if (!dansMesFavoris(ev)) return false;
    return correspondRecherche(ev);
  }
  if (ev.interest.tier < state.tier) return false;
  // Plusieurs familles cochees : une soiree qui appartient a l'une d'elles
  // suffit. « Techno » + « House » doit montrer plus, pas moins.
  if (!sansGenres && state.genres.length
      && !(ev.families || []).some((f) => state.genres.includes(f))) return false;
  return correspondRecherche(ev);
}

function correspondRecherche(ev) {
  if (!state.q) return true;
  const needle = state.q.toLowerCase();
  const hay = [
    ev.title,
    store.venues.get(ev.venue_id)?.name || '',
    ...(ev.lineup || []).map((s) => s.name),
  ].join(' ').toLowerCase();
  return hay.includes(needle);
}

/* --------------------------------------------------------------- planning */

function eventButton(ev, { withDay = false } = {}) {
  const venue = store.venues.get(ev.venue_id);
  const head = ev.lineup?.[0]?.name || ev.title;
  const tier = ev.interest.tier;
  // Pas d'etoiles : elles se lisaient comme une note donnee a l'artiste. La
  // mise en avant passe entierement par la couleur de la carte.
  return `
    <button type="button" class="ev ev--t${tier}" data-event="${esc(ev.id)}">
      <span class="ev-top"><span class="ev-name">${esc(head)}</span>${
        soireeEnregistree(ev) ? '<span class="ev-fav" title="Soirée enregistrée">♥</span>'
        : artisteSuiviDans(ev) ? '<span class="ev-fav ev-fav--artiste" title="Un artiste que vous suivez">♡</span>' : ''
      }</span>
      <span class="ev-venue">${esc(venue ? venue.name : '')}</span>
      <span class="ev-time">${withDay ? esc(dayLabel(ev.night)) + ' · ' : ''}${esc(timeRange(ev))}</span>
    </button>`;
}

function renderBoard(byDay, days) {
  const board = $('#board');
  const keep = $('#board-wrap').scrollLeft;

  board.innerHTML = days.map((iso) => {
    const list = byDay.get(iso) || [];
    const open = expanded.has(iso);
    const shown = open ? list : list.slice(0, COLLAPSE_AT);
    const hidden = list.length - shown.length;
    return `
      <div class="day${isWeekend(iso) ? ' day--weekend' : ''}">
        <div class="day-head"><strong>${esc(dayLabel(iso))}</strong><span class="n">${list.length}</span></div>
        <div class="day-list">
          ${shown.map((ev) => eventButton(ev)).join('')}
          ${hidden > 0 ? `<button type="button" class="more" data-open="${esc(iso)}">Voir ${hidden} de plus</button>` : ''}
          ${open && list.length > COLLAPSE_AT ? `<button type="button" class="more" data-close="${esc(iso)}">Réduire</button>` : ''}
        </div>
      </div>`;
  }).join('');

  $('#board-wrap').scrollLeft = keep;
}

function renderPlanning() {
  const kept = store.data.events.filter(matches).filter((ev) => ev.night >= todayISO());

  const byDay = new Map();
  for (const ev of kept) {
    if (!byDay.has(ev.night)) byDay.set(ev.night, []);
    byDay.get(ev.night).push(ev);
  }
  for (const list of byDay.values()) list.sort((a, b) => b.interest.score - a.interest.score);

  // Les jours vides ne sont pas affiches : sur trois mois et le filtre le plus
  // serre, la vue tombe de 90 colonnes a une douzaine.
  const days = joursConnus(kept);

  $('#board-wrap').hidden = !days.length;
  $('#hint-scroll').hidden = !days.length;
  $('#empty').hidden = days.length > 0;
  $('#empty').textContent = state.favoris
    ? 'Rien d’enregistré à venir. Ouvrez une soirée pour l’enregistrer, ou suivez un artiste.'
    : 'Rien ne correspond à ces filtres.';

  if (days.length) {
    renderBoard(byDay, days);
    indiceDefilement();
  }

  const n = kept.length;
  $('#planning-sub').textContent =
    `${n} soirée${n > 1 ? 's' : ''} · ${days.length} jour${days.length > 1 ? 's' : ''} avec quelque chose`;
}

/* --------------------------------------------------------------- annonces */

let defileur = null;

/* Defilement lent et continu du bandeau, en aller-retour.

   LE PIEGE, mesure le 2026-09-16 : `element.scrollLeft += 0.35` repete cinq
   fois laisse la position a ZERO. Le navigateur arrondit la propriete, donc un
   increment inferieur au pixel est perdu a chaque image et rien ne bouge
   jamais - ni sur ordinateur ni sur telephone. On garde donc la position dans
   une variable flottante a nous, et on l'assigne : les memes cinq iterations
   donnent alors 1,6 px.

   S'arrete au survol et au focus clavier, s'arrete DEFINITIVEMENT des qu'on
   prend la main (se faire reprendre le defilement sous le doigt est
   desagreable), et ne demarre pas du tout si le systeme demande moins
   d'animations. */
function autoDefiler(rail) {
  if (defileur) cancelAnimationFrame(defileur);
  defileur = null;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Les ecouteurs se posent UNE fois sur l'element, qui survit aux rendus :
  // les rattacher a chaque changement de ville en empilerait un jeu de plus.
  if (!rail.dataset.pauseCablee) {
    rail.dataset.pauseCablee = '1';
    const geler = () => { rail.dataset.pause = '1'; };
    const reprendre = () => { delete rail.dataset.pause; };
    rail.addEventListener('pointerenter', geler);
    rail.addEventListener('pointerleave', reprendre);
    rail.addEventListener('focusin', geler);
    rail.addEventListener('focusout', reprendre);
    rail.addEventListener('pointerdown', () => { rail.dataset.manuel = '1'; });
    rail.addEventListener('wheel', () => { rail.dataset.manuel = '1'; }, { passive: true });
  }

  let pos = rail.scrollLeft;
  let sens = 1;
  const VITESSE = 0.4; // px par image, soit ~24 px/s

  // Le debordement est re-mesure a chaque image : juste apres `innerHTML`, la
  // mise en page n'est pas faite et une mesure unique pouvait conclure « rien
  // a defiler » et ne jamais demarrer.
  const pas = () => {
    const max = rail.scrollWidth - rail.clientWidth;
    if (max > 8 && !rail.dataset.pause && !rail.dataset.manuel) {
      pos += VITESSE * sens;
      if (pos >= max) { pos = max; sens = -1; }
      else if (pos <= 0) { pos = 0; sens = 1; }
      rail.scrollLeft = pos;
    }
    defileur = requestAnimationFrame(pas);
  };
  defileur = requestAnimationFrame(pas);
}

function renderNews() {
  const section = $('#news');
  const rail = $('#news-rail');
  const cartes = store.data.announcements || [];

  // Masquee plutot que vide : le premier jour d'une ville, on ne peut pas
  // distinguer « nouveau » de « decouvert en meme temps que le reste », donc
  // il n'y a legitimement rien a dire.
  section.hidden = cartes.length === 0;
  if (!cartes.length) return;

  rail.innerHTML = cartes.map((c) => {
    const img = c.photo ? `<img src="${esc(c.photo)}" alt="" loading="lazy">` : '<img alt="">';
    const quand = dayLabel(c.night);
    return `
      <button type="button" class="news-card" data-event="${esc(c.id)}">
        ${img}
        <span class="who">
          <span class="nom">${esc(c.name)}</span>
          <span class="ou">${esc(quand)}${c.venue ? ' · ' + esc(c.venue) : ''}</span>
        </span>
      </button>`;
  }).join('');

}

/* Defilement lent et continu, en aller-retour plutot qu'en boucle : pas de
   contenu duplique, et aucun saut visible en fin de course.
   S'arrete au survol et au focus clavier, et ne demarre pas du tout si le
   systeme demande moins d'animations - une bande qui bouge toute seule est
   penible pour qui y est sensible, et rend le survol difficile. */
/* La fleche qui remplace la barre de defilement du planning : elle dit qu'il y
   a une suite, puis s'efface une fois que le lecteur a defile - l'indication a
   fait son travail et n'a plus a occuper l'ecran. */
function indiceDefilement() {
  const zone = $('#board-wrap');
  const fleche = $('#hint-scroll');
  if (!zone || !fleche) return;

  const revoir = () => {
    const reste = zone.scrollWidth - zone.clientWidth - zone.scrollLeft;
    fleche.classList.toggle('parti', zone.scrollLeft > 24 || reste < 24);
  };
  if (!zone.dataset.indiceCable) {
    zone.dataset.indiceCable = '1';
    zone.addEventListener('scroll', revoir, { passive: true });
    window.addEventListener('resize', revoir);
  }
  revoir();
}

/* ------------------------------------------------------------------- rail */

function renderRail() {
  const rail = $('#rail');
  const cards = store.data.spotlight || [];
  if (!cards.length) { rail.closest('.rail-section').hidden = true; return; }

  const { W, H, draw, loadPhoto } = window.ENCORE_CARDS;

  rail.innerHTML = '';
  cards.forEach((card) => {
    const fig = document.createElement('figure');
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    if (card.event_id) {
      canvas.dataset.event = card.event_id;
      canvas.title = `${card.title} - ${card.venue}`;
    }
    fig.append(canvas);
    rail.append(fig);

    // Dessiner avant la photo puis redessiner : la carte est lisible tout de
    // suite, l'image arrive quand elle arrive.
    draw(canvas, card, null, []);
    loadPhoto(card.photo).then((img) => { if (img) draw(canvas, card, img, []); });
  });

  fadeRail();
  rail.addEventListener('scroll', fadeRail, { passive: true });
  window.addEventListener('resize', fadeRail);
}

/* Les cartes se fondent dans le fond la ou il reste quelque chose a atteindre,
   et pas la ou on est arrive : au debut du rail, rien ne doit s'effacer a
   gauche, sinon le fondu ment sur ce qui existe. */
function fadeRail() {
  const rail = $('#rail');
  const max = rail.scrollWidth - rail.clientWidth;
  const left = rail.scrollLeft;
  const FADE = 64;
  rail.style.setProperty('--fade-l', `${Math.min(left, FADE)}px`);
  rail.style.setProperty('--fade-r', `${Math.min(Math.max(max - left, 0), FADE)}px`);
}

/* ------------------------------------------------------------------ fiche */

function openSheet(id) {
  const ev = store.events.get(id);
  if (!ev) return;
  state.event = id;
  writeHash();

  const venue = store.venues.get(ev.venue_id);
  const money = ev.price_min != null ? `dès ${ev.price_min} ${ev.currency || ''}`.trim() : '';
  const statut = { sold_out: 'Complet', cancelled: 'Annulé', postponed: 'Reporté' }[ev.status] || '';

  // Le score de l'artiste n'est pas affiche : il sert a classer, pas a noter.
  const lineup = (ev.lineup || []).map((slot, i) => {
    const a = store.artists.get(slot.artist_id);
    const img = a?.image ? `<img src="${esc(a.image)}" alt="" loading="lazy">` : '<img alt="">';
    const suivi = favoris.artistes.has(slot.artist_id);
    return `<li>${img}<span class="who${i === 0 ? ' head' : ''}">${esc(slot.name)}</span>
      <button type="button" class="suivre${suivi ? ' is-on' : ''}" data-suivre="${esc(slot.artist_id)}"
        aria-pressed="${suivi}">${suivi ? 'Suivi' : 'Suivre'}</button></li>`;
  }).join('');

  const links = [
    ev.ticket_url ? `<a href="${esc(ev.ticket_url)}" target="_blank" rel="noopener">Billets</a>` : '',
    ev.event_url ? `<a class="ghost" href="${esc(ev.event_url)}" target="_blank" rel="noopener">La soirée</a>` : '',
    venue?.url ? `<a class="ghost" href="${esc(venue.url)}" target="_blank" rel="noopener">Le lieu</a>` : '',
  ].filter(Boolean).join('');

  $('#sheet-body').innerHTML = `
    <p class="sheet-day">${esc(dayLabel(ev.night))}</p>
    <h3>${esc(ev.lineup?.[0]?.name || ev.title)}</h3>
    <p class="sheet-venue">${esc(venue ? venue.name : '')}</p>
    <p class="sheet-meta">${esc([timeRange(ev), venue?.address, money, statut].filter(Boolean).join(' · '))}</p>

    <button type="button" class="enregistrer${soireeEnregistree(ev) ? ' is-on' : ''}" data-aimer="${esc(ev.id)}"
      aria-pressed="${soireeEnregistree(ev)}">${soireeEnregistree(ev) ? '♥ Soirée enregistrée' : '♡ Enregistrer la soirée'}</button>

    ${lineup ? `<section><h4>Line up</h4><ul class="lineup">${lineup}</ul></section>` : ''}

    ${links ? `<section><h4>Y aller</h4><div class="links">${links}</div></section>` : ''}`;

  $('#sheet').hidden = false;
  $('#veil').hidden = false;
  $('#sheet').focus();
}

function closeSheet() {
  state.event = null;
  writeHash();
  $('#sheet').hidden = true;
  $('#veil').hidden = true;
}

/* Apres un clic sur un coeur : la fiche ouverte, le planning et le bouton de
   filtre se mettent a jour ensemble. */
function rafraichirFavoris() {
  if (state.event) openSheet(state.event);
  renderPlanning();
  renderFavoris();
}

/* ----------------------------------------------------------------- genres */

/* Le menu ne propose que les familles presentes dans la ville, dans l'ordre
   decide par le moteur (`payload.families`). Les nombres suivent le niveau et
   la recherche, mais pas les familles deja cochees : sinon cocher « Techno »
   ferait tomber « House » a zero, alors que les cocher ensemble l'ajoute. */
function renderGenres() {
  const familles = store.data.families || [];
  const details = $('#genres');
  details.hidden = !familles.length;
  // Une famille absente de cette ville (on vient d'en changer) est oubliee.
  state.genres = state.genres.filter((f) => familles.includes(f));

  const aujourdhui = todayISO();
  const vivants = store.data.events.filter((e) => e.night >= aujourdhui && matches(e, { sansGenres: true }));
  const compte = new Map(familles.map((f) => [f, 0]));
  let sansFamille = 0;
  for (const e of vivants) {
    if (!(e.families || []).length) sansFamille++;
    for (const f of e.families || []) compte.set(f, (compte.get(f) || 0) + 1);
  }

  $('#genres-list').innerHTML = familles.map((f) => `
    <label class="genre${state.genres.includes(f) ? ' is-on' : ''}">
      <input type="checkbox" value="${esc(f)}"${state.genres.includes(f) ? ' checked' : ''}>
      <span>${esc(f)}</span><span class="n">${compte.get(f) || 0}</span>
    </label>`).join('');

  // Le dire plutot que le laisser deviner : une soiree sans genre connu
  // disparait des qu'on filtre, et ce n'est pas parce qu'elle n'est pas
  // « techno ».
  $('#genres-note').textContent = sansFamille
    ? `${sansFamille} soirée${sansFamille > 1 ? 's' : ''} sans genre connu, masquée${sansFamille > 1 ? 's' : ''} dès qu'un genre est choisi.`
    : '';
  $('#genres-clear').hidden = !state.genres.length;

  const n = state.genres.length;
  $('#genres-label').textContent = !n ? 'Genres' : n === 1 ? state.genres[0] : `${n} genres`;
  details.classList.toggle('is-active', n > 0);
}

/* ------------------------------------------------------------------ câblage */

function segment(selector, key, cast = Number) {
  document.querySelectorAll(selector).forEach((btn) => {
    btn.addEventListener('click', () => {
      state[key] = cast(btn.dataset[key]);
      document.querySelectorAll(selector).forEach((b) => b.classList.toggle('is-active', b === btn));
      expanded.clear();
      writeHash();
      renderPlanning();
      renderGenres();
    });
  });
}

function wire() {
  segment('[data-tier]', 'tier');

  $('#fav-filtre').addEventListener('click', () => {
    state.favoris = !state.favoris;
    expanded.clear();
    renderPlanning();
    renderFavoris();
  });

  $('#genres-list').addEventListener('change', () => {
    state.genres = [...document.querySelectorAll('#genres-list input:checked')].map((i) => i.value);
    expanded.clear();
    writeHash();
    renderPlanning();
    renderGenres();
  });
  $('#genres-clear').addEventListener('click', () => {
    state.genres = [];
    expanded.clear();
    writeHash();
    renderPlanning();
    renderGenres();
  });
  // Le menu se ferme quand on clique ailleurs, comme n'importe quel menu.
  document.addEventListener('click', (e) => {
    const menu = $('#genres');
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  });

  let timer;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = e.target.value.trim();
      writeHash();
      renderPlanning();
      renderGenres();
    }, 180);
  });

  // Une seule ecoute pour tout le document : les cartes du planning et celles
  // du rail sont recreees a chaque rendu, y attacher un handler chacune
  // fuirait.
  document.addEventListener('click', (e) => {
    const aimer = e.target.closest('[data-aimer]');
    if (aimer) { basculer(favoris.soirees, aimer.dataset.aimer); rafraichirFavoris(); return; }

    const suivre = e.target.closest('[data-suivre]');
    if (suivre) { basculer(favoris.artistes, suivre.dataset.suivre); rafraichirFavoris(); return; }

    const card = e.target.closest('[data-event]');
    if (card) { openSheet(card.dataset.event); return; }

    const open = e.target.closest('[data-open]');
    if (open) { expanded.add(open.dataset.open); renderPlanning(); return; }

    const close = e.target.closest('[data-close]');
    if (close) { expanded.delete(close.dataset.close); renderPlanning(); }
  });

  $('#sheet-close').addEventListener('click', closeSheet);
  $('#veil').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  // La navigation suit le defilement plutot que le clic : on sait toujours ou
  // on est, meme en ayant fait defiler a la main.
  document.querySelectorAll('[data-city]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ville = btn.dataset.city;
      if (ville === state.city) return;
      state.city = ville;
      state.event = null;
      expanded.clear();
      garderVille(ville);
      document.querySelectorAll('[data-city]').forEach((b) =>
        b.classList.toggle('is-active', b === btn));
      writeHash();
      try {
        await chargerVille(ville);
      } catch (err) {
        $('#error').hidden = false;
        $('#error').textContent = `Planning de ${ville} indisponible : ${err.message}`;
        return;
      }
      $('#error').hidden = true;
      titrer();
      renderGenres();
      renderFavoris();
      renderNews();
      renderPlanning();
      renderRail();
    });
  });

  const spy = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      document.querySelectorAll('.sections a').forEach((a) =>
        a.classList.toggle('is-active', a.dataset.section === entry.target.id));
    }
  }, { rootMargin: '-45% 0px -45% 0px' });
  document.querySelectorAll('main .panel').forEach((p) => spy.observe(p));
}

/* ------------------------------------------------------------------- boot */

/* Le titre de l'onglet suit la ville affichee : il annoncait Montreal a un
   Parisien. Point median et non tiret cadratin, comme partout ailleurs. */
function titrer() {
  const ville = store.data && store.data.city_label;
  document.title = ville ? `ENCORE · ${ville}` : 'ENCORE';
}

/* ------------------------------------------------------- installation */

/* Deux chemins, parce que les navigateurs ne se ressemblent pas :
   - Chrome et Edge previennent qu'ils savent installer (`beforeinstallprompt`)
     et acceptent qu'on ouvre la boite nous-memes ;
   - Safari sur iPhone n'a pas d'API : on ne peut qu'expliquer le geste.
   Dans les deux cas, rien ne s'affiche si l'application est deja installee,
   ni pendant trente jours apres un refus. */
const INSTALL_REPOS = 30 * 24 * 3600 * 1000;

function dejaInstallee() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function refusRecent() {
  try {
    const quand = Number(localStorage.getItem('encore.install.refus') || 0);
    return quand && Date.now() - quand < INSTALL_REPOS;
  } catch { return false; }
}

/* Seulement sur telephone. Sur ordinateur, personne n'installe un site : le
   reflexe est l'onglet ou le favori, et la fenetre installee ressemble a la
   meme page sans les onglets. Chrome garde de toute facon son icone
   d'installation dans la barre d'adresse pour ceux qui y tiennent. */
function surTelephone() {
  return window.matchMedia('(max-width: 760px)').matches;
}

function proposerInstallation() {
  const boite = $('#install');
  if (!boite || dejaInstallee() || refusRecent() || !surTelephone()) return;

  const fermer = (garder) => {
    boite.hidden = true;
    if (garder) { try { localStorage.setItem('encore.install.refus', String(Date.now())); } catch { /* tant pis */ } }
  };
  $('#install-non').addEventListener('click', () => fermer(true));

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let invite = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    // Sans ce `preventDefault`, Chrome affiche sa propre banniere en plus.
    e.preventDefault();
    invite = e;
    boite.hidden = false;
  });

  $('#install-ok').addEventListener('click', async () => {
    if (!invite) return;
    boite.hidden = true;
    invite.prompt();
    const { outcome } = await invite.userChoice;
    invite = null;
    if (outcome !== 'accepted') fermer(true);
  });

  if (ios) {
    boite.classList.add('is-ios');
    $('#install-quoi').textContent = 'Menu Partager, puis « Sur l\'écran d\'accueil ».';
    // Laisser le temps de voir le planning avant de demander quoi que ce soit.
    setTimeout(() => { if (!dejaInstallee() && !refusRecent()) boite.hidden = false; }, 4000);
  }

  window.addEventListener('appinstalled', () => fermer(false));
}

/* Le cache hors ligne. Son absence n'empeche rien : le site marche sans. */
function activerCache() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* pas grave */ });
  });
}

async function boot() {
  readHash();
  try {
    await chargerVille(state.city);
  } catch (err) {
    $('#error').hidden = false;
    $('#error').textContent = `Impossible de charger le planning : ${err.message}. Lance « python -m reload scan » puis sers le dossier avec un serveur HTTP.`;
    return;
  }

  titrer();
  document.querySelectorAll('[data-city]').forEach((b) => b.classList.toggle('is-active', b.dataset.city === state.city));
  document.querySelectorAll('[data-tier]').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.tier) === state.tier));
  $('#q').value = state.q;

  wire();
  renderGenres();
  renderFavoris();
  renderNews();
  renderPlanning();
  renderRail();

  if (state.event) openSheet(state.event);

  proposerInstallation();
  activerCache();
}

boot();
