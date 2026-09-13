/* Rave Scanner — rendu du planning. Zéro dépendance : le site doit rester
   servable tel quel par GitHub Pages, sans étape de build. */

const DATA_URL = './data/events.json';

const DOW = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

const state = {
  days: 14,
  minTier: 0,
  genres: new Set(),
  venues: new Set(),
  query: '',
  view: 'grid',
};

/** @type {{data: any, venues: Map, artists: Map}} */
const store = { data: null, venues: new Map(), artists: new Map() };

/** Jours dont la vue Liste montre tout (au-dela des LIST_COLLAPSE_AT
    premieres soirees) — repli par defaut, un jour trop charge n'ecrase pas
    la lisibilite d'un simple scroll, surtout sur mobile. */
const expandedDays = new Set();
const LIST_COLLAPSE_AT = 3;
const BOARD_COLLAPSE_AT = 5;

/** Même seuil que le point de bascule responsive de styles.css. */
const isNarrow = () => window.matchMedia('(max-width: 760px)').matches;

// ------------------------------------------------------------------ dates

/** Date locale du jour, en YYYY-MM-DD (sans passer par UTC). */
function todayISO() {
  const d = new Date();
  return isoOf(d);
}

function isoOf(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Parse 'YYYY-MM-DD' en date locale (pas UTC : sinon décalage d'un jour). */
function parseDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Heure murale du lieu, lue telle quelle dans l'ISO (pas de conversion). */
function wallTime(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '');
  return m ? `${m[1]}:${m[2]}` : '';
}

/** « 22:00 → 03:00 » sur une seule ligne, ou l'heure de début seule quand la
    fin est inconnue. */
function timeRangeHTML(event) {
  const start = wallTime(event.start);
  const end = event.end ? wallTime(event.end) : '';
  return end ? `${start}<span class="ev-time-end">→&nbsp;${end}</span>` : start;
}

function relativeScan(iso) {
  if (!iso) return '—';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `il y a ${Math.max(mins, 0)} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} j`;
}

// ------------------------------------------------------------- état / URL

function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  if (q.has('d')) state.days = Number(q.get('d')) || 14;
  if (q.has('t')) state.minTier = Number(q.get('t')) || 0;
  if (q.has('v')) state.view = q.get('v') === 'list' ? 'list' : 'grid';
  // La grille (colonnes fixes par jour) n'a pas de sens sur un ecran etroit :
  // sans preference explicite dans l'URL, la liste est un point de depart
  // bien plus lisible sur mobile.
  else if (isNarrow()) state.view = 'list';
  if (q.has('q')) state.query = q.get('q');
  if (q.has('g')) state.genres = new Set(q.get('g').split(',').filter(Boolean));
  if (q.has('l')) state.venues = new Set(q.get('l').split(',').filter(Boolean));
}

function writeHash() {
  const q = new URLSearchParams();
  if (state.days !== 14) q.set('d', state.days);
  if (state.minTier) q.set('t', state.minTier);
  if (state.view !== 'grid') q.set('v', state.view);
  if (state.query) q.set('q', state.query);
  if (state.genres.size) q.set('g', [...state.genres].join(','));
  if (state.venues.size) q.set('l', [...state.venues].join(','));
  const hash = q.toString();
  history.replaceState(null, '', hash ? `#${hash}` : location.pathname);
}

// ------------------------------------------------------------------ filtre

function visibleDays() {
  const start = store.data.window?.start ?? todayISO();
  const from = start > todayISO() ? parseDay(start) : parseDay(todayISO());
  const end = parseDay(store.data.window?.end ?? start);
  const out = [];
  for (let i = 0; i < state.days; i++) {
    const d = addDays(from, i);
    if (d > end) break;
    out.push(d);
  }
  return out;
}

