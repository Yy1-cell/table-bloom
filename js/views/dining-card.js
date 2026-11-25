// "My dining profile" card (shown on the Journal page): built only from my own post-meal check-ins.
import { esc, personName } from "../util.js";
import { t } from "../i18n.js";
import { cuisineOf } from "../state.js";
import { OCCASIONS, FORMATS, VENUE_TYPES } from "../data.js";
import { nameOf } from "./common.js";

const row = (label, value) => (value ? `<div class="dp-row"><span class="dp-k">${esc(label)}</span><span class="dp-v">${value}</span></div>` : "");

export function diningCardHTML(p) {
  if (!p || !p.n) {
    return `<section class="card dp"><h2>🌱 ${esc(t("dp.title"))}</h2><p class="muted">${esc(t("dp.empty"))}</p></section>`;
  }
  const cuisines = p.eatMost
    .map((e) => {
      const c = cuisineOf(e.key);
      return `<span class="tag">${c ? esc(c.emoji) + " " + esc(nameOf(c)) : esc(e.key)} × ${e.n}</span>`;
    })
    .join(" ");
  const styles = (p.styleMost || [])
    .map((e) => {
      const o = (e.kind === "fm" ? FORMATS : VENUE_TYPES).find((x) => x.slug === e.key);
      return o ? `<span class="tag">${esc(o.emoji)} ${esc(t((e.kind === "fm" ? "fm." : "vt.") + o.slug))} × ${e.n}</span>` : "";
    })
    .join(" ");
  const occ = p.bestOccasion && OCCASIONS.find((o) => o.slug === p.bestOccasion.key);
  const lift = p.lift == null ? "" : `<b>${p.lift > 0 ? "+" : ""}${p.lift.toFixed(1)}</b>`;
  return `<section class="card dp">
    <h2>🌱 ${esc(t("dp.title"))}</h2>
    <p class="hint" style="margin-top:0">🔒 ${esc(t("dp.private"))} ${esc(t("dp.count", { n: p.n }))}</p>
    ${row(t("dp.eatMost"), cuisines)}
    ${row(t("dp.styleMost"), styles)}
    ${row(t("dp.relaxed"), occ ? `<span class="tag occ">${esc(occ.emoji)} ${esc(t("oc." + occ.slug))}</span>` : "")}
    ${row(t("dp.size"), p.bestSize ? `<span class="tag">${esc(t("dp.size." + p.bestSize.key))}</span>` : "")}
    ${row(t("dp.time"), p.bestTime ? `<span class="tag">${esc(t("dp.time." + p.bestTime.key))}</span>` : "")}
    ${row(t("dp.vibes"), p.topVibes.map((v) => `<span class="tag">${esc(t("vibe." + v))}</span>`).join(" "))}
    ${row(t("dp.lift"), lift)}
    ${p.n < 3 ? `<p class="hint">${esc(t("dp.few", { n: p.n }))}</p>` : ""}
  </section>`;
}

/** "New friends I'd eat with again": people I marked in a check-in. Private; "mutual" means they marked me too. */
export function againPeopleHTML(list = []) {
  const head = `<h2>💚 ${esc(t("again.title"))}</h2><p class="hint" style="margin-top:0">🔒 ${esc(t("again.privacyShort"))}</p>`;
  if (!list.length) return `<section class="card dp">${head}<p class="muted">${esc(t("again.empty"))}</p></section>`;
  return `<section class="card dp">${head}<ul class="again-list">${list
    .map(
      (p) => `<li><span class="av" aria-hidden="true">${esc(p.avatar_emoji || "🍽️")}</span>
        <span class="who"><strong>${esc(personName(p.display_name))}</strong>${p.mutual ? ` <span class="tag occ">✨ ${esc(t("again.mutual"))}</span>` : ""}
          <small class="muted">${esc(t("again.meta", { n: p.times }))}${p.last_title ? " · " + esc(p.last_title) : ""}</small></span></li>`
    )
    .join("")}</ul></section>`;
}
