// Place search and restaurant suggestions.
//
// Both services below are free, key-less, OpenStreetMap-based, and called straight from the
// browser. They are fine for a test version. Before a public launch, replace them with a
// service you have an agreement with (e.g. Google Places, Mapbox, or Tencent Maps in a
// WeChat Mini Program) and keep the same function signatures.
//   - Photon (photon.komoot.io): search a place by name or address.
//   - Overpass (overpass-api.de): restaurants near a point, by cuisine tag.
import { haversineKm } from "./util.js";
import { getLang } from "./i18n.js";

const PHOTON = "https://photon.komoot.io/api/";
const OVERPASS = "https://overpass-api.de/api/interpreter";
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
  outerSignal?.addEventListener("abort", () => ctl.abort(), { once: true });
  return { signal: ctl.signal, done: () => clearTimeout(timer) };
}

function formatAddress(p) {
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  return [street, p.district || p.locality, p.city, p.state].filter(Boolean).join(", ");
}

/** Search a place or address near the GTA. Throws on network errors so the UI can show landmarks instead. */
export async function searchPlaces(query, { near, signal } = {}) {
  const q = query.trim();
  if (q.length < 2) return [];
  // Photon only translates names into en/de/fr/it. For Chinese we ask for the local names (English in Toronto).
  const params = new URLSearchParams({ q, limit: "7", bbox: GTA_BBOX });
  if (getLang() !== "zh") params.set("lang", "en");
  if (near) {
    params.set("lat", String(near.lat));
    params.set("lon", String(near.lng));
  }
  const t = withTimeout(9000, signal);
  try {
    const res = await fetch(`${PHOTON}?${params}`, { signal: t.signal });
    if (!res.ok) throw new Error("search_" + res.status);
    const data = await res.json();
    const seen = new Set();
    return (data.features || [])
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
        const key = `${r.name}|${r.address}`;
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

/** Real restaurants near a point (e.g. the midpoint of the group), nearest first. */
export async function restaurantsNear(center, cuisineSlug, { radius = 1800, signal } = {}) {
  const filters = CUISINE_FILTERS[cuisineSlug] || ['[amenity~"restaurant|cafe"]'];
  const body = filters.map((f) => `nwr(around:${radius},${center.lat},${center.lng})${f}[name];`).join("");
  const query = `[out:json][timeout:12];(${body});out center 40;`;
  const t = withTimeout(14000, signal);
  try {
    const res = await fetch(`${OVERPASS}?data=${encodeURIComponent(query)}`, { signal: t.signal });
    if (!res.ok) throw new Error("overpass_" + res.status);
    const data = await res.json();
    const seen = new Set();
    return (data.elements || [])
      .map((e) => {
        const tags = e.tags || {};
        const lat = e.lat ?? e.center?.lat;
        const lng = e.lon ?? e.center?.lon;
        const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
        return {
          name: (getLang() === "zh" ? tags["name:zh"] || tags["name:zh-Hans"] || tags.name : tags["name:en"] || tags.name),
          address: [street, tags["addr:city"]].filter(Boolean).join(", "),
          lat,
          lng,
          poi_id: `${e.type?.[0]?.toUpperCase() || "N"}${e.id}`,
          cuisine: tags.cuisine || "",
          distKm: Number.isFinite(lat) ? haversineKm(center, { lat, lng }) : null,
        };
      })
      .filter((r) => r.name && Number.isFinite(r.lat))
      .filter((r) => (seen.has(r.name) ? false : (seen.add(r.name), true)))
      .sort((a, b) => a.distKm - b.distKm)
      .slice(0, 10);
  } finally {
    t.done();
  }
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
