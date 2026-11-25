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

// ---------------------------------------------------------------- welcome: one screen, two paths
const INTENT = "tb.intent";
/** The path picked on the welcome screen ("meet" | "friends"), read once. */
export function takeIntent() {
  try {
    const v = localStorage.getItem(INTENT);
    localStorage.removeItem(INTENT);
    return v;
  } catch {
    return null;
  }
}

// An original flat illustration: friends around a table with a hot pot, seen from above.
const HERO = `<svg viewBox="0 0 340 250" class="wl-hero" aria-hidden="true">
  <defs>
    <radialGradient id="wlglow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffe2c2"/><stop offset=".7" stop-color="#ffd3a8" stop-opacity=".55"/><stop offset="1" stop-color="#ffd3a8" stop-opacity="0"/></radialGradient>
    <radialGradient id="wltable" cx="45%" cy="35%" r="70%"><stop offset="0" stop-color="#e9b98a"/><stop offset="1" stop-color="#c98a57"/></radialGradient>
    <radialGradient id="wlsoup" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ffb071"/><stop offset=".6" stop-color="#f0693a"/><stop offset="1" stop-color="#c94823"/></radialGradient>
    <linearGradient id="wlpot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b625f"/><stop offset="1" stop-color="#3f3836"/></linearGradient>
    <filter id="wlsh" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#8a4f22" flood-opacity=".28"/></filter>
    <filter id="wlsh2"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#5a3a20" flood-opacity=".25"/></filter>
  </defs>
  <circle cx="170" cy="132" r="125" fill="url(#wlglow)"/>
  <g class="wl-float">
    <path d="M36 66 c-6 -8 4 -16 10 -8 c6 -8 16 0 10 8 l-10 10z" fill="#f28b7d" opacity=".85"/>
    <g fill="#f7c35f"><path d="M298 70 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z"/></g>
    <circle cx="300" cy="200" r="5" fill="#9cc47a"/><circle cx="34" cy="196" r="4" fill="#f6b37a"/>
  </g>
  <!-- people behind the table -->
  <g class="wl-p" filter="url(#wlsh2)">
    <g transform="translate(92 74)"><path d="M-32 44 q32 -40 64 0z" fill="#5d9471"/><circle r="21" fill="#f3cba9"/><path d="M-21 -2 q2 -24 21 -24 q19 0 21 24 q-9 -11 -21 -11 q-12 0 -21 11z" fill="#3a2a21"/><circle cx="-11" cy="7" r="4" fill="#f4a08a" opacity=".6"/><circle cx="11" cy="7" r="4" fill="#f4a08a" opacity=".6"/><path d="M-6 6 q6 5 12 0" stroke="#7a4a35" stroke-width="2" fill="none" stroke-linecap="round"/></g>
    <g transform="translate(248 74)"><path d="M-32 44 q32 -40 64 0z" fill="#e8876a"/><circle r="21" fill="#c78e66"/><path d="M-23 6 q-4 -30 23 -30 q27 0 23 30 q-4 -16 -23 -16 q-19 0 -23 16z" fill="#2a1c16"/><circle cx="-11" cy="7" r="4" fill="#e07a63" opacity=".5"/><circle cx="11" cy="7" r="4" fill="#e07a63" opacity=".5"/><path d="M-6 6 q6 5 12 0" stroke="#5a3424" stroke-width="2" fill="none" stroke-linecap="round"/></g>
  </g>
  <!-- table -->
  <g filter="url(#wlsh)">
    <ellipse cx="170" cy="150" rx="122" ry="72" fill="url(#wltable)"/>
    <ellipse cx="170" cy="146" rx="112" ry="64" fill="none" stroke="#f3d1ad" stroke-opacity=".5" stroke-width="2"/>
  </g>
  <!-- bowls -->
  <g filter="url(#wlsh2)">
    <g transform="translate(96 128)"><ellipse rx="20" ry="13" fill="#fff"/><ellipse rx="14" ry="8" fill="#9cc47a"/><circle cx="-4" cy="-2" r="3" fill="#cfe7b4"/></g>
    <g transform="translate(244 128)"><ellipse rx="20" ry="13" fill="#fff"/><ellipse rx="14" ry="8" fill="#f7c35f"/><circle cx="4" cy="-2" r="3" fill="#ffe7a6"/></g>
    <g transform="translate(104 178)"><ellipse rx="20" ry="13" fill="#fff"/><ellipse rx="14" ry="8" fill="#f59a76"/><circle cx="3" cy="-1" r="3" fill="#ffd0bd"/></g>
    <g transform="translate(236 178)"><ellipse rx="20" ry="13" fill="#fff"/><ellipse rx="14" ry="8" fill="#e9eef0"/><circle cx="-4" cy="-2" r="4" fill="#fff"/></g>
  </g>
  <g stroke="#7b4a2a" stroke-width="3" stroke-linecap="round"><path d="M118 118 l18 -14"/><path d="M122 122 l18 -14"/><path d="M222 190 l-16 -14"/><path d="M226 186 l-16 -14"/></g>
  <!-- hot pot -->
  <g filter="url(#wlsh2)">
    <ellipse cx="170" cy="152" rx="40" ry="27" fill="url(#wlpot)"/>
    <ellipse cx="170" cy="148" rx="34" ry="22" fill="url(#wlsoup)"/>
    <path d="M170 126 v44" stroke="#4a4240" stroke-width="3"/>
    <g fill="#fff3e6"><circle cx="156" cy="143" r="4.5"/><circle cx="182" cy="154" r="4"/><circle cx="160" cy="158" r="3.5"/></g>
    <g fill="#7fb35d"><path d="M180 140 q6 -3 9 2 q-5 3 -9 -2z"/><path d="M150 152 q5 -4 9 0 q-5 4 -9 0z"/></g>
    <g fill="#ffd27a"><circle cx="186" cy="146" r="3"/></g>
  </g>
  <g class="wl-steam" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round">
    <path d="M156 118 q-7 -11 0 -20 q7 -9 0 -18"/><path d="M170 112 q-7 -11 0 -20 q7 -9 0 -18"/><path d="M184 118 q-7 -11 0 -20 q7 -9 0 -18"/>
  </g>
  <!-- people in front -->
  <g class="wl-p" filter="url(#wlsh2)">
    <g transform="translate(70 214)"><path d="M-34 40 q34 -42 68 0z" fill="#f2b84f"/><circle r="22" fill="#8c5c3e"/><circle cy="-16" r="13" fill="#1f1612"/><circle cx="-11" cy="6" r="4" fill="#c86a50" opacity=".45"/><circle cx="11" cy="6" r="4" fill="#c86a50" opacity=".45"/></g>
    <g transform="translate(270 214)"><path d="M-34 40 q34 -42 68 0z" fill="#7aa8cc"/><circle r="22" fill="#f7d6bb"/><path d="M-22 0 q0 -26 22 -26 q22 0 22 26 l0 18 q-5 -20 -22 -25 q-17 5 -22 25z" fill="#c98a42"/><circle cx="-11" cy="6" r="4" fill="#f4a08a" opacity=".55"/><circle cx="11" cy="6" r="4" fill="#f4a08a" opacity=".55"/></g>
  </g>
</svg>`;

