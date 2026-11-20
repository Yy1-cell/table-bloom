// Bootstrap: language, data layer, session, router, chrome (nav), service worker.
import { initLang, t, getLang, setLang, onLangChange } from "./i18n.js";
import { state, bus } from "./state.js";
import { initApi } from "./api.js";
import * as apiMod from "./api.js";
import { qs, esc, personName } from "./util.js";
import { toast, closeSheet, hasSheet } from "./ui.js";
import { AREAS, CUISINES } from "./data.js";
import { renderInvitation } from "./invitation.js";
import { DEMO_CODE } from "./api-demo.js";
import { loadLoc } from "./location.js";

const BASE = ["discover", "map", "mine", "journal", "profile"];
const ICONS = { discover: "🍽️", map: "🗺️", mine: "📅", journal: "📖", profile: "👤" };
const view = qs("#view");

let cleanup = null;
let current = null; // name of the rendered base view
let routing = Promise.resolve();
let prevStatus = null;
let pendingTable = location.hash.startsWith("#t-") ? location.hash : null;
try {
  if (!pendingTable && ["#auth", "#profile"].includes(location.hash)) {
    pendingTable = sessionStorage.getItem("tb.after");
  }
} catch {}

function setPendingTable(hash) {
  pendingTable = hash;
  try {
    if (hash) sessionStorage.setItem("tb.after", hash);
    else sessionStorage.removeItem("tb.after");
  } catch {}
}

const api = () => apiMod.api;

// ------------------------------------------------------------------ chrome
function renderChrome() {
  const links = (cls) =>
    ["discover", "map", "mine", "journal"]
      .concat(cls === "bottom" ? ["profile"] : [])
      .map((n) => `<a href="#${n}" data-nav="${n}" ${state.baseView === n && current === n ? 'aria-current="page"' : ""}><span class="ico" aria-hidden="true">${ICONS[n]}</span><span>${esc(t("nav." + n))}</span>${n === "mine" && state.badge ? `<span class="nav-badge" aria-label="${esc(t("nav.badge", { n: state.badge }))}">${state.badge}</span>` : ""}</a>`)
      .join("");
  qs("#top-nav").setAttribute("aria-label", t("nav.main"));
  qs("#bottom-nav").setAttribute("aria-label", t("nav.main"));
  qs("#top-nav").innerHTML = state.session ? links("top").replace(/<span class="ico"[^>]*>.*?<\/span>/g, "") : "";
  qs("#bottom-nav").innerHTML = state.session ? links("bottom") : "";
  qs("#bottom-nav").hidden = !state.session;
  document.body.style.paddingBottom = state.session ? "" : "0";
  qs("#lang-btn").textContent = getLang() === "zh" ? "EN" : "中文";
  qs("#lang-btn").setAttribute("aria-label", t("nav.switchLang"));
  const me = qs("#me-link");
  me.hidden = !state.session || !state.me;
  if (state.me) {
    me.innerHTML = `<span aria-hidden="true">${esc(state.me.avatar_emoji)}</span><span>${esc(personName(state.me.display_name))}</span>`;
    if (current === "profile") me.setAttribute("aria-current", "page");
    else me.removeAttribute("aria-current");
  }
  const banner = qs("#demo-banner");
  banner.hidden = state.mode !== "demo";
  banner.textContent = t("demo.banner", { code: DEMO_CODE });
  qs("#skip").textContent = t("nav.skip");
}

// ------------------------------------------------------------------ data
async function loadRefs() {
  loadLoc();
  try {
    const [a, c] = await Promise.all([api().listAreas(), api().listCuisines()]);
    state.areas = a?.length ? a : AREAS;
    state.cuisines = c?.length ? c : CUISINES;
  } catch {
    state.areas = AREAS;
    state.cuisines = CUISINES;
  }
}

async function loadMe() {
  state.me = await api().getMe();
  state.diningProfile = undefined;
  state.isAdmin = undefined;
  state.ranks = state.me.ranks?.length ? state.me.ranks : state.cuisines.map((c) => c.slug);
}

