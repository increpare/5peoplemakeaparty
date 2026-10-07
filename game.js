const S = 100, VARIANTS = 5;
// exactly 3 of each article: 45 pieces = 15 outfits = 5 trios, on a board with no spare cells
const COLS = 5, ROWS = 9;
const KINDS = ['hat', 'jacket', 'pants'];
const SVGNS = 'http://www.w3.org/2000/svg';

// ---------- artwork: edit the standalone SVG files in graphics/ ----------
// Clothing uses a 100x100 viewBox, shared by board tiles and assembled guests.
// Array order identifies the five variants; keep it consistent when replacing art.
const ART = {
  hat: [
    'graphics/hats/top-hat.svg',
    'graphics/hats/bobble-hat.svg',
    'graphics/hats/baseball-cap.svg',
    'graphics/hats/straw-hat.svg',
    'graphics/hats/party-hat.svg',
  ],
  jacket: [
    'graphics/jackets/blazer.svg',
    'graphics/jackets/hoodie.svg',
    'graphics/jackets/striped-jacket.svg',
    'graphics/jackets/vest.svg',
    'graphics/jackets/trench-coat.svg',
  ],
  pants: [
    'graphics/pants/jeans.svg',
    'graphics/pants/shorts.svg',
    'graphics/pants/flared-pants.svg',
    'graphics/pants/skirt.svg',
    'graphics/pants/harem-pants.svg',
  ],
};

// SVG image references work both on a web server and when index.html is opened locally.
function svgImage(src, x = 0, y = 0, width = S, height = S) {
  return `<image href="${src}" x="${x}" y="${y}" width="${width}" height="${height}"/>`;
}

function personArt(h, j, p) {
  return svgImage('graphics/person-body.svg') +
    svgImage(ART.pants[p], 29, 55, 42, 42) +
    svgImage('graphics/person-arms.svg') +
    svgImage(ART.jacket[j], 29, 27, 42, 42) +
    svgImage('graphics/person-face.svg') +
    svgImage(ART.hat[h], 30, -9, 40, 40);
}

function blockMarkup(b) {
  const inset = b.kind === 'outfit' ? 5 : 4;
  // This transparent outline is styled by CSS while a tile is held.
  const tile = svgImage(`graphics/tiles/${b.kind}.svg`) +
    `<rect class="tile" x="${inset}" y="${inset}" width="${S - 2 * inset}" height="${S - 2 * inset}" rx="14" fill="none" stroke="transparent"/>`;
  return tile + (b.kind === 'outfit' ? personArt(b.h, b.j, b.p) : svgImage(ART[b.kind][b.v]));
}

// ---------- state & layout ----------
const $ = id => document.getElementById(id);
const board = $('board'), stage = $('stage'), party = $('party');
const SEATS = 5, START_MINUTES = 18 * 60, PARTY_H = 160;
const W = COLS * S, H = ROWS * S;
let grid, seats, swipes, over, busy = false;
let undoState = null; // the position before the latest swipe; only one step is kept

stage.setAttribute('viewBox', `0 0 ${W} ${PARTY_H + H}`);
stage.style.aspectRatio = `${W} / ${PARTY_H + H}`;
stage.style.width = `min(100%, calc((100vh - 100px) * ${W / (PARTY_H + H)}))`;
board.setAttribute('transform', `translate(0,${PARTY_H})`);

const rand = n => Math.floor(Math.random() * n);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');

// ---------- party table ----------
const chairX = i => W / 2 + (i - 2) * Math.min(120, (W - 80) / 4);
function drawParty() {
  let chairs = '', guests = '';
  for (let i = 0; i < SEATS; i++) {
    chairs += svgImage('graphics/chair.svg', chairX(i) - 32, 28, 64, 84);
    if (seats[i]) guests += `<g transform="translate(${chairX(i) - 55},2) scale(1.1)">${personArt(...seats[i])}</g>`;
  }
  const x0 = chairX(0) - 50, x1 = chairX(SEATS - 1) + 50;
  party.innerHTML = chairs + guests + svgImage('graphics/table.svg', x0, 98, x1 - x0, 40);
}
function clockText() {
  const m = START_MINUTES + swipes;
  return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
}
function updateHud() {
  $('clock').textContent = clockText();
  $('undo').style.opacity = undoState ? 1 : 0.35;
  drawParty();
}

// ---------- board ----------
const place = (b, r, c) => { b.el.style.transform = `translate(${c * S}px, ${r * S}px)`; };

function makeBlock(data, r, c) {
  const el = document.createElementNS(SVGNS, 'g');
  el.setAttribute('class', 'block');
  el.innerHTML = blockMarkup(data);
  board.appendChild(el);
  const b = { ...data, el };
  place(b, r, c);
  return b;
}

// rebuild the board from rows of piece descriptions (null = empty cell)
function setGrid(cells) {
  board.innerHTML = '';
  grid = cells.map((row, r) => row.map((d, c) => d && makeBlock(d, r, c)));
}

function newGame() {
  seats = []; swipes = 0; over = false; undoState = null;
  $('win').classList.remove('show');
  updateHud();
  // redeal until the opening board has no ready-made outfit stack
  const stacked = d => d.some((p, i) => p.kind === 'pants' &&
    d[i - COLS]?.kind === 'jacket' && d[i - 2 * COLS]?.kind === 'hat');
  let deal;
  do {
    deal = KINDS.flatMap(kind => Array.from({ length: VARIANTS * 3 }, (_, i) => ({ kind, v: i % VARIANTS })));
    for (let i = deal.length - 1; i > 0; i--) {
      const k = rand(i + 1);
      [deal[i], deal[k]] = [deal[k], deal[i]];
    }
  } while (stacked(deal));
  setGrid(Array.from({ length: ROWS }, (_, r) => deal.slice(r * COLS, (r + 1) * COLS)));
}

