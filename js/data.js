// Static reference data. Keep in sync with supabase/schema.sql (areas, cuisines) so demo mode
// and the live database look the same.
export const AREAS = [
  { id: "6f1a0001-0000-4000-8000-000000000001", name_en: "Toronto — Downtown", name_zh: "多伦多市中心", center_lat: 43.6596, center_lng: -79.397 },
  { id: "6f1a0001-0000-4000-8000-000000000002", name_en: "Toronto — North York", name_zh: "North York", center_lat: 43.7615, center_lng: -79.4111 },
  { id: "6f1a0001-0000-4000-8000-000000000003", name_en: "Toronto — Scarborough", name_zh: "Scarborough", center_lat: 43.7731, center_lng: -79.2578 },
  { id: "6f1a0001-0000-4000-8000-000000000004", name_en: "Mississauga", name_zh: "Mississauga", center_lat: 43.589, center_lng: -79.6441 },
  { id: "6f1a0001-0000-4000-8000-000000000005", name_en: "Markham & Richmond Hill", name_zh: "Markham／Richmond Hill", center_lat: 43.8561, center_lng: -79.337 },
];

// The food menu has three independent questions:
//  1. cuisine (CUISINES): two levels. The group (grp) is the first level. A group with several leaves (Chinese, Southeast &
//     South Asian, Western) opens a second level; the leaf whose slug equals the group is "any".
//  2. format (FORMATS): how we eat (hot pot, BBQ…). Optional, up to three per table.
//  3. venue type (VENUE_TYPES): what kind of place. Optional, one per table.
// Keep in sync with supabase/migrations/2026-11-15_menu_two_level.sql so demo mode and the live database look the same.
export const CUISINE_GROUPS = ["chinese", "japanese", "korean", "asia", "western", "latin", "mideast"];

export const CUISINES = [
  { slug: "chinese", name_en: "Chinese", name_zh: "中餐", emoji: "🥢", grp: "chinese", sort: 1 },
  { slug: "sichuan", name_en: "Sichuan", name_zh: "川菜", emoji: "🌶️", grp: "chinese", sort: 2 },
  { slug: "hunan", name_en: "Hunan", name_zh: "湘菜", emoji: "🌶️", grp: "chinese", sort: 3 },
  { slug: "cantonese", name_en: "Cantonese & Hong Kong", name_zh: "粤菜·港式", emoji: "🦆", grp: "chinese", sort: 4 },
  { slug: "dongbei", name_en: "Northeastern", name_zh: "东北菜", emoji: "🥟", grp: "chinese", sort: 5 },
  { slug: "jiangzhe", name_en: "Jiangsu, Zhejiang & Shanghai", name_zh: "江浙沪菜", emoji: "🦀", grp: "chinese", sort: 6 },
  { slug: "xibei", name_en: "Northwestern & Xinjiang", name_zh: "西北·新疆菜", emoji: "🍢", grp: "chinese", sort: 7 },
  { slug: "yungui", name_en: "Yunnan & Guizhou", name_zh: "云贵菜", emoji: "🍄", grp: "chinese", sort: 8 },
  { slug: "taiwanese", name_en: "Taiwanese", name_zh: "台湾菜", emoji: "🍚", grp: "chinese", sort: 9 },
  { slug: "japanese", name_en: "Japanese", name_zh: "日料", emoji: "🍣", grp: "japanese", sort: 10 },
  { slug: "korean", name_en: "Korean", name_zh: "韩餐", emoji: "🍲", grp: "korean", sort: 11 },
  { slug: "asia", name_en: "Southeast & South Asian", name_zh: "东南亚·南亚", emoji: "🥥", grp: "asia", sort: 12 },
  { slug: "thai", name_en: "Thai", name_zh: "泰餐", emoji: "🥥", grp: "asia", sort: 13 },
  { slug: "vietnamese", name_en: "Vietnamese", name_zh: "越南菜", emoji: "🥖", grp: "asia", sort: 14 },
  { slug: "indian", name_en: "Indian", name_zh: "印度菜", emoji: "🍛", grp: "asia", sort: 15 },
  { slug: "western", name_en: "Western", name_zh: "西餐", emoji: "🍽️", grp: "western", sort: 16 },
  { slug: "american", name_en: "American", name_zh: "美式", emoji: "🍔", grp: "western", sort: 17 },
  { slug: "italian", name_en: "Italian", name_zh: "意餐", emoji: "🍝", grp: "western", sort: 18 },
  { slug: "french", name_en: "French & European", name_zh: "法餐·欧陆", emoji: "🥐", grp: "western", sort: 19 },
  { slug: "mexican", name_en: "Mexican & Latin American", name_zh: "墨西哥·拉美", emoji: "🌮", grp: "latin", sort: 20 },
  { slug: "mediterranean", name_en: "Mediterranean & Middle Eastern", name_zh: "中东·地中海", emoji: "🥙", grp: "mideast", sort: 21 },
];

