import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['worker/test/**/*.test.ts', 'web/test/**/*.test.ts', 'shared/test/**/*.test.ts', 'integration/**/*.test.ts'],
    environment: 'node',
  },
})
