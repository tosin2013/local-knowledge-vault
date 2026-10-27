import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    // Node >= 25 ships a global localStorage that shadows jsdom's (and is undefined
    // without --localstorage-file); turn it off so tests behave the same as on CI's Node 22.
    execArgv: ['--no-experimental-webstorage'],
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
      ],
      reporter: ['lcov', 'text'],
      reportsDirectory: 'coverage/renderer',
    },
  },
})
