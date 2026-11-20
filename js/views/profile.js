// Profile & settings: name, emoji, fixed dietary needs (set once), blocked users, install, sign-out, delete account.
// Language lives in the header button; budget and cuisine are picked per meal (Map / host form), not stored here.
import { esc, qs, qsa, isIOS, isStandalone } from "../util.js";
import { t } from "../i18n.js";
import { state } from "../state.js";
import { api } from "../api.js";
import { toast, announce, confirmDialog } from "../ui.js";
import { AVATARS } from "../data.js";
import { fixedPickerHTML, wireChips, readChips } from "./diet.js";
import { showError, withBusy, go } from "./common.js";

export async function render(root) {
  const me = state.me;
  const onboarding = !me.onboarded_at;
  const draft = { avatar: me.avatar_emoji };
  let blocks = [];
  try {
    blocks = await api.listBlocks();
  } catch {}
  try {
    if (state.isAdmin === undefined) state.isAdmin = (await api.adminCheck?.()) === true;
  } catch {
    state.isAdmin = false;
  }

  function installBlock() {
    if (isStandalone()) return `<p class="muted">✅ ${esc(t("pf.installed"))}</p>`;
    if (state.installEvent) return `<button type="button" class="btn" id="install">📲 ${esc(t("pf.install"))}</button>`;
    if (isIOS()) return `<p class="muted">${esc(t("pf.installIOS"))}</p>`;
    return `<p class="muted">${esc(t("pf.installOther"))}</p>`;
  }

  function draw() {
    root.innerHTML = `
    <h1>${esc(onboarding ? t("pf.welcome") : t("pf.title"))}</h1>
    ${onboarding ? `<div class="setup-card"><strong>${esc(t("pf.onbTitle"))}</strong><br>${esc(t("pf.onbBody"))}</div>` : ""}
    <form id="pf" class="card stack" novalidate>
      <div class="field" style="margin:0"><label for="pf-name">${esc(t("pf.name"))}</label>
        <input id="pf-name" type="text" maxlength="30" required value="${esc(((me.is_default_name || me.display_name === "New friend") && onboarding ? "" : me.display_name))}" placeholder="${esc(t("pf.namePh"))}">
        <div class="err-text" id="pf-name-err" role="alert"></div></div>
      <fieldset style="margin:0"><legend>${esc(t("pf.avatar"))}</legend><div class="avatar-pick">
        ${AVATARS.map((a) => `<label><input type="radio" name="av" value="${a}" ${draft.avatar === a ? "checked" : ""}><span>${a}</span></label>`).join("")}
      </div></fieldset>
      ${onboarding ? `<details class="profile-diet"><summary>${esc(t("diet.optional"))}</summary>` : ""}
      <fieldset style="margin:0"><legend>${esc(t("diet.title"))}</legend><p class="hint" style="margin-top:0">${esc(t("diet.profileHint"))}</p>
        ${fixedPickerHTML(me.dietary_tags || [])}
        <div class="field" style="margin:10px 0 0"><label for="pf-diet">${esc(t("diet.profileNote"))}</label>
          <input id="pf-diet" type="text" maxlength="200" value="${esc(me.dietary_notes || "")}" placeholder="${esc(t("diet.profileNotePh"))}"></div></fieldset>
      ${onboarding ? "</details>" : ""}
      <button type="submit" class="btn primary block">${esc(onboarding ? t("pf.saveStart") : t("common.save"))}</button>
    </form>

    ${
      onboarding
        ? ""
        : `
    <section class="card stack" style="margin-top:16px"><h2>${esc(t("pf.blocked"))}</h2>
      ${blocks.length ? `<ul class="list-plain">${blocks.map((b) => `<li><span class="av">${esc(b.avatar_emoji)}</span><span style="flex:1">${esc(b.display_name)}</span><button type="button" class="btn sm" data-unblock="${esc(b.user_id)}">${esc(t("pf.unblock"))}</button></li>`).join("")}</ul>` : `<p class="muted">${esc(t("pf.noBlocks"))}</p>`}
    </section>
    <section class="card stack" style="margin-top:16px"><h2>${esc(t("pf.app"))}</h2>${installBlock()}</section>
    <section class="card stack" style="margin-top:16px"><h2>${esc(t("pf.safety"))}</h2>
      <ul style="margin:0;padding-left:20px"><li>${esc(t("pf.tip1"))}</li><li>${esc(t("pf.tip2"))}</li><li>${esc(t("pf.tip3"))}</li></ul>
      ${window.TB_CONFIG?.SUPPORT_EMAIL ? `<p><a href="mailto:${esc(window.TB_CONFIG.SUPPORT_EMAIL)}">${esc(t("pf.contact"))}</a></p>` : ""}
    </section>
    <section class="card stack" style="margin-top:16px"><button type="button" class="btn" id="how-pf">❓ ${esc(t("gd.open"))}</button></section>
    ${state.isAdmin ? `<section class="card stack" style="margin-top:16px"><h2>🛠 ${esc(t("ad.title"))}</h2><p class="muted">${esc(t("ad.entry"))}</p><a class="btn" href="#admin">${esc(t("ad.open"))}</a></section>` : ""}
    <section class="card stack" style="margin-top:16px"><h2>${esc(t("pf.account"))}</h2>
      <p class="muted">${esc(me.guest ? t("pf.guestNote") : me.email || "")}</p>
      <div class="row wrap-row"><button type="button" class="btn" id="signout">${esc(t("pf.signOut"))}</button><button type="button" class="btn danger-ghost" id="delete">${esc(t("pf.delete"))}</button>${state.mode === "demo" ? `<button type="button" class="btn" id="demo-reset">🧪 ${esc(t("pf.demoReset"))}</button>` : ""}</div>
    </section>`
    }`;
    wire();
  }

  function wire() {
    qsa('input[name="av"]', root).forEach((r) => r.addEventListener("change", () => (draft.avatar = r.value)));
    wireChips(qs("#pf-diet-chips", root));
    qs("#pf", root).addEventListener("submit", save);
    qsa("[data-unblock]", root).forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          await api.unblockUser(b.dataset.unblock);
          blocks = blocks.filter((x) => x.user_id !== b.dataset.unblock);
          toast(t("pf.unblocked"));
          draw();
        } catch (e) {
          showError(e);
        }
      })
    );
    qs("#install", root)?.addEventListener("click", async () => {
      const ev = state.installEvent;
      state.installEvent = null;
      await ev.prompt();
      draw();
    });
    qs("#how-pf", root)?.addEventListener("click", async () => (await import("./guide.js")).openGuide());
    qs("#signout", root)?.addEventListener("click", async () => {
      if (me.guest) {
        const ok = await confirmDialog({ title: t("pf.guestOutQ"), body: t("pf.guestOutBody"), confirmLabel: t("pf.signOut"), danger: true });
        if (!ok) return;
      }
      await api.signOut();
    });
    qs("#demo-reset", root)?.addEventListener("click", async () => {
      const ok = await confirmDialog({ title: t("pf.demoResetQ"), body: t("pf.demoResetBody"), confirmLabel: t("pf.demoResetYes"), danger: true });
      if (ok) await api.demoReset();
    });
    qs("#delete", root)?.addEventListener("click", async () => {
      const ok = await confirmDialog({ title: t("pf.deleteQ"), body: t("pf.deleteBody"), confirmLabel: t("pf.deleteYes"), danger: true });
      if (!ok) return;
      try {
        await api.deleteAccount();
        toast(t("pf.deleted"));
      } catch (e) {
        showError(e);
      }
    });
  }

  async function save(e) {
    e.preventDefault();
    const name = qs("#pf-name", root).value.trim();
    const nameErr = qs("#pf-name-err", root);
    nameErr.textContent = "";
    if (!name) {
      nameErr.textContent = t("pf.nameNeeded");
      return qs("#pf-name", root).focus();
    }
    const patch = {
      display_name: name,
      avatar_emoji: draft.avatar,
      dietary_tags: readChips(qs("#pf-diet-chips", root)),
      dietary_notes: qs("#pf-diet", root).value.trim(),
    };
    if (onboarding) patch.onboarded_at = new Date().toISOString();
    try {
      await withBusy(qs('[type="submit"]', root), async () => {
        const saved = await api.saveProfile(patch);
        Object.assign(state.me, saved);
      });
      toast(t("pf.saved"));
      if (onboarding) go("#discover");
      else draw();
    } catch (err) {
      showError(err);
    }
  }

  draw();
}
