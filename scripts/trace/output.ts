// Shared last steps of every trace: labelled pixels → SVG regions, ink path, art file, preview.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { signedArea, simplifyLoop, smoothPath, traceLoops, type Pt } from './contour.ts';
import type { Raster } from './raster.ts';

export type Box = { x0: number; y0: number; x1: number; y1: number };

/** What the classifier gets to know about each labelled area. */
export type AreaStats = { label: number; area: number; box: Box; center: Pt; touchesEdge: boolean };

export type Region = AreaStats & { id: number; kind: string; order: number; d: string };

export function loadPng(path: string) {
  const png = PNG.sync.read(readFileSync(path));
  const raster: Raster = { width: png.width, height: png.height };
  const rgba = new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length);
  return { raster, rgba };
}

export function insidePolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** [x, y, x, y, …] → points. */
export const pts = (...xy: number[]): Pt[] => Array.from({ length: xy.length / 2 }, (_, i) => ({ x: xy[i * 2], y: xy[i * 2 + 1] }));

/** Polygon → closed SVG path with whole-number points. */
export const polygonPath = (poly: Pt[]) => `M${poly.map((p) => `${Math.round(p.x)} ${Math.round(p.y)}`).join('L')}Z`;

function areaStats(labels: Int32Array, { width: W, height: H }: Raster): AreaStats[] {
  const stats = new Map<number, AreaStats & { sx: number; sy: number }>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const label = labels[y * W + x];
      if (label < 0) continue;
      let s = stats.get(label);
      if (!s) stats.set(label, (s = { label, area: 0, sx: 0, sy: 0, box: { x0: x, y0: y, x1: x + 1, y1: y + 1 }, center: { x: 0, y: 0 }, touchesEdge: false }));
      s.area++;
      s.sx += x;
      s.sy += y;
      s.box.x0 = Math.min(s.box.x0, x);
      s.box.y0 = Math.min(s.box.y0, y);
      s.box.x1 = Math.max(s.box.x1, x + 1);
      s.box.y1 = Math.max(s.box.y1, y + 1);
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) s.touchesEdge = true;
    }
  }
  return [...stats.values()].map(({ sx, sy, ...s }) => ({ ...s, center: { x: sx / s.area, y: sy / s.area } }));
}

/**
 * Outlines every labelled area. `kindOf` names each area, or returns null to skip it (background).
 * Areas are sorted largest first, so anything nested inside (a pupil in an eye) is drawn on top.
 */
export function buildRegions(labels: Int32Array, r: Raster, kindOf: (s: AreaStats) => string | null): Region[] {
  const regions: Region[] = [];
  for (const s of areaStats(labels, r)) {
    const kind = kindOf(s);
    if (!kind) continue;
    const loops = traceLoops(s.box, (x, y) => x >= 0 && y >= 0 && x < r.width && y < r.height && labels[y * r.width + x] === s.label);
    const largest = loops.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a));
    // Keep every outer loop (an area may come in several pieces); skip the holes.
    const outer = loops.filter((loop) => Math.sign(signedArea(loop)) === Math.sign(signedArea(largest)) && loop.length >= 4);
    const d = outer.map((loop) => smoothPath(simplifyLoop(loop, 0.6))).join('');
    regions.push({ ...s, id: regions.length, kind, order: 0, d });
  }
  for (const kind of new Set(regions.map((g) => g.kind))) {
    regions
      .filter((g) => g.kind === kind)
      .sort((a, b) => a.center.y - b.center.y)
      .forEach((g, n) => (g.order = n));
  }
  return regions.sort((a, b) => b.area - a.area);
}

/** The ink as one even-odd path. */
export function inkPath(ink: Uint8Array, { width: W, height: H }: Raster): { d: string; loops: number } {
  const loops = traceLoops({ x0: 0, y0: 0, x1: W, y1: H }, (x, y) => x >= 0 && y >= 0 && x < W && y < H && ink[y * W + x] === 1);
  const kept = loops.filter((loop) => loop.length >= 4);
  return { d: kept.map((loop) => smoothPath(simplifyLoop(loop, 0.45))).join(''), loops: loops.length };
}

/**
 * Writes the art file for the site (geometry and data only; styling happens in the page)
 * and a debug preview with each kind in its own colour.
 */
export function writeArt(opts: {
  name: string;
  label: string;
  raster: Raster;
  regions: Region[];
  ink: string;
  extra?: string; // more SVG elements (volumes, whiskers)
  colors: Record<string, string>; // preview colour per kind
  /** How the bake shapes the body: "columns" (each body part rounded on its own) or "inflate" (one soft balloon). */
  form?: 'columns' | 'inflate';
}) {
  const { name, label, raster, regions, ink, extra = '', colors, form } = opts;
  const { width: W, height: H } = raster;
  const art = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}"${form ? ` data-form="${form}"` : ''}>
<g class="regions">
${regions
  .map((g) => `<path class="region ${g.kind}" data-id="${g.id}" data-order="${g.order}" data-cx="${g.center.x.toFixed(0)}" data-cy="${g.center.y.toFixed(0)}" d="${g.d}"/>`)
  .join('\n')}
</g>
<path class="ink" fill-rule="evenodd" d="${ink}"/>
${extra}</svg>
`;
  mkdirSync('src/art', { recursive: true });
  writeFileSync(`src/art/${name}.svg`, art);

  mkdirSync('out', { recursive: true });
  writeFileSync(
    `out/${name}-preview.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#fff"/>
${regions.map((g) => `<path d="${g.d}" fill="${colors[g.kind] ?? '#ccc'}"/>`).join('\n')}
<path d="${ink}" fill="#111" fill-rule="evenodd"/>
${extra.replace(/class="whisker"/g, 'class="whisker" fill="none" stroke="#e63946" stroke-width="2"').replace(/class="volume"/g, 'class="volume" fill="none" stroke="#2a9d8f" stroke-width="3"')}
</svg>`,
  );
  const byKind = regions.reduce<Record<string, number>>((acc, g) => ((acc[g.kind] = (acc[g.kind] ?? 0) + 1), acc), {});
  console.log(`${name}: ${regions.length} regions`, byKind);
}
