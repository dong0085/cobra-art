// Rat: the fur is drawn with open strokes, so flood fill alone leaks into the background.
// Two images go in:
//   reference/rat-lineart.png  – the line work
//   reference/rat-parts.png    – the same drawing with each body part filled in its own flat colour
// The part map gives the silhouette and says which part every pixel belongs to (skin, fur, eye, nose);
// each fur part (head, arms, haunches) becomes a soft 3D bulge.
// The drawing has no whiskers, so they are generated from the snout.
import { absorbUnlabeled, countAreas, inkMask, labelComponents, morph, removeSpecks } from './raster.ts';
import { buildRegions, inkPath, loadPng, writeArt, type AreaStats } from './output.ts';
import { simplifyLoop, smoothPath, traceLoops, type Pt } from './contour.ts';

const SOURCE = 'reference/rat-lineart.png';
const PART_MAP = 'reference/rat-parts.png';
const INK_THRESHOLD = 170;
const MIN_REGION = 20;
const MIN_SPECK = 12;
const COLOR_TOLERANCE = 70; // how far (RGB distance) a map pixel may be from its part colour
const MIN_PART = 150; // px; smaller pieces of a part colour are blends at a junction, not a real part

/**
 * The colours of the part map. `kind`: the block kind. `lift`: how much the part bulges out of the body
 * (negative flattens or cups it); 0 adds no volume.
 */
const PARTS: { name: string; color: string; kind: string; lift: number }[] = [
  { name: 'body', color: '#00ff00', kind: 'fur', lift: 0 },
  { name: 'head', color: '#ff0000', kind: 'fur', lift: 0.35 },
  { name: 'arm left', color: '#0000ff', kind: 'fur', lift: 0.5 },
  { name: 'arm right', color: '#ffff00', kind: 'fur', lift: 0.5 },
  { name: 'haunch left', color: '#ff00ff', kind: 'fur', lift: 0.35 },
  { name: 'haunch right', color: '#00ffff', kind: 'fur', lift: 0.45 },
  { name: 'paw left', color: '#8a4404', kind: 'skin', lift: 0.25 },
  { name: 'paw right', color: '#828204', kind: 'skin', lift: 0.25 },
  { name: 'foot left', color: '#048484', kind: 'skin', lift: 0.2 },
  { name: 'foot right', color: '#940444', kind: 'skin', lift: 0.2 },
  { name: 'tail', color: '#7cfc04', kind: 'skin', lift: 0 },
  { name: 'ear left', color: '#fc7c04', kind: 'skin', lift: -0.6 },
  { name: 'ear left inside', color: '#fc74b4', kind: 'skin', lift: -0.35 },
  { name: 'ear right', color: '#7404fc', kind: 'skin', lift: -0.6 },
  { name: 'ear right inside', color: '#bc80fc', kind: 'skin', lift: -0.35 },
  { name: 'eye', color: '#444444', kind: 'eye', lift: 0 },
  { name: 'nose', color: '#040494', kind: 'nose', lift: 0 },
];
/** Ears are flattened as a whole (outside + inside together), then the inside is cupped. */
const EAR_GROUPS = [
  ['ear left', 'ear left inside'],
  ['ear right', 'ear right inside'],
];
const PAWS = ['paw left', 'paw right', 'foot left', 'foot right'];

/** Generated whiskers (art units of reference/rat-lineart.png, 1024 × 1536): roots spread over the muzzle, fanning out to the right with a slight droop. */
const WHISKERS = {
  count: 16,
  roots: { x: 760, y: 392, spreadX: 26, spreadY: 20 },
  angles: [-0.55, 0.75], // radians from horizontal (y down): up-right … down-right
  length: [170, 320],
  droop: 0.22, // how much each whisker curves down along its length
  seed: 7,
};

const { raster: r, rgba } = loadPng(SOURCE);
const { raster: mapRaster, rgba: mapRgba } = loadPng(PART_MAP);
if (mapRaster.width !== r.width || mapRaster.height !== r.height) throw new Error(`${PART_MAP} must be ${r.width}×${r.height}`);
const W = r.width;
const N = W * r.height;

// 1. Ink lines.
const ink = inkMask(rgba, r, INK_THRESHOLD);
removeSpecks(ink, r, MIN_SPECK);

