// Turns the SVG blocks into the textures the shaders read. Runs once at page load (in a worker when possible).
import { MATERIALS, type Art } from '../art/load.ts';
import { distanceTransform } from './distance.ts';
import { hairStrands, inflate, strokeFlow } from './form.ts';

/** Texture pixels per art unit. */
export const BAKE_SCALE = 2;
/** Distance texture levels per texture pixel: 255 levels cover ~64 px. */
export const DISTANCE_LEVELS = 4;
/** Form texture levels per texture pixel: 128 ± 127 covers ±127 px (±63 art units). */
export const SILHOUETTE_LEVELS = 1;
/** Rows in the per-block data texture. */
export const REGION_ROWS = 3;
/** How far (art units) neighbouring blocks share their stroke direction. */
const FLOW_RADIUS = 45;
/** "columns" form: how wide each body part's rounded edge is (art units), and how tall it gets. */
const FORM_RADIUS = 46;
const FORM_HEIGHT = 0.75;
/** "inflate" form: height relative to the balloon's round cross-section. */
const INFLATE_HEIGHT = 0.55;
/** Fur direction map: art units per pixel, and how far it is smoothed. */
const FLOW_CELL = 2;
const FLOW_SMOOTH = 34;

export type Baked = {
  width: number;
  height: number;
  /** RGBA8. R + G·256 = block id (0 = background, block n → id n + 1). */
  ids: Uint8Array;
  /** R8. Line-work coverage. */
  ink: Uint8Array;
  /** R8. Distance to the nearest block edge (either side), × DISTANCE_LEVELS. */
  distance: Uint8Array;
  /**
   * R8. Signed "form" distance: 128 + d × SILHOUETTE_LEVELS.
   * Inside the snake: distance to the edge of its own part (hood/body, throat, head), which gives each
   * part its own rounded, cylinder-like shape. Outside: minus the distance to the snake.
   */
  silhouette: Uint8Array;
  /**
   * RGBA32F, (blocks + 1) × REGION_ROWS, indexed by id.
   * Row 0: center x / art width, center y / art height, kind index, random seed.
   * Row 1: max inner distance (texture px), own long-axis angle, order, area (texture px).
   * Row 2: stroke angle (smoothed with neighbours), elongation 0–1, 0, 0.
   */
  regionData: Float32Array;
  regionCount: number;
  /** R32F → R16F, art width × height. Height of the body's overall shape, in art units. */
  form: Float32Array;
  /** R8, strandsSize. Fine hair strands (128 = flat). 1 × 1 when the subject has no fur. */
  strands: Uint8Array;
  strandsSize: [number, number];
  /** RGBA8, flowSize. Stroke direction as (cos 2θ, sin 2θ) in RG, coherence in B. 1 × 1 when unused. */
  flow: Uint8Array;
  flowSize: [number, number];
};

/** Cobra body parts that each get their own rounded form (others: one part). 0 = background. */
const PARTS: Record<string, number> = { scale: 1, ventral: 2, head: 3, eye: 3, nostril: 3 };

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type MakeCanvas = (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas;

/** A distinct, well-scattered colour per id, so anti-aliased edge blends rarely match a real id. */
function idColors(count: number): number[] {
  const used = new Set<number>([0]);
  const colors: number[] = [];
  for (let id = 1; id <= count; id++) {
    let c = Math.imul(id, 2654435761) >>> 8;
    while (used.has(c)) c = (c + 7919) & 0xffffff;
    used.add(c);
    colors.push(c);
  }
  return colors;
}

/** Fills pixels marked -1 from their nearest known neighbour. */
function fillUnknown(ids: Int32Array, width: number) {
  let frontier: number[] = [];
  for (let i = 0; i < ids.length; i++) if (ids[i] >= 0) frontier.push(i);
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % width;
      const neighbors = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width];
      for (const n of neighbors) {
        if (n < 0 || n >= ids.length || ids[n] !== -1) continue;
        ids[n] = ids[i];
        next.push(n);
      }
    }
    frontier = next;
  }
}

