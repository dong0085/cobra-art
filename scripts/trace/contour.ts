// Vector work: pixel boundaries → simplified, smooth SVG paths.

export type Pt = { x: number; y: number };

/**
 * Closed boundary loops around the pixels where `inside(x, y)` is true,
 * scanned within the box [x0, x1) × [y0, y1). Points sit on pixel corners.
 */
export function traceLoops(
  box: { x0: number; y0: number; x1: number; y1: number },
  inside: (x: number, y: number) => boolean,
): Pt[][] {
  const W = box.x1 - box.x0 + 3;
  const key = (x: number, y: number) => (y - box.y0 + 1) * W + (x - box.x0 + 1);
  const unkey = (k: number): Pt => ({ x: (k % W) - 1 + box.x0, y: Math.floor(k / W) - 1 + box.y0 });
  const outgoing = new Map<number, number[]>();
  const addEdge = (ax: number, ay: number, bx: number, by: number) => {
    const k = key(ax, ay);
    const list = outgoing.get(k);
    if (list) list.push(key(bx, by));
    else outgoing.set(k, [key(bx, by)]);
  };

  // Walk each pixel clockwise (y points down), adding only the sides that face outside.
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) addEdge(x, y, x + 1, y);
      if (!inside(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) addEdge(x, y + 1, x, y);
    }
  }

  const loops: Pt[][] = [];
  for (const [startKey, ends] of outgoing) {
    while (ends.length > 0) {
      const loop: Pt[] = [unkey(startKey)];
      let prev = unkey(startKey);
      let cur = ends.pop()!;
      while (cur !== startKey) {
        const p = unkey(cur);
        loop.push(p);
        const options = outgoing.get(cur)!;
        // Where two corners touch diagonally, turn right to keep tight to this region.
        let best = 0;
        let bestTurn = -Infinity;
        options.forEach((o, n) => {
          const q = unkey(o);
          const turn = (p.x - prev.x) * (q.y - p.y) - (p.y - prev.y) * (q.x - p.x);
          if (turn > bestTurn) {
            bestTurn = turn;
            best = n;
          }
        });
        prev = p;
        cur = options.splice(best, 1)[0];
      }
      loops.push(loop);
    }
  }
  return loops;
}

export function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Edge midpoints: removes the pixel staircase corners. */
function midpoints(pts: Pt[]): Pt[] {
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  });
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer–Douglas–Peucker on an open polyline. */
function simplifyOpen(pts: Pt[], epsilon: number): Pt[] {
  if (pts.length < 3) return pts;
  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist <= epsilon) return [pts[0], pts[pts.length - 1]];
  const left = simplifyOpen(pts.slice(0, index + 1), epsilon);
  return [...left.slice(0, -1), ...simplifyOpen(pts.slice(index), epsilon)];
}

/** Simplifies a closed loop: split at the point farthest from the start, simplify both halves. */
export function simplifyLoop(pts: Pt[], epsilon: number): Pt[] {
  const smooth = midpoints(pts);
  let far = 0;
  let farDist = 0;
  smooth.forEach((p, i) => {
    const d = Math.hypot(p.x - smooth[0].x, p.y - smooth[0].y);
    if (d > farDist) {
      farDist = d;
      far = i;
    }
  });
  const a = simplifyOpen(smooth.slice(0, far + 1), epsilon);
  const b = simplifyOpen([...smooth.slice(far), smooth[0]], epsilon);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Number in tenths → shortest SVG text ("-.5", "12", "3.4"). */
function tenths(t: number): string {
  const s = (t / 10).toString();
  return s.replace(/^(-?)0\./, '$1.');
}

/** Joins numbers with the fewest separators: a minus sign already separates. */
function joinNumbers(nums: string[]): string {
  return nums.reduce((acc, s, i) => (i === 0 || s.startsWith('-') ? acc + s : `${acc} ${s}`), '');
}

/**
 * Closed Catmull-Rom curve through the points, written as relative cubic Béziers
 * (short numbers, no drift: deltas are taken between already-rounded points).
 */
export function smoothPath(pts: Pt[]): string {
  const n = pts.length;
  if (n < 3) return '';
  const round = (v: number) => Math.round(v * 10);
  let cx = round(pts[0].x);
  let cy = round(pts[0].y);
  let d = `M${joinNumbers([tenths(cx), tenths(cy)])}c`;
  const segments: string[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = [round(p1.x + (p2.x - p0.x) / 6), round(p1.y + (p2.y - p0.y) / 6)];
    const c2 = [round(p2.x - (p3.x - p1.x) / 6), round(p2.y - (p3.y - p1.y) / 6)];
    const end = [round(p2.x), round(p2.y)];
    segments.push(joinNumbers([c1[0] - cx, c1[1] - cy, c2[0] - cx, c2[1] - cy, end[0] - cx, end[1] - cy].map(tenths)));
    cx = end[0];
    cy = end[1];
  }
  d += segments.reduce((acc, s, i) => (i === 0 || s.startsWith('-') ? acc + s : `${acc} ${s}`), '');
  return `${d}z`;
}
