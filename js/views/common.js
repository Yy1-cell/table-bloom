// Small helpers shared by the views.
import { esc, personName, fmtWhen, fmtMoney, tasteMatch, haversineKm, mapsUrl, googleDirectionsUrl, appleDirectionsUrl, isIOS } from "../util.js";
import { t, getLang } from "../i18n.js";
import { state, cuisineOf, areaOf } from "../state.js";
import { toast } from "../ui.js";
import { effectiveLoc, kmFrom } from "../location.js";
import { codeOf } from "../errors.js";
import { CUISINES, CUISINE_GROUPS, OCCASIONS, FORMATS, VENUE_TYPES, cuisinesOf, communityOf } from "../data.js";

// The "what is this table for" badge (date, family meal…), shown before the vibe tags.
export function communityTag(tb) {
  const c = communityOf(tb?.community);
  return c ? `<span class="tag com com-${c.slug}"><span aria-hidden="true">${c.emoji}</span> ${esc(t("com." + c.slug))}</span>` : "";
}

export function occasionTag(tb) {
  const o = OCCASIONS.find((x) => x.slug === tb?.occasion);
  return o ? `<span class="tag occ"><span aria-hidden="true">${o.emoji}</span> ${esc(t("oc." + o.slug))}</span>` : "";
}

export const nameOf = (o) => (o ? (getLang() === "zh" ? o.name_zh : o.name_en) : "");

/** Format and venue-type badges of a table (hot pot, café…), shown next to the cuisine. */
export function menuTagsHTML(tb) {
  const f = (tb?.formats || []).map((s) => FORMATS.find((x) => x.slug === s)).filter(Boolean);
  const v = VENUE_TYPES.find((x) => x.slug === tb?.venue_type);
  return [...f.map((x) => `<span class="tag fmt"><span aria-hidden="true">${x.emoji}</span> ${esc(t("fm." + x.slug))}</span>`),
    v ? `<span class="tag fmt"><span aria-hidden="true">${v.emoji}</span> ${esc(t("vt." + v.slug))}</span>` : ""].join("");
}

/** Taste match for a table. A table that only says "Chinese" counts as the best-ranked Chinese cuisine. */
export function tasteOf(tb) {
  const list = cuisinesOf(tb);
  if (!list.length) return tasteMatch(tb.cuisine, state.ranks);
  return Math.max(...list.map((slug) => {
    const c = cuisineOf(slug);
    if (c && c.slug === c.grp) {
      const sib = state.cuisines.filter((x) => x.grp === c.grp);
      if (sib.length > 1) return Math.max(...sib.map((x) => tasteMatch(x.slug, state.ranks)));
    }
    return tasteMatch(slug, state.ranks);
  }));
}

/** "🌶️ Sichuan · 🌶️ Hunan" — every cuisine of a table, or "" when it has none. */
/** "Chinese, Japanese or Korean": the cuisines of a table whose restaurant isn't chosen yet. */
export function orList(names) {
  if (names.length < 2) return names[0] || "";
  return t("cr.orJoin", { a: names.slice(0, -1).join(t("cr.listSep")), b: names[names.length - 1] });
}

export function cuisineNames(tb, { emoji = true } = {}) {
  return cuisinesOf(tb).map(cuisineOf).filter(Boolean).map((c) => (emoji ? `${c.emoji} ` : "") + nameOf(c)).join(" · ");
}

