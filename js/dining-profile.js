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

export function buildProfile(rows = []) {
  const clean = rows.filter((r) => r && r.overall);
  const n = clean.length;
  if (!n) return { n: 0 };
  const mean = avg(clean.map(mealScore));
  const NEUTRAL = 3; // a meal that felt "okay" neither pulls a kind of table up nor down
  const cuisine = tally(clean, (r) => r.cuisine, NEUTRAL);
  const occasion = tally(clean, (r) => r.occasion, NEUTRAL);
  const size = tally(clean, (r) => sizeBucket(Number(r.seats) || 0), NEUTRAL);
  const time = tally(clean, (r) => timeBucket(r.starts_at), NEUTRAL);
  const vibes = new Map();
  for (const r of clean) for (const v of r.vibes || []) if (VIBES_PUBLIC.includes(v)) vibes.set(v, (vibes.get(v) || 0) + 1);
  const lifts = clean.filter((r) => r.mood_before && r.mood_after).map((r) => r.mood_after - r.mood_before);
  const best = (list) => list.find((e) => e.avg >= 3.5) || null;
  return {
    n,
    mean,
    eatMost: [...cuisine].sort((a, b) => b.n - a.n || b.avg - a.avg).slice(0, 3),
    bestOccasion: best(occasion),
    bestSize: best(size),
    bestTime: best(time),
    topVibes: [...vibes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k),
    lift: avg(lifts),
    aff: {
      cuisine: Object.fromEntries(cuisine.map((e) => [e.key, e.aff])),
      occasion: Object.fromEntries(occasion.map((e) => [e.key, e.aff])),
      size: Object.fromEntries(size.map((e) => [e.key, e.aff])),
      time: Object.fromEntries(time.map((e) => [e.key, e.aff])),
    },
  };
}

/** How well an upcoming table fits this profile. `score` is 0 for no signal; `why` lists up to two reasons. */
export function scoreTable(tb, prof) {
  if (!prof || !prof.n) return { score: 0, why: [] };
  const parts = [
    ["cuisine", prof.aff.cuisine[tb.cuisine], 1.0],
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
