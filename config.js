// Table & Bloom configuration.
//
// Leave both values empty to run in DEMO MODE: everything is stored in this
// browser only, with sample tables, so you can try the whole app with no backend.
//
// To go live, create a Supabase project (see README.md), run supabase/schema.sql,
// then paste the Project URL and the "anon / publishable" key here.
// The anon key is meant to be public; your data is protected by the
// Row Level Security rules in schema.sql, never by hiding this key.
window.TB_CONFIG = {
  SUPABASE_URL: "https://ekaxxmapylvahknpbwqm.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_jtK19E52-QK0V6n74-98PQ_ehLMN4UT",
  // Default city shown before a user picks one. Used for map search bias.
  DEFAULT_CENTER: { lat: 43.6532, lng: -79.3832 }, // Toronto
  // Optional Google Maps JavaScript API key (browser key, restricted to this site's domain in Google Cloud). Empty = no Google JS map:
  // the app then uses the keyless Google embed plus the free built-in map. See README "Google Maps key".
  GOOGLE_MAPS_KEY: "AIzaSyAi4P6Kcq4vHqLzYtIPOdVmrRuJ8SWfnwU",
  // Shown in the app footer / report flow. Replace with a real address.
  SUPPORT_EMAIL: ""
};
