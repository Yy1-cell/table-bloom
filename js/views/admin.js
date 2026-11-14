// Operator console: accounts, tables, reports. Only reachable for admin accounts (the server enforces it).
// It never shows anyone's journal, post-meal check-ins or "eat again" lists: those functions do not exist.
import { esc, qs, qsa, fmtWhen, personName } from "../util.js";
import { t } from "../i18n.js";
import { api } from "../api.js";
import { state, cuisineOf } from "../state.js";
import { toast, confirmDialog } from "../ui.js";
import { showError, nameOf } from "./common.js";

const DAY = 864e5;
const ago = (iso) => {
  if (!iso) return "–";
  const d = Math.max(0, Math.floor((Date.now() - new Date(iso)) / DAY));
  return d === 0 ? t("ad.today") : t("ad.daysAgo", { n: d });
};

export async function render(root) {
  let alive = true;
  let tab = state.adminTab || "overview";
  let data = { overview: null, users: [], tables: [], reports: [] };
  const sel = { users: new Set(), tables: new Set() };
  const filt = { users: "all", tables: "live" };

  async function load() {
    try {
      const [overview, users, tables, reports] = await Promise.all([api.adminOverview(), api.adminListUsers(), api.adminListTables(), api.adminListReports()]);
      data = { overview, users, tables, reports };
    } catch (e) {
      showError(e);
    }
    if (alive) paint();
  }

  // ---- helpers over the loaded data
  const idle = (u) => !u.hosted && !u.joined;
  const isLive = (x) => ["open", "full"].includes(x.status) && new Date(x.starts_at) >= Date.now() - 2 * 3600e3;
  const userRows = () =>
    data.users.filter((u) => {
      if (filt.users === "guest") return u.is_anonymous;
      if (filt.users === "idle") return idle(u);
      if (filt.users === "stale") return Date.now() - new Date(u.last_sign_in_at || u.created_at) > DAY;
      if (filt.users === "suspended") return u.status === "suspended";
      return true;
    });
  const tableRows = () =>
    data.tables.filter((x) => {
      if (filt.tables === "live") return !x.is_sample && isLive(x);
      if (filt.tables === "past") return !x.is_sample && !isLive(x) && x.status !== "cancelled";
      if (filt.tables === "cancelled") return x.status === "cancelled";
      if (filt.tables === "sample") return x.is_sample;
      return true;
    });

  const chips = (name, opts) =>
    `<div class="chips" role="group">${opts.map(([v, label]) => `<button type="button" class="chip" data-f="${name}:${v}" aria-pressed="${filt[name] === v}">${esc(label)}</button>`).join("")}</div>`;

  function overviewHTML() {
    const o = data.overview;
    if (!o) return `<div class="skeleton" style="height:120px"></div>`;
    const cell = (n, label) => `<div class="stat"><b>${n}</b><span>${esc(label)}</span></div>`;
    return `<div class="stats">${cell(o.users, t("ad.users"))}${cell(o.guests, t("ad.guests"))}${cell(o.suspended, t("ad.suspended"))}</div>
      <div class="stats">${cell(o.tables_open, t("ad.tOpen"))}${cell(o.tables_past, t("ad.tPast"))}${cell(o.tables_cancelled, t("ad.tCancelled"))}</div>
      <div class="stats">${cell(o.reports_new, t("ad.reportsNew"))}</div>
      <p class="hint">🔒 ${esc(t("ad.privacy"))}</p>`;
  }

  function usersHTML() {
    const rows = userRows();
    const picked = rows.filter((u) => sel.users.has(u.id)).length;
    return `${chips("users", [["all", t("ad.fAll")], ["guest", t("ad.fGuest")], ["idle", t("ad.fIdle")], ["stale", t("ad.fStale")], ["suspended", t("ad.suspended")]])}
      <div class="row wrap-row" style="margin:10px 0">
        <button type="button" class="btn sm" data-act="pick-idle">${esc(t("ad.pickIdle"))}</button>
        <button type="button" class="btn sm" data-act="pick-none">${esc(t("ad.pickNone"))}</button>
        <button type="button" class="btn sm danger" data-act="purge" ${picked ? "" : "disabled"}>🗑 ${esc(t("ad.purge", { n: picked }))}</button>
      </div>
      <ul class="list-plain ad-list">${rows
        .map((u) => {
          const locked = u.is_admin || u.id === state.me?.id;
          return `<li>
            <input type="checkbox" data-pick-user="${esc(u.id)}" ${sel.users.has(u.id) ? "checked" : ""} ${locked ? "disabled" : ""} aria-label="${esc(u.display_name || "")}">
            <span class="av" aria-hidden="true">${esc(u.avatar_emoji || "🍽️")}</span>
            <span class="who"><strong>${esc(personName(u.display_name || ""))}</strong>
              <small class="muted">${u.is_anonymous ? esc(t("ad.guest")) : esc(u.email || t("ad.email"))}${u.is_admin ? " · 🛠" : ""}${u.id === state.me?.id ? " · " + esc(t("ad.you")) : ""}${u.status === "suspended" ? " · ⛔ " + esc(t("ad.suspended")) : ""}</small>
              <small class="muted">${esc(t("ad.activity", { h: u.hosted, j: u.joined }))} · ${esc(t("ad.created"))} ${esc(ago(u.created_at))} · ${esc(t("ad.seen"))} ${esc(ago(u.last_sign_in_at))}</small></span>
            ${locked ? "" : `<button type="button" class="btn sm ghost" data-act="${u.status === "suspended" ? "unsuspend" : "suspend"}" data-id="${esc(u.id)}">${esc(u.status === "suspended" ? t("ad.unsuspend") : t("ad.suspend"))}</button>`}
          </li>`;
        })
        .join("") || `<li class="muted">${esc(t("ad.none"))}</li>`}</ul>`;
  }

  function tablesHTML() {
    const rows = tableRows();
    const cancellable = rows.filter((x) => sel.tables.has(x.id) && ["open", "full"].includes(x.status) && !x.is_sample).length;
    return `${chips("tables", [["live", t("ad.tOpen")], ["past", t("ad.tPast")], ["cancelled", t("ad.tCancelled")], ["sample", t("ad.fSample")], ["all", t("ad.fAll")]])}
      <div class="row wrap-row" style="margin:10px 0">
        <button type="button" class="btn sm" data-act="pick-tables">${esc(t("ad.pickAll"))}</button>
        <button type="button" class="btn sm danger" data-act="cancel-tables" ${cancellable ? "" : "disabled"}>${esc(t("ad.cancelSel", { n: cancellable }))}</button>
      </div>
      <ul class="list-plain ad-list">${rows
        .map((x) => {
          const c = cuisineOf(x.cuisine);
          return `<li>
            <input type="checkbox" data-pick-table="${esc(x.id)}" ${sel.tables.has(x.id) ? "checked" : ""} ${x.is_sample || !["open", "full"].includes(x.status) ? "disabled" : ""}>
            <span class="av" aria-hidden="true">${esc(c?.emoji || "🍽️")}</span>
            <span class="who"><strong>${esc(x.title || (c ? nameOf(c) : "–"))}</strong>
              <small class="muted">${esc(fmtWhen(x.starts_at, t))} · ${esc(x.status)}${x.is_private ? " · 🔒" : ""}${x.is_sample ? " · " + esc(t("ad.fSample")) : ""}</small>
              <small class="muted">${esc(t("ad.host"))}: ${esc(personName(x.host_name || "–"))}${x.host_is_guest ? " (" + esc(t("ad.guest")) + ")" : ""} · ${esc(t("ad.members", { n: x.members }))}</small></span>
          </li>`;
        })
        .join("") || `<li class="muted">${esc(t("ad.none"))}</li>`}</ul>`;
  }

  function reportsHTML() {
    if (!data.reports.length) return `<p class="muted">${esc(t("ad.noReports"))}</p>`;
    return `<ul class="list-plain ad-list">${data.reports
      .map(
        (r) => `<li class="rep">
          <span class="who"><strong>${esc(t("rep." + r.reason) === "rep." + r.reason ? r.reason : t("rep." + r.reason))}</strong> <small class="muted">· ${esc(r.status)} · ${esc(ago(r.created_at))}</small>
            ${r.details ? `<small>${esc(r.details)}</small>` : ""}
            <small class="muted">${esc(t("ad.reporter"))}: ${esc(personName(r.reporter_name || "–"))} → ${esc(t("ad.reported"))}: ${esc(personName(r.reported_name || "–"))}${r.table_title ? " · " + esc(r.table_title) : ""}</small>
            <span class="row wrap-row" style="gap:8px;margin-top:6px">
              ${r.status !== "resolved" ? `<button type="button" class="btn sm" data-act="resolve" data-id="${esc(r.id)}">✓ ${esc(t("ad.resolve"))}</button>` : `<button type="button" class="btn sm ghost" data-act="reopen" data-id="${esc(r.id)}">${esc(t("ad.reopen"))}</button>`}
              ${r.reported_id && r.reported_status !== "suspended" ? `<button type="button" class="btn sm danger-ghost" data-act="suspend" data-id="${esc(r.reported_id)}">⛔ ${esc(t("ad.suspend"))}</button>` : ""}
              ${r.table_id ? `<button type="button" class="btn sm danger-ghost" data-act="cancel-one" data-id="${esc(r.table_id)}">${esc(t("ad.cancelTable"))}</button>` : ""}
            </span></span></li>`
      )
      .join("")}</ul>`;
  }

  function paint() {
    const o = data.overview;
    const tabs = [["overview", t("ad.tabOverview")], ["users", t("ad.tabUsers")], ["tables", t("ad.tabTables")], ["reports", t("ad.tabReports") + (o?.reports_new ? ` (${o.reports_new})` : "")]];
    root.innerHTML = `<div class="page"><h1>🛠 ${esc(t("ad.title"))}</h1>
      <div class="chips" role="tablist" style="margin-bottom:14px">${tabs.map(([k, l]) => `<button type="button" class="chip" role="tab" data-tab="${k}" aria-pressed="${tab === k}">${esc(l)}</button>`).join("")}
        <button type="button" class="chip" data-act="reload">↻ ${esc(t("ad.reload"))}</button></div>
      <section class="card">${tab === "overview" ? overviewHTML() : tab === "users" ? usersHTML() : tab === "tables" ? tablesHTML() : reportsHTML()}</section></div>`;
    wire();
  }

  async function run(fn, okMsg) {
    try {
      await fn();
      if (okMsg) toast(okMsg);
      await load();
    } catch (e) {
      showError(e);
    }
  }

  function wire() {
    qsa("[data-tab]", root).forEach((b) => b.addEventListener("click", () => ((tab = state.adminTab = b.dataset.tab), paint())));
    qsa("[data-f]", root).forEach((b) =>
      b.addEventListener("click", () => {
        const [k, v] = b.dataset.f.split(":");
        filt[k] = v;
        paint();
      })
    );
    qsa("[data-pick-user]", root).forEach((c) => c.addEventListener("change", () => (c.checked ? sel.users.add(c.dataset.pickUser) : sel.users.delete(c.dataset.pickUser), paint())));
    qsa("[data-pick-table]", root).forEach((c) => c.addEventListener("change", () => (c.checked ? sel.tables.add(c.dataset.pickTable) : sel.tables.delete(c.dataset.pickTable), paint())));
    qsa("[data-act]", root).forEach((b) =>
      b.addEventListener("click", async () => {
        const id = b.dataset.id;
        switch (b.dataset.act) {
          case "reload":
            return load();
          case "pick-none":
            sel.users.clear();
            return paint();
          case "pick-idle":
            // guests who never hosted or joined anything and have been around for more than a day: the usual test leftovers
            for (const u of data.users) if (u.is_anonymous && idle(u) && !u.is_admin && u.id !== state.me?.id && Date.now() - new Date(u.created_at) > DAY) sel.users.add(u.id);
            return paint();
          case "purge": {
            const ids = userRows().filter((u) => sel.users.has(u.id)).map((u) => u.id);
            const ok = await confirmDialog({ title: t("ad.purgeQ", { n: ids.length }), body: t("ad.purgeBody"), confirmLabel: t("ad.purgeYes"), danger: true });
            if (!ok) return;
            return run(async () => {
              const n = await api.adminPurgeUsers(ids);
              ids.forEach((i) => sel.users.delete(i));
              toast(t("ad.purged", { n }));
            });
          }
          case "suspend":
          case "unsuspend": {
            if (b.dataset.act === "suspend" && !(await confirmDialog({ title: t("ad.suspendQ"), body: t("ad.suspendBody"), confirmLabel: t("ad.suspend"), danger: true }))) return;
            return run(() => api.adminSetUserStatus(id, b.dataset.act === "suspend" ? "suspended" : "active"));
          }
          case "pick-tables":
            for (const x of tableRows()) if (!x.is_sample && ["open", "full"].includes(x.status)) sel.tables.add(x.id);
            return paint();
          case "cancel-tables": {
            const ids = tableRows().filter((x) => sel.tables.has(x.id) && ["open", "full"].includes(x.status) && !x.is_sample).map((x) => x.id);
            const ok = await confirmDialog({ title: t("ad.cancelQ", { n: ids.length }), body: t("ad.cancelBody"), confirmLabel: t("ad.cancelTable"), danger: true });
            if (!ok) return;
            return run(async () => {
              const n = await api.adminCancelTables(ids);
              ids.forEach((i) => sel.tables.delete(i));
              toast(t("ad.cancelled", { n }));
            });
          }
          case "cancel-one":
            return run(async () => toast(t("ad.cancelled", { n: await api.adminCancelTables([id]) })));
          case "resolve":
            return run(() => api.adminResolveReport(id, "resolved"));
          case "reopen":
            return run(() => api.adminResolveReport(id, "new"));
        }
      })
    );
  }

  paint();
  await load();
  return () => {
    alive = false;
  };
}
