// Discover: browse open tables. Filters stay coarse on purpose (few tables early on: fine filters only empty the page):
// when (today / this weekend), cuisine family (Chinese, Japanese, …; a Sichuan table counts as Chinese), kind of place.
// With fewer than FEW tables nearby the filters are hidden altogether.
import { esc, isToday, qs, qsa } from "../util.js";
import { t } from "../i18n.js";
import { state, cuisineOf } from "../state.js";
import { api } from "../api.js";
import { effectiveLoc, locateMe, kmFrom } from "../location.js";
import { locationPermission } from "../geo.js";
import { mountLocPicker } from "./loc-picker.js";
import { toast, announce, tipHTML } from "../ui.js";
import { hasRanks, tableCardHTML, bindCards, nameOf, showError, go, distanceKm, tasteOf, cuisineNames } from "./common.js";
import { VENUE_TYPES, CUISINE_GROUPS, COMMUNITIES, cuisinesOf } from "../data.js";
import { buildProfile, scoreTable } from "../dining-profile.js";
import { groupOfSlug, menuGroups } from "./menu-picker.js";

const CHIPS = ["all", "today", "weekend"];
const FEW = 5;

// This coming Saturday/Sunday (today too, if it is one), in local time.
function isThisWeekend(iso) {
  const d = new Date(iso);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = start.getDay();
  const sat = new Date(start);
  sat.setDate(start.getDate() + (day === 0 ? -1 : 6 - day));
  const end = new Date(sat);
  end.setDate(sat.getDate() + 2);
  return d >= (day === 0 || day === 6 ? start : sat) && d < end;
}
// "sichuan" -> "chinese"; a family slug is its own family.
const familyOf = (slug) => (CUISINE_GROUPS.includes(slug) ? slug : groupOfSlug(slug));

// Tables within the chosen distance of the place I'm looking at (tables with no known point are kept).
function nearby(list) {
  const loc = effectiveLoc();
  let out = list.filter((x) => x.my_status !== "declined");
  if (loc && state.filters.radius) out = out.filter((x) => { const d = kmFrom(loc, x); return d == null || d <= state.filters.radius; });
  return out;
}

function visible(list) {
  const { chip, sort, cg, vtype, com } = state.filters;
  let out = nearby(list);
  if (chip === "today") out = out.filter((x) => isToday(x.starts_at));
  if (chip === "weekend") out = out.filter((x) => isThisWeekend(x.starts_at));
  if (cg) out = out.filter((x) => cuisinesOf(x).some((k) => familyOf(k) === cg));
  if (vtype) out = out.filter((x) => x.venue_type === vtype);
  if (com) out = out.filter((x) => x.community === com);
  const byTime = (a, b) => new Date(a.starts_at) - new Date(b.starts_at);
  if (sort === "soon") out.sort(byTime);
  else if (sort === "budget") out.sort((a, b) => (a.budget_cents ?? 1e9) - (b.budget_cents ?? 1e9) || byTime(a, b));
  else if (sort === "closest") out.sort((a, b) => (distanceKm(a) ?? 1e9) - (distanceKm(b) ?? 1e9) || byTime(a, b));
  else if (sort === "foryou" && state.diningProfile?.n) {
    const fit = (x) => scoreTable(x, state.diningProfile).score * 20 + tasteOf(x) * 0.5;
    out.sort((a, b) => fit(b) - fit(a) || byTime(a, b));
  } else if (!hasRanks()) out.sort(byTime);
  else out.sort((a, b) => tasteOf(b) - tasteOf(a) || byTime(a, b));
  return out;
}

