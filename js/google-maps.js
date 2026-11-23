// Google Maps JavaScript API map, same interface as group-map.js (update / select / destroy).
// It is only used when ALL of these hold, otherwise callers fall back to the free built-in map or the keyless Google embed:
//   1. TB_CONFIG.GOOGLE_MAPS_KEY is set          2. the person is signed in (guests too)
//   3. the server-side gate claim_google_map() says there is free allowance left (8,000/month, 300/day, 40/person/day)
//   4. the script loads and map tiles really appear (an auth, quota or network problem makes us fall back)
// Only the Maps JavaScript API is used; no Places / Directions calls, so nothing here is billed beyond Google's free map loads.
// Names and emoji come from other users, so they are always set with textContent, never as HTML.
import { api } from "./api.js";
import { state } from "./state.js";
import { getLang } from "./i18n.js";

const FAIL = "tb.gmFail";
const key = () => window.TB_CONFIG?.GOOGLE_MAPS_KEY || "";
export const googleConfigured = () => !!key();
const failedBefore = () => {
  try {
    return sessionStorage.getItem(FAIL) === "1";
  } catch {
    return false;
  }
};
const markFailed = () => {
  try {
    sessionStorage.setItem(FAIL, "1");
  } catch {}
};

/** Asks the gate for one map load. false = use the free map instead. Never throws. */
export async function googleAllowed() {
  if (!key() || failedBefore() || navigator.onLine === false) return false;
  try {
    return (await api.claimGoogleMap?.()) === true;
  } catch {
    return false;
  }
}