// ---------- rules ----------
// the three cells starting at (r, c) and heading in direction (dr, dc)
const trio = (r, c, dr, dc) => [0, 1, 2].map(i => grid[r + i * dr]?.[c + i * dc]);
const outfitKey = b => b?.kind === 'outfit' ? `${b.h}-${b.j}-${b.p}` : null;

// hat over jacket over pants, top to bottom
function findMerges() {
  const out = [];
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r + 2 < ROWS; r++) {
      const parts = trio(r, c, 1, 0);
      if (parts.every((b, i) => b?.kind === KINDS[i])) out.push({ r, c, parts });
    }
  return out;
}

// every outfit in a row or column run of three or more identical outfits
function findMatches() {
  const hit = new Set();
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const run = trio(r, c, dr, dc), key = outfitKey(run[0]);
        if (key && run.every(b => outfitKey(b) === key)) run.forEach(b => hit.add(b));
      }
  return hit;
}

async function applyGravity() {
  let moved = false;
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const b = grid[r][c];
      if (!b) continue;
      if (write !== r) {
        grid[r][c] = null;
        grid[write][c] = b;
        place(b, write, c);
        moved = true;
      }
      write--;
    }
  }
  if (moved) await sleep(220);
}

async function mergeOutfits() {
  const merges = findMerges();
  if (!merges.length) return false;
  for (const { r, c, parts: [hat, jacket] } of merges) {
    for (const b of [hat, jacket]) { place(b, r + 2, c); b.el.style.opacity = 0; }
    grid[r][c] = grid[r + 1][c] = null;
  }
  await sleep(200);
  for (const { r, c, parts } of merges) {
    for (const b of parts) b.el.remove();
    const [h, j, p] = parts.map(b => b.v);
    grid[r + 2][c] = makeBlock({ kind: 'outfit', h, j, p }, r + 2, c);
  }
  await sleep(120);
  return true;
}

async function seatGuests() {
  const matches = findMatches();
  if (!matches.size) return false;
  for (const b of matches) b.el.style.opacity = 0;
  await sleep(220);
  for (const b of matches) b.el.remove();
  grid = grid.map(row => row.map(b => matches.has(b) ? null : b));
  // one guest takes a seat per distinct outfit cleared
  const guests = new Map([...matches].map(b => [outfitKey(b), [b.h, b.j, b.p]]));
  seats.push(...[...guests.values()].slice(0, SEATS - seats.length));
  updateHud();
  return true;
}

async function resolve() {
  while (await mergeOutfits() || await seatGuests()) await applyGravity();
}

// a block may swap with any neighbour, or slide sideways into an empty cell; never up into the void
function canSwap(r1, r2, c2) {
  const target = grid[r2]?.[c2]; // undefined off the board, null when empty
  return target !== undefined && (target !== null || r1 === r2);
}

async function swap(r1, c1, r2, c2) {
  busy = true;
  undoState = {
    cells: grid.map(row => row.map(b => b && { kind: b.kind, v: b.v, h: b.h, j: b.j, p: b.p })),
    seats: [...seats],
    swipes,
  };
  swipes++;
  updateHud();
  const a = grid[r1][c1], b = grid[r2][c2];
  grid[r1][c1] = b; grid[r2][c2] = a;
  place(a, r2, c2);
  if (b) place(b, r1, c1);
  await sleep(190);
  await applyGravity();
  await resolve();
  busy = false;
  if (seats.length >= SEATS) {
    over = true;
    $('winText').textContent = `Everyone was seated by ${clockText()}.`;
    $('win').classList.add('show');
  }
}

function undo() {
  if (busy || over || !undoState) return;
  setGrid(undoState.cells);
  ({ seats, swipes } = undoState);
  undoState = null;
  updateHud();
}

// ---------- input: press a block, swipe towards a neighbour ----------
let drag = null;

function cellAt(e) {
  // measure from the stage's CSS box: getScreenCTM disagrees between browsers, and the
  // board's own bounding rect only covers the blocks still on it
  const box = stage.getBoundingClientRect(), k = box.width / W;
  return {
    r: Math.floor(((e.clientY - box.top) / k - PARTY_H) / S),
    c: Math.floor((e.clientX - box.left) / k / S),
    size: S * k,
  };
}

function endDrag() {
  drag?.block.el.classList.remove('held');
  drag = null;
}

board.addEventListener('pointerdown', e => {
  if (busy || over) return;
  const { r, c, size } = cellAt(e), block = grid[r]?.[c];
  if (!block) return;
  drag = { r, c, x: e.clientX, y: e.clientY, size, block };
  block.el.classList.add('held');
  board.appendChild(block.el); // draw on top while swapping
  board.setPointerCapture(e.pointerId);
});

board.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < drag.size * 0.3) return;
  const { r, c } = drag;
  const horizontal = Math.abs(dx) > Math.abs(dy);
  const r2 = r + (horizontal ? 0 : Math.sign(dy)), c2 = c + (horizontal ? Math.sign(dx) : 0);
  endDrag();
  if (canSwap(r, r2, c2)) swap(r, c, r2, c2);
});

board.addEventListener('pointerup', endDrag);
board.addEventListener('pointercancel', endDrag);

$('restart').addEventListener('click', () => { if (!busy) newGame(); });
$('undo').addEventListener('click', undo);
$('again').addEventListener('click', newGame);

newGame();