/**
 * Smoothed outlines of neighbouring blocks can leave hairline gaps that read as background inside the body.
 * Marks small enclosed background specks as unknown (-1) so fillUnknown closes them. Large openings
 * (the space inside a curled tail) and the background around the animal stay as they are.
 */
function fillPinholes(ids: Int32Array, width: number, height: number, maxArea = 64) {
  const seen = new Uint8Array(ids.length);
  for (let start = 0; start < ids.length; start++) {
    if (ids[start] !== 0 || seen[start]) continue;
    const piece = [start];
    seen[start] = 1;
    let touchesEdge = false;
    for (let k = 0; k < piece.length && piece.length <= maxArea; k++) {
      const i = piece[k];
      const x = i % width;
      const y = (i - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;
      for (const n of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) {
        if (n < 0 || seen[n] || ids[n] !== 0) continue;
        seen[n] = 1;
        piece.push(n);
      }
    }
    if (!touchesEdge && piece.length <= maxArea) for (const i of piece) ids[i] = -1;
  }
}

/** Marks pixels on either side of a boundary where `differs(a, b)` is true. */
function boundary(idOf: Int32Array, width: number, height: number, differs: (a: number, b: number) => boolean) {
  const edge = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x < width - 1 && differs(idOf[i], idOf[i + 1])) edge[i] = edge[i + 1] = 1;
      if (y < height - 1 && differs(idOf[i], idOf[i + width])) edge[i] = edge[i + width] = 1;
    }
  }
  return edge;
}

