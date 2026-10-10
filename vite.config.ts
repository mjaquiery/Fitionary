import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
    // Exercise images are served straight from public/exercises/; nothing to inline.
    assetsInlineLimit: 0,
    // The dataset is deliberately its own ~900 kB (160 kB gzipped) chunk, loaded after the shell.
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
