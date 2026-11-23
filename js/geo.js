// Place search and restaurant suggestions.
//
// Both services below are free, key-less, OpenStreetMap-based, and called straight from the
// browser. They are fine for a test version. Before a public launch, replace them with a
// service you have an agreement with (e.g. Google Places, Mapbox, or Tencent Maps in a
// WeChat Mini Program) and keep the same function signatures.
//   - Photon (photon.komoot.io): search a place by name or address.
//   - Overpass (overpass-api.de): restaurants near a point, by cuisine tag.
import { haversineKm, midpoint } from "./util.js";
import { searchTorontoVenues, torontoVenuesNear, nameMatchesKey } from "./toronto-venues.js";
import { getLang } from "./i18n.js";

const PHOTON = "https://photon.komoot.io/api/";
const OVERPASS = "https://overpass.private.coffee/api/interpreter";
const TORONTO = { lat: 43.6532, lng: -79.3832 };
// Toronto-only data (DineSafe names, the landmark list) is used only when the person is looking at the Toronto region.
export const nearToronto = (p) => !p || !Number.isFinite(+p.lat) || haversineKm({ lat: +p.lat, lng: +p.lng }, TORONTO) < 90;

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

/** Search a place or address anywhere; results are biased toward `near`. Throws on network errors so the UI can show landmarks instead. */
export async function searchPlaces(query, { near, signal, restaurantsOnly = false } = {}) {
  const q = query.trim();
  if (q.length < 2) return [];
  const here = nearToronto(near);
  const local = here ? await searchTorontoVenues(q, near).catch(() => []) : [];
  signal?.throwIfAborted();
  const landmarks = restaurantsOnly || !here ? [] : searchLandmarks(q);
  if (local.length || landmarks.length) return [...landmarks, ...local].slice(0, 7);
  // Photon only translates names into en/de/fr/it. For Chinese we ask for the local names (English in Toronto).
  const params = new URLSearchParams({ q, limit: "7" });
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
          cc: String(p.countrycode || "").toUpperCase() || undefined,
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

/** Name of the place at a point (city/district) and its country code, for "near Vancouver" and the local currency. */
export async function reverseGeocode({ lat, lng }, { signal } = {}) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lng), limit: "1" });
  if (getLang() !== "zh") params.set("lang", "en");
  const t = withTimeout(7000, signal);
  try {
    const res = await fetch(`${PHOTON.replace(/api\/$/, "reverse")}?${params}`, { signal: t.signal });
    if (!res.ok) return { label: "", cc: "" };
    const p = (await res.json())?.features?.[0]?.properties || {};
    return { label: p.city || p.district || p.locality || p.county || p.name || p.state || "", cc: String(p.countrycode || "").toUpperCase() };
  } catch {
    return { label: "", cc: "" };
  } finally {
    t.done();
  }
}
export const reverseLabel = async (pt, opts) => (await reverseGeocode(pt, opts)).label;

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
  bbq: ['[amenity=restaurant][cuisine~"korean|barbecue|bbq|yakiniku|grill"]', '[amenity=restaurant][name~"bbq|korean|烤肉|烧烤|串",i]'],
  japanese: ['[amenity=restaurant][cuisine~"japanese|sushi|ramen|izakaya"]'],
  sichuan: ['[amenity=restaurant][cuisine~"sichuan|szechuan"]', '[amenity=restaurant][name~"川|sichuan|szechuan",i]'],
  hunan: ['[amenity=restaurant][cuisine~"hunan"]', '[amenity=restaurant][name~"湘|hunan",i]'],
  dongbei: ['[amenity=restaurant][name~"东北|dongbei|northeast",i]'],
  jiangzhe: ['[amenity=restaurant][cuisine~"shanghai"]', '[amenity=restaurant][name~"上海|江浙|shanghai|jiangnan|zhejiang",i]'],
  xibei: ['[amenity=restaurant][name~"西北|新疆|兰州|xinjiang|lanzhou",i]'],
  yungui: ['[amenity=restaurant][name~"云南|贵州|云贵|yunnan|guizhou",i]'],
  noodles: ['[amenity=restaurant][cuisine~"noodle|ramen|pho"]', '[amenity=restaurant][name~"noodle|面",i]'],
  dimsum: ['[amenity=restaurant][cuisine~"dim_sum|cantonese"]', '[amenity=restaurant][name~"dim sum|点心|茶",i]'],
  cafe: ["[amenity=cafe]"],
  bar: ["[amenity~'^(pub|bar)$']", '[amenity=restaurant][name~"izakaya|居酒屋|pub",i]'],
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
  // cuisines
  chinese: ["chinese restaurant", "chinese", "dumpling", "noodle house", "szechuan"],
  sichuan: ["sichuan", "szechuan"],
  hunan: ["hunan", "xiang"],
  cantonese: ["cantonese", "roast duck", "bbq pork", "hong kong cafe", "cha chaan teng"],
  dongbei: ["dongbei", "northeastern chinese"],
  jiangzhe: ["shanghai", "jiangnan", "zhejiang"],
  xibei: ["xinjiang", "lanzhou", "northwest chinese"],
  yungui: ["yunnan", "guizhou"],
  taiwanese: ["taiwanese", "taiwan"],
  japanese: ["japanese", "sushi", "ramen"],
  korean: ["korean", "soondubu", "bibimbap"],
  asia: ["thai", "vietnamese", "indian"],
  thai: ["thai"],
  vietnamese: ["pho", "vietnamese", "banh mi"],
  indian: ["indian", "tandoor", "curry"],
  western: ["bistro", "grill", "steakhouse"],
  american: ["burger", "american", "diner"],
  italian: ["italian", "pasta", "pizza", "trattoria"],
  french: ["french", "bistro", "brasserie"],
  mexican: ["mexican", "taco", "burrito", "peruvian", "brazilian"],
  mediterranean: ["mediterranean", "shawarma", "greek"],
  // formats
  hotpot: ["hot pot", "hotpot", "shabu"],
  bbq: ["bbq", "korean bbq", "yakiniku", "skewer"],
  dimsum: ["dim sum", "cantonese"],
  noodles: ["noodle", "ramen", "pho"],
  seafood: ["seafood", "oyster", "fish"],
  buffet: ["buffet", "all you can eat"],
  brunch: ["brunch", "breakfast", "pancake"],
  veg: ["vegetarian", "vegan"],
  // venue types that narrow the search
  cafe: ["cafe", "coffee", "bubble tea", "dessert", "bakery"],
  bar: ["pub", "izakaya", "tavern"],
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