function matches(event) {
  if (event.interest.tier < state.minTier) return false;
  if (state.venues.size && !state.venues.has(event.venue_id)) return false;
  if (state.genres.size && !event.genres.some((g) => state.genres.has(g))) return false;
  if (state.query) {
    const q = state.query.toLowerCase();
    const haystack = [
      event.title,
      store.venues.get(event.venue_id)?.name ?? '',
      ...event.lineup.map((s) => s.name),
    ].join(' ').toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

// ------------------------------------------------------------------ rendu

function stars(tier) {
  return '★'.repeat(tier);
}

function eventCard(event, { withVenue = false } = {}) {
  const el = document.createElement(event.ticket_url || event.event_url ? 'a' : 'article');
  el.className = `ev ev--t${event.interest.tier}`;
  if (event.status === 'cancelled') el.classList.add('ev--cancelled');
  if (el.tagName === 'A') {
    el.href = event.ticket_url || event.event_url;
    el.target = '_blank';
    el.rel = 'noopener';
  }
  el.title = event.interest.reasons.join('\n') + `\n— score ${event.interest.score}/100`;

  const venueLine = withVenue
    ? `<div class="agenda-venue">${esc(store.venues.get(event.venue_id)?.name ?? '')}</div>`
    : '';

  const lineup = event.lineup
    .slice(0, 4)
    .map((s, i) => `<li class="${i === 0 ? 'is-head' : ''}">${esc(s.name)}${s.b2b_with ? ' <span>b2b</span>' : ''}</li>`)
    .join('');
  const more = event.lineup.length > 4 ? `<li>+${event.lineup.length - 4}</li>` : '';

  const price = event.price_min != null
    ? (event.price_min === 0 ? 'Gratuit' : `${event.price_min} $`)
    : '';
  const status = event.status === 'sold_out' ? '<span class="ev-status">Complet</span>' : '';

  el.innerHTML = `
    ${venueLine}
    <div class="ev-top">
      <span class="ev-time">${timeRangeHTML(event)}</span>
      <span class="ev-stars">${stars(event.interest.tier)}</span>
    </div>
    <h3 class="ev-title">${esc(event.title)}</h3>
    <ul class="ev-lineup">${lineup}${more}</ul>
    ${price || status ? `<div class="ev-foot">${price ? `<span>${price}</span>` : ''}${status}</div>` : ''}
  `;
  return el;
}

/** Une colonne par jour, les soirées empilées par score décroissant.
 *
 * L'ancienne grille croisait lieux × jours : une ligne par club, donc autant
 * de lignes que de clubs (52 au 2026-09-13) et une majorité de cases vides à
 * parcourir. Sur trois mois, retrouver une grosse date demandait de balayer
 * chaque ligne — Mall Grab est passé inaperçu comme ça. Ici le lieu descend
 * dans la case : on lit une journée de haut en bas, le meilleur en premier.
 */
function renderGrid(events, days) {
  const board = document.getElementById('grid');
  // Vider le tableau remet `scrollLeft` à zéro (la largeur tombe à zéro le
  // temps du remplacement) : sans ça, déplier un jour renverrait au 13 sep.
  const scroller = board.parentElement;
  const scrollLeft = scroller.scrollLeft;
  board.innerHTML = '';

  const byNight = new Map();
  for (const e of events) {
    if (!byNight.has(e.night)) byNight.set(e.night, []);
    byNight.get(e.night).push(e);
  }

  const today = todayISO();
  for (const day of days) {
    const night = isoOf(day);
    const dayEvents = (byNight.get(night) ?? []).sort((a, b) => b.interest.score - a.interest.score);

    const column = document.createElement('section');
    column.className = 'board-day';
    column.dataset.night = night;

    const head = document.createElement('h2');
    head.className = 'board-head';
    if ([0, 5, 6].includes(day.getDay())) head.classList.add('is-weekend');
    if (night === today) head.classList.add('is-today');
    head.innerHTML = `<span class="dow">${DOW[day.getDay()]}</span>
      <span class="dnum">${day.getDate()}</span>
      <span class="dmon">${MONTHS[day.getMonth()]}</span>
      <span class="board-count">${dayEvents.length}</span>`;
    column.append(head);

    const stack = document.createElement('div');
    stack.className = 'board-stack';
    const hidden = dayEvents.length - BOARD_COLLAPSE_AT;
    const expanded = hidden <= 0 || expandedDays.has(night);
    (expanded ? dayEvents : dayEvents.slice(0, BOARD_COLLAPSE_AT))
      .forEach((e) => stack.append(eventCard(e, { withVenue: true })));

    if (hidden > 0) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'board-more';
      more.textContent = expanded ? 'Réduire' : `Voir ${hidden} de plus`;
      more.addEventListener('click', () => {
        expandedDays.has(night) ? expandedDays.delete(night) : expandedDays.add(night);
        render();
      });
      stack.append(more);
    }

    column.append(stack);
    board.append(column);
  }

  scroller.scrollLeft = scrollLeft;
}

/** Sur mobile, une seule journée dépliée à la fois.
 *
 * Une colonne occupe tout l'écran : déplier un jour à dix soirées crée une
 * longue colonne verticale, et en glissant vers la date suivante on hérite de
 * ce défilement pour rien. Passer à un autre jour replie donc le précédent.
 * Sans effet sur desktop, où les colonnes sont côte à côte.
 */
function watchBoardScroll() {
  const scroller = document.querySelector('.scroller');
  let timer;
  scroller.addEventListener('scroll', () => {
    if (!isNarrow() || !expandedDays.size) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const columns = [...scroller.querySelectorAll('.board-day')];
      if (!columns.length) return;
      const left = scroller.getBoundingClientRect().left;
      const visible = columns
        .reduce((a, b) => (Math.abs(b.getBoundingClientRect().left - left) <
                           Math.abs(a.getBoundingClientRect().left - left) ? b : a))
        .dataset.night;

      const trop = [...expandedDays].filter((night) => night !== visible);
      if (!trop.length) return;
      trop.forEach((night) => expandedDays.delete(night));
      render();
    }, 150);
  });
}

