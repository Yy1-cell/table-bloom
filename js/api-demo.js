// DEMO MODE data layer. Everything lives in this browser (localStorage); no server, no account.
// It mirrors the behaviour of supabase/schema.sql (same rules, same error codes, same JSON shapes)
// so the interface is identical in both modes. Other people are simulated:
//   - the "Demo table" hosted by Kevin approves your join request after ~5 seconds
//   - after you host a table, a simulated friend asks to join about 8 seconds later
import { store, uid, todayStr } from "./util.js";
import { ApiError } from "./errors.js";
import { AREAS, CUISINES } from "./data.js";
import { getLang } from "./i18n.js";

const KEY = "tb.demo.v2";
const ME = "u_me";
export const DEMO_CODE = "123456";

const OTHERS = {
  u_lin: { id: "u_lin", display_name: "Lin", name_zh: "小林", avatar_emoji: "🍊", languages_spoken: ["zh", "en"] },
  u_mia: { id: "u_mia", display_name: "Mia", name_zh: "米娅", avatar_emoji: "🥑", languages_spoken: ["en"] },
  u_annie: { id: "u_annie", display_name: "Annie", name_zh: "安安", avatar_emoji: "🍑", languages_spoken: ["zh", "en"] },
  u_kevin: { id: "u_kevin", display_name: "Kevin", name_zh: "凯文", avatar_emoji: "🥟", languages_spoken: ["zh", "en", "yue"] },
  u_jenny: { id: "u_jenny", display_name: "Jenny", name_zh: "珍妮", avatar_emoji: "🍜", languages_spoken: ["en"] },
};


// Display text of the seeded tables, in both languages, so the English UI is all English and the Chinese UI all Chinese.
// Looked up by table id at read time (see tableJson), so switching language re-labels existing demo data instantly.
const DEMO_TEXT = {
  s1: { en: { title: "Hotpot on a cold day", note: "New to Toronto? You're very welcome.", area: "Spadina & Dundas" }, zh: { title: "天冷了，一起涮个火锅吧", note: "刚到多伦多的朋友也欢迎。", area: "Spadina & Dundas 路口" } },
  s2: { en: { title: "Korean BBQ after class", note: "Easy chat, no pressure. Listening counts too.", area: "Bloor–Yonge Station" }, zh: { title: "下课后吃韩式烤肉", note: "轻松聊天，没有压力，听着也算参与。", area: "Bloor–Yonge 地铁站" } },
  s3: { en: { title: "A slow lunch, a new connection", note: null, area: "Yonge–Dundas" }, zh: { title: "慢慢吃一顿午饭，认识新朋友", note: null, area: "Yonge–Dundas 路口" } },
  s4: { en: { title: "Weekend dim sum, slow chat", note: null, area: "Finch Station, North York" }, zh: { title: "周末点心，慢慢聊", note: null, area: "Finch 地铁站，North York" } },
  s5: { en: { title: "Noodle night in Markham", note: null, area: "Markham — Pacific Mall area" }, zh: { title: "万锦吃面之夜", note: null, area: "万锦 Pacific Mall 附近" } },
  live: { en: { title: "Dim sum Saturday", note: "Demo table: ask to join and you'll be approved in a few seconds.", area: "Chinatown, Spadina Ave" }, zh: { title: "点心周六", note: "演示饭局：申请加入，几秒后会自动通过。", area: "唐人街，Spadina Ave" } },
  up: { en: { title: "Korean BBQ Thursday", note: "You're in! Try the “Demo: skip to after the meal” button at the bottom right.", area: "Koreatown, Bloor St W" }, zh: { title: "韩烤周四", note: "你已经加入这桌。试试右下角的“演示：跳到饭后”。", area: "韩国城，Bloor St W" } },
  pending: { en: { title: "Sushi night", note: "Waiting for the host to reply (the demo won't approve this one automatically).", area: "Yonge & Dundas" }, zh: { title: "寿司之夜", note: "等发起人回复中（演示里不会自动通过）。", area: "Yonge & Dundas 路口" } },
  past1: { en: { title: "Last weekend's dim sum", note: null, area: "Chinatown, Spadina Ave" }, zh: { title: "上周末点心", note: null, area: "唐人街，Spadina Ave" } },
  past2: { en: { title: "Coffee & chat", note: "A table you hosted: mark no-shows and write a reflection.", area: "Kensington Market" }, zh: { title: "咖啡聊天", note: "你发起的饭局，可以标记爽约、写感想。", area: "肯辛顿市场" } },
};
const SLOT = { "demo-live-1": "live", "demo-up-1": "up", "demo-pending-1": "pending", "demo-past-1": "past1", "demo-past-2": "past2" };
function demoText(t) {
  const slot = SLOT[t.id] || (/^demo-(\d)-/.test(t.id) ? "s" + t.id.match(/^demo-(\d)-/)[1] : null);
  return slot && DEMO_TEXT[slot] ? DEMO_TEXT[slot][getLang()] : null;
}

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const authListeners = new Set();
let cache = null;

