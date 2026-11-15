// Two-level food picker: first the group (Chinese, Japanese, …); groups with several leaves open a second row
// (Sichuan, Hunan, …). Optionally also offers the "how we eat" formats in the same single choice (used for cravings
// and the map filter). The value is one slug: a cuisine leaf, a format, or "" for nothing / any.
import { esc } from "../util.js";
import { t } from "../i18n.js";
import { state, cuisineOf } from "../state.js";
import { CUISINES, CUISINE_GROUPS, FORMATS } from "../data.js";
import { nameOf } from "./common.js";

const isFormat = (slug) => FORMATS.some((f) => f.slug === slug);

/** Cuisine groups in menu order: [{ g, leaves, subs (true when there is a second level), generic }] */
export function menuGroups() {
  const fallback = Object.fromEntries(CUISINES.map((c) => [c.slug, c.grp]));
  const byGroup = new Map(CUISINE_GROUPS.map((g) => [g, []]));
  for (const c of state.cuisines) {
    const g = c.grp && c.grp !== "other" ? c.grp : fallback[c.slug];
    if (!g) continue;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(c);
  }
  return [...byGroup]
    .filter(([, leaves]) => leaves.length)
    .map(([g, leaves]) => ({ g, leaves, subs: leaves.length > 1, generic: leaves.find((c) => c.slug === g) || leaves[0] }));
}

/** "Sichuan" under "Chinese": the group a leaf belongs to ("" for formats and unknown slugs). */
export const groupOfSlug = (slug) => cuisineOf(slug)?.grp || "";

function html(value, { formats, anyLabel }) {
  const groups = menuGroups();
  const cur = groupOfSlug(value);
  const open = groups.find((x) => x.g === cur && x.subs);
  const chip = (attr, val, label, on) => `<button type="button" class="chip" data-${attr}="${esc(val)}" aria-pressed="${on}">${label}</button>`;
  const top = groups
    .map((x) => {
      if (!x.subs) return chip("pk", x.leaves[0].slug, `${esc(x.leaves[0].emoji)} ${esc(nameOf(x.leaves[0]))}`, value === x.leaves[0].slug);
      return chip("pg", x.g, `${esc(x.generic.emoji)} ${esc(t("cg." + x.g))}`, cur === x.g);
    })
    .join("");
  const any = anyLabel ? chip("pk", "", esc(anyLabel), value === "") : "";
  const subRow = open
    ? `<div class="mp-sub" aria-label="${esc(t("cg." + open.g))}">
        ${chip("pk", open.generic.slug, esc(t("mp.anySub")), value === open.generic.slug)}
        ${open.leaves.filter((c) => c !== open.generic).map((c) => chip("pk", c.slug, `${esc(c.emoji)} ${esc(nameOf(c))}`, value === c.slug)).join("")}
      </div>`
    : "";
  const fmtRow = formats
    ? `<div class="mp-fmt"><div class="cg-label">${esc(t("mp.formats"))}</div><div class="chips">${FORMATS.map((f) => chip("pk", f.slug, `${esc(f.emoji)} ${esc(t("fm." + f.slug))}`, value === f.slug)).join("")}</div></div>`
    : "";
  return `<div class="mp"><div class="chips">${any}${top}</div>${subRow}${fmtRow}</div>`;
}

/**
 * Render into `el` and keep it up to date. `onChange(slug)` runs after every change.
 * Options: formats (also offer the formats), anyLabel (adds a leading "any" chip that sets "").
 */
export function mountMenuPicker(el, { value = "", onChange = () => {}, formats = false, anyLabel = "" } = {}) {
  let cur = value || "";
  const draw = () => {
    el.innerHTML = html(cur, { formats, anyLabel });
  };
  const set = (v) => {
    cur = v;
    draw();
    onChange(cur);
  };
  el.addEventListener("click", (e) => {
    const g = e.target.closest("[data-pg]");
    if (g && el.contains(g)) {
      const grp = g.dataset.pg;
      return set(groupOfSlug(cur) === grp ? "" : menuGroups().find((x) => x.g === grp).generic.slug);
    }
    const k = e.target.closest("[data-pk]");
    if (!k || !el.contains(k)) return;
    const v = k.dataset.pk;
    // tapping a chosen leaf again steps back: a region goes back to its "any", everything else clears
    if (v === cur && v !== "") {
      const c = cuisineOf(v);
      const grp = c && menuGroups().find((x) => x.g === c.grp);
      return set(grp?.subs && c !== grp.generic ? grp.generic.slug : "");
    }
    set(v);
  });
  draw();
  return {
    get value() {
      return cur;
    },
    set value(v) {
      cur = v || "";
      draw();
    },
  };
}

/** Name and emoji of a cuisine leaf or a format, for chips and labels. */
export function menuItem(slug) {
  const c = cuisineOf(slug);
  if (c) return { emoji: c.emoji, name: nameOf(c) };
  const f = FORMATS.find((x) => x.slug === slug);
  return f ? { emoji: f.emoji, name: t("fm." + f.slug) } : null;
}
export { isFormat };
