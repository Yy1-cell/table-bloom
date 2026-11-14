// One shared, mutable app state plus a tiny event bus.
export const state = {
  mode: "demo", // "demo" | "supabase"
  session: null, // { userId, email } when signed in
  me: null, // profile
  ranks: [], // my cuisine ranking, best first (array of slugs)
  areas: [],
  cuisines: [],
  tables: [], // Discover list
  myTables: [], // tables I host or joined/requested
  pos: null, // { lat, lng } from the browser, only after the user asks for "closest"
  filters: { chip: "all", sort: "match", sortSet: false, areaId: null, occasion: "" },
  diningProfile: undefined, // built from my post-meal check-ins; undefined = not loaded yet
  createPrefill: null, // { place, cuisine, area_id } handed to the Host-a-table sheet, e.g. from the Map tab
  baseView: "discover", // the page behind any open sheet
  installEvent: null, // beforeinstallprompt
};

const listeners = new Map();
export const bus = {
  on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => listeners.get(evt)?.delete(fn);
  },
  emit(evt, payload) {
    listeners.get(evt)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        console.error(e);
      }
    });
  },
};

export const cuisineOf = (slug) => state.cuisines.find((c) => c.slug === slug) || null;
export const areaOf = (id) => state.areas.find((a) => a.id === id) || null;
