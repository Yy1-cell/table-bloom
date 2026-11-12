// Static reference data. Keep in sync with supabase/schema.sql (areas, cuisines) so demo mode
// and the live database look the same.
export const AREAS = [
  { id: "6f1a0001-0000-4000-8000-000000000001", name_en: "Toronto — Downtown", name_zh: "多伦多市中心", center_lat: 43.6596, center_lng: -79.397 },
  { id: "6f1a0001-0000-4000-8000-000000000002", name_en: "Toronto — North York", name_zh: "North York", center_lat: 43.7615, center_lng: -79.4111 },
  { id: "6f1a0001-0000-4000-8000-000000000003", name_en: "Toronto — Scarborough", name_zh: "Scarborough", center_lat: 43.7731, center_lng: -79.2578 },
  { id: "6f1a0001-0000-4000-8000-000000000004", name_en: "Mississauga", name_zh: "Mississauga", center_lat: 43.589, center_lng: -79.6441 },
  { id: "6f1a0001-0000-4000-8000-000000000005", name_en: "Markham & Richmond Hill", name_zh: "Markham／Richmond Hill", center_lat: 43.8561, center_lng: -79.337 },
];

export const CUISINES = [
  { slug: "hotpot", name_en: "Hot pot", name_zh: "火锅", emoji: "🥘" },
  { slug: "korean_bbq", name_en: "Korean BBQ", name_zh: "韩烤", emoji: "🍖" },
  { slug: "japanese", name_en: "Japanese", name_zh: "日料", emoji: "🍣" },
  { slug: "sichuan", name_en: "Sichuan", name_zh: "川菜", emoji: "🌶️" },
  { slug: "noodles", name_en: "Noodles", name_zh: "面食", emoji: "🍜" },
  { slug: "pizza", name_en: "Pizza", name_zh: "披萨", emoji: "🍕" },
  { slug: "dimsum", name_en: "Dim sum", name_zh: "点心", emoji: "🥟" },
  { slug: "cafe", name_en: "Café & brunch", name_zh: "咖啡轻食", emoji: "☕" },
];

export const TAGS = [
  "mandarin_friendly",
  "new_to_toronto",
  "split_bill",
  "bring_a_friend",
  "easy_conversation",
  "try_somewhere_new",
];

export const AUDIENCES = ["friends", "friends_and_new", "new_people"];
export const INTENTIONS = ["unwind", "catch_up", "study_tips", "new_perspectives"];
export const PACES = ["talking", "ease_in", "listening"];
export const SPOKEN = ["zh", "en", "yue", "other"];
export const AVATARS = ["🍊", "🥑", "🍑", "🍋", "🍓", "🥝", "🍇", "🌽", "🥕", "🍄", "🌸", "🌿"];
export const REPORT_REASONS = ["harassment", "no_show", "unsafe", "spam", "other"];
export const MOODS = ["😔", "😕", "😐", "🙂", "😄"];
