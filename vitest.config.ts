import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/renderer/setup.ts'],
    include: ['tests/renderer/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        'src/vite-env.d.ts',
        'src/main.tsx',
        'src/plugins/**',
        'src/components/ai/**',
      ],
      reporter: ['lcov', 'text'],
      reportsDirectory: 'coverage/renderer',
    },
  },
})