async function refreshBadges({ notify = true } = {}) {
  if (!state.session) return;
  try {
    const mine = await api().listMyTables();
    state.myTables = mine;
    state.badge = mine.filter((x) => ["host"].includes(x.my_status) && ["open", "full"].includes(x.status)).reduce((n, x) => n + (x.pending_count || 0), 0);
    const now = new Map(mine.map((x) => [x.id, x.my_status]));
    if (prevStatus && notify) {
      for (const x of mine) {
        const before = prevStatus.get(x.id);
        if (before === "requested" && x.my_status === "joined") toast(t("note.accepted", { title: x.title || t("card.untitled") }), { actionLabel: t("note.view"), onAction: () => (location.hash = `#t-${x.id}`), duration: 9000 });
        if (before === "requested" && x.my_status === "declined") toast(t("note.declined", { title: x.title || t("card.untitled") }), { duration: 8000 });
      }
    }
    prevStatus = now;
    renderChrome();
  } catch {
    /* offline or signed out: ignore */
  }
}

// ------------------------------------------------------------------ router
async function showBase(name, { force = false } = {}) {
  if (current === name && !force) return;
  cleanup?.();
  cleanup = null;
  const y = current === name ? window.scrollY : 0;
  current = name;
  state.baseView = BASE.includes(name) ? name : state.baseView;
  view.innerHTML = `<p role="status">${esc(t("route.loading"))}</p>`;
  renderChrome();
  try {
    const mod = await import(`./views/${name === "journal" ? "reflect" : name}.js`);
    if (current !== name) return;
    const res = await mod.render(view);
    if (current !== name) {
      if (typeof res === "function") res();
      return;
    }
    cleanup = typeof res === "function" ? res : null;
  } catch (error) {
    if (current === name) showRouteError(error);
    return;
  }
  document.title = `${t("nav." + name)} · Table & Bloom`;
  window.scrollTo(0, y);
}

function backToBase() {
  history.replaceState(null, "", `#${state.baseView}`);
  if (staleBase) {
    staleBase = false;
    showBase(current, { force: true });
  }
}

// Keep the lists in step with what other people do (join, leave, change the venue, cancel).
// Re-renders only when the data really changed, and never while a sheet is open.
let staleBase = false;
const sameData = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function syncBase() {
  if (!state.session || document.visibilityState !== "visible") return;
  if (staleBase && !hasSheet()) {
    staleBase = false;
    if (BASE.includes(current)) return showBase(current, { force: true });
  }
  try {
    if (current === "mine") {
      const before = state.myTables;
      await refreshBadges();
      if (sameData(before, state.myTables)) return;
    } else if (current === "discover") {
      const fresh = await api().listTables();
      await refreshBadges();
      if (sameData(fresh, state.tables)) return;
    } else {
      return refreshBadges();
    }
  } catch {
    return;
  }
  if (hasSheet()) staleBase = true;
  else showBase(current, { force: true });
}
let syncTimer = null;
const syncSoon = () => {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncBase, 400);
};

