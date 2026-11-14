// Map tab: search a place or use your location, see restaurants and open tables nearby,
// then open Google Maps (ratings, reviews, hours) or transit / walking / driving directions on the phone.
import { esc, qs, qsa, haversineKm, fmtWhen, googleEmbedUrl, mapsUrl } from "../util.js";
import { t } from "../i18n.js";
import { state } from "../state.js";
import { api } from "../api.js";
import { currentPosition, locationPermission, restaurantsNear } from "../geo.js";
import { placeSearchHTML, bindPlaceSearch, toast, announce, venueAttributionHTML } from "../ui.js";
import { mountGroupMap } from "../group-map.js";
import { mapActionsHTML, nameOf, showError, go, tableTitle, placeText, cuisineGroupsHTML } from "./common.js";

const km = (n) => (n < 10 ? n.toFixed(1) : String(Math.round(n)));

export async function render(root) {
  let alive = true;
  let ctl = null;
  let centerRevision = 0;
  let cuisine = state.mapCuisine || "";
  const areaC = () => {
    const a = state.areas.find((x) => x.id === state.me?.area_id) || state.areas[0];
    const d = window.TB_CONFIG?.DEFAULT_CENTER || { lat: 43.6532, lng: -79.3832 };
    return a ? { lat: Number(a.center_lat), lng: Number(a.center_lng), label: nameOf(a) } : { ...d, label: "Toronto" };
  };
  let center = state.mapCenter || (state.pos ? { lat: state.pos.lat, lng: state.pos.lng, label: t("map.here") } : areaC());

  const ps = placeSearchHTML({ label: t("map.search"), placeholder: t("map.searchPh"), hint: t("map.searchHint") });
  root.innerHTML = `
    <h1>${esc(t("map.title"))}</h1>
    <p class="muted">${esc(t("map.sub"))}</p>
    ${ps.html}
    <div class="row wrap-row"><button type="button" class="btn sm" id="use-me">📍 ${esc(t("map.useMe"))}</button></div>
    <p class="hint loc-status" id="loc-status" role="status" aria-live="polite"></p>
    <div class="map-center" id="center"></div>
    <div class="cuisine-groups" id="cuis" role="group" aria-label="${esc(t("map.cuisine"))}">
      ${cuisineGroupsHTML({ attr: "c", isOn: (s) => cuisine === s, any: `<button type="button" class="chip" data-c="" aria-pressed="${cuisine === ""}">${esc(t("map.anyCuisine"))}</button>` })}
    </div>
    <section class="card" style="margin-top:16px"><h2>${esc(t("map.mapView"))}</h2><div id="gmap"></div></section>
    <section class="card" style="margin-top:16px"><h2>${esc(t("map.tables"))}</h2><div id="tbl"></div></section>
    <section class="card" style="margin-top:16px"><h2>${esc(t("map.restaurants"))}</h2><div id="rest" aria-live="polite"></div></section>`;

  const distLine = (p) => {
    const parts = [];
    if (p.dist != null) parts.push(t("map.kmFromPlace", { km: km(p.dist), name: center.label || t("map.here") }));
    return parts.join(" · ");
  };

  const isHere = () => center.label === t("map.here");
  // Directions always start from the place the person picked (typed address or "my location"), never from some other position.
  const fromHere = () => ({ origin: { lat: center.lat, lng: center.lng }, originName: center.label || "", hint: false });
  function paintCenter() {
    qs("#center", root).innerHTML = `<strong>📌 ${esc(t("map.near", { name: center.label || "" }))}</strong>`;
  }

  function googleQuery() {
    const c = state.cuisines.find((x) => x.slug === cuisine);
    return `${c ? c.name_en + " " : ""}restaurants near ${center.lat.toFixed(5)},${center.lng.toFixed(5)}`;
  }

  // ---- map: "me" at the picked place + numbered restaurants (closest first)
  let restList = [];
  let picked = -1;
  let groupMap = null;
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
      fallbackCenter: center,
      labels: {},
    };
  }
  function ensureMap() {
    if (mapPromise) return mapPromise;
    qs("#gmap", root).innerHTML = `<div class="gmap-frame group-map" id="map-leaflet"></div>
      <p class="hint">${esc(t("map.mapLegend"))}</p><div id="pick-card"></div>`;
    mapPromise = mountGroupMap(qs("#map-leaflet", root), mapData()).then((c) => {
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
    groupMap?.select(picked);
    qsa("#rest .place-row[data-ri]", root).forEach((row) => row.classList.toggle("chosen", Number(row.dataset.ri) === picked));
    const box = qs("#pick-card", root);
    const r = restList[picked];
    if (!box) return;
    if (!r) {
      box.innerHTML = "";
      return;
    }
    const q = [r.name, r.address || "Toronto"].filter(Boolean).join(", ");
    box.innerHTML = `<div class="pick-card">
      <div class="pick-head"><strong>${picked + 1}. ${esc(r.name)}</strong><small class="muted">${esc([r.address, distLine({ dist: r.distKm, lat: r.lat, lng: r.lng })].filter(Boolean).join(" · "))}</small></div>
      <div class="gmap-frame pick-frame"><iframe title="${esc(r.name)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen src="${esc(googleEmbedUrl(q, 16, r))}"></iframe></div>
      <div class="row wrap-row" style="margin-bottom:6px"><button type="button" class="btn sm primary" data-host="${picked}">🍽️ ${esc(t("map.hostHere"))}</button></div>
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
      center = { lat: pos.lat, lng: pos.lng, label: t("map.here") };
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
      const found = await restaurantsNear(center, cuisine || undefined, { signal: request.signal });
      if (!alive || request.signal.aborted) return;
      const list = [...found].sort((a, b) => (a.distKm ?? 1e9) - (b.distKm ?? 1e9));
      restList = list;
      box.innerHTML = list.length
        ? list
            .map((r, i) => `<div class="place-row" data-ri="${i}" tabindex="0" role="button" style="cursor:pointer"><h3>${i < 10 ? `${i + 1}. ` : ""}${esc(r.name)}</h3>
              <div class="sub">${esc(r.address || "")}${r.address ? " · " : ""}${esc(distLine({ dist: r.distKm, lat: r.lat, lng: r.lng }))}</div>
              <div class="row wrap-row" style="margin:8px 0 4px"><button type="button" class="btn sm primary" data-host="${i}">🍽️ ${esc(t("map.hostHere"))}</button></div>
              ${mapActionsHTML(r, fromHere())}</div>`)
            .join("") + `<p class="hint">${list[0].source === "toronto" ? venueAttributionHTML() : esc(t("map.restNote"))}</p>`
        : restaurantFallback("map.noRestaurants");
      paintMap();
      announce(t("map.found", { n: list.length }));
    } catch (e) {
      if (!alive || request.signal.aborted) return;
      box.innerHTML = restaurantFallback("map.loadError") +
        ` <button type="button" class="btn sm" id="rest-retry">${esc(t("map.retry"))}</button>`;
      qs("#rest-retry", box).addEventListener("click", loadRestaurants);
    }
  }

  function restaurantFallback(key) {
    return `<p class="muted">${esc(t(key))}</p>
      <a class="btn sm" href="${esc(mapsUrl({ name: googleQuery() }))}" target="_blank" rel="noopener">${esc(t("map.openGoogle"))}</a>`;
  }

  function refresh() {
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
      center = { lat: p.lat, lng: p.lng, label: p.name };
      state.mapCenter = center;
      refresh();
    },
    onClear: () => {},
  });
  qs("#use-me", root).addEventListener("click", () => locate());
  qs("#cuis", root).addEventListener("click", (e) => {
    const b = e.target.closest("[data-c]");
    if (!b) return;
    cuisine = state.mapCuisine = b.dataset.c;
    qsa("[data-c]", root).forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.c === cuisine)));
    loadRestaurants();
  });
  // "Host a table here": open the Host-a-table sheet with this restaurant already chosen
  function hostHere(r) {
    if (!r) return;
    const areas = state.areas.filter((a) => a.center_lat != null && a.center_lng != null);
    const nearest = areas
      .map((a) => ({ id: a.id, d: haversineKm({ lat: r.lat, lng: r.lng }, { lat: Number(a.center_lat), lng: Number(a.center_lng) }) }))
      .sort((x, y) => x.d - y.d)[0];
    state.createPrefill = {
      place: { name: r.name, address: r.address || "", lat: r.lat, lng: r.lng, poi_id: r.poi_id || null },
      cuisine: cuisine || "",
      area_id: nearest?.id || "",
    };
    go("#new");
  }
  for (const box of [qs("#rest", root), qs("#gmap", root)]) {
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-host]");
      if (b) hostHere(restList[Number(b.dataset.host)]);
    });
  }
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
  if (state.pos && !state.mapCenter) {
    center = { lat: state.pos.lat, lng: state.pos.lng, label: t("map.here") };
    state.mapCenter = center;
    setLoc("map.located");
    refresh();
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
  };
}
