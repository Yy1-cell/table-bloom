// The app's modules are written for the browser. These few stand-ins let them load in Node for testing.
const mem = new Map();
globalThis.localStorage ??= {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
globalThis.sessionStorage ??= globalThis.localStorage;
if (!globalThis.navigator?.language) {
  try { Object.defineProperty(globalThis, "navigator", { value: { language: "en", onLine: true }, configurable: true }); } catch {}
}
globalThis.location ??= { search: "", hash: "", origin: "http://localhost" };
globalThis.window ??= globalThis;
globalThis.document ??= { documentElement: { lang: "en" }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
