import { defineConfig } from 'vitest/config'

// Separate config so the impact analysis, which needs the network, never runs
// as part of `npm test`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/impact.test.ts'],
    testTimeout: 180_000,
    disableConsoleIntercept: true,
    printConsoleTrace: false,
  },
})
