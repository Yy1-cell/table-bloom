// Static reference data. Keep in sync with supabase/schema.sql (areas, cuisines) so demo mode
// and the live database look the same.
export const AREAS = [
  { id: "6f1a0001-0000-4000-8000-000000000001", name_en: "Toronto — Downtown", name_zh: "多伦多市中心", center_lat: 43.6596, center_lng: -79.397 },
  { id: "6f1a0001-0000-4000-8000-000000000002", name_en: "Toronto — North York", name_zh: "North York", center_lat: 43.7615, center_lng: -79.4111 },
  { id: "6f1a0001-0000-4000-8000-000000000003", name_en: "Toronto — Scarborough", name_zh: "Scarborough", center_lat: 43.7731, center_lng: -79.2578 },
  { id: "6f1a0001-0000-4000-8000-000000000004", name_en: "Mississauga", name_zh: "Mississauga", center_lat: 43.589, center_lng: -79.6441 },
  { id: "6f1a0001-0000-4000-8000-000000000005", name_en: "Markham & Richmond Hill", name_zh: "Markham／Richmond Hill", center_lat: 43.8561, center_lng: -79.337 },
];

export const CUISINE_GROUPS = ["chinese", "japan_korea", "asia", "western", "casual", "sweet"];

// Grouped like the big Chinese review apps (by cuisine and by kind of place), tuned for friends eating out in the GTA.
export const CUISINES = [
  { slug: "hotpot", name_en: "Hot pot", name_zh: "火锅", emoji: "🥘", grp: "chinese", sort: 1 },
  { slug: "sichuan", name_en: "Sichuan", name_zh: "川菜", emoji: "🌶️", grp: "chinese", sort: 2 },
  { slug: "cantonese", name_en: "Cantonese & roast meats", name_zh: "粤菜·烧腊", emoji: "🦆", grp: "chinese", sort: 3 },
  { slug: "dimsum", name_en: "Dim sum", name_zh: "早茶点心", emoji: "🥟", grp: "chinese", sort: 4 },
  { slug: "noodles", name_en: "Noodles & dumplings", name_zh: "面食饺子", emoji: "🍜", grp: "chinese", sort: 5 },
  { slug: "skewers", name_en: "BBQ & skewers", name_zh: "烧烤串串", emoji: "🍢", grp: "chinese", sort: 6 },
  { slug: "hk_cafe", name_en: "HK café", name_zh: "港式茶餐厅", emoji: "🍍", grp: "chinese", sort: 7 },
  { slug: "taiwanese", name_en: "Taiwanese", name_zh: "台湾菜", emoji: "🍚", grp: "chinese", sort: 8 },
  { slug: "regional", name_en: "Other regional Chinese", name_zh: "湘菜·东北·江浙", emoji: "🥢", grp: "chinese", sort: 9 },
  { slug: "japanese", name_en: "Japanese & sushi", name_zh: "日料·寿司", emoji: "🍣", grp: "japan_korea", sort: 10 },
  { slug: "ramen", name_en: "Ramen & udon", name_zh: "拉面乌冬", emoji: "🍥", grp: "japan_korea", sort: 11 },
  { slug: "izakaya", name_en: "Izakaya", name_zh: "居酒屋", emoji: "🏮", grp: "japan_korea", sort: 12 },
  { slug: "korean_bbq", name_en: "Korean BBQ", name_zh: "韩式烤肉", emoji: "🍖", grp: "japan_korea", sort: 13 },
  { slug: "korean", name_en: "Korean", name_zh: "韩餐·炖锅", emoji: "🍲", grp: "japan_korea", sort: 14 },
  { slug: "thai", name_en: "Thai", name_zh: "泰餐", emoji: "🥥", grp: "asia", sort: 15 },
  { slug: "vietnamese", name_en: "Vietnamese", name_zh: "越南菜", emoji: "🥖", grp: "asia", sort: 16 },
  { slug: "indian", name_en: "Indian", name_zh: "印度菜", emoji: "🍛", grp: "asia", sort: 17 },
  { slug: "american", name_en: "American & burgers", name_zh: "美式·汉堡", emoji: "🍔", grp: "western", sort: 18 },
  { slug: "steak", name_en: "Steak & grill", name_zh: "牛排·扒房", emoji: "🥩", grp: "western", sort: 19 },
  { slug: "italian", name_en: "Italian & pasta", name_zh: "意餐·意面", emoji: "🍝", grp: "western", sort: 20 },
  { slug: "pizza", name_en: "Pizza", name_zh: "披萨", emoji: "🍕", grp: "western", sort: 21 },
  { slug: "mexican", name_en: "Mexican", name_zh: "墨西哥菜", emoji: "🌮", grp: "western", sort: 22 },
  { slug: "mediterranean", name_en: "Mediterranean & Middle Eastern", name_zh: "中东·地中海", emoji: "🥙", grp: "western", sort: 23 },
  { slug: "seafood", name_en: "Seafood", name_zh: "海鲜", emoji: "🦞", grp: "western", sort: 24 },
  { slug: "brunch", name_en: "Brunch", name_zh: "早午餐", emoji: "🥞", grp: "western", sort: 25 },
  { slug: "fried_chicken", name_en: "Fried chicken & wings", name_zh: "炸鸡·鸡翅", emoji: "🍗", grp: "casual", sort: 26 },
  { slug: "pub", name_en: "Pub & bar food", name_zh: "酒馆 Pub", emoji: "🍻", grp: "casual", sort: 27 },
  { slug: "buffet", name_en: "Buffet", name_zh: "自助餐", emoji: "🍱", grp: "casual", sort: 28 },
  { slug: "vegetarian", name_en: "Vegetarian & vegan", name_zh: "素食·轻食", emoji: "🥗", grp: "casual", sort: 29 },
  { slug: "cafe", name_en: "Café & light bites", name_zh: "咖啡轻食", emoji: "☕", grp: "sweet", sort: 30 },
  { slug: "bubble_tea", name_en: "Bubble tea", name_zh: "奶茶", emoji: "🧋", grp: "sweet", sort: 31 },
  { slug: "dessert", name_en: "Dessert & bakery", name_zh: "甜品·烘焙", emoji: "🍰", grp: "sweet", sort: 32 },
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
