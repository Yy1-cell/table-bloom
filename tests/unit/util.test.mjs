// Unit + property-based tests for small helpers in js/util.js.
import "./_setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { esc, haversineKm, midpoint, tasteMatch, buildICS, toISO } from "../../js/util.js";

const unesc = (s) => s.replace(/&lt;|&gt;|&quot;|&#39;|&#039;|&amp;/g, (m) => ({ "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#039;": "'", "&amp;": "&" })[m]);
const point = fc.record({ lat: fc.double({ min: -80, max: 80, noNaN: true }), lng: fc.double({ min: -179, max: 179, noNaN: true }) });

// ---- esc: everything people type is shown through esc(), so it must never let HTML through
test("esc escapes the five HTML characters", () => {
  assert.equal(esc(`<img src=x onerror="alert('x')">&`), "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;");
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
  assert.equal(esc(0), "0");
});
test("property: esc output never contains < > \" ' and decodes back to the input", () => {
  fc.assert(fc.property(fc.string({ unit: "binary" }), (s) => {
    const out = esc(s);
    assert.ok(!/[<>"']/.test(out));
    assert.equal(unesc(out), s);
  }), { numRuns: 2000 });
});

// ---- distances: used for "x km away" and for finding a fair middle
test("haversineKm: Toronto to Montreal is about 504 km", () => {
  const d = haversineKm({ lat: 43.6532, lng: -79.3832 }, { lat: 45.5019, lng: -73.5674 });
  assert.ok(Math.abs(d - 504) < 5, `got ${d}`);
});
test("property: distance is never negative, is 0 to itself and the same both ways", () => {
  fc.assert(fc.property(point, point, (a, b) => {
    const d = haversineKm(a, b);
    assert.ok(d >= 0);
    assert.ok(haversineKm(a, a) < 1e-9);
    assert.ok(Math.abs(d - haversineKm(b, a)) < 1e-6);
  }));
});
test("property: triangle inequality (going via a third place is never shorter)", () => {
  fc.assert(fc.property(point, point, point, (a, b, c) => {
    assert.ok(haversineKm(a, c) <= haversineKm(a, b) + haversineKm(b, c) + 1e-6);
  }));
});

// ---- midpoint: the "middle" for a friends table
test("midpoint ignores missing points and returns null for none", () => {
  assert.equal(midpoint([]), null);
  assert.equal(midpoint([null, { lat: "x", lng: 1 }]), null);
  assert.deepEqual(midpoint([{ lat: 1, lng: 2 }, null, { lat: 3, lng: 4 }]), { lat: 2, lng: 3 });
});
test("property: the middle always lies inside the box around everyone's starting points", () => {
  fc.assert(fc.property(fc.array(point, { minLength: 1, maxLength: 8 }), (pts) => {
    const m = midpoint(pts);
    const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
    assert.ok(m.lat >= Math.min(...lats) - 1e-9 && m.lat <= Math.max(...lats) + 1e-9);
    assert.ok(m.lng >= Math.min(...lngs) - 1e-9 && m.lng <= Math.max(...lngs) + 1e-9);
  }));
});

// ---- taste match shown on cards
test("property: taste match is always between 60 and 98", () => {
  const slug = fc.constantFrom("chinese", "japanese", "korean", "sea", "western", "latin", "med", "other");
  fc.assert(fc.property(fc.option(slug), fc.uniqueArray(slug), (s, ranks) => {
    const m = tasteMatch(s, ranks);
    assert.ok(m >= 60 && m <= 98, `got ${m}`);
  }));
});

// ---- calendar file
test("buildICS escapes commas, semicolons and new lines (they would break the file)", () => {
  const ics = buildICS({ id: "abc", title: "Hot pot; Friday, 7pm", startsAt: "2026-12-01T23:30:00.000Z", location: "Spadina\nAve" });
  assert.match(ics, /SUMMARY:Hot pot\\; Friday\\, 7pm/);
  assert.match(ics, /LOCATION:Spadina\\nAve/);
  assert.match(ics, /DTSTART:20261201T233000Z/);
  assert.match(ics, /DTEND:20261202T010000Z/); // 90 minutes later
});
test("property: a calendar file always has exactly one event and no stray line breaks", () => {
  fc.assert(fc.property(fc.string(), fc.string(), (title, loc) => {
    const ics = buildICS({ id: "x", title, startsAt: "2026-12-01T23:30:00.000Z", location: loc });
    const lines = ics.split("\r\n");
    assert.equal(lines.filter((l) => l === "BEGIN:VEVENT").length, 1);
    assert.ok(lines.every((l) => !/[\r\n]/.test(l)));
  }));
});

test("toISO turns a local date and time into an ISO time", () => {
  const iso = toISO("2026-12-01", "18:30");
  const d = new Date(iso);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 11);
  assert.equal(d.getHours(), 18);
  assert.equal(d.getMinutes(), 30);
});
