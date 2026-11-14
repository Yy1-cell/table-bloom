// Place search and restaurant suggestions.
//
// Both services below are free, key-less, OpenStreetMap-based, and called straight from the
// browser. They are fine for a test version. Before a public launch, replace them with a
// service you have an agreement with (e.g. Google Places, Mapbox, or Tencent Maps in a
// WeChat Mini Program) and keep the same function signatures.
//   - Photon (photon.komoot.io): search a place by name or address.
//   - Overpass (overpass-api.de): restaurants near a point, by cuisine tag.
import { haversineKm, midpoint } from "./util.js";
import { searchTorontoVenues, torontoVenuesNear } from "./toronto-venues.js";
import { getLang } from "./i18n.js";

const PHOTON = "https://photon.komoot.io/api/";
const OVERPASS = "https://overpass.private.coffee/api/interpreter";
// Greater Toronto Area bounding box: minLon,minLat,maxLon,maxLat
const GTA_BBOX = "-80.2,43.4,-78.9,44.1";

export const LANDMARKS = [
  { name: "Robarts Library", zh: "罗巴茨图书馆 (Robarts Library)", address: "130 St George St, Toronto", lat: 43.6644, lng: -79.3995 },
  { name: "TMU Student Learning Centre", zh: "TMU 学生学习中心", address: "341 Yonge St, Toronto", lat: 43.6577, lng: -79.3788 },
  { name: "Union Station", zh: "联合车站 (Union Station)", address: "65 Front St W, Toronto", lat: 43.6453, lng: -79.3806 },
  { name: "Yonge–Dundas Square", zh: "央街-登打士广场", address: "1 Dundas St E, Toronto", lat: 43.6561, lng: -79.3802 },
  { name: "Bloor–Yonge Station", zh: "Bloor–Yonge 地铁站", address: "Bloor St E & Yonge St, Toronto", lat: 43.6709, lng: -79.3857 },
  { name: "Spadina & Dundas (Chinatown)", zh: "唐人街（Spadina 与 Dundas 路口）", address: "Spadina Ave & Dundas St W, Toronto", lat: 43.6532, lng: -79.3985 },
  { name: "Finch Station", zh: "Finch 地铁站", address: "5600 Yonge St, North York", lat: 43.7806, lng: -79.415 },
  { name: "York University", zh: "约克大学", address: "4700 Keele St, North York", lat: 43.7735, lng: -79.5019 },
  { name: "Scarborough Town Centre", zh: "士嘉堡市中心商场", address: "300 Borough Dr, Scarborough", lat: 43.7764, lng: -79.2573 },
  { name: "Pacific Mall", zh: "太平洋广场 (Pacific Mall)", address: "4300 Steeles Ave E, Markham", lat: 43.8268, lng: -79.2995 },
  { name: "Square One", zh: "Square One 购物中心", address: "100 City Centre Dr, Mississauga", lat: 43.5933, lng: -79.6425 },
];

function withTimeout(ms, outerSignal) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  const abort = () => ctl.abort();
  if (outerSignal?.aborted) abort();
  else outerSignal?.addEventListener("abort", abort, { once: true });
  return {
    signal: ctl.signal,
    done() {
      clearTimeout(timer);
      outerSignal?.removeEventListener("abort", abort);
    },
  };
}

function formatAddress(p) {
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  return [street, p.district || p.locality, p.city, p.state].filter(Boolean).join(", ");
}

