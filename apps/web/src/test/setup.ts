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
if (!window.localStorage) {
  Object.defineProperty(window, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

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
