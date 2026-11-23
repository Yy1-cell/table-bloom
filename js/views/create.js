// "Host a table" — 2-step wizard in a sheet. Only the essentials are shown; everything optional sits in a folded "More options".
import { esc, qs, qsa, todayStr, toISO, pad, midpoint, haversineKm, mapsUrl } from "../util.js";
import { t } from "../i18n.js";
import { state, bus } from "../state.js";
import { api } from "../api.js";
import { openSheet, closeSheet, toast, placeSearchHTML, bindPlaceSearch } from "../ui.js";
import { AUDIENCES, TAGS, OCCASIONS, FORMATS, VENUE_TYPES, MAX_FORMATS, formatsForMany, searchKeys } from "../data.js";
import { go, nameOf, showError, withBusy, mapActionsHTML, orList } from "./common.js";
import { effectiveLoc } from "../location.js";
import { currencyFor, budgetRange } from "../currency.js";
import { mountLocPicker } from "./loc-picker.js";
import { mountMenuPicker, menuItem, isFormat } from "./menu-picker.js";
import { restaurantsForKeys, currentPosition } from "../geo.js";
import { nameMatchesKey } from "../toronto-venues.js";
import { publicLabel } from "../place-names.js";
import { allergyReminderHTML } from "./diet.js";

export function openCreate({ onClose } = {}) {
  // The Map tab can hand over a restaurant the person already found ("Host a table here").
  const pre = state.createPrefill;
  state.createPrefill = null;
  // Coming back from "Pick on the map" (or opening Host again after leaving for the Map): pick up the form where it was.
  const draft = pre?.draft || state.createDraft;
  state.createDraft = null;
  const d = {
    title: "",
    audience: "friends_and_new",
    cuisines: (pre?.cuisines?.length ? pre.cuisines : pre?.cuisine ? [pre.cuisine] : []).filter((k) => !isFormat(k)).slice(0, 3), // up to 3; the first is the main one
    formats: (pre?.formats || (pre?.cuisine ? [pre.cuisine] : [])).filter(isFormat).slice(0, MAX_FORMATS),
    vtype: "",
    craving: undefined, // friends tables: what I feel like eating (a cuisine or a format); starts from the table's own choice
    capacity: 4,
    join_mode: "request",
    date: todayStr(),
    time: "18:30",
    base: pre?.base || null, // the area this table is around (search centre, and where a table without a restaurant sits)
    place: pre?.place || null,
    area_label: "",
    budget: pre?.budget != null ? String(Math.round(pre.budget / 100)) : "", // chosen per meal on the Map, not stored on the profile
    tags: [],
    occasion: "",
    note: "",
    // Only used to suggest restaurants. Never sent to the server.
    startMe: null,
  };
  // "Pick on the map": keep the form, show the Map with this table's cuisine and area, and come back with the place.
  function pickOnMap() {
    readStep();
    stopSuggest();
    state.createDraft = { d: { ...d }, step };
    state.mapCuisines = [...d.cuisines, ...d.formats].slice(0, 3);
    const from = d.startMe || baseLoc();
    if (from) state.mapCenter = { lat: from.lat, lng: from.lng, label: from.label || from.name || "", cc: from.cc };
    sheet.onClose = null;
    closeSheet({ silent: true });
    go("#map");
  }

  // One restaurant has one cuisine: once a place is chosen, the cuisine (and how-we-eat) follow the place.
  // `hint` is the key the place was suggested for, if any.
  function fitToPlace(place, hint) {
    if (!place) return;
    const name = place.name || "";
    const fits = (k) => k === hint || nameMatchesKey(name, k);
    const kept = d.cuisines.filter(fits);
    if (kept.length) d.cuisines = [kept[kept.length - 1]];
    else if (hint && !isFormat(hint) && !["cafe", "bar"].includes(hint)) d.cuisines = [hint];
    else d.cuisines = d.cuisines.slice(0, 1);
    const ok = formatsForMany(d.cuisines);
    d.formats = FORMATS.map((f) => f.slug).filter((f) => ok.includes(f) && fits(f)).slice(0, MAX_FORMATS);
  }
  let step = 1;
  if (draft) {
    Object.assign(d, draft.d);
    if (pre?.place) d.place = pre.place;
    if (pre?.base && !d.base) d.base = pre.base;
    step = draft.step || 2;
  }
  if (pre?.place) fitToPlace(pre.place);

  const STEPS = 2;
  // Folded "More options" boxes start open only if something in them is already filled (e.g. handed over from the Map).
  const more = { 1: false, 2: false };
  let sug = null; // null | "loading" | "error" | "need-starts" | { list, mode }
  let sugSeq = 0;
  let sugCtl = null;
  let sugTimer = null;
  const isFriends = () => d.audience === "friends";
  const sheet = openSheet({ label: t("cr.label"), className: "sheet-create", html: "", onClose });
  const baseLoc = () => d.base || effectiveLoc();
  // Priced in the currency of the place (the chosen restaurant if it knows its country, otherwise the area).
  const tableCurrency = () => currencyFor(d.place?.cc ? d.place : baseLoc());
  const areaCenter = () => {
    const a = baseLoc();
    return a ? { lat: a.lat, lng: a.lng } : undefined;
  };

  function stepper() {
    return `<div class="steps" role="img" aria-label="${esc(t("cr.stepOf", { n: step, total: STEPS }))}">${[1, 2].map((i) => `<i class="${i <= step ? "on" : ""}"></i>`).join("")}</div>`;
  }

  // Only the formats that fit the chosen cuisine are offered (no dim sum with Japanese); anything that no longer fits is dropped.
  function formatChipsHTML() {
    const ok = formatsForMany(d.cuisines);
    d.formats = d.formats.filter((f) => ok.includes(f));
    return FORMATS.filter((f) => ok.includes(f.slug))
      .map((f) => `<button type="button" class="chip" data-fmt="${f.slug}" aria-pressed="${d.formats.includes(f.slug)}"><span aria-hidden="true">${f.emoji}</span> ${esc(t("fm." + f.slug))}</button>`)
      .join("");
  }

  function draw() {
    let body = "";
    if (step === 1) {
      const kindOpen = more[1] || !!((isFriends() && d.occasion) || d.tags.length);
      body = `
        <h2>${esc(t("cr.s1"))}</h2>
        ${d.place ? `<div class="notice" id="c-hostat">📍 ${esc(t("cr.hostingAt", { name: d.place.name }))}</div>` : ""}
        <fieldset><legend>${esc(t("cr.audience"))}</legend><div class="seg">
          ${AUDIENCES.map((a) => `<label><input type="radio" name="aud" value="${a}" ${d.audience === a ? "checked" : ""}><span>${esc(t("aud." + a))}<small>${esc(t("audHint." + a))}</small></span></label>`).join("")}
        </div></fieldset>
        <p class="notice" id="f-priv" ${isFriends() ? "" : "hidden"}>🔒 ${esc(t("cr.privateHint"))}</p>
        <fieldset id="f-jm" ${isFriends() ? "hidden" : ""}><legend>${esc(t("cr.joinMode"))}</legend><div class="seg">
          ${["request", "instant"].map((m) => `<label><input type="radio" name="jm" value="${m}" ${d.join_mode === m ? "checked" : ""}><span>${esc(t("jm." + m))}<small>${esc(t("jmHint." + m))}</small></span></label>`).join("")}
        </div></fieldset>
        <fieldset id="f-cuis" ${isFriends() ? "hidden" : ""}><legend>${esc(t("cr.cuisine"))} <span class="muted">(${esc(t("cr.cuisineMax", { n: 3 }))})</span></legend><div id="c-menu"></div></fieldset>
        <p class="notice" id="f-cuis-friends" ${isFriends() ? "" : "hidden"}>🍽️ ${esc(t("cr.friendsCuisine"))}</p>
        <div class="field"><label id="cap-l">${esc(t("cr.capacity"))}</label>
          <div class="stepper" role="group" aria-labelledby="cap-l"><button type="button" data-cap="-1" aria-label="${esc(t("cr.fewer"))}">−</button><output id="cap-v" aria-live="polite">${d.capacity}</output><button type="button" data-cap="1" aria-label="${esc(t("cr.more"))}">＋</button></div>
          <p class="hint">${esc(t("cr.capacityHint"))}</p></div>
        <details class="more" id="c-more" ${kindOpen ? "open" : ""}><summary>${esc(t("cr.kind"))} <span class="muted">(${esc(t("common.optional"))})</span></summary>
          <div class="chips" id="c-kind">
            <span id="c-occs" style="display:${isFriends() ? "contents" : "none"}">${OCCASIONS.map((o) => `<button type="button" class="chip" data-occ="${o.slug}" aria-pressed="${d.occasion === o.slug}"><span aria-hidden="true">${o.emoji}</span> ${esc(t("oc." + o.slug))}</button>`).join("")}</span>
            ${TAGS.map((g) => `<button type="button" class="chip" data-tag="${g}" aria-pressed="${d.tags.includes(g)}">${esc(t("tag." + g))}</button>`).join("")}
          </div>
          <p class="hint" style="margin:8px 0 0">${esc(t("cr.kindHint"))}</p>
        </details>`;
    } else if (step === 2) {
      const ids = (draw._ids = {});
      const mk = (key, label, placeholder, hint) => {
        const ps = placeSearchHTML({ label, placeholder, hint });
        ids[key] = ps.id;
        return ps.html;
      };
      if (d.craving === undefined) d.craving = "";
      // Once the restaurant is chosen, "what do you feel like eating" no longer matters (it only helps pick a place), so it hides;
      // where you start from stays (you may leave from school, not home; it is used for directions and fair distances).
      const startBlock = isFriends()
        ? `<div class="section-lite" id="c-start">
            <h3>${esc(t("cr.pairTitle"))}</h3>
            <p class="hint">${esc(t("cr.pairHint"))}</p>
            ${mk("me", t("cr.startMe"), t("cr.startPh"), t("cr.startHint"))}
            <div class="row wrap-row"><button type="button" class="btn sm" data-locate>${esc(t("cr.useLocation"))}</button></div>
            <fieldset id="c-crave-f"${d.place ? " hidden" : ""}><legend>${esc(t("cr.myCraving"))}</legend><div id="c-craving"></div></fieldset>
          </div>`
        : `<div class="section-lite" id="c-start">
            ${mk("me", t("cr.startMeOpt"), t("cr.startPh"), t("cr.startHint"))}
            <div class="row wrap-row"><button type="button" class="btn sm" data-locate>${esc(t("cr.useLocation"))}</button></div>
          </div>`;
      // Friends tables: nobody picks the restaurant up front. Friends join first, share where they start
      // and what they feel like eating, then everyone picks the place together on the table page.
      const venueBlock = isFriends()
        ? (d.place
            ? `<div class="notice" id="c-later">📍 ${esc(t("cr.friendsStartWith", { name: d.place.name }))}${d.place.address ? ` · ${esc(d.place.address)}` : ""} <button type="button" class="btn sm ghost" data-clear-place>${esc(t("cr.clearPlace"))}</button></div>`
            : `<div class="notice" id="c-later">🍽️ ${esc(t("cr.friendsLater"))}</div>`)
        : (() => {
            const ps = placeSearchHTML({ label: t("cr.orSearch"), placeholder: t("cr.placePh"), hint: t("cr.placeHint") });
            ids.venue = ps.id;
            return `<div class="section-lite" id="c-sug-wrap"${d.place ? " hidden" : ""}>
          <div class="pick-map">
            <button type="button" class="btn sm" data-pick-map>🗺️ ${esc(t("cr.pickOnMap"))}</button>
            <p class="hint" style="margin:4px 0 0">${esc(t("cr.pickOnMapHint"))}</p>
          </div>
          <h3>${esc(t("cr.sugTitle"))}</h3>
          <details class="cuis-details" id="c-narrow" ${d.formats.length || d.vtype ? "open" : ""}><summary>${esc(t("cr.narrow"))}</summary>
            <p class="lbl" style="margin:4px 0">${esc(t("cr.formats"))}</p>
            <div class="chips" id="c-formats">${formatChipsHTML()}</div>
            <p class="lbl" style="margin:10px 0 4px">${esc(t("cr.vtype"))}</p>
            <div class="chips" id="c-vtype">${VENUE_TYPES.map((v) => `<button type="button" class="chip" data-vtype="${v.slug}" aria-pressed="${d.vtype === v.slug}"><span aria-hidden="true">${v.emoji}</span> ${esc(t("vt." + v.slug))}</button>`).join("")}</div>
          </details>
          <p class="hint" id="c-sug-hint" role="status" aria-live="polite"></p>
          ${allergyReminderHTML([{ name: "", tags: state.me?.dietary_tags || [] }])}
          <ul class="suggest" id="c-sug" aria-live="polite"></ul>
          <div class="row wrap-row"><button type="button" class="btn sm ghost" data-sug-refresh>${esc(t("cr.sugRefresh"))}</button></div>
        </div>
        ${ps.html}
        <div id="c-maplink">${mapLinkHTML(d.place)}</div>
        <div class="field" id="f-label"><label for="c-label">${esc(t("cr.orArea"))}</label><input id="c-label" type="text" maxlength="120" value="${esc(d.area_label)}" placeholder="${esc(t("cr.orAreaPh"))}"></div>`;
          })();
      body = `
        <h2>${esc(t("cr.s2"))}</h2>
        <div class="row wrap-row" style="align-items:flex-start">
          <div class="field" style="flex:1;min-width:150px" id="f-date"><label for="c-date">${esc(t("cr.date"))}</label><input id="c-date" type="date" min="${todayStr()}" value="${esc(d.date)}"></div>
          <div class="field" style="flex:1;min-width:120px" id="f-time"><label for="c-time">${esc(t("cr.time"))}</label><input id="c-time" type="time" value="${esc(d.time)}"></div>
        </div>
        <div class="field" id="c-base"><details id="c-base-d" ${baseLoc() ? "" : "open"}><summary id="c-base-sum"></summary><div id="c-loc"></div></details></div>
        ${startBlock}
        ${venueBlock}
        <details class="more" id="c-more" ${more[2] || d.budget || d.note ? "open" : ""}><summary>${esc(t("cr.moreOpts"))} <span class="muted">(${esc(t("common.optional"))})</span></summary>
          <div class="field"><label for="c-budget">${esc(t("cr.budget"))} (<span id="c-cur">${esc(tableCurrency())}</span>)</label>
            <input id="c-budget" type="number" inputmode="decimal" min="0" max="${budgetRange(tableCurrency()).max}" step="1" value="${esc(d.budget)}" placeholder="${budgetRange(tableCurrency()).hint}"></div>
          <div class="field"><label for="c-note">${esc(t("cr.note"))}</label>
            <textarea id="c-note" maxlength="280" placeholder="${esc(t("cr.notePh"))}">${esc(d.note)}</textarea><div class="counter"><span id="c-note-n">${d.note.length}</span>/280</div></div>
        </details>
        <div class="notice" id="c-summary">${summary()}</div>
        <div class="field" id="f-title" ${d.title || more.title ? "" : "hidden"}><label for="c-title">${esc(t("cr.title"))}</label>
          <input id="c-title" type="text" maxlength="60" value="${esc(d.title)}" placeholder="${esc(autoTitle())}"><div class="counter"><span id="c-title-n">${d.title.length}</span>/60</div></div>
        <div id="c-err" class="err-text" role="alert"></div>`;
    }
    sheet.setHTML(`${stepper()}${body}
      <div class="sheet-actions">
        ${step > 1 ? `<button type="button" class="btn" data-back>${esc(t("common.back"))}</button>` : ""}
        <button type="button" class="btn primary" data-next>${esc(step === STEPS ? t("cr.publish") : t("common.next"))}</button>
      </div>`);
    wire();
    sheet.focusFirst();
  }

  function whereText() {
    const area = baseLoc()?.label || "";
    return isFriends() && !d.place ? area : d.place?.name || d.area_label || area;
  }
  // The title people see if the host doesn't name the table: the restaurant, otherwise the cuisine(s).
  function autoTitle() {
    if (isFriends() && !d.place) return t("card.untitled");
    const c = menuItem(d.cuisines[0] || d.formats[0] || "");
    if (d.place) return `${c ? c.emoji + " " : ""}${d.place.name}`;
    const names = d.cuisines.map((k) => menuItem(k)?.name).filter(Boolean);
    if (names.length > 1) return `🍽️ ${orList(names)}`;
    return c ? `${c.emoji} ${names[0] || c.name}` : t("card.untitled");
  }
  function summary() {
    const renaming = more.title || !!d.title;
    return `<strong>${esc(d.title || autoTitle())}</strong>${renaming ? "" : ` <button type="button" class="btn sm ghost" data-rename>✏️ ${esc(t("cr.rename"))}</button>`}<br>${esc(d.date)} ${esc(d.time)} · ${esc(whereText())}<br>${esc(t("cr.sumSeats", { n: d.capacity }))} · ${esc(t("jm." + (isFriends() ? "instant" : d.join_mode)))}${!d.place && !isFriends() ? `<br><span class="muted">🍽️ ${esc(t("cr.noPlaceYet"))}</span>` : ""}`;
  }

  // Step 2 keeps a live summary; the budget currency follows the chosen restaurant.
  function refreshSummary() {
    if (step !== 2) return;
    const cf = qs("#c-crave-f", sheet.body);
    if (cf) cf.hidden = !!d.place;
    const box = qs("#c-summary", sheet.body);
    if (box) box.innerHTML = summary();
    const ti = qs("#c-title", sheet.body);
    if (ti) ti.placeholder = autoTitle();
    const cur = qs("#c-cur", sheet.body);
    if (cur) cur.textContent = tableCurrency();
  }

  function stopSuggest() {
    clearTimeout(sugTimer);
    sugCtl?.abort();
    sugSeq++;
  }

  function readStep() {
    if (step === 2) {
      d.date = qs("#c-date", sheet.body).value;
      d.time = qs("#c-time", sheet.body).value;
      d.area_label = qs("#c-label", sheet.body)?.value.trim() ?? d.area_label;
      d.budget = qs("#c-budget", sheet.body).value;
      d.note = qs("#c-note", sheet.body).value.trim();
      d.title = qs("#c-title", sheet.body).value.trim();
    }
    more[step] = !!qs("#c-more", sheet.body)?.open;
  }

  // ---- restaurant suggestions (step 2)
  const km = (n) => (n < 10 ? n.toFixed(1) : String(Math.round(n)));

  // Directions in the map links start from the start point picked here (typed address or "my location"), never silently from the device position.
  function mapLinkHTML(place) {
    if (!place) return "";
    const picked = `<p class="hint" style="margin:6px 0"><strong>✓ ${esc(t("cr.placeChosen", { name: place.name }))}</strong>${place.address ? ` · ${esc(place.address)}` : ""} <button type="button" class="btn sm ghost" data-change-place>${esc(t("cr.changePlace"))}</button></p>`;
    return picked + (d.startMe
      ? mapActionsHTML(place, { origin: { lat: d.startMe.lat, lng: d.startMe.lng }, originName: d.startMe.name })
      : mapActionsHTML(place, { hint: false }));
  }

  // Once a restaurant is chosen the suggestion list is not needed; it comes back if the choice is cleared.
  function syncSuggestions() {
    const wrap = qs("#c-sug-wrap", sheet.body);
    if (wrap) wrap.hidden = !!d.place;
    refreshSummary();
    if (!d.place) scheduleSuggest();
  }

  function clearPlace() {
    d.place = null;
    const box = qs("#c-maplink", sheet.body);
    if (box) box.innerHTML = "";
    const input = ids_venue();
    if (input) input.value = "";
    syncSuggestions();
  }
  const ids_venue = () => (draw._ids?.venue ? qs(`#${draw._ids.venue}`, sheet.body) : null);

  function refreshMapLink() {
    const box = qs("#c-maplink", sheet.body);
    if (box) box.innerHTML = mapLinkHTML(d.place);
    refreshSummary();
  }

  function suggestOrigin() {
    if (d.startMe) return { center: { lat: d.startMe.lat, lng: d.startMe.lng }, mode: "me" };
    const c = areaCenter();
    return c ? { center: c, mode: "area" } : null;
  }

  function scheduleSuggest() {
    clearTimeout(sugTimer);
    sugTimer = setTimeout(loadSuggest, 250);
  }

  async function loadSuggest() {
    if (step !== 2 || isFriends() || d.place) return;
    clearTimeout(sugTimer);
    sugCtl?.abort();
    const origin = suggestOrigin();
    if (!origin) {
      sug = "need-starts";
      return renderSuggest();
    }
    const seq = ++sugSeq;
    sugCtl = new AbortController();
    sug = "loading";
    renderSuggest();
    try {
      const keys = searchKeys({ cuisines: d.cuisines, formats: d.formats, venue_type: d.vtype });
      const { list, wanted } = await restaurantsForKeys(origin.center, keys, { radius: 2200, signal: sugCtl.signal });
      if (seq !== sugSeq) return;
      sug = { list, mode: origin.mode, wanted };
    } catch (e) {
      if (seq !== sugSeq || e?.name === "AbortError") return;
      sug = "error";
    }
    renderSuggest();
  }

  function renderSuggest() {
    if (step !== 2 || sheet.closed) return;
    const list = qs("#c-sug", sheet.body);
    const hint = qs("#c-sug-hint", sheet.body);
    if (!list || !hint) return;
    const origin = suggestOrigin();
    const areaName = baseLoc()?.label || "";
    if (sug === "need-starts") {
      hint.textContent = t("cr.needStarts");
      list.innerHTML = "";
      return;
    }
    hint.textContent = origin?.mode === "middle" ? t("cr.sugMiddle") : origin?.mode === "me" ? t("cr.sugNearMe") : t("cr.sugNearArea", { area: areaName });
    if (sug === "loading") {
      list.innerHTML = `<li>${esc(t("ps.searching"))}</li>`;
      return;
    }
    if (sug === "error" || !sug?.list?.length) {
      list.innerHTML = `<li>${esc(t(sug === "error" ? "td.suggestError" : "td.suggestNone"))}</li>`;
      return;
    }
    const multi = sug.wanted.length > 1;
    list.innerHTML = sug.list
      .map((r, i) => {
        const chosen = d.place && d.place.lat === r.lat && d.place.lng === r.lng && d.place.name === r.name;
        const dist = sug.mode === "middle"
          ? t("cr.fromBoth", { a: km(r.dMe), b: km(r.dFriend) })
          : t(sug.mode === "me" ? "cr.fromYou" : "cr.fromArea", { km: km(r.distKm) });
        const tag = multi ? `${menuItem(r.forCuisine)?.emoji || ""} ` : "";
        return `<li${chosen ? ' class="chosen"' : ""}><span class="who"><strong>${esc(tag + r.name)}</strong><small>${esc(r.address || "")} · ${esc(dist)}</small></span>
          <a class="btn sm ghost" href="${esc(mapsUrl(r))}" target="_blank" rel="noopener">⭐ ${esc(t("map.reviews"))}</a>
          <button type="button" class="btn sm ${chosen ? "primary" : ""}" data-use="${i}" aria-pressed="${chosen}">${esc(chosen ? t("cr.picked") : t("td.useVenue"))}</button></li>`;
      })
      .join("");
  }

  function validate() {
    if (step !== 2) return true;
    const err = qs("#c-err", sheet.body);
    qsa(".field.invalid", sheet.body).forEach((f) => f.classList.remove("invalid"));
    err.textContent = "";
    const bad = (id, msg) => {
      qs(id, sheet.body)?.classList.add("invalid");
      err.textContent = msg;
      qs(`${id} input, ${id} select`, sheet.body)?.focus();
      return false;
    };
    if (!d.date) return bad("#f-date", t("cr.errDate"));
    if (!d.time) return bad("#f-time", t("cr.errTime"));
    if (new Date(toISO(d.date, d.time)).getTime() < Date.now() + 5 * 60000) return bad("#f-date", t("err.start_in_past"));
    if (!isFriends() && !d.place && !d.area_label) return bad("#f-label", t("cr.errPlace"));
    if (!d.place && !baseLoc()) return bad("#c-base", t("loc.errBase"));
    return true;
  }

  function wire() {
    const b = sheet.body;
    if (step === 1) {
      qsa('input[name="aud"]', b).forEach((r) =>
        r.addEventListener("change", () => {
          d.audience = r.value;
          qs("#f-priv", b).hidden = !isFriends();
          qs("#f-jm", b).hidden = isFriends();
          // Among friends, everyone says what they feel like eating; the host doesn't pick for the whole table.
          qs("#f-cuis", b).hidden = isFriends();
          qs("#f-cuis-friends", b).hidden = !isFriends();
          // Date / family meal / classmates only describe a table among friends.
          const occs = qs("#c-occs", b);
          occs.hidden = !isFriends();
          occs.style.display = isFriends() ? "contents" : "none";
        })
      );
      qsa('input[name="jm"]', b).forEach((r) => r.addEventListener("change", () => (d.join_mode = r.value)));
      mountMenuPicker(qs("#c-menu", b), {
        value: d.cuisines,
        multi: true,
        max: 3,
        onLimit: () => toast(t("cr.cuisineMaxHit", { n: 3 })),
        onChange: (v) => {
          d.cuisines = v;
          formatChipsHTML(); // drops formats that no longer fit
        },
      });
      qs("#c-kind", b).addEventListener("click", (e) => {
        const o = e.target.closest("[data-occ]");
        if (!o) return;
        d.occasion = d.occasion === o.dataset.occ ? "" : o.dataset.occ;
        qsa("[data-occ]", b).forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.occ === d.occasion)));
      });
      qs("#c-kind", b).addEventListener("click", (e) => {
        const g = e.target.closest("[data-tag]");
        if (!g) return;
        d.tags = d.tags.includes(g.dataset.tag) ? d.tags.filter((x) => x !== g.dataset.tag) : [...d.tags, g.dataset.tag];
        g.setAttribute("aria-pressed", String(d.tags.includes(g.dataset.tag)));
      });
      qsa("[data-cap]", b).forEach((x) =>
        x.addEventListener("click", () => {
          d.capacity = Math.min(12, Math.max(2, d.capacity + Number(x.dataset.cap)));
          qs("#cap-v", b).textContent = d.capacity;
        })
      );
    } else {
      qs("#c-note", b).addEventListener("input", (e) => (qs("#c-note-n", b).textContent = e.target.value.length));
      qs("#c-title", b).addEventListener("input", (e) => {
        qs("#c-title-n", b).textContent = e.target.value.length;
        d.title = e.target.value.trim();
        const strong = qs("#c-summary strong", b);
        if (strong) strong.textContent = d.title || autoTitle();
      });
      qs("#c-summary", b).addEventListener("click", (e) => {
        if (!e.target.closest("[data-rename]")) return;
        more.title = true;
        qs("#f-title", b).hidden = false;
        refreshSummary();
        qs("#c-title", b).focus();
      });
      qs("#c-formats", b)?.addEventListener("click", (e) => {
        const c = e.target.closest("[data-fmt]");
        if (!c) return;
        const s = c.dataset.fmt;
        if (d.formats.includes(s)) d.formats = d.formats.filter((x) => x !== s);
        else if (d.formats.length < MAX_FORMATS) d.formats = [...d.formats, s];
        else return toast(t("cr.formatsMaxHit", { n: MAX_FORMATS }));
        qsa("[data-fmt]", b).forEach((x) => x.setAttribute("aria-pressed", String(d.formats.includes(x.dataset.fmt))));
        scheduleSuggest();
      });
      qs("#c-vtype", b)?.addEventListener("click", (e) => {
        const c = e.target.closest("[data-vtype]");
        if (!c) return;
        d.vtype = d.vtype === c.dataset.vtype ? "" : c.dataset.vtype;
        qsa("[data-vtype]", b).forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.vtype === d.vtype)));
        scheduleSuggest();
      });

      ["#c-date", "#c-time", "#c-label"].forEach((id) => qs(id, b)?.addEventListener("input", () => { readStep(); refreshSummary(); }));
      const ids = draw._ids;
      const near = areaCenter();
      bindPlaceSearch(b, {
        id: ids.me, near,
        onSelect: (p) => { d.startMe = p; refreshMapLink(); scheduleSuggest(); },
        onClear: () => { d.startMe = null; refreshMapLink(); scheduleSuggest(); },
      });
      if (ids.venue) bindPlaceSearch(b, {
        id: ids.venue, near,
        onSelect: (p) => {
          d.place = p;
          fitToPlace(p);
          qs("#c-maplink", b).innerHTML = mapLinkHTML(p);
          sugCtl?.abort();
          syncSuggestions();
        },
        onClear: () => {
          d.place = null;
          qs("#c-maplink", b).innerHTML = "";
          syncSuggestions();
        },
      });
      qs("#c-maplink", b)?.addEventListener("click", (e) => {
        if (e.target.closest("[data-change-place]")) clearPlace();
      });
      qs("[data-clear-place]", b)?.addEventListener("click", () => {
        readStep();
        d.place = null;
        draw();
      });
      const paintBase = () => (qs("#c-base-sum", b).textContent = `📍 ${t("cr.around")}: ${baseLoc()?.label || t("loc.notSet")}`);
      paintBase();
      mountLocPicker(qs("#c-loc", b), {
        onChange: (loc) => {
          d.base = loc;
          paintBase();
          refreshSummary();
          qs("#c-base-d", b).open = false;
          scheduleSuggest();
        },
      });
      qs("[data-locate]", b)?.addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const pos = await currentPosition();
          d.startMe = { name: t("cr.myLocation"), address: "", lat: pos.lat, lng: pos.lng, poi_id: null };
          refreshMapLink();
          const input = qs(`#${ids.me}`, b);
          if (input) input.value = t("cr.myLocation");
          scheduleSuggest();
        } catch {
          toast(t("cr.locDenied"));
        } finally {
          btn.disabled = false;
        }
      });
      const craving = qs("#c-craving", b);
      if (craving) mountMenuPicker(craving, { value: d.craving, formats: true, onChange: (v) => (d.craving = v) });
      qs("[data-sug-refresh]", b)?.addEventListener("click", () => loadSuggest());
      qs("[data-pick-map]", b)?.addEventListener("click", pickOnMap);
      qs("#c-sug", b)?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-use]");
        if (!btn || !sug?.list) return;
        const r = sug.list[Number(btn.dataset.use)];
        if (!r) return;
        d.place = { name: r.name, address: r.address, lat: r.lat, lng: r.lng, poi_id: r.poi_id || null };
        fitToPlace(d.place, r.forCuisine);
        qs("#c-maplink", b).innerHTML = mapLinkHTML(d.place);
        qs("#c-err", b).textContent = "";
        syncSuggestions();
      });
      loadSuggest();
    }
    qs("[data-back]", b)?.addEventListener("click", () => {
      readStep();
      stopSuggest();
      step--;
      draw();
    });
    qs("[data-next]", b).addEventListener("click", async (e) => {
      readStep();
      if (!validate()) return;
      if (step < STEPS) {
        stopSuggest();
        step++;
        return draw();
      }
      await publish(e.currentTarget);
    });
  }

  async function publish(btn) {
    const center = areaCenter();
    // Friends tables normally start without a venue (the group picks it together once people have joined),
    // unless the host already chose one, e.g. from the Map tab.
    const place = d.place;
    const areaName = baseLoc()?.label || "";
    const budget = d.budget !== "" && Number.isFinite(Number(d.budget)) ? Math.round(Number(d.budget) * 100) : null;
    // A friends table without a restaurant has no cuisine of its own yet: it comes from what everyone feels like.
    const ownMenu = !isFriends() || !!place;
    const payload = {
      title: d.title || null,
      audience: d.audience,
      cuisine: ownMenu ? d.cuisines[0] || null : null,
      cuisines: ownMenu ? d.cuisines : [],
      formats: ownMenu ? d.formats : [],
      venue_type: d.vtype || null,
      capacity: d.capacity,
      join_mode: isFriends() ? "instant" : d.join_mode,
      starts_at: toISO(d.date, d.time),
      area_id: null,
      area_label: place ? place.name : isFriends() ? areaName : d.area_label,
      meet_lat: place ? place.lat : center?.lat ?? null,
      meet_lng: place ? place.lng : center?.lng ?? null,
      venue: place ? { name: place.name, address: place.address, lat: place.lat, lng: place.lng, poi_id: place.poi_id } : null,
      budget_cents: budget,
      currency: tableCurrency(),
      tags: d.tags,
      occasion: isFriends() ? d.occasion || null : null,
      note: d.note || null,
    };
    try {
      const r = await withBusy(btn, async () => {
        const made = await api.createTable(payload);
        // The host is a member too: record their starting point and craving so friends see them straight away.
        if (isFriends()) {
          try {
            if (d.startMe) {
              await api.updateMembership(made.id, {
                start_label: publicLabel(d.startMe), start_lat: d.startMe.lat, start_lng: d.startMe.lng,
              });
            }
            if (d.craving) await api.setCraving(made.id, d.craving);
          } catch { /* the table exists; they can add these from its page */ }
        }
        return made;
      });
      toast(t("cr.done"));
      bus.emit("tables-changed");
      sheet.onClose = null;
      closeSheet({ silent: true });
      go(`#t-${r.id}`);
    } catch (e) {
      showError(e);
    }
  }

  draw();
  return sheet;
}