/** Search a place or address near the GTA. Throws on network errors so the UI can show landmarks instead. */
export async function searchPlaces(query, { near, signal, restaurantsOnly = false } = {}) {
  const q = query.trim();
  if (q.length < 2) return [];
  const local = await searchTorontoVenues(q, near).catch(() => []);
  signal?.throwIfAborted();
  const landmarks = restaurantsOnly ? [] : searchLandmarks(q);
  if (local.length || landmarks.length) return [...landmarks, ...local].slice(0, 7);
  // Photon only translates names into en/de/fr/it. For Chinese we ask for the local names (English in Toronto).
  const params = new URLSearchParams({ q, limit: "7", bbox: GTA_BBOX });
  if (getLang() !== "zh") params.set("lang", "en");
  if (restaurantsOnly) {
    for (const kind of ["restaurant", "cafe", "fast_food", "food_court"]) {
      params.append("osm_tag", "amenity:" + kind);
    }
  }
  if (near) {
    params.set("lat", String(near.lat));
    params.set("lon", String(near.lng));
  }
  const t = withTimeout(9000, signal);
  try {
    const res = await fetch(`${PHOTON}?${params}`, { signal: t.signal });
    if (!res.ok) throw new Error("search_" + res.status);
    const data = await res.json();
    if (!Array.isArray(data.features)) throw new Error("search_invalid");
    const seen = new Set();
    return data.features
      .map((f) => {
        const p = f.properties || {};
        const [lng, lat] = f.geometry?.coordinates || [];
        const name = p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || p.city || "";
        return {
          name,
          address: formatAddress(p),
          lat,
          lng,
          poi_id: p.osm_id ? `${p.osm_type || "N"}${p.osm_id}` : null,
        };
      })
      .filter((r) => r.name && Number.isFinite(r.lat) && Number.isFinite(r.lng))
      .filter((r) => {
        const key = r.poi_id || `${r.name}|${r.lat}|${r.lng}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  } finally {
    t.done();
  }
}

/** Offline-friendly fallback: filter the built-in landmark list. */
export function searchLandmarks(query) {
  const q = query.trim().toLowerCase();
  const list = q ? LANDMARKS.filter((l) => (l.name + " " + l.zh + " " + l.address).toLowerCase().includes(q)) : LANDMARKS;
  const zh = getLang() === "zh";
  return list.map((l) => ({ name: zh ? l.zh : l.name, address: l.address, lat: l.lat, lng: l.lng, poi_id: null }));
}

// OpenStreetMap tag filters per cuisine. Each entry is a list of Overpass filters (OR-ed together).
const CUISINE_FILTERS = {
  hotpot: ['[amenity=restaurant][cuisine~"hot_?pot|shabu"]', '[amenity=restaurant][name~"hot ?pot|shabu|火锅|海底捞",i]'],
  korean_bbq: ['[amenity=restaurant][cuisine~"korean|barbecue|bbq"]', '[amenity=restaurant][name~"bbq|korean|烤肉",i]'],
  japanese: ['[amenity=restaurant][cuisine~"japanese|sushi|ramen|izakaya"]'],
  sichuan: ['[amenity=restaurant][cuisine~"sichuan|szechuan"]', '[amenity=restaurant][name~"川|sichuan|szechuan",i]'],
  noodles: ['[amenity=restaurant][cuisine~"noodle|ramen|pho"]', '[amenity=restaurant][name~"noodle|面",i]'],
  pizza: ['[amenity=restaurant][cuisine=pizza]'],
  dimsum: ['[amenity=restaurant][cuisine~"dim_sum|cantonese"]', '[amenity=restaurant][name~"dim sum|点心|茶",i]'],
  cafe: ["[amenity=cafe]"],
};

// The free public Overpass servers are often slow or down. After one failure we stop asking for a couple of
// minutes, so a search that widens its radius moves on to the built-in Toronto list right away
// instead of waiting for several timeouts in a row.
let overpassDownUntil = 0;

async function queryOverpass(query, signal) {
  if (Date.now() < overpassDownUntil) throw new Error("overpass_down");
  const timeout = withTimeout(6500, signal);
  try {
    const response = await fetch(`${OVERPASS}?data=${encodeURIComponent(query)}`, { signal: timeout.signal });
    if (!response.ok) throw new Error("overpass_" + response.status);
    const data = await response.json();
    if (data.remark || !Array.isArray(data.elements)) throw new Error("overpass_incomplete");
    overpassDownUntil = 0;
    return data.elements;
  } catch (e) {
    if (!signal?.aborted) overpassDownUntil = Date.now() + 2 * 60 * 1000;
    throw e;
  } finally {
    timeout.done();
  }
}

/** Real restaurants near the group's midpoint, ordered by cuisine match and distance. */
export async function restaurantsNear(center, cuisineSlug, { radius = 2200, signal } = {}) {
  const local = await torontoVenuesNear(center, cuisineSlug, radius / 1000).catch(() => []);
  signal?.throwIfAborted();
  if (local.length) return local;

  // Overpass is often blocked or down in the browser, so ask Photon first (same source the shared-table suggestions use).
  try {
    const found = await cuisinePlaces(center, cuisineSlug || "", { radiusKm: Math.max(radius / 1000, 5), signal });
    if (found.length) return found.slice(0, 20);
  } catch (e) {
    if (e?.name === "AbortError" || signal?.aborted) throw e;
  }

  const preferred = CUISINE_FILTERS[cuisineSlug] || [];
  const nearby = ['[amenity~"^(restaurant|cafe|fast_food|food_court)$"]'];
  const around = (filters) => filters.map((filter) =>
    `nwr(around:${radius},${center.lat.toFixed(5)},${center.lng.toFixed(5)})${filter}[name];`).join("");
  const lookup = (filters) => queryOverpass(`[out:json][timeout:5];(${around(filters)});out center;`, signal);
  const elements = await lookup(preferred.length ? preferred : nearby);
  const venues = new Map();
  for (const element of elements) {
    const tags = element.tags || {};
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (!tags.name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const poi_id = `${element.type?.[0]?.toUpperCase() || "N"}${element.id}`;
    const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
    venues.set(poi_id, {
      name: (getLang() === "zh" ? tags["name:zh"] || tags["name:zh-Hans"] : tags["name:en"]) || tags.name,
      address: [street, tags["addr:city"]].filter(Boolean).join(", "),
      lat, lng, poi_id,
      cuisine: tags.cuisine || "",
      distKm: haversineKm(center, { lat, lng }),
    });
  }
  return [...venues.values()]
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, 10);
}

// What to ask Photon for, per cuisine. Photon matches names, so a few typical words per cuisine.
const PHOTON_TERMS = {
  hotpot: ["hot pot", "hotpot", "shabu"],
  korean_bbq: ["korean bbq", "korean", "kbbq"],
  japanese: ["japanese", "sushi", "ramen"],
  sichuan: ["sichuan", "szechuan"],
  noodles: ["noodle", "ramen", "pho"],
  pizza: ["pizza"],
  dimsum: ["dim sum", "cantonese"],
  cafe: ["cafe", "coffee"],
  cantonese: ["cantonese", "roast duck", "bbq pork"],
  skewers: ["skewer", "chuan", "bbq"],
  hk_cafe: ["hong kong cafe", "hk cafe", "cha chaan teng"],
  taiwanese: ["taiwanese", "taiwan"],
  regional: ["hunan", "dongbei", "shanghai"],
  ramen: ["ramen", "udon"],
  izakaya: ["izakaya"],
  korean: ["korean", "soondubu", "bibimbap"],
  thai: ["thai"],
  vietnamese: ["pho", "vietnamese", "banh mi"],
  indian: ["indian", "tandoor", "curry"],
  american: ["burger", "american", "diner"],
  steak: ["steakhouse", "steak", "grill"],
  italian: ["italian", "pasta", "trattoria"],
  mexican: ["mexican", "taco", "burrito"],
  latin: ["brazilian", "peruvian", "argentin", "latin american", "churrasco"],
  mediterranean: ["mediterranean", "shawarma", "greek"],
  seafood: ["seafood", "oyster", "fish"],
  brunch: ["brunch", "breakfast", "pancake"],
  fried_chicken: ["fried chicken", "wings", "chicken"],
  pub: ["pub", "tavern"],
  buffet: ["buffet", "all you can eat"],
  vegetarian: ["vegetarian", "vegan"],
  bubble_tea: ["bubble tea", "milk tea", "boba"],
  dessert: ["dessert", "bakery", "ice cream"],
  "": ["restaurant"],
};

async function photonPlaces(term, center, radiusKm, signal) {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((center.lat * Math.PI) / 180));
  const params = new URLSearchParams({
    q: term,
    limit: "40",
    bbox: [center.lng - dLng, center.lat - dLat, center.lng + dLng, center.lat + dLat].map((n) => n.toFixed(4)).join(","),
    lat: String(center.lat),
    lon: String(center.lng),
  });
  if (getLang() !== "zh") params.set("lang", "en");
  for (const kind of ["restaurant", "cafe", "fast_food", "food_court"]) params.append("osm_tag", "amenity:" + kind);
  const timeout = withTimeout(8000, signal);
  try {
    const res = await fetch(`${PHOTON}?${params}`, { signal: timeout.signal });
    if (!res.ok) throw new Error("photon_" + res.status);
    const data = await res.json();
    if (!Array.isArray(data.features)) throw new Error("photon_invalid");
    return data.features
      .map((f) => {
        const p = f.properties || {};
        const [lng, lat] = f.geometry?.coordinates || [];
        return {
          name: p.name || "",
          address: formatAddress(p),
          lat,
          lng,
          poi_id: p.osm_id ? `${p.osm_type || "N"}${p.osm_id}` : null,
          distKm: Number.isFinite(lat) && Number.isFinite(lng) ? haversineKm(center, { lat, lng }) : Infinity,
          source: "photon",
        };
      })
      .filter((r) => r.name && Number.isFinite(r.lat) && Number.isFinite(r.lng) && r.distKm <= radiusKm);
  } finally {
    timeout.done();
  }
}

/** Restaurants of a cuisine anywhere within `radiusKm` of `center` (OpenStreetMap via Photon). Throws only if every lookup failed. */
export async function cuisinePlaces(center, cuisineSlug, { radiusKm = 10, signal } = {}) {
  const terms = PHOTON_TERMS[cuisineSlug || ""] || [String(cuisineSlug).replace(/_/g, " ")];
  const settled = await Promise.allSettled(terms.map((term) => photonPlaces(term, center, radiusKm, signal)));
  signal?.throwIfAborted();
  const ok = settled.filter((r) => r.status === "fulfilled");
  if (!ok.length) throw settled[0].reason;
  const seen = new Set();
  const out = [];
  for (const r of ok) {
    for (const v of r.value) {
      const key = v.poi_id || `${v.name.toLowerCase()}|${v.lat.toFixed(3)}|${v.lng.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
  }
  return out.sort((a, b) => a.distKm - b.distKm);
}

/** "granted" | "prompt" | "denied" | "unsupported". Never triggers the permission prompt. */
export async function locationPermission() {
  if (!navigator.geolocation) return "unsupported";
  try {
    const r = await navigator.permissions?.query({ name: "geolocation" });
    return r?.state || "prompt";
  } catch {
    return "prompt";
  }
}

/** The browser's current position. Calling this is what makes the browser ask for permission (if it has not been decided yet).
 *  Rejects with Error whose .reason is "denied" | "unavailable" | "timeout" | "unsupported". */
export function currentPosition({ timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const fail = (reason) => Object.assign(new Error(reason), { reason });
    if (!navigator.geolocation) return reject(fail("unsupported"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => {
        const why = { 1: "denied", 3: "timeout" }[e.code] || "unavailable";
        reject(fail(why));
      },
      { enableHighAccuracy: false, timeout, maximumAge: 2 * 60000 }
    );
  });
}

/**
 * Restaurants near the middle of several people, ranked by how fair the trip is for all of them
 * (a long trip and an uneven trip both cost points). Returns venues with `dists` (km from each point, same order as `points`).
 * With several cravings, results are interleaved so everybody's craving shows up.
 */
export async function groupSuggestions({ points, cuisines = [], signal, limit = 24 }) {
  const pts = points.filter((p) => p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng)).map((p) => ({ lat: +p.lat, lng: +p.lng }));
  if (!pts.length) return [];
  const center = midpoint(pts);
  const reach = Math.max(...pts.map((p) => haversineKm(center, p)));
  // look around the whole stretch between the people, not just right at the middle
  const radiusKm = Math.min(18, Math.max(7, reach + 5));
  const wanted = [...new Set(cuisines.length ? cuisines : [""])];
  const nearby = async (cuisine) => {
    const [online, local] = await Promise.allSettled([
      cuisinePlaces(center, cuisine, { radiusKm, signal }),
      torontoVenuesNear(center, cuisine, radiusKm),
    ]);
    signal?.throwIfAborted();
    if (online.status === "rejected" && local.status === "rejected") throw online.reason;
    const seen = new Set();
    const merged = [];
    for (const v of [...(online.value || []), ...(local.value || [])]) {
      const key = `${v.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")}|${v.lat.toFixed(3)}|${v.lng.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(v);
    }
    return merged;
  };
  // One cuisine failing to load shouldn't hide the others; only give up if every lookup failed.
  const settled = await Promise.allSettled(wanted.map(nearby));
  if (settled.every((r) => r.status === "rejected")) throw settled[0].reason;
  const lists = settled.map((r) => (r.status === "fulfilled" ? r.value : []));
  const ranked = lists.map((list, i) =>
    list
      .map((v) => {
        const dists = pts.map((p) => haversineKm(p, v));
        const hi = Math.max(...dists);
        const lo = Math.min(...dists);
        return { ...v, forCuisine: wanted[i], dists, score: hi + (hi - lo) };
      })
      .sort((a, b) => a.score - b.score));
  const out = [];
  const seen = new Set();
  for (let i = 0; out.length < limit && ranked.some((l) => i < l.length); i++) {
    for (const l of ranked) {
      const v = l[i];
      if (!v) continue;
      const key = v.poi_id || `${v.name}|${v.lat}|${v.lng}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
  }
  return out.slice(0, limit);
}
