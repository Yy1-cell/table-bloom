// Small helpers shared by the views.
import { esc, personName, fmtWhen, fmtMoney, tasteMatch, haversineKm, mapsUrl, googleDirectionsUrl, appleDirectionsUrl, isIOS } from "../util.js";
import { t, getLang } from "../i18n.js";
import { state, cuisineOf, areaOf } from "../state.js";
import { toast } from "../ui.js";
import { codeOf } from "../errors.js";
import { CUISINES, CUISINE_GROUPS, OCCASIONS } from "../data.js";

// The "what is this table for" badge (date, family meal…), shown before the vibe tags.
export function occasionTag(tb) {
  const o = OCCASIONS.find((x) => x.slug === tb?.occasion);
  return o ? `<span class="tag occ"><span aria-hidden="true">${o.emoji}</span> ${esc(t("oc." + o.slug))}</span>` : "";
}

export const nameOf = (o) => (o ? (getLang() === "zh" ? o.name_zh : o.name_en) : "");

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
  const c = cuisineOf(tb.cuisine);
  return c ? `${c.emoji} ${nameOf(c)}` : t("card.untitled");
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
  if (!state.pos || tb.meet_lat == null) return null;
  return haversineKm(state.pos, { lat: tb.meet_lat, lng: tb.meet_lng });
}

export function tableCardHTML(tb, { showMatch = true } = {}) {
  const c = cuisineOf(tb.cuisine);
  const match = tasteMatch(tb.cuisine, state.ranks);
  const d = distanceKm(tb);
  const pending = tb.pending_count > 0 ? `<span class="badge warn">${esc(t("card.pending", { n: tb.pending_count }))}</span>` : "";
  return `
  <button type="button" class="tcard" data-id="${esc(tb.id)}" aria-label="${esc(tableTitle(tb))}">
    <div class="tcard-top">
      <div style="min-width:0">
        <h3>${esc(tableTitle(tb))}</h3>
        <div class="row wrap-row">${statusBadge(tb)} ${tb.is_private ? `<span class="badge">🔒 ${esc(t("badge.private"))}</span>` : ""} ${pending}</div>
      </div>
      ${showMatch ? `<span class="match" title="${esc(t("card.matchHint"))}"><span>${match}%</span><small>${esc(t("card.match"))}</small></span>` : ""}
    </div>
    <div class="host"><span class="av" aria-hidden="true">${esc(tb.host?.avatar_emoji || "🍽️")}</span><span>${esc(t("card.hostedBy", { name: personName(tb.host?.display_name) }))}</span></div>
    <ul class="meta">
      <li><span aria-hidden="true">🕖</span>${esc(fmtWhen(tb.starts_at, t))}</li>
      <li><span aria-hidden="true">📍</span>${esc(placeText(tb))}${d != null ? ` · ${d < 10 ? d.toFixed(1) : Math.round(d)} km` : ""}</li>
      ${c ? `<li><span aria-hidden="true">${esc(c.emoji)}</span>${esc(nameOf(c))}</li>` : ""}
      ${tb.budget_cents != null ? `<li><span aria-hidden="true">💵</span>${esc(t("card.perPerson", { price: fmtMoney(tb.budget_cents) }))}</li>` : ""}
    </ul>
    ${tb.tags?.length || tb.occasion ? `<div class="tags">${occasionTag(tb)}${(tb.tags || []).map((g) => `<span class="tag">${esc(t("tag." + g))}</span>`).join("")}</div>` : ""}
    <div class="foot"><span>${seatsHTML(tb.seats_taken, tb.capacity)}${esc(seatsText(tb))}</span><span class="muted">${esc(t("aud." + tb.audience))}</span></div>
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
