// "Where am I looking?" One saved place (kept only in this browser) that Discover, Host and the Map start from.
// The device position is read only when the person taps "Use my location"; a typed city/place works too.
import { state, bus, areaOf } from "./state.js";
import { currentPosition, reverseLabel } from "./geo.js";
import { haversineKm } from "./util.js";
import { getLang } from "./i18n.js";

const KEY = "tb.loc";

function clean(v) {
  const lat = Number(v?.lat);
  const lng = Number(v?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, label: String(v.label || "").slice(0, 80), gps: !!v.gps };
}

export function loadLoc() {
  try {
    state.loc = clean(JSON.parse(localStorage.getItem(KEY) || "null"));
  } catch {
    state.loc = null;
  }
  return state.loc;
}

export function setLoc(loc) {
  const c = loc ? clean(loc) : null;
  if (loc && !c) return null; // bad coordinates: keep what we have
  state.loc = c;
  try {
    if (state.loc) localStorage.setItem(KEY, JSON.stringify(state.loc));
    else localStorage.removeItem(KEY);
  } catch {}
  bus.emit("loc", state.loc);
  return state.loc;
}

/** Ask the browser for the position (this is what shows the permission prompt) and remember it with a place name. */
export async function locateMe() {
  const pos = await currentPosition();
  state.pos = { lat: pos.lat, lng: pos.lng };
  const label = await reverseLabel(pos).catch(() => "");
  return setLoc({ lat: pos.lat, lng: pos.lng, label, gps: true });
}

/** The place to start from: the saved one, else the centre of an older "home area" on the profile, else nothing. */
export function effectiveLoc() {
  if (state.loc) return state.loc;
  const a = areaOf(state.me?.area_id);
  if (a && a.center_lat != null && a.center_lng != null) return { lat: Number(a.center_lat), lng: Number(a.center_lng), label: (getLang() === "zh" ? a.name_zh : a.name_en) || a.name_en || "", gps: false, fromArea: true };
  return null;
}

/** Where a table is: its meeting point, else its restaurant, else its old area centre. */
export function tablePoint(tb) {
  const pick = (la, ln) => (la != null && ln != null && Number.isFinite(+la) && Number.isFinite(+ln) ? { lat: +la, lng: +ln } : null);
  const a = areaOf(tb.area_id);
  return pick(tb.meet_lat, tb.meet_lng) || pick(tb.venue?.lat, tb.venue?.lng) || (a ? pick(a.center_lat, a.center_lng) : null);
}

export function kmFrom(loc, tb) {
  const p = tablePoint(tb);
  return loc && p ? haversineKm(loc, p) : null;
}
