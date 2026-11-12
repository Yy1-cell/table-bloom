// Profile & settings: identity, preferences, cuisine ranking, blocked users, install, sign-out, delete account.
import { esc, qs, qsa, isIOS, isStandalone } from "../util.js";
import { t, getLang, setLang } from "../i18n.js";
import { state } from "../state.js";
import { api } from "../api.js";
import { toast, announce, confirmDialog } from "../ui.js";
import { AVATARS, SPOKEN } from "../data.js";
import { nameOf, showError, withBusy, go } from "./common.js";

// Unsaved form values survive a language switch (which re-renders the whole page).
let stash = null;

export async function render(root) {
  const me = state.me;
  const onboarding = !me.onboarded_at;
  const f = stash || {};
  const draft = {
    avatar: f.avatar ?? me.avatar_emoji,
    spoken: new Set(f.spoken ?? me.languages_spoken ?? []),
    ranks: f.ranks ?? [...state.ranks, ...state.cuisines.map((c) => c.slug).filter((s) => !state.ranks.includes(s))],
  };
  let blocks = [];
  try {
    blocks = await api.listBlocks();
  } catch {}

  function rankHTML() {
    return draft.ranks
      .map((slug, i) => {
        const c = state.cuisines.find((x) => x.slug === slug);
        return `<li data-slug="${slug}"><span class="name">${esc(c.emoji)} ${esc(nameOf(c))}</span>
          <button type="button" data-move="-1" aria-label="${esc(t("pf.moveUp", { name: nameOf(c) }))}" ${i === 0 ? "disabled" : ""}>↑</button>
          <button type="button" data-move="1" aria-label="${esc(t("pf.moveDown", { name: nameOf(c) }))}" ${i === draft.ranks.length - 1 ? "disabled" : ""}>↓</button></li>`;
      })
      .join("");
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
        <input id="pf-name" type="text" maxlength="30" required value="${esc(f.name ?? ((me.is_default_name || me.display_name === "New friend") && onboarding ? "" : me.display_name))}" placeholder="${esc(t("pf.namePh"))}">
        <div class="err-text" id="pf-name-err" role="alert"></div></div>
      <fieldset style="margin:0"><legend>${esc(t("pf.avatar"))}</legend><div class="avatar-pick">
        ${AVATARS.map((a) => `<label><input type="radio" name="av" value="${a}" ${draft.avatar === a ? "checked" : ""}><span>${a}</span></label>`).join("")}
      </div></fieldset>
      <div class="field" style="margin:0"><label for="pf-area">${esc(t("pf.area"))}</label>
        <select id="pf-area">${state.areas.map((a) => `<option value="${a.id}" ${(f.area ?? me.area_id) === a.id ? "selected" : ""}>${esc(nameOf(a))}</option>`).join("")}</select></div>
      <div class="field" style="margin:0"><label for="pf-lang">${esc(t("pf.language"))}</label>
        <select id="pf-lang"><option value="en" ${getLang() === "en" ? "selected" : ""}>English</option><option value="zh" ${getLang() === "zh" ? "selected" : ""}>中文</option></select></div>
      <fieldset style="margin:0"><legend>${esc(t("pf.spoken"))}</legend><div class="chips" id="pf-spoken">
        ${SPOKEN.map((l) => `<button type="button" class="chip" data-l="${l}" aria-pressed="${draft.spoken.has(l)}">${esc(t("lang." + l))}</button>`).join("")}
      </div></fieldset>
      <div class="field" style="margin:0"><label for="pf-diet">${esc(t("pf.diet"))}</label>
        <input id="pf-diet" type="text" maxlength="200" value="${esc(f.diet ?? (me.dietary_notes || ""))}" placeholder="${esc(t("pf.dietPh"))}"></div>
      <div class="field" style="margin:0"><label for="pf-budget">${esc(t("pf.budget"))}</label>
        <input id="pf-budget" type="number" inputmode="decimal" min="5" max="500" step="1" value="${f.budget ?? (me.budget_cents != null ? me.budget_cents / 100 : "")}" placeholder="30">
        <div class="err-text" id="pf-budget-err" role="alert"></div></div>
      <fieldset style="margin:0"><legend>${esc(t("pf.rank"))}</legend><p class="hint" style="margin-top:0">${esc(t("pf.rankHint"))}</p><ol class="rank" id="rank">${rankHTML()}</ol></fieldset>
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
    <section class="card stack" style="margin-top:16px"><h2>${esc(t("pf.account"))}</h2>
      <p class="muted">${esc(me.guest ? t("pf.guestNote") : me.email || "")}</p>
      <div class="row wrap-row"><button type="button" class="btn" id="signout">${esc(t("pf.signOut"))}</button><button type="button" class="btn danger-ghost" id="delete">${esc(t("pf.delete"))}</button>${state.mode === "demo" ? `<button type="button" class="btn" id="demo-reset">🧪 ${esc(t("pf.demoReset"))}</button>` : ""}</div>
    </section>`
    }`;
    stash = null;
    wire();
  }

  function wire() {
    qs("#pf-lang", root).addEventListener("change", (e) => {
      // Apply immediately; keep whatever has been typed so far.
      stash = {
        avatar: draft.avatar,
        spoken: [...draft.spoken],
        ranks: [...draft.ranks],
        name: qs("#pf-name", root).value,
        area: qs("#pf-area", root).value,
        diet: qs("#pf-diet", root).value,
        budget: qs("#pf-budget", root).value,
      };
      const lang = e.target.value;
      setLang(lang);
      if (!onboarding) api.saveProfile({ language: lang }).catch(() => {});
    });
    qsa('input[name="av"]', root).forEach((r) => r.addEventListener("change", () => (draft.avatar = r.value)));
    qs("#pf-spoken", root).addEventListener("click", (e) => {
      const b = e.target.closest("[data-l]");
      if (!b) return;
      draft.spoken.has(b.dataset.l) ? draft.spoken.delete(b.dataset.l) : draft.spoken.add(b.dataset.l);
      b.setAttribute("aria-pressed", String(draft.spoken.has(b.dataset.l)));
    });
    qs("#rank", root).addEventListener("click", (e) => {
      const b = e.target.closest("[data-move]");
      if (!b) return;
      const slug = b.closest("li").dataset.slug;
      const i = draft.ranks.indexOf(slug);
      const j = i + Number(b.dataset.move);
      if (j < 0 || j >= draft.ranks.length) return;
      [draft.ranks[i], draft.ranks[j]] = [draft.ranks[j], draft.ranks[i]];
      qs("#rank", root).innerHTML = rankHTML();
      announce(t("pf.moved", { name: nameOf(state.cuisines.find((c) => c.slug === slug)), n: j + 1 }));
      qs(`#rank [data-slug="${slug}"] [data-move="${b.dataset.move}"]`, root)?.focus();
    });
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
    const budgetErr = qs("#pf-budget-err", root);
    nameErr.textContent = budgetErr.textContent = "";
    if (!name) {
      nameErr.textContent = t("pf.nameNeeded");
      return qs("#pf-name", root).focus();
    }
    const bRaw = qs("#pf-budget", root).value;
    let budget = null;
    if (bRaw !== "") {
      const n = Number(bRaw);
      if (!Number.isFinite(n) || n < 5 || n > 500) {
        budgetErr.textContent = t("pf.budgetRange");
        return qs("#pf-budget", root).focus();
      }
      budget = Math.round(n * 100);
    }
    const lang = qs("#pf-lang", root).value;
    const patch = {
      display_name: name,
      avatar_emoji: draft.avatar,
      area_id: qs("#pf-area", root).value,
      language: lang,
      languages_spoken: [...draft.spoken],
      dietary_notes: qs("#pf-diet", root).value.trim(),
      budget_cents: budget,
    };
    if (onboarding) patch.onboarded_at = new Date().toISOString();
    try {
      await withBusy(qs('[type="submit"]', root), async () => {
        const saved = await api.saveProfile(patch);
        await api.savePrefs(draft.ranks);
        Object.assign(state.me, saved);
        state.ranks = [...draft.ranks];
      });
      if (lang !== getLang()) setLang(lang);
      toast(t("pf.saved"));
      if (onboarding) {
        const after = sessionStorage.getItem("tb.after");
        sessionStorage.removeItem("tb.after");
        go(after || "#discover");
      }
      else draw();
    } catch (err) {
      showError(err);
    }
  }

  draw();
}
