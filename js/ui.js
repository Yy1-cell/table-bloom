// UI building blocks: live-region announcements, toasts, bottom sheets, confirm dialogs, place search.
import { esc, qs, qsa, debounce, mapsUrl } from "./util.js";
import { t } from "./i18n.js";
import { searchPlaces, searchLandmarks } from "./geo.js";

// ---------------------------------------------------------------- announce (screen readers)
export function announce(message) {
  const live = qs("#live");
  if (!live) return;
  live.textContent = "";
  setTimeout(() => (live.textContent = message), 30);
}

// ---------------------------------------------------------------- toast
export function toast(message, { actionLabel, onAction, duration = 4500, kind = "info" } = {}) {
  const host = qs("#toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  el.innerHTML = `<span>${esc(message)}</span>${actionLabel ? `<button type="button" class="toast-action">${esc(actionLabel)}</button>` : ""}`;
  const remove = () => el.remove();
  el.querySelector(".toast-action")?.addEventListener("click", () => {
    onAction?.();
    remove();
  });
  host.appendChild(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  if (duration) setTimeout(remove, duration);
  return remove;
}

// ---------------------------------------------------------------- sheets
let currentSheet = null;
let lastFocus = null;

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function openSheet({ html, label = "", className = "", onClose } = {}) {
  closeSheet({ silent: true });
  lastFocus = document.activeElement;

  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";
  backdrop.innerHTML = `
    <section class="sheet ${className}" role="dialog" aria-modal="true" aria-label="${esc(label)}" tabindex="-1">
      <button type="button" class="sheet-close" aria-label="${esc(t("common.close"))}">✕</button>
      <div class="sheet-body"></div>
    </section>`;
  const sheet = backdrop.querySelector(".sheet");
  const body = backdrop.querySelector(".sheet-body");
  body.innerHTML = html || "";
  document.body.appendChild(backdrop);
  document.body.classList.add("no-scroll");
  requestAnimationFrame(() => backdrop.classList.add("open"));

  const ctl = {
    el: sheet,
    body,
    closed: false,
    setHTML(h) {
      const had = body.contains(document.activeElement);
      body.innerHTML = h;
      // A re-render removes the focused element; keep focus inside the dialog so Esc / Tab still work.
      if (had || document.activeElement === document.body) sheet.focus({ preventScroll: true });
    },
    close(by = "code") {
      closeSheet({ by });
    },
    focusFirst() {
      (qs("[autofocus]", body) || qs(FOCUSABLE, body) || sheet).focus({ preventScroll: true });
    },
    onClose,
  };
  currentSheet = { ctl, backdrop };

  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) ctl.close("backdrop");
  });
  backdrop.querySelector(".sheet-close").addEventListener("click", () => ctl.close("button"));
  backdrop.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !qs(".dialog-backdrop")) {
      e.stopPropagation();
      ctl.close("escape");
    } else if (e.key === "Tab") trapTab(e, sheet);
  });

  setTimeout(() => ctl.focusFirst(), 60);
  return ctl;
}

export function closeSheet({ silent = false, by = "code" } = {}) {
  if (!currentSheet) return;
  const { ctl, backdrop } = currentSheet;
  currentSheet = null;
  ctl.closed = true;
  backdrop.classList.remove("open");
  document.body.classList.remove("no-scroll");
  setTimeout(() => backdrop.remove(), 180);
  if (!silent) ctl.onClose?.({ by });
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}

export const hasSheet = () => !!currentSheet;