/** Cuisine chips grouped under small headings. `attr` is the data-attribute each chip carries; `isOn(slug)` says if it is selected. */
export function cuisineGroupsHTML({ attr, isOn, any = "" }) {
  const fallback = Object.fromEntries(CUISINES.map((c) => [c.slug, c.grp]));
  const groups = new Map(CUISINE_GROUPS.map((g) => [g, []]));
  for (const c of state.cuisines) {
    const g = c.grp && c.grp !== "other" ? c.grp : fallback[c.slug] || "other";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  const chip = (c) => `<button type="button" class="chip" data-${attr}="${esc(c.slug)}" aria-pressed="${isOn(c.slug)}">${esc(c.emoji)} ${esc(nameOf(c))}</button>`;
  return (any ? `<div class="chips">${any}</div>` : "") + [...groups]
    .filter(([, list]) => list.length)
    .map(([g, list]) => `<div class="cg"><div class="cg-label">${esc(t("cg." + g))}</div><div class="chips">${list.map(chip).join("")}</div></div>`)
    .join("");
}

export function go(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = hash;
}

export function showError(err) {
  const code = codeOf(err);
  console.warn("[tb]", err);
  toast(t("err." + code), { kind: "error", duration: 6000 });
}

/** Disable a button and show a spinner while an async action runs. */
export async function withBusy(btn, fn) {
  if (btn?.disabled) return;
  const html = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.innerHTML = `<span class="spin" aria-hidden="true"></span> ${esc(btn.textContent.trim())}`;
  }
  try {
    return await fn();
  } finally {
    if (btn && document.contains(btn)) {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      btn.innerHTML = html;
    }
  }
}

export function seatsHTML(taken, cap) {
  const dots = Array.from({ length: cap }, (_, i) => `<i class="${i < taken ? "on" : ""}"></i>`).join("");
  return `<span class="seats" aria-hidden="true">${dots}</span>`;
}

export function seatsText(tb) {
  const left = Math.max(0, tb.capacity - tb.seats_taken);
  return t("card.seatsLeft", { left, cap: tb.capacity });
}

export function tableTitle(tb) {
  if (tb.title) return tb.title;
  const names = cuisineNames(tb, { emoji: false });
  const c = cuisineOf(cuisinesOf(tb)[0]);
  // No title of its own: name it after its restaurant once there is one (follows the venue if it changes).
  if (tb.venue?.name) return `${c ? c.emoji + " " : ""}${tb.venue.name}`;
  // Several cuisines and no restaurant yet: it's one of them, not all of them.
  const all = cuisinesOf(tb).map(cuisineOf).filter(Boolean);
  if (all.length > 1) return `🍽️ ${orList(all.map(nameOf))}`;
  if (c) return `${c.emoji} ${names}`;
  const f = FORMATS.find((x) => x.slug === tb.formats?.[0]);
  if (f) return `${f.emoji} ${t("fm." + f.slug)}`;
  const v = VENUE_TYPES.find((x) => x.slug === tb.venue_type);
  return v ? `${v.emoji} ${t("vt." + v.slug)}` : t("card.untitled");
}

export function placeText(tb) {
  return tb.venue?.name || tb.area_label || nameOf(areaOf(tb.area_id)) || "";
}

export function statusBadge(tb) {
  if (tb.is_sample) return `<span class="badge sample">${esc(t("badge.sample"))}</span>`;
  switch (tb.my_status) {
    case "host": return `<span class="badge ok">${esc(t("badge.host"))}</span>`;
    case "joined": return `<span class="badge ok">${esc(t("badge.joined"))}</span>`;
    case "requested": return `<span class="badge warn">${esc(t("badge.requested"))}</span>`;
    case "declined": return `<span class="badge bad">${esc(t("badge.declined"))}</span>`;
    default:
  }
  if (tb.status === "cancelled") return `<span class="badge bad">${esc(t("badge.cancelled"))}</span>`;
  if (tb.status === "full") return `<span class="badge">${esc(t("badge.full"))}</span>`;
  return "";
}

export function distanceKm(tb) {
  return kmFrom(effectiveLoc(), tb);
}

// The taste match needs a cuisine ranking. New profiles no longer ask for one, so no ranking = no (meaningless) percentage.
export const hasRanks = () => (state.ranks || []).length > 0;

/** The picture for a table: how we eat (hot pot, BBQ…) says more than the cuisine. */
export function tableEmoji(tb) {
  const f = FORMATS.find((x) => x.slug === (tb.formats || [])[0]);
  return f?.emoji || cuisineOf(cuisinesOf(tb)[0])?.emoji || "🍽️";
}