function renderList(events, days) {
  const list = document.getElementById('list-view');
  list.innerHTML = '';
  const allowed = new Set(days.map(isoOf));

  const byNight = new Map();
  for (const e of events) {
    if (!allowed.has(e.night)) continue;
    if (!byNight.has(e.night)) byNight.set(e.night, []);
    byNight.get(e.night).push(e);
  }

  for (const night of [...byNight.keys()].sort()) {
    const day = parseDay(night);
    const dayEvents = byNight.get(night).sort((a, b) => b.interest.score - a.interest.score);
    const hiddenCount = dayEvents.length - LIST_COLLAPSE_AT;
    const isCollapsible = hiddenCount > 0;
    const isExpanded = !isCollapsible || expandedDays.has(night);

    const header = document.createElement('h2');
    header.className = 'agenda-day';
    if ([0, 5, 6].includes(day.getDay())) header.classList.add('is-weekend');
    header.innerHTML = `<span>${DOW[day.getDay()]} ${day.getDate()} ${MONTHS[day.getMonth()]}</span>` +
      (isCollapsible ? `<span class="agenda-day-hint">${isExpanded ? 'réduire' : `+ ${hiddenCount}`}</span>` : '');
    if (isCollapsible) {
      header.classList.add('is-collapsible');
      header.setAttribute('role', 'button');
      header.setAttribute('tabindex', '0');
      header.setAttribute('aria-expanded', String(isExpanded));
      const toggle = () => {
        expandedDays.has(night) ? expandedDays.delete(night) : expandedDays.add(night);
        render();
      };
      header.addEventListener('click', toggle);
      header.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); }
      });
    }
    list.append(header);

    (isExpanded ? dayEvents : dayEvents.slice(0, LIST_COLLAPSE_AT)).forEach((event) => {
      const row = document.createElement('div');
      row.className = 'agenda-row';
      const time = document.createElement('div');
      time.className = 'agenda-time';
      time.innerHTML = timeRangeHTML(event);
      row.append(time, eventCard(event, { withVenue: true }));
      list.append(row);
    });
  }
}

function render() {
  const windowDays = visibleDays();
  const allowed = new Set(windowDays.map(isoOf));
  const events = store.data.events.filter((e) => allowed.has(e.night) && matches(e));

  // Une colonne vide sur une grille de 90 jours ne dit rien et coûte toute sa
  // largeur : seuls les jours qui portent au moins une soirée sont affichés.
  // La suite de dates devient discontinue, d'où l'en-tête complet (jour +
  // numéro + mois) sur chaque colonne.
  const nights = new Set(events.map((e) => e.night));
  const days = windowDays.filter((d) => nights.has(isoOf(d)));

  document.getElementById('stat-events').textContent = events.length;
  document.getElementById('stat-venues').textContent = new Set(events.map((e) => e.venue_id)).size;
  document.getElementById('stat-highlights').textContent =
    events.filter((e) => e.interest.tier >= 2).length;

  const isGrid = state.view === 'grid';
  document.getElementById('grid-view').hidden = !isGrid || !events.length;
  document.getElementById('list-view').hidden = isGrid || !events.length;
  document.getElementById('empty').hidden = events.length > 0;

  // Signale un filtre actif dans le panneau repliable, sinon il est invisible
  // sur mobile tant qu'on ne l'ouvre pas.
  const hasMoreFilters = Boolean(state.query || state.genres.size || state.venues.size);
  document.getElementById('filters-more-toggle').classList.toggle('has-active', hasMoreFilters);

  if (events.length) {
    if (isGrid) renderGrid(events, days);
    else renderList(events, days);
  }
  writeHash();
}

// -------------------------------------------------------------- contrôles

