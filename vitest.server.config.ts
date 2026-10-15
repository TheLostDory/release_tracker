import { defineConfig } from 'vitest/config'

// API tests: real Express app + real Postgres (see server/test/setup.ts).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts'],
    globalSetup: ['server/test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
})