function trapTab(e, root) {
  const items = qsa(FOCUSABLE, root).filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// ---------------------------------------------------------------- confirm dialog
export function confirmDialog({ title, body = "", confirmLabel, cancelLabel, danger = false }) {
  return new Promise((resolve) => {
    const before = document.activeElement;
    const el = document.createElement("div");
    el.className = "dialog-backdrop";
    el.innerHTML = `
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-body">
        <h3 id="dlg-title">${esc(title)}</h3>
        <p id="dlg-body">${esc(body)}</p>
        <div class="dialog-actions">
          <button type="button" class="btn ghost" data-no>${esc(cancelLabel || t("common.cancel"))}</button>
          <button type="button" class="btn ${danger ? "danger" : "primary"}" data-yes>${esc(confirmLabel || t("common.confirm"))}</button>
        </div>
      </div>`;
    const done = (v) => {
      el.remove();
      before?.focus?.({ preventScroll: true });
      resolve(v);
    };
    el.addEventListener("click", (e) => {
      if (e.target === el) done(false);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(false);
      } else if (e.key === "Tab") trapTab(e, el);
    });
    el.querySelector("[data-no]").addEventListener("click", () => done(false));
    el.querySelector("[data-yes]").addEventListener("click", () => done(true));
    document.body.appendChild(el);
    el.querySelector("[data-no]").focus();
  });
}

// ---------------------------------------------------------------- place search (combobox)
let psCounter = 0;

export function placeSearchHTML({ label, placeholder, hint = "" }) {
  const id = `ps${++psCounter}`;
  return {
    id,
    html: `
    <div class="ps" data-ps="${id}">
      <label for="${id}" class="lbl">${esc(label)}</label>
      <div class="ps-field">
        <input id="${id}" type="search" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="${id}-list"
               aria-autocomplete="list" placeholder="${esc(placeholder || t("ps.placeholder"))}" enterkeyhint="search">
        <ul id="${id}-list" class="ps-list" role="listbox" hidden></ul>
      </div>
      <p class="ps-status hint" id="${id}-status" role="status" aria-live="polite">${esc(hint || t("ps.hint"))}</p>
      <div class="ps-chosen" hidden></div>
      <p class="attrib">${esc(t("ps.attrib"))} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · ${venueAttributionHTML()}</p>
    </div>`,
  };
}

/**
 * Wire up a place-search combobox rendered by placeSearchHTML().
 * Calls onSelect(place) when the user picks a result, onClear() when they edit after picking.
 */
export function venueAttributionHTML() {
  return `<a href="https://open.toronto.ca/dataset/dinesafe/" target="_blank" rel="noopener">City of Toronto DineSafe</a>
    · <a href="https://www.toronto.ca/city-government/data-research-maps/open-data/open-data-licence/" target="_blank" rel="noopener">${esc(t("map.torontoLicence"))}</a>`;
}

