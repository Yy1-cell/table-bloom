// Dietary needs UI. Two tiers:
//  - fixed  ("I never eat…", allergies): saved once on the profile (profiles.dietary_tags)
//  - meal   ("light today", "no spicy"): only for the table you're at (table_members.diet_tags)
// At a table, the fixed ones are pre-selected (🔒) so one tap applies them; you can add meal ones or untick a fixed one for this meal.
import { esc } from "../util.js";
import { t } from "../i18n.js";
import { DIET_FIXED, DIET_MEAL } from "../data.js";

const KNOWN = new Map([...DIET_FIXED, ...DIET_MEAL].map((d) => [d.slug, d]));
export const isAllergy = (slug) => !!KNOWN.get(slug)?.allergy;
export const dietLabel = (slug) => (KNOWN.has(slug) ? `${KNOWN.get(slug).emoji} ${t("dt." + slug)}` : "");

const chip = (d, on, extra = "") =>
  `<button type="button" class="chip sm${d.allergy ? " allergy" : ""}" data-diet="${d.slug}" aria-pressed="${on}"${extra}>${d.emoji} ${esc(t("dt." + d.slug))}</button>`;

// Profile page: the fixed list only.
export function fixedPickerHTML(selected) {
  const sel = new Set(selected || []);
  return `<div class="chips" id="pf-diet-chips">${DIET_FIXED.map((d) => chip(d, sel.has(d.slug))).join("")}</div>`;
}

// At a table: my fixed ones first (pre-selected), then "this meal" chips, then everything else folded away.
export function mealPickerHTML(selected, fixed) {
  const sel = new Set(selected || []);
  const fx = DIET_FIXED.filter((d) => (fixed || []).includes(d.slug));
  const rest = DIET_FIXED.filter((d) => !(fixed || []).includes(d.slug));
  return `<div class="diet-pick" id="diet-pick">
    ${fx.length ? `<div class="diet-row"><span class="diet-lbl">🔒 ${esc(t("diet.fixed"))}</span><div class="chips">${fx.map((d) => chip(d, sel.has(d.slug))).join("")}${fx.length > 1 ? `<button type="button" class="chip sm ghost" data-diet-all>${esc(t("diet.applyAll"))}</button>` : ""}</div></div>` : `<p class="hint" style="margin:0 0 6px">${esc(t("diet.noFixed"))} <a href="#profile">${esc(t("diet.setFixed"))}</a></p>`}
    <div class="diet-row"><span class="diet-lbl">🍽 ${esc(t("diet.meal"))}</span><div class="chips">${DIET_MEAL.map((d) => chip(d, sel.has(d.slug))).join("")}</div></div>
    ${rest.length ? `<details class="diet-more"><summary>${esc(t("diet.more"))}</summary><div class="chips" style="margin-top:6px">${rest.map((d) => chip(d, sel.has(d.slug))).join("")}</div></details>` : ""}
  </div>`;
}

export function wireChips(root) {
  root.addEventListener("click", (e) => {
    const all = e.target.closest("[data-diet-all]");
    if (all && root.contains(all)) {
      const box = all.closest(".diet-row");
      box.querySelectorAll("[data-diet]").forEach((x) => x.setAttribute("aria-pressed", "true"));
      return;
    }
    const b = e.target.closest("[data-diet]");
    if (!b || !root.contains(b)) return;
    b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
  });
}

export const readChips = (root) => [...root.querySelectorAll("[data-diet][aria-pressed='true']")].map((b) => b.dataset.diet);

// Small read-only tags (members list)
// Three quiet lines instead of a wall of chips: allergies (the only highlighted line), diet rules (redundant ones
// dropped: vegan already means no meat or seafood), and this-meal wishes. Words only, no emoji, so it stays light.
const IMPLIED = {
  vegan: ["vegetarian", "no_pork", "no_beef", "no_lamb", "no_seafood"],
  vegetarian: ["no_pork", "no_beef", "no_lamb", "no_seafood"],
};
const MEAL = new Set(DIET_MEAL.map((d) => d.slug));
export function dietSplit(tags) {
  const items = [...new Set((tags || []).filter((s) => KNOWN.has(s)))];
  const drop = new Set(items.flatMap((s) => IMPLIED[s] || []));
  return {
    allergies: items.filter(isAllergy),
    rules: items.filter((s) => !isAllergy(s) && !MEAL.has(s) && !drop.has(s)),
    meal: items.filter((s) => MEAL.has(s)),
  };
}
const short = (s) => t("ds." + s);
export function dietTagsHTML(tags, note) {
  const { allergies, rules, meal } = dietSplit(tags);
  if (!allergies.length && !rules.length && !meal.length && !note) return "";
  const line = (cls, text) => `<span class="diet-line ${cls}">${text}</span>`;
  return `<span class="diet-lines">${[
    allergies.length ? line("al", `⚠️ ${esc(t("diet.allergyLine", { list: allergies.map(short).join(t("diet.sep")) }))}`) : "",
    rules.length ? line("rule", esc(rules.map((s) => t("dt." + s)).join(t("diet.sep")))) : "",
    meal.length || note ? line("meal", esc([meal.length ? t("diet.mealLine", { list: meal.map((s) => t("dt." + s)).join(t("diet.sep")) }) : "", note || ""].filter(Boolean).join(" · "))) : "",
  ].join("")}</span>`;
}

// One line over the members list: what this table as a whole has to watch out for ("3 dairy · 1 vegan").
export function tableDietSummaryHTML(lists) {
  const n = new Map();
  for (const tags of lists) {
    const { allergies, rules } = dietSplit(tags);
    for (const s of [...allergies, ...rules]) n.set(s, (n.get(s) || 0) + 1);
  }
  if (!n.size) return "";
  const order = [...n].sort((a, b) => b[1] - a[1]);
  const times = (k) => (k > 1 ? ` ×${k}` : "");
  const al = order.filter(([s]) => isAllergy(s)).map(([s, k]) => short(s) + times(k));
  const ru = order.filter(([s]) => !isAllergy(s)).map(([s, k]) => t("dt." + s) + times(k));
  const parts = [al.length ? t("diet.allergyLine", { list: al.join(t("diet.sep")) }) : "", ru.join(t("diet.sep"))].filter(Boolean);
  return `<p class="diet-summary">⚠️ <strong>${esc(t("diet.tableWatch"))}</strong> ${esc(parts.join(t("diet.partSep")))}</p>`;
}

// Reminder shown while choosing a restaurant. `people` = [{name, tags}], only those with allergies are listed.
export function allergyReminderHTML(people) {
  const rows = (people || []).map((p) => ({ name: p.name, al: (p.tags || []).filter(isAllergy) })).filter((p) => p.al.length);
  if (!rows.length) return "";
  return `<div class="notice warn allergy-note" role="note">⚠️ ${esc(t("diet.allergyNote"))}<ul>${rows
    .map((p) => `<li>${p.name ? `<strong>${esc(p.name)}</strong>: ` : ""}${esc(p.al.map((s) => dietLabel(s)).join(" · "))}</li>`)
    .join("")}</ul><span class="hint">${esc(t("diet.tellRestaurant"))}</span></div>`;
}
