// Runs the bake off the main thread so the page stays responsive while it loads.
import { bake, transferables } from './bake.ts';
import type { Art } from '../art/load.ts';

self.onmessage = (event: MessageEvent<Art>) => {
  try {
    const baked = bake(event.data, (w, h) => new OffscreenCanvas(w, h));
    (self as unknown as Worker).postMessage({ baked }, transferables(baked) as Transferable[]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: String(err) });
  }
};