export function bindPlaceSearch(root, { id, near, restaurantsOnly = false, googleSearch = restaurantsOnly, onSelect, onClear }) {
  const input = qs(`#${id}`, root);
  const list = qs(`#${id}-list`, root);
  const status = qs(`#${id}-status`, root);
  const fallback = document.createElement("a");
  fallback.className = "btn sm";
  fallback.target = "_blank";
  fallback.rel = "noopener";
  fallback.hidden = true;
  fallback.textContent = t("ps.searchGoogle");
  status.after(fallback);
  const chosen = qs(`[data-ps="${id}"] .ps-chosen`, root);
  let results = [];
  let active = -1;
  let seq = 0;
  let ctl = null;
  let selected = null;

  const setStatus = (msg) => (status.textContent = msg);
  const hide = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };

  function renderList(items, heading) {
    results = items;
    if (!items.length) return hide();
    list.innerHTML =
      (heading ? `<li class="ps-head" role="presentation">${esc(heading)}</li>` : "") +
      items
        .map(
          (r, i) => `<li id="${id}-o${i}" role="option" aria-selected="false" data-i="${i}">
            <span class="ps-name">${esc(r.name)}</span><span class="ps-addr">${esc(r.address || "")}</span></li>`
        )
        .join("");
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function setActive(i) {
    qsa('[role="option"]', list).forEach((el, idx) => el.setAttribute("aria-selected", String(idx === i)));
    active = i;
    if (i >= 0) {
      input.setAttribute("aria-activedescendant", `${id}-o${i}`);
      qs(`#${id}-o${i}`, list)?.scrollIntoView({ block: "nearest" });
    }
  }

  function resetRequest() {
    seq++;
    ctl?.abort();
    fallback.hidden = true;
    hide();
    results = [];
    ctl = null;
  }

  function choose(place) {
    run.cancel();
    resetRequest();
    selected = place;
    input.value = place.name;
    hide();
    chosen.hidden = false;
    chosen.innerHTML = `<span class="ok">✓ ${esc(t("ps.confirmed"))}</span> <strong>${esc(place.name)}</strong><span class="ps-addr">${esc(place.address || "")}</span>`;
    setStatus(t("ps.confirmedLong"));
    onSelect?.(place);
  }

  const centerForSearch = () => typeof near === "function" ? near() : near;
  function showGoogleSearch(q, center) {
    fallback.href = mapsUrl({
      name: q,
      address: center ? `near ${center.lat},${center.lng}` : "Toronto, ON",
    });
    fallback.hidden = false;
  }

  function noResults(q, center, error) {
    const landmarks = restaurantsOnly ? [] : searchLandmarks(q);
    renderList(landmarks, t("ps.landmarks"));
    if (document.activeElement !== input) hide();
    setStatus(t(error ? "ps.searchFailed" : "ps.noMatches"));
    showGoogleSearch(q, center);
  }

  const run = debounce(async () => {
    const q = input.value.trim();
    const mine = seq;
    const center = centerForSearch();
    ctl = new AbortController();
    try {
      const found = await searchPlaces(q, { near: center, signal: ctl.signal, restaurantsOnly });
      if (mine !== seq || !input.isConnected) return;
      if (!found.length) return noResults(q, center, false);
      setStatus(t("ps.pick", { n: found.length }));
      renderList(found);
      if (document.activeElement !== input) hide();
    } catch {
      if (mine !== seq || !input.isConnected) return;
      noResults(q, center, true);
    }
  }, 320);

  input.addEventListener("input", () => {
    run.cancel();
    resetRequest();
    if (selected) {
      selected = null;
      chosen.hidden = true;
      onClear?.();
    }
    if (input.value.trim().length < 2) {
      setStatus(t("ps.keepTyping"));
      if (!restaurantsOnly) renderList(searchLandmarks(""), t("ps.landmarks"));
      return;
    }
    if (googleSearch) showGoogleSearch(input.value.trim(), centerForSearch());
    setStatus(t("ps.searching"));
    run();
  });
  input.addEventListener("focus", () => {
    if (selected) return;
    if (input.value.trim().length >= 2) {
      if (results.length) renderList(results);
      else if (!ctl && fallback.hidden) run();
    } else if (!restaurantsOnly) renderList(searchLandmarks(""), t("ps.landmarks"));
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (list.hidden) return;
      e.preventDefault();
      const n = results.length;
      setActive(e.key === "ArrowDown" ? (active + 1) % n : (active < 0 ? n - 1 : (active - 1 + n) % n));
    } else if (e.key === "Enter") {
      if (!list.hidden && active >= 0) {
        e.preventDefault();
        choose(results[active]);
      } else if (!list.hidden && results.length === 1) {
        e.preventDefault();
        choose(results[0]);
      } else if (!selected) {
        setStatus(t("ps.mustPick"));
        e.preventDefault();
      }
    } else if (e.key === "Escape" && !list.hidden) {
      e.stopPropagation();
      hide();
    }
  });
  list.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the input
  list.addEventListener("click", (e) => {
    const li = e.target.closest("[data-i]");
    if (li) choose(results[+li.dataset.i]);
  });
  input.addEventListener("blur", () => setTimeout(hide, 120));

  return {
    input,
    get value() {
      return selected;
    },
    set(place) {
      if (place) choose(place);
    },
    clear() {
      run.cancel();
      resetRequest();
      selected = null;
      input.value = "";
      chosen.hidden = true;
      hide();
    },
  };
}
