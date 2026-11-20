// One entry point for the interactive map. Tries the Google map (only when the key is set, the person is signed in and the
// server-side allowance has room), and otherwise uses the free built-in map. If Google breaks later, it switches to the free map.
import { mountGroupMap } from "./group-map.js";
import { googleAllowed, mountGoogleMap } from "./google-maps.js";

/**
 * Same data/controller shape as mountGroupMap, plus ctl.kind ("google" | "leaflet").
 * opts.fallback = false: only Google; resolves null when Google can't be used (the caller shows something else).
 */
export async function mountMap(container, data, { fallback = true, google = true } = {}) {
  let impl = null;
  if (google && (await googleAllowed())) impl = await mountGoogleMap(container, data);
  if (!impl && fallback) impl = await mountGroupMap(container, data);
  if (!impl) return null;
  let onSwap = null;
  const wire = (g) => {
    if (g.kind !== "google") return;
    g.onFail(async () => {
      const last = g.data;
      g.destroy();
      impl = fallback ? await mountGroupMap(container, last) : null;
      onSwap?.(impl);
    });
  };
  wire(impl);
  return {
    get kind() {
      return impl?.kind || "leaflet";
    },
    update: (d) => impl?.update(d),
    select: (i) => impl?.select(i),
    clearSpot: () => impl?.clearSpot?.(),
    destroy: () => impl?.destroy(),
    onSwap: (cb) => (onSwap = cb),
    get data() {
      return impl?.data;
    },
  };
}
