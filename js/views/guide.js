// "How it works": a few short cards for two ways to use the app. Shown once after the profile is set up; reachable any time.
import { esc, qs } from "../util.js";
import { t } from "../i18n.js";
import { openSheet } from "../ui.js";
import { go } from "./common.js";

const KEY = "tb.guide";
export const guideSeen = () => {
  try { return localStorage.getItem(KEY) === "1"; } catch { return true; }
};
const markSeen = () => { try { localStorage.setItem(KEY, "1"); } catch {} };

// Each path is four cards; `to` adds a button that jumps to that page.
const PATHS = {
  new: [
    { e: "🗺️", k: "find", to: "#map" },
    { e: "🍽️", k: "host", to: "#new" },
    { e: "🤝", k: "fill" },
    { e: "🌿", k: "reflect" },
  ],
  friends: [
    { e: "👫", k: "host", to: "#new" },
    { e: "🔗", k: "invite" },
    { e: "📍", k: "middle" },
    { e: "🍜", k: "reflect" },
  ],
};

export function openGuide({ onClose } = {}) {
  let path = null;
  let i = 0;
  const sheet = openSheet({ label: t("gd.title"), className: "sheet-guide", html: "", onClose: () => { markSeen(); onClose?.(); } });

  function draw() {
    if (!path) {
      sheet.setHTML(`<h2>${esc(t("gd.title"))}</h2><p class="muted">${esc(t("gd.pick"))}</p>
        <div class="guide-paths">
          ${Object.keys(PATHS).map((p) => `<button type="button" class="guide-path" data-path="${p}"><strong>${esc(t(`gd.${p}.name`))}</strong><small>${esc(t(`gd.${p}.sub`))}</small></button>`).join("")}
        </div>
        <div class="row wrap-row"><button type="button" class="btn ghost" data-skip>${esc(t("gd.skip"))}</button></div>`);
    } else {
      const cards = PATHS[path];
      const c = cards[i];
      const last = i === cards.length - 1;
      sheet.setHTML(`
        <div class="steps" role="img" aria-label="${esc(t("gd.stepOf", { n: i + 1, total: cards.length }))}">${cards.map((_, n) => `<i class="${n <= i ? "on" : ""}"></i>`).join("")}</div>
        <div class="guide-card">
          <div class="guide-emoji" aria-hidden="true">${c.e}</div>
          <p class="guide-n">${esc(t("gd.stepOf", { n: i + 1, total: cards.length }))}</p>
          <h2>${esc(t(`gd.${path}.${c.k}.t`))}</h2>
          <p>${esc(t(`gd.${path}.${c.k}.b`))}</p>
          ${c.to ? `<button type="button" class="btn sm" data-go="${c.to}">${esc(t(`gd.${path}.${c.k}.go`))}</button>` : ""}
        </div>
        <div class="row wrap-row guide-nav">
          <button type="button" class="btn ghost" data-back>${esc(i ? t("common.back") : t("gd.change"))}</button>
          <span class="spacer"></span>
          <button type="button" class="btn ghost" data-skip>${esc(t("gd.skip"))}</button>
          <button type="button" class="btn primary" data-next>${esc(last ? t("gd.done") : t("common.next"))}</button>
        </div>`);
    }
    sheet.focusFirst();
  }

  sheet.body.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.path) { path = b.dataset.path; i = 0; draw(); }
    else if (b.dataset.skip !== undefined) sheet.close("button");
    else if (b.dataset.back !== undefined) { if (i) i--; else path = null; draw(); }
    else if (b.dataset.next !== undefined) { if (i < PATHS[path].length - 1) { i++; draw(); } else sheet.close("button"); }
    else if (b.dataset.go) { const to = b.dataset.go; sheet.close("button"); go(to); }
  });
  draw();
  return sheet;
}
