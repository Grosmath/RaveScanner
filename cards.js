/* Le dessin des cartes ENCORE, en 1080 x 1350 (le 4:5 d'Instagram).
 *
 * Source unique, deux livraisons : la planche du Weekly Rewind inline ce
 * fichier pour rester autonome quand on l'ouvre en file://, et le site le
 * charge par <script src>. Une carte vue sur le site est donc, au pixel pres,
 * celle qui part sur Instagram.
 *
 * Aucune dependance, aucun import : le fichier definit ses fonctions dans la
 * portee globale et expose l'essentiel via window.ENCORE_CARDS.
 */

const W = 1080, H = 1350, PAD = 88;
const C = { bg:'#08080a', surface:'#101013', text:'#eeeef1', dim:'#85858f',
            line:'#26262d', accent:'#d8ff2e', hot:'#ff3b52' };

const sans = (size, weight) => weight + ' ' + size + 'px "Space Grotesk", Arial, sans-serif';
const mono = (size, weight) => weight + ' ' + size + 'px "JetBrains Mono", Consolas, monospace';

function track(ctx, px) {
  // letterSpacing n'existe que sur Chrome 99+. Ailleurs on perd le pistage,
  // pas le texte.
  if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px';
}

function wrap(ctx, text, maxWidth, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const attempt = line ? line + ' ' + word : word;
    if (ctx.measureText(attempt).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = attempt;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines) {
    // Derniere ligne : on rogne au caractere plutot que de deborder.
    let last = lines[maxLines - 1];
    if (ctx.measureText(last).width > maxWidth) {
      while (last.length > 1 && ctx.measureText(last + '…').width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = last.replace(/\s+$/, '') + '…';
    }
  }
  return lines;
}

function masthead(ctx, rule) {
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = sans(44, 700);
  track(ctx, -1.5);
  ctx.fillStyle = C.text;
  ctx.fillText('ENCO', PAD, 132);
  ctx.fillStyle = C.accent;
  ctx.fillText('RE', PAD + ctx.measureText('ENCO').width, 132);
  track(ctx, 0);
  if (rule) {
    ctx.fillStyle = C.line;
    ctx.fillRect(PAD, 178, W - PAD * 2, 2);
  }
}

// Recadrage "cover" : l'image remplit la zone sans se deformer, le
// debordement est rogne. Le decoupage n'est pas optionnel - un carre de 640
// mis a l'echelle d'une bande de 1080 de large fait 1080 de haut, soit 260 px
// qui debordent de chaque cote. Sans clip, la photo passait sous le texte.
function coverDraw(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

// La couverture n'a pas de sujet unique : son fond est la mosaique des visages
// de la semaine, tres assombrie. Faute de photos de Montreal libres de droits,
// ce sont les artistes eux-memes qui font l'image - ce qui dit mieux ce qu'il y
// a dans le carrousel qu'une vue de la ville.
function drawMosaic(ctx, imgs) {
  const usable = imgs.filter(Boolean);
  if (!usable.length) return;
  const cols = 3, rows = 3;
  const cw = W / cols, ch = H / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const img = usable[(r * cols + c) % usable.length];
      coverDraw(ctx, img, c * cw, r * ch, cw + 1, ch + 1);
    }
  }
  // Le fond doit rester un fond : le texte passe devant, pas avec.
  ctx.fillStyle = 'rgba(8,8,10,0.82)';
  ctx.fillRect(0, 0, W, H);
  const veil = ctx.createLinearGradient(0, H * 0.35, 0, H);
  veil.addColorStop(0, 'rgba(8,8,10,0)');
  veil.addColorStop(1, 'rgba(8,8,10,0.92)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, H * 0.35, W, H * 0.65);
}

function drawCover(ctx, card, imgs) {
  drawMosaic(ctx, imgs);
  masthead(ctx, false);
  const maxW = W - PAD * 2;

  // RE:WIND plutot que REWIND : le monogramme se detache du mot, comme le RE
  // se detache d'ENCORE.
  ctx.font = sans(146, 700);
  track(ctx, -6);
  ctx.fillStyle = C.text;
  ctx.fillText('WEEKLY', PAD, 640);
  ctx.fillStyle = C.accent;
  ctx.fillText('RE', PAD, 792);
  const reW = ctx.measureText('RE').width;
  ctx.fillStyle = C.text;
  ctx.fillText(':WIND', PAD + reW, 792);
  track(ctx, 0);

  ctx.font = mono(48, 700);
  track(ctx, 3);
  ctx.fillStyle = C.accent;
  ctx.fillText(wrap(ctx, card.subtitle, maxW, 1)[0] || '', PAD, 906);
  track(ctx, 0);

  ctx.fillStyle = C.line;
  ctx.fillRect(PAD, H - 252, W - PAD * 2, 2);
  ctx.font = mono(36, 700);
  track(ctx, 2);
  ctx.fillStyle = C.text;
  ctx.fillText(card.footer, PAD, H - 152);
  if (card.footer2) {
    ctx.fillText(card.footer2, PAD, H - 96);
  }
  track(ctx, 0);

  // Fleche d'appel au balayage, sur la couverture seule : c'est la premiere
  // image du carrousel, la seule ou le lecteur ignore encore qu'il y a une
  // suite. Sur les cartes suivantes elle n'apprendrait plus rien.
  ctx.font = mono(76, 700);
  ctx.fillStyle = C.accent;
  ctx.textAlign = 'right';
  ctx.fillText('→', W - PAD, H - 112);
  ctx.textAlign = 'left';
}

// Le bloc texte est ancre en bas, et la photo occupe tout ce qui reste. Elle
// se dissout dans le noir sur ses 260 derniers pixels : la hauteur de bande
// varie donc d'une carte a l'autre sans que ca se voie.
//
// Les etoiles sont sur la ligne de date et l'horaire sur celle du lieu, cales
// a droite. Ca supprime une ligne entiere du bloc : l'espace gagne part en
// respiration entre les textes, pas en hauteur prise sur la photo.
const FADE = 260;
const FOOT = 78;
const BADGE_H = 84;

function drawEvent(ctx, card, img) {
  const maxW = W - PAD * 2;
  const hasPhoto = !!img;
  const nameSize = hasPhoto ? 92 : 132;
  const lead = hasPhoto ? 100 : 142;

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // 1. Mesurer, en partant du bas.
  ctx.font = sans(nameSize, 700);
  track(ctx, -4);
  const lines = wrap(ctx, card.title, maxW, hasPhoto ? 2 : 3);
  track(ctx, 0);

  const badgeTop = H - FOOT - BADGE_H;
  const venueY = card.reason ? badgeTop - 78 : H - FOOT;
  const supportsY = card.supports ? venueY - 80 : 0;
  // 88 et non 74 : a 92 px de nom pour 36 px de « avec … », un ecart de 74
  // entre lignes de base ne laisse que 8 px de blanc reel. C'est l'ecart
  // optique qui compte, pas l'ecart nominal.
  const nameLast = (card.supports ? supportsY : venueY) - (card.supports ? 88 : 92);
  const nameFirst = nameLast - (lines.length - 1) * lead;
  let dayY = nameFirst - 118;
  const band = dayY - 86;

  let shift = 0;
  if (!hasPhoto) {
    const blockTop = dayY - 46;
    const blockBottom = venueY + 14;
    const top = 240;
    const bottom = card.reason ? badgeTop - 40 : H - FOOT;
    shift = top + (bottom - top - (blockBottom - blockTop)) / 2 - blockTop;
  }
  const at = function (y) { return y + shift; };
  dayY = at(dayY);

  // 2. Dessiner.
  if (hasPhoto) {
    coverDraw(ctx, img, 0, 0, W, band);

    const scrim = ctx.createLinearGradient(0, 0, 0, 230);
    scrim.addColorStop(0, 'rgba(8,8,10,0.88)');
    scrim.addColorStop(1, 'rgba(8,8,10,0)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, W, 230);

    const fade = ctx.createLinearGradient(0, band - FADE, 0, band);
    fade.addColorStop(0, 'rgba(8,8,10,0)');
    fade.addColorStop(1, C.bg);
    ctx.fillStyle = fade;
    ctx.fillRect(0, band - FADE, W, FADE);
  }

  masthead(ctx, !hasPhoto);

  // Plus d'etoiles sur la carte : elles se lisaient comme une note donnee a
  // l'artiste, alors qu'elles ne disaient que sa place dans un classement. Une
  // carte du carrousel est deja une selection - y ajouter un bareme la
  // transforme en jugement.
  ctx.font = mono(46, 700);
  track(ctx, 4);
  ctx.fillStyle = C.accent;
  ctx.fillText(wrap(ctx, card.day, maxW, 1)[0] || '', PAD, dayY);
  track(ctx, 0);

  ctx.font = sans(nameSize, 700);
  track(ctx, -4);
  ctx.fillStyle = C.text;
  lines.forEach(function (line, i) { ctx.fillText(line, PAD, at(nameFirst + i * lead)); });
  track(ctx, 0);

  // Les premieres parties appartiennent au plateau, pas a un encart separe.
  if (card.supports) {
    ctx.font = sans(36, 500);
    ctx.fillStyle = C.dim;
    ctx.fillText(wrap(ctx, 'avec ' + card.supports, maxW, 1)[0], PAD, at(supportsY));
  }

  // Ligne de lieu : lieu a gauche, horaire cale a droite.
  let timeW = 0;
  if (card.time) {
    ctx.font = mono(34, 400);
    track(ctx, 2);
    ctx.fillStyle = C.dim;
    timeW = ctx.measureText(card.time).width + 40;
    ctx.textAlign = 'right';
    ctx.fillText(card.time, W - PAD, at(venueY));
    ctx.textAlign = 'left';
    track(ctx, 0);
  }
  ctx.font = sans(48, 500);
  ctx.fillStyle = C.text;
  ctx.fillText(wrap(ctx, card.venue, maxW - timeW, 1)[0] || '', PAD, at(venueY));

  if (card.reason) {
    ctx.fillStyle = C.surface;
    ctx.fillRect(PAD, badgeTop, W - PAD * 2, BADGE_H);
    ctx.fillStyle = C.accent;
    ctx.fillRect(PAD, badgeTop, 8, BADGE_H);
    ctx.font = sans(38, 500);
    ctx.fillStyle = C.text;
    ctx.fillText(wrap(ctx, card.reason, maxW - 100, 1)[0], PAD + 44, badgeTop + 54);
  }
}

function draw(canvas, card, img, imgs) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  if (card.kind === 'cover') drawCover(ctx, card, imgs);
  else drawEvent(ctx, card, img);
}

// Les photos sont embarquees en data: URI, donc rien ne part sur le reseau -
// mais le decodage reste asynchrone. Dessiner avant qu'il finisse produirait
// une carte sans image, silencieusement.
function loadPhoto(src) {
  if (!src) return Promise.resolve(null);
  return new Promise(function (resolve) {
    const img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { resolve(null); };
    img.src = src;
  });
}

function fileName(card, i) {
  const base = card.kind === 'cover' ? 'couverture' : card.title;
  const slug = base.toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'carte';
  return 'rewind-' + String(i + 1).padStart(2, '0') + '-' + slug + '.png';
}

function save(canvas, name) {
  canvas.toBlob(function (blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }, 'image/png');
}


// Surface publique. `draw(canvas, card, img, imgs)` attend un canvas de
// W x H ; `loadPhoto` resout a null plutot que de rejeter, pour qu'une photo
// manquante coute la photo et pas la carte.
window.ENCORE_CARDS = { W: W, H: H, draw: draw, loadPhoto: loadPhoto };
