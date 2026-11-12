// Table detail sheet: facts, members, join / leave / cancel, host tools, midpoint suggestions, share, calendar, report.
import { esc, personName, qs, resizeImage, fmtDateLong, fmtMoney, isPast, midpoint, haversineKm, mapsUrl, appleMapsUrl, isIOS, buildICS, downloadText } from "../util.js";
import { t } from "../i18n.js";
import { state, bus, cuisineOf } from "../state.js";
import { api } from "../api.js";
import { openSheet, closeSheet, toast, confirmDialog, placeSearchHTML, bindPlaceSearch, announce } from "../ui.js";
import { invitationUrl } from "../invitation.js";
import { restaurantsNear } from "../geo.js";
import { INTENTIONS, PACES, REPORT_REASONS } from "../data.js";
import { go, nameOf, showError, withBusy, seatsHTML, statusBadge, tableTitle, placeText, mapActionsHTML } from "./common.js";

const ENDED_GRACE_MIN = 120;

export async function openTable(id, { onClose } = {}) {
  const sheet = openSheet({
    label: t("td.label"),
    className: "sheet-detail",
    html: `<div class="skeleton" style="height:220px"></div>`,
    onClose,
  });
  let tb = null;
  let startPick = undefined; // undefined = unchanged, null = cleared, object = chosen place
  let suggestions = null;
  let photos = [];
  let uploading = false;
  const startingPoints = () => (tb.members || [])
    .filter((m) => m.status === "joined" && m.start_lat != null && m.start_lng != null)
    .map((m) => ({ lat: Number(m.start_lat), lng: Number(m.start_lng) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  function restaurantCenter() {
    const points = startingPoints();
    if (points.length) return midpoint(points);
    const area = state.areas.find((a) => a.id === tb.area_id);
    return {
      lat: Number(tb.meet_lat ?? area?.center_lat ?? 43.6532),
      lng: Number(tb.meet_lng ?? area?.center_lng ?? -79.3832),
    };
  }

  function nearbyMapsLink() {
    const center = restaurantCenter();
    const cuisine = cuisineOf(tb.cuisine);
    const name = `${cuisine ? cuisine.name_en + " " : ""}restaurants near ${center.lat.toFixed(5)},${center.lng.toFixed(5)}`;
    return mapsUrl({ name });
  }

  async function reload() {
    try {
      tb = await api.getTable(id);
    } catch (e) {
      sheet.setHTML(`<h2>${esc(t("td.gone"))}</h2><p class="muted">${esc(t("err.not_found"))}</p><button class="btn primary" data-act="close">${esc(t("common.close"))}</button>`);
      return;
    }
    startPick = undefined;
    draw();
  }

  function selectOptions(values, prefix, current) {
    return `<option value="">${esc(t("td.noPref"))}</option>` + values.map((v) => `<option value="${v}" ${current === v ? "selected" : ""}>${esc(t(prefix + v))}</option>`).join("");
  }

  function draw() {
    const c = cuisineOf(tb.cuisine);
    const me = tb.my_status;
    const isHost = me === "host";
    const isMember = me === "joined" || isHost;
    const ended = isPast(tb.starts_at, ENDED_GRACE_MIN);
    const started = isPast(tb.starts_at);
    const live = ["open", "full"].includes(tb.status);
    const mapLink = tb.venue || tb.meet_lat != null ? mapsUrl({ name: tb.venue?.name || tb.area_label, address: tb.venue?.address, lat: tb.venue?.lat ?? tb.meet_lat, lng: tb.venue?.lng ?? tb.meet_lng }) : null;
    const when = new Date(tb.starts_at);
    const timeStr = when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

    const members = tb.members || [];
    const guestsJoined = members.filter((m) => m.status === "joined");
    const mine = tb.my_membership;

    const html = [];
    html.push(`
      <div class="row wrap-row" style="margin-bottom:6px">${statusBadge(tb)} ${tb.join_mode === "instant" ? `<span class="badge">${esc(t("td.instant"))}</span>` : ""}</div>
      <h2>${esc(tableTitle(tb))}</h2>
      <div class="row" style="margin-bottom:6px"><span class="av lg" aria-hidden="true">${esc(tb.host?.avatar_emoji || "🍽️")}</span>
        <div><strong>${esc(t("card.hostedBy", { name: personName(tb.host?.display_name) }))}</strong>
        ${tb.host?.languages_spoken?.length ? `<div class="muted" style="font-size:14px">${esc(tb.host.languages_spoken.map((l) => t("lang." + l)).join(" · "))}</div>` : ""}</div></div>
      <ul class="facts">
        <li><span class="k" aria-hidden="true">🕖</span><span>${esc(fmtDateLong(tb.starts_at))} · ${esc(timeStr)}</span></li>
        <li><span class="k" aria-hidden="true">📍</span><span>${esc(placeText(tb))}${tb.venue?.address ? `<br><span class="muted">${esc(tb.venue.address)}</span>` : ""}
        </span></li>
        ${c ? `<li><span class="k" aria-hidden="true">${esc(c.emoji)}</span><span>${esc(nameOf(c))}</span></li>` : ""}
        ${tb.budget_cents != null ? `<li><span class="k" aria-hidden="true">💵</span><span>${esc(t("card.perPerson", { price: fmtMoney(tb.budget_cents) }))}</span></li>` : ""}
        <li><span class="k" aria-hidden="true">👥</span><span>${seatsHTML(tb.seats_taken, tb.capacity)}${esc(t("td.seats", { n: tb.seats_taken, cap: tb.capacity }))} · ${esc(t("aud." + tb.audience))}</span></li>
      </ul>
      ${mapLink ? mapActionsHTML({ name: tb.venue?.name || tb.area_label, address: tb.venue?.address, lat: tb.venue?.lat ?? tb.meet_lat, lng: tb.venue?.lng ?? tb.meet_lng }, { origin: mine?.start_lat != null ? { lat: Number(mine.start_lat), lng: Number(mine.start_lng) } : undefined }) : ""}
      ${tb.note ? `<p>${esc(tb.note)}</p>` : ""}
      ${tb.tags?.length ? `<div class="tags">${tb.tags.map((g) => `<span class="tag">${esc(t("tag." + g))}</span>`).join("")}</div>` : ""}`);

    // ---- status messages & primary actions
    const act = [];
    if (tb.is_sample) {
      act.push(`<div class="notice">${esc(t("td.sample"))}</div><a class="btn primary block" href="#new">${esc(t("disc.host"))}</a>`);
    } else if (isHost) {
      if (tb.status === "cancelled") act.push(`<div class="notice bad">${esc(t("td.cancelled"))}</div>`);
      else if (ended) act.push(`<div class="notice">🌿 ${esc(t("td.over"))}</div>`);
      else {
        if (tb.pending_count > 0) act.push(`<div class="notice warn">${esc(t("td.pendingNotice", { n: tb.pending_count }))}</div>`);
      }
    } else if (me === "joined") {
      act.push(`<div class="notice">${ended ? `🌿 ${esc(t("td.over"))}` : `✅ ${esc(t("td.youreIn"))}`}</div>`);
    } else if (me === "requested") {
      act.push(`<div class="notice warn">⏳ ${esc(t("td.requestSent"))}</div>`);
    } else if (me === "declined") {
      act.push(`<div class="notice bad">${esc(t("td.declined"))}</div>`);
    } else if (tb.status === "cancelled") {
      act.push(`<div class="notice bad">${esc(t("td.cancelled"))}</div>`);
    } else if (tb.status === "full") {
      act.push(`<div class="notice">${esc(t("td.full"))}</div>`);
    } else if (started) {
      act.push(`<div class="notice">${esc(t("td.started"))}</div>`);
    }

    const canJoin = !tb.is_sample && !me && tb.status === "open" && !started;
    const showDetails = !ended && (canJoin || me === "requested" || me === "joined" || (isHost && live));
    if (showDetails) {
      const label = canJoin ? t("td.shareMore") : t("td.myDetails");
      act.push(`
        <details class="more" ${canJoin ? "" : "open"}>
          <summary>${esc(label)}</summary>
          <p class="hint" style="margin-top:0">${esc(t("td.privacy"))}</p>
          ${(() => {
            const ps = placeSearchHTML({ label: t("td.startPoint"), placeholder: t("td.startPlaceholder"), hint: t("td.startHint") });
            draw._psId = ps.id;
            return ps.html;
          })()}
          ${mine?.start_label && startPick === undefined ? `<p class="hint" data-start-current>${esc(t("td.currentStart", { name: mine.start_label }))}</p>` : ""}
          <div class="field"><label for="d-int">${esc(t("td.intention"))}</label><select id="d-int">${selectOptions(INTENTIONS, "int.", mine?.intention)}</select></div>
          <div class="field" style="margin-bottom:0"><label for="d-pace">${esc(t("td.pace"))}</label><select id="d-pace">${selectOptions(PACES, "pace.", mine?.pace)}</select></div>
        </details>`);
    }
    if (canJoin) {
      act.push(`<button type="button" class="btn primary block" data-act="join">${esc(tb.join_mode === "instant" ? t("td.joinNow") : t("td.requestJoin"))}</button>
        <p class="hint center">${esc(tb.join_mode === "instant" ? t("td.instantHint") : t("td.requestHint"))}</p>`);
    }
    if (showDetails && (me === "requested" || me === "joined" || (isHost && live))) {
      act.push(`<button type="button" class="btn block" data-act="save-details" style="margin-top:8px">${esc(t("td.saveDetails"))}</button>`);
    }
    if (me === "requested") act.push(`<button type="button" class="btn block danger-ghost" data-act="leave">${esc(t("td.withdraw"))}</button>`);
    if (me === "joined" && !ended) act.push(`<button type="button" class="btn block danger-ghost" data-act="leave">${esc(t("td.leave"))}</button>`);
    html.push(`<div class="section stack">${act.join("")}</div>`);

    // ---- members
    const visibleMembers = members.filter((m) => m.status === "joined" || (isHost && m.status === "requested"));
    if (visibleMembers.length) {
      html.push(`<div class="section"><h3>${esc(t("td.who"))}</h3><ul class="members">${visibleMembers
        .map((m) => {
          const isMe = m.user_id === state.session?.userId;
          const req = m.status === "requested";
          return `<li data-uid="${esc(m.user_id)}">
            <span class="av" aria-hidden="true">${esc(m.avatar_emoji)}</span>
            <span class="who"><strong>${esc(personName(m.display_name))}</strong>${m.role === "host" ? ` <span class="badge ok">${esc(t("td.hostTag"))}</span>` : ""}${isMe ? ` <span class="muted">(${esc(t("td.you"))})</span>` : ""}
              ${isHost && m.start_label ? `<small>📍 ${esc(m.start_label)}</small>` : ""}
              ${isHost && m.no_show_count > 0 ? `<small>⚠️ ${esc(t("td.noShows", { n: m.no_show_count }))}</small>` : ""}</span>
            ${req ? `<button type="button" class="btn sm primary" data-act="accept" data-uid="${esc(m.user_id)}">${esc(t("td.accept"))}</button><button type="button" class="btn sm" data-act="decline" data-uid="${esc(m.user_id)}">${esc(t("td.decline"))}</button>` : ""}
            ${isHost && !req && m.role !== "host" ? `<button type="button" class="btn sm ghost" data-act="remove" data-uid="${esc(m.user_id)}" data-name="${esc(m.display_name)}">${esc(t("td.remove"))}</button>${started ? `<button type="button" class="btn sm ghost" data-act="noshow" data-uid="${esc(m.user_id)}" data-name="${esc(m.display_name)}">${esc(t("td.noShow"))}</button>` : ""}` : ""}
            ${!isMe && m.role !== "host" && !tb.is_sample ? `<button type="button" class="btn sm ghost" data-act="report-user" data-uid="${esc(m.user_id)}" data-name="${esc(m.display_name)}" aria-label="${esc(t("td.reportUser", { name: m.display_name }))}">⚑</button>` : ""}
          </li>`;
        })
        .join("")}</ul></div>`);
    }

    // ---- photos
    if (isMember && !tb.is_sample) html.push(`<div class="section" id="photo-section">${photosHTML()}</div>`);

    // ---- venue / midpoint
    if (isHost && live) {
      const withStart = startingPoints();
      html.push(`<div class="section"><h3>${esc(t("td.findSpot"))}</h3>
        <p class="muted">${esc(withStart.length ? t("td.midpointHint", { n: withStart.length }) : t("td.noStarts"))}</p>
        <div class="row wrap-row"><button type="button" class="btn" data-act="suggest">${esc(t("td.suggest"))}</button>
          <a class="btn" target="_blank" rel="noopener" href="${esc(nearbyMapsLink())}">${esc(t("td.googleNearby"))}</a></div>
        <ul class="suggest" id="suggest-list" aria-live="polite">${suggestions ? suggestHTML(suggestions) : ""}</ul>
        <div style="margin-top:12px">${(() => {
          const ps = placeSearchHTML({ label: t("td.setVenue"), placeholder: t("td.venuePlaceholder"), hint: t("td.venueHint") });
          draw._vId = ps.id;
          return ps.html;
        })()}<button type="button" class="btn sm" data-act="set-venue" disabled id="venue-save">${esc(t("td.saveVenue"))}</button></div>
      </div>`);
    } else if (me === "joined" && mine?.start_lat != null && tb.meet_lat != null) {
      const km = haversineKm({ lat: mine.start_lat, lng: mine.start_lng }, { lat: tb.meet_lat, lng: tb.meet_lng });
      html.push(`<p class="muted">🚶 ${esc(t("td.fromYou", { km: km < 10 ? km.toFixed(1) : Math.round(km) }))}</p>`);
    }

    // ---- footer actions
    const foot = [];
    if (isMember && live) foot.push(`<button type="button" class="btn sm" data-act="ics">📅 ${esc(t("td.calendar"))}</button>`);
    foot.push(`<button type="button" class="btn sm" data-act="share">🔗 ${esc(t("td.share"))}</button>`);
    if (isMember && ended && !tb.is_sample) foot.push(`<button type="button" class="btn sm primary" data-act="reflect">✍️ ${esc(t("td.reflect"))}</button>`);
    if (api.mode === "demo" && isMember && live && !ended && !tb.is_sample) foot.push(`<button type="button" class="btn sm" data-act="ff" style="border-style:dashed">🧪 ${esc(t("td.demoFF"))}</button>`);
    if (!isHost && !tb.is_sample && tb.host_id) foot.push(`<button type="button" class="btn sm ghost" data-act="report-host">⚑ ${esc(t("td.reportHost"))}</button>`);
    if (isHost && live) foot.push(`<button type="button" class="btn sm danger-ghost" data-act="cancel">${esc(t("td.cancelTable"))}</button>`);
    html.push(`<div class="section row wrap-row">${foot.join("")}</div><div id="share-link" hidden></div>`);

    sheet.setHTML(html.join(""));
    wirePlaceSearches();
    if (isMember && !tb.is_sample) loadPhotos();
  }

  function photosHTML() {
    const grid = photos.length
      ? `<div class="photo-grid">${photos.map((p, i) => `<button type="button" class="ph" data-act="open-photo" data-i="${i}" aria-label="${esc(t("td.photoBy", { name: p.display_name }))}"><img src="${esc(p.url)}" alt="" loading="lazy"></button>`).join("")}</div>`
      : `<p class="muted">${esc(t("td.noPhotos"))}</p>`;
    return `<h3>📷 ${esc(t("td.photos"))}</h3><p class="hint" style="margin:0 0 10px">${esc(t("td.photosHint"))}</p>${grid}
      <div style="margin-top:10px"><button type="button" class="btn sm" data-act="add-photo" ${uploading || photos.length >= 12 ? "disabled" : ""}>＋ ${esc(t("td.addPhotos"))}</button>
      <input id="ph-input" type="file" accept="image/*" multiple hidden></div>`;
  }

  async function loadPhotos() {
    const box = qs("#photo-section", sheet.body);
    if (!box) return;
    try {
      photos = await api.listPhotos(tb.id);
    } catch (e) {
      photos = [];
      console.warn(e);
    }
    if (!sheet.closed && qs("#photo-section", sheet.body)) qs("#photo-section", sheet.body).innerHTML = photosHTML();
  }

  async function uploadFiles(files) {
    const list = [...files].slice(0, Math.max(0, 12 - photos.length));
    if (!list.length) return toast(t("err.too_many_photos"), { kind: "error" });
    uploading = true;
    let done = 0;
    for (const [i, f] of list.entries()) {
      const btn = qs('[data-act="add-photo"]', sheet.body);
      if (btn) {
        btn.disabled = true;
        btn.textContent = t("td.uploading", { i: i + 1, n: list.length });
      }
      try {
        const blob = await resizeImage(f, { max: api.mode === "demo" ? 1000 : 1280, quality: api.mode === "demo" ? 0.7 : 0.78 });
        await api.addPhoto(tb.id, blob);
        done++;
      } catch (e) {
        showError(e);
        if (["storage_full", "too_many_photos"].includes(e.code)) break;
      }
    }
    uploading = false;
    if (done) {
      toast(t("td.photoAdded", { n: done }));
      announce(t("td.photoAdded", { n: done }));
    }
    if (!sheet.closed) await loadPhotos();
  }

  function openPhoto(i) {
    const p = photos[i];
    if (!p) return;
    const before = document.activeElement;
    const el = document.createElement("div");
    el.className = "dialog-backdrop lightbox";
    el.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(t("td.photoBy", { name: p.display_name }))}">
      <img src="${esc(p.url)}" alt="${esc(t("td.photoBy", { name: p.display_name }))}">
      <div class="row" style="margin-top:10px"><span class="av" aria-hidden="true">${esc(p.avatar_emoji)}</span><span class="who">${esc(p.display_name)}</span><span class="spacer"></span>
        ${p.mine ? `<button type="button" class="btn sm danger-ghost" data-del>${esc(t("common.delete"))}</button>` : ""}<button type="button" class="btn sm" data-x>${esc(t("common.close"))}</button></div></div>`;
    const done = () => (el.remove(), before?.focus?.({ preventScroll: true }));
    el.addEventListener("click", (e) => e.target === el && done());
    el.addEventListener("keydown", (e) => e.key === "Escape" && (e.stopPropagation(), done()));
    qs("[data-x]", el).addEventListener("click", done);
    qs("[data-del]", el)?.addEventListener("click", async () => {
      const ok = await confirmDialog({ title: t("td.deletePhotoQ"), body: t("td.deletePhotoBody"), confirmLabel: t("common.delete"), danger: true });
      if (!ok) return;
      try {
        await api.deletePhoto(p.id);
        done();
        toast(t("td.photoDeleted"));
        await loadPhotos();
      } catch (e) {
        showError(e);
      }
    });
    document.body.appendChild(el);
    qs("[data-x]", el).focus();
  }

  function suggestHTML(list) {
    if (list === "loading") return `<li>${esc(t("ps.searching"))}</li>`;
    if (list === "error" || !list.length) {
      return `<li>${esc(t(list === "error" ? "td.suggestError" : "td.suggestNone"))}</li>`;
    }
    return list
      .map(
        (r, i) => `<li><span class="who"><strong>${esc(r.name)}</strong><small>${esc(r.address || r.cuisine || "")} · ${esc(t("td.fromMiddle", { km: r.distKm.toFixed(1) }))}</small></span>
          <a class="btn sm ghost" href="${esc(mapsUrl(r))}" target="_blank" rel="noopener">⭐ ${esc(t("map.reviews"))}</a>
          <button type="button" class="btn sm" data-act="use-venue" data-i="${i}">${esc(t("td.useVenue"))}</button></li>`
      )
      .join("");
  }

  let venuePick = null;
  function wirePlaceSearches() {
    const near = tb.meet_lat != null ? { lat: tb.meet_lat, lng: tb.meet_lng } : undefined;
    if (draw._psId && qs(`#${draw._psId}`, sheet.body)) {
      bindPlaceSearch(sheet.body, { id: draw._psId, near, onSelect: (p) => (startPick = p), onClear: () => (startPick = null) });
    }
    if (draw._vId && qs(`#${draw._vId}`, sheet.body)) {
      venuePick = null;
      bindPlaceSearch(sheet.body, {
        id: draw._vId,
        near: restaurantCenter(),
        restaurantsOnly: true,
        onSelect: (p) => {
          venuePick = p;
          qs("#venue-save", sheet.body).disabled = false;
        },
        onClear: () => {
          venuePick = null;
          const b = qs("#venue-save", sheet.body);
          if (b) b.disabled = true;
        },
      });
    }
    draw._psId = draw._vId = null;
  }

  function detailsPayload() {
    const o = {
      intention: qs("#d-int", sheet.body)?.value || null,
      pace: qs("#d-pace", sheet.body)?.value || null,
    };
    if (startPick) Object.assign(o, { start_label: startPick.name, start_lat: startPick.lat, start_lng: startPick.lng });
    else if (startPick === undefined && tb.my_membership) Object.assign(o, { start_label: tb.my_membership.start_label, start_lat: tb.my_membership.start_lat, start_lng: tb.my_membership.start_lng });
    return o;
  }

  async function mutate(btn, fn, okMsg) {
    try {
      await withBusy(btn, fn);
      if (okMsg) {
        toast(okMsg);
        announce(okMsg);
      }
      bus.emit("tables-changed");
    } catch (e) {
      showError(e);
    }
    if (!sheet.closed) await reload();
  }

  sheet.body.addEventListener("change", (e) => {
    if (e.target.id === "ph-input" && e.target.files?.length) {
      const files = e.target.files;
      uploadFiles(files).then(() => (e.target.value = ""));
    }
  });

  sheet.body.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    const uidOf = btn.dataset.uid;
    switch (act) {
      case "close":
        sheet.close("button");
        break;
      case "join":
        await mutate(btn, async () => {
          const r = await api.requestJoin(tb.id, detailsPayload());
          toast(r.status === "joined" ? t("td.joined") : t("td.requested"));
        });
        break;
      case "save-details":
        await mutate(btn, () => api.updateMembership(tb.id, detailsPayload()), t("td.saved"));
        break;
      case "leave": {
        const ok = await confirmDialog({ title: t(tb.my_status === "requested" ? "td.withdrawQ" : "td.leaveQ"), body: t("td.leaveBody"), confirmLabel: t("td.leaveYes"), danger: true });
        if (ok) await mutate(btn, () => api.leaveTable(tb.id), t("td.left"));
        break;
      }
      case "accept":
        await mutate(btn, () => api.respondJoin(tb.id, uidOf, true), t("td.accepted"));
        break;
      case "decline":
        await mutate(btn, () => api.respondJoin(tb.id, uidOf, false), t("td.declinedToast"));
        break;
      case "remove": {
        const ok = await confirmDialog({ title: t("td.removeQ", { name: btn.dataset.name }), body: t("td.removeBody"), confirmLabel: t("td.remove"), danger: true });
        if (ok) await mutate(btn, () => api.removeMember(tb.id, uidOf), t("td.removed"));
        break;
      }
      case "noshow": {
        const ok = await confirmDialog({ title: t("td.noShowQ", { name: btn.dataset.name }), body: t("td.noShowBody"), confirmLabel: t("td.noShow"), danger: true });
        if (ok) await mutate(btn, () => api.markNoShow(tb.id, uidOf), t("td.noShowDone"));
        break;
      }
      case "cancel": {
        const ok = await confirmDialog({ title: t("td.cancelQ"), body: t("td.cancelBody"), confirmLabel: t("td.cancelYes"), cancelLabel: t("td.keep"), danger: true });
        if (ok) await mutate(btn, () => api.cancelTable(tb.id), t("td.cancelDone"));
        break;
      }
      case "suggest": {
        if (suggestions === "loading") break;
        const box = qs("#suggest-list", sheet.body);
        suggestions = "loading";
        btn.disabled = true;
        box.innerHTML = suggestHTML(suggestions);
        try {
          suggestions = await restaurantsNear(restaurantCenter(), tb.cuisine);
        } catch {
          suggestions = "error";
        } finally {
          btn.disabled = false;
        }
        if (!sheet.closed) qs("#suggest-list", sheet.body).innerHTML = suggestHTML(suggestions);
        break;
      }
      case "use-venue": {
        const r = suggestions[Number(btn.dataset.i)];
        await mutate(btn, () => api.setVenue(tb.id, { name: r.name, address: r.address, lat: r.lat, lng: r.lng, poi_id: r.poi_id }), t("td.venueSet"));
        break;
      }
      case "set-venue":
        if (venuePick) await mutate(btn, () => api.setVenue(tb.id, { name: venuePick.name, address: venuePick.address, lat: venuePick.lat, lng: venuePick.lng, poi_id: venuePick.poi_id }), t("td.venueSet"));
        break;
      case "ics": {
        const loc = [tb.venue?.name || tb.area_label, tb.venue?.address].filter(Boolean).join(", ");
        downloadText("table-and-bloom.ics", buildICS({ id: tb.id, title: tableTitle(tb), startsAt: tb.starts_at, durationMin: 90, location: loc, description: tb.note || "Table & Bloom" }));
        break;
      }
      case "share": {
        const url = invitationUrl(tb, tableTitle(tb), { demo: api.mode === "demo" });
        const panel = qs("#share-link", sheet.body);
        panel.hidden = false;
        panel.innerHTML = `<label class="lbl" for="invite-url">${esc(t("invite.link"))}</label>
          <input id="invite-url" type="url" readonly value="${esc(url)}">
          <button type="button" class="btn sm" id="copy-invite">${esc(t("invite.copy"))}</button>`;
        const input = qs("#invite-url", panel);
        const copy = async () => {
          try {
            await navigator.clipboard.writeText(url);
            toast(t("td.copied"));
          } catch {
            input.focus();
            input.select();
          }
        };
        qs("#copy-invite", panel).onclick = copy;
        if (navigator.share) {
          try {
            await navigator.share({ title: tableTitle(tb), url });
          } catch (error) {
            if (error.name !== "AbortError") await copy();
          }
        } else await copy();
        break;
      }
      case "reflect": {
        const { openReflectForm } = await import("./reflect.js");
        closeSheet({ silent: true });
        history.replaceState(null, "", `#${state.baseView}`);
        openReflectForm({ table_id: tb.id, table_title: tableTitle(tb), onSaved: () => go("#journal") });
        break;
      }
      case "add-photo":
        qs("#ph-input", sheet.body)?.click();
        break;
      case "open-photo":
        openPhoto(Number(btn.dataset.i));
        break;
      case "ff":
        await mutate(btn, () => api.demoFastForward(tb.id), t("td.demoFFDone"));
        break;
      case "report-host":
        await askReport({ table_id: tb.id, user_id: tb.host_id, name: tb.host?.display_name });
        break;
      case "report-user":
        await askReport({ table_id: tb.id, user_id: uidOf, name: btn.dataset.name });
        break;
    }
  });

  await reload();

  // Keep an open sheet fresh: the host can change the venue, or guests can join, while someone is looking at it.
  const signature = (x) => JSON.stringify([
    x.venue?.id, x.venue?.name, x.area_label, x.status, x.seats_taken, x.my_status, x.starts_at, x.capacity,
    (x.members || []).map((m) => [m.user_id, m.status, m.start_lat, m.start_lng]),
  ]);
  async function refreshQuietly() {
    if (sheet.closed || !tb || uploading || document.visibilityState !== "visible") return;
    let fresh;
    try {
      fresh = await api.getTable(id);
    } catch {
      return;
    }
    if (sheet.closed || signature(fresh) === signature(tb)) return;
    // Never wipe something the person is typing or choosing; try again on the next tick.
    const el = document.activeElement;
    const typing = sheet.body.contains(el) && /^(INPUT|TEXTAREA)$/.test(el.tagName) && el.value;
    if (typing || startPick || venuePick) return;
    const venueChanged = (fresh.venue?.id || null) !== (tb.venue?.id || null);
    tb = fresh;
    draw();
    if (venueChanged && tb.my_status !== "host" && tb.venue?.name) toast(t("td.venueChanged", { name: tb.venue.name }));
  }
  const offLive = api.onLive?.((p) => {
    if (sheet.closed) offLive?.();
    else if (!p.table || p.table === id) refreshQuietly();
  });
  const timer = setInterval(() => {
    if (sheet.closed) {
      clearInterval(timer);
      offLive?.();
    } else refreshQuietly();
  }, 10000);
  const onVisible = () => {
    if (sheet.closed) document.removeEventListener("visibilitychange", onVisible);
    else if (document.visibilityState === "visible") refreshQuietly();
  };
  document.addEventListener("visibilitychange", onVisible);
  return sheet;
}

