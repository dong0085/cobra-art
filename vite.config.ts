import { defineConfig } from 'vite';

// base './' makes the build work from any folder on a website.
export default defineConfig({
  base: './',
  // The traced cobra (713 scale shapes) is most of the bundle: ~1 MB, ~245 KB gzipped.
  build: { chunkSizeWarningLimit: 1200 },
});
