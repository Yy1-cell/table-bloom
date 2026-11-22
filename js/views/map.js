// Map tab: search a place or use your location, see restaurants and open tables nearby,
// then open Google Maps (ratings, reviews, hours) or transit / walking / driving directions on the phone.
import { esc, qs, qsa, haversineKm, fmtWhen, googleEmbedUrl, mapsUrl } from "../util.js";
import { t } from "../i18n.js";
import { state } from "../state.js";
import { api } from "../api.js";
import { currentPosition, locationPermission, restaurantsForKeys, reverseGeocode } from "../geo.js";
import { effectiveLoc, setLoc as saveLoc } from "../location.js";
import { placeSearchHTML, bindPlaceSearch, toast, announce, venueAttributionHTML } from "../ui.js";
import { mountMap } from "../maps.js";
import { mapActionsHTML, nameOf, showError, go, tableTitle, placeText } from "./common.js";
import { mountMenuPicker, menuItem, isFormat } from "./menu-picker.js";
import { searchWord } from "../data.js";
import { currencyFor, budgetRange } from "../currency.js";
import { fmtMoney } from "../util.js";
import { allergyReminderHTML } from "./diet.js";

const km = (n) => (n < 10 ? n.toFixed(1) : String(Math.round(n)));

// While a Host-a-table form is waiting for a restaurant, the Map's host buttons hand the place back to that form.
const picking = () => !!state.createDraft;
const hostLabel = () => t(picking() ? "map.useForTable" : "map.hostHere");

