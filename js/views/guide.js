// "How it works": one full-screen walk-through of everything the app does. Shown once, the first time the site is opened
// (before sign-in), and again any time from the ❓ buttons. Every card can be skipped.
import { esc } from "../util.js";
import { t, getLang, setLang, onLangChange } from "../i18n.js";

const KEY = "tb.guide";
export const guideSeen = () => {
  try { return localStorage.getItem(KEY) === "1"; } catch { return true; }
};
const markSeen = () => { try { localStorage.setItem(KEY, "1"); } catch {} };

// e = picture, k = text key (gd.<k>.t / .b / .l = three short bullet points), tone = background colour of the picture
const CARDS = [
  { e: "🍲", k: "welcome", tone: "green" },
  { e: "🗺️", k: "map", tone: "sky" },
  { e: "🍽️", k: "host", tone: "peach" },
  { e: "👫", k: "friends", tone: "rose" },
  { e: "🌿", k: "reflect", tone: "green" },
  { e: "🔒", k: "safe", tone: "sky" },
];

export function openGuide({ onClose } = {}) {
  if (document.getElementById("intro")) return null;
  let i = 0;
  const lastFocus = document.activeElement;
  const el = document.createElement("div");
  el.id = "intro";
  el.className = "intro";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", t("gd.title"));
  document.body.appendChild(el);
  document.body.classList.add("no-scroll");

  function close() {
    markSeen();
    el.classList.remove("open");
    document.removeEventListener("keydown", onKey);
    offLang();
    document.body.classList.remove("no-scroll");
    setTimeout(() => el.remove(), 180);
    try { lastFocus?.focus?.({ preventScroll: true }); } catch {}
    onClose?.();
  }

  function draw() {
    const c = CARDS[i];
    const last = i === CARDS.length - 1;
    const points = ["1", "2", "3"].map((n) => t(`gd.${c.k}.p${n}`)).filter((x) => x && !x.startsWith("gd."));
    el.innerHTML = `
      <div class="intro-top">
        <span class="intro-brand"><span aria-hidden="true">✳</span> Table &amp; Bloom</span>
        <span class="intro-actions"><button type="button" class="intro-lang" data-lang>${getLang() === "zh" ? "EN" : "中文"}</button><button type="button" class="intro-skip" data-skip>${esc(t("gd.skip"))}</button></span>
      </div>
      <div class="intro-body" data-swipe>
        <div class="intro-pic tone-${c.tone}" aria-hidden="true"><span>${c.e}</span></div>
        <p class="intro-n">${esc(t("gd.stepOf", { n: i + 1, total: CARDS.length }))}</p>
        <h2 id="intro-h">${esc(t(`gd.${c.k}.t`))}</h2>
        <p class="intro-lead">${esc(t(`gd.${c.k}.b`))}</p>
        ${points.length ? `<ul class="intro-points">${points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
      </div>
      <div class="intro-foot">
        <div class="intro-dots" role="tablist" aria-label="${esc(t("gd.title"))}">${CARDS.map((_, n) => `<button type="button" role="tab" aria-selected="${n === i}" aria-label="${n + 1}" data-dot="${n}" class="${n === i ? "on" : ""}"></button>`).join("")}</div>
        <div class="intro-btns">
          ${i ? `<button type="button" class="btn" data-back>${esc(t("common.back"))}</button>` : "<span></span>"}
          <button type="button" class="btn primary" data-next>${esc(last ? t("gd.start") : t("common.next"))}</button>
        </div>
      </div>`;
    el.querySelector("[data-next]").focus({ preventScroll: true });
  }
  const step = (d) => {
    if (d > 0 && i === CARDS.length - 1) return close();
    i = Math.max(0, Math.min(CARDS.length - 1, i + d));
    draw();
  };
  function onKey(e) {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
  }
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.skip !== undefined) close();
    else if (b.dataset.lang !== undefined) setLang(getLang() === "zh" ? "en" : "zh");
    else if (b.dataset.next !== undefined) step(1);
    else if (b.dataset.back !== undefined) step(-1);
    else if (b.dataset.dot) { i = Number(b.dataset.dot); draw(); }
  });
  let x0 = null;
  el.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  el.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1);
  });
  document.addEventListener("keydown", onKey);
  const offLang = onLangChange(() => draw());
  draw();
  requestAnimationFrame(() => el.classList.add("open"));
  return { el, close };
}
