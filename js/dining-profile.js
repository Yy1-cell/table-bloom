// Builds "my dining profile" from the post-meal check-ins, and scores tables against it for "For you".
// Pure functions (no DOM, no network) so they are easy to test.
import { VIBES_PUBLIC } from "./data.js";

export const sizeBucket = (n) => (n <= 3 ? "small" : n <= 6 ? "mid" : "big");
export function timeBucket(iso) {
  const h = new Date(iso).getHours();
  return h < 11 ? "morning" : h < 14 ? "lunch" : h < 17 ? "afternoon" : h < 21 ? "dinner" : "late";
}

/** How good one meal was for this person, 1 to 5.4: the overall feeling, nudged by their own vibe tags. */
export function mealScore(r) {
  const v = r.vibes || [];
  let s = Number(r.overall) || 0;
  if (v.some((x) => ["relaxed", "easy_talk", "warm"].includes(x))) s += 0.4;
  if (v.some((x) => ["awkward", "tiring"].includes(x))) s -= 0.4;
  return Math.max(1, Math.min(5.4, s));
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function tally(rows, keyOf, center) {
  const m = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (k == null || k === "") continue;
    const e = m.get(k) || { key: k, n: 0, sum: 0 };
    e.n += 1;
    e.sum += mealScore(r);
    m.set(k, e);
  }
  return [...m.values()]
    .map((e) => ({ ...e, avg: e.sum / e.n, aff: (e.n / (e.n + 2)) * (e.sum / e.n - center) }))
    .sort((a, b) => b.aff - a.aff || b.n - a.n);
}

/** `groupOf(slug)` says which cuisine group a leaf belongs to ("Sichuan" -> "chinese"), so a table that only says "Chinese" still gets a signal. */
export function buildProfile(rows = [], groupOf = () => "") {
  const clean = rows.filter((r) => r && r.overall);
  const n = clean.length;
  if (!n) return { n: 0 };
  const mean = avg(clean.map(mealScore));
  const NEUTRAL = 3; // a meal that felt "okay" neither pulls a kind of table up nor down
  // a meal can have several cuisines (Sichuan + Hunan): it counts once for each, and once for each region they belong to
  const cuisinesIn = (r) => (r.cuisines?.length ? r.cuisines : r.cuisine ? [r.cuisine] : []);
  const cuisine = tally(clean.flatMap((r) => cuisinesIn(r).map((c) => ({ ...r, _c: c }))), (r) => r._c, NEUTRAL);
  const group = tally(clean.flatMap((r) => [...new Set(cuisinesIn(r).map((c) => groupOf(c)).filter(Boolean))].map((g) => ({ ...r, _g: g }))), (r) => r._g, NEUTRAL);
  // a meal can have several formats (hot pot + BBQ): it counts once for each
  const format = tally(clean.flatMap((r) => (r.formats || []).map((f) => ({ ...r, _f: f }))), (r) => r._f, NEUTRAL);
  const vtype = tally(clean, (r) => r.venue_type, NEUTRAL);
  const occasion = tally(clean, (r) => r.occasion, NEUTRAL);
  const size = tally(clean, (r) => sizeBucket(Number(r.seats) || 0), NEUTRAL);
  const time = tally(clean, (r) => timeBucket(r.starts_at), NEUTRAL);
  const vibes = new Map();
  for (const r of clean) for (const v of r.vibes || []) if (VIBES_PUBLIC.includes(v)) vibes.set(v, (vibes.get(v) || 0) + 1);
  const lifts = clean.filter((r) => r.mood_before && r.mood_after).map((r) => r.mood_after - r.mood_before);
  const best = (list) => list.find((e) => e.avg >= 3.5) || null;
  const prof = {
    n,
    mean,
    eatMost: [...cuisine].sort((a, b) => b.n - a.n || b.avg - a.avg).slice(0, 3),
    // how I like to eat: formats and kinds of place, most frequent first
    styleMost: [...format.map((e) => ({ ...e, kind: "fm" })), ...vtype.map((e) => ({ ...e, kind: "vt" }))]
      .sort((a, b) => b.n - a.n || b.avg - a.avg)
      .slice(0, 3),
    bestOccasion: best(occasion),
    bestSize: best(size),
    bestTime: best(time),
    topVibes: [...vibes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k),
    lift: avg(lifts),
    aff: {
      cuisine: Object.fromEntries(cuisine.map((e) => [e.key, e.aff])),
      group: Object.fromEntries(group.map((e) => [e.key, e.aff])),
      format: Object.fromEntries(format.map((e) => [e.key, e.aff])),
      vtype: Object.fromEntries(vtype.map((e) => [e.key, e.aff])),
      occasion: Object.fromEntries(occasion.map((e) => [e.key, e.aff])),
      size: Object.fromEntries(size.map((e) => [e.key, e.aff])),
      time: Object.fromEntries(time.map((e) => [e.key, e.aff])),
    },
  };
  Object.defineProperty(prof, "groupOf", { value: groupOf, enumerable: false });
  return prof;
}

/** How well an upcoming table fits this profile. `score` is 0 for no signal; `why` lists up to two reasons. */
export function scoreTable(tb, prof) {
  if (!prof || !prof.n) return { score: 0, why: [] };
  // a specific cuisine I know; otherwise what I know about its region, counted a bit less
  // with several cuisines the one I like best counts
  const affs = (tb.cuisines?.length ? tb.cuisines : tb.cuisine ? [tb.cuisine] : [])
    .map((c) => {
      const g = prof.aff.group?.[prof.groupOf?.(c) || ""];
      return prof.aff.cuisine[c] ?? (g == null ? null : g * 0.6);
    })
    .filter((a) => a != null);
  const cuisineAff = affs.length ? Math.max(...affs) : null;
  const fmtAffs = (tb.formats || []).map((f) => prof.aff.format?.[f]).filter((a) => a != null);
  const formatAff = fmtAffs.length ? fmtAffs.reduce((a, b) => a + b, 0) / fmtAffs.length : null;
  const parts = [
    ["cuisine", cuisineAff, 1.0],
    ["format", formatAff, 0.8],
    ["type", prof.aff.vtype?.[tb.venue_type], 0.4],
    ["occasion", prof.aff.occasion[tb.occasion], 0.8],
    ["size", prof.aff.size[sizeBucket(Number(tb.capacity) || 0)], 0.6],
    ["time", prof.aff.time[timeBucket(tb.starts_at)], 0.5],
  ];
  let score = 0;
  const why = [];
  for (const [kind, aff, w] of parts) {
    if (aff == null) continue;
    score += aff * w;
    if (aff > 0.15) why.push(kind);
  }
  return { score, why: why.slice(0, 2) };
}
