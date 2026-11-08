import { defineConfig } from 'vite';

export const SLUG = 'stop-aori';

export default defineConfig({
  base: './',
  build: { outDir: `dist/${SLUG}`, emptyOutDir: true, chunkSizeWarningLimit: 900 },
  test: { include: ['tests/**/*.test.ts'] },
} as never);
