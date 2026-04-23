import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crx } from '@crxjs/vite-plugin';
import { defineConfig } from 'vite';
import manifest from './src/manifest.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        blocked: resolve(root, 'src/blocked/blocked.html'),
      },
      output: {
        chunkFileNames: 'assets/chunk-[hash].js',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
