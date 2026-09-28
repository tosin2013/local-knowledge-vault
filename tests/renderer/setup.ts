import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { createLkvMock } from './lkv'

// --- React Testing Library cleanup ---
afterEach(() => {
  cleanup()
})

// --- jsdom polyfills for MUI ---
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
}

if (!('ResizeObserver' in window)) {
  ;(window as unknown as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// jsdom does not implement scrollIntoView.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// The renderer uses confirm() for destructive actions.
window.confirm = vi.fn(() => true)

// --- window.lkv: a fresh default mock per test ---
beforeEach(() => {
  localStorage.clear()
  const lkv = createLkvMock()
  Object.defineProperty(window, 'lkv', {
    value: lkv,
    configurable: true,
    writable: true,
  })
})
