import { t, getLang } from "./i18n.js";
import { esc, fmtMoney, mapsUrl } from "./util.js";

const prefix = "#invite-";
const fields = { title: 100, place: 160, address: 240, startsAt: 30 };

export function invitationUrl(table, title, { demo, href = location.href }) {
  const url = new URL(href);

  const details = {
    title,
    place: table.venue?.name || table.area_label,
    address: table.venue?.address,
    startsAt: new Date(table.starts_at).toISOString(),
    budget: table.budget_cents,
    tableId: demo || table.is_sample ? null : table.id,
  };
  for (const [key, max] of Object.entries(fields)) {
    details[key] = String(details[key] ?? "").slice(0, max);
  }
  url.hash = prefix + encodeURIComponent(JSON.stringify(details));
  return url.href;
}

export function readInvitation(hash) {
  if (!hash.startsWith(prefix) || hash.length > 9000) return null;
  try {
    const details = JSON.parse(decodeURIComponent(hash.slice(prefix.length)));
    if (!Object.entries(fields).every(([key, max]) =>
      typeof details?.[key] === "string" && details[key].length <= max)) return null;
    if (!details.title.trim() || !Number.isFinite(Date.parse(details.startsAt))) return null;
    return details;
  } catch {
    return null;
  }
}

export function renderInvitation(root) {
  const details = readInvitation(location.hash);
  if (!details) {
    root.innerHTML = `<div class="card"><h1>${esc(t("td.gone"))}</h1><a href="#discover">${esc(t("nav.discover"))}</a></div>`;
    return;
  }
  const when = new Date(details.startsAt).toLocaleString(getLang() === "zh" ? "zh-CN" : "en-CA", {
    dateStyle: "long", timeStyle: "short", timeZone: "America/Toronto",
  });
  const place = [details.place, details.address].filter(Boolean).join(" · ");
  const canOpen = typeof details.tableId === "string" && /^[0-9a-f-]{36}$/i.test(details.tableId);
  root.innerHTML = `<div class="card">
    <p class="muted">${esc(t("invite.title"))}</p>
    <h1>${esc(details.title)}</h1>
    <p>🕖 ${esc(when)} (Toronto)</p>
    ${place ? `<p>📍 ${esc(place)}</p><a class="btn sm" href="${esc(mapsUrl({ name: details.place, address: details.address || "Toronto, ON" }))}" target="_blank" rel="noopener">${esc(t("map.openGoogle"))}</a>` : ""}
    ${Number.isSafeInteger(details.budget) && details.budget >= 0 ? `<p>${esc(t("card.perPerson", { price: fmtMoney(details.budget) }))}</p>` : ""}
    ${canOpen
      ? `<a class="btn primary" href="#t-${esc(details.tableId)}">${esc(t("invite.open"))}</a>`
      : `<p class="notice">${esc(t("invite.reply"))}</p><a class="btn" href="#discover">${esc(t("nav.discover"))}</a>`}
  </div>`;
}
