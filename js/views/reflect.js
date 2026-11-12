// Journal: private reflections after a meal. Nobody else can see these.
import { esc, qs, qsa, fmtDay, todayStr } from "../util.js";
import { t } from "../i18n.js";
import { state, cuisineOf } from "../state.js";
import { api } from "../api.js";
import { openSheet, closeSheet, toast, announce } from "../ui.js";
import { MOODS } from "../data.js";
import { showError, withBusy } from "./common.js";

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export async function render(root) {
  let alive = true;
  root.innerHTML = `<h1>${esc(t("jr.title"))}</h1><div class="skeleton"></div>`;
  let items = [];
  try {
    items = await api.listReflections();
  } catch (e) {
    showError(e);
  }
  if (!alive) return;

  const moods = items.map((x) => x.mood).filter(Boolean);
  const avgMood = avg(moods);

  function paint() {
    const moodsNow = items.map((x) => x.mood).filter(Boolean);
    const am = avg(moodsNow);
    root.innerHTML = `
      <div class="row wrap-row" style="margin-bottom:6px"><h1 style="margin:0">${esc(t("jr.title"))}</h1><span class="spacer"></span><button type="button" class="btn primary" id="add">＋ ${esc(t("jr.add"))}</button></div>
      <p class="muted">🔒 ${esc(t("jr.private"))}</p>
      <div class="stats">
        <div class="stat"><b>${items.length}</b><span>${esc(t("jr.statCount"))}</span></div>
        <div class="stat"><b>${am ? MOODS[Math.round(am) - 1] : "–"}</b><span>${esc(t("jr.statMood"))}</span></div>
        <div class="stat"><b>${items.filter((x) => x.next_step).length}</b><span>${esc(t("jr.statNext"))}</span></div>
      </div>
      <div id="entries">${
        items.length
          ? items.map(entryHTML).join("")
          : `<div class="empty"><div class="big" aria-hidden="true">📖</div><p>${esc(t("jr.empty"))}</p></div>`
      }</div>`;
    qs("#add", root).addEventListener("click", () => openReflectForm({ onSaved: refresh }));
    qsa("[data-edit]", root).forEach((b) => b.addEventListener("click", () => openReflectForm({ existing: items.find((x) => x.id === b.dataset.edit), onSaved: refresh })));
    qsa("[data-del]", root).forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          const removed = await api.deleteReflection(b.dataset.del);
          await refresh();
          toast(t("jr.deleted"), {
            actionLabel: t("common.undo"),
            duration: 7000,
            onAction: async () => {
              try {
                await api.saveReflection({ ...removed, id: undefined });
                await refresh();
              } catch (e) {
                showError(e);
              }
            },
          });
        } catch (e) {
          showError(e);
        }
      })
    );
  }

  async function refresh() {
    if (!alive) return;
    try {
      items = await api.listReflections();
    } catch (e) {
      showError(e);
    }
    paint();
  }

  const entryHTML = (x) => `
    <article class="card entry">
      <div class="row"><strong>${esc(x.table_title || t("jr.freeEntry"))}</strong><span class="spacer"></span><span class="when">${esc(fmtDay(x.on_date))}</span></div>
      <div class="scores">
        ${x.mood ? `<span>${esc(t("jr.mood"))}: ${MOODS[x.mood - 1]}</span>` : ""}
        ${x.food_enjoyment ? `<span>🍽️ ${esc(t("jr.food"))}: ${x.food_enjoyment}/5</span>` : ""}
        ${x.conversation_comfort ? `<span>💬 ${esc(t("jr.comfort"))}: ${x.conversation_comfort}/5</span>` : ""}
      </div>
      ${x.takeaway ? `<blockquote>${esc(x.takeaway)}</blockquote>` : ""}
      ${x.next_step ? `<p><strong>${esc(t("jr.next"))}:</strong> ${esc(x.next_step)}</p>` : ""}
      <div class="row"><button type="button" class="btn sm ghost" data-edit="${esc(x.id)}">${esc(t("common.edit"))}</button><button type="button" class="btn sm danger-ghost" data-del="${esc(x.id)}">${esc(t("common.delete"))}</button></div>
    </article>`;

  paint();
  return () => (alive = false);
}

function rate(name, value) {
  return `<div class="rate" role="radiogroup">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="${name}" value="${n}" ${Number(value) === n ? "checked" : ""}><span>${n}</span></label>`).join("")}</div>`;
}

/** Add or edit a reflection. `prefill` links it to a table; `existing` edits an entry. */
export function openReflectForm({ existing, table_id, table_title, onSaved } = {}) {
  const x = existing || {};
  const sheet = openSheet({
    label: t("jr.formLabel"),
    html: `
    <h2>${esc(existing ? t("jr.edit") : t("jr.new"))}</h2>
    ${table_title || x.table_title ? `<p class="muted">🍽️ ${esc(table_title || x.table_title)}</p>` : ""}
    <p class="hint">🔒 ${esc(t("jr.private"))}</p>
    <form id="rf" novalidate>
      <div class="field"><label for="rf-date">${esc(t("jr.date"))}</label><input id="rf-date" type="date" max="${todayStr()}" value="${esc(x.on_date || todayStr())}"></div>
      <fieldset><legend>${esc(t("jr.moodQ"))}</legend><div class="rate moods" role="radiogroup">${MOODS.map((m, i) => `<label><input type="radio" name="mood" value="${i + 1}" ${x.mood === i + 1 ? "checked" : ""}><span aria-label="${i + 1}">${m}</span></label>`).join("")}</div></fieldset>
      <fieldset><legend>${esc(t("jr.foodQ"))}</legend>${rate("food", x.food_enjoyment)}</fieldset>
      <fieldset><legend>${esc(t("jr.comfortQ"))}</legend>${rate("comfort", x.conversation_comfort)}</fieldset>
      <div class="field"><label for="rf-take">${esc(t("jr.takeQ"))}</label><textarea id="rf-take" maxlength="500">${esc(x.takeaway || "")}</textarea></div>
      <div class="field"><label for="rf-next">${esc(t("jr.nextQ"))}</label><textarea id="rf-next" maxlength="500" style="min-height:64px">${esc(x.next_step || "")}</textarea></div>
      <button type="submit" class="btn primary block">${esc(t("common.save"))}</button>
    </form>`,
  });
  qs("#rf", sheet.body).addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const num = (k) => (fd.get(k) ? Number(fd.get(k)) : null);
    const payload = {
      id: x.id,
      table_id: x.table_id || table_id || null,
      table_title: x.table_title || table_title || null,
      on_date: qs("#rf-date", sheet.body).value || todayStr(),
      mood: num("mood"),
      food_enjoyment: num("food"),
      conversation_comfort: num("comfort"),
      takeaway: qs("#rf-take", sheet.body).value.trim(),
      next_step: qs("#rf-next", sheet.body).value.trim(),
      created_at: x.created_at,
    };
    if (!payload.mood && !payload.food_enjoyment && !payload.conversation_comfort && !payload.takeaway && !payload.next_step) {
      qs("#rf-take", sheet.body).focus();
      return toast(t("jr.needSomething"), { kind: "error" });
    }
    try {
      await withBusy(qs('[type="submit"]', sheet.body), () => api.saveReflection(payload));
      closeSheet({ silent: true });
      toast(t("jr.saved"));
      announce(t("jr.saved"));
      onSaved?.();
    } catch (err) {
      showError(err);
    }
  });
  return sheet;
}
