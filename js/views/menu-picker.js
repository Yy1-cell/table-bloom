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

function html(sel, open, { formats, anyLabel, multi }) {
  const groups = menuGroups();
  const has = (slug) => sel.includes(slug);
  const chip = (attr, val, label, on, extra = "") => `<button type="button" class="chip" data-${attr}="${esc(val)}" aria-pressed="${on}" ${extra}>${label}</button>`;
  const groupOn = (x) => x.leaves.some((c) => has(c.slug));
  const cur = multi ? open : groupOfSlug(sel[0]);
  const openG = groups.find((x) => x.g === cur && x.subs);
  const top = groups
    .map((x) => {
      if (!x.subs) return chip("pk", x.leaves[0].slug, `${esc(x.leaves[0].emoji)} ${esc(nameOf(x.leaves[0]))}`, has(x.leaves[0].slug));
      const n = multi ? x.leaves.filter((c) => has(c.slug)).length : 0;
      return chip("pg", x.g, `${esc(x.generic.emoji)} ${esc(t("cg." + x.g))}${n > 1 ? ` · ${n}` : ""}`, multi ? groupOn(x) : cur === x.g, `aria-expanded="${openG?.g === x.g}"`);
    })
    .join("");
  const any = anyLabel ? chip("pk", "", esc(anyLabel), sel.length === 0) : "";
  const subRow = openG
    ? `<div class="mp-sub" aria-label="${esc(t("cg." + openG.g))}">
        ${chip("pk", openG.generic.slug, esc(t("mp.anySub")), has(openG.generic.slug))}
        ${openG.leaves.filter((c) => c !== openG.generic).map((c) => chip("pk", c.slug, `${esc(c.emoji)} ${esc(nameOf(c))}`, has(c.slug))).join("")}
      </div>`
    : "";
  const fmtRow = formats
    ? `<div class="mp-fmt"><div class="cg-label">${esc(t("mp.formats"))}</div><div class="chips">${FORMATS.map((f) => chip("pk", f.slug, `${esc(f.emoji)} ${esc(t("fm." + f.slug))}`, has(f.slug))).join("")}</div></div>`
    : "";
  return `<div class="mp"><div class="chips">${any}${top}</div>${subRow}${fmtRow}</div>`;
}

/**
 * Render into `el` and keep it up to date.
 * Single choice (default): value is one slug, `onChange(slug)`.
 * multi: value is an array of up to `max` slugs (cuisines, plus formats when `formats` is on), `onChange(array)`; `onLimit()` runs
 * when a further one is tapped. A region and its "any" exclude each other.
 * Options: formats (also offer the formats), anyLabel (adds a leading "any" chip that clears everything).
 */
export function mountMenuPicker(el, { value, onChange = () => {}, formats = false, anyLabel = "", multi = false, max = 3, onLimit = () => {} } = {}) {
  let sel = multi ? [...(value || [])] : value ? [value] : [];
  let open = multi ? groupOfSlug(sel[0]) : "";
  const draw = () => {
    el.innerHTML = html(sel, open, { formats, anyLabel, multi });
  };
  const emit = () => {
    draw();
    onChange(multi ? [...sel] : sel[0] || "");
  };
  const genericOf = (g) => menuGroups().find((x) => x.g === g)?.generic.slug;

  el.addEventListener("click", (e) => {
    const g = e.target.closest("[data-pg]");
    if (g && el.contains(g)) {
      const grp = g.dataset.pg;
      if (!multi) {
        sel = groupOfSlug(sel[0]) === grp ? [] : [genericOf(grp)];
        return emit();
      }
      if (open === grp) {
        open = "";
        return draw();
      }
      open = grp;
      const mine = menuGroups().find((x) => x.g === grp).leaves;
      if (!mine.some((c) => sel.includes(c.slug))) {
        if (sel.length >= max) {
          draw();
          return onLimit();
        }
        sel.push(genericOf(grp));
        return emit();
      }
      return draw();
    }
    const k = e.target.closest("[data-pk]");
    if (!k || !el.contains(k)) return;
    const v = k.dataset.pk;
    if (!multi) {
      // tapping a chosen leaf again steps back: a region goes back to its "any", everything else clears
      if (v === sel[0] && v !== "") {
        const c = cuisineOf(v);
        const grp = c && menuGroups().find((x) => x.g === c.grp);
        sel = grp?.subs && c !== grp.generic ? [grp.generic.slug] : [];
      } else sel = v ? [v] : [];
      return emit();
    }
    if (v === "") {
      sel = [];
      open = "";
      return emit();
    }
    if (sel.includes(v)) {
      sel = sel.filter((x) => x !== v);
      return emit();
    }
    const c = cuisineOf(v);
    const grp = c && menuGroups().find((x) => x.g === c.grp);
    // a region and its "any" exclude each other; swapping one for the other never needs a free slot
    let next = sel;
    if (grp?.subs) {
      const isGeneric = c === grp.generic;
      next = sel.filter((x) => {
        const o = cuisineOf(x);
        return !(o && o.grp === grp.g && (isGeneric || o === grp.generic));
      });
    }
    if (next.length >= max) {
      draw();
      return onLimit();
    }
    sel = [...next, v];
    emit();
  });
  draw();
  return {
    get value() {
      return multi ? [...sel] : sel[0] || "";
    },
    set value(v) {
      sel = multi ? [...(v || [])] : v ? [v] : [];
      open = multi ? groupOfSlug(sel[0]) : "";
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
