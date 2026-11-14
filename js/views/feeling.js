// Post-meal 30-second check-in: how the meal felt. The overall feeling and positive tags are shared with the
// table (only after you have shared yours); mood, private tags, note and "eat with again" picks stay private.
import { esc, qs, qsa, personName } from "../util.js";
import { t } from "../i18n.js";
import { state } from "../state.js";
import { api } from "../api.js";
import { openSheet, closeSheet, toast, announce } from "../ui.js";
import { MOODS, FEELS, VIBES_PUBLIC, VIBES_PRIVATE, PEER_SIGNALS } from "../data.js";
import { showError, withBusy } from "./common.js";

/** The "How the table felt" block inside the table sheet. `f` is the result of api.getFeelings (null while loading). */
export function feelingSectionHTML(f, { canWrite = true } = {}) {
  if (!f) return `<h3>🌿 ${esc(t("fb.sectionTitle"))}</h3><div class="skeleton" style="height:56px"></div>`;
  const tags = (arr) => (arr || []).map((v) => `<span class="tag">${esc(t("vibe." + v))}</span>`).join("");
  let body;
  if (!f.mine) {
    body = `<p class="muted">${esc(t("fb.intro"))}</p>
      ${canWrite ? `<button type="button" class="btn primary" data-act="feel">⏱ ${esc(t("fb.cta"))}</button>` : ""}
      ${f.waiting ? `<p class="hint">${esc(t("fb.waiting", { n: f.waiting }))}</p>` : ""}`;
  } else {
    const others = f.others || [];
    body = `<ul class="feels">
      <li class="feel me"><span class="fe" aria-hidden="true">${FEELS[f.mine.overall - 1]}</span><span class="who"><strong>${esc(t("fb.mine"))}</strong>${f.mine.shared === false ? ` <span class="muted">🔒</span>` : ""}<span class="tags">${tags((f.mine.vibes || []).filter((v) => VIBES_PUBLIC.includes(v)))}</span></span></li>
      ${others
        .map((o) => `<li class="feel"><span class="fe" aria-hidden="true">${FEELS[o.overall - 1]}</span><span class="who"><strong>${esc(personName(o.display_name))}</strong><span class="tags">${tags(o.vibes)}</span></span></li>`)
        .join("")}
      </ul>
      ${!others.length ? `<p class="muted">${esc(t("fb.noOthers"))}</p>` : ""}
      ${f.waiting ? `<p class="hint">${esc(t("fb.waiting", { n: f.waiting }))}</p>` : ""}
      ${canWrite ? `<button type="button" class="btn sm" data-act="feel">✏️ ${esc(t("fb.edit"))}</button>` : ""}`;
  }
  return `<h3>🌿 ${esc(t("fb.sectionTitle"))}</h3>${body}<p class="hint">${esc(t("fb.lockHint"))}</p>`;
}

const rateRow = (name, labels, value, cls = "moods") =>
  `<div class="rate ${cls}" role="radiogroup">${labels.map((m, i) => `<label><input type="radio" name="${name}" value="${i + 1}" ${value === i + 1 ? "checked" : ""}><span aria-label="${i + 1}">${m}</span></label>`).join("")}</div>`;

