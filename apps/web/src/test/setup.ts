import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { resetDataCacheForTests } from "../utils/dataCache";

// jsdom has no layout engine, so ResizeObserver — used by the carousel scroll
// hook — is missing. A no-op stub is enough: tests drive scroll state directly.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver ??= ResizeObserverStub;

// Node 24+ defines its own `localStorage` global, which is `undefined` unless
// the process was started with `--localstorage-file`. Vitest's jsdom
// environment skips any global that already exists, so jsdom's Storage never
// lands and `window.localStorage` reads back undefined — breaking every module
// that touches it (`runtimeConfig`, above all). Substitute an equivalent
// in-memory Storage when that happens, so the suite behaves the same on every
// supported Node version.
class MemoryStorage implements Storage {
  [name: string]: unknown;
  #entries = new Map<string, string>();
  get length() {
    return this.#entries.size;
  }
  key(index: number) {
    return [...this.#entries.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.#entries.get(String(key)) ?? null;
  }
  setItem(key: string, value: string) {
    this.#entries.set(String(key), String(value));
  }
  removeItem(key: string) {
    this.#entries.delete(String(key));
  }
  clear() {
    this.#entries.clear();
  }
}
// Reading that global is itself what prints Node's "localStorage is not
// available because --localstorage-file was not provided" ExperimentalWarning —
// once per worker, so the suite's output was mostly that. The read is only ever
// a probe, and the answer is acted on right here, so silence the warning it
// raises rather than the whole process's warnings.
function probeLocalStorage(): Storage | undefined {
  const emitWarning = process.emitWarning;
  process.emitWarning = () => {};
  try {
    return window.localStorage;
  } finally {
    process.emitWarning = emitWarning;
  }
}

if (!probeLocalStorage()) {
  Object.defineProperty(window, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

// jsdom has no viewport to scroll, so its `scrollTo` only logs "Not implemented"
// through the virtual console. The scroll lock restores the page position when a
// modal closes, so every modal test printed that line. A no-op is the honest
// stand-in: there is nothing to scroll and nothing asserts that there was.
window.scrollTo = () => {};

// Likewise absent from jsdom; components read it to honour reduced motion.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  // The data cache is module state that outlives a render, which is the whole
  // point of it — but across test cases that means one case's fixture seeding
  // the next case's first paint. Reset it here rather than in each page's suite,
  // since any component reading cached data is exposed to it.
  resetDataCacheForTests();
});
