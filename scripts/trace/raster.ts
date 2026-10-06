// Pixel work: find the ink lines, then number every enclosed area (each scale, plate, background).

export type Raster = { width: number; height: number };

/** 1 where the pixel is dark enough to count as ink. */
export function inkMask(rgba: Uint8Array, { width, height }: Raster, threshold: number): Uint8Array {
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const lum = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) * a + 255 * (1 - a);
    ink[i] = lum < threshold ? 1 : 0;
  }
  return ink;
}

/** Drops ink specks smaller than `minArea` pixels (dust, stray dots). */
export function removeSpecks(ink: Uint8Array, r: Raster, minArea: number): void {
  const comp = labelComponents(ink, r, 1);
  const areas = countAreas(comp.labels, comp.count);
  for (let i = 0; i < ink.length; i++) if (ink[i] && areas[comp.labels[i]] < minArea) ink[i] = 0;
}

/**
 * Flood-fills every 4-connected area of pixels equal to `value`.
 * Other pixels get label -1.
 */
export function labelComponents(mask: Uint8Array, { width, height }: Raster, value: number) {
  const labels = new Int32Array(width * height).fill(-1);
  const stack = new Int32Array(width * height);
  let count = 0;
  for (let start = 0; start < labels.length; start++) {
    if (mask[start] !== value || labels[start] !== -1) continue;
    let top = 0;
    stack[top++] = start;
    labels[start] = count;
    while (top > 0) {
      const i = stack[--top];
      const x = i % width;
      const y = (i - x) / width;
      const visit = (n: number) => {
        if (mask[n] === value && labels[n] === -1) {
          labels[n] = count;
          stack[top++] = n;
        }
      };
      if (x > 0) visit(i - 1);
      if (x < width - 1) visit(i + 1);
      if (y > 0) visit(i - width);
      if (y < height - 1) visit(i + width);
    }
    count++;
  }
  return { labels, count };
}

export function countAreas(labels: Int32Array, count: number): Int32Array {
  const areas = new Int32Array(count);
  for (const l of labels) if (l >= 0) areas[l]++;
  return areas;
}

/** Gives every unlabeled pixel (the ink) to the nearest labeled area, so the areas tile the image. */
export function absorbUnlabeled(labels: Int32Array, { width, height }: Raster): void {
  let frontier: number[] = [];
  for (let i = 0; i < labels.length; i++) if (labels[i] >= 0) frontier.push(i);
  while (frontier.length > 0) {
    const nextFrontier: number[] = [];
    const claims: [number, number][] = [];
    for (const i of frontier) {
      const x = i % width;
      const y = (i - x) / width;
      const neighbors = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1];
      for (const n of neighbors) if (n >= 0 && labels[n] === -1) claims.push([n, labels[i]]);
    }
    for (const [n, l] of claims) {
      if (labels[n] !== -1) continue;
      labels[n] = l;
      nextFrontier.push(n);
    }
    frontier = nextFrontier;
  }
}
