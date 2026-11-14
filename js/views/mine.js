// My tables: upcoming (hosting/joined), pending requests, past.
import { esc, qs, qsa, isPast } from "../util.js";
import { t } from "../i18n.js";
import { state } from "../state.js";
import { api } from "../api.js";
import { tableCardHTML, bindCards, showError, tableTitle } from "./common.js";

let tab = "upcoming";

export function bucket(tb) {
  const live = ["open", "full"].includes(tb.status);
  const over = isPast(tb.starts_at, 120);
  if (tb.my_status === "requested" && live && !over) return "pending";
  if (["host", "joined"].includes(tb.my_status) && live && !over) return "upcoming";
  return "past";
}

export async function render(root) {
  let alive = true;
  root.innerHTML = `<h1>${esc(t("mine.title"))}</h1><div class="grid"><div class="skeleton"></div></div>`;
  try {
    state.myTables = await api.listMyTables();
  } catch (e) {
    root.innerHTML = `<h1>${esc(t("mine.title"))}</h1><div class="empty"><p>${esc(t("err.load"))}</p></div>`;
    showError(e);
    return;
  }
  if (!alive) return;

  const groups = { upcoming: [], pending: [], past: [] };
  for (const tb of state.myTables) groups[bucket(tb)].push(tb);
  groups.upcoming.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  groups.pending.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  groups.past.sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));
  const hostWaiting = groups.upcoming.reduce((n, x) => n + (x.pending_count || 0), 0);

  function paint() {
    const list = groups[tab];
    qsa("[role=tab]", root).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    const panel = qs("#panel", root);
    if (!list.length) {
      panel.innerHTML = `<div class="empty"><div class="big" aria-hidden="true">${tab === "past" ? "📖" : "🍃"}</div><p>${esc(t("mine.empty." + tab))}</p>${tab !== "past" ? `<a class="btn primary" href="#discover">${esc(t("mine.browse"))}</a>` : ""}</div>`;
      return;
    }
    panel.innerHTML = `<div class="grid">${list
      .map((tb) => {
        const canReflect = tab === "past" && ["host", "joined"].includes(tb.my_status) && tb.status !== "cancelled";
        return `<div>${tableCardHTML(tb, { showMatch: false })}${canReflect ? `<div class="row wrap-row" style="margin-top:8px">${tb.is_sample ? "" : `<button type="button" class="btn sm primary" data-feel="${esc(tb.id)}">⏱ ${esc(t("fb.quick"))}</button>`}<button type="button" class="btn sm" data-reflect="${esc(tb.id)}">✍️ ${esc(t("td.reflect"))}</button></div>` : ""}</div>`;
      })
      .join("")}</div>`;
    bindCards(panel);
    qsa("[data-feel]", panel).forEach((b) =>
      b.addEventListener("click", async () => {
        const tb = state.myTables.find((x) => x.id === b.dataset.feel);
        const { openFeelingForm } = await import("./feeling.js");
        openFeelingForm({ table_id: tb.id, title: tableTitle(tb), onSaved: () => {} });
      })
    );
    qsa("[data-reflect]", panel).forEach((b) =>
      b.addEventListener("click", async () => {
        const tb = state.myTables.find((x) => x.id === b.dataset.reflect);
        const { openReflectForm } = await import("./reflect.js");
        openReflectForm({ table_id: tb.id, table_title: tableTitle(tb), onSaved: () => (location.hash = "#journal") });
      })
    );
  }

  root.innerHTML = `
    <h1>${esc(t("mine.title"))}</h1>
    ${hostWaiting ? `<div class="notice warn">${esc(t("mine.waiting", { n: hostWaiting }))}</div>` : ""}
    <div class="tabs" role="tablist" aria-label="${esc(t("mine.title"))}">
      ${["upcoming", "pending", "past"].map((k) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${esc(t("mine.tab." + k))}<span class="count">${groups[k].length}</span></button>`).join("")}
    </div>
    <div id="panel" role="tabpanel"></div>`;
  qsa("[role=tab]", root).forEach((b) =>
    b.addEventListener("click", () => {
      tab = b.dataset.tab;
      paint();
    })
  );
  paint();
  return () => (alive = false);
}
