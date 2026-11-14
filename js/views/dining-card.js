// "My dining profile" card (shown on the Journal page): built only from my own post-meal check-ins.
import { esc } from "../util.js";
import { t } from "../i18n.js";
import { cuisineOf } from "../state.js";
import { OCCASIONS } from "../data.js";
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
  const occ = p.bestOccasion && OCCASIONS.find((o) => o.slug === p.bestOccasion.key);
  const lift = p.lift == null ? "" : `<b>${p.lift > 0 ? "+" : ""}${p.lift.toFixed(1)}</b>`;
  return `<section class="card dp">
    <h2>🌱 ${esc(t("dp.title"))}</h2>
    <p class="hint" style="margin-top:0">🔒 ${esc(t("dp.private"))} ${esc(t("dp.count", { n: p.n }))}</p>
    ${row(t("dp.eatMost"), cuisines)}
    ${row(t("dp.relaxed"), occ ? `<span class="tag occ">${esc(occ.emoji)} ${esc(t("oc." + occ.slug))}</span>` : "")}
    ${row(t("dp.size"), p.bestSize ? `<span class="tag">${esc(t("dp.size." + p.bestSize.key))}</span>` : "")}
    ${row(t("dp.time"), p.bestTime ? `<span class="tag">${esc(t("dp.time." + p.bestTime.key))}</span>` : "")}
    ${row(t("dp.vibes"), p.topVibes.map((v) => `<span class="tag">${esc(t("vibe." + v))}</span>`).join(" "))}
    ${row(t("dp.lift"), lift)}
    ${p.n < 3 ? `<p class="hint">${esc(t("dp.few", { n: p.n }))}</p>` : ""}
  </section>`;
}
