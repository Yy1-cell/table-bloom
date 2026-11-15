// Discover: browse open tables, filter, sort by taste match / budget / distance.
import { esc, isToday, qs, qsa } from "../util.js";
import { t } from "../i18n.js";
import { state, areaOf, cuisineOf } from "../state.js";
import { api } from "../api.js";
import { currentPosition } from "../geo.js";
import { toast, announce } from "../ui.js";
import { tableCardHTML, bindCards, nameOf, showError, go, distanceKm, tasteOf } from "./common.js";
import { OCCASIONS, FORMATS, VENUE_TYPES } from "../data.js";
import { buildProfile, scoreTable } from "../dining-profile.js";
import { groupOfSlug } from "./menu-picker.js";

const CHIPS = ["all", "today", "new", "friend"];

function visible(list) {
  const { chip, sort, occasion, fmt, vtype } = state.filters;
  let out = list.filter((x) => x.my_status !== "declined");
  if (chip === "today") out = out.filter((x) => isToday(x.starts_at));
  if (chip === "new") out = out.filter((x) => x.audience !== "friends");
  if (chip === "friend") out = out.filter((x) => x.audience !== "new_people");
  if (occasion) out = out.filter((x) => x.occasion === occasion);
  if (fmt) out = out.filter((x) => (x.formats || []).includes(fmt));
  if (vtype) out = out.filter((x) => x.venue_type === vtype);
  const byTime = (a, b) => new Date(a.starts_at) - new Date(b.starts_at);
  if (sort === "budget") out.sort((a, b) => (a.budget_cents ?? 1e9) - (b.budget_cents ?? 1e9) || byTime(a, b));
  else if (sort === "closest") out.sort((a, b) => (distanceKm(a) ?? 1e9) - (distanceKm(b) ?? 1e9) || byTime(a, b));
  else if (sort === "foryou" && state.diningProfile?.n) {
    const fit = (x) => scoreTable(x, state.diningProfile).score * 20 + tasteOf(x) * 0.5;
    out.sort((a, b) => fit(b) - fit(a) || byTime(a, b));
  } else out.sort((a, b) => tasteOf(b) - tasteOf(a) || byTime(a, b));
  return out;
}

/** One short line saying why a table suits me (only with "For you" and enough check-ins). */
function reasonFor(tb) {
  if (state.filters.sort !== "foryou" || !state.diningProfile?.n) return "";
  const { why } = scoreTable(tb, state.diningProfile);
  const c = cuisineOf(tb.cuisine);
  const text = {
    cuisine: () => t("rec.cuisine", { name: c ? nameOf(c) : "" }),
    occasion: () => t("rec.occasion", { name: tb.occasion ? t("oc." + tb.occasion) : "" }),
    format: () => t("rec.format", { name: (tb.formats || []).map((k) => t("fm." + k)).join("·") }),
    type: () => t("rec.type", { name: tb.venue_type ? t("vt." + tb.venue_type) : "" }),
    size: () => t("rec.size"),
    time: () => t("rec.time"),
  };
  return why.map((k) => text[k]()).join(" · ");
}

