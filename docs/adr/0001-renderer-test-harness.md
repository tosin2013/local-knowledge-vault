# ADR 0001: Renderer test harness

Status: Accepted
Date: 2026-09-28
Issue: #84 (milestone *v0.4.0 — Renderer tests & 80% project coverage*)

## Context

Until September 2026 the repository had no test framework. Every test was a headless smoke script in `scripts/`
running under Electron-as-Node with c8, so only `electron/**` was measured. The renderer (`src/`, about 6,300 lines
of React 19 + MUI 6) was at 0%, and whole-project line coverage was 30.3%. Reaching the 80% project target (#89)
needs renderer tests.

#84 asked four questions:
1. Which harness fits React 19 + MUI 6 + Vite 8: Vitest + jsdom + Testing Library, or a headless Electron window?
2. How should `window.lkv` be mocked so tests break when the preload surface changes?
3. How does renderer coverage reach Codecov without double-counting `src/`?
4. What does it cost in CI, and how does it fit `test:ci` / `npm run coverage`?

A harness was introduced in practice before this ADR was written. It arrived with the `App.tsx` split (#90), and
#92, #93 and #94 were built on it. This ADR records that choice and settles what it left open.

## Decision

**Use Vitest + jsdom + React Testing Library for renderer tests, mocking the main process at the `window.lkv`
boundary.**

- Tests live in `tests/renderer/**/*.test.{ts,tsx}`, configured by `vitest.config.ts` (`environment: 'jsdom'`).
  `tests/renderer/setup.ts` polyfills what MUI needs and jsdom lacks (`matchMedia`, `ResizeObserver`,
  `scrollIntoView`, `confirm`).
- Before each test, `setup.ts` installs a fresh `window.lkv` from `createLkvMock()` in `tests/renderer/lkv.ts`.
  Every method resolves to a harmless default, and each test overrides the calls it cares about. The renderer only
  reaches the main process through `window.lkv`, so this boundary is the whole contract.
- Coverage: `npm run coverage` runs c8 over the Electron smoke tests (`.c8rc.json`, `electron/**` only), then
  `vitest run --coverage` (V8, `src/**`, written to `coverage/renderer/`). `scripts/merge-coverage.mjs` then joins
  the two lcov files into `coverage/lcov.info`, which CI uploads to Codecov. The two runs cover disjoint trees, so
  plain concatenation cannot double-count a file. Codecov's `main-process` and `renderer` components keep reporting
  them separately.
- Cost: the full renderer suite (20 files, 170 tests) runs in about 6 s locally. It needs no display, no Electron
  binary and no native modules, so CI stays a single Linux job.

### Why not a headless Electron window

A real `BrowserWindow` would exercise the actual preload. But it needs a display (xvfb) in CI, starts slowly, needs
`better-sqlite3` built for Electron's ABI, and makes coverage collection from the renderer process awkward. The
preload itself is covered from the main-process side (#77). The jsdom suite already drives `<App />` through
end-to-end user flows (#92) in seconds. If a true renderer↔preload integration test is ever needed, it should be a
small separate smoke test, not the main harness.

## Consequences and follow-ups

The harness works, but three parts of #84's intent are not met yet. They are tracked as separate issues rather than
fixed here:

| Gap | Issue |
|---|---|
| The mock is typed as `{[key: string]: unknown}`, not `LkvApi`, and `tests/` is not type-checked, so a renamed preload method goes unnoticed (question 2). | #95 |
| `src/plugins/**` (2,714 lines) is excluded from coverage, so it drops out of the Codecov total instead of counting as 0%. The 80% goal is measured without it. | #96 |
| `vitest@2` nests `vite@5`, which brings back advisories the Vite 8 upgrade (#73) removed (GHSA-82fw-gwwq-j7x9). Dev-only. | #97 |
| `CONTRIBUTING.md` and `docs/development.md` still describe a smoke-tests-only setup. | #98 |

Rules for new renderer tests:
- Mock at `window.lkv`, not inside components or hooks. The component should see exactly what the preload would
  return.
- Anything that changes the grounding contract (citations, the "couldn't find that in your notes" reply) is tested
  through the UI flow as well as in the main process.
- Driving text inputs with `fireEvent.change` rather than `userEvent.type` keeps the flow tests fast (#93).