export function bake(art: Art, makeCanvas: MakeCanvas): Baked {
  const width = art.width * BAKE_SCALE;
  const height = art.height * BAKE_SCALE;
  const count = art.regions.length;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as Canvas2D;
  ctx.setTransform(BAKE_SCALE, 0, 0, BAKE_SCALE, 0, 0);

  // 1. Id map: every block in its own colour, then decode colours back to ids.
  const colors = idColors(count);
  const colorToId = new Map(colors.map((c, n) => [c, n + 1]));
  ctx.lineWidth = 0.8;
  art.regions.forEach((region, n) => {
    const css = `#${colors[n].toString(16).padStart(6, '0')}`;
    const path = new Path2D(region.d);
    ctx.fillStyle = css;
    ctx.strokeStyle = css; // closes hairline gaps between neighbours
    ctx.fill(path);
    ctx.stroke(path);
  });
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const idOf = new Int32Array(width * height);
  for (let i = 0; i < idOf.length; i++) {
    if (rgba[i * 4 + 3] < 128) continue; // background stays 0
    const key = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
    idOf[i] = colorToId.get(key) ?? -1; // -1: blended edge pixel, fixed below
  }
  fillPinholes(idOf, width, height);
  fillUnknown(idOf, width);

  const ids = new Uint8Array(width * height * 4);
  for (let i = 0; i < idOf.length; i++) {
    ids[i * 4] = idOf[i] & 255;
    ids[i * 4 + 1] = idOf[i] >> 8;
    ids[i * 4 + 3] = 255;
  }

  // 2. Ink coverage.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(BAKE_SCALE, 0, 0, BAKE_SCALE, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fill(new Path2D(art.ink), 'evenodd');
  const inkRgba = ctx.getImageData(0, 0, width, height).data;
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i++) ink[i] = inkRgba[i * 4 + 3];

  // 3. Distance to the nearest block edge (inside a block: how deep; outside: distance to the snake).
  const dist = distanceTransform(boundary(idOf, width, height, (a, b) => a !== b), width, height);
  const distance = new Uint8Array(width * height);
  for (let i = 0; i < dist.length; i++) distance[i] = Math.min(255, Math.round(dist[i] * DISTANCE_LEVELS));

  // 4. Signed form distance: shadows, glow, and each body part's overall roundness.
  const partOf = new Int8Array(count + 1);
  art.regions.forEach((region, n) => (partOf[n + 1] = PARTS[region.kind] ?? 1));
  const outline = distanceTransform(boundary(idOf, width, height, (a, b) => partOf[a] !== partOf[b]), width, height);
  const silhouette = new Uint8Array(width * height);
  for (let i = 0; i < outline.length; i++) {
    const signed = idOf[i] === 0 ? -outline[i] : outline[i];
    silhouette[i] = Math.max(0, Math.min(255, Math.round(128 + signed * SILHOUETTE_LEVELS)));
  }

  // 5. Per-block shape stats: size, deepest point, long axis.
  const n1 = count + 1;
  const area = new Float64Array(n1);
  const sx = new Float64Array(n1);
  const sy = new Float64Array(n1);
  const sxx = new Float64Array(n1);
  const syy = new Float64Array(n1);
  const sxy = new Float64Array(n1);
  const maxDist = new Float64Array(n1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const id = idOf[i];
      area[id]++;
      sx[id] += x;
      sy[id] += y;
      sxx[id] += x * x;
      syy[id] += y * y;
      sxy[id] += x * y;
      if (dist[i] > maxDist[id]) maxDist[id] = dist[i];
    }
  }

  const axis = new Float64Array(n1);
  const elongation = new Float64Array(n1);
  for (let id = 1; id < n1; id++) {
    const a = Math.max(area[id], 1);
    const mx = sx[id] / a;
    const my = sy[id] / a;
    const cxx = sxx[id] / a - mx * mx;
    const cyy = syy[id] / a - my * my;
    const cxy = sxy[id] / a - mx * my;
    const half = (cxx + cyy) / 2;
    const spread = Math.sqrt(Math.max(half * half - (cxx * cyy - cxy * cxy), 0));
    axis[id] = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    elongation[id] = 1 - Math.sqrt(Math.max(half - spread, 0) / Math.max(half + spread, 1e-6));
  }

  // 6. Stroke direction: blend each block's long axis with its neighbours of the same family,
  //    weighted by how elongated each one is, so round scales follow the flow around them.
  const family = (kind: string) => (kind === 'ventral' ? 1 : 0);
  const flow = new Float64Array(n1);
  art.regions.forEach((region, n) => {
    let fx = 0;
    let fy = 0;
    art.regions.forEach((other, m) => {
      if (family(other.kind) !== family(region.kind)) return;
      const d2 = (other.cx - region.cx) ** 2 + (other.cy - region.cy) ** 2;
      if (d2 > (FLOW_RADIUS * 3) ** 2) return;
      const w = Math.exp(-d2 / (2 * FLOW_RADIUS * FLOW_RADIUS)) * elongation[m + 1];
      fx += Math.cos(2 * axis[m + 1]) * w;
      fy += Math.sin(2 * axis[m + 1]) * w;
    });
    flow[n + 1] = fx === 0 && fy === 0 ? axis[n + 1] : 0.5 * Math.atan2(fy, fx);
  });

  const regionData = new Float32Array(n1 * REGION_ROWS * 4);
  const row = (r: number, id: number) => (r * n1 + id) * 4;
  art.regions.forEach((region, n) => {
    const id = n + 1;
    const seed = (Math.imul(id, 747796405) >>> 0) / 2 ** 32;
    regionData.set([region.cx / art.width, region.cy / art.height, MATERIALS[region.kind], seed], row(0, id));
    regionData.set([maxDist[id], axis[id], region.order, area[id]], row(1, id));
    regionData.set([flow[id], elongation[id], 0, 0], row(2, id));
  });
  regionData.set([0.5, 0.5, -1, 0], row(0, 0)); // background

  // 7. The body's overall 3D shape, one value per art pixel.
  const W = art.width;
  const H = art.height;
  const inside = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) inside[y * W + x] = idOf[(y * BAKE_SCALE + 1) * width + x * BAKE_SCALE + 1] !== 0 ? 1 : 0;
  let form: Float32Array;
  let strands: Uint8Array = new Uint8Array([128]);
  let strandsSize: [number, number] = [1, 1];
  let flowTex: Uint8Array = new Uint8Array([128, 128, 0, 255]);
  let flowSize: [number, number] = [1, 1];

  if (art.form === 'columns') {
    // Each part is a rounded column: steep at its edge, flat across the middle.
    form = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let d = 0;
        for (let j = 0; j < BAKE_SCALE; j++) for (let i = 0; i < BAKE_SCALE; i++) {
          const k = (y * BAKE_SCALE + j) * width + x * BAKE_SCALE + i;
          d += idOf[k] === 0 ? 0 : outline[k];
        }
        const t = Math.min(d / (BAKE_SCALE * BAKE_SCALE) / BAKE_SCALE / FORM_RADIUS, 1);
        form[y * W + x] = Math.sqrt(1 - (1 - t) * (1 - t)) * FORM_RADIUS * FORM_HEIGHT;
      }
    }
  } else {
    // One soft balloon for the whole body, plus extra bulges (arms, haunch) and flattened areas (ears).
    form = inflate(inside, W, H);
    for (let i = 0; i < form.length; i++) form[i] *= INFLATE_HEIGHT;
    for (const volume of art.volumes) addVolume(form, inside, volume, ctx, W, H);

    // Fur: which way the strokes run, and fine strands drawn along them.
    const flow = strokeFlow(ink, width, height, BAKE_SCALE, FLOW_CELL, FLOW_SMOOTH);
    flowSize = [flow.width, flow.height];
    flowTex = new Uint8Array(flow.width * flow.height * 4);
    for (let i = 0; i < flow.width * flow.height; i++) {
      const c2 = flow.dx[i] * flow.dx[i] - flow.dy[i] * flow.dy[i]; // cos 2θ
      const s2 = 2 * flow.dx[i] * flow.dy[i]; // sin 2θ
      flowTex.set([Math.round((c2 * 0.5 + 0.5) * 255), Math.round((s2 * 0.5 + 0.5) * 255), Math.round(flow.coherence[i] * 255), 255], i * 4);
    }
    strands = hairStrands(flow, FLOW_CELL, inside, W, H);
    strandsSize = [W, H];
  }

  return {
    width,
    height,
    ids,
    ink,
    distance,
    silhouette,
    regionData,
    regionCount: count,
    form,
    strands,
    strandsSize,
    flow: flowTex,
    flowSize,
  };
}