// How we eat (many can apply to one table). Names live in strings.js as fm.<slug>.
export const FORMATS = [
  { slug: "hotpot", emoji: "🥘" },
  { slug: "bbq", emoji: "🍖" },
  { slug: "dimsum", emoji: "🥟" },
  { slug: "noodles", emoji: "🍜" },
  { slug: "seafood", emoji: "🦞" },
  { slug: "buffet", emoji: "🍱" },
  { slug: "brunch", emoji: "🥞" },
  { slug: "veg", emoji: "🥗" },
];
export const MAX_FORMATS = 3;

// Which formats make sense for which cuisine, so "Japanese + dim sum" can't be picked. With no cuisine chosen, all are offered.
// Group lists first; a few leaves differ from their group.
const FORMATS_BY_GROUP = {
  chinese: ["hotpot", "bbq", "noodles", "seafood", "buffet", "veg"],
  japanese: ["bbq", "noodles", "seafood", "buffet", "veg"],
  korean: ["hotpot", "bbq", "noodles", "seafood", "buffet", "veg"],
  asia: ["hotpot", "bbq", "noodles", "seafood", "buffet", "veg"],
  western: ["bbq", "seafood", "buffet", "brunch", "veg"],
  latin: ["bbq", "seafood", "buffet", "brunch", "veg"],
  mideast: ["bbq", "seafood", "buffet", "veg"],
};
const FORMATS_BY_LEAF = {
  chinese: ["hotpot", "bbq", "dimsum", "noodles", "seafood", "buffet", "veg"], // "any Chinese" still allows dim sum
  cantonese: ["hotpot", "bbq", "dimsum", "noodles", "seafood", "buffet", "veg"],
  indian: ["buffet", "veg"],
  italian: ["seafood", "brunch", "buffet", "veg"],
  french: ["seafood", "brunch", "buffet", "veg"],
};
/** A table's cuisines as a list (up to 3; the first is the main one). Older rows only have `cuisine`. */
export const cuisinesOf = (tb) => (tb?.cuisines?.length ? tb.cuisines : tb?.cuisine ? [tb.cuisine] : []);
/** Formats that fit at least one of these cuisines (all of them when none is chosen). */
export function formatsForMany(slugs) {
  if (!slugs?.length) return FORMATS.map((f) => f.slug);
  const ok = new Set(slugs.flatMap((s) => formatsFor(s)));
  return FORMATS.map((f) => f.slug).filter((f) => ok.has(f));
}
/** Format slugs that fit this cuisine (all of them when there is no cuisine). */
export function formatsFor(cuisineSlug) {
  if (!cuisineSlug) return FORMATS.map((f) => f.slug);
  const c = CUISINES.find((x) => x.slug === cuisineSlug);
  const list = FORMATS_BY_LEAF[cuisineSlug] || (c && FORMATS_BY_GROUP[c.grp]);
  return list ? [...list] : FORMATS.map((f) => f.slug);
}
// English words for a Google Maps text search where the cuisine's display name is too long or odd to search for
const SEARCH_WORD = { asia: "Southeast Asian", cantonese: "Cantonese", dongbei: "Dongbei Northeastern Chinese", jiangzhe: "Shanghainese", xibei: "Xinjiang Lanzhou", yungui: "Yunnan", french: "French", mexican: "Mexican", mediterranean: "Mediterranean", taiwanese: "Taiwanese", western: "Western" };
/** What to type into Google Maps for a cuisine or format slug. */
export const searchWord = (slug) => SEARCH_WORD[slug] || CUISINES.find((c) => c.slug === slug)?.name_en || FORMAT_QUERY[slug] || "";
// English words for a Google Maps text search per format
export const FORMAT_QUERY = { hotpot: "hot pot", bbq: "BBQ", dimsum: "dim sum", noodles: "noodle", seafood: "seafood", buffet: "buffet", brunch: "brunch", veg: "vegetarian" };