let loading = null;
function loadGoogle() {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    window.__tbGmReady = () => resolve();
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key())}&loading=async&v=weekly&language=${getLang() === "zh" ? "zh-CN" : "en"}&callback=__tbGmReady`;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error("google_load_failed"));
    };
    setTimeout(() => reject(new Error("google_timeout")), 10000);
    document.head.append(s);
  });
  return loading;
}

const node = (cls, text) => {
  const d = document.createElement("div");
  d.className = cls;
  if (text != null) d.textContent = text;
  return d;
};

/**
 * data = { people:[{name,avatar,lat,lng}], middle, venue, suggestions:[{name,lat,lng}], onPick(i), onSpot({lat,lng,placeId}), fallbackCenter, labels }
 * Resolves to a controller, or null if Google could not be used (caller falls back).
 */
export async function mountGoogleMap(container, data) {
  let maps, marker, core;
  try {
    await loadGoogle();
    [maps, marker, core] = await Promise.all([google.maps.importLibrary("maps"), google.maps.importLibrary("marker"), google.maps.importLibrary("core")]);
  } catch {
    return null;
  }
  if (!container.isConnected) return null;

  const failCbs = [];
  window.gm_authFailure = () => {
    markFailed();
    failCbs.forEach((f) => f());
  };
  const c0 = data.fallbackCenter || { lat: 43.6532, lng: -79.3832 };
  let map;
  try {
    map = new maps.Map(container, {
      center: { lat: c0.lat, lng: c0.lng },
      zoom: 13,
      mapId: "DEMO_MAP_ID",
      gestureHandling: "cooperative",
      mapTypeControl: false,
      streetViewControl: false,
    });
  } catch {
    markFailed();
    return null;
  }
  // If no tiles show up (bad key, quota used up at Google, offline) give up so the caller can use the free map.
  const tiles = await new Promise((resolve) => {
    map.addListener("tilesloaded", () => resolve(true));
    setTimeout(() => resolve(false), 8000);
  });
  if (!tiles) {
    markFailed();
    try {
      container.replaceChildren();
    } catch {}
    return null;
  }

  let latest = data;
  let items = []; // everything we added, so update() can clear it
  let sug = [];
  let selected = -1;
  let spot = null;

  const place = (pos, content, title, z = 1) => {
    const m = new marker.AdvancedMarkerElement({ map, position: pos, content, title: title || "", zIndex: z, gmpClickable: true });
    items.push(m);
    return m;
  };
  const withLabel = (pin, text) => {
    const wrap = node("g-wrap");
    wrap.append(pin);
    if (text) wrap.append(node("g-label", text));
    return wrap;
  };

  function applySelection() {
    sug.forEach((m, i) => m.content?.firstChild?.classList?.toggle("gm-sel", i === selected));
  }

  function update(d) {
    items.forEach((m) => (m.map = null));
    items = [];
    sug = [];
    const bounds = new core.LatLngBounds();
    let n = 0;
    const add = (p) => (bounds.extend(p), n++);
    const people = d.people || [];
    for (const p of people) {
      const pos = { lat: p.lat, lng: p.lng };
      const pin = node("gm-pin gm-person", p.avatar || "📍");
      pin.style.width = pin.style.height = "34px";
      place(pos, withLabel(pin, p.name), p.name, 5);
      add(pos);
      if (d.middle && people.length > 1) {
        const line = new maps.Polyline({ map, path: [pos, { lat: d.middle.lat, lng: d.middle.lng }], strokeColor: "#365b3c", strokeOpacity: 0.55, strokeWeight: 2 });
        items.push({ set map(v) { line.setMap(v); } });
      }
    }
    if (d.middle && people.length > 1) {
      const pos = { lat: d.middle.lat, lng: d.middle.lng };
      const pin = node("gm-pin gm-mid", "⭐");
      pin.style.width = pin.style.height = "30px";
      place(pos, withLabel(pin, d.labels?.middle || "Middle"), d.labels?.middle || "Middle", 6);
      add(pos);
    }
    (d.suggestions || []).forEach((s, i) => {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) return;
      const numbered = i < 10;
      const pin = node(numbered ? "gm-pin gm-sug" : "gm-pin gm-sug gm-dot", numbered ? String(i + 1) : "");
      const size = numbered ? 28 : 16;
      pin.style.width = pin.style.height = size + "px";
      const m = place({ lat: s.lat, lng: s.lng }, pin, s.name, 3);
      m.addListener("click", () => d.onPick?.(i));
      sug[i] = m;
      add({ lat: s.lat, lng: s.lng });
    });
    applySelection();
    if (d.venue && Number.isFinite(d.venue.lat) && Number.isFinite(d.venue.lng)) {
      const pos = { lat: d.venue.lat, lng: d.venue.lng };
      const pin = node("gm-pin gm-venue", "🍽️");
      pin.style.width = pin.style.height = "38px";
      place(pos, withLabel(pin, d.venue.name || ""), d.venue.name || "", 8);
      add(pos);
    }
    if (spot) {
      const pin = node("gm-pin gm-spot", "📍");
      pin.style.width = pin.style.height = "30px";
      place(spot, pin, "", 9);
    }
    if (n > 1) map.fitBounds(bounds, 48);
    else if (n === 1) {
      map.setCenter(bounds.getCenter());
      map.setZoom(14);
    }
  }

  // Tapping the map (or one of Google's own places) tells the page where, so it can offer "host a table here".
  map.addListener("click", (e) => {
    if (!e.latLng) return;
    const s = { lat: e.latLng.lat(), lng: e.latLng.lng(), placeId: e.placeId || null };
    spot = { lat: s.lat, lng: s.lng };
    update(latest);
    latest.onSpot?.(s);
  });

  update(data);
  return {
    kind: "google",
    update(d) {
      latest = d;
      update(d);
    },
    select(i) {
      selected = i;
      applySelection();
      const m = sug[i];
      if (m?.position) map.panTo(m.position);
    },
    clearSpot() {
      spot = null;
      update(latest);
    },
    onFail(cb) {
      failCbs.push(cb);
    },
    /** The area the map shows right now: { south, west, north, east }. */
    bounds() {
      return map.getBounds()?.toJSON() || null;
    },
    destroy() {
      items.forEach((m) => (m.map = null));
      items = [];
      try {
        container.replaceChildren();
      } catch {}
    },
    get data() {
      return latest;
    },
  };
}

// ---- Google's own restaurant search (Places "Text Search", 5,000 free calls a month), so the Map's list and pins are the
// same places people see in the Google Maps app. Only cheap fields are asked for (name, address, position: the "Pro" tier).
// Every search asks the server gate first; results are cached in this browser for an hour, so repeating a search is free.
// Returns null whenever Google can't or shouldn't be used, and the caller shows the free list instead. Never throws.
const PFAIL = "tb.gpFail";
const placesFailed = () => { try { return sessionStorage.getItem(PFAIL) === "1"; } catch { return false; } };
// Results are limited to a box around `center` (a hard limit, like the visible area in the Google Maps app; a soft "bias"
// let famous places from across the city, or hundreds of km away, into the list). With fewer than 6 results the box
// is widened once.
const boxAround = (c, km) => {
  const dLat = km / 111;
  const dLng = km / (111 * Math.max(0.2, Math.cos((c.lat * Math.PI) / 180)));
  return { south: c.lat - dLat, west: c.lng - dLng, north: c.lat + dLat, east: c.lng + dLng };
};
// `bounds` (optional): search exactly this area (the map as it is on screen, like "Search this area" in Google Maps).
export async function googlePlacesSearch({ query, center, radiusKm = 6, bounds = null }) {
  if (!key() || placesFailed() || navigator.onLine === false) return null;
  const area = bounds ? [bounds.south, bounds.west, bounds.north, bounds.east].map((x) => x.toFixed(3)).join(",") : `${center.lat.toFixed(3)},${center.lng.toFixed(3)}:${radiusKm}`;
  const ck = `tb.gp3:${getLang()}:${query}:${area}`;
  try {
    const hit = JSON.parse(sessionStorage.getItem(ck) || "null");
    if (hit && Date.now() - hit.at < 3600e3) return hit.list;
  } catch {}
  try {
    if ((await api.claimGooglePlaces?.()) !== true) return null;
    await loadGoogle();
    const { Place } = await google.maps.importLibrary("places");
    const ask = (km) => Place.searchByText({
      textQuery: query,
      fields: ["id", "displayName", "location", "formattedAddress"],
      locationRestriction: bounds && km === radiusKm ? bounds : boxAround(center, km),
      maxResultCount: 20,
      language: getLang() === "zh" ? "zh-CN" : "en",
    });
    let { places } = await ask(radiusKm);
    if ((places || []).length < 6 && (await api.claimGooglePlaces?.()) === true) ({ places } = await ask(radiusKm * 2.5));
    const list = (places || [])
      .filter((p) => p.location)
      .map((p) => ({
        name: p.displayName || "",
        address: (p.formattedAddress || "").replace(/,?\s*(Canada|United States|USA|加拿大|美国)$/, ""),
        lat: p.location.lat(),
        lng: p.location.lng(),
        poi_id: `g:${p.id}`,
        google_id: p.id,
        source: "google",
      }));
    try { sessionStorage.setItem(ck, JSON.stringify({ at: Date.now(), list })); } catch {}
    return list;
  } catch {
    // Places not enabled for this key, quota reached, or offline: stop trying for this visit.
    try { sessionStorage.setItem(PFAIL, "1"); } catch {}
    return null;
  }
}
