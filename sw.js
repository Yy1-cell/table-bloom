/* Table & Bloom service worker
 * - Precaches the app shell so the app opens instantly and works offline.
 * - Never caches API calls (Supabase, map search): user data must always be live.
 * Bump CACHE_VERSION whenever you deploy changed files.
 */
const CACHE_VERSION = "tb-v19";
const SHELL = [
  "./",
  "./index.html",
  "./offline.html",
  "./config.js",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/main.js",
  "./js/invitation.js",
  "./js/i18n.js",
  "./js/strings.js",
  "./js/state.js",
  "./js/data.js",
  "./js/errors.js",
  "./js/util.js",
  "./js/ui.js",
  "./js/geo.js",
  "./js/group-map.js",
  "./vendor/leaflet/leaflet.js",
  "./vendor/leaflet/leaflet.css",
  "./js/toronto-venues.js",
  "./data/toronto-venues.json",
  "./js/api.js",
  "./js/api-demo.js",
  "./js/api-supabase.js",
  "./js/views/common.js",
  "./js/views/auth.js",
  "./js/views/discover.js",
  "./js/views/map.js",
  "./js/views/table-detail.js",
  "./js/views/create.js",
  "./js/views/mine.js",
  "./js/views/reflect.js",
  "./js/views/profile.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" })))).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Only handle our own files. Supabase, Photon, Overpass, fonts and CDN libraries go straight to the network.
  if (url.origin !== self.location.origin) return;

  // Page navigations: network first, fall back to the cached shell, then the offline page.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("./index.html").then((hit) => hit || caches.match("./offline.html"))
      )
    );
    return;
  }

  // Static files: network first, cache only as the offline fallback.
  // (It used to be stale-while-revalidate, which kept serving the PREVIOUS deploy's JS for one more visit:
  // anyone who had opened the app before, including the host, ran old code and an invite link
  // could be sent to the sign-in page instead of showing the table.)
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