const TILE = ["#ffeede", "#e7f1df", "#fdeef2", "#e3f0f6", "#fff4d6", "#f1ecfa"];
const tileFor = (id = "") => TILE[[...String(id)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % TILE.length];

export function tableCardHTML(tb, { showMatch = hasRanks(), reason = "" } = {}) {
  const match = tasteOf(tb);
  const d = distanceKm(tb);
  const emoji = tableEmoji(tb);
  const left = Math.max(0, tb.capacity - tb.seats_taken);
  const badges = [
    tb.my_status || tb.is_sample ? statusBadge(tb) : "",
    tb.is_private ? `<span class="badge">🔒 ${esc(t("badge.private"))}</span>` : "",
    tb.pending_count > 0 ? `<span class="badge warn">${esc(t("card.pending", { n: tb.pending_count }))}</span>` : "",
  ].join("");
  const extra = Math.max(0, Math.min(tb.seats_taken - 1, 3));
  const right = tb.community ? communityTag(tb) : showMatch && state.diningProfile?.n ? `<span class="tc-match" title="${esc(t("card.matchHint"))}">${match}% ${esc(t("card.match"))}</span>` : "";
  return `
  <button type="button" class="tcard tcard2" data-id="${esc(tb.id)}" aria-label="${esc(tableTitle(tb))}">
    <div class="tc-row">
      <span class="tc-emo" style="background:${tileFor(tb.id)}" aria-hidden="true">${esc(emoji)}</span>
      <span class="tc-main">
        <h3>${esc(tableTitle(tb))}</h3>
        <span class="tc-meta">${esc(fmtWhen(tb.starts_at, t))} · ${esc(placeText(tb))}${d != null ? ` · ${d < 10 ? d.toFixed(1) : Math.round(d)} km` : ""}</span>
      </span>
    </div>
    ${badges.trim() ? `<div class="tc-badges">${badges}</div>` : ""}
    <div class="tc-foot">
      <span class="tc-avs" aria-hidden="true"><span class="tc-av">${esc(tb.host?.avatar_emoji || "🍽️")}</span>${extra ? `<span class="tc-av more">+${extra}</span>` : ""}</span>
      <span class="tc-seats">${seatsHTML(tb.seats_taken, tb.capacity)}<span>${esc(left ? t("card.left", { n: left }) : t("card.fullShort"))}</span></span>
      <span class="tc-right">${right}</span>
    </div>
    ${reason ? `<div class="reason">✨ ${esc(reason)}</div>` : ""}
  </button>`;
}

export function bindCards(root) {
  root.querySelectorAll(".tcard").forEach((el) => el.addEventListener("click", () => go(`#t-${el.dataset.id}`)));
}

/** Buttons that open the phone's map app: ratings & reviews, and transit / walk / drive directions. */
export function mapActionsHTML(place, { origin, originName = "", hint = true } = {}) {
  const from = origin || (state.pos ? { lat: state.pos.lat, lng: state.pos.lng } : null);
  const a = (href, label, cls = "") => `<a class="btn sm ${cls}" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`;
  return `<div class="map-actions">
    ${a(mapsUrl(place), `⭐ ${esc(t("map.reviews"))}`)}
    ${a(googleDirectionsUrl(place, { origin: from, mode: "transit" }), `🚇 ${esc(t("map.transit"))}`)}
    ${a(googleDirectionsUrl(place, { origin: from, mode: "walking" }), `🚶 ${esc(t("map.walk"))}`)}
    ${a(googleDirectionsUrl(place, { origin: from, mode: "driving" }), `🚗 ${esc(t("map.drive"))}`)}
    ${isIOS() && place.lat != null ? a(appleDirectionsUrl(place, { origin: from }), ` ${esc(t("map.apple"))}`, "ghost") : ""}
  </div>${hint ? `<p class="hint">${esc(origin && originName ? t("map.hintFromName", { name: originName }) : from ? t("map.hintFrom") : t("map.hintNow"))}</p>` : ""}`;
}
