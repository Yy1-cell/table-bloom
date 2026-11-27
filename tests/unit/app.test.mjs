// Tests for app rules: privacy of starting points, which places count as real restaurants,
// communities, diet tags, error messages and the two languages.
import "./_setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { publicLabel, fuzz } from "../../js/place-names.js";
import { isRealPlace, COMMUNITIES, REPORT_REASONS, CUISINES, DIET_FIXED, DIET_MEAL } from "../../js/data.js";
import { EN, ZH } from "../../js/strings.js";
import { codeOf, ApiError } from "../../js/errors.js";
import { dietSplit } from "../../js/views/diet.js";

// ---------------------------------------------------------------- privacy: starting points
test("publicLabel never keeps a house number", () => {
  assert.equal(publicLabel({ name: "123 Main Street", address: "123 Main Street, Toronto" }), "Near Main Street");
  assert.equal(publicLabel({ name: "My location", address: "45 Bloor St W" }), "Near Bloor St W");
  assert.equal(publicLabel({ name: "Robarts Library" }), "Robarts Library");
  assert.equal(publicLabel(null), "");
});
test("publicLabel hides an address even when it doesn't start with the number", () => {
  const out = publicLabel({ name: "Unit 5, 22 Elm Street", address: "22 Elm Street, Toronto", lat: 0, lng: 0 });
  assert.ok(!/\d/.test(out), `got "${out}"`);
});
test("property: a street address typed as a place name is never shown with its number", () => {
  const street = fc.constantFrom("Elm Street", "Bloor St W", "College St", "Spadina Ave", "Yonge Street", "King Rd", "Dundas Street West");
  fc.assert(fc.property(fc.integer({ min: 1, max: 99999 }), street, fc.constantFrom("", "Unit 3, ", "Apt 12 - ", "Home: "), (n, s, pre) => {
    const out = publicLabel({ name: `${pre}${n} ${s}`, address: `${n} ${s}, Toronto, ON`, lat: 0, lng: 0 });
    assert.ok(!out.includes(String(n)), `"${pre}${n} ${s}" -> "${out}"`);
  }), { numRuns: 500 });
});
test("property: map markers move a starting point by at most ~110 m", () => {
  fc.assert(fc.property(fc.double({ min: -90, max: 90, noNaN: true }), (v) => {
    assert.ok(Math.abs(fuzz(v) - v) <= 0.001 + 1e-9);
  }));
});

// ---------------------------------------------------------------- real restaurants only (tables with new people)
test("isRealPlace accepts places from Google, OpenStreetMap and the City of Toronto list", () => {
  for (const id of ["g:ChIJabc", "d:1x9k", "N12345", "W987", "R4"]) assert.ok(isRealPlace({ name: "X", poi_id: id }), id);
});
test("isRealPlace rejects hand-typed spots", () => {
  for (const p of [null, {}, { name: "My place" }, { name: "X", poi_id: "" }, { name: "X", poi_id: "home" }, { name: "", poi_id: "g:abc" }, { name: "X", poi_id: "N12a" }]) {
    assert.equal(isRealPlace(p), false, JSON.stringify(p));
  }
});
test("property: an id without a known source is never a real place", () => {
  fc.assert(fc.property(fc.string().filter((s) => !/^(g:.+|d:.+|[NWR][0-9]+)$/.test(s)), (id) => {
    assert.equal(isRealPlace({ name: "Somewhere", poi_id: id }), false);
  }));
});
test("the app and the database agree on what a real place id looks like", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/2026-11-24_communities_safety.sql", import.meta.url), "utf8");
  assert.ok(sql.includes("'^(g:.+|d:.+|[NWR][0-9]+)$'"));
});

// ---------------------------------------------------------------- communities
test("the app and the database list the same communities", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/2026-11-24_communities_safety.sql", import.meta.url), "utf8");
  const inSql = sql.match(/community in \(([^)]*)\)/)[1].match(/'([a-z]+)'/g).map((s) => s.slice(1, -1)).sort();
  assert.deepEqual(COMMUNITIES.map((c) => c.slug).sort(), inSql);
});
test("only the women & non-binary community is for a group; the others are open to everyone", () => {
  assert.deepEqual(COMMUNITIES.filter((c) => c.forGroup).map((c) => c.slug), ["women"]);
});

// ---------------------------------------------------------------- languages
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
test("English and Chinese have exactly the same text keys", () => {
  const onlyEn = Object.keys(EN).filter((k) => !(k in ZH));
  const onlyZh = Object.keys(ZH).filter((k) => !(k in EN));
  assert.deepEqual({ onlyEn, onlyZh }, { onlyEn: [], onlyZh: [] });
});
test("every {placeholder} appears in both languages", () => {
  const bad = Object.keys(EN).filter((k) => k in ZH && placeholders(EN[k]) !== placeholders(ZH[k]));
  assert.deepEqual(bad, []);
});
test("every community, report reason, cuisine and diet tag has a name in both languages", () => {
  const need = [
    ...COMMUNITIES.flatMap((c) => [`com.${c.slug}`, `comFor.${c.slug}`]),
    ...REPORT_REASONS.map((r) => `rep.${r}`),
    ...[...DIET_FIXED, ...DIET_MEAL].map((d) => `dt.${d.slug}`),
  ];
  const missing = need.filter((k) => !(k in EN) || !(k in ZH));
  assert.deepEqual(missing, []);
  assert.deepEqual(CUISINES.filter((c) => !c.name_en || !c.name_zh).map((c) => c.slug), []);
});
test("no text is left empty", () => {
  const empty = [...Object.entries(EN), ...Object.entries(ZH)].filter(([, v]) => typeof v === "string" && !v.trim()).map(([k]) => k);
  assert.deepEqual(empty, []);
});

// ---------------------------------------------------------------- errors shown to people
test("codeOf turns server messages into known error codes", () => {
  assert.equal(codeOf(new ApiError("full")), "full");
  assert.equal(codeOf(new Error('new row violates: "login_needed"')), "login_needed");
  assert.equal(codeOf(new Error("real_place_needed")), "real_place_needed");
  assert.equal(codeOf(new TypeError("Failed to fetch")), "network");
  assert.equal(codeOf(null), "unknown");
});
test("every error code the safety rules can raise has a message in both languages", () => {
  for (const k of ["login_needed", "conduct_needed", "real_place_needed", "bad_capacity", "full", "network"]) {
    assert.ok(`err.${k}` in EN && `err.${k}` in ZH, k);
  }
});

// ---------------------------------------------------------------- diet tags
test("diet: vegan hides the tags it already implies, allergies stay on their own line", () => {
  const s = dietSplit(["vegan", "no_pork", "no_lamb", "allergy_peanut", "allergy_peanut", "not_a_tag"]);
  assert.ok(s.rules.includes("vegan"));
  assert.ok(!s.rules.includes("no_pork") && !s.rules.includes("no_lamb"));
  assert.deepEqual(s.allergies, ["allergy_peanut"]);
  assert.ok(![...s.rules, ...s.allergies, ...s.meal].includes("not_a_tag"));
});
test("property: diet tags are never duplicated or invented", () => {
  const all = [...DIET_FIXED, ...DIET_MEAL].map((d) => d.slug);
  fc.assert(fc.property(fc.array(fc.oneof(fc.constantFrom(...all), fc.string())), (tags) => {
    const s = dietSplit(tags);
    const out = [...s.allergies, ...s.rules, ...s.meal];
    assert.equal(new Set(out).size, out.length);
    assert.ok(out.every((x) => all.includes(x) && tags.includes(x)));
  }));
});