/** One short line saying why a table suits me (only with "For you" and enough check-ins). */
function reasonFor(tb) {
  if (state.filters.sort !== "foryou" || !state.diningProfile?.n) return "";
  const { why } = scoreTable(tb, state.diningProfile);
  const text = {
    cuisine: () => t("rec.cuisine", { name: cuisineNames(tb, { emoji: false }) }),
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
  f.fmt = ""; // "how we eat" is no longer a Discover filter
  const sortOptions = () => ([...(state.diningProfile?.n ? ["foryou"] : []), ...(hasRanks() ? ["match"] : []), "soon", "closest", "budget"]).map((s) => `<option value="${s}" ${f.sort === s ? "selected" : ""}>${esc(t("sort." + s))}</option>`).join("");
  const families = menuGroups().map((x) => ({ g: x.g, emoji: x.generic.emoji }));

  root.innerHTML = `
    <header class="disc-head">
      <div class="disc-head-l">
        <h1>${esc(t("disc2.title"))}</h1>
        <div class="loc-bar disc-loc" role="group" aria-label="${esc(t("disc.area"))}" id="loc-bar">
          <button type="button" class="loc-link" id="loc-btn" aria-expanded="false" aria-controls="loc-panel"></button>
          <label class="sr-only" for="radius-sel">${esc(t("loc.radius"))}</label>
          <select id="radius-sel" class="loc-radius">${[10, 25, 50, 200, 0].map((r) => `<option value="${r}" ${Number(f.radius) === r ? "selected" : ""}>${esc(r ? t("loc.within", { km: r }) : t("loc.anywhere"))}</option>`).join("")}</select>
        </div>
      </div>
      <a class="btn primary disc-host" href="#new">＋ ${esc(t("disc2.host"))}</a>
    </header>
    ${tipHTML("discover", `👋 ${esc(t("tip.discover"))}`)}
    <div class="card loc-panel" id="loc-panel" hidden></div>
    <div class="toolbar disc-filters" role="group" aria-label="${esc(t("disc.filters"))}" id="disc-filters" hidden>
      <div class="chips disc-chips" id="chips">${CHIPS.map((c) => `<button type="button" class="chip" data-chip="${c}" aria-pressed="${f.chip === c}">${esc(t("chip." + c))}</button>`).join("")}<button type="button" class="chip" id="more-f" aria-expanded="${!!(f.cg || f.com || f.vtype)}" aria-controls="more-filters">⚙︎ ${esc(t("disc2.filter"))}${f.cg || f.com || f.vtype ? " •" : ""}</button></div>
      <div class="more-filters" id="more-filters" ${f.cg || f.com || f.vtype ? "" : "hidden"}>
      <label class="sr-only" for="cg-sel">${esc(t("disc.cuisine"))}</label>
      <select id="cg-sel"><option value="">🍽️ ${esc(t("disc.anyCuisine"))}</option>${families.map((x) => `<option value="${x.g}" ${f.cg === x.g ? "selected" : ""}>${x.emoji} ${esc(t("cg." + x.g))}</option>`).join("")}</select>
      <label class="sr-only" for="vt-sel">${esc(t("disc.vtype"))}</label>
      <label class="sr-only" for="com-sel">${esc(t("com.title"))}</label>
      <select id="com-sel"><option value="">🤝 ${esc(t("com.filterAll"))}</option>${COMMUNITIES.map((c) => `<option value="${c.slug}" ${f.com === c.slug ? "selected" : ""}>${c.emoji} ${esc(t("com." + c.slug))}</option>`).join("")}</select>
      <select id="vt-sel"><option value="">☕ ${esc(t("disc.anyType"))}</option>${VENUE_TYPES.map((v) => `<option value="${v.slug}" ${f.vtype === v.slug ? "selected" : ""}>${v.emoji} ${esc(t("vt." + v.slug))}</option>`).join("")}</select>
      <span class="spacer"></span>
      <label class="sort-wrap"><span class="muted">${esc(t("disc.sort"))}</span> <select id="sort-sel">${sortOptions()}</select></label>
      </div>
    </div>
    <div class="grid" id="list" aria-live="polite"><div class="skeleton"></div><div class="skeleton"></div></div>`;

  const list = qs("#list", root);
  qs("#more-f", root)?.addEventListener("click", (e) => {
    const box = qs("#more-filters", root);
    box.hidden = !box.hidden;
    e.currentTarget.setAttribute("aria-expanded", String(!box.hidden));
  });

  function paint() {
    if (!alive) return;
    // Everyone sees their own city first: until a place is set, no other city's tables are shown.
    const hasLoc = !!effectiveLoc();
    qs("#loc-bar", root).hidden = !hasLoc;
    if (!hasLoc) {
      qs("#disc-filters", root).hidden = true;
      list.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big" aria-hidden="true">📍</div><h2>${esc(t("loc.needTitle"))}</h2><p>${esc(t("loc.needBody"))}</p><button type="button" class="btn primary" id="need-loc">📍 ${esc(t("map.useMe"))}</button>
        <p style="margin-top:10px"><button type="button" class="btn ghost sm" id="need-search">🔎 ${esc(t("loc.search"))}</button></p></div>`;
      qs("#need-search", list)?.addEventListener("click", () => {
        qs("#loc-bar", root).hidden = false;
        togglePanel(true);
        panel.querySelector("input")?.focus();
      });
      qs("#need-loc", list)?.addEventListener("click", async (e) => {
        e.currentTarget.disabled = true;
        try {
          await locateMe();
          paintLoc();
          togglePanel(false);
          paint();
        } catch (err) {
          e.currentTarget.disabled = false;
          toast(err?.reason === "denied" ? t("loc.denied") : t("disc.noLocation"), { kind: "error" });
        }
      });
      return;
    }
    // Only a few tables around: show them all, no filters (they would only empty the page).
    const few = nearby(state.tables).length < FEW;
    qs("#disc-filters", root).hidden = few;
    if (few && (f.chip !== "all" || f.cg || f.vtype || f.com)) {
      f.chip = "all"; f.cg = ""; f.vtype = ""; f.com = "";
      qsa("[data-chip]", root).forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.chip === "all")));
      qs("#cg-sel", root).value = ""; qs("#vt-sel", root).value = ""; qs("#com-sel", root).value = "";
    }
    const items = visible(state.tables);
    if (!items.length) {
      // Nothing close by: say so in a friendly way and offer to look further out.
      const far = f.radius && effectiveLoc() && state.tables.length;
      list.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big" aria-hidden="true">🍽️</div><h2>${esc(effectiveLoc() && f.radius ? t("disc.emptyNear") : t("disc.emptyTitle"))}</h2><p>${esc(effectiveLoc() && f.radius ? t("disc.emptyNearBody") : t("disc.emptyBody"))}</p>
        ${far ? `<button type="button" class="btn" id="widen">${esc(t("loc.widen"))}</button> ` : ""}<a class="btn primary" href="#new">${esc(t("disc.host"))}</a></div>`;
      qs("#widen", list)?.addEventListener("click", () => setRadius(0));
      return;
    }
    list.innerHTML = items.map((x) => tableCardHTML(x, { reason: reasonFor(x) })).join("");
    bindCards(list);
  }

  async function load() {
    try {
      const [tables, rows] = await Promise.all([api.listTables(), state.diningProfile === undefined ? api.listMyFeelings().catch(() => []) : null]);
      state.tables = tables;
      if (rows) state.diningProfile = buildProfile(rows, groupOfSlug);
      // with some check-ins on record, "For you" becomes the default order (until the person picks another)
      // No taste data: soonest first (when it is, is what decides going or not).
      if (!f.sortSet && ["match", "closest"].includes(f.sort)) f.sort = state.diningProfile?.n ? "foryou" : hasRanks() ? "match" : "soon";
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
  const onFilter = () => {
    paint();
    announce(t("disc.count", { n: visible(state.tables).length }));
  };
  qs("#cg-sel", root).addEventListener("change", (e) => { f.cg = e.target.value; onFilter(); });
  qs("#vt-sel", root).addEventListener("change", (e) => { f.vtype = e.target.value; onFilter(); });
  qs("#com-sel", root).addEventListener("change", (e) => { f.com = e.target.value; onFilter(); });
  const paintLoc = () => {
    const cur = effectiveLoc();
    qs("#loc-btn", root).innerHTML = `📍 ${esc(cur ? cur.label || t("map.here") : t("loc.set"))} <span aria-hidden="true">▾</span>`;
  };
  paintLoc();
  const setRadius = (r) => {
    f.radius = r;
    qs("#radius-sel", root).value = String(r);
    paint();
    announce(t("disc.count", { n: visible(state.tables).length }));
  };
  qs("#radius-sel", root).addEventListener("change", (e) => setRadius(Number(e.target.value)));
  const panel = qs("#loc-panel", root);
  const togglePanel = (open) => {
    panel.hidden = !open;
    qs("#loc-btn", root).setAttribute("aria-expanded", String(open));
    if (open && !panel.firstChild) {
      mountLocPicker(panel, {
        onChange: () => {
          paintLoc();
          togglePanel(false);
          paint();
          announce(t("disc.count", { n: visible(state.tables).length }));
        },
      });
    }
  };
  qs("#loc-btn", root).addEventListener("click", () => togglePanel(panel.hidden));
  if (!effectiveLoc()) {
    // If the browser already allows location, just use it (no prompt is shown in that case).
    locationPermission().then(async (perm) => {
      if (perm !== "granted" || !alive || effectiveLoc()) return;
      try {
        await locateMe();
        if (!alive) return;
        paintLoc();
        togglePanel(false);
        paint();
      } catch {}
    });
  }
  qs("#sort-sel", root).addEventListener("change", async (e) => {
    const v = e.target.value;
    if (v === "closest" && !effectiveLoc()) {
      try {
        await locateMe();
        paintLoc();
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
