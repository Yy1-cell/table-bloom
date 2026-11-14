// One error type for both data layers. `code` is a short machine word such as "full" or "not_found";
// the UI turns it into a friendly sentence with t("err." + code).
export class ApiError extends Error {
  constructor(code, detail = "") {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

const KNOWN = new Set([
  "not_authenticated", "account_suspended", "not_found", "not_allowed", "not_open", "full", "already_member",
  "is_host", "host_cannot_leave", "start_in_past", "bad_capacity", "rate_limited", "too_many_requests",
  "sample_table", "bad_venue", "bad_report", "bad_request", "bad_code", "bad_email", "network", "too_many_photos", "storage_full", "bad_photo", "guest_unavailable", "too_early",
]);

/** Turn anything thrown (ApiError, Supabase error, fetch failure) into one of our codes. */
export function codeOf(err) {
  if (!err) return "unknown";
  if (err instanceof ApiError) return err.code;
  const msg = String(err.message || err.details || err).toLowerCase();
  for (const k of KNOWN) if (msg.includes(k)) return k;
  if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("load failed")) return "network";
  if (msg.includes("jwt") || msg.includes("not signed in")) return "not_authenticated";
  return "unknown";
}
