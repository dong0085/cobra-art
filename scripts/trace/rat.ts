// Rat: the fur is drawn with open strokes, so flood fill alone leaks into the background.
// Instead: close the outline, lift the whiskers out as their own lines, split the body
// with hand-placed part shapes, and add soft "volumes" that shape the body in 3D.
import { absorbUnlabeled, countAreas, inkMask, labelComponents, morph, removeSpecks } from './raster.ts';
import { buildRegions, inkPath, insidePolygon, loadPng, polygonPath, pts, writeArt, type AreaStats } from './output.ts';
import type { Pt } from './contour.ts';

const SOURCE = 'reference/rat-lineart.png';
const INK_THRESHOLD = 170;
const MIN_REGION = 20;
const MIN_SPECK = 12;
const OPEN_RADIUS = 4; // px; strokes thinner than this stick out of the body and get cut off as "loose" ink
const WHISKER_MIN_LENGTH = 30; // px
const WHISKER_REACH = 330; // px from the snout

// Hand-placed landmarks for reference/rat-lineart.png (1024 × 1536).
const SNOUT = { x: 790, y: 388 };
const EYE = { x: 566, y: 262, r: 42 };
const NOSE = { x: 788, y: 382, r: 26 };
const TAIL_HOLE = { x: 880, y: 1300 }; // background showing through the curl of the tail

/** Bare skin: ears, paws, feet, tail. */
const SKIN = {
  earLeft: pts(232, 110, 250, 45, 300, 16, 370, 18, 422, 55, 446, 110, 432, 170, 400, 215, 362, 250, 330, 266, 285, 248, 250, 210, 234, 160),
  earRight: pts(545, 100, 566, 42, 606, 12, 656, 16, 690, 55, 694, 115, 682, 160, 662, 188, 620, 160, 580, 130),
  pawLeft: pts(402, 930, 445, 915, 482, 930, 498, 965, 492, 1020, 460, 1026, 428, 994, 404, 952),
  pawRight: pts(500, 915, 540, 890, 582, 885, 590, 910, 568, 955, 532, 980, 500, 980, 494, 945),
  footLeft: pts(36, 1452, 68, 1402, 150, 1382, 240, 1372, 330, 1382, 334, 1422, 252, 1442, 182, 1454, 132, 1470, 58, 1474),
  footRight: pts(512, 1420, 558, 1366, 622, 1372, 664, 1428, 706, 1480, 694, 1520, 600, 1524, 528, 1502, 506, 1460),
  tail: pts(812, 1120, 882, 1136, 962, 1186, 1010, 1258, 1006, 1352, 964, 1426, 882, 1462, 760, 1466, 696, 1460, 690, 1398, 760, 1398, 858, 1402, 926, 1358, 956, 1290, 926, 1222, 860, 1182, 812, 1178),
};
const PAWS = [SKIN.pawLeft, SKIN.pawRight, SKIN.footLeft, SKIN.footRight];

/** Soft volumes added on top of the inflated silhouette (lift: how much they stand out; negative flattens). */
const VOLUMES: { lift: number; poly: Pt[] }[] = [
  { lift: 0.35, poly: pts(330, 250, 440, 120, 560, 100, 680, 175, 760, 290, 815, 370, 800, 430, 740, 475, 640, 500, 540, 480, 430, 430, 340, 350) },
  { lift: 0.55, poly: pts(300, 720, 380, 690, 440, 760, 470, 850, 495, 960, 470, 1020, 420, 990, 380, 900, 320, 820) },
  { lift: 0.55, poly: pts(560, 700, 640, 690, 680, 760, 640, 850, 590, 920, 530, 975, 500, 950, 520, 860, 545, 780) },
  { lift: 0.4, poly: pts(500, 1050, 600, 980, 720, 990, 800, 1080, 820, 1200, 790, 1320, 700, 1380, 580, 1370, 500, 1290, 470, 1170) },
  { lift: 0.25, poly: SKIN.footLeft },
  { lift: 0.25, poly: SKIN.footRight },
  { lift: -0.65, poly: SKIN.earLeft },
  { lift: -0.65, poly: SKIN.earRight },
];

const near = (p: Pt, c: { x: number; y: number; r: number }) => Math.hypot(p.x - c.x, p.y - c.y) < c.r;

const { raster: r, rgba } = loadPng(SOURCE);
const W = r.width;
const N = W * r.height;

// 1. Ink lines.
const ink = inkMask(rgba, r, INK_THRESHOLD);
removeSpecks(ink, r, MIN_SPECK);

// 2. Close the outline: with the lines 1 px thicker, the background no longer leaks into the body.
const thick = morph(ink, r, 1);
const fill = labelComponents(thick, r, 0);
const bgLabels = new Set([0, W - 1, N - W, N - 1, TAIL_HOLE.y * W + TAIL_HOLE.x].map((i) => fill.labels[i]));
const solid = new Uint8Array(N);
for (let i = 0; i < N; i++) solid[i] = bgLabels.has(fill.labels[i]) ? 0 : 1;