function atDay(offsetDays, h, m = 0) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
}

function fresh() {
  return {
    v: 1,
    seedDay: null,
    tables: [],
    reflections: [],
    blocks: [],
    reports: [],
    photos: [],
    seededMine: false,
    noShows: {},
    session: null,
    profile: null,
    ranks: CUISINES.map((c) => c.slug),
  };
}

/** A browsable table hosted by a simulated person. You can really request to join it; the host approves a few seconds later. */
function sample(n, hostId, p) {
  const others = Object.keys(OTHERS).filter((id) => id !== hostId);
  const when = new Date().toISOString();
  const members = [{ user_id: hostId, role: "host", status: "joined", joined_at: when }];
  for (let i = 0; i < p.seats - 1; i++) members.push({ user_id: others[i % others.length], role: "guest", status: "joined", joined_at: when });
  return {
    id: `demo-${n}-${todayStr()}`,
    demoAuto: true,
    host_id: hostId,
    is_sample: false,
    status: "open",
    join_mode: "request",
    members,
    venue: null,
    created_at: when,
    ...p.row,
  };
}

function seedSamples(db) {
  const A = AREAS.map((a) => a.id);
  const todayOffset = new Date().getHours() < 16 ? 0 : 1;
  const rows = [
    sample(1, "u_lin", {
      seats: 2,
      row: { area_id: A[0], title: "Hotpot on a cold day", audience: "friends_and_new", starts_at: atDay(todayOffset, 18), capacity: 4, budget_cents: 3000, cuisine: "hotpot", occasion: "classmates", area_label: "Spadina & Dundas", meet_lat: 43.6532, meet_lng: -79.3985, tags: ["new_to_toronto", "mandarin_friendly", "split_bill"], note: "New to Toronto? You're very welcome." },
    }),
    sample(2, "u_mia", {
      seats: 3,
      row: { area_id: A[0], title: "Korean BBQ after class", audience: "new_people", starts_at: atDay(1, 19), capacity: 5, budget_cents: 2800, cuisine: "korean_bbq", area_label: "Bloor–Yonge Station", meet_lat: 43.6709, meet_lng: -79.3857, tags: ["easy_conversation", "split_bill"], note: "Easy chat, no pressure. Listening counts too." },
    }),
    sample(3, "u_annie", {
      seats: 2,
      row: { area_id: A[0], title: "A slow lunch, a new connection", audience: "friends_and_new", starts_at: atDay(2, 12, 30), capacity: 4, budget_cents: 2400, cuisine: "japanese", occasion: "friends", area_label: "Yonge–Dundas", meet_lat: 43.6561, meet_lng: -79.3802, tags: ["bring_a_friend", "try_somewhere_new", "split_bill"], note: null },
    }),
    sample(4, "u_kevin", {
      seats: 3,
      row: { area_id: A[1], title: "Weekend dim sum, slow chat", audience: "friends_and_new", starts_at: atDay(3, 11), capacity: 6, budget_cents: 2200, cuisine: "dimsum", occasion: "family", area_label: "Finch Station, North York", meet_lat: 43.7806, meet_lng: -79.415, tags: ["mandarin_friendly", "split_bill"], note: null },
    }),
    sample(5, "u_jenny", {
      seats: 2,
      row: { area_id: A[4], title: "Noodle night in Markham", audience: "friends", starts_at: atDay(2, 18), capacity: 4, budget_cents: 1800, cuisine: "noodles", area_label: "Markham — Pacific Mall area", meet_lat: 43.8268, meet_lng: -79.2995, tags: ["bring_a_friend"], note: null },
    }),
  ];
  db.tables = db.tables.filter((t) => !t.is_sample && !(t.demoAuto && !t.members.some((m) => m.user_id === ME))).concat(rows);

  // One table you can really request to join; the simulated host approves it a few seconds later.
  const live = db.tables.find((t) => t.demoLive);
  if (!live || new Date(live.starts_at) < Date.now()) {
    db.tables = db.tables.filter((t) => !t.demoLive);
    db.tables.push({
      id: "demo-live-1",
      demoLive: true,
      host_id: "u_kevin",
      is_sample: false,
      status: "open",
      join_mode: "request",
      area_id: A[0],
      title: "Dim sum Saturday",
      audience: "friends_and_new",
      starts_at: atDay(4, 11, 30),
      capacity: 4,
      budget_cents: 2500,
      cuisine: "dimsum",
      venue: null,
      area_label: "Chinatown, Spadina Ave",
      meet_lat: 43.6535,
      meet_lng: -79.3987,
      tags: ["mandarin_friendly", "split_bill"],
      note: "Demo table: ask to join and you'll be approved in a few seconds.",
      created_at: new Date().toISOString(),
      members: [
        { user_id: "u_kevin", role: "host", status: "joined", joined_at: new Date().toISOString() },
        { user_id: "u_lin", role: "guest", status: "joined", joined_at: new Date().toISOString() },
      ],
    });
  }
  db.seedDay = todayStr();
}

