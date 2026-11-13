// Small helpers shared by every module. No dependencies.
import { getLang } from "./i18n.js";

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escape user-authored text before putting it into an HTML string. */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export const debounce = (fn, ms = 250) => {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
};

export const uid = () =>
  (crypto.randomUUID && crypto.randomUUID()) ||
  "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

// ---- safe storage (private browsing / blocked storage must never crash the app)
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

// ---- dates
const locale = () => (getLang() === "zh" ? "zh-CN" : "en-CA");

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isToday(iso) {
  return sameDay(new Date(iso), new Date());
}

export function isPast(iso, graceMinutes = 0) {
  return new Date(iso).getTime() + graceMinutes * 60000 < Date.now();
}

const time24 = (d) => d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", hour12: false });

/** "Today · 18:00", "Tomorrow · 12:30", "Sat, Nov 14 · 18:00" */
export function fmtWhen(iso, t) {
  const d = new Date(iso);
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  let day;
  if (sameDay(d, now)) day = t("when.today");
  else if (sameDay(d, tomorrow)) day = t("when.tomorrow");
  else day = d.toLocaleDateString(locale(), { weekday: "short", month: "short", day: "numeric" });
  return `${day} · ${time24(d)}`;
}

export function fmtDateLong(iso) {
  return new Date(iso).toLocaleDateString(locale(), { weekday: "long", month: "long", day: "numeric" });
}

export function fmtDay(dateStr) {
  // dateStr: YYYY-MM-DD
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale(), { year: "numeric", month: "short", day: "numeric" });
}

export const pad = (n) => String(n).padStart(2, "0");
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Combine a local date (YYYY-MM-DD) and time (HH:MM) into an ISO string. */
export function toISO(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0).toISOString();
}

export function fmtMoney(cents) {
  if (cents == null) return "";
  const v = cents / 100;
  return "C$" + (Number.isInteger(v) ? v : v.toFixed(2));
}

// ---- geography
export function haversineKm(a, b) {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function midpoint(points) {
  const pts = points.filter((p) => p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng));
  if (!pts.length) return null;
  return {
    lat: pts.reduce((s, p) => s + +p.lat, 0) / pts.length,
    lng: pts.reduce((s, p) => s + +p.lng, 0) / pts.length,
  };
}

/** Language code for Google Maps (labels, buttons and reviews' UI follow the app language). */
export const mapHl = () => (getLang() === "zh" ? "zh-CN" : "en");

export function mapsUrl({ name, address, lat, lng }) {
  const text = [name, address].filter(Boolean).join(" ");
  const q = text || (lat != null && lng != null ? `${lat},${lng}` : "");
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q) + "&hl=" + mapHl();
}

/** Google Maps embed (no API key). `q` can be a place or a search like "hotpot restaurants near 43.65,-79.38". */
export function googleEmbedUrl(q, zoom = 15, ll) {
  const center = ll && Number.isFinite(+ll.lat) && Number.isFinite(+ll.lng) ? `&ll=${ll.lat},${ll.lng}` : "";
  return `https://maps.google.com/maps?q=${encodeURIComponent(q)}${center}&z=${zoom}&hl=${mapHl()}&output=embed`;
}

export function appleMapsUrl({ name, lat, lng }) {
  const q = name || "Table & Bloom";
  return lat != null && lng != null
    ? `https://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(q)}`
    : `https://maps.apple.com/?q=${encodeURIComponent(q)}`;
}

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;

// ---- calendar file (.ics)
const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

export function buildICS({ id, title, startsAt, durationMin = 90, location, description }) {
  const end = new Date(new Date(startsAt).getTime() + durationMin * 60000);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Table & Bloom//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${id}@tableandbloom`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(startsAt)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(title)}`,
    location ? `LOCATION:${icsText(location)}` : "",
    description ? `DESCRIPTION:${icsText(description)}` : "",
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

export function downloadText(filename, text, type = "text/calendar") {
  const url = URL.createObjectURL(new Blob([text], { type: type + ";charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Taste match 60–98 from how high the table's cuisine sits in my ranking. */
export function tasteMatch(cuisineSlug, ranks) {
  if (!cuisineSlug) return 72;
  const i = ranks.indexOf(cuisineSlug);
  if (i < 0) return 60;
  const step = ranks.length > 1 ? 38 / (ranks.length - 1) : 0;
  return Math.round(98 - i * step);
}

/** Shrink a photo before upload: longest side <= max px, JPEG. Keeps uploads small and fast on mobile data. */
export async function resizeImage(file, { max = 1280, quality = 0.78 } = {}) {
  if (!file || !/^image\//.test(file.type || "")) throw new Error("bad_photo");
  let bmp;
  try {
    bmp = await createImageBitmap(file); // honours EXIF rotation
  } catch {
    bmp = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => (URL.revokeObjectURL(url), resolve(img));
      img.onerror = () => (URL.revokeObjectURL(url), reject(new Error("bad_photo")));
      img.src = url;
    });
  }
  const w = bmp.width || bmp.naturalWidth;
  const h = bmp.height || bmp.naturalHeight;
  const k = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
  if (!blob) throw new Error("bad_photo");
  return blob;
}

const dest = ({ lat, lng, name, address }) => (lat != null && lng != null ? `${lat},${lng}` : [name, address].filter(Boolean).join(" "));

/** Google Maps directions. mode: transit | walking | driving | bicycling. Without `origin` Google starts from the phone's current location. */
export function googleDirectionsUrl(place, { origin, mode = "transit" } = {}) {
  let u = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest(place))}&travelmode=${mode}&hl=${mapHl()}`;
  if (origin && origin.lat != null) u += `&origin=${encodeURIComponent(`${origin.lat},${origin.lng}`)}`;
  return u;
}

/** Apple Maps directions (iPhone). r = transit, w = walking, d = driving. */
export function appleDirectionsUrl(place, { origin, mode = "transit" } = {}) {
  const flag = { transit: "r", walking: "w", driving: "d", bicycling: "w" }[mode] || "r";
  let u = `https://maps.apple.com/?daddr=${encodeURIComponent(dest(place))}&dirflg=${flag}`;
  if (origin && origin.lat != null) u += `&saddr=${encodeURIComponent(`${origin.lat},${origin.lng}`)}`;
  return u;
}

/** The database default name "New friend" shown in the current language (real names are left alone). */
export const personName = (n) => (n === "New friend" && getLang() === "zh" ? "新朋友" : n || "");