function buildDropdown(panelId, countId, items, selection) {
  const panel = document.getElementById(panelId);
  panel.innerHTML = '';
  for (const item of items) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${esc(item.id)}" ${selection.has(item.id) ? 'checked' : ''}>
      <span>${esc(item.label)}</span><span class="count">${item.count}</span>`;
    label.querySelector('input').addEventListener('change', (ev) => {
      ev.target.checked ? selection.add(item.id) : selection.delete(item.id);
      document.getElementById(countId).hidden = selection.size === 0;
      document.getElementById(countId).textContent = selection.size;
      render();
    });
    panel.append(label);
  }
  const badge = document.getElementById(countId);
  badge.hidden = selection.size === 0;
  badge.textContent = selection.size;
}

function buildFilters() {
  const genreCounts = new Map();
  const venueCounts = new Map();
  for (const e of store.data.events) {
    for (const g of e.genres) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
    venueCounts.set(e.venue_id, (venueCounts.get(e.venue_id) ?? 0) + 1);
  }

  buildDropdown(
    'genre-list', 'genre-count',
    [...genreCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, label: id, count })),
    state.genres,
  );

  buildDropdown(
    'venue-list', 'venue-count',
    [...venueCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, label: store.venues.get(id)?.name ?? id, count })),
    state.venues,
  );
}

function groupButtons(selector, key, cast = Number) {
  const buttons = document.querySelectorAll(`${selector} button`);
  const attr = selector.includes('range') ? 'days' : selector.includes('tier') ? 'tier' : 'view';
  for (const button of buttons) {
    button.classList.toggle('is-active', String(state[key]) === button.dataset[attr]);
    button.addEventListener('click', () => {
      state[key] = cast(button.dataset[attr]);
      buttons.forEach((b) => b.classList.toggle('is-active', b === button));
      render();
    });
  }
}

function wireControls() {
  groupButtons('.filter--range', 'days');
  groupButtons('.filter--tier', 'minTier');
  groupButtons('.filter--view', 'view', String);

  const search = document.getElementById('search');
  search.value = state.query;
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.query = search.value.trim(); render(); }, 150);
  });

  document.getElementById('reset').addEventListener('click', () => {
    state.days = 14;
    state.minTier = 0;
    state.query = '';
    state.genres.clear();
    state.venues.clear();
    search.value = '';
    document.querySelectorAll('.filter--range button, .filter--tier button')
      .forEach((b) => b.classList.toggle('is-active', b.dataset.days === '14' || b.dataset.tier === '0'));
    buildFilters();
    render();
  });

  const moreToggle = document.getElementById('filters-more-toggle');
  const more = document.getElementById('filters-more');
  moreToggle.addEventListener('click', () => {
    more.hidden = !more.hidden;
    moreToggle.setAttribute('aria-expanded', String(!more.hidden));
    moreToggle.textContent = more.hidden ? 'Plus de filtres' : 'Masquer les filtres';
  });

  watchBoardScroll();

  // Ferme les menus déroulants au clic extérieur.
  document.addEventListener('click', (ev) => {
    for (const drop of document.querySelectorAll('.filter--drop[open]')) {
      if (!drop.contains(ev.target)) drop.open = false;
    }
  });
}

// ---------------------------------------------------------------- amorçage

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function fail(message) {
  const banner = document.getElementById('error-banner');
  banner.hidden = false;
  banner.textContent = message;
}

async function boot() {
  readHash();
  let data;
  try {
    const response = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch (err) {
    fail(
      `Impossible de charger ${DATA_URL} (${err.message}). ` +
      `Lance « python -m ravescanner scan » puis sers le dossier avec un serveur HTTP ` +
      `— l'ouverture directe du fichier (file://) est bloquée par le navigateur.`,
    );
    return;
  }

  store.data = data;
  store.venues = new Map(data.venues.map((v) => [v.id, v]));
  store.artists = new Map(data.artists.map((a) => [a.id, a]));

  document.getElementById('city-label').textContent =
    `${data.city_label ?? data.city} · ${data.window.start} → ${data.window.end}`;
  document.getElementById('stat-updated').textContent = relativeScan(data.generated_at);
  document.getElementById('demo-banner').hidden = !data.demo;
  document.getElementById('sources-line').textContent =
    'Sources : ' + (data.sources ?? [])
      .map((s) => `${s.id}${s.ok ? ` (${s.events})` : ' — en échec'}`)
      .join(' · ');

  buildFilters();
  wireControls();
  render();
}

boot();
