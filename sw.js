/* Table & Bloom service worker
 * - Precaches the app shell so the app opens instantly and works offline.
 * - Never caches API calls (Supabase, map search): user data must always be live.
 * Bump CACHE_VERSION whenever you deploy changed files.
 */
const CACHE_VERSION = "tb-v73";
const SHELL = [
  "./",
  "./index.html",
  "./offline.html",
  "./config.js",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/main.js",
  "./js/location.js",
  "./js/currency.js",
  "./js/views/loc-picker.js",
  "./js/views/guide.js",
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
  "./js/dining-profile.js",
  "./js/views/common.js",
  "./js/views/feeling.js",
  "./js/views/admin.js",
  "./js/views/dining-card.js",
  "./js/views/menu-picker.js",
  "./js/views/auth.js",
  "./js/views/discover.js",
  "./js/views/map.js",
  "./js/views/table-detail.js",
  "./js/views/create.js",
  "./js/views/mine.js",
  "./js/views/reflect.js",
  "./js/views/profile.js",
  "./js/views/diet.js",
  "./js/maps.js",
  "./js/google-maps.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" }))))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("tb-") && k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "activate-update") event.waitUntil(self.skipWaiting());
});

// Keep each controlled page on the complete shell installed for this release.
const shellURLs = new Set(SHELL.map((path) => new URL(path, self.registration.scope).href));
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const entry = new URL("./index.html", self.registration.scope);
  const isAppPage = req.mode === "navigate" &&
    (url.origin + url.pathname === self.registration.scope || url.origin + url.pathname === entry.href);
  if (!isAppPage && !shellURLs.has(url.href)) return;
  event.respondWith(caches.open(CACHE_VERSION).then(async (cache) =>
    (await cache.match(isAppPage ? entry.href : req)) || fetch(req)
  ));
});