// 2. Part map → a part number per pixel (-1: background, -2: unsure, filled in below).
const partColors = PARTS.map((p) => [1, 3, 5].map((k) => parseInt(p.color.slice(k, k + 2), 16)));
const partOf = new Int32Array(N);
for (let i = 0; i < N; i++) {
  const c = [mapRgba[i * 4], mapRgba[i * 4 + 1], mapRgba[i * 4 + 2]];
  const dWhite = Math.hypot(255 - c[0], 255 - c[1], 255 - c[2]);
  let best = -1;
  let bestD = dWhite;
  partColors.forEach((pc, n) => {
    const d = Math.hypot(c[0] - pc[0], c[1] - pc[1], c[2] - pc[2]);
    if (d < bestD) [best, bestD] = [n, d];
  });
  partOf[i] = best >= 0 && bestD > COLOR_TOLERANCE ? -2 : best; // blended edge colours are unsure
}
// Soft edges between two parts blend into a third part's colour (blue + green ≈ teal), so trust a
// pixel only when its neighbours 1–2 px away agree; the rest is filled in from both sides below.
{
  const H = r.height;
  const sure = partOf.slice();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const p = partOf[i];
      if (p < 0) continue;
      for (const [dx, dy] of [[1, 0], [2, 0], [-1, 0], [-2, 0], [0, 1], [0, 2], [0, -1], [0, -2]]) {
        const xx = Math.min(W - 1, Math.max(0, x + dx));
        const yy = Math.min(H - 1, Math.max(0, y + dy));
        const q = partOf[yy * W + xx];
        if (q !== p && q !== -1) {
          sure[i] = -2;
          break;
        }
      }
    }
  }
  partOf.set(sure);
  // Where three parts meet, a blend can form a small blob of a fourth colour: drop pieces under MIN_PART px.
  const seen = new Uint8Array(N);
  for (let start = 0; start < N; start++) {
    if (partOf[start] < 0 || seen[start]) continue;
    const p = partOf[start];
    const piece = [start];
    seen[start] = 1;
    for (let k = 0; k < piece.length; k++) {
      const i = piece[k];
      const x = i % W;
      for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (n < 0 || n >= N || seen[n] || partOf[n] !== p) continue;
        seen[n] = 1;
        piece.push(n);
      }
    }
    if (piece.length < MIN_PART) for (const i of piece) partOf[i] = -2;
  }
}

// 3. The body: everything painted in the part map, plus the line work along its edge.
//    (The outline itself has gaps, so it can't be closed by flood fill alone.)
const painted = new Uint8Array(N);
for (let i = 0; i < N; i++) painted[i] = partOf[i] === -1 ? 0 : 1;
const nearPaint = morph(painted, r, 3);
const solid = new Uint8Array(N);
for (let i = 0; i < N; i++) solid[i] = painted[i] || (ink[i] && nearPaint[i]) ? 1 : 0;
const body = largestComponent(solid);

// 4. Every body pixel gets a part: unsure or unpainted ones take the nearest painted part.
for (let i = 0; i < N; i++) if (!body[i]) partOf[i] = -3;
else if (partOf[i] === -1) partOf[i] = -2;
spreadInto(partOf, -2);

// 5. Areas between strokes, cut along part edges, so each block lies in one part.
const gaps = new Uint8Array(N);
for (let i = 0; i < N; i++) gaps[i] = body[i] && !ink[i] ? 1 : 0;
const { labels, count } = labelComponents(gaps, r, 1);
const areas = countAreas(labels, count);
for (let i = 0; i < N; i++) {
  if (!body[i]) labels[i] = -2; // background: never claimed
  else if (labels[i] >= 0 && areas[labels[i]] < MIN_REGION) labels[i] = -1;
}
absorbUnlabeled(labels, r);
const split = new Map<number, number>();
const blockPart = new Map<number, number>();
for (let i = 0; i < N; i++) {
  if (labels[i] < 0) continue;
  const key = labels[i] * 64 + partOf[i];
  let next = split.get(key);
  if (next === undefined) split.set(key, (next = split.size));
  blockPart.set(next, partOf[i]);
  labels[i] = next;
}

