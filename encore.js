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

const state = { city: VILLE_DEFAUT, days: 14, tier: 0, view: 'board', q: '', event: null };
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
  if (p.has('j')) state.days = Number(p.get('j')) || 14;
  if (p.has('n')) state.tier = Number(p.get('n')) || 0;
  if (p.has('v')) state.view = p.get('v') === 'list' ? 'list' : 'board';
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
  if (state.days !== 14) p.set('j', state.days);
  if (state.tier) p.set('n', state.tier);
  if (state.view !== 'board') p.set('v', state.view);
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

function windowDays() {
  const out = [];
  const start = parseDay(todayISO());
  for (let i = 0; i < state.days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}

function matches(ev) {
  if (ev.interest.tier < state.tier) return false;
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
      <span class="ev-top"><span class="ev-name">${esc(head)}</span></span>
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

function renderList(byDay, days) {
  $('#agenda').innerHTML = days.map((iso) => {
    const list = byDay.get(iso) || [];
    return `<div><h3>${esc(dayLabel(iso))}</h3><div class="rows">${list.map((ev) => eventButton(ev)).join('')}</div></div>`;
  }).join('');
}

function renderPlanning() {
  const all = store.data.events.filter(matches);
  const inWindow = new Set(windowDays());
  const kept = all.filter((ev) => inWindow.has(ev.night));

  const byDay = new Map();
  for (const ev of kept) {
    if (!byDay.has(ev.night)) byDay.set(ev.night, []);
    byDay.get(ev.night).push(ev);
  }
  for (const list of byDay.values()) list.sort((a, b) => b.interest.score - a.interest.score);

  // Les jours vides ne sont pas affiches : sur trois mois et le filtre le plus
  // serre, la vue tombe de 90 colonnes a une douzaine.
  const days = windowDays().filter((iso) => byDay.has(iso));

  const board = state.view === 'board';
  $('#board-wrap').hidden = !board || !days.length;
  $('#agenda').hidden = board || !days.length;
  $('#empty').hidden = days.length > 0;

  if (days.length) (board ? renderBoard : renderList)(byDay, days);

  const n = kept.length;
  $('#planning-sub').textContent =
    `${n} soirée${n > 1 ? 's' : ''} · ${days.length} jour${days.length > 1 ? 's' : ''} avec quelque chose`;
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
      canvas.title = `${card.title} — ${card.venue}`;
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
    return `<li>${img}<span class="who${i === 0 ? ' head' : ''}">${esc(slot.name)}</span></li>`;
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

    ${lineup ? `<section><h4>Line up</h4><ul class="lineup">${lineup}</ul></section>` : ''}

    ${links ? `<section><h4>Y aller</h4><div class="links">${links}</div></section>` : ''}

    <p class="soon">Favoris — bientôt</p>`;

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

/* ------------------------------------------------------------------ câblage */

function segment(selector, key, cast = Number) {
  document.querySelectorAll(selector).forEach((btn) => {
    btn.addEventListener('click', () => {
      state[key] = cast(btn.dataset[key]);
      document.querySelectorAll(selector).forEach((b) => b.classList.toggle('is-active', b === btn));
      expanded.clear();
      writeHash();
      renderPlanning();
    });
  });
}

function wire() {
  segment('[data-days]', 'days');
  segment('[data-tier]', 'tier');
  segment('[data-view]', 'view', String);

  let timer;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = e.target.value.trim();
      writeHash();
      renderPlanning();
    }, 180);
  });

  // Une seule ecoute pour tout le document : les cartes du planning et celles
  // du rail sont recreees a chaque rendu, y attacher un handler chacune
  // fuirait.
  document.addEventListener('click', (e) => {
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

async function boot() {
  readHash();
  try {
    await chargerVille(state.city);
  } catch (err) {
    $('#error').hidden = false;
    $('#error').textContent = `Impossible de charger le planning : ${err.message}. Lance « python -m reload scan » puis sers le dossier avec un serveur HTTP.`;
    return;
  }

  document.querySelectorAll('[data-city]').forEach((b) => b.classList.toggle('is-active', b.dataset.city === state.city));
  document.querySelectorAll('[data-days]').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.days) === state.days));
  document.querySelectorAll('[data-tier]').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.tier) === state.tier));
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('is-active', b.dataset.view === state.view));
  $('#q').value = state.q;

  wire();
  renderPlanning();
  renderRail();

  if (state.event) openSheet(state.event);
}

boot();
