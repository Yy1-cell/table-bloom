// Safety for tables with new people: the code of conduct, "sign in first" for guests, and the 🛡️ Safety panel on a table.
// These open as small dialogs (not sheets), so the table page underneath stays open.
import { esc, qs, fmtDateLong } from "../util.js";
import { t } from "../i18n.js";
import { state } from "../state.js";
import { api } from "../api.js";
import { toast } from "../ui.js";
import { go, showError, tableTitle, placeText } from "./common.js";

const RULES = ["cd.1", "cd.2", "cd.3", "cd.4", "cd.5", "cd.6"];

function dialog(html, { label = "" } = {}) {
  const before = document.activeElement;
  const el = document.createElement("div");
  el.className = "dialog-backdrop";
  el.innerHTML = `<div class="dialog safety-dialog" role="dialog" aria-modal="true" aria-label="${esc(label)}" style="max-height:90vh;overflow:auto">${html}</div>`;
  document.body.appendChild(el);
  let onDone = () => {};
  const close = (v) => {
    el.remove();
    before?.focus?.({ preventScroll: true });
    onDone(v);
  };
  el.addEventListener("click", (e) => e.target === el && close(false));
  el.addEventListener("keydown", (e) => e.key === "Escape" && (e.stopPropagation(), close(false)));
  return { el, close, done: new Promise((r) => (onDone = r)) };
}

export const rulesListHTML = () => `<ul class="rules-list">${RULES.map((k) => `<li>${esc(t(k))}</li>`).join("")}</ul>`;

/** Shows the code of conduct; resolves true once the person agreed (saved on their profile). */
export function askConduct() {
  const d = dialog(`
    <h3>🤝 ${esc(t("cd.title"))}</h3>
    <p>${esc(t("cd.lead"))}</p>
    ${rulesListHTML()}
    <label class="row" style="align-items:flex-start;margin:12px 0 4px"><input type="checkbox" id="cd-ok" style="width:22px;height:22px;margin-top:2px;accent-color:var(--green-700)"> <span>${esc(t("cd.check"))}</span></label>
    <div class="err-text" id="cd-err" role="alert"></div>
    <div class="dialog-actions"><button type="button" class="btn ghost" data-no>${esc(t("common.cancel"))}</button><button type="button" class="btn primary" data-yes>${esc(t("cd.agree"))}</button></div>`, { label: t("cd.title") });
  qs("[data-no]", d.el).addEventListener("click", () => d.close(false));
  qs("[data-yes]", d.el).addEventListener("click", async (e) => {
    if (!qs("#cd-ok", d.el).checked) {
      qs("#cd-err", d.el).textContent = t("cd.needCheck");
      return;
    }
    e.currentTarget.disabled = true;
    try {
      await api.agreeConduct();
      if (state.me) state.me.conduct_at = new Date().toISOString();
      d.close(true);
    } catch (err) {
      e.currentTarget.disabled = false;
      showError(err);
    }
  });
  qs("#cd-ok", d.el).focus();
  return d.done;
}

/** Guests can browse and join friends' tables; tables with strangers need email or Google. */
export function showLoginNeeded() {
  const d = dialog(`
    <h3>🔐 ${esc(t("ln.title"))}</h3>
    <p>${esc(t("ln.body"))}</p>
    <div class="dialog-actions"><button type="button" class="btn ghost" data-no>${esc(t("common.close"))}</button><button type="button" class="btn primary" data-go>${esc(t("ln.go"))}</button></div>`, { label: t("ln.title") });
  qs("[data-no]", d.el).addEventListener("click", () => d.close(false));
  qs("[data-go]", d.el).addEventListener("click", () => {
    d.close(false);
    go("#profile");
  });
  qs("[data-go]", d.el).focus();
  return d.done;
}

/** Before hosting or joining a table with new people. Resolves true when it's OK to go on. */
export async function readyToMeetStrangers() {
  if (state.me?.guest && api.mode !== "demo") {
    await showLoginNeeded();
    return false;
  }
  if (state.me?.conduct_at) return true;
  return askConduct();
}

/** 🛡️ Safety panel: share the plan with someone you trust, emergency number, tips, rules, report. */
export function openSafety(tb, { onReport } = {}) {
  const when = fmtDateLong(tb.starts_at) + " " + new Date(tb.starts_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  const place = [tb.venue?.name || placeText(tb), tb.venue?.address].filter(Boolean).join(", ");
  const text = t("sf.shareText", { title: tableTitle(tb), when, place, host: tb.host?.display_name || "" });
  const d = dialog(`
    <h3>🛡️ ${esc(t("sf.title"))}</h3>
    <div class="stack">
      <button type="button" class="btn block" data-share>📤 ${esc(t("sf.share"))}</button>
      <a class="btn block danger-ghost" href="tel:911">📞 ${esc(t("sf.call"))}</a>
      <p class="hint" style="margin:0">${esc(t("sf.emergency"))}</p>
    </div>
    <h4 style="margin:14px 0 6px">${esc(t("sf.tipsT"))}</h4>
    <ul class="rules-list">${["sf.tip1", "sf.tip2", "sf.tip3", "sf.tip4"].map((k) => `<li>${esc(t(k))}</li>`).join("")}</ul>
    <details style="margin-top:10px"><summary><strong>${esc(t("sf.rules"))}</strong></summary>${rulesListHTML()}</details>
    <div class="dialog-actions">${onReport ? `<button type="button" class="btn ghost" data-report>⚑ ${esc(t("sf.report"))}</button>` : ""}<button type="button" class="btn primary" data-no>${esc(t("common.close"))}</button></div>`, { label: t("sf.title") });
  qs("[data-no]", d.el).addEventListener("click", () => d.close(false));
  qs("[data-report]", d.el)?.addEventListener("click", () => {
    d.close(false);
    onReport();
  });
  qs("[data-share]", d.el).addEventListener("click", async () => {
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch (e) {
      if (e?.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast(t("sf.copied"));
    } catch {
      window.prompt(t("sf.share"), text);
    }
  });
  qs("[data-share]", d.el).focus();
  return d.done;
}
