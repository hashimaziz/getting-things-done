import { defineConfig } from 'vitest/config';
import { workspaceAliases } from './vitest.shared';

/**
 * Root test configuration.
 *
 * Only for tests that span the whole workspace, currently the ones guarding the
 * test harness itself. Per-package tests run through each package's own config.
 */
export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    environment: 'node',
    include: ['test/**/*.{test,spec}.ts'],
  },
});
