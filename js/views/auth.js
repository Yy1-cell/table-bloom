// Sign in with an email code (or magic link). In demo mode any email works and the code is 123456.
import { esc, qs } from "../util.js";
import { t } from "../i18n.js";
import { state } from "../state.js";
import { api } from "../api.js";
import { withBusy, showError } from "./common.js";
import { announce } from "../ui.js";

export async function render(root) {
  let step = "email";
  let email = "";
  let cooldown = 0;
  let timer = null;

  function draw() {
    const demo = state.mode === "demo";
    root.innerHTML = `
    <section class="card auth-card stack">
      <div class="center"><div style="font-size:42px" aria-hidden="true">🍲</div><h1>${esc(t("auth.title"))}</h1><p class="muted">${esc(t("auth.sub"))}</p></div>
      ${demo ? `<div class="notice">🧪 ${esc(t("auth.demo"))}</div>` : ""}
      ${
        step === "email"
          ? `<form id="f-email" novalidate>
              <div class="field"><label for="a-email">${esc(t("auth.email"))}</label>
                <input id="a-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" required value="${esc(email)}" placeholder="you@example.com"></div>
              <label class="row" style="align-items:flex-start;margin-bottom:14px"><input id="a-age" type="checkbox" style="width:22px;height:22px;margin-top:2px;accent-color:var(--green-700)"> <span style="font-size:14px">${esc(t("auth.age"))}</span></label>
              <div class="err-text" id="a-err" role="alert"></div>
              <button class="btn primary block" type="submit">${esc(t("auth.send"))}</button>
              <div class="auth-or" aria-hidden="true"><span>${esc(t("auth.or"))}</span></div>
              <button class="btn block" type="button" id="a-guest">${esc(t("auth.guest"))}</button>
              <p class="hint">${esc(t("auth.guestHint"))}</p>
            </form>`
          : `<form id="f-code" novalidate>
              <p>${esc(t("auth.sent", { email }))}</p>
              <div class="field"><label for="a-code">${esc(t("auth.code"))}</label>
                <input id="a-code" class="code-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" required placeholder="••••••"></div>
              <div class="err-text" id="a-err" role="alert"></div>
              <button class="btn primary block" type="submit">${esc(t("auth.verify"))}</button>
              <div class="row" style="justify-content:space-between;margin-top:10px">
                <button type="button" class="btn sm ghost" id="a-back">${esc(t("auth.other"))}</button>
                <button type="button" class="btn sm ghost" id="a-resend" ${cooldown ? "disabled" : ""}>${esc(cooldown ? t("auth.resendIn", { s: cooldown }) : t("auth.resend"))}</button>
              </div>
              ${demo ? "" : `<p class="hint">${esc(t("auth.linkHint"))}</p>`}
            </form>`
      }
    </section>`;
    wire();
    (qs("#a-email", root) || qs("#a-code", root))?.focus();
  }

  const setErr = (m) => {
    const e = qs("#a-err", root);
    if (e) e.textContent = m;
    if (m) announce(m);
  };

  function startCooldown() {
    cooldown = 30;
    clearInterval(timer);
    timer = setInterval(() => {
      cooldown--;
      const b = qs("#a-resend", root);
      if (!b || cooldown <= 0) {
        clearInterval(timer);
        cooldown = 0;
        if (b) {
          b.disabled = false;
          b.textContent = t("auth.resend");
        }
      } else b.textContent = t("auth.resendIn", { s: cooldown });
    }, 1000);
  }

  async function send(btn) {
    try {
      await withBusy(btn, () => api.signInWithEmail(email));
      step = "code";
      startCooldown();
      draw();
    } catch (e) {
      setErr(t("err." + (e.code === "bad_email" ? "bad_email" : "unknown")));
      showError(e);
    }
  }

  function wire() {
    qs("#f-email", root)?.addEventListener("submit", (e) => {
      e.preventDefault();
      email = qs("#a-email", root).value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) return setErr(t("err.bad_email"));
      if (!qs("#a-age", root).checked) return setErr(t("auth.ageNeeded"));
      send(qs('[type="submit"]', root));
    });
    qs("#a-guest", root)?.addEventListener("click", async (e) => {
      if (!qs("#a-age", root).checked) return setErr(t("auth.ageNeeded"));
      try {
        await withBusy(e.currentTarget, () => api.signInGuest());
        // main.js reacts to the auth change and navigates on
      } catch (err) {
        setErr(t("err." + (err.code === "guest_unavailable" ? "guest_unavailable" : "unknown")));
      }
    });
    qs("#f-code", root)?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = qs("#a-code", root).value.replace(/\D/g, "");
      if (code.length < 6) return setErr(t("err.bad_code"));
      try {
        await withBusy(qs('[type="submit"]', root), () => api.verifyCode(email, code));
        // main.js reacts to the auth change and navigates on
      } catch (err) {
        setErr(t("err." + (err.code === "bad_code" ? "bad_code" : "unknown")));
        qs("#a-code", root)?.select();
      }
    });
    qs("#a-back", root)?.addEventListener("click", () => {
      step = "email";
      draw();
    });
    qs("#a-resend", root)?.addEventListener("click", (e) => send(e.currentTarget));
  }

  draw();
  return () => clearInterval(timer);
}
