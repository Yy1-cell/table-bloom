// Tiny i18n: English / 中文. Strings live in strings.js.
import { EN, ZH } from "./strings.js";

const DICT = { en: EN, zh: ZH };
const KEY = "tb.lang";
let lang = "en";
const listeners = new Set();

function safeGet() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function initLang() {
  const url = new URLSearchParams(location.search).get("lang");
  const stored = safeGet();
  const nav = (navigator.language || "en").toLowerCase();
  lang = ["en", "zh"].includes(url) ? url : ["en", "zh"].includes(stored) ? stored : nav.startsWith("zh") ? "zh" : "en";
  if (["en", "zh"].includes(url)) {
    try {
      localStorage.setItem(KEY, url); // an explicit ?lang= is a choice: remember it so the profile default doesn't override it
    } catch {}
  }
  apply();
  return lang;
}

function apply() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.title = lang === "zh" ? "Table & Bloom · 饭局" : "Table & Bloom";
}

export const getLang = () => lang;

export function setLang(l) {
  if (!DICT[l] || l === lang) return;
  lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {}
  apply();
  listeners.forEach((fn) => fn(l));
}

export const onLangChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export function t(key, vars) {
  let s = DICT[lang][key] ?? EN[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