/**
 * One search per key (cuisine, formats, venue type), merged: a place that matches several keys shows once.
 * Results carry `forCuisine` (the key they were found for). Throws only if every search failed.
 */
export async function restaurantsForKeys(center, keys, { radius = 2200, signal, limit = 8 } = {}) {
  const wanted = keys?.length ? keys.slice(0, 4) : [""];
  const runs = await Promise.allSettled(wanted.map((k) => restaurantsNear(center, k, { radius, signal })));
  signal?.throwIfAborted();
  if (runs.every((r) => r.status === "rejected")) throw runs[0].reason;
  const seen = new Set();
  const out = [];
  runs.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    for (const x of r.value) {
      const id = x.poi_id || `${x.name}|${x.lat}|${x.lng}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ ...x, forCuisine: wanted[i], score: x.distKm - (i === 0 ? 0.3 : 0) });
    }
  });
  return { list: out.sort((a, b) => a.score - b.score).slice(0, limit), wanted };
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
// `google(cuisineKey, center, radiusKm)` (optional) returns Google's places for one craving, or null to use the free data.
export async function groupSuggestions({ points, cuisines = [], votes = null, signal, limit = 24, google = null }) {
  const pts = points.filter((p) => p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng)).map((p) => ({ lat: +p.lat, lng: +p.lng }));
  if (!pts.length) return [];
  const center = midpoint(pts);
  const reach = Math.max(...pts.map((p) => haversineKm(center, p)));
  // look around the whole stretch between the people, not just right at the middle
  const radiusKm = Math.min(18, Math.max(7, reach + 5));
  const wanted = [...new Set(cuisines.length ? cuisines : [""])];
  const nearby = async (cuisine) => {
    if (google) {
      const g = await google(cuisine, center, radiusKm).catch(() => null);
      signal?.throwIfAborted();
      if (g?.length) return g;
    }
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
  // Several people's cravings: a place that fits more of them comes first (a ramen bar suits "Japanese" and
  // "noodles" alike), then the fairest trip for everyone. Without votes, take turns between the cravings.
  if (votes && Object.keys(votes).length) {
    const total = Object.values(votes).reduce((n, x) => n + x, 0);
    const byKey = new Map();
    ranked.forEach((l, i) => l.forEach((v) => {
      const key = v.poi_id || `${v.name}|${v.lat}|${v.lng}`;
      const cur = byKey.get(key) || { ...v, fits: new Set() };
      cur.fits.add(wanted[i]);
      byKey.set(key, cur);
    }));
    const all = [...byKey.values()].map((v) => {
      for (const k of wanted) if (nameMatchesKey(v.name, k)) v.fits.add(k);
      const fit = [...v.fits].reduce((n, k) => n + (votes[k] || 0), 0);
      return { ...v, fits: [...v.fits], fitVotes: fit, fitsAll: fit >= total };
    });
    all.sort((a, b) => b.fitVotes - a.fitVotes || a.score - b.score);
    return all.slice(0, limit);
  }
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
