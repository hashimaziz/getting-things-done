import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { workspaceAliases } from '../../vitest.shared';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Cross-package imports resolve to source, matching the other packages, so
      // the browser tests can never run against a stale build either.
      ...workspaceAliases,
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    passWithNoTests: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
