// Shared map for a private friends table: everyone's starting point, the middle, the chosen venue and the suggestions.
// Leaflet (vendored in /vendor/leaflet) + OpenStreetMap tiles: no API key needed.
// Names and emoji come from other users, so they are always set with textContent, never as HTML.

let leafletReady = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  leafletReady ||= new Promise((resolve, reject) => {
    const base = new URL("../vendor/leaflet/", import.meta.url);
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = new URL("leaflet.css", base).href;
    document.head.append(css);
    const script = document.createElement("script");
    script.src = new URL("leaflet.js", base).href;
    script.onload = () => resolve(window.L);
    script.onerror = () => {
      leafletReady = null;
      reject(new Error("leaflet_load_failed"));
    };
    document.head.append(script);
  });
  return leafletReady;
}

const el = (cls, text) => {
  const node = document.createElement("div");
  node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

/**
 * Draws the map into `container`. Returns { update(data), destroy() }, or null if the map library could not load.
 * data = { people: [{name, avatar, lat, lng}], middle: {lat,lng}|null, venue: {name,lat,lng}|null, suggestions: [{name,lat,lng}], labels: {middle, venue} }
 */
export async function mountGroupMap(container, data) {
  let L;
  try {
    L = await loadLeaflet();
  } catch {
    return null;
  }
  if (!container.isConnected) return null;

  const map = L.map(container, { scrollWheelZoom: false, zoomControl: true });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  map.setView([43.6532, -79.3832], 11);

  const pin = (className, content, size = 34) =>
    L.divIcon({ className: "gm-icon", html: el(`gm-pin ${className}`, content), iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

  const tip = (marker, text, direction = "bottom") => {
    const node = document.createElement("span");
    node.textContent = text;
    marker.bindTooltip(node, { permanent: true, direction, offset: [0, direction === "bottom" ? 14 : -14], className: "gm-tip" });
  };

  function update(d) {
    layer.clearLayers();
    const bounds = [];
    const add = (latlng) => bounds.push(latlng);

    for (const p of d.people || []) {
      const ll = [p.lat, p.lng];
      const m = L.marker(ll, { icon: pin("gm-person", p.avatar || "📍") }).addTo(layer);
      tip(m, p.name);
      add(ll);
      if (d.middle && (d.people || []).length > 1) {
        L.polyline([ll, [d.middle.lat, d.middle.lng]], { color: "#365b3c", weight: 2, opacity: 0.55, dashArray: "4 6" }).addTo(layer);
      }
    }
    if (d.middle && (d.people || []).length > 1) {
      const ll = [d.middle.lat, d.middle.lng];
      const m = L.marker(ll, { icon: pin("gm-mid", "⭐", 30), zIndexOffset: 400 }).addTo(layer);
      tip(m, d.labels?.middle || "Middle", "top");
      add(ll);
    }
    (d.suggestions || []).forEach((s, i) => {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) return;
      const ll = [s.lat, s.lng];
      const m = L.marker(ll, { icon: pin("gm-sug", String(i + 1), 26), zIndexOffset: 200 }).addTo(layer);
      const node = document.createElement("span");
      node.textContent = s.name;
      m.bindPopup(node);
      add(ll);
    });
    if (d.venue && Number.isFinite(d.venue.lat) && Number.isFinite(d.venue.lng)) {
      const ll = [d.venue.lat, d.venue.lng];
      const m = L.marker(ll, { icon: pin("gm-venue", "🍽️", 38), zIndexOffset: 800 }).addTo(layer);
      tip(m, d.venue.name || d.labels?.venue || "", "top");
      add(ll);
    }

    map.invalidateSize();
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    else if (bounds.length === 1) map.setView(bounds[0], 14);
    else if (d.fallbackCenter) map.setView([d.fallbackCenter.lat, d.fallbackCenter.lng], 13);
  }

  let latest = data;
  update(data);
  // the sheet may still be animating in when the map is created
  setTimeout(() => container.isConnected && update(latest), 350);

  return {
    update(d) {
      latest = d;
      if (container.isConnected) update(d);
    },
    destroy() {
      try {
        map.remove();
      } catch {}
    },
    get data() {
      return latest;
    },
  };
}
