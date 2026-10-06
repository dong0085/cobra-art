// Labels each traced region by body part, using its shape and where it sits in the reference.
import type { Pt } from './contour.ts';

export type Kind = 'ventral' | 'scale' | 'head' | 'eye' | 'nostril';

export type RegionShape = {
  area: number;
  box: { x0: number; y0: number; x1: number; y1: number };
  center: Pt;
};

// Hand-placed landmarks for reference/cobra-lineart.png (1024 × 1536).
const HEAD: Pt[] = [
  { x: 600, y: 112 },
  { x: 700, y: 96 },
  { x: 820, y: 120 },
  { x: 900, y: 170 },
  { x: 938, y: 245 },
  { x: 932, y: 312 },
  { x: 900, y: 345 },
  { x: 800, y: 352 },
  { x: 700, y: 352 },
  { x: 640, y: 348 },
  { x: 608, y: 300 },
  { x: 588, y: 230 },
];
const EYE = { x: 706, y: 205, r: 34 };
const NOSTRIL = { x: 842, y: 263, r: 16 };

function insidePolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const near = (p: Pt, c: { x: number; y: number; r: number }) => Math.hypot(p.x - c.x, p.y - c.y) < c.r;

export function classify({ area, box, center }: RegionShape): Kind {
  if (near(center, EYE)) return 'eye';
  if (near(center, NOSTRIL)) return 'nostril';
  if (insidePolygon(center, HEAD)) return 'head';
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  if (w / h >= 1.6 && w >= 120 && area >= 1500) return 'ventral'; // wide belly plates down the throat (some are curved)
  return 'scale';
}