/**
 * Adds one soft bulge (or dent, for negative lift) shaped like its outline.
 * Inflated at ¼ size for speed; the profile is squared so it blends in without a crease at its edge.
 */
function addVolume(form: Float32Array, inside: Uint8Array, volume: { lift: number; d: string }, ctx: Canvas2D, W: number, H: number) {
  const Q = 4;
  const w = Math.ceil(W / Q);
  const h = Math.ceil(H / Q);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.setTransform(1 / Q, 0, 0, 1 / Q, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fill(new Path2D(volume.d));
  const px = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 127 ? 1 : 0;
  const u = inflate(mask, w, h); // round cross-section, in ¼-size pixels
  let peak = 0;
  for (const v of u) peak = Math.max(peak, v);
  if (peak === 0) return;
  const radius = peak * Q; // art units
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside[y * W + x]) continue;
      // Bilinear sample of the small map.
      const fx = Math.min(w - 1.001, Math.max(0, (x + 0.5) / Q - 0.5));
      const fy = Math.min(h - 1.001, Math.max(0, (y + 0.5) / Q - 0.5));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const v =
        (u[y0 * w + x0] * (1 - tx) + u[y0 * w + x0 + 1] * tx) * (1 - ty) + (u[(y0 + 1) * w + x0] * (1 - tx) + u[(y0 + 1) * w + x0 + 1] * tx) * ty;
      // v is a round cross-section (steep at the edge); (v/peak)⁴ is a bump that starts flat, so no crease.
      const t = (v / peak) ** 2;
      const i = y * W + x;
      form[i] = Math.max(form[i] + volume.lift * radius * INFLATE_HEIGHT * t * t, Math.min(form[i], 1.5));
    }
  }
}

export const transferables = (b: Baked) => [
  b.ids.buffer,
  b.ink.buffer,
  b.distance.buffer,
  b.silhouette.buffer,
  b.regionData.buffer,
  b.form.buffer,
  b.strands.buffer,
  b.flow.buffer,
];