export async function render(root) {
  let alive = true;
  let ctl = null;
  let centerRevision = 0;
  // Up to three picks (cuisines and/or formats); an older single string in state is carried over.
  let picks = Array.isArray(state.mapCuisines) ? [...state.mapCuisines] : state.mapCuisine ? [state.mapCuisine] : [];
  // Start from the place I picked (or the old home area); with neither, show a default city until "Use my location" is tapped.
  const areaC = () => {
    const l = effectiveLoc();
    if (l) return { lat: l.lat, lng: l.lng, label: l.label || t("map.here") };
    const d = window.TB_CONFIG?.DEFAULT_CENTER || { lat: 43.6532, lng: -79.3832 };
    return { ...d, label: "", isDefault: true };
  };
  let center = state.mapCenter || areaC();

  const ps = placeSearchHTML({ label: t("map.search"), placeholder: t("map.searchPh"), hint: t("map.searchHint") });
  root.innerHTML = `
    ${picking() ? `<div class="notice pick-banner" id="pick-banner">🍽️ ${esc(t("map.pickBanner"))}
      <div class="row wrap-row" style="margin-top:8px"><button type="button" class="btn sm" id="back-to-table">← ${esc(t("map.backToTable"))}</button></div></div>` : ""}
    <h1>${esc(t("map.title"))}</h1>
    <p class="muted">${esc(t("map.sub"))}</p>
    ${ps.html}
    <div class="row wrap-row"><button type="button" class="btn sm" id="use-me">📍 ${esc(t("map.useMe"))}</button></div>
    <p class="hint loc-status" id="loc-status" role="status" aria-live="polite"></p>
    <div class="map-bar" aria-label="${esc(t("map.barLabel"))}">
      <div class="map-center" id="center"></div>
      <details class="cuis-details" id="cuis-wrap" ${window.innerWidth >= 820 ? "open" : ""}>
        <summary id="cuis-sum"></summary>
        <div id="cuis" role="group" aria-label="${esc(t("map.cuisine"))}"></div>
      </details>
      <div class="budget-row" id="budget-row" role="group" aria-label="${esc(t("map.budget"))}"></div>
    </div>
    <div id="allergy"></div>
    <section class="card page-section"><h2>🗺️ ${esc(t("map.gTitle"))}</h2>
      <p class="hint">${esc(t("map.gHint"))}</p>
      <div class="gmap-frame" id="gsearch"></div>
      <div class="row wrap-row" style="margin-top:8px">
        <a class="btn sm" id="gmaps-link" href="#" target="_blank" rel="noopener">🗺️ ${esc(t("map.googleBtn"))}</a>
        ${picking() ? "" : `<button type="button" class="btn sm primary" id="host-near">🍽️ ${esc(t("map.hostNear"))}</button>`}
      </div>
      <p class="hint">${esc(t(picking() ? "map.pickGoogleHint" : "map.hostNearHint"))}</p>
      <div id="spot-card"></div><div id="pick-card"></div></section>
    <section class="card page-section"><h2>${esc(t("map.tables"))}</h2><div id="tbl"></div></section>
    <details class="card built page-section" id="built" ${window.innerWidth >= 820 || picking() ? "open" : ""}>
      <summary><strong id="built-title">${esc(t("map.builtIn"))}</strong> <span class="muted" id="built-n"></span></summary>
      <div id="gmap" style="margin-top:10px"></div>
      <p class="hint">${esc(t("map.listNote"))}</p><div id="rest" aria-live="polite"></div></details>`;

  const distLine = (p) => {
    const parts = [];
    if (p.dist != null) parts.push(t("map.kmFromPlace", { km: km(p.dist), name: center.label || t("map.here") }));
    return parts.join(" · ");
  };

  // On phones the 30+ cuisine chips are folded away so the map and the list stay near the top.
  function paintCuisineSummary() {
    const items = picks.map(menuItem).filter(Boolean);
    qs("#cuis-sum", root).textContent = `🍽️ ${t("map.cuisine")}: ${items.length ? items.map((c) => `${c.emoji} ${c.name}`).join(" + ") : t("map.anyCuisine")}`;
  }
  paintCuisineSummary();

  // Budget is picked per meal. Tiers are in the local currency of the place; they filter open tables and pre-fill "host a table".
  // (Restaurants from the free map data carry no prices, so this does not filter them.)
  const cur = () => currencyFor(center.isDefault ? null : center);
  const tiers = () => {
    const h = budgetRange(cur()).hint;
    return [0.5, 1, 2].map((m) => Math.round(h * m) * 100);
  };
  function paintBudget() {
    const row = qs("#budget-row", root);
    const sel = state.mapBudget ?? null;
    row.innerHTML = `<span class="diet-lbl">💵 ${esc(t("map.budget"))}</span>` +
      [`<button type="button" class="chip sm" data-b="" aria-pressed="${sel == null}">${esc(t("map.anyBudget"))}</button>`,
        ...tiers().map((c) => `<button type="button" class="chip sm" data-b="${c}" aria-pressed="${sel === c}">≤ ${esc(fmtMoney(c, cur()))}</button>`)].join("");
  }
  paintBudget();
  qs("#budget-row", root).addEventListener("click", (e) => {
    const b = e.target.closest("[data-b]");
    if (!b) return;
    state.mapBudget = b.dataset.b === "" ? null : Number(b.dataset.b);
    paintBudget();
    loadTables();
  });
  function paintAllergy() {
    qs("#allergy", root).innerHTML = allergyReminderHTML([{ name: "", tags: state.me?.dietary_tags || [] }]);
  }
  paintAllergy();
  let mapDirty = false;
  qs("#built", root).addEventListener("toggle", () => {
    if (qs("#built", root).open && mapDirty) {
      mapDirty = false;
      paintMap();
    }
  });
  const isHere = () => center.label === t("map.here");
  // Directions always start from the place the person picked (typed address or "my location"), never from some other position.
  const fromHere = () => ({ origin: { lat: center.lat, lng: center.lng }, originName: center.label || "", hint: false });
  function paintCenter() {
    qs("#center", root).innerHTML = `<strong>📌 ${esc(t("map.near", { name: center.label || "" }))}</strong>`;
  }

  function googleQuery() {
    const word = picks.map(searchWord).filter(Boolean).join(" ");
    return `${word ? word + " " : ""}restaurants near ${center.lat.toFixed(5)},${center.lng.toFixed(5)}`;
  }

  // ---- map: "me" at the picked place + numbered restaurants (closest first)
  let restList = [];
  let picked = -1;
  let groupMap = null;
  let g = null; // Google JS map controller (only when the key + allowance + loading all work)
  let gTried = false;
  let gFailed = false;
  const live = () => g || groupMap;
  let mapPromise = null;
  let mapFailed = false;
  const meName = () => t("map.mePin", { name: center.label || t("map.here") });
  function mapData() {
    return {
      people: [{ name: meName(), avatar: state.me?.avatar_emoji || "📍", lat: center.lat, lng: center.lng }],
      middle: null,
      venue: null,
      suggestions: restList,
      onPick: choose,
      onSpot: handleSpot,
      fallbackCenter: center,
      labels: {},
    };
  }
  function ensureMap() {
    if (mapPromise) return mapPromise;
    qs("#gmap", root).innerHTML = `<div class="gmap-frame group-map" id="map-leaflet"></div>
      <p class="hint">${esc(t("map.mapLegend"))}</p>`;
    mapPromise = mountMap(qs("#map-leaflet", root), mapData(), { google: false }).then((c) => {
      if (!alive) {
        c?.destroy();
        return null;
      }
      if (!c) {
        mapFailed = true;
        mapPromise = null;
        paintGoogle();
        return null;
      }
      groupMap = c;
      return c;
    });
    return mapPromise;
  }
  async function paintMap() {
    if (g) {
      g.update(mapData());
      return;
    }
    if (gTried && !gFailed) return; // Google is still being decided: do not start the free map yet
    if (!qs("#built", root).open) {
      mapDirty = true;
      return;
    }
    if (mapFailed) return paintGoogle();
    if (navigator.onLine === false && !groupMap) {
      qs("#gmap", root).innerHTML = `<p class="muted">${esc(t("map.offlineMap"))}</p>`;
      return;
    }
    const c = await ensureMap();
    if (alive && c) c.update(mapData());
  }
  function choose(i) {
    picked = picked === i ? -1 : i;
    live()?.select(picked);
    qsa("#rest .place-row[data-ri]", root).forEach((row) => row.classList.toggle("chosen", Number(row.dataset.ri) === picked));
    const box = qs("#pick-card", root);
    const r = restList[picked];
    if (!box) return;
    if (!r) {
      box.innerHTML = "";
      return;
    }
    const q = [r.name, r.address || center.label || ""].filter(Boolean).join(", ");
    box.innerHTML = `<div class="pick-card">
      <div class="pick-head"><strong>${picked + 1}. ${esc(r.name)}</strong><small class="muted">${esc([r.address, distLine({ dist: r.distKm, lat: r.lat, lng: r.lng })].filter(Boolean).join(" · "))}</small></div>
      ${g ? "" : `<div class="gmap-frame pick-frame"><iframe title="${esc(r.name)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen src="${esc(googleEmbedUrl(q, 16, r))}"></iframe></div>`}
      <div class="row wrap-row" style="margin-bottom:6px"><button type="button" class="btn sm primary" data-host="${picked}">🍽️ ${esc(hostLabel())}</button></div>
      ${mapActionsHTML(r, { ...fromHere(), hint: true })}</div>`;
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /** Fallback only (map library could not load): the real Google Maps view around the centre. */
  function paintGoogle() {
    const box = qs("#gmap", root);
    const q = googleQuery();
    box.innerHTML = navigator.onLine === false
      ? `<p class="muted">${esc(t("map.offlineMap"))}</p>`
      : `<div class="gmap-frame"><iframe title="${esc(t("map.googleView"))}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen
           src="${esc(googleEmbedUrl(q))}"></iframe></div>
         <div class="row wrap-row" style="margin-top:8px"><a class="btn sm" target="_blank" rel="noopener" href="${esc(mapsUrl({ name: q }))}">${esc(t("map.openGoogle"))}</a></div>
         <p class="hint">${esc(t("map.googleNote"))}</p>`;
  }

  const setLoc = (key, vars) => {
    const el = qs("#loc-status", root);
    el.textContent = key ? t(key, vars) : "";
  };

  /** Ask the browser for the current position. The first call makes the browser show its permission prompt. */
  async function locate({ auto = false } = {}) {
    const b = qs("#use-me", root);
    const revision = centerRevision;
    b.disabled = true;
    setLoc("map.locating");
    try {
      const pos = await currentPosition();
      state.locTried = true;
      if (!alive) return;
      state.pos = pos;
      if (revision !== centerRevision) return;
      const geo = await reverseGeocode(pos);
      if (!alive) return;
      saveLoc({ lat: pos.lat, lng: pos.lng, label: geo.label, gps: true, cc: geo.cc });
      center = { lat: pos.lat, lng: pos.lng, label: t("map.here"), cc: geo.cc };
      state.mapCenter = center;
      setLoc("map.located");
      refresh();
    } catch (e) {
      state.locTried = true;
      if (!alive) return;
      const key = { denied: "map.locDenied", timeout: "map.locTimeout", unsupported: "map.locUnsupported" }[e.reason] || "map.locUnavailable";
      setLoc(key, { name: center.label || "" });
      if (!auto) toast(t("disc.noLocation"), { kind: "error" });
    } finally {
      b.disabled = false;
    }
  }

  async function loadTables() {
    const box = qs("#tbl", root);
    try {
      if (!state.tables?.length) state.tables = await api.listTables({});
    } catch (e) {
      box.innerHTML = `<p class="muted">${esc(t("err.load"))}</p>`;
      return;
    }
    if (!alive) return;
    const rows = state.tables
      .filter((x) => x.meet_lat != null && ["open", "full"].includes(x.status))
      .map((x) => ({ x, dist: haversineKm(center, { lat: Number(x.meet_lat), lng: Number(x.meet_lng) }) }))
      .filter((r) => r.dist <= 12)
      .filter((r) => state.mapBudget == null || r.x.budget_cents == null || r.x.budget_cents <= state.mapBudget)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 6);
    box.innerHTML = rows.length
      ? rows
          .map(({ x, dist }) => {
            const place = { name: x.venue?.name || x.area_label, address: x.venue?.address, lat: Number(x.meet_lat), lng: Number(x.meet_lng) };
            return `<div class="place-row"><h3>${esc(tableTitle(x))}</h3>
              <div class="sub">${esc(fmtWhen(x.starts_at, t))} · ${esc(placeText(x))} · ${esc(distLine({ dist, lat: place.lat, lng: place.lng }))}</div>
              <div class="row wrap-row" style="margin-top:8px"><button type="button" class="btn sm primary" data-open="${esc(x.id)}">${esc(t("map.viewTable"))}</button></div>
              ${mapActionsHTML(place, fromHere())}</div>`;
          })
          .join("")
      : `<p class="muted">${esc(t("map.noTables"))}</p>`;
    qsa("[data-open]", box).forEach((b) => b.addEventListener("click", () => go(`#t-${b.dataset.open}`)));
  }

  async function loadRestaurants() {
    const box = qs("#rest", root);
    ctl?.abort();
    const request = ctl = new AbortController();
    box.innerHTML = `<p class="muted">${esc(t("ps.searching"))}</p>`;
    restList = [];
    picked = -1;
    const pc = qs("#pick-card", root);
    if (pc) pc.innerHTML = "";
    paintMap();
    try {
      const { list: found } = await restaurantsForKeys(center, picks, { signal: request.signal, limit: 20 });
      if (!alive || request.signal.aborted) return;
      const list = [...found].sort((a, b) => (a.distKm ?? 1e9) - (b.distKm ?? 1e9));
      restList = list;
      box.innerHTML = list.length
        ? list
            .map((r, i) => `<div class="place-row" data-ri="${i}" tabindex="0" role="button" style="cursor:pointer"><h3>${i < 10 ? `${i + 1}. ` : ""}${esc(r.name)}</h3>
              <div class="sub">${esc(r.address || "")}${r.address ? " · " : ""}${esc(distLine({ dist: r.distKm, lat: r.lat, lng: r.lng }))}</div>
              <div class="row wrap-row" style="margin:8px 0 4px"><button type="button" class="btn sm primary" data-host="${i}">🍽️ ${esc(hostLabel())}</button></div>
              ${mapActionsHTML(r, fromHere())}</div>`)
            .join("") + `<p class="hint">${list[0].source === "toronto" ? venueAttributionHTML() : esc(t("map.restNote"))}</p>`
        : restaurantFallback("map.noRestaurants");
      qs("#built-n", root).textContent = `(${list.length})`;
      paintMap();
      announce(t("map.found", { n: list.length }));
    } catch (e) {
      if (!alive || request.signal.aborted) return;
      box.innerHTML = restaurantFallback("map.loadError") +
        ` <button type="button" class="btn sm" id="rest-retry">${esc(t("map.retry"))}</button>`;
      qs("#rest-retry", box).addEventListener("click", loadRestaurants);
    }
  }

  // Google map: the person tapped a spot (or one of Google's own places). Offer to host there; the name is typed or pre-filled
  // from the nearest restaurant in our free data (Google's place details are not read, so nothing extra is billed).
  let spotSeq = 0;
  async function handleSpot(sp) {
    const box = qs("#spot-card", root);
    if (!box) return;
    const seq = ++spotSeq;
    box.innerHTML = `<div class="pick-card"><p class="muted">${esc(t("ps.searching"))}</p></div>`;
    let near = restList.map((r) => ({ r, d: haversineKm(sp, r) })).filter((x) => x.d <= 0.08).sort((a, b) => a.d - b.d)[0]?.r || null;
    try {
      if (!near) {
        const { list } = await restaurantsForKeys(sp, [], { radius: 120, limit: 3 });
        near = list.filter((x) => haversineKm(sp, x) <= 0.08).sort((a, b) => a.distKm - b.distKm)[0] || null;
      }
    } catch {}
    let geo = null;
    if (!near) geo = await reverseGeocode(sp).catch(() => null);
    if (!alive || seq !== spotSeq) return;
    const spotPlace = { name: near?.name || "", address: near?.address || geo?.label || "", lat: sp.lat, lng: sp.lng, poi_id: near?.poi_id || null, cc: near?.cc || geo?.cc || center.cc };
    box.innerHTML = `<div class="pick-card" id="spot-form">
      <div class="pick-head"><strong>📍 ${esc(t("map.spotTitle"))}</strong>${spotPlace.address ? `<small class="muted">${esc(spotPlace.address)}</small>` : ""}</div>
      <div class="field" style="margin:8px 0"><label for="spot-name">${esc(t("map.spotName"))}</label>
        <input id="spot-name" type="text" maxlength="80" value="${esc(spotPlace.name)}" placeholder="${esc(t("map.spotNamePh"))}"></div>
      <p class="hint" style="margin:0 0 8px">${esc(t("map.spotHint"))}</p>
      <div class="row wrap-row"><button type="button" class="btn sm primary" id="spot-host">🍽️ ${esc(hostLabel())}</button>
        <button type="button" class="btn sm ghost" id="spot-clear">${esc(t("common.cancel"))}</button>
        ${mapActionsHTML({ name: spotPlace.name || "", address: spotPlace.address, lat: sp.lat, lng: sp.lng }, { ...fromHere(), hint: false })}</div></div>`;
    qs("#spot-host", box).addEventListener("click", () => {
      const name = qs("#spot-name", box).value.trim();
      if (!name) {
        qs("#spot-name", box).focus();
        return toast(t("map.spotNeedName"), { kind: "error" });
      }
      hostHere({ ...spotPlace, name });
    });
    qs("#spot-clear", box).addEventListener("click", () => {
      box.innerHTML = "";
      g?.clearSpot();
    });
  }

  function restaurantFallback(key) {
    return `<p class="muted">${esc(t(key))}</p>
      <a class="btn sm" href="${esc(mapsUrl({ name: googleQuery() }))}" target="_blank" rel="noopener">${esc(t("map.openGoogle"))}</a>`;
  }

  // The real Google map around the picked place, searching for what was chosen. Nothing is read back from it.
  let gKey = "";
  function drawEmbed() {
    const box = qs("#gsearch", root);
    if (!box) return;
    const key = googleQuery();
    if (key === gKey && box.querySelector("iframe")) return;
    gKey = key;
    box.innerHTML = navigator.onLine === false
      ? `<p class="muted">${esc(t("map.offlineMap"))}</p>`
      : `<iframe title="${esc(t("map.googleView"))}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen src="${esc(googleEmbedUrl(key, 14, center))}"></iframe>`;
  }
  // First call decides: a real Google map (key + free allowance + it loads) or the keyless Google embed.
  async function startGoogle() {
    const box = qs("#gsearch", root);
    box.textContent = "";
    const c = await mountMap(box, mapData(), { fallback: false });
    if (!alive) return c?.destroy();
    if (!c) {
      gFailed = true;
      drawEmbed();
      return paintMap();
    }
    g = c;
    root.classList.add("g-mode");
    qs("#built-title", root).textContent = t("map.listOnly");
    c.onSwap(() => {
      g = null;
      gFailed = true;
      root.classList.remove("g-mode");
      qs("#built-title", root).textContent = t("map.builtIn");
      drawEmbed();
      paintMap();
    });
    c.update(mapData());
  }
  function paintGoogleLink() {
    const a = qs("#gmaps-link", root);
    if (a) a.href = mapsUrl({ name: googleQuery() });
    if (!qs("#gsearch", root)) return;
    if (!gTried) {
      gTried = true;
      startGoogle();
    } else if (g) g.update(mapData());
    else if (gFailed) drawEmbed();
  }
  function refresh() {
    if (center.isDefault) {
      // No place yet: show nothing from another city.
      for (const id of ["#center", "#tbl", "#rest", "#gmap", "#gsearch", "#built-n"]) { const el = qs(id, root); if (el) el.innerHTML = ""; }
      return;
    }
    if (state.mapBudget != null && !tiers().includes(state.mapBudget)) state.mapBudget = null;
    paintBudget();
    paintGoogleLink();
    paintCenter();
    loadTables();
    loadRestaurants();
  }

  bindPlaceSearch(root, {
    id: ps.id,
    near: () => center,
    googleSearch: true,
    onSelect: (p) => {
      centerRevision++;
      center = { lat: p.lat, lng: p.lng, label: p.name, cc: p.cc };
      state.mapCenter = center;
      refresh();
    },
    onClear: () => {},
  });
  qs("#use-me", root).addEventListener("click", () => locate());
  mountMenuPicker(qs("#cuis", root), {
    value: picks,
    multi: true,
    max: 3,
    formats: true,
    anyLabel: t("map.anyCuisine"),
    onLimit: () => toast(t("map.pickMax"), { kind: "error" }),
    onChange: (v) => {
      picks = state.mapCuisines = v;
      paintCuisineSummary();
      paintGoogleLink();
      loadRestaurants();
    },
  });
  // "Host a table here": open the Host-a-table sheet with this restaurant already chosen
  function hostHere(r) {
    const at = r || center; // no restaurant chosen: just host somewhere around the picked place
    state.createPrefill = {
      place: r ? { name: r.name, address: r.address || "", lat: r.lat, lng: r.lng, poi_id: r.poi_id || null } : null,
      budget: state.mapBudget ?? null,
      cuisines: picks.filter((k) => !isFormat(k)),
      formats: picks.filter(isFormat),
      base: center.isDefault ? null : { lat: at.lat, lng: at.lng, label: center.label || "", cc: r?.cc || center.cc },
    };
    if (state.createDraft) state.createPrefill.draft = state.createDraft;
    go("#new");
  }
  for (const box of [qs("#rest", root), qs("#gmap", root), qs("#pick-card", root)]) {
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-host]");
      if (b) hostHere(restList[Number(b.dataset.host)]);
    });
  }
  qs("#host-near", root)?.addEventListener("click", () => hostHere(null));
  // Back to the half-filled form without choosing anything here.
  qs("#back-to-table", root)?.addEventListener("click", () => {
    state.createPrefill = { draft: state.createDraft };
    go("#new");
  });
  // tap a restaurant row (not its buttons) to see it on the map
  qs("#rest", root).addEventListener("click", (e) => {
    if (e.target.closest("a, button")) return;
    const row = e.target.closest("[data-ri]");
    if (row) choose(Number(row.dataset.ri));
  });
  qs("#rest", root).addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest?.("[data-ri]");
    if (row && e.target === row) {
      e.preventDefault();
      choose(Number(row.dataset.ri));
    }
  });

  refresh();
  // Automatic positioning: the first time the Map tab opens (and the person has not searched for something else),
  // ask the browser for the current position. If permission was already granted this is silent.
  if (center.isDefault && !state.mapCenter) setLoc("map.defaultHint", { name: center.label });
  if (!state.mapCenter && effectiveLoc()) {
    setLoc("");
  } else if (!state.mapCenter && !state.locTried) {
    locationPermission().then((perm) => {
      if (!alive) return;
      if (perm === "denied") {
        state.locTried = true;
        setLoc("map.locDenied", { name: center.label || "" });
      } else if (perm === "unsupported") {
        setLoc("map.locUnsupported");
      } else if (perm === "granted" && centerRevision === 0) locate({ auto: true });
    });
  } else if (isHere()) setLoc("map.located");
  return () => {
    alive = false;
    ctl?.abort();
    groupMap?.destroy();
    g?.destroy();
  };
}