// 3. Whiskers: thin ink that an opening (shrink, then grow) cuts off the body, near the snout.
const opened = morph(morph(solid, r, OPEN_RADIUS, true), r, OPEN_RADIUS);
const core = largestComponent(opened);
const loose = new Uint8Array(N);
for (let i = 0; i < N; i++) loose[i] = ink[i] && !core[i] ? 1 : 0;
const pieces = labelComponents(loose, r, 1);
const whiskerPx = new Uint8Array(N);
const whiskers: Pt[][] = [];
for (const piece of groupPixels(pieces.labels, pieces.count)) {
  const polyline = whiskerPolyline(piece);
  if (!polyline) continue;
  whiskers.push(polyline);
  for (const i of piece) whiskerPx[i] = 1;
}

// 4. The body: everything inside the outline except the whiskers (fur tufts stay attached).
const whiskerHalo = morph(whiskerPx, r, 2);
const bodyRaw = new Uint8Array(N);
for (let i = 0; i < N; i++) bodyRaw[i] = solid[i] && !whiskerHalo[i] ? 1 : 0;
const body = largestComponent(bodyRaw);

// 5. Areas between strokes, inside the body; the ink is shared out between them.
const gaps = new Uint8Array(N);
for (let i = 0; i < N; i++) gaps[i] = body[i] && !ink[i] ? 1 : 0;
const { labels, count } = labelComponents(gaps, r, 1);
const areas = countAreas(labels, count);
for (let i = 0; i < N; i++) {
  if (!body[i]) labels[i] = -2; // background: never claimed
  else if (labels[i] >= 0 && areas[labels[i]] < MIN_REGION) labels[i] = -1;
}
absorbUnlabeled(labels, r);

// 6. Cut the areas along the skin shapes, so ears, paws, feet and tail become their own blocks.
const skinPolys = Object.values(SKIN);
const NOSE_PART = skinPolys.length + 1;
const split = new Map<number, number>();
const partOf = new Map<number, number>();
for (let y = 0; y < r.height; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (labels[i] < 0) continue;
    const p = { x: x + 0.5, y: y + 0.5 };
    const part = near(p, NOSE) ? NOSE_PART : skinPolys.findIndex((poly) => insidePolygon(p, poly)) + 1;
    const key = labels[i] * 16 + part;
    let next = split.get(key);
    if (next === undefined) split.set(key, (next = split.size));
    partOf.set(next, part);
    labels[i] = next;
  }
}

function classify({ label, area, box, center }: AreaStats): string {
  const part = partOf.get(label)!;
  if (part === NOSE_PART) return 'nose';
  if (near(center, EYE)) return 'eye';
  const long = Math.max(box.x1 - box.x0, box.y1 - box.y0) / Math.max(1, Math.min(box.x1 - box.x0, box.y1 - box.y0));
  if (area < 300 && long >= 1.3 && PAWS.some((poly) => insidePolygon(center, poly))) return 'claw';
  return part > 0 ? 'skin' : 'fur';
}
const regions = buildRegions(labels, r, classify);

// 7. Line work inside the body only (whiskers and stray marks outside are handled separately).
const bodyInk = new Uint8Array(N);
for (let i = 0; i < N; i++) bodyInk[i] = ink[i] && body[i] ? 1 : 0;

const extra =
  VOLUMES.map((v) => `<path class="volume" data-lift="${v.lift}" d="${polygonPath(v.poly)}"/>`).join('\n') +
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
console.log(`${whiskers.length} whiskers, ${VOLUMES.length} volumes`);

// ---------- helpers ----------

function largestComponent(mask: Uint8Array): Uint8Array {
  const comp = labelComponents(mask, r, 1);
  const a = countAreas(comp.labels, comp.count);
  const biggest = a.indexOf(Math.max(...a));
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = comp.labels[i] === biggest ? 1 : 0;
  return out;
}

function groupPixels(lab: Int32Array, n: number): number[][] {
  const groups: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < N; i++) if (lab[i] >= 0) groups[lab[i]].push(i);
  return groups;
}

/** A whisker piece → points from root to tip, or null if the piece isn't a whisker. */
function whiskerPolyline(piece: number[]): Pt[] | null {
  const dist = (i: number) => Math.hypot((i % W) - SNOUT.x, Math.floor(i / W) - SNOUT.y);
  let near0 = Infinity;
  let far = 0;
  for (const i of piece) {
    const d = dist(i);
    near0 = Math.min(near0, d);
    far = Math.max(far, d);
  }
  if (near0 > WHISKER_REACH || far - near0 < WHISKER_MIN_LENGTH) return null;
  // Whiskers fan out from the snout: average the pixels in rings of growing distance.
  const STEP = 6;
  const rings = new Map<number, { x: number; y: number; n: number }>();
  for (const i of piece) {
    const k = Math.floor((dist(i) - near0) / STEP);
    const ring = rings.get(k) ?? { x: 0, y: 0, n: 0 };
    ring.x += i % W;
    ring.y += Math.floor(i / W);
    ring.n++;
    rings.set(k, ring);
  }
  return [...rings.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, ring]) => ({ x: ring.x / ring.n + 0.5, y: ring.y / ring.n + 0.5 }));
}
