// Money: each table is priced in the currency of the place it is held; people elsewhere see that currency.
import { nearToronto } from "./geo.js";

const EUR = "AT BE CY EE FI FR DE GR IE IT LV LT LU MT NL PT SK SI ES HR".split(" ");
const BY_COUNTRY = {
  CA: "CAD", US: "USD", GB: "GBP", JP: "JPY", KR: "KRW", CN: "CNY", HK: "HKD", MO: "MOP", TW: "TWD", SG: "SGD", AU: "AUD", NZ: "NZD",
  PL: "PLN", CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", CZ: "CZK", HU: "HUF", RO: "RON", BG: "BGN", IS: "ISK", UA: "UAH", TR: "TRY",
  MX: "MXN", BR: "BRL", AR: "ARS", CL: "CLP", CO: "COP", PE: "PEN", IN: "INR", TH: "THB", VN: "VND", MY: "MYR", ID: "IDR", PH: "PHP",
  AE: "AED", SA: "SAR", IL: "ILS", EG: "EGP", ZA: "ZAR", NG: "NGN", KE: "KES", MA: "MAD", RU: "RUB", KZ: "KZT", PK: "PKR", LK: "LKR", BD: "BDT",
};
for (const c of EUR) BY_COUNTRY[c] = "EUR";

// Roughly how many units of each currency make a typical C$/US$ meal budget, so the input's placeholder and limits are sensible.
const SCALE = {
  JPY: 100, KRW: 1000, VND: 18000, IDR: 11000, HUF: 300, INR: 60, THB: 25, TWD: 25, PHP: 40, CZK: 17, CLP: 700, COP: 3000, ARS: 800, ISK: 100,
  KZT: 350, PKR: 200, LKR: 220, BDT: 80, NGN: 1200, KES: 100, RUB: 70, UAH: 30, EGP: 35, MXN: 13, PLN: 3, SEK: 8, NOK: 8, DKK: 5, CNY: 5, HKD: 6,
  BRL: 4, TRY: 25, ZAR: 14, AED: 3, SAR: 3, ILS: 3, MAD: 7, RON: 4, BGN: 1.5, PEN: 3, MOP: 6,
};

/** Currency for a place: its country when known, otherwise Canadian dollars around Toronto, otherwise US dollars. */
export function currencyFor(place) {
  if (!place) return "CAD";
  const cc = String(place.cc || "").toUpperCase();
  if (BY_COUNTRY[cc]) return BY_COUNTRY[cc];
  return nearToronto(place) ? "CAD" : "USD";
}

/** { cur, min, max, hint } for the budget box: a typical meal is about `hint` in this currency. */
export function budgetRange(cur) {
  const s = SCALE[cur] || 1;
  return { cur, min: Math.max(1, Math.round(5 * s)), max: Math.round(500 * s), hint: Math.round(30 * s) };
}
