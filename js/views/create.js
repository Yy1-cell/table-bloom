// "Host a table" — 3-step wizard in a sheet.
import { esc, qs, qsa, todayStr, toISO, pad, midpoint, haversineKm, mapsUrl } from "../util.js";
import { t } from "../i18n.js";
import { state, bus } from "../state.js";
import { api } from "../api.js";
import { openSheet, closeSheet, toast, placeSearchHTML, bindPlaceSearch } from "../ui.js";
import { AUDIENCES, TAGS, OCCASIONS, INTENTIONS, PACES, FORMATS, VENUE_TYPES, MAX_FORMATS, formatsForMany, searchKeys } from "../data.js";
import { go, nameOf, showError, withBusy, mapActionsHTML } from "./common.js";
import { effectiveLoc } from "../location.js";
import { currencyFor, budgetRange } from "../currency.js";
import { mountLocPicker } from "./loc-picker.js";
import { mountMenuPicker, menuItem, isFormat } from "./menu-picker.js";
import { restaurantsForKeys, currentPosition } from "../geo.js";
import { allergyReminderHTML } from "./diet.js";

export function openCreate({ onClose } = {}) {
  // The Map tab can hand over a restaurant the person already found ("Host a table here").
  const pre = state.createPrefill;
  state.createPrefill = null;
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
    intention: "",
    pace: "",
    // Only used to suggest restaurants. Never sent to the server.
    startMe: null,
  };
  let step = 1;
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
    return `<div class="steps" role="img" aria-label="${esc(t("cr.stepOf", { n: step, total: 3 }))}">${[1, 2, 3].map((i) => `<i class="${i <= step ? "on" : ""}"></i>`).join("")}</div>`;
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
      body = `
        <h2>${esc(t("cr.s1"))}</h2>
        ${d.place ? `<div class="notice" id="c-hostat">📍 ${esc(t("cr.hostingAt", { name: d.place.name }))}</div>` : ""}
        <div class="field"><label for="c-title">${esc(t("cr.title"))} <span class="muted">(${esc(t("common.optional"))})</span></label>
          <input id="c-title" type="text" maxlength="60" value="${esc(d.title)}" placeholder="${esc(t("cr.titlePh"))}"><div class="counter"><span id="c-title-n">${d.title.length}</span>/60</div></div>
        <fieldset><legend>${esc(t("cr.audience"))}</legend><div class="seg">
          ${AUDIENCES.map((a) => `<label><input type="radio" name="aud" value="${a}" ${d.audience === a ? "checked" : ""}><span>${esc(t("aud." + a))}<small>${esc(t("audHint." + a))}</small></span></label>`).join("")}
        </div></fieldset>
        <fieldset><legend>${esc(t("cr.cuisine"))} <span class="muted">(${esc(t("cr.cuisineMax", { n: 3 }))})</span></legend><div id="c-menu"></div></fieldset>
        <fieldset><legend>${esc(t("cr.formats"))} <span class="muted">(${esc(t("common.optional"))} · ${esc(t("cr.formatsMax", { n: MAX_FORMATS }))})</span></legend>
          <div class="chips" id="c-formats">${formatChipsHTML()}</div></fieldset>
        <fieldset><legend>${esc(t("cr.vtype"))} <span class="muted">(${esc(t("common.optional"))})</span></legend>
          <div class="chips" id="c-vtype">${VENUE_TYPES.map((v) => `<button type="button" class="chip" data-vtype="${v.slug}" aria-pressed="${d.vtype === v.slug}"><span aria-hidden="true">${v.emoji}</span> ${esc(t("vt." + v.slug))}<small class="chip-sub">${esc(t("vtHint." + v.slug))}</small></button>`).join("")}</div></fieldset>
        <div class="field"><label id="cap-l">${esc(t("cr.capacity"))}</label>
          <div class="stepper" role="group" aria-labelledby="cap-l"><button type="button" data-cap="-1" aria-label="${esc(t("cr.fewer"))}">−</button><output id="cap-v" aria-live="polite">${d.capacity}</output><button type="button" data-cap="1" aria-label="${esc(t("cr.more"))}">＋</button></div>
          <p class="hint">${esc(t("cr.capacityHint"))}</p></div>
        <p class="notice" id="f-priv" ${isFriends() ? "" : "hidden"}>🔒 ${esc(t("cr.privateHint"))}</p>
        <fieldset id="f-jm" ${isFriends() ? "hidden" : ""}><legend>${esc(t("cr.joinMode"))}</legend><div class="seg">
          ${["request", "instant"].map((m) => `<label><input type="radio" name="jm" value="${m}" ${d.join_mode === m ? "checked" : ""}><span>${esc(t("jm." + m))}<small>${esc(t("jmHint." + m))}</small></span></label>`).join("")}
        </div></fieldset>`;
    } else if (step === 2) {
      const ids = (draw._ids = {});
      const mk = (key, label, placeholder, hint) => {
        const ps = placeSearchHTML({ label, placeholder, hint });
        ids[key] = ps.id;
        return ps.html;
      };
      if (d.craving === undefined) d.craving = d.cuisines[0] || d.formats[0] || "";
      const startBlock = isFriends()
        ? `<div class="section-lite">
            <h3>${esc(t("cr.pairTitle"))}</h3>
            <p class="hint">${esc(t("cr.pairHint"))}</p>
            ${mk("me", t("cr.startMe"), t("cr.startPh"), t("cr.startHint"))}
            <div class="row wrap-row"><button type="button" class="btn sm" data-locate>${esc(t("cr.useLocation"))}</button></div>
            <fieldset><legend>${esc(t("cr.myCraving"))}</legend><div id="c-craving"></div></fieldset>
          </div>`
        : `<div class="section-lite">
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
          <h3>${esc(t("cr.sugTitle"))}</h3>
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
        <div id="c-err" class="err-text" role="alert"></div>`;
    } else {
      body = `
        <h2>${esc(t("cr.s3"))}</h2>
        <div class="field"><label for="c-budget">${esc(t("cr.budget"))} (${esc(tableCurrency())}) <span class="muted">(${esc(t("common.optional"))})</span></label>
          <input id="c-budget" type="number" inputmode="decimal" min="0" max="${budgetRange(tableCurrency()).max}" step="1" value="${esc(d.budget)}" placeholder="${budgetRange(tableCurrency()).hint}"></div>
        <fieldset><legend>${esc(t("cr.occasion"))} <span class="muted">(${esc(t("common.optional"))})</span></legend><div class="chips" id="c-occ">
          ${OCCASIONS.map((o) => `<button type="button" class="chip" data-occ="${o.slug}" aria-pressed="${d.occasion === o.slug}"><span aria-hidden="true">${o.emoji}</span> ${esc(t("oc." + o.slug))}</button>`).join("")}
        </div></fieldset>
        <fieldset><legend>${esc(t("cr.tags"))}</legend><div class="chips" id="c-tags">
          ${TAGS.map((g) => `<button type="button" class="chip" data-tag="${g}" aria-pressed="${d.tags.includes(g)}">${esc(t("tag." + g))}</button>`).join("")}
        </div></fieldset>
        <div class="field"><label for="c-note">${esc(t("cr.note"))} <span class="muted">(${esc(t("common.optional"))})</span></label>
          <textarea id="c-note" maxlength="280" placeholder="${esc(t("cr.notePh"))}">${esc(d.note)}</textarea><div class="counter"><span id="c-note-n">${d.note.length}</span>/280</div></div>
        <div class="row wrap-row">
          <div class="field" style="flex:1;min-width:150px"><label for="c-int">${esc(t("td.intention"))}</label><select id="c-int"><option value="">${esc(t("td.noPref"))}</option>${INTENTIONS.map((v) => `<option value="${v}" ${d.intention === v ? "selected" : ""}>${esc(t("int." + v))}</option>`).join("")}</select></div>
          <div class="field" style="flex:1;min-width:150px"><label for="c-pace">${esc(t("td.pace"))}</label><select id="c-pace"><option value="">${esc(t("td.noPref"))}</option>${PACES.map((v) => `<option value="${v}" ${d.pace === v ? "selected" : ""}>${esc(t("pace." + v))}</option>`).join("")}</select></div>
        </div>
        <div class="notice">${summary()}</div>`;
    }
    sheet.setHTML(`${stepper()}${body}
      <div class="sheet-actions">
        ${step > 1 ? `<button type="button" class="btn" data-back>${esc(t("common.back"))}</button>` : ""}
        <button type="button" class="btn primary" data-next>${esc(step === 3 ? t("cr.publish") : t("common.next"))}</button>
      </div>`);
    wire();
    sheet.focusFirst();
  }

  function whereText() {
    const area = baseLoc()?.label || "";
    return isFriends() && !d.place ? area : d.place?.name || d.area_label || area;
  }
  function summary() {
    const c = menuItem(d.cuisines[0] || d.formats[0] || "");
    const names = d.cuisines.map((k) => menuItem(k)?.name).filter(Boolean).join(" · ");
    return `<strong>${esc(d.title || (c ? `${c.emoji} ${names || c.name}` : t("card.untitled")))}</strong><br>${esc(d.date)} ${esc(d.time)} · ${esc(whereText())}<br>${esc(t("cr.sumSeats", { n: d.capacity }))} · ${esc(t("jm." + (isFriends() ? "instant" : d.join_mode)))}`;
  }

  function stopSuggest() {
    clearTimeout(sugTimer);
    sugCtl?.abort();
    sugSeq++;
  }

  function readStep() {
    if (step === 1) {
      d.title = qs("#c-title", sheet.body).value.trim();
    } else if (step === 2) {
      d.date = qs("#c-date", sheet.body).value;
      d.time = qs("#c-time", sheet.body).value;
      d.area_label = qs("#c-label", sheet.body)?.value.trim() ?? d.area_label;
    } else {
      d.budget = qs("#c-budget", sheet.body).value;
      d.note = qs("#c-note", sheet.body).value.trim();
      d.intention = qs("#c-int", sheet.body).value;
      d.pace = qs("#c-pace", sheet.body).value;
    }
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
      qs("#c-title", b).addEventListener("input", (e) => (qs("#c-title-n", b).textContent = e.target.value.length));
      qsa('input[name="aud"]', b).forEach((r) =>
        r.addEventListener("change", () => {
          d.audience = r.value;
          qs("#f-priv", b).hidden = !isFriends();
          qs("#f-jm", b).hidden = isFriends();
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
          qs("#c-formats", b).innerHTML = formatChipsHTML();
        },
      });
      qs("#c-formats", b).addEventListener("click", (e) => {
        const c = e.target.closest("[data-fmt]");
        if (!c) return;
        const s = c.dataset.fmt;
        if (d.formats.includes(s)) d.formats = d.formats.filter((x) => x !== s);
        else if (d.formats.length < MAX_FORMATS) d.formats = [...d.formats, s];
        else return toast(t("cr.formatsMaxHit", { n: MAX_FORMATS }));
        qsa("[data-fmt]", b).forEach((x) => x.setAttribute("aria-pressed", String(d.formats.includes(x.dataset.fmt))));
      });
      qs("#c-vtype", b).addEventListener("click", (e) => {
        const c = e.target.closest("[data-vtype]");
        if (!c) return;
        d.vtype = d.vtype === c.dataset.vtype ? "" : c.dataset.vtype;
        qsa("[data-vtype]", b).forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.vtype === d.vtype)));
      });
      qsa("[data-cap]", b).forEach((x) =>
        x.addEventListener("click", () => {
          d.capacity = Math.min(12, Math.max(2, d.capacity + Number(x.dataset.cap)));
          qs("#cap-v", b).textContent = d.capacity;
        })
      );
    } else if (step === 2) {
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
      qs("#c-sug", b)?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-use]");
        if (!btn || !sug?.list) return;
        const r = sug.list[Number(btn.dataset.use)];
        if (!r) return;
        d.place = { name: r.name, address: r.address, lat: r.lat, lng: r.lng, poi_id: r.poi_id || null };
        qs("#c-maplink", b).innerHTML = mapLinkHTML(d.place);
        qs("#c-err", b).textContent = "";
        syncSuggestions();
      });
      loadSuggest();
    } else {
      qs("#c-note", b).addEventListener("input", (e) => (qs("#c-note-n", b).textContent = e.target.value.length));
      qs("#c-occ", b).addEventListener("click", (e) => {
        const o = e.target.closest("[data-occ]");
        if (!o) return;
        d.occasion = d.occasion === o.dataset.occ ? "" : o.dataset.occ;
        qsa("[data-occ]", b).forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.occ === d.occasion)));
      });
      qs("#c-tags", b).addEventListener("click", (e) => {
        const g = e.target.closest("[data-tag]");
        if (!g) return;
        d.tags = d.tags.includes(g.dataset.tag) ? d.tags.filter((x) => x !== g.dataset.tag) : [...d.tags, g.dataset.tag];
        g.setAttribute("aria-pressed", String(d.tags.includes(g.dataset.tag)));
      });
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
      if (step < 3) {
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
    const payload = {
      title: d.title || null,
      audience: d.audience,
      cuisine: d.cuisines[0] || null,
      cuisines: d.cuisines,
      formats: d.formats,
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
      occasion: d.occasion || null,
      note: d.note || null,
      intention: d.intention || null,
      pace: d.pace || null,
    };
    try {
      const r = await withBusy(btn, async () => {
        const made = await api.createTable(payload);
        // The host is a member too: record their starting point and craving so friends see them straight away.
        if (isFriends()) {
          try {
            if (d.startMe) {
              await api.updateMembership(made.id, {
                start_label: d.startMe.name, start_lat: d.startMe.lat, start_lng: d.startMe.lng,
                intention: d.intention || null, pace: d.pace || null,
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