function classify({ label, area, box }: AreaStats): string {
  const part = PARTS[blockPart.get(label)!];
  const long = Math.max(box.x1 - box.x0, box.y1 - box.y0) / Math.max(1, Math.min(box.x1 - box.x0, box.y1 - box.y0));
  if (PAWS.includes(part.name) && area < 300 && long >= 1.3) return 'claw'; // small closed shapes at the tips of toes
  return part.kind;
}
const regions = buildRegions(labels, r, classify);

// 6. Volumes: each part's outline, with its lift. Ears are flattened whole, then cupped inside.
const volumes: string[] = [];
const addVolume = (names: string[], lift: number) => {
  const ids = names.map((n) => PARTS.findIndex((p) => p.name === n));
  const mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) mask[i] = ids.includes(partOf[i]) ? 1 : 0;
  const loops = traceLoops({ x0: 0, y0: 0, x1: W, y1: r.height }, (x, y) => x >= 0 && y >= 0 && x < W && y < r.height && mask[y * W + x] === 1);
  const big = loops.filter((loop) => loop.length > 40);
  if (big.length) volumes.push(`<path class="volume" data-lift="${lift}" d="${big.map((loop) => smoothPath(simplifyLoop(loop, 1.5))).join('')}"/>`);
};
for (const part of PARTS) if (part.lift > 0) addVolume([part.name], part.lift);
for (const group of EAR_GROUPS) {
  addVolume(group, PARTS.find((p) => p.name === group[0])!.lift);
  addVolume([group[1]], PARTS.find((p) => p.name === group[1])!.lift);
}

// 7. Whiskers.
const whiskers = makeWhiskers();

// 8. Line work inside the body only.
const bodyInk = new Uint8Array(N);
for (let i = 0; i < N; i++) bodyInk[i] = ink[i] && body[i] ? 1 : 0;

const extra =
  volumes.join('\n') +
  '\n' +
  whiskers.map((w) => `<path class="whisker" d="M${w.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L')}"/>`).join('\n') +
  '\n';

writeArt({
  name: 'rat',
  label: 'Rat',
  raster: r,
  regions,
  ink: inkPath(bodyInk, r).d,
  extra,
  form: 'inflate',
  colors: { fur: '#c8b6a6', skin: '#f4a7a0', eye: '#264653', nose: '#e76f51', claw: '#e9c46a' },
});
console.log(`${whiskers.length} whiskers, ${volumes.length} volumes`);

// ---------- helpers ----------

function largestComponent(mask: Uint8Array): Uint8Array {
  const comp = labelComponents(mask, r, 1);
  const a = countAreas(comp.labels, comp.count);
  const biggest = a.indexOf(Math.max(...a));
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = comp.labels[i] === biggest ? 1 : 0;
  return out;
}

/** Replaces every `unknown` value with the nearest known (≥ 0) neighbour's value. */
function spreadInto(values: Int32Array, unknown: number) {
  let frontier: number[] = [];
  for (let i = 0; i < N; i++) if (values[i] >= 0) frontier.push(i);
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % W;
      for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (n < 0 || n >= N || values[n] !== unknown) continue;
        values[n] = values[i];
        next.push(n);
      }
    }
    frontier = next;
  }
}

function makeWhiskers(): Pt[][] {
  let s = WHISKERS.seed;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const { roots, angles, length, droop, count } = WHISKERS;
  const out: Pt[][] = [];
  for (let k = 0; k < count; k++) {
    const f = (k + 0.5) / count;
    // Upper whiskers grow from higher on the muzzle.
    const root = {
      x: roots.x + (rand() - 0.5) * roots.spreadX,
      y: roots.y + (f - 0.5) * roots.spreadY * 2 + (rand() - 0.5) * 6,
    };
    const angle = angles[0] + (angles[1] - angles[0]) * f + (rand() - 0.5) * 0.12;
    const len = length[0] + (length[1] - length[0]) * (0.4 + 0.6 * Math.sin(Math.PI * f)) * (0.85 + rand() * 0.3);
    const bend = droop * (0.7 + rand() * 0.6);
    const line: Pt[] = [];
    for (let j = 0; j <= 24; j++) {
      const t = j / 24;
      const a = angle + bend * t; // turns downward along the way (y down)
      const prev = line[line.length - 1] ?? root;
      const step = len / 24;
      line.push(j === 0 ? root : { x: prev.x + Math.cos(a) * step, y: prev.y + Math.sin(a) * step });
    }
    out.push(line);
  }
  return out;
}
