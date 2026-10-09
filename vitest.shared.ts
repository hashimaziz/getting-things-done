import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    passWithNoTests: true,
    include: ['test/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.ts'],
  },
});
