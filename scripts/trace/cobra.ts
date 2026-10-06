// Cobra: every scale in the line art is a closed shape, so every enclosed white area becomes one block.
import { absorbUnlabeled, countAreas, inkMask, labelComponents, removeSpecks } from './raster.ts';
import { buildRegions, inkPath, insidePolygon, loadPng, pts, writeArt, type AreaStats } from './output.ts';
import type { Pt } from './contour.ts';

const SOURCE = 'reference/cobra-lineart.png';
const INK_THRESHOLD = 170; // 0–255; darker pixels count as line
const MIN_REGION = 20; // px; smaller white gaps are treated as ink
const MIN_SPECK = 12; // px; smaller ink dots are dropped
const BACKGROUND_AREA = 25000; // px; large white areas touching the edge are background

// Hand-placed landmarks for reference/cobra-lineart.png (1024 × 1536).
const HEAD = pts(600, 112, 700, 96, 820, 120, 900, 170, 938, 245, 932, 312, 900, 345, 800, 352, 700, 352, 640, 348, 608, 300, 588, 230);
const EYE = { x: 706, y: 205, r: 34 };
const NOSTRIL = { x: 842, y: 263, r: 16 };

const near = (p: Pt, c: { x: number; y: number; r: number }) => Math.hypot(p.x - c.x, p.y - c.y) < c.r;

function classify({ area, box, center, touchesEdge }: AreaStats): string | null {
  if (touchesEdge && area > BACKGROUND_AREA) return null;
  if (near(center, EYE)) return 'eye';
  if (near(center, NOSTRIL)) return 'nostril';
  if (insidePolygon(center, HEAD)) return 'head';
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  if (w / h >= 1.6 && w >= 120 && area >= 1500) return 'ventral'; // wide belly plates down the throat (some are curved)
  return 'scale';
}

const { raster: r, rgba } = loadPng(SOURCE);

// 1. Ink lines.
const ink = inkMask(rgba, r, INK_THRESHOLD);
removeSpecks(ink, r, MIN_SPECK);

// 2. Every enclosed white area gets a number; tiny gaps become ink.
const { labels, count } = labelComponents(ink, r, 0);
const rawAreas = countAreas(labels, count);
for (let i = 0; i < labels.length; i++) if (labels[i] >= 0 && rawAreas[labels[i]] < MIN_REGION) labels[i] = -1;

// 3. Split the ink between neighbours so the areas cover the whole picture with no gaps.
absorbUnlabeled(labels, r);

// 4. Outlines, ink, files.
const regions = buildRegions(labels, r, classify);
writeArt({
  name: 'cobra',
  label: 'King cobra',
  raster: r,
  regions,
  ink: inkPath(ink, r).d,
  colors: { ventral: '#f2c14e', scale: '#6cb4c9', head: '#e07a5f', eye: '#81b29a', nostril: '#9b5de5' },
});
