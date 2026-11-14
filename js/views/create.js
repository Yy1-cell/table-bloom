// "Host a table" — 3-step wizard in a sheet.
import { esc, qs, qsa, todayStr, toISO, pad, midpoint, haversineKm, mapsUrl } from "../util.js";
import { t } from "../i18n.js";
import { state, bus } from "../state.js";
import { api } from "../api.js";
import { openSheet, closeSheet, toast, placeSearchHTML, bindPlaceSearch } from "../ui.js";
import { AUDIENCES, TAGS, OCCASIONS, INTENTIONS, PACES } from "../data.js";
import { go, nameOf, showError, withBusy, mapActionsHTML, cuisineGroupsHTML } from "./common.js";
import { restaurantsNear, currentPosition } from "../geo.js";

export function openCreate({ onClose } = {}) {
  // The Map tab can hand over a restaurant the person already found ("Host a table here").
  const pre = state.createPrefill;
  state.createPrefill = null;
  const d = {
    title: "",
    audience: "friends_and_new",
    cuisine: pre?.cuisine || state.ranks[0] || "",
    capacity: 4,
    join_mode: "request",
    date: todayStr(),
    time: "18:30",
    area_id: pre?.area_id || state.me?.area_id || state.areas[0]?.id || "",
    place: pre?.place || null,
    area_label: "",
    budget: state.me?.budget_cents != null ? String(state.me.budget_cents / 100) : "",
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
  const areaCenter = () => {
    const a = state.areas.find((x) => x.id === d.area_id);
    return a ? { lat: Number(a.center_lat), lng: Number(a.center_lng) } : undefined;
  };

  function stepper() {
    return `<div class="steps" role="img" aria-label="${esc(t("cr.stepOf", { n: step, total: 3 }))}">${[1, 2, 3].map((i) => `<i class="${i <= step ? "on" : ""}"></i>`).join("")}</div>`;
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
        <fieldset><legend>${esc(t("cr.cuisine"))}</legend><div class="cuisine-groups" id="c-cuisines">
          ${cuisineGroupsHTML({ attr: "cuisine", isOn: (s) => d.cuisine === s })}
        </div></fieldset>
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
      const cuisineChips = (attr, current) =>
        `<div class="cuisine-groups" data-chips="${attr}">${cuisineGroupsHTML({ attr, isOn: (s) => current === s })}</div>`;
      const startBlock = isFriends()
        ? `<div class="section-lite">
            <h3>${esc(t("cr.pairTitle"))}</h3>
            <p class="hint">${esc(t("cr.pairHint"))}</p>
            ${mk("me", t("cr.startMe"), t("cr.startPh"), t("cr.startHint"))}
            <div class="row wrap-row"><button type="button" class="btn sm" data-locate>${esc(t("cr.useLocation"))}</button></div>
            <fieldset><legend>${esc(t("cr.myCraving"))}</legend>${cuisineChips("cuisine", d.cuisine)}</fieldset>
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
            return `<div class="section-lite" id="c-sug-wrap">
          <h3>${esc(t("cr.sugTitle"))}</h3>
          <p class="hint" id="c-sug-hint" role="status" aria-live="polite"></p>
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
        <div class="field"><label for="c-area">${esc(t("cr.area"))}</label><select id="c-area">${state.areas.map((a) => `<option value="${a.id}" ${d.area_id === a.id ? "selected" : ""}>${esc(nameOf(a))}</option>`).join("")}</select></div>
        ${startBlock}
        ${venueBlock}
        <div id="c-err" class="err-text" role="alert"></div>`;
    } else {
      body = `
        <h2>${esc(t("cr.s3"))}</h2>
        <div class="field"><label for="c-budget">${esc(t("cr.budget"))} <span class="muted">(${esc(t("common.optional"))})</span></label>
          <input id="c-budget" type="number" inputmode="decimal" min="0" max="500" step="1" value="${esc(d.budget)}" placeholder="30"></div>
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
    const area = nameOf(state.areas.find((a) => a.id === d.area_id));
    return isFriends() && !d.place ? area : d.place?.name || d.area_label || area;
  }
  function summary() {
    const c = state.cuisines.find((x) => x.slug === d.cuisine);
    return `<strong>${esc(d.title || (c ? `${c.emoji} ${nameOf(c)}` : t("card.untitled")))}</strong><br>${esc(d.date)} ${esc(d.time)} · ${esc(whereText())}<br>${esc(t("cr.sumSeats", { n: d.capacity }))} · ${esc(t("jm." + (isFriends() ? "instant" : d.join_mode)))}`;
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
      d.area_id = qs("#c-area", sheet.body).value;
      d.area_label = qs("#c-label", sheet.body)?.value.trim() ?? d.area_label;
    } else {
      d.budget = qs("#c-budget", sheet.body).value;
      d.note = qs("#c-note", sheet.body).value.trim();
      d.intention = qs("#c-int", sheet.body).value;
      d.pace = qs("#c-pace", sheet.body).value;
    }
  }

  // ---- restaurant suggestions (step 2)
  const AREA_FALLBACK = { lat: 43.6532, lng: -79.3832 };
  const km = (n) => (n < 10 ? n.toFixed(1) : String(Math.round(n)));

  // Directions in the map links start from the start point picked here (typed address or "my location"), never silently from the device position.
  function mapLinkHTML(place) {
    if (!place) return "";
    const picked = `<p class="hint" style="margin:6px 0"><strong>✓ ${esc(t("cr.placeChosen", { name: place.name }))}</strong>${place.address ? ` · ${esc(place.address)}` : ""}</p>`;
    return picked + (d.startMe
      ? mapActionsHTML(place, { origin: { lat: d.startMe.lat, lng: d.startMe.lng }, originName: d.startMe.name })
      : mapActionsHTML(place, { hint: false }));
  }

  function refreshMapLink() {
    const box = qs("#c-maplink", sheet.body);
    if (box) box.innerHTML = mapLinkHTML(d.place);
  }

  function suggestOrigin() {
    if (d.startMe) return { center: { lat: d.startMe.lat, lng: d.startMe.lng }, mode: "me" };
    return { center: areaCenter() || AREA_FALLBACK, mode: "area" };
  }

  function scheduleSuggest() {
    clearTimeout(sugTimer);
    sugTimer = setTimeout(loadSuggest, 250);
  }

  async function loadSuggest() {
    if (step !== 2 || isFriends()) return;
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
      const wanted = [d.cuisine];
      const list = await restaurantsNear(origin.center, d.cuisine, { radius: 2200, signal: sugCtl.signal });
      if (seq !== sugSeq) return;
      const out = list.map((r) => ({ ...r, forCuisine: d.cuisine, score: r.distKm })).sort((x, y) => x.score - y.score);
      sug = { list: out.slice(0, 8), mode: origin.mode, wanted };
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
    const areaName = nameOf(state.areas.find((a) => a.id === d.area_id)) || "";
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
        const tag = multi ? `${state.cuisines.find((c) => c.slug === r.forCuisine)?.emoji || ""} ` : "";
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
      qs("#c-cuisines", b).addEventListener("click", (e) => {
        const c = e.target.closest("[data-cuisine]");
        if (!c) return;
        d.cuisine = d.cuisine === c.dataset.cuisine ? "" : c.dataset.cuisine;
        qsa("[data-cuisine]", b).forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.cuisine === d.cuisine)));
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
          renderSuggest();
        },
        onClear: () => {
          d.place = null;
          qs("#c-maplink", b).innerHTML = "";
          renderSuggest();
        },
      });
      qs("[data-clear-place]", b)?.addEventListener("click", () => {
        readStep();
        d.place = null;
        draw();
      });
      qs("#c-area", b).addEventListener("change", (e) => {
        d.area_id = e.target.value;
        scheduleSuggest();
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
      qs("[data-chips]", b)?.closest("fieldset")?.addEventListener("click", (e) => {
        const c = e.target.closest("[data-cuisine]");
        if (!c) return;
        d.cuisine = d.cuisine === c.dataset.cuisine ? "" : c.dataset.cuisine;
        qsa("[data-cuisine]", b).forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.cuisine === d.cuisine)));
        scheduleSuggest();
      });
      qs("[data-sug-refresh]", b)?.addEventListener("click", () => loadSuggest());
      qs("#c-sug", b)?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-use]");
        if (!btn || !sug?.list) return;
        const r = sug.list[Number(btn.dataset.use)];
        if (!r) return;
        d.place = { name: r.name, address: r.address, lat: r.lat, lng: r.lng, poi_id: r.poi_id || null };
        qs("#c-maplink", b).innerHTML = mapLinkHTML(d.place);
        qs("#c-err", b).textContent = "";
        renderSuggest();
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
    const areaName = nameOf(state.areas.find((a) => a.id === d.area_id)) || "Toronto";
    const budget = d.budget !== "" && Number.isFinite(Number(d.budget)) ? Math.round(Number(d.budget) * 100) : null;
    const payload = {
      title: d.title || null,
      audience: d.audience,
      cuisine: d.cuisine || null,
      capacity: d.capacity,
      join_mode: isFriends() ? "instant" : d.join_mode,
      starts_at: toISO(d.date, d.time),
      area_id: d.area_id || null,
      area_label: place ? place.name : isFriends() ? areaName : d.area_label,
      meet_lat: place ? place.lat : center?.lat ?? null,
      meet_lng: place ? place.lng : center?.lng ?? null,
      venue: place ? { name: place.name, address: place.address, lat: place.lat, lng: place.lng, poi_id: place.poi_id } : null,
      budget_cents: budget,
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
            if (d.cuisine) await api.setCraving(made.id, d.cuisine);
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
