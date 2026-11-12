// LIVE data layer: Supabase (Postgres + Auth + RLS). Same surface as api-demo.js.
// Reads/writes of shared data go through RPC functions defined in supabase/schema.sql;
// only the user's own profile, cuisine ranking and private reflections use tables directly.
import { ApiError, codeOf } from "./errors.js";

const SDK_URL = "https://esm.sh/@supabase/supabase-js@2.119.0";

export async function createApi(cfg) {
  const { createClient } = await import(/* @vite-ignore */ SDK_URL);
  const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
  });

  const wrap = async (p) => {
    try {
      const res = await p;
      if (res && res.error) throw res.error;
      return res ? res.data : null;
    } catch (e) {
      throw new ApiError(codeOf(e), e?.message || "");
    }
  };
  const rpc = (fn, args) => wrap(sb.rpc(fn, args));
  const toSession = (s) => (s?.user ? { userId: s.user.id, email: s.user.email || "", guest: !s.user.email } : null);
  let current = null;

  // Live sync without touching the database: after changing something, a client pings a shared Broadcast
  // channel; every other open app then re-reads through the normal RPCs (which enforce permissions).
  // The ping carries only a table id, never data. If Realtime is unavailable the app still polls.
  const liveListeners = new Set();
  let liveCh = null;
  const liveStart = () => {
    if (liveCh) return;
    try {
      liveCh = sb
        .channel("tb-live", { config: { broadcast: { self: false } } })
        .on("broadcast", { event: "changed" }, ({ payload }) => liveListeners.forEach((fn) => { try { fn(payload || {}); } catch { /* ignore */ } }))
        .subscribe();
    } catch { liveCh = null; }
  };
  const ping = (table) => {
    try { liveCh?.send({ type: "broadcast", event: "changed", payload: { table: table || null } }); } catch { /* ignore */ }
  };
  const changed = async (id, promise) => {
    const r = await promise;
    ping(id ?? r?.id);
    return r;
  };

  const uid = () => {
    if (!current) throw new ApiError("not_authenticated");
    return current.userId;
  };

  return {
    mode: "supabase",

    /** Subscribe to "something changed" pings from other people. Returns an unsubscribe function. */
    onLive(cb) {
      liveStart();
      liveListeners.add(cb);
      return () => liveListeners.delete(cb);
    },

    // ---------------------------------------------------------- auth
    async init() {
      const { data } = await sb.auth.getSession();
      current = toSession(data?.session);
      return current;
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_evt, session) => {
        current = toSession(session);
        cb(current);
      });
      return () => data.subscription.unsubscribe();
    },
    async signInWithEmail(email) {
      if (!/^\S+@\S+\.\S+$/.test(email || "")) throw new ApiError("bad_email");
      await wrap(
        sb.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname },
        })
      );
      return { demo: false };
    },
    /** Quick start without an email: an anonymous Supabase account (turn on "Allow anonymous sign-ins" in the dashboard). */
    async signInGuest() {
      try {
        const { data, error } = await sb.auth.signInAnonymously();
        if (error) throw error;
        current = toSession(data.session);
        return current;
      } catch (e) {
        throw new ApiError("guest_unavailable", e?.message || "");
      }
    },
    async verifyCode(email, code) {
      try {
        const { data, error } = await sb.auth.verifyOtp({ email, token: String(code).trim(), type: "email" });
        if (error) throw error;
        current = toSession(data.session);
        return current;
      } catch (e) {
        throw new ApiError("bad_code", e?.message || "");
      }
    },
    async signOut() {
      await sb.auth.signOut();
      current = null;
    },

    // ---------------------------------------------------------- profile
    async getMe() {
      const id = uid();
      const [prof, prefs] = await Promise.all([
        wrap(sb.from("profiles").select("*").eq("id", id).single()),
        wrap(sb.from("user_cuisine_prefs").select("cuisine_slug,rank").eq("user_id", id).order("rank")),
      ]);
      if (prof.status === "suspended") throw new ApiError("account_suspended");
      return { ...prof, email: current.email, guest: !!current.guest, ranks: (prefs || []).map((p) => p.cuisine_slug) };
    },
    async saveProfile(patch) {
      const allowed = ["display_name", "avatar_emoji", "area_id", "language", "languages_spoken", "dietary_notes", "budget_cents", "onboarded_at"];
      const row = {};
      for (const k of allowed) if (k in patch) row[k] = patch[k];
      return wrap(sb.from("profiles").update(row).eq("id", uid()).select().single());
    },
    async savePrefs(slugs) {
      const id = uid();
      await wrap(sb.from("user_cuisine_prefs").delete().eq("user_id", id));
      if (slugs.length) {
        await wrap(sb.from("user_cuisine_prefs").insert(slugs.map((s, i) => ({ user_id: id, cuisine_slug: s, rank: i + 1 }))));
      }
    },
    async listAreas() {
      return wrap(sb.from("areas").select("*").eq("is_active", true).order("sort"));
    },
    async listCuisines() {
      return wrap(sb.from("cuisines").select("*").order("sort"));
    },

    // ---------------------------------------------------------- tables
    listTables({ areaId = null } = {}) {
      return rpc("list_tables", { p_area: areaId });
    },
    getTable(id) {
      return rpc("get_table", { p_id: id });
    },
    createTable(p) {
      return changed(null, rpc("create_table", { p }));
    },
    requestJoin(id, o = {}) {
      return changed(id, rpc("request_join", {
        p_table: id,
        p_start_label: o.start_label || null,
        p_start_lat: o.start_lat ?? null,
        p_start_lng: o.start_lng ?? null,
        p_intention: o.intention || null,
        p_pace: o.pace || null,
      }));
    },
    async updateMembership(id, o = {}) {
      await changed(id, rpc("update_membership", {
        p_table: id,
        p_start_label: o.start_label || null,
        p_start_lat: o.start_lat ?? null,
        p_start_lng: o.start_lng ?? null,
        p_intention: o.intention || null,
        p_pace: o.pace || null,
      }));
    },
    async setCraving(id, slug) {
      await changed(id, rpc("set_my_craving", { p_table: id, p_cuisine: slug || null }));
    },
    async leaveTable(id) {
      await changed(id, rpc("leave_table", { p_table: id }));
    },
    async respondJoin(id, userId, accept) {
      await changed(id, rpc("respond_join", { p_table: id, p_user: userId, p_accept: !!accept }));
    },
    async removeMember(id, userId) {
      await changed(id, rpc("remove_member", { p_table: id, p_user: userId }));
    },
    async cancelTable(id) {
      await changed(id, rpc("cancel_table", { p_table: id }));
    },
    async setVenue(id, venue) {
      await changed(id, rpc("set_venue", { p_table: id, p_venue: venue }));
    },
    async markNoShow(id, userId) {
      await rpc("mark_no_show", { p_table: id, p_user: userId });
    },
    listMyTables() {
      return rpc("list_my_tables");
    },

    // ---------------------------------------------------------- reflections (private, RLS: own rows only)
    async listReflections() {
      return wrap(sb.from("reflections").select("*").eq("user_id", uid()).order("on_date", { ascending: false }).order("created_at", { ascending: false }));
    },
    async saveReflection(r) {
      const row = {
        user_id: uid(),
        table_id: r.table_id && !String(r.table_id).startsWith("sample-") ? r.table_id : null,
        table_title: r.table_title || null,
        on_date: r.on_date || undefined,
        mood: r.mood ?? null,
        food_enjoyment: r.food_enjoyment ?? null,
        conversation_comfort: r.conversation_comfort ?? null,
        takeaway: (r.takeaway || "").slice(0, 500) || null,
        next_step: (r.next_step || "").slice(0, 500) || null,
      };
      if (r.id) {
        return wrap(sb.from("reflections").update({ ...row, updated_at: new Date().toISOString() }).eq("id", r.id).eq("user_id", row.user_id).select().single());
      }
      return wrap(sb.from("reflections").insert(row).select().single());
    },
    async deleteReflection(id) {
      return wrap(sb.from("reflections").delete().eq("id", id).eq("user_id", uid()).select().maybeSingle());
    },

    // ---------------------------------------------------------- photos (members only; private Storage bucket)
    async listPhotos(tableId) {
      const rows = (await rpc("list_table_photos", { p_table: tableId })) || [];
      if (!rows.length) return [];
      const { data, error } = await sb.storage.from("table-photos").createSignedUrls(rows.map((r) => r.path), 3600);
      if (error) throw new ApiError(codeOf(error), error.message);
      const urls = new Map((data || []).map((d) => [d.path, d.signedUrl]));
      return rows.filter((r) => urls.get(r.path)).map((r) => ({ ...r, url: urls.get(r.path), mine: r.user_id === uid() }));
    },
    async addPhoto(tableId, blob) {
      const path = `${tableId}/${uid()}/${crypto.randomUUID()}.jpg`;
      const up = await sb.storage.from("table-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (up.error) throw new ApiError(codeOf(up.error), up.error.message);
      try {
        return await rpc("add_table_photo", { p_table: tableId, p_path: path });
      } catch (e) {
        await sb.storage.from("table-photos").remove([path]).catch(() => {});
        throw e;
      }
    },
    async deletePhoto(photoId) {
      const path = await rpc("delete_table_photo", { p_id: photoId });
      if (path) await sb.storage.from("table-photos").remove([path]).catch(() => {});
    },

    // ---------------------------------------------------------- safety
    async reportContent({ table_id = null, user_id = null, reason, details = "" }) {
      await rpc("report_content", { p_table: table_id, p_user: user_id, p_reason: reason, p_details: details });
    },
    async blockUser(userId) {
      await rpc("block_user", { p_user: userId });
    },
    async unblockUser(userId) {
      await rpc("unblock_user", { p_user: userId });
    },
    listBlocks() {
      return rpc("list_blocks");
    },
    async deleteAccount() {
      await rpc("delete_my_account");
      await sb.auth.signOut().catch(() => {});
      current = null;
    },
  };
}