export async function render(root) {
  let alive = true;
  const f = state.filters;
  // "For you" is offered once there are check-ins to learn from
  const sortOptions = () => (state.diningProfile?.n ? ["foryou", "match", "budget", "closest"] : ["match", "budget", "closest"]).map((s) => `<option value="${s}" ${f.sort === s ? "selected" : ""}>${esc(t("sort." + s))}</option>`).join("");

  root.innerHTML = `
    <section class="hero">
      <h1>${esc(t("disc.title"))}</h1>
      <p>${esc(t("disc.sub"))}</p>
      <a class="btn" href="#new">＋ ${esc(t("disc.host"))}</a>
    </section>
    <div class="toolbar" role="group" aria-label="${esc(t("disc.filters"))}">
      <div class="chips" id="chips">${CHIPS.map((c) => `<button type="button" class="chip" data-chip="${c}" aria-pressed="${f.chip === c}">${esc(t("chip." + c))}</button>`).join("")}</div>
      <span class="spacer"></span>
      <label class="sr-only" for="area-sel">${esc(t("disc.area"))}</label>
      <select id="area-sel"><option value="">${esc(t("disc.allAreas"))}</option>${state.areas.map((a) => `<option value="${a.id}" ${f.areaId === a.id ? "selected" : ""}>${esc(nameOf(a))}</option>`).join("")}</select>
      <label class="sr-only" for="sort-sel">${esc(t("disc.sort"))}</label>
      <select id="sort-sel">${sortOptions()}</select>
    </div>
    <div class="toolbar" role="group" aria-label="${esc(t("disc.occasion"))}">
      <div class="chips" id="occ-chips">${[{ slug: "", emoji: "" }, ...OCCASIONS].map((o) => `<button type="button" class="chip" data-occ="${o.slug}" aria-pressed="${(f.occasion || "") === o.slug}">${o.slug ? `<span aria-hidden="true">${o.emoji}</span> ${esc(t("oc." + o.slug))}` : esc(t("disc.anyOccasion"))}</button>`).join("")}</div>
    </div>
    <details class="more-filters" id="more-filters" ${f.fmt || f.vtype ? "open" : ""}>
      <summary>🍽️ ${esc(t("disc.moreFilters"))}<span class="mf-on" id="mf-on"></span></summary>
      <div class="mf-row"><span class="mf-label">${esc(t("disc.vtype"))}</span><div class="chips" id="vt-chips">${[{ slug: "", emoji: "" }, ...VENUE_TYPES].map((o) => `<button type="button" class="chip" data-vt="${o.slug}" aria-pressed="${(f.vtype || "") === o.slug}">${o.slug ? `<span aria-hidden="true">${o.emoji}</span> ${esc(t("vt." + o.slug))}` : esc(t("chip.all"))}</button>`).join("")}</div></div>
      <div class="mf-row"><span class="mf-label">${esc(t("disc.fmt"))}</span><div class="chips" id="fm-chips">${[{ slug: "", emoji: "" }, ...FORMATS].map((o) => `<button type="button" class="chip" data-fm="${o.slug}" aria-pressed="${(f.fmt || "") === o.slug}">${o.slug ? `<span aria-hidden="true">${o.emoji}</span> ${esc(t("fm." + o.slug))}` : esc(t("chip.all"))}</button>`).join("")}</div></div>
    </details>
    <div class="grid" id="list" aria-live="polite"><div class="skeleton"></div><div class="skeleton"></div></div>`;

  const list = qs("#list", root);

  function paint() {
    if (!alive) return;
    const items = visible(state.tables);
    if (!items.length) {
      list.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big" aria-hidden="true">🍽️</div><h2>${esc(t("disc.emptyTitle"))}</h2><p>${esc(t("disc.emptyBody"))}</p><a class="btn primary" href="#new">${esc(t("disc.host"))}</a></div>`;
      return;
    }
    list.innerHTML = items.map((x) => tableCardHTML(x, { reason: reasonFor(x) })).join("");
    bindCards(list);
  }

  async function load() {
    try {
      const [tables, rows] = await Promise.all([api.listTables({ areaId: f.areaId }), state.diningProfile === undefined ? api.listMyFeelings().catch(() => []) : null]);
      state.tables = tables;
      if (rows) state.diningProfile = buildProfile(rows, groupOfSlug);
      // with some check-ins on record, "For you" becomes the default order (until the person picks another)
      if (!f.sortSet && state.diningProfile?.n && f.sort === "match") f.sort = "foryou";
      const sel = qs("#sort-sel", root);
      if (sel) {
        sel.innerHTML = sortOptions();
        sel.value = f.sort;
      }
      paint();
      announce(t("disc.count", { n: visible(state.tables).length }));
    } catch (e) {
      list.innerHTML = `<div class="empty" style="grid-column:1/-1"><p>${esc(t("err.load"))}</p><button class="btn" id="retry">${esc(t("common.retry"))}</button></div>`;
      qs("#retry", list)?.addEventListener("click", load);
      showError(e);
    }
  }

  qs("#chips", root).addEventListener("click", (e) => {
    const b = e.target.closest("[data-chip]");
    if (!b) return;
    f.chip = b.dataset.chip;
    qsa("[data-chip]", root).forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.chip === f.chip)));
    paint();
  });
  qs("#occ-chips", root).addEventListener("click", (e) => {
    const b = e.target.closest("[data-occ]");
    if (!b) return;
    f.occasion = b.dataset.occ;
    qsa("[data-occ]", root).forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.occ === f.occasion)));
    paint();
    announce(t("disc.count", { n: visible(state.tables).length }));
  });
  const paintMf = () => {
    const n = (f.fmt ? 1 : 0) + (f.vtype ? 1 : 0);
    qs("#mf-on", root).textContent = n ? ` · ${n}` : "";
  };
  paintMf();
  qs("#vt-chips", root).addEventListener("click", (e) => {
    const b = e.target.closest("[data-vt]");
    if (!b) return;
    f.vtype = b.dataset.vt;
    qsa("[data-vt]", root).forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.vt === f.vtype)));
    paintMf();
    paint();
    announce(t("disc.count", { n: visible(state.tables).length }));
  });
  qs("#fm-chips", root).addEventListener("click", (e) => {
    const b = e.target.closest("[data-fm]");
    if (!b) return;
    f.fmt = b.dataset.fm;
    qsa("[data-fm]", root).forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.fm === f.fmt)));
    paintMf();
    paint();
    announce(t("disc.count", { n: visible(state.tables).length }));
  });
  qs("#area-sel", root).addEventListener("change", (e) => {
    f.areaId = e.target.value || null;
    load();
  });
  qs("#sort-sel", root).addEventListener("change", async (e) => {
    const v = e.target.value;
    if (v === "closest" && !state.pos) {
      try {
        state.pos = await currentPosition();
      } catch {
        toast(t("disc.noLocation"), { kind: "error" });
        e.target.value = f.sort;
        return;
      }
    }
    f.sort = v;
    f.sortSet = true;
    paint();
  });

  await load();
  const timer = setInterval(() => {
    if (document.visibilityState === "visible" && !document.querySelector(".sheet-backdrop")) load();
  }, 30000);
  return () => {
    alive = false;
    clearInterval(timer);
  };
}
