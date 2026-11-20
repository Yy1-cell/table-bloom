// A small "where?" control: shows the current place, a "use my location" button and a search for any city or address.
import { esc, qs } from "../util.js";
import { t } from "../i18n.js";
import { placeSearchHTML, bindPlaceSearch, toast } from "../ui.js";
import { effectiveLoc, locateMe, setLoc } from "../location.js";

const whyFailed = (e) => (e?.reason === "denied" ? t("loc.denied") : t("disc.noLocation"));

/** Fills `el` with the picker. onChange(loc) runs after the person picked a place or used their location. */
export function mountLocPicker(el, { onChange, label } = {}) {
  const ps = placeSearchHTML({ label: label || t("loc.search"), placeholder: t("loc.searchPh"), hint: t("loc.searchHint") });
  const draw = () => {
    const cur = effectiveLoc();
    qs("[data-loc-now]", el).innerHTML = cur ? `📍 <strong>${esc(cur.label || t("map.here"))}</strong>` : `📍 ${esc(t("loc.notSet"))}`;
  };
  el.innerHTML = `<div class="loc-picker">
    <p class="loc-now" data-loc-now role="status" aria-live="polite"></p>
    <div class="row wrap-row"><button type="button" class="btn sm" data-loc-me>📍 ${esc(t("map.useMe"))}</button></div>
    ${ps.html}</div>`;
  draw();
  const done = (loc) => {
    draw();
    onChange?.(loc);
  };
  qs("[data-loc-me]", el).addEventListener("click", async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      done(await locateMe());
    } catch (err) {
      toast(whyFailed(err), { kind: "error" });
    } finally {
      b.disabled = false;
    }
  });
  bindPlaceSearch(el, {
    id: ps.id,
    near: effectiveLoc() || undefined,
    onSelect: (p) => {
      done(setLoc({ lat: p.lat, lng: p.lng, label: p.name, gps: false, cc: p.cc }));
    },
    onClear: () => {},
  });
}