// What kind of place (one per table). Names live in strings.js as vt.<slug>.
export const VENUE_TYPES = [
  { slug: "fast", emoji: "🍔" },
  { slug: "casual", emoji: "🍜" },
  { slug: "dine", emoji: "🍷" },
  { slug: "cafe", emoji: "☕" },
  { slug: "bar", emoji: "🍻" },
];

/** The restaurant-search keys for a table: its cuisine, then each format, then the venue type when it narrows the search. */
export function searchKeys({ cuisine, cuisines, formats = [], venue_type } = {}) {
  const keys = [...(cuisines?.length ? cuisines : cuisine ? [cuisine] : [])];
  for (const f of formats || []) keys.push(f);
  if (venue_type === "cafe" || venue_type === "bar") keys.push(venue_type);
  return [...new Set(keys)];
}

// Vibe tags a host can add (older tables may still carry mandarin_friendly, bring_a_friend, easy_conversation; their labels stay in strings).
export const TAGS = ["split_bill", "new_to_toronto", "try_somewhere_new"];

// What the table is for. Optional, chosen by the host when creating the table.
export const OCCASIONS = [
  { slug: "date", emoji: "💕" },
  { slug: "family", emoji: "👨‍👩‍👧" },
  { slug: "friends", emoji: "🥂" },
  { slug: "classmates", emoji: "🎒" },
  { slug: "work", emoji: "💼" },
  { slug: "celebrate", emoji: "🎂" },
];

export const AUDIENCES = ["friends", "friends_and_new", "new_people"];
export const INTENTIONS = ["unwind", "catch_up", "study_tips", "new_perspectives"];
export const PACES = ["talking", "ease_in", "listening"];
export const SPOKEN = ["zh", "en", "yue", "other"];
export const AVATARS = ["🍊", "🥑", "🍑", "🍋", "🍓", "🥝", "🍇", "🌽", "🥕", "🍄", "🌸", "🌿"];
export const REPORT_REASONS = ["harassment", "no_show", "unsafe", "spam", "other"];
export const MOODS = ["😔", "😕", "😐", "🙂", "😄"];

// Post-meal check-in. FEELS: how the meal felt overall (shared with the table). Positive vibe tags are shared;
// the "private" ones (a bit awkward, tiring, rushed) never leave the author. PEER_SIGNALS are private, too.
export const FEELS = ["😣", "😕", "🙂", "😊", "🥰"];
export const VIBES_PUBLIC = ["relaxed", "easy_talk", "funny", "deep", "warm", "new_friends"];
export const VIBES_PRIVATE = ["awkward", "tiring", "rushed"];
export const PEER_SIGNALS = [
  { slug: "again", emoji: "👍" },
  { slug: "neutral", emoji: "😐" },
  { slug: "pass", emoji: "🙅" },
];

// Dietary needs. FIXED ones are set once on the profile ("I never eat…"); MEAL ones are just for one table ("light today").
// Slugs are stored as-is in profiles.dietary_tags / table_members.diet_tags (a-z and _ only); labels live in strings as dt.<slug>.
export const DIET_FIXED = [
  { slug: "vegetarian", emoji: "🥬" }, { slug: "vegan", emoji: "🌱" }, { slug: "halal", emoji: "☪️" }, { slug: "kosher", emoji: "✡️" },
  { slug: "no_pork", emoji: "🐖" }, { slug: "no_beef", emoji: "🐄" }, { slug: "no_seafood", emoji: "🦐" },
  { slug: "allergy_peanut", emoji: "🥜", allergy: true }, { slug: "allergy_shellfish", emoji: "🦞", allergy: true },
  { slug: "allergy_dairy", emoji: "🥛", allergy: true }, { slug: "allergy_gluten", emoji: "🌾", allergy: true }, { slug: "allergy_egg", emoji: "🥚", allergy: true },
];
export const DIET_MEAL = [
  { slug: "light", emoji: "🍵" }, { slug: "no_spicy", emoji: "🌶️" }, { slug: "low_oil", emoji: "🫒" }, { slug: "hot_food", emoji: "🍲" }, { slug: "no_raw", emoji: "🍣" },
];
export const DIET_ALL = [...DIET_FIXED, ...DIET_MEAL];