/** Report dialog (reason + optional note + optional block). */
export function askReport({ table_id, user_id, name }) {
  return new Promise((resolve) => {
    const before = document.activeElement;
    const el = document.createElement("div");
    el.className = "dialog-backdrop";
    el.innerHTML = `
      <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="rp-t" style="max-height:90vh;overflow:auto">
        <h3 id="rp-t">${esc(t("rep.title", { name: name || "" }))}</h3>
        <fieldset class="seg"><legend class="sr-only">${esc(t("rep.reason"))}</legend>
          ${REPORT_REASONS.map((r, i) => `<label><input type="radio" name="reason" value="${r}" ${i === 0 ? "checked" : ""}> <span>${esc(t("rep." + r))}</span></label>`).join("")}
        </fieldset>
        <div class="field"><label for="rp-d">${esc(t("rep.details"))}</label><textarea id="rp-d" maxlength="1000"></textarea></div>
        ${user_id ? `<label class="row" style="margin-bottom:8px"><input type="checkbox" name="block" style="width:20px;height:20px;accent-color:var(--green-700)"> <span>${esc(t("rep.alsoBlock", { name: name || "" }))}</span></label>` : ""}
        <p class="hint">${esc(t("rep.note"))}</p>
        <div class="dialog-actions"><button type="button" class="btn ghost" data-no>${esc(t("common.cancel"))}</button><button type="submit" class="btn danger">${esc(t("rep.send"))}</button></div>
      </form>`;
    const done = (v) => {
      el.remove();
      before?.focus?.({ preventScroll: true });
      resolve(v);
    };
    el.addEventListener("click", (e) => e.target === el && done(false));
    el.addEventListener("keydown", (e) => e.key === "Escape" && (e.stopPropagation(), done(false)));
    qs("[data-no]", el).addEventListener("click", () => done(false));
    qs("form", el).addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = qs('[type="submit"]', el);
      btn.disabled = true;
      try {
        await api.reportContent({ table_id, user_id, reason: fd.get("reason"), details: qs("#rp-d", el).value });
        if (fd.get("block") && user_id) await api.blockUser(user_id);
        toast(fd.get("block") ? t("rep.doneBlocked") : t("rep.done"));
        bus.emit("tables-changed");
        done(true);
      } catch (err) {
        btn.disabled = false;
        showError(err);
      }
    });
    document.body.appendChild(el);
    qs("input", el).focus();
  });
}