async function doRoute() {
  // Plain-name hashes (#discover, #t-<id>) so links also work where only "#name" is allowed.
  const raw = location.hash.replace(/^#\/?/, "");
  const isTable = raw.startsWith("t-");
  const name = isTable ? "t" : raw;
  const arg = isTable ? raw.slice(2) : "";

  if (raw.startsWith("invite-")) {
    cleanup?.();
    cleanup = null;
    closeSheet({ silent: true });
    current = "invite";
    renderChrome();
    renderInvitation(view);
    window.scrollTo(0, 0);
    return;
  }

  if (!state.session) {
    if (name === "t" && arg) setPendingTable(location.hash);
    closeSheet({ silent: true });
    if (name !== "auth") history.replaceState(null, "", "#auth");
    await showBase("auth", { force: current !== "auth" });
    return;
  }
  if (!state.me) await loadMe();
  if (!state.me.onboarded_at && name !== "profile") {
    if (isTable && arg) setPendingTable(location.hash);
    history.replaceState(null, "", "#profile");
    return doRoute();
  }

  if (name === "discover" && pendingTable) {
    history.replaceState(null, "", pendingTable);
    setPendingTable(null);
    return doRoute();
  }
  if (isTable) setPendingTable(null);

  if (BASE.includes(name)) {
    closeSheet({ silent: true });
    await showBase(name);
    renderChrome();
    // First visit after setting up the profile: a short "how it works" (can be skipped; also under ❓ on Discover and Profile).
    if (name === "discover" && state.me?.onboarded_at && !guideShown) {
      guideShown = true;
      const g = await import("./views/guide.js");
      if (!g.guideSeen() && !hasSheet()) g.openGuide();
    }
  } else if (name === "admin") {
    // operator console: the server refuses non-admins anyway; this just keeps everyone else from seeing an empty page
    if (state.isAdmin === undefined) state.isAdmin = (await api().adminCheck?.()) === true;
    if (!state.isAdmin) {
      history.replaceState(null, "", `#${state.baseView || "discover"}`);
      return doRoute();
    }
    closeSheet({ silent: true });
    await showBase("admin");
    renderChrome();
  } else if (name === "new" || (name === "t" && arg)) {
    if (!BASE.includes(current)) await showBase(state.baseView || "discover", { force: true });
    if (name === "new") {
      const { openCreate } = await import("./views/create.js");
      openCreate({ onClose: backToBase });
    } else {
      const { openTable } = await import("./views/table-detail.js");
      openTable(arg, { onClose: backToBase });
    }
  } else {
    history.replaceState(null, "", `#${state.baseView || "discover"}`);
    return doRoute();
  }
}

let guideShown = false;
function showRouteError(error) {
  console.error(error);
  current = null;
  view.innerHTML = `<section class="empty" role="alert"><p>${esc(t("route.failed"))}</p>
    <button type="button" class="btn primary">${esc(t("sw.reload"))}</button></section>`;
  qs("button", view).addEventListener("click", () => location.reload());
}

const route = () => (routing = routing.then(doRoute).catch(showRouteError));

// ------------------------------------------------------------------ session
async function onSession(session) {
  state.session = session;
  if (session) {
    try {
      await loadMe();
    } catch (e) {
      console.warn(e);
      if (e.code === "account_suspended") toast(t("err.account_suspended"), { kind: "error", duration: 0 });
      await api().signOut();
      return;
    }
    if (state.me.language && !localStorage.getItem("tb.lang")) setLang(state.me.language);
    prevStatus = null;
    await refreshBadges({ notify: false });
    const raw = location.hash.replace(/^#\/?/, "");
    if (raw === "auth" || raw === "" || !raw) history.replaceState(null, "", pendingTable || (state.me.onboarded_at ? "#discover" : "#profile"));
  } else {
    state.me = null;
    state.badge = 0;
    prevStatus = null;
    current = null;
    if (!location.hash.startsWith("#invite-")) history.replaceState(null, "", "#auth");
  }
  renderChrome();
  route();
}

// ------------------------------------------------------------------ boot
async function boot() {
  initLang();
  renderChrome();
  // First visit: explain the whole app before anything else (sign-in comes after). Invite links go straight to the table.
  if (!/^#(invite|t-)/.test(location.hash)) {
    const g = await import("./views/guide.js");
    if (!g.guideSeen()) g.openGuide();
  }
  await initApi();
  state.mode = apiMod.api.mode;
  await loadRefs();

  qs("#lang-btn").addEventListener("click", () => {
    const lang = getLang() === "zh" ? "en" : "zh";
    setLang(lang);
    if (state.me?.onboarded_at) apiMod.api.saveProfile({ language: lang }).catch(() => {});
  });
  qs("#skip").addEventListener("click", (e) => {
    e.preventDefault();
    view.focus();
  });
  onLangChange(() => {
    renderChrome();
    const open = hasSheet();
    if (open) closeSheet({ silent: true });
    current = null;
    route();
  });
  window.addEventListener("hashchange", route);
  bus.on("tables-changed", () => refreshBadges());
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    state.installEvent = e;
  });
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && syncBase());
  setInterval(() => document.visibilityState === "visible" && state.session && syncBase(), 15000);
  api().onLive?.(syncSoon);

  api().onAuthChange((s) => {
    if ((s?.userId || null) !== (state.session?.userId || null)) onSession(s);
  });

  const session = await api().init();
  await onSession(session);

  registerSW();
}

function registerSW() {
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;
  navigator.serviceWorker
    .register("./sw.js")
    .then((reg) => {
      function offerUpdate(worker) {
        if (!worker || !navigator.serviceWorker.controller) return;
        toast(t("sw.update"), { actionLabel: t("sw.reload"), onAction: () => {
          navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
          worker.postMessage("activate-update");
        }, duration: 0 });
      }
      offerUpdate(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed") offerUpdate(worker);
        });
      });
    })
    .catch((e) => console.warn("SW registration failed", e));
}

boot().catch((e) => {
  console.error(e);
  view.innerHTML = `<div class="empty"><p>Something went wrong starting the app. Please reload.</p><button class="btn primary" onclick="location.reload()">Reload</button></div>`;
});