/** Open the check-in sheet for a table I was at. Loads the member list and any earlier check-in itself. */
export async function openFeelingForm({ table_id, title = "", onSaved } = {}) {
  let tb;
  let data;
  try {
    [tb, data] = await Promise.all([api.getTable(table_id), api.getFeelings(table_id)]);
  } catch (e) {
    return showError(e);
  }
  const mine = data.mine || {};
  const peers = (tb.members || []).filter((m) => m.status === "joined" && m.user_id !== (state.me?.id || state.session?.userId));
  const vibeSet = new Set(mine.vibes || []);
  const peerPick = { ...(data.peers || {}) };
  const chip = (v) => `<button type="button" class="chip" data-vibe="${v}" aria-pressed="${vibeSet.has(v)}">${esc(t("vibe." + v))}</button>`;

  const sheet = openSheet({
    label: t("fb.label"),
    html: `
    <h2>⏱ ${esc(t("fb.quick"))}</h2>
    ${title ? `<p class="muted">🍽️ ${esc(title)}</p>` : ""}
    <p class="hint">🔒 ${esc(t("fb.privacy"))}</p>
    <form id="ff" novalidate>
      <fieldset><legend>${esc(t("fb.overallQ"))}</legend>${rateRow("overall", FEELS, mine.overall)}</fieldset>
      <div class="row wrap-row" style="gap:18px">
        <fieldset><legend>${esc(t("fb.moodBeforeQ"))} <small class="muted">· ${esc(t("fb.optional"))}</small></legend>${rateRow("before", MOODS, mine.mood_before)}</fieldset>
        <fieldset><legend>${esc(t("fb.moodAfterQ"))} <small class="muted">· ${esc(t("fb.optional"))}</small></legend>${rateRow("after", MOODS, mine.mood_after)}</fieldset>
      </div>
      <fieldset><legend>${esc(t("fb.vibesQ"))}</legend>
        <div class="chips" id="ff-vibes">${VIBES_PUBLIC.map((v) => chip(v)).join("")}</div>
        <p class="hint" style="margin:10px 0 6px">🔒 ${esc(t("fb.vibesPrivate"))}</p>
        <div class="chips" id="ff-vibes-priv">${VIBES_PRIVATE.map((v) => chip(v)).join("")}</div>
      </fieldset>
      ${
        peers.length
          ? `<fieldset><legend>${esc(t("fb.peersQ"))}</legend><ul class="peer-list">${peers
              .map(
                (m) => `<li><span class="av" aria-hidden="true">${esc(m.avatar_emoji || "🍽️")}</span><span class="nm">${esc(personName(m.display_name))}</span>
                  <span class="chips" role="group" aria-label="${esc(personName(m.display_name))}">${PEER_SIGNALS.map((s) => `<button type="button" class="chip sm" data-peer="${esc(m.user_id)}" data-sig="${s.slug}" aria-pressed="${peerPick[m.user_id] === s.slug}"><span aria-hidden="true">${s.emoji}</span> ${esc(t("peer." + s.slug))}</button>`).join("")}</span></li>`
              )
              .join("")}</ul></fieldset>`
          : ""
      }
      <div class="field"><label for="ff-note">${esc(t("fb.noteQ"))} <small class="muted">· ${esc(t("fb.optional"))}</small></label><textarea id="ff-note" maxlength="300" style="min-height:56px">${esc(mine.note || "")}</textarea></div>
      <label class="check"><input type="checkbox" id="ff-shared" ${mine.shared === false ? "" : "checked"}> <span>${esc(t("fb.shared"))}</span></label>
      <button type="submit" class="btn primary block" style="margin-top:12px">${esc(t("common.save"))}</button>
    </form>`,
  });

  const body = sheet.body;
  const toggleVibe = (e) => {
    const b = e.target.closest("[data-vibe]");
    if (!b) return;
    const v = b.dataset.vibe;
    if (vibeSet.has(v)) vibeSet.delete(v);
    else vibeSet.add(v);
    b.setAttribute("aria-pressed", String(vibeSet.has(v)));
  };
  qs("#ff-vibes", body).addEventListener("click", toggleVibe);
  qs("#ff-vibes-priv", body).addEventListener("click", toggleVibe);
  qsa("[data-peer]", body).forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.peer;
      peerPick[id] = peerPick[id] === b.dataset.sig ? null : b.dataset.sig;
      qsa(`[data-peer="${CSS.escape(id)}"]`, body).forEach((x) => x.setAttribute("aria-pressed", String(peerPick[id] === x.dataset.sig)));
    })
  );

  qs("#ff", body).addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const num = (k) => (fd.get(k) ? Number(fd.get(k)) : null);
    const overall = num("overall");
    if (!overall) return toast(t("fb.needOverall"), { kind: "error" });
    const payload = {
      table_id,
      overall,
      mood_before: num("before"),
      mood_after: num("after"),
      vibes: [...vibeSet],
      note: qs("#ff-note", body).value.trim(),
      shared: qs("#ff-shared", body).checked,
      peers: peers.map((m) => ({ user_id: m.user_id, signal: peerPick[m.user_id] || null })),
    };
    try {
      await withBusy(qs('[type="submit"]', body), () => api.saveFeeling(payload));
      state.diningProfile = undefined;
      closeSheet({ silent: true });
      toast(t("fb.saved"));
      announce(t("fb.saved"));
      onSaved?.();
    } catch (err) {
      showError(err);
    }
  });
  return sheet;
}
