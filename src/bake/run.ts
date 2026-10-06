// Bakes in a worker when the browser can draw off-screen there; otherwise on the main thread.
import { bake, type Baked } from './bake.ts';
import type { Art } from '../art/load.ts';

function bakeHere(art: Art): Baked {
  return bake(art, (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }));
}

export async function runBake(art: Art): Promise<Baked> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return bakeHere(art);
  try {
    const worker = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' });
    const result = await new Promise<{ baked?: Baked; error?: string }>((resolve, reject) => {
      worker.onmessage = (e) => resolve(e.data);
      worker.onerror = (e) => reject(e);
      worker.postMessage(art);
    });
    worker.terminate();
    if (result.baked) return result.baked;
    throw new Error(result.error);
  } catch (err) {
    console.warn('Worker bake failed, baking on the main thread instead.', err);
    return bakeHere(art);
  }
}
