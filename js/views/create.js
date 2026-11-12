// "Host a table" — 3-step wizard in a sheet.
import { esc, qs, qsa, todayStr, toISO, pad } from "../util.js";
import { t } from "../i18n.js";
import { state, bus } from "../state.js";
import { api } from "../api.js";
import { openSheet, closeSheet, toast, placeSearchHTML, bindPlaceSearch } from "../ui.js";
import { AUDIENCES, TAGS, INTENTIONS, PACES } from "../data.js";
import { go, nameOf, showError, withBusy, mapActionsHTML } from "./common.js";

export function openCreate({ onClose } = {}) {
  const d = {
    title: "",
    audience: "friends_and_new",
    cuisine: state.ranks[0] || "",
    capacity: 4,
    join_mode: "request",
    date: todayStr(),
    time: "18:30",
    area_id: state.me?.area_id || state.areas[0]?.id || "",
    place: null,
    area_label: "",
    budget: state.me?.budget_cents != null ? String(state.me.budget_cents / 100) : "",
    tags: [],
    note: "",
    intention: "",
    pace: "",
  };
  let step = 1;
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
        <div class="field"><label for="c-title">${esc(t("cr.title"))} <span class="muted">(${esc(t("common.optional"))})</span></label>
          <input id="c-title" type="text" maxlength="60" value="${esc(d.title)}" placeholder="${esc(t("cr.titlePh"))}"><div class="counter"><span id="c-title-n">${d.title.length}</span>/60</div></div>
        <fieldset><legend>${esc(t("cr.audience"))}</legend><div class="seg">
          ${AUDIENCES.map((a) => `<label><input type="radio" name="aud" value="${a}" ${d.audience === a ? "checked" : ""}><span>${esc(t("aud." + a))}<small>${esc(t("audHint." + a))}</small></span></label>`).join("")}
        </div></fieldset>
        <fieldset><legend>${esc(t("cr.cuisine"))}</legend><div class="chips" id="c-cuisines">
          ${state.cuisines.map((c) => `<button type="button" class="chip" data-cuisine="${c.slug}" aria-pressed="${d.cuisine === c.slug}">${esc(c.emoji)} ${esc(nameOf(c))}</button>`).join("")}
        </div></fieldset>
        <div class="field"><label id="cap-l">${esc(t("cr.capacity"))}</label>
          <div class="stepper" role="group" aria-labelledby="cap-l"><button type="button" data-cap="-1" aria-label="${esc(t("cr.fewer"))}">−</button><output id="cap-v" aria-live="polite">${d.capacity}</output><button type="button" data-cap="1" aria-label="${esc(t("cr.more"))}">＋</button></div>
          <p class="hint">${esc(t("cr.capacityHint"))}</p></div>
        <fieldset><legend>${esc(t("cr.joinMode"))}</legend><div class="seg">
          ${["request", "instant"].map((m) => `<label><input type="radio" name="jm" value="${m}" ${d.join_mode === m ? "checked" : ""}><span>${esc(t("jm." + m))}<small>${esc(t("jmHint." + m))}</small></span></label>`).join("")}
        </div></fieldset>`;
    } else if (step === 2) {
      const ps = placeSearchHTML({ label: t("cr.place"), placeholder: t("cr.placePh"), hint: t("cr.placeHint") });
      draw._ps = ps.id;
      body = `
        <h2>${esc(t("cr.s2"))}</h2>
        <div class="row wrap-row" style="align-items:flex-start">
          <div class="field" style="flex:1;min-width:150px" id="f-date"><label for="c-date">${esc(t("cr.date"))}</label><input id="c-date" type="date" min="${todayStr()}" value="${esc(d.date)}"></div>
          <div class="field" style="flex:1;min-width:120px" id="f-time"><label for="c-time">${esc(t("cr.time"))}</label><input id="c-time" type="time" value="${esc(d.time)}"></div>
        </div>
        <div class="field"><label for="c-area">${esc(t("cr.area"))}</label><select id="c-area">${state.areas.map((a) => `<option value="${a.id}" ${d.area_id === a.id ? "selected" : ""}>${esc(nameOf(a))}</option>`).join("")}</select></div>
        ${ps.html}
        <div id="c-maplink">${d.place ? mapActionsHTML(d.place, { hint: false }) : ""}</div>
        <div class="field" id="f-label"><label for="c-label">${esc(t("cr.orArea"))}</label><input id="c-label" type="text" maxlength="120" value="${esc(d.area_label)}" placeholder="${esc(t("cr.orAreaPh"))}"></div>
        <div id="c-err" class="err-text" role="alert"></div>`;
    } else {
      body = `
        <h2>${esc(t("cr.s3"))}</h2>
        <div class="field"><label for="c-budget">${esc(t("cr.budget"))} <span class="muted">(${esc(t("common.optional"))})</span></label>
          <input id="c-budget" type="number" inputmode="decimal" min="0" max="500" step="1" value="${esc(d.budget)}" placeholder="30"></div>
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
    return d.place?.name || d.area_label || nameOf(state.areas.find((a) => a.id === d.area_id));
  }
  function summary() {
    const c = state.cuisines.find((x) => x.slug === d.cuisine);
    return `<strong>${esc(d.title || (c ? `${c.emoji} ${nameOf(c)}` : t("card.untitled")))}</strong><br>${esc(d.date)} ${esc(d.time)} · ${esc(whereText())}<br>${esc(t("cr.sumSeats", { n: d.capacity }))} · ${esc(t("jm." + d.join_mode))}`;
  }

  function readStep() {
    if (step === 1) {
      d.title = qs("#c-title", sheet.body).value.trim();
    } else if (step === 2) {
      d.date = qs("#c-date", sheet.body).value;
      d.time = qs("#c-time", sheet.body).value;
      d.area_id = qs("#c-area", sheet.body).value;
      d.area_label = qs("#c-label", sheet.body).value.trim();
    } else {
      d.budget = qs("#c-budget", sheet.body).value;
      d.note = qs("#c-note", sheet.body).value.trim();
      d.intention = qs("#c-int", sheet.body).value;
      d.pace = qs("#c-pace", sheet.body).value;
    }
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
    if (!d.place && !d.area_label) return bad("#f-label", t("cr.errPlace"));
    return true;
  }

  function wire() {
    const b = sheet.body;
    if (step === 1) {
      qs("#c-title", b).addEventListener("input", (e) => (qs("#c-title-n", b).textContent = e.target.value.length));
      qsa('input[name="aud"]', b).forEach((r) => r.addEventListener("change", () => (d.audience = r.value)));
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
      bindPlaceSearch(b, {
        id: draw._ps,
        near: areaCenter(),
        onSelect: (p) => {
          d.place = p;
          qs("#c-maplink", b).innerHTML = mapActionsHTML(p, { hint: false });
        },
        onClear: () => {
          d.place = null;
          qs("#c-maplink", b).innerHTML = "";
        },
      });
      qs("#c-area", b).addEventListener("change", (e) => (d.area_id = e.target.value));
    } else {
      qs("#c-note", b).addEventListener("input", (e) => (qs("#c-note-n", b).textContent = e.target.value.length));
      qs("#c-tags", b).addEventListener("click", (e) => {
        const g = e.target.closest("[data-tag]");
        if (!g) return;
        d.tags = d.tags.includes(g.dataset.tag) ? d.tags.filter((x) => x !== g.dataset.tag) : [...d.tags, g.dataset.tag];
        g.setAttribute("aria-pressed", String(d.tags.includes(g.dataset.tag)));
      });
    }
    qs("[data-back]", b)?.addEventListener("click", () => {
      readStep();
      step--;
      draw();
    });
    qs("[data-next]", b).addEventListener("click", async (e) => {
      readStep();
      if (!validate()) return;
      if (step < 3) {
        step++;
        return draw();
      }
      await publish(e.currentTarget);
    });
  }

  async function publish(btn) {
    const center = areaCenter();
    const budget = d.budget !== "" && Number.isFinite(Number(d.budget)) ? Math.round(Number(d.budget) * 100) : null;
    const payload = {
      title: d.title || null,
      audience: d.audience,
      cuisine: d.cuisine || null,
      capacity: d.capacity,
      join_mode: d.join_mode,
      starts_at: toISO(d.date, d.time),
      area_id: d.area_id || null,
      area_label: d.place ? d.place.name : d.area_label,
      meet_lat: d.place ? d.place.lat : center?.lat ?? null,
      meet_lng: d.place ? d.place.lng : center?.lng ?? null,
      venue: d.place ? { name: d.place.name, address: d.place.address, lat: d.place.lat, lng: d.place.lng, poi_id: d.place.poi_id } : null,
      budget_cents: budget,
      tags: d.tags,
      note: d.note || null,
      intention: d.intention || null,
      pace: d.pace || null,
    };
    try {
      const r = await withBusy(btn, () => api.createTable(payload));
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
