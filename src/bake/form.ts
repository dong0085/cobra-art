// 3D shape and fur helpers for the bake: inflating a flat outline into a soft volume,
// reading the direction of the pen strokes, and drawing fine hair strands along it.

/**
 * Inflates a mask like a balloon: solves ∇²u = −1 inside (u = 0 outside), then height = √(2u).
 * A strip of half-width a gets a round cross-section of radius a, so thin parts stay low and wide parts bulge.
 * Solved coarse-to-fine so it converges in a few hundred sweeps.
 */
export function inflate(mask: Uint8Array, width: number, height: number): Float32Array {
  // Build the pyramid of masks: each level halves the size (a coarse pixel is inside if its centre is).
  const levels: { m: Uint8Array; w: number; h: number }[] = [{ m: mask, w: width, h: height }];
  while (levels.length < 5) {
    const { m, w, h } = levels[levels.length - 1];
    const w2 = Math.ceil(w / 2);
    const h2 = Math.ceil(h / 2);
    const m2 = new Uint8Array(w2 * h2);
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) m2[y * w2 + x] = m[Math.min(h - 1, y * 2 + 1) * w + Math.min(w - 1, x * 2 + 1)];
    levels.push({ m: m2, w: w2, h: h2 });
  }

  let u = new Float32Array(0);
  let prevW = 0;
  for (let k = levels.length - 1; k >= 0; k--) {
    const { m, w, h } = levels[k];
    const spacing = 2 ** k; // art pixels per cell at this level
    const next = new Float32Array(w * h);
    // Start from the coarser answer; outside the shape stays 0 (the edge condition).
    if (u.length) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) next[y * w + x] = u[(y >> 1) * prevW + (x >> 1)];
    u = next;
    prevW = w;
    const rhs = spacing * spacing;
    const sweeps = k === levels.length - 1 ? 400 : 60;
    for (let s = 0; s < sweeps; s++) {
      // Gauss–Seidel with over-relaxation.
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!m[i]) continue;
          const target = (u[i - 1] + u[i + 1] + u[i - w] + u[i + w] + rhs) * 0.25;
          u[i] += 1.85 * (target - u[i]);
        }
      }
    }
  }
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] ? Math.sqrt(Math.max(2 * u[i], 0)) : 0;
  return out;
}

/** Box blur, in place, radius r, separable (three passes ≈ Gaussian). */
function blur(a: Float32Array, w: number, h: number, r: number, passes = 3) {
  const tmp = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / (2 * r + 1);
        acc += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / (2 * r + 1);
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  }
}

export type Flow = {
  width: number;
  height: number;
  /** Unit stroke direction per pixel (art axes, y down). Only the line matters, not which way along it. */
  dx: Float32Array;
  dy: Float32Array;
  /** 0 (no clear direction) … 1 (all strokes parallel). */
  coherence: Float32Array;
};

/**
 * Direction of the pen strokes, from the structure tensor of the ink: strokes run across the
 * direction in which the ink changes fastest. `ink` is coverage 0–255 at `scale` px per art unit;
 * the result is at one pixel per `cell` art units, smoothed over about `radius` art units.
 */
export function strokeFlow(ink: Uint8Array, inkW: number, inkH: number, scale: number, cell: number, radius: number): Flow {
  const f = scale * cell;
  const w = Math.floor(inkW / f);
  const h = Math.floor(inkH / f);
  const img = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) acc += ink[(y * f + j) * inkW + x * f + i];
      img[y * w + x] = acc / (f * f * 255);
    }
  }
  blur(img, w, h, 1, 1);
  const jxx = new Float32Array(w * h);
  const jyy = new Float32Array(w * h);
  const jxy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = img[i + 1] - img[i - 1];
      const gy = img[i + w] - img[i - w];
      jxx[i] = gx * gx;
      jyy[i] = gy * gy;
      jxy[i] = gx * gy;
    }
  }
  const r = Math.max(1, Math.round(radius / cell / 2));
  for (const a of [jxx, jyy, jxy]) blur(a, w, h, r);
  const dx = new Float32Array(w * h);
  const dy = new Float32Array(w * h);
  const coherence = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const across = 0.5 * Math.atan2(2 * jxy[i], jxx[i] - jyy[i]); // direction of fastest change
    dx[i] = -Math.sin(across); // the stroke runs at right angles to it
    dy[i] = Math.cos(across);
    const sum = jxx[i] + jyy[i];
    coherence[i] = sum > 1e-6 ? Math.hypot(jxx[i] - jyy[i], 2 * jxy[i]) / sum : 0;
  }
  return { width: w, height: h, dx, dy, coherence };
}

/**
 * Fine hair strands: white noise smeared along the stroke direction (line integral convolution).
 * Returns 0–255 per art pixel inside `mask`, 128 elsewhere.
 */
export function hairStrands(flow: Flow, cell: number, mask: Uint8Array, width: number, height: number, seed = 1): Uint8Array {
  let s = seed >>> 0;
  const noise = new Float32Array(width * height);
  for (let i = 0; i < noise.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    noise[i] = s / 2 ** 32;
  }
  blur(noise, width, height, 1, 1); // strands a little wider than one pixel
  const out = new Uint8Array(width * height).fill(128);
  const STEPS = 14;
  const values = new Float32Array(width * height);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      let acc = noise[i];
      let n = 1;
      for (const sign of [1, -1]) {
        let px = x + 0.5;
        let py = y + 0.5;
        let vx = 0;
        let vy = 0;
        for (let k = 0; k < STEPS; k++) {
          const fx = Math.min(flow.width - 1, Math.max(0, Math.floor(px / cell)));
          const fy = Math.min(flow.height - 1, Math.max(0, Math.floor(py / cell)));
          let ux = flow.dx[fy * flow.width + fx];
          let uy = flow.dy[fy * flow.width + fx];
          if (k === 0) {
            ux *= sign;
            uy *= sign;
          } else if (ux * vx + uy * vy < 0) {
            ux = -ux; // keep walking the same way along the line
            uy = -uy;
          }
          vx = ux;
          vy = uy;
          px += ux;
          py += uy;
          const xi = Math.floor(px);
          const yi = Math.floor(py);
          if (xi < 0 || yi < 0 || xi >= width || yi >= height || !mask[yi * width + xi]) break;
          acc += noise[yi * width + xi];
          n++;
        }
      }
      const v = acc / n;
      values[i] = v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  // Stretch the contrast (averaging flattens it toward grey).
  const mid = (lo + hi) / 2;
  const span = Math.max((hi - lo) / 2, 1e-6) * 0.55;
  for (let i = 0; i < out.length; i++) if (mask[i]) out[i] = Math.max(0, Math.min(255, Math.round(128 + ((values[i] - mid) / span) * 127)));
  return out;
}
