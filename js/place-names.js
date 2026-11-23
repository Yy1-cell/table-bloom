// Starting points are shown to the other people at a table, so they must never reveal a home address.
// We store a public name instead: a landmark or station, or "Near <street>" (no house number). Stored in English;
// shown in the reader's language ("Near Robarts Library" / "罗巴茨图书馆附近").
import { t, getLang } from "./i18n.js";
import { LANDMARKS } from "./geo.js";
import { haversineKm } from "./util.js";

const MY_LOCATION = ["my location", "我的位置", "current location", "当前位置", "your location", "你的位置"];
const looksPrivate = (name) => !name || /^\s*\d/.test(name) || MY_LOCATION.includes(String(name).trim().toLowerCase());
const landmarkByName = (name) => LANDMARKS.find((l) => l.name === name || l.zh === name);
function nearestLandmark(pt, maxKm = 1.2) {
  if (!pt || !Number.isFinite(+pt.lat) || !Number.isFinite(+pt.lng)) return null;
  let best = null;
  for (const l of LANDMARKS) {
    const d = haversineKm({ lat: +pt.lat, lng: +pt.lng }, l);
    if (d <= maxKm && (!best || d < best.d)) best = { l, d };
  }
  return best?.l || null;
}
const streetOf = (p) => String(p.address || p.name || "").split(",")[0].replace(/^\s*\d+[\w-]*\s+/, "").trim();

/** The label to store for a starting point {name, address, lat, lng}. */
export function publicLabel(p) {
  if (!p) return "";
  const lm = landmarkByName(p.name);
  if (lm) return lm.name;
  if (!looksPrivate(p.name)) return p.name;
  const near = nearestLandmark(p);
  if (near) return `Near ${near.name}`;
  const street = streetOf(p);
  return street && !/^\d/.test(street) && !looksPrivate(street) ? `Near ${street}` : "Shared location";
}

const localName = (name) => {
  const lm = landmarkByName(name);
  if (lm) return getLang() === "zh" ? lm.zh : lm.name;
  // "罗巴茨图书馆 (Robarts Library)": English UI shows the English part only
  const m = String(name).match(/^(.*?)\s*[（(]([^）)]+)[）)]\s*$/);
  if (m && getLang() !== "zh" && /[一-鿿]/.test(m[1]) && !/[一-鿿]/.test(m[2])) return m[2];
  return name;
};

/** How to show a stored starting point to the reader. `pt` = its coordinates (for old labels like "My location"). */
export function startName(label, pt) {
  const s = String(label || "").trim();
  if (!s) return "";
  const near = s.match(/^Near (.+)$/);
  if (near) return t("td.nearX", { x: localName(near[1]) });
  if (s === "Shared location") return t("td.locShared");
  if (looksPrivate(s)) {
    const lm = nearestLandmark(pt);
    return lm ? t("td.nearX", { x: localName(lm.name) }) : t("td.locShared");
  }
  return localName(s);
}

/** Map markers sit within ~200 m of the real point (the middle is still worked out from the real points). */
export const fuzz = (v) => Math.round(Number(v) / 0.002) * 0.002;
