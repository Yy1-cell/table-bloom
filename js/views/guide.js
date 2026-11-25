// "How it works": one full-screen walk-through of everything the app does. Shown once, the first time the site is opened
// (before sign-in), and again any time from the ❓ buttons. Every card can be skipped.
import { esc } from "../util.js";
import { t, getLang, setLang, onLangChange } from "../i18n.js";

const KEY = "tb.guide";
export const guideSeen = () => {
  try { return localStorage.getItem(KEY) === "1"; } catch { return true; }
};
const markSeen = () => { try { localStorage.setItem(KEY, "1"); } catch {} };

// k = text key: gd.<k>.t (title), gd.<k>.s (one short line), gd.<k>.c1–c3 (three tiny chips). tone = colour of the card.
// Pictures first, very few words: people decide in a second whether to read on.
const CARDS = [
  { k: "why", tone: "peach", more: true },
  { k: "meet", tone: "green" },
  { k: "friends", tone: "rose" },
  { k: "safe", tone: "sky" },
];

// Little illustrated scenes, built from emoji + CSS (no images to download).
const ART = {
  why: `<div class="art art-why">
      <span class="a-table">🍲</span>
      <span class="a-p p1">🧑🏻</span><span class="a-p p2">👩🏽</span><span class="a-p p3">🧑🏿</span><span class="a-p p4">👩🏼</span>
      <span class="a-spark s1">✨</span><span class="a-spark s2">💬</span><span class="a-spark s3">🌱</span>
    </div>`,
  meet: () => `<div class="art art-meet">
      <div class="m-card m-back"></div>
      <div class="m-card">
        <div class="m-row"><span class="m-emo">🍜</span><div><b>${esc(t("gd.meet.demoT"))}</b><small>${esc(t("gd.meet.demoW"))}</small></div></div>
        <div class="m-row m-seats"><span class="m-dot on"></span><span class="m-dot on"></span><span class="m-dot"></span><span class="m-dot"></span><small>2 / 4</small><span class="m-join">${esc(t("gd.meet.demoJ"))}</span></div>
      </div>
      <span class="a-spark s1">🙋</span>
    </div>`,
  friends: `<div class="art art-friends">
      <svg viewBox="0 0 300 200" aria-hidden="true"><path d="M48 46 L150 94 M252 52 L150 94 M150 192 L150 94" /></svg>
      <span class="f-pin f1">📍</span><span class="f-pin f2">📍</span><span class="f-pin f3">📍</span>
      <span class="f-mid">⭐</span>
    </div>`,
  safe: `<div class="art art-safe">
      <span class="s-shield">🛡️</span>
      <span class="s-badge b1">🏙️</span><span class="s-badge b2">🔒</span><span class="s-badge b3">✅</span>
    </div>`,
};

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
    const chips = ["c1", "c2", "c3"].map((n) => t(`gd.${c.k}.${n}`)).filter((x) => x && !x.startsWith("gd."));
    const art = typeof ART[c.k] === "function" ? ART[c.k]() : ART[c.k];
    el.dataset.tone = c.tone;
    el.innerHTML = `
      <div class="intro-top">
        <span class="intro-brand"><span aria-hidden="true">✳</span> Table &amp; Bloom</span>
        <span class="intro-actions"><button type="button" class="intro-lang" data-lang>${getLang() === "zh" ? "EN" : "中文"}</button><button type="button" class="intro-skip" data-skip>${esc(t("gd.skip"))}</button></span>
      </div>
      <div class="intro-body" data-swipe>
        <div class="intro-stage tone-${c.tone}" aria-hidden="true">${art}</div>
        <h2 id="intro-h">${esc(t(`gd.${c.k}.t`))}</h2>
        <p class="intro-lead">${esc(t(`gd.${c.k}.s`))}</p>
        ${chips.length ? `<div class="intro-chips">${chips.map((p) => `<span>${esc(p)}</span>`).join("")}</div>` : ""}
        ${c.more ? `<button type="button" class="intro-more" data-about>${esc(t("about.more"))}</button>` : ""}
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
    else if (b.dataset.about !== undefined) { close(); import("./about.js").then((m) => m.openAbout()); }
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
