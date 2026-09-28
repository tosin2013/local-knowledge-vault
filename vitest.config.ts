import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/renderer/setup.ts'],
    include: ['tests/renderer/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    testTimeout: 15000,
    hookTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        'src/vite-env.d.ts',
        'src/main.tsx',
        'src/plugins/**',
      ],
      reporter: ['lcov', 'text'],
      reportsDirectory: 'coverage/renderer',
    },
  },
})
