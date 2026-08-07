import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tests/ is not part of any project referenced by the root tsconfig, so esbuild
  // would fall back to the classic JSX transform for .test.tsx files.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@preload': resolve(__dirname, 'src/preload'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['./tests/setup/env.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/main/services/**', 'src/shared/**'],
    },
  },
});
