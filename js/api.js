// Picks the data layer: live Supabase when config.js has a URL + anon key, otherwise the local demo.
import { state } from "./state.js";

export let api = null;

export async function initApi() {
  const cfg = window.TB_CONFIG || {};
  if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
    try {
      const { createApi } = await import("./api-supabase.js");
      api = await createApi(cfg);
      state.mode = "supabase";
      return api;
    } catch (e) {
      console.warn("Supabase unavailable, falling back to demo mode", e);
    }
  }
  const m = await import("./api-demo.js");
  api = m.api;
  state.mode = "demo";
  return api;
}
