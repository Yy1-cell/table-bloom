// City of Toronto DineSafe public establishment names and locations.
// Open Government Licence – Toronto. No inspection outcomes or contact information are bundled.
import { haversineKm } from "./util.js";

let directory;

function venues() {
  if (!directory) {
    directory = fetch(new URL("../data/toronto-venues.json", import.meta.url))
      .then((response) => {
        if (!response.ok) throw new Error("venue_directory_unavailable");
        return response.json();
      })
      .then(({ venues }) => venues.map(([name, address, lat, lng]) => ({ name, address, lat, lng })))
      .catch((error) => {
        directory = null;
        throw error;
      });
  }
  return directory;
}

const normalize = (text) => text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const cuisines = {
  hotpot: /hot[ -]?pot|shabu|火鍋|火锅|haidilao/i,
  korean_bbq: /korean.{0,12}(bbq|barbe?cue|grill)|k[- ]?bbq|korean.{0,8}barbecue|烤肉/i,
  japanese: /japanese|sushi|ramen|izakaya|udon|teriyaki/i,
  sichuan: /sichuan|szechuan|chongqing|川菜|重庆|重慶/i,
  noodles: /noodle|ramen|\bpho\b|udon|麵|面館/i,
  pizza: /pizz[ae]|pizzeria/i,
  dimsum: /dim[ -]?sum|點心|点心/i,
  cafe: /\bcaf[eé]\b|coffee|espresso|tea room/i,
};
const publicDining = /restaurant|kitchen|eatery|diner|bistro|grill|tavern|trattoria|cantina|steakhouse|\bfood court\b/i;

export async function searchTorontoVenues(query, center) {
  const q = normalize(query);
  if (q.length < 2) return [];
  return (await venues())
    .map((venue) => ({ venue, name: normalize(venue.name) }))
    .filter(({ venue, name }) => name.includes(q) || normalize(venue.address).includes(q))
    .map(({ venue, name }) => ({ venue, rank: name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : 3 }))
    .sort((a, b) => a.rank - b.rank || (center ? haversineKm(center, a.venue) - haversineKm(center, b.venue) : 0))
    .slice(0, 7)
    .map(({ venue }) => venue);
}

export async function torontoVenuesNear(center, cuisine, radiusKm) {
  const matches = cuisines[cuisine];
  return (await venues())
    .filter((venue) => matches
      ? matches.test(venue.name)
      : publicDining.test(venue.name) || Object.values(cuisines).some((pattern) => pattern.test(venue.name)))
    .map((venue) => ({ ...venue, distKm: haversineKm(center, venue), source: "toronto" }))
    .filter((venue) => venue.distKm <= radiusKm)
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, 10);
}