/** First visit: one screen that says what the app is for, with the two ways to use it. */
export function openWelcome({ onClose } = {}) {
  if (document.getElementById("intro")) return null;
  const lastFocus = document.activeElement;
  const el = document.createElement("div");
  el.id = "intro";
  el.className = "intro welcome";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "wl-h");
  document.body.appendChild(el);
  document.body.classList.add("no-scroll");
  const close = (intent) => {
    markSeen();
    try { if (intent) localStorage.setItem(INTENT, intent); } catch {}
    el.classList.remove("open");
    document.removeEventListener("keydown", onKey);
    offLang();
    document.body.classList.remove("no-scroll");
    setTimeout(() => el.remove(), 180);
    try { lastFocus?.focus?.({ preventScroll: true }); } catch {}
    onClose?.(intent);
  };
  const onKey = (e) => e.key === "Escape" && close(null);
  function draw() {
    el.innerHTML = `
      <div class="intro-top">
        <span class="intro-brand"><span aria-hidden="true">✳</span> Table &amp; Bloom</span>
        <span class="intro-actions"><button type="button" class="intro-lang" data-lang>${getLang() === "zh" ? "EN" : "中文"}</button></span>
      </div>
      <div class="wl-blob b1" aria-hidden="true"></div><div class="wl-blob b2" aria-hidden="true"></div>
      <div class="wl-body">
        ${HERO}
        <h1 id="wl-h">${(() => { const [a, b] = t("wl.title").split("|"); return `${esc(a)}<br><em class="wl-accent">${esc(b || "")}<svg viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true"><path d="M3 8 Q 60 1 110 6 T 197 5"/></svg></em>`; })()}</h1>
        <div class="wl-paths">
          <button type="button" class="wl-path wl-meet" data-go="meet">
            <span class="wl-ico" aria-hidden="true">🤝</span>
            <span class="wl-txt"><b>${esc(t("wl.meetT"))}</b></span>
            <span class="wl-arrow" aria-hidden="true">→</span>
          </button>
          <button type="button" class="wl-path wl-friends" data-go="friends">
            <span class="wl-ico" aria-hidden="true">👫</span>
            <span class="wl-txt"><b>${esc(t("wl.friendsT"))}</b></span>
            <span class="wl-arrow" aria-hidden="true">→</span>
          </button>
        </div>
        <button type="button" class="intro-more wl-why" data-about>${esc(t("wl.why"))}</button>
      </div>`;
    el.querySelector("[data-go]").focus({ preventScroll: true });
  }
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.go) close(b.dataset.go);
    else if (b.dataset.about !== undefined) { close(null); import("./about.js").then((m) => m.openAbout()); }
    else if (b.dataset.lang !== undefined) setLang(getLang() === "zh" ? "en" : "zh");
  });
  document.addEventListener("keydown", onKey);
  const offLang = onLangChange(() => draw());
  draw();
  requestAnimationFrame(() => el.classList.add("open"));
  return { el, close };
}

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
