// Traces the line-art reference into an SVG where every scale is its own <path>.
//   npm run trace  →  src/art/cobra.svg (used by the site) + out/trace-preview.svg (debug)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { absorbUnlabeled, countAreas, inkMask, labelComponents, removeSpecks, type Raster } from './trace/raster.ts';
import { signedArea, simplifyLoop, smoothPath, traceLoops, type Pt } from './trace/contour.ts';
import { classify, type Kind } from './trace/classify.ts';

const SOURCE = 'reference/cobra-lineart.png';
const INK_THRESHOLD = 170; // 0–255; darker pixels count as line
const MIN_REGION = 20; // px; smaller white gaps are treated as ink
const MIN_SPECK = 12; // px; smaller ink dots are dropped
const BACKGROUND_AREA = 25000; // px; large white areas touching the edge are background

export type Region = {
  id: number;
  kind: Kind;
  order: number; // top-to-bottom rank within its kind
  area: number;
  box: { x0: number; y0: number; x1: number; y1: number };
  center: Pt;
  touchesEdge: boolean;
  d: string;
};

const png = PNG.sync.read(readFileSync(SOURCE));
const r: Raster = { width: png.width, height: png.height };
const { width: W, height: H } = r;
const rgba = new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length);

// 1. Ink lines.
const ink = inkMask(rgba, r, INK_THRESHOLD);
removeSpecks(ink, r, MIN_SPECK);

// 2. Every enclosed white area gets a number; tiny gaps become ink.
const { labels, count } = labelComponents(ink, r, 0);
const rawAreas = countAreas(labels, count);
for (let i = 0; i < labels.length; i++) if (labels[i] >= 0 && rawAreas[labels[i]] < MIN_REGION) labels[i] = -1;

// 3. Split the ink between neighbours so the areas cover the whole picture with no gaps.
absorbUnlabeled(labels, r);

// 4. Stats per area.
const stats = new Map<number, { area: number; sx: number; sy: number; x0: number; y0: number; x1: number; y1: number; edge: boolean }>();
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const l = labels[y * W + x];
    if (l < 0) continue;
    let s = stats.get(l);
    if (!s) stats.set(l, (s = { area: 0, sx: 0, sy: 0, x0: x, y0: y, x1: x + 1, y1: y + 1, edge: false }));
    s.area++;
    s.sx += x;
    s.sy += y;
    s.x0 = Math.min(s.x0, x);
    s.y0 = Math.min(s.y0, y);
    s.x1 = Math.max(s.x1, x + 1);
    s.y1 = Math.max(s.y1, y + 1);
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) s.edge = true;
  }
}

// 5. Outline of each area (background skipped).
const regions: Region[] = [];
let nextId = 0;
for (const [l, s] of stats) {
  if (s.edge && s.area > BACKGROUND_AREA) continue;
  const box = { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 };
  const loops = traceLoops(box, (x, y) => x >= 0 && y >= 0 && x < W && y < H && labels[y * W + x] === l);
  const outer = loops.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a));
  const center = { x: s.sx / s.area, y: s.sy / s.area };
  regions.push({
    id: nextId++,
    kind: classify({ area: s.area, box, center }),
    order: 0,
    area: s.area,
    box,
    center,
    touchesEdge: s.edge,
    d: smoothPath(simplifyLoop(outer, 0.6)),
  });
}
for (const kind of new Set(regions.map((g) => g.kind))) {
  regions
    .filter((g) => g.kind === kind)
    .sort((a, b) => a.center.y - b.center.y)
    .forEach((g, n) => (g.order = n));
}
// Big areas first, so anything nested inside (pupil in the eye) is drawn on top.
regions.sort((a, b) => b.area - a.area);

// 6. The ink itself, as one even-odd path.
const inkLoops = traceLoops({ x0: 0, y0: 0, x1: W, y1: H }, (x, y) => x >= 0 && y >= 0 && x < W && y < H && ink[y * W + x] === 1);
const inkPath = inkLoops
  .filter((loop) => loop.length >= 4)
  .map((loop) => smoothPath(simplifyLoop(loop, 0.45)))
  .join('');

// 7. The art file for the site: geometry and data only, styling happens in the page.
const art = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="King cobra">
<g class="regions">
${regions
  .map((g) => `<path class="region ${g.kind}" data-id="${g.id}" data-order="${g.order}" data-cx="${g.center.x.toFixed(0)}" data-cy="${g.center.y.toFixed(0)}" d="${g.d}"/>`)
  .join('\n')}
</g>
<path class="ink" fill-rule="evenodd" d="${inkPath}"/>
</svg>
`;
mkdirSync('src/art', { recursive: true });
writeFileSync('src/art/cobra.svg', art);

// Debug preview: each kind in its own colour, ink on top.
const KIND_COLOR: Record<Kind, string> = { ventral: '#f2c14e', scale: '#6cb4c9', head: '#e07a5f', eye: '#81b29a', nostril: '#9b5de5' };
mkdirSync('out', { recursive: true });
writeFileSync(
  'out/trace-preview.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#fff"/>
${regions.map((g) => `<path d="${g.d}" fill="${KIND_COLOR[g.kind]}"/>`).join('\n')}
<path d="${inkPath}" fill="#111" fill-rule="evenodd"/>
</svg>`,
);

const byKind = regions.reduce<Record<string, number>>((acc, g) => ((acc[g.kind] = (acc[g.kind] ?? 0) + 1), acc), {});
console.log(`${regions.length} regions`, byKind, `${inkLoops.length} ink loops`);
