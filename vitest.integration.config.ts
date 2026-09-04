import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@shared': new URL('./src/shared', import.meta.url).pathname } },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
