import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, 'index.html'),
        proof: resolve(import.meta.dirname, 'proof/index.html'),
        judges: resolve(import.meta.dirname, 'judges/index.html'),
        how: resolve(import.meta.dirname, 'how/index.html'),
      },
    },
  },
});
