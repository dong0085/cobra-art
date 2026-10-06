// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher), linear time.

const FAR = 1e20;

function transform1d(f: Float32Array, n: number, out: Float32Array, v: Int32Array, z: Float32Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -FAR;
  z[1] = FAR;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = FAR;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    out[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Distance (px) from every pixel to the nearest pixel where `seed` is 1. */
export function distanceTransform(seed: Uint8Array, width: number, height: number): Float32Array {
  const grid = new Float32Array(width * height);
  for (let i = 0; i < grid.length; i++) grid[i] = seed[i] ? 0 : FAR;

  const n = Math.max(width, height);
  const f = new Float32Array(n);
  const out = new Float32Array(n);
  const v = new Int32Array(n);
  const z = new Float32Array(n + 1);

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x];
    transform1d(f, height, out, v, z);
    for (let y = 0; y < height; y++) grid[y * width + x] = out[y];
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) f[x] = grid[row + x];
    transform1d(f, width, out, v, z);
    for (let x = 0; x < width; x++) grid[row + x] = Math.sqrt(out[x]);
  }
  return grid;
}