const svgPhoto = (emoji, a, b) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="640" height="480" fill="url(#g)"/><text x="320" y="290" font-size="190" text-anchor="middle">${emoji}</text></svg>`
  );

/** Gives a brand-new demo user a lived-in account: an upcoming table, a pending request and two past tables. */
function seedMine(d) {
  if (d.seededMine) return;
  const A = AREAS.map((a) => a.id);
  const m = (id, role, status = "joined", extra = {}) => ({ user_id: id, role, status, joined_at: new Date().toISOString(), requested_at: new Date().toISOString(), ...extra });
  const base = { is_sample: false, join_mode: "request", venue: null, created_at: new Date().toISOString() };
  d.tables.push(
    {
      ...base, id: "demo-up-1", host_id: "u_annie", status: "open", area_id: A[0], title: "Korean BBQ Thursday",
      audience: "friends_and_new", starts_at: atDay(2, 19), capacity: 5, budget_cents: 3200, cuisine: "korean_bbq",
      area_label: "Koreatown, Bloor St W", meet_lat: 43.6643, meet_lng: -79.4131, tags: ["easy_conversation", "split_bill"], note: "You're in! Try the “Demo: skip to after the meal” button at the bottom right.",
      members: [m("u_annie", "host"), m(ME, "guest", "joined", { start_label: "Robarts Library", start_lat: 43.6644, start_lng: -79.3995 }), m("u_mia", "guest")],
    },
    {
      ...base, id: "demo-pending-1", host_id: "u_jenny", status: "open", area_id: A[0], title: "Sushi night",
      audience: "new_people", starts_at: atDay(3, 18, 30), capacity: 4, budget_cents: 4000, cuisine: "japanese",
      area_label: "Yonge & Dundas", meet_lat: 43.6561, meet_lng: -79.3802, tags: ["try_somewhere_new"], note: "Waiting for the host to reply (the demo won't approve this one automatically).",
      members: [m("u_jenny", "host"), m(ME, "guest", "requested", { start_label: "Union Station", start_lat: 43.6453, start_lng: -79.3806 })],
    },
    {
      ...base, id: "demo-past-1", host_id: "u_kevin", status: "completed", area_id: A[0], title: "Last weekend's dim sum",
      audience: "friends_and_new", starts_at: atDay(-4, 11, 30), capacity: 4, budget_cents: 2500, cuisine: "dimsum",
      area_label: "Chinatown, Spadina Ave", meet_lat: 43.6535, meet_lng: -79.3987, tags: ["mandarin_friendly", "split_bill"], note: null,
      members: [m("u_kevin", "host"), m(ME, "guest"), m("u_lin", "guest"), m("u_mia", "guest")],
    },
    {
      ...base, id: "demo-past-2", host_id: ME, status: "completed", area_id: A[0], title: "Coffee & chat",
      audience: "new_people", starts_at: atDay(-9, 15), capacity: 4, budget_cents: 1200, cuisine: "cafe",
      area_label: "Kensington Market", meet_lat: 43.6547, meet_lng: -79.4005, tags: ["easy_conversation"], note: "A table you hosted: mark no-shows and write a reflection.",
      members: [m(ME, "host"), m("u_annie", "guest"), m("u_jenny", "guest")],
    }
  );
  const now = Date.now();
  d.photos.push(
    { id: uid(), table_id: "demo-past-1", user_id: "u_kevin", url: svgPhoto("🥟", "#f6d8a8", "#e9a45f"), created_at: new Date(now - 4 * 864e5).toISOString() },
    { id: uid(), table_id: "demo-past-1", user_id: "u_lin", url: svgPhoto("🍵", "#cfe3c2", "#7fae7c"), created_at: new Date(now - 4 * 864e5).toISOString() },
    { id: uid(), table_id: "demo-past-1", user_id: "u_mia", url: svgPhoto("🍤", "#f7c9c0", "#e57f73"), created_at: new Date(now - 4 * 864e5).toISOString() }
  );
  d.seededMine = true;
}

function memberOf(t) {
  return t.members.some((m) => m.user_id === ME && m.status === "joined");
}

function dataUrlOf(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new ApiError("bad_photo"));
    r.readAsDataURL(blob);
  });
}

function db() {
  if (!cache) cache = store.get(KEY) || fresh();
  if (!cache.photos) cache.photos = [];
  if (cache.seedDay !== todayStr()) seedSamples(cache);
  if (cache.session && !cache.seededMine) {
    seedMine(cache);
    persist();
  }
  tick(cache);
  return cache;
}
const persist = () => store.set(KEY, cache);

/** Simulated other people reacting over time. */
function tick(d) {
  const now = Date.now();
  let changed = false;
  for (const t of d.tables) {
    if (t.is_sample) continue;
    // Demo host approves your request
    if (t.demoLive || t.demoAuto) {
      for (const m of t.members) {
        if (m.user_id === ME && m.status === "requested" && now - new Date(m.requested_at).getTime() > 5000) {
          if (joinedCount(t) < t.capacity) {
            m.status = "joined";
            m.joined_at = new Date().toISOString();
            refresh(t);
            changed = true;
          }
        }
      }
    }
    // A simulated friend asks to join a table you host
    if (t.host_id === ME && t.simAt && now >= t.simAt) {
      t.simAt = null;
      if (!t.members.some((m) => m.user_id === "u_annie") && joinedCount(t) < t.capacity) {
        const instant = t.join_mode === "instant";
        t.members.push({
          user_id: "u_annie",
          role: "guest",
          status: instant ? "joined" : "requested",
          requested_at: new Date().toISOString(),
          joined_at: instant ? new Date().toISOString() : null,
          start_label: "Robarts Library",
          start_lat: 43.6644,
          start_lng: -79.3995,
        });
        refresh(t);
        changed = true;
      }
    }
  }
  if (changed) persist();
}

const joinedCount = (t) => t.members.filter((m) => m.status === "joined").length;

function refresh(t) {
  if (t.is_sample || t.status === "cancelled" || t.status === "completed") return;
  t.status = joinedCount(t) >= t.capacity ? "full" : "open";
}

function userInfo(id) {
  const d = cache;
  if (id === ME) {
    const p = d.profile || {};
    const zh = getLang() === "zh";
    const dflt = !p.display_name || p.display_name === "New friend";
    return { id: ME, is_default_name: dflt, display_name: dflt ? (zh ? "新朋友" : "New friend") : p.display_name, avatar_emoji: p.avatar_emoji || "🍊", languages_spoken: p.languages_spoken || [], no_show_count: 0 };
  }
  const o = OTHERS[id];
  const zh = getLang() === "zh";
  return o ? { ...o, display_name: zh && o.name_zh ? o.name_zh : o.display_name, no_show_count: d.noShows[id] || 0 } : { id, display_name: zh ? "访客" : "Guest", avatar_emoji: "🍽️", languages_spoken: [], no_show_count: 0 };
}

const isBlockedPair = (hostId) => !!hostId && hostId !== ME && cache.blocks.some((b) => b.user_id === hostId);

function tableJson(t) {
  const L = demoText(t);
  const mine = t.members.find((m) => m.user_id === ME);
  return {
    id: t.id,
    host_id: t.host_id,
    host: t.host_id ? userInfo(t.host_id) : { id: null, display_name: t.sample_host.name, avatar_emoji: t.sample_host.emoji, languages_spoken: [], no_show_count: 0 },
    area_id: t.area_id,
    title: L ? L.title : t.title,
    audience: t.audience,
    starts_at: t.starts_at,
    capacity: t.capacity,
    budget_cents: t.budget_cents ?? null,
    cuisine: t.cuisine ?? null,
    venue: t.venue || null,
    area_label: (L ? L.area : t.area_label) || null,
    meet_lat: t.meet_lat ?? null,
    meet_lng: t.meet_lng ?? null,
    tags: [...(t.tags || [])],
    occasion: t.occasion ?? null,
    note: (L ? L.note : t.note) || null,
    join_mode: t.join_mode,
    status: t.status,
    is_sample: !!t.is_sample,
    is_private: !!t.is_private,
    seats_taken: t.is_sample ? t.sample_seats : joinedCount(t),
    pending_count: t.host_id === ME ? t.members.filter((m) => m.status === "requested").length : 0,
    my_status: mine ? (mine.role === "host" && mine.status === "joined" ? "host" : mine.status) : null,
    created_at: t.created_at,
  };
}

function need(id) {
  const t = db().tables.find((x) => x.id === id);
  if (!t) throw new ApiError("not_found");
  return t;
}

function requireUser() {
  const d = db();
  if (!d.session) throw new ApiError("not_authenticated");
  return d;
}

const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));


function startSession(email, guest) {
  const d = db();
  d.session = { userId: ME, email, guest };
    if (!d.profile) {
      d.profile = {
        id: ME,
        area_id: AREAS[0].id,
        display_name: "New friend",
        avatar_emoji: "🍊",
        language: getLang(),
        languages_spoken: [],
        dietary_notes: "",
        budget_cents: null,
        no_show_count: 0,
        status: "active",
        onboarded_at: null,
      };
    }
    seedMine(d);
    persist();
    authListeners.forEach((cb) => cb(clone(d.session)));
    return clone(d.session);
  
}

export const api = {
  mode: "demo",

  // ------------------------------------------------------------ auth
  async init() {
    await wait(10);
    return clone(db().session);
  },
  onAuthChange(cb) {
    authListeners.add(cb);
    return () => authListeners.delete(cb);
  },
  async signInWithEmail(email) {
    await wait(250);
    if (!/^\S+@\S+\.\S+$/.test(email || "")) throw new ApiError("bad_email");
    return { demo: true };
  },
  async verifyCode(email, code) {
    await wait(250);
    if (String(code).trim() !== DEMO_CODE) throw new ApiError("bad_code");
    return startSession(email, false);
  },
  async signInGuest() {
    await wait(250);
    return startSession("", true);
  },
  async signOut() {
    const d = db();
    d.session = null;
    persist();
    authListeners.forEach((cb) => cb(null));
  },

  // ------------------------------------------------------------ profile
  async getMe() {
    const d = requireUser();
    return { ...clone(d.profile), email: d.session.email, guest: !!d.session.guest, ranks: [...d.ranks] };
  },
  async saveProfile(patch) {
    const d = requireUser();
    const allowed = ["display_name", "avatar_emoji", "area_id", "language", "languages_spoken", "dietary_notes", "budget_cents", "onboarded_at"];
    for (const k of allowed) if (k in patch) d.profile[k] = clone(patch[k]);
    persist();
    return clone(d.profile);
  },
  async savePrefs(slugs) {
    const d = requireUser();
    d.ranks = [...slugs];
    persist();
  },
  async listAreas() {
    return clone(AREAS);
  },
  async listCuisines() {
    return clone(CUISINES);
  },

  // ------------------------------------------------------------ tables
  async listTables({ areaId = null } = {}) {
    const d = requireUser();
    await wait();
    return d.tables
      .filter((t) => ["open", "full"].includes(t.status))
      .filter((t) => !t.is_private)
      .filter((t) => new Date(t.starts_at).getTime() > Date.now() - 3600e3)
      .filter((t) => !areaId || t.area_id === areaId)
      .filter((t) => !isBlockedPair(t.host_id))
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
      .map(tableJson);
  },

  async getTable(id) {
    const d = requireUser();
    await wait(30);
    const t = need(id);
    if (isBlockedPair(t.host_id)) throw new ApiError("not_found");
    const isHost = t.host_id === ME;
    const canSee = isHost || t.members.some((m) => m.user_id === ME && m.status === "joined");
    const members = t.members
      .filter((m) => (m.status === "joined" && (!t.is_private || canSee)) || (isHost && m.status === "requested") || m.user_id === ME)
      .filter((m) => m.user_id === ME || !isBlockedPair(m.user_id))
      .map((m) => {
        const u = userInfo(m.user_id);
        const see = isHost || m.user_id === ME || (t.is_private && canSee);
        return {
          user_id: m.user_id,
          role: m.role,
          status: m.status,
          display_name: u.display_name,
          avatar_emoji: u.avatar_emoji,
          no_show_count: isHost ? u.no_show_count : null,
          start_label: see ? m.start_label ?? null : null,
          start_lat: see ? m.start_lat ?? null : null,
          start_lng: see ? m.start_lng ?? null : null,
          cuisine: see ? m.cuisine ?? null : null,
        };
      });
    const mine = t.members.find((m) => m.user_id === ME);
    return clone({
      ...tableJson(t),
      members,
      my_membership: mine ? { start_label: mine.start_label ?? null, start_lat: mine.start_lat ?? null, start_lng: mine.start_lng ?? null, intention: mine.intention ?? null, pace: mine.pace ?? null, cuisine: mine.cuisine ?? null } : null,
    });
  },

  async createTable(p) {
    const d = requireUser();
    await wait(120);
    const starts = new Date(p.starts_at);
    if (!p.starts_at || isNaN(starts) || starts < Date.now()) throw new ApiError("start_in_past");
    const cap = Number(p.capacity);
    if (!Number.isInteger(cap) || cap < 2 || cap > 12) throw new ApiError("bad_capacity");
    const recent = d.tables.filter((t) => t.host_id === ME && Date.now() - new Date(t.created_at) < 864e5).length;
    if (recent >= 5) throw new ApiError("rate_limited");

    const t = {
      id: uid(),
      host_id: ME,
      is_sample: false,
      status: "open",
      join_mode: p.audience === "friends" || p.join_mode === "instant" ? "instant" : "request",
      is_private: p.audience === "friends",
      area_id: p.area_id || d.profile.area_id,
      title: (p.title || "").trim().slice(0, 60) || null,
      audience: p.audience || "friends_and_new",
      starts_at: starts.toISOString(),
      capacity: cap,
      budget_cents: p.budget_cents ?? null,
      cuisine: p.cuisine || null,
      venue: p.venue && p.venue.name ? { id: uid(), name: p.venue.name, address: p.venue.address || null, lat: p.venue.lat ?? null, lng: p.venue.lng ?? null } : null,
      area_label: (p.area_label || "").slice(0, 120) || null,
      meet_lat: p.meet_lat ?? null,
      meet_lng: p.meet_lng ?? null,
      tags: [...(p.tags || [])],
      occasion: p.occasion || null,
      note: (p.note || "").trim().slice(0, 280) || null,
      created_at: new Date().toISOString(),
      simAt: Date.now() + 8000,
      members: [{ user_id: ME, role: "host", status: "joined", joined_at: new Date().toISOString(), intention: p.intention || null, pace: p.pace || null }],
    };
    d.tables.push(t);
    refresh(t);
    persist();
    return { id: t.id };
  },

  async requestJoin(id, o = {}) {
    const d = requireUser();
    await wait(120);
    const t = need(id);
    if (t.is_sample) throw new ApiError("sample_table");
    if (t.host_id === ME) throw new ApiError("is_host");
    if (isBlockedPair(t.host_id)) throw new ApiError("not_found");
    if (t.status !== "open") throw new ApiError("not_open");
    if (new Date(t.starts_at) < Date.now()) throw new ApiError("start_in_past");
    const ex = t.members.find((m) => m.user_id === ME);
    if (ex && ["requested", "joined"].includes(ex.status)) throw new ApiError("already_member");
    if (ex && ["declined", "removed"].includes(ex.status)) throw new ApiError("not_allowed");
    const open = d.tables.filter((x) => x.members.some((m) => m.user_id === ME && m.status === "requested")).length;
    if (open >= 5) throw new ApiError("too_many_requests");
    const status = t.join_mode === "instant" ? "joined" : "requested";
    if (status === "joined" && joinedCount(t) >= t.capacity) throw new ApiError("full");
    const row = {
      user_id: ME,
      role: "guest",
      status,
      start_label: o.start_label || null,
      start_lat: o.start_lat ?? null,
      start_lng: o.start_lng ?? null,
      intention: o.intention || null,
      pace: o.pace || null,
      requested_at: new Date().toISOString(),
      joined_at: status === "joined" ? new Date().toISOString() : null,
    };
    if (ex) Object.assign(ex, row);
    else t.members.push(row);
    refresh(t);
    persist();
    return { status };
  },

  async updateMembership(id, o = {}) {
    requireUser();
    const t = need(id);
    const m = t.members.find((x) => x.user_id === ME && ["requested", "joined"].includes(x.status));
    if (!m) throw new ApiError("not_found");
    Object.assign(m, { start_label: o.start_label || null, start_lat: o.start_lat ?? null, start_lng: o.start_lng ?? null, intention: o.intention || null, pace: o.pace || null });
    persist();
  },

  async setCraving(id, slug) {
    requireUser();
    const t = need(id);
    const m = t.members.find((x) => x.user_id === ME && ["requested", "joined"].includes(x.status));
    if (!m) throw new ApiError("not_found");
    m.cuisine = slug || null;
    persist();
  },

  async leaveTable(id) {
    requireUser();
    const t = need(id);
    if (t.host_id === ME) throw new ApiError("host_cannot_leave");
    const m = t.members.find((x) => x.user_id === ME && ["requested", "joined"].includes(x.status));
    if (m) m.status = "left";
    refresh(t);
    persist();
  },

  async respondJoin(id, userId, accept) {
    requireUser();
    const t = need(id);
    if (t.host_id !== ME) throw new ApiError("not_allowed");
    const m = t.members.find((x) => x.user_id === userId && x.status === "requested");
    if (!m) throw new ApiError("not_found");
    if (accept) {
      if (joinedCount(t) >= t.capacity) throw new ApiError("full");
      m.status = "joined";
      m.joined_at = new Date().toISOString();
    } else m.status = "declined";
    refresh(t);
    persist();
  },

  async removeMember(id, userId) {
    requireUser();
    const t = need(id);
    if (t.host_id !== ME || userId === ME) throw new ApiError("not_allowed");
    const m = t.members.find((x) => x.user_id === userId && ["requested", "joined"].includes(x.status));
    if (m) m.status = "removed";
    refresh(t);
    persist();
  },

  async cancelTable(id) {
    requireUser();
    const t = need(id);
    if (t.host_id !== ME || !["open", "full"].includes(t.status)) throw new ApiError("not_allowed");
    t.status = "cancelled";
    persist();
  },

  async setVenue(id, venue) {
    requireUser();
    const t = need(id);
    const memberOk = t.is_private && t.members.some((m) => m.user_id === ME && m.status === "joined");
    if (t.host_id !== ME && !memberOk) throw new ApiError("not_allowed");
    if (!venue?.name?.trim()) throw new ApiError("bad_venue");
    t.venue = { id: uid(), name: venue.name, address: venue.address || null, lat: venue.lat ?? null, lng: venue.lng ?? null };
    t.area_label = venue.name.slice(0, 120);
    if (venue.lat != null) {
      t.meet_lat = venue.lat;
      t.meet_lng = venue.lng;
    }
    persist();
  },

  async markNoShow(id, userId) {
    requireUser();
    const d = db();
    const t = need(id);
    if (t.host_id !== ME || new Date(t.starts_at) > Date.now() || userId === ME) throw new ApiError("not_allowed");
    const m = t.members.find((x) => x.user_id === userId && x.status === "joined");
    if (m) {
      m.status = "left";
      d.noShows[userId] = (d.noShows[userId] || 0) + 1;
    }
    persist();
  },

  async listMyTables() {
    const d = requireUser();
    await wait(30);
    return d.tables
      .filter((t) => new Date(t.starts_at) > Date.now() - 45 * 864e5)
      .filter((t) => t.members.some((m) => m.user_id === ME && ["requested", "joined", "declined"].includes(m.status)))
      .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at))
      .map(tableJson);
  },

  // ------------------------------------------------------------ reflections (private)
  async listReflections() {
    const d = requireUser();
    return clone([...d.reflections].sort((a, b) => (b.on_date + b.created_at).localeCompare(a.on_date + a.created_at)));
  },
  async saveReflection(r) {
    const d = requireUser();
    const now = new Date().toISOString();
    const clean = {
      id: r.id || uid(),
      table_id: r.table_id || null,
      table_title: r.table_title || null,
      on_date: r.on_date || todayStr(),
      mood: r.mood ?? null,
      food_enjoyment: r.food_enjoyment ?? null,
      conversation_comfort: r.conversation_comfort ?? null,
      takeaway: (r.takeaway || "").slice(0, 500) || null,
      next_step: (r.next_step || "").slice(0, 500) || null,
    };
    const i = d.reflections.findIndex((x) => x.id === clean.id);
    if (i >= 0) d.reflections[i] = { ...d.reflections[i], ...clean, updated_at: now };
    else d.reflections.push({ ...clean, created_at: r.created_at || now, updated_at: now });
    persist();
    return clone(d.reflections.find((x) => x.id === clean.id));
  },
  async deleteReflection(id) {
    const d = requireUser();
    const i = d.reflections.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const [removed] = d.reflections.splice(i, 1);
    persist();
    return clone(removed);
  },

  // ------------------------------------------------------------ safety
  async reportContent({ table_id = null, user_id = null, reason, details = "" }) {
    const d = requireUser();
    if (!table_id && !user_id) throw new ApiError("bad_report");
    d.reports.push({ id: uid(), table_id, user_id, reason, details: details.slice(0, 1000), created_at: new Date().toISOString() });
    persist();
  },
  async blockUser(userId) {
    const d = requireUser();
    if (!userId || userId === ME) throw new ApiError("bad_request");
    if (!d.blocks.some((b) => b.user_id === userId)) d.blocks.push({ user_id: userId, created_at: new Date().toISOString() });
    for (const t of d.tables) {
      if (t.host_id === userId) t.members.filter((m) => m.user_id === ME && ["requested", "joined"].includes(m.status)).forEach((m) => (m.status = "left"));
      if (t.host_id === ME) t.members.filter((m) => m.user_id === userId && ["requested", "joined"].includes(m.status)).forEach((m) => (m.status = "removed"));
      refresh(t);
    }
    persist();
  },
  async unblockUser(userId) {
    const d = requireUser();
    d.blocks = d.blocks.filter((b) => b.user_id !== userId);
    persist();
  },
  async listBlocks() {
    const d = requireUser();
    return d.blocks.map((b) => {
      const u = userInfo(b.user_id);
      return { user_id: b.user_id, display_name: u.display_name, avatar_emoji: u.avatar_emoji };
    });
  },

  // ------------------------------------------------------------ photos (members only)
  async listPhotos(tableId) {
    const d = requireUser();
    const t = need(tableId);
    if (!memberOf(t)) throw new ApiError("not_allowed");
    return d.photos
      .filter((p) => p.table_id === tableId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((p) => ({ id: p.id, url: p.url, user_id: p.user_id, mine: p.user_id === ME, display_name: userInfo(p.user_id).display_name, avatar_emoji: userInfo(p.user_id).avatar_emoji, created_at: p.created_at }));
  },
  async addPhoto(tableId, blob) {
    const d = requireUser();
    const t = need(tableId);
    if (!memberOf(t)) throw new ApiError("not_allowed");
    if (d.photos.filter((p) => p.table_id === tableId).length >= 12) throw new ApiError("too_many_photos");
    const url = await dataUrlOf(blob);
    const row = { id: uid(), table_id: tableId, user_id: ME, url, created_at: new Date().toISOString() };
    d.photos.push(row);
    if (!store.set(KEY, d)) {
      d.photos.pop();
      throw new ApiError("storage_full");
    }
    return { id: row.id };
  },
  async deletePhoto(photoId) {
    const d = requireUser();
    d.photos = d.photos.filter((p) => !(p.id === photoId && p.user_id === ME));
    persist();
  },

  // ------------------------------------------------------------ demo-only helpers
  /** Pretend the meal already happened, so the after-dinner features (photos, reflection, no-shows) can be tried. */
  async demoFastForward(id) {
    requireUser();
    const t = need(id);
    if (!t.members.some((m) => m.user_id === ME && m.status === "joined")) throw new ApiError("not_allowed");
    t.starts_at = new Date(Date.now() - 3 * 3600e3).toISOString();
    t.status = "completed";
    persist();
  },
  async demoReset() {
    store.remove(KEY);
    cache = null;
    authListeners.forEach((cb) => cb(null));
  },

  async deleteAccount() {
    store.remove(KEY);
    cache = null;
    authListeners.forEach((cb) => cb(null));
  },
};
