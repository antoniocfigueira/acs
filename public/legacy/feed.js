// =========================================================
// Alfa Club Social — Feed logic
// =========================================================
import { db, auth } from "./firebase-config.js";
import {
  collection, query, orderBy, limit, onSnapshot, addDoc,
  doc, getDoc, getDocs, updateDoc, deleteDoc, setDoc,
  serverTimestamp, where, runTransaction, increment, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  requireAuth, logout, updateMyProfile, propagateAuthorUpdate
} from "./auth.js";
import {
  toast, alertPretty, timeAgo, avatarHTML, escapeHTML, initDrawer, tap, animateCount,
  adminBadgeHTML, modBadgeHTML, nameStyleHTML, uploadMedia, promptMediaURL,
  wireHeaderNotifButton, wireDmNotifButton, playBeep,
  modal, maybePromptForNotifs, requestNotifPermissionOnce, showLocalNotification,
  applyTheme, getSavedTheme, saveTheme, setPushNotifsEnabled, getPushNotifsEnabled,
  initLogoEasterEgg, pointBadgesHTML,
  getNotifPref, setNotifPref, getNotifPrefs, loadNotifPrefsFromFirestore
} from "./app.js";
import {
  updatePassword, EmailAuthProvider, reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initArchive, openUserRolesEditor } from "./archive.js";

let CURRENT_USER = null;   // firebase user
let CURRENT_PROFILE = null; // firestore profile
let unsubscribers = [];
window.__alfaPageScope?.addCleanup(() => {
  for (const u of unsubscribers) try { u(); } catch {}
  unsubscribers = [];
});
let pendingMedia = null;  // { file, url?, type } — set by attach button
let pendingPoll = null;   // { kind: "options" | "slider", question, options?: [{ text }], min?, max? }

// service worker — see sw-register.js (aggressive update polling so that
// iOS PWA home-screen launches pick up new deploys without a reinstall).
import "./sw-register.js";

// Bust bfcache: if returning from a back-nav, reload to avoid stale DOM
// duplicates (e.g. composer showing behind stories on iOS Safari).
window.addEventListener("pageshow", (ev) => {
  if (ev.persisted) {
    location.reload();
  }
});

// ─── Bootstrap ─────────────────────────────────────────
requireAuth(async (user, profile) => {
  CURRENT_USER = user;
  CURRENT_PROFILE = profile;
  document.getElementById("myAvatar").innerHTML = avatarHTML(profile, 40);
  document.getElementById("drawerAvatar").innerHTML = `<div class="grad-border" style="border-radius:50%;width:54px;height:54px;">${avatarHTML(profile, 50)}</div>`;
  document.getElementById("drawerName").innerHTML = escapeHTML(profile.name || "—") + adminBadgeHTML(profile);
  document.getElementById("drawerUser").textContent = "@" + (profile.username || "—");
  // Show "Admin Access" and "Mod Access" tag in drawer footer for admins
  const adminTag = document.getElementById("drawerAdminTag");
  if (adminTag) adminTag.style.display = profile.isAdmin ? "inline" : "none";
  // Reveal the God Mode drawer entry ONLY for admins.
  const godModeBtn = document.getElementById("drawerAdminBtn");
  if (godModeBtn) godModeBtn.classList.toggle("hidden", !profile.isAdmin);
  // Reveal the "Notificar todos os users" composer button ONLY for admins,
  // and wire its click to flip aria-pressed (= the armed state read at
  // publish time).
  const broadcastBtn = document.getElementById("adminBroadcastBtn");
  if (broadcastBtn) {
    broadcastBtn.classList.toggle("hidden", !profile.isAdmin);
    if (profile.isAdmin && !broadcastBtn.dataset.wired) {
      broadcastBtn.dataset.wired = "1";
      broadcastBtn.addEventListener("click", () => {
        const armed = broadcastBtn.getAttribute("aria-pressed") === "true";
        broadcastBtn.setAttribute("aria-pressed", armed ? "false" : "true");
      });
    }
  }

    const modTag = document.getElementById("drawerModTag");
  if (modTag) modTag.style.display = profile.isMod ? "inline" : "none";

  wireHeaderNotifButton(user);
  wireDmNotifButton(user);

  const safeCall = (label, fn) => { try { fn(); } catch (e) { console.warn("[boot] " + label + " failed:", e); } };
  safeCall("initDrawer", initDrawer);
  safeCall("initDrawerSubpanels", initDrawerSubpanels);
  safeCall("initComposer", initComposer);
  safeCall("initStoryViewer", initStoryViewer);
  safeCall("initHeaderNotifBtn", initHeaderNotifBtn);
  safeCall("initHeaderSettingsBtn", initHeaderSettingsBtn);
  safeCall("initLogoEasterEgg", () => initLogoEasterEgg("appLogoTitle"));
  safeCall("initSettingsPanel", initSettingsPanel);
  safeCall("initBugsPanel", initBugsPanel);
  safeCall("initArchive", () => initArchive(profile));
  if (profile.isAdmin) safeCall("initAdminPanel", initAdminPanel);

  // Pull-to-refresh
  safeCall("initPullToRefresh", initPullToRefresh);

  safeCall("subscribeFeed", subscribeFeed);
  safeCall("subscribeStories", subscribeStories);
  safeCall("subscribeNotifications", subscribeNotifications);
  safeCall("subscribeDmUnreadDrawer", subscribeDmUnreadDrawer);
  safeCall("loadRanking", () => loadRanking("current"));

  // Ask (once) for browser notification permission
  maybePromptForNotifs();
  // Pull the latest notif preferences from Firestore so cross-device toggles stay in sync
  loadNotifPrefsFromFirestore().catch(() => {});

  // Open notifications drawer if arriving via ?notifs=1
  if (new URLSearchParams(location.search).get("notifs") === "1") {
    openNotifsPanel({ clearQuery: true });
  }

  // Logout
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    for (const u of unsubscribers) try { u(); } catch {}
    await logout();
  });
});

// ─── Header notif button (top-right on index) ────────
function openNotifsPanel({ clearQuery = false } = {}) {
  showPanel("notifsPanel");
  document.getElementById("drawer")?.classList.add("open");
  document.getElementById("drawerBackdrop")?.classList.add("open");
  document.body.classList.add("drawer-open");
  markNotifsRead();

  if (clearQuery) {
    const url = new URL(location.href);
    if (url.searchParams.get("notifs") === "1") {
      url.searchParams.delete("notifs");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }
}

function initHeaderNotifBtn() {
  document.getElementById("headerNotifBtn")?.addEventListener("click", () => {
    openNotifsPanel();
  });
  // "Clear all" button in the notifs panel header — deletes every item under
  // notifications/{uid}/items for the current user.
  document.getElementById("clearNotifsBtn")?.addEventListener("click", async () => {
    if (!CURRENT_USER) return;
    const ok = confirm("Limpar todas as notificações?");
    if (!ok) return;
    const btn = document.getElementById("clearNotifsBtn");
    if (btn) btn.disabled = true;
    try {
      // Delete in batches of 50 until the collection is empty.
      let deleted = 0;
      while (true) {
        const qs = await getDocs(
          query(collection(db, "notifications", CURRENT_USER.uid, "items"), limit(50))
        );
        if (qs.empty) break;
        await Promise.all(qs.docs.map(d => deleteDoc(d.ref)));
        deleted += qs.size;
        if (qs.size < 50) break;
      }
      // Also clear the in-DOM badge straight away — the onSnapshot will catch up too.
      document.getElementById("notifBadge")?.classList.add("hidden");
      toast(deleted ? `${deleted} notificaç${deleted === 1 ? "ão" : "ões"} limpas` : "Nada para limpar", "success");
    } catch (err) {
      toast("Erro a limpar: " + (err?.message || err), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

function buildAdminUserRowMarkup(user, role, timeoutHrs) {
  return `
    <div class="au-main">
      <div class="au-avatar">${avatarHTML(user, 44)}</div>
      <div class="au-body">
        <div class="au-name">${escapeHTML(user.name || "")}</div>
        <div class="au-meta">@${escapeHTML(user.username || "")} - ${user.points || 0} pts${timeoutHrs ? ` - timeout ${timeoutHrs}h` : ""}</div>
      </div>
    </div>
    <div class="au-toolbar">
      <label class="au-role-field">
        <span class="au-label">Role</span>
        <select data-role>
          <option value="user"  ${role === "user"  ? "selected" : ""}>User</option>
          <option value="mod"   ${role === "mod"   ? "selected" : ""}>Mod</option>
          <option value="admin" ${role === "admin" ? "selected" : ""}>Admin</option>
        </select>
      </label>
      <div class="au-actions">
        <button class="admin-user-btn admin-user-btn--edit" data-edit-user title="Editar info">Editar</button>
        <button class="admin-user-btn" data-edit-roles title="Atribuir roles invisíveis"
                style="background:rgba(139,92,246,.12);color:#a5b4fc;border:1px solid rgba(139,92,246,.3);">Roles</button>
        <button class="ban-btn admin-user-btn ${user.banned ? "banned" : ""}" data-ban>${user.banned ? "Desbanir" : "Banir"}</button>
      </div>
    </div>
    <div class="au-control-grid">
      <div class="au-control">
        <div class="au-control-head">
          <span class="au-label">Timeout</span>
          <span data-timeout-label class="au-value">0h</span>
        </div>
        <div class="au-control-row au-control-row--range">
          <input type="range" min="0" max="72" step="1" data-timeout value="0" />
          <button type="button" data-timeout-apply class="btn-ghost tap admin-user-apply">Aplicar</button>
        </div>
      </div>
      <div class="au-control">
        <div class="au-control-head">
          <span class="au-label">Pontos</span>
        </div>
        <div class="au-control-row">
          <input type="number" data-points-delta value="0" class="au-number-input" placeholder="+/-" />
          <button type="button" data-points-apply class="btn-ghost tap admin-user-apply">Aplicar</button>
        </div>
      </div>
    </div>
  `;
}

// ─── Drawer sub-panels ────────────────────────────────
let _panels = null;
function showPanel(id) {
  if (!_panels) return;
  Object.values(_panels).forEach(p => p.classList.remove("active"));
  (_panels[id] || _panels.menu).classList.add("active");
}

function initDrawerSubpanels() {
  _panels = {
    menu: document.getElementById("menuPanel"),
    searchPanel: document.getElementById("searchPanel"),
    rankingPanel: document.getElementById("rankingPanel"),
    notifsPanel: document.getElementById("notifsPanel"),
    shopPanel: document.getElementById("shopPanel"),
    archivePanel: document.getElementById("archivePanel"),
    settingsPanel: document.getElementById("settingsPanel"),
    bugsPanel: document.getElementById("bugsPanel"),
    adminPanel: document.getElementById("adminPanel")
  };
  document.querySelectorAll("[data-subpanel]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.subpanel;
      showPanel(id);
      if (id === "rankingPanel") loadRanking(_rankingMode);
      if (id === "shopPanel") renderShop();
      if (id === "settingsPanel") hydrateSettings();
    });
  });
  document.querySelectorAll(".back-btn").forEach(btn => {
    btn.addEventListener("click", () => showPanel("menu"));
  });

  // Ranking tabs
  document.querySelectorAll("[data-rank-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-rank-tab]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      _rankingMode = btn.dataset.rankTab;
      loadRanking(_rankingMode);
    });
  });

  // Notifs tabs (admin-only — Bugs tab visible only for admins)
  document.querySelectorAll("[data-notif-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-notif-tab]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.notifTab;
      document.getElementById("notifsList").classList.toggle("hidden", tab !== "all");
      document.getElementById("notifsBugsList").classList.toggle("hidden", tab !== "bugs");
      if (tab === "bugs") loadBugReports();
    });
  });

  // Search input
  const searchInput = document.getElementById("searchInput");
  let debounceT;
  searchInput.addEventListener("input", () => {
    clearTimeout(debounceT);
    const q = searchInput.value.trim().toLowerCase().replace(/^@/, "");
    debounceT = setTimeout(() => doSearch(q), 250);
  });

  // Drawer search entry point (if present)
  document.getElementById("openSearchFromDrawer")?.addEventListener("click", (e) => {
    e.preventDefault();
    showPanel("searchPanel");
    setTimeout(() => searchInput.focus(), 150);
  });
}

// ─── Search users ─────────────────────────────────────
async function doSearch(q) {
  const box = document.getElementById("searchResults");
  if (!q) {
    box.innerHTML = `<div class="empty" style="padding:24px;"><div style="font-size:13px;">Começa a escrever um @username ou nome...</div></div>`;
    return;
  }
  box.innerHTML = `<div class="empty" style="padding:24px;">A procurar<span class="dots"></span></div>`;
  try {
    const usersRef = collection(db, "users");
    const qUser = query(usersRef,
      where("username", ">=", q),
      where("username", "<=", q + "\uf8ff"),
      limit(8));
    const qName = query(usersRef,
      where("name", ">=", q.charAt(0).toUpperCase() + q.slice(1)),
      where("name", "<=", q.charAt(0).toUpperCase() + q.slice(1) + "\uf8ff"),
      limit(8));

    const [s1, s2] = await Promise.allSettled([getDocs(qUser), getDocs(qName)]);
    const seen = new Set();
    const items = [];
    [s1, s2].forEach(s => {
      if (s.status === "fulfilled") {
        s.value.forEach(d => {
          if (seen.has(d.id)) return;
          seen.add(d.id);
          items.push(d.data());
        });
      }
    });
    if (!items.length) {
      box.innerHTML = `<div class="empty" style="padding:24px;"><div class="empty-emoji">🔭</div>Nenhum user encontrado.</div>`;
      return;
    }
    box.innerHTML = items.map(u => `
      <a href="./profile.html?u=${encodeURIComponent(u.username)}" class="search-row" data-ripple>
        <div style="width:40px;height:40px;">${avatarHTML(u, 40)}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;">${escapeHTML(u.name || "")}${adminBadgeHTML(u)}</div>
          <div style="font-size:12px;color:var(--muted);">@${escapeHTML(u.username || "")} · #${u.idNumber || "?"}</div>
        </div>
      </a>
    `).join("");
  } catch (err) {
    console.error(err);
    box.innerHTML = `<div class="empty" style="padding:24px;color:#fca5a5;">Erro ao procurar: ${escapeHTML(err.message)}</div>`;
  }
}

// ─── Composer (with media) ───────────────────────────
function initComposer() {
  const ta = document.getElementById("newPostText");
  const charCount = document.getElementById("charCount");
  const publishBtn = document.getElementById("publishBtn");
  const attachBtn = document.getElementById("attachMediaBtn");
  const fileInput = document.getElementById("mediaInput");
  const preview = document.getElementById("mediaPreview");
  const previewInner = document.getElementById("mediaPreviewInner");
  const removeBtn = document.getElementById("removeMediaBtn");
  const progress = document.getElementById("mediaProgress");
  const progressBar = document.getElementById("mediaProgressBar");

  ta.addEventListener("input", () => {
    ta.style.height = "auto";
    ta.style.height = Math.min(180, ta.scrollHeight) + "px";
    charCount.textContent = `${ta.value.length} / 500`;
  });

  // Attach media: open file picker. On long-press, fall back to URL.
  let longPressTimer;
  attachBtn.addEventListener("click", (e) => {
    tap();
    fileInput.click();
  });
  attachBtn.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    const res = await promptMediaURL();
    if (res) setMediaFromURL(res);
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    setMediaFromFile(file);
    fileInput.value = ""; // allow reselecting same file
  });

  removeBtn.addEventListener("click", () => {
    pendingMedia = null;
    preview.classList.add("hidden");
    previewInner.innerHTML = "";
  });

  // Poll button
  const pollBtn = document.getElementById("attachPollBtn");
  const pollPreview = document.getElementById("pollPreview");
  if (pollBtn) {
    pollBtn.addEventListener("click", async () => {
      tap();
      const poll = await openPollBuilder();
      if (poll) {
        pendingPoll = poll;
        renderPollPreview();
      }
    });
  }
  function renderPollPreview() {
    if (!pollPreview) return;
    if (!pendingPoll) {
      pollPreview.classList.add("hidden");
      pollPreview.innerHTML = "";
      return;
    }
    const typeLabel = pendingPoll.kind === "slider" ? "Slider 0–100" : `${pendingPoll.options.length} opções`;
    pollPreview.classList.remove("hidden");
    pollPreview.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#ec4899;flex-shrink:0;"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
      <div class="poll-preview-label">${escapeHTML(pendingPoll.question || "Sondagem")}</div>
      <div class="poll-preview-type">${escapeHTML(typeLabel)}</div>
      <button type="button" class="poll-remove tap" aria-label="Remover sondagem" data-ripple>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    pollPreview.querySelector(".poll-remove")?.addEventListener("click", () => {
      pendingPoll = null;
      renderPollPreview();
    });
  }
  // Expose the reset so publish handler can clear after success
  window.__resetPollPreview = () => { renderPollPreview(); };

  function setMediaFromFile(file) {
    const isVideo = file.type.startsWith("video/");
    pendingMedia = { file, type: isVideo ? "video" : "image", url: null };
    const blobURL = URL.createObjectURL(file);
    previewInner.innerHTML = isVideo
      ? `<video src="${blobURL}" controls muted playsinline></video>`
      : `<img src="${blobURL}" alt="preview" />`;
    preview.classList.remove("hidden");
  }
  function setMediaFromURL({ url, type }) {
    pendingMedia = { file: null, type, url };
    previewInner.innerHTML = type === "video"
      ? `<video src="${escapeHTML(url)}" controls muted playsinline></video>`
      : `<img src="${escapeHTML(url)}" alt="preview" />`;
    preview.classList.remove("hidden");
  }

  publishBtn.addEventListener("click", async () => {
    tap();
    // Banned / timeout gate
    if (CURRENT_PROFILE?.banned) { alertPretty("Estás banido. Não podes publicar.", "error"); return; }
    if (CURRENT_PROFILE?.timeoutUntil && CURRENT_PROFILE.timeoutUntil > Date.now()) {
      const mins = Math.ceil((CURRENT_PROFILE.timeoutUntil - Date.now()) / 60000);
      alertPretty(`Em timeout. Tenta daqui a ${mins}m.`, "error");
      return;
    }
    const text = ta.value.trim();
    if (!text && !pendingMedia) { toast("Escreve algo ou anexa uma foto/vídeo", "error"); return; }
    publishBtn.disabled = true; publishBtn.style.opacity = .7;
    try {
      // 1) upload media if needed
      let mediaURL = pendingMedia?.url || "";
      let mediaType = pendingMedia?.type || "";
      if (pendingMedia?.file) {
        progress.classList.remove("hidden");
        progressBar.style.width = "0%";
        try {
          const up = await uploadMedia(pendingMedia.file, (p) => {
            progressBar.style.width = Math.round(p * 100) + "%";
          });
          mediaURL = up.url;
          mediaType = up.type;
        } catch (err) {
          toast(err.message, "error");
          progress.classList.add("hidden");
          publishBtn.disabled = false; publishBtn.style.opacity = 1;
          return;
        }
        progress.classList.add("hidden");
      }

      // 2) build poll payload (if any)
      let pollPayload = null;
      if (pendingPoll) {
        if (pendingPoll.kind === "options") {
          pollPayload = {
            kind: "options",
            question: pendingPoll.question || "",
            options: pendingPoll.options.map(o => ({ text: o.text, votes: 0 }))
          };
        } else if (pendingPoll.kind === "slider") {
          pollPayload = {
            kind: "slider",
            question: pendingPoll.question || "",
            min: 0,
            max: 100,
            sum: 0,
            count: 0
          };
        }
      }

      // 3) write the post.
      // The admin-only "Notificar todos os users" toggle button drives
      // notifyAll: when armed (aria-pressed=true), a Cloud Function picks
      // the post up and broadcasts a push to every other user (respecting
      // their notifPrefs.news). The flag is server-checked against
      // authorIsAdmin too — see broadcastAdminPost in functions/index.js
      // — so a non-admin client lying about notifyAll can't trigger a
      // broadcast.
      const broadcastBtnEl = document.getElementById("adminBroadcastBtn");
      const wantsBroadcast = !!(
        CURRENT_PROFILE?.isAdmin &&
        broadcastBtnEl?.getAttribute("aria-pressed") === "true"
      );
      await addDoc(collection(db, "posts"), {
        uid: CURRENT_USER.uid,
        authorName: CURRENT_PROFILE.name,
        authorUsername: CURRENT_PROFILE.username,
        authorPhoto: CURRENT_PROFILE.photoURL || "",
        authorIdNumber: CURRENT_PROFILE.idNumber || null,
        authorIsAdmin: !!CURRENT_PROFILE.isAdmin,
        authorIsMod: CURRENT_PROFILE.role === "mod",
        authorRole: CURRENT_PROFILE.role || "user",
        authorNameColor: CURRENT_PROFILE.nameColor || "",
        authorNameStyle: CURRENT_PROFILE.nameStyle || "",
        text,
        mediaURL,
        mediaType,
        likes: 0,
        dislikes: 0,
        commentsCount: 0,
        ...(pollPayload ? { poll: pollPayload } : {}),
        ...(wantsBroadcast ? { notifyAll: true } : {}),
        createdAt: serverTimestamp()
      });

      // 4) reset composer
      ta.value = "";
      ta.style.height = "auto";
      charCount.textContent = "0 / 500";
      pendingMedia = null;
      pendingPoll = null;
      preview.classList.add("hidden");
      previewInner.innerHTML = "";
      if (typeof window.__resetPollPreview === "function") window.__resetPollPreview();
      if (broadcastBtnEl) broadcastBtnEl.setAttribute("aria-pressed", "false");
      toast(wantsBroadcast ? "Post publicado e users notificados" : "Post publicado", "success");
    } catch (err) {
      console.error(err);
      toast("Erro ao publicar: " + err.message, "error");
    } finally {
      publishBtn.disabled = false; publishBtn.style.opacity = 1;
    }
  });

  document.getElementById("fabCreate").addEventListener("click", (e) => {
    e.preventDefault();
    ta.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

// ─── Poll builder modal ─────────────────────────────────
async function openPollBuilder() {
  const body = `
    <div style="display:flex;gap:8px;margin-bottom:14px;">
      <button type="button" class="btn-primary tap" data-poll-kind="options" style="flex:1;padding:10px;font-size:13px;" data-ripple>Opções</button>
      <button type="button" class="btn-ghost tap" data-poll-kind="slider" style="flex:1;padding:10px;font-size:13px;" data-ripple>Slider 0–100</button>
    </div>
    <div class="field" style="margin-bottom:12px;">
      <label style="display:block;font-size:11px;color:var(--muted);text-transform:uppercase;margin-bottom:6px;padding-left:4px;">Pergunta</label>
      <input class="input" id="pb-question" maxlength="120" placeholder="Qual é a tua pergunta?" />
    </div>
    <div id="pb-options-wrap">
      <label style="display:block;font-size:11px;color:var(--muted);text-transform:uppercase;margin-bottom:6px;padding-left:4px;">Opções (2 a 5)</label>
      <div id="pb-options-list" style="display:flex;flex-direction:column;gap:6px;"></div>
      <button type="button" id="pb-add-opt" class="btn-ghost tap" style="margin-top:8px;padding:8px 12px;font-size:12px;" data-ripple>+ Opção</button>
    </div>
    <div id="pb-slider-wrap" style="display:none;">
      <div style="font-size:13px;color:var(--muted);padding:10px;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:10px;">
        Os votantes escolhem um valor de 0 a 100. É mostrada a média + número de votos.
      </div>
    </div>
  `;
  const result = await modal({
    title: "Nova sondagem",
    bodyHTML: body,
    confirmLabel: "Adicionar",
    onOpen: (root) => {
      let currentKind = "options";
      const kindBtns = root.querySelectorAll("[data-poll-kind]");
      const optionsWrap = root.querySelector("#pb-options-wrap");
      const sliderWrap = root.querySelector("#pb-slider-wrap");
      const list = root.querySelector("#pb-options-list");
      const addBtn = root.querySelector("#pb-add-opt");

      const addOptionRow = (value = "") => {
        const rows = list.querySelectorAll(".pb-opt-row");
        if (rows.length >= 5) { toast("Máximo 5 opções", "error"); return; }
        const row = document.createElement("div");
        row.className = "pb-opt-row";
        row.style.cssText = "display:flex;gap:6px;align-items:center;";
        row.innerHTML = `
          <input class="input pb-opt" maxlength="60" placeholder="Opção ${rows.length + 1}" value="${escapeHTML(value)}" style="flex:1;" />
          <button type="button" class="btn-ghost tap pb-del" style="padding:8px 10px;font-size:12px;" data-ripple>✕</button>
        `;
        row.querySelector(".pb-del").addEventListener("click", () => {
          const remaining = list.querySelectorAll(".pb-opt-row");
          if (remaining.length <= 2) { toast("Mínimo 2 opções", "error"); return; }
          row.remove();
        });
        list.appendChild(row);
      };
      addOptionRow();
      addOptionRow();

      addBtn.addEventListener("click", () => addOptionRow());

      kindBtns.forEach(btn => {
        btn.addEventListener("click", () => {
          currentKind = btn.dataset.pollKind;
          kindBtns.forEach(b => {
            b.classList.toggle("btn-primary", b === btn);
            b.classList.toggle("btn-ghost", b !== btn);
          });
          optionsWrap.style.display = currentKind === "options" ? "" : "none";
          sliderWrap.style.display = currentKind === "slider" ? "" : "none";
        });
      });

      root._getKind = () => currentKind;
    },
    onConfirm: (root) => {
      const q = root.querySelector("#pb-question").value.trim().slice(0, 120);
      const kind = root._getKind ? root._getKind() : "options";
      if (!q) { toast("Escreve uma pergunta", "error"); throw new Error("missing_q"); }
      if (kind === "options") {
        const opts = Array.from(root.querySelectorAll(".pb-opt"))
          .map(i => i.value.trim().slice(0, 60))
          .filter(Boolean);
        if (opts.length < 2) { toast("Escreve pelo menos 2 opções", "error"); throw new Error("min_opts"); }
        const seen = new Set();
        for (const o of opts) {
          if (seen.has(o.toLowerCase())) { toast("Opções duplicadas", "error"); throw new Error("dup"); }
          seen.add(o.toLowerCase());
        }
        return { kind: "options", question: q, options: opts.map(text => ({ text })) };
      }
      return { kind: "slider", question: q };
    }
  });
  return result || null;
}

// ─── Poll rendering ─────────────────────────────────────
function pollHTML(p) {
  if (!p.poll || !p.poll.kind) return "";
  const poll = p.poll;
  if (poll.kind === "options") {
    const opts = Array.isArray(poll.options) ? poll.options : [];
    const total = opts.reduce((s, o) => s + (o.votes || 0), 0);
    const question = escapeHTML(poll.question || "");
    const optionRows = opts.map((o, i) => {
      const votes = o.votes || 0;
      const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
      return `
        <div class="poll-option" data-poll-opt="${i}">
          <div class="poll-option-fill" style="width:${pct}%;"></div>
          <span class="poll-option-text">${escapeHTML(o.text || "")}</span>
          <span class="poll-option-pct">${pct}%</span>
        </div>`;
    }).join("");
    return `
      <div class="poll" data-poll-kind="options">
        ${question ? `<div class="poll-question">${question}</div>` : ""}
        ${optionRows}
        <div class="poll-meta">${total} ${total === 1 ? "voto" : "votos"}</div>
      </div>`;
  }
  if (poll.kind === "slider") {
    const count = poll.count || 0;
    const avg = count > 0 ? Math.round((poll.sum || 0) / count) : 0;
    const question = escapeHTML(poll.question || "");
    return `
      <div class="poll" data-poll-kind="slider">
        ${question ? `<div class="poll-question">${question}</div>` : ""}
        <div class="poll-slider-row">
          <input type="range" class="poll-slider-input" min="0" max="100" value="50" data-poll-slider />
          <div class="poll-slider-value" data-poll-slider-value>50</div>
        </div>
        <button type="button" class="btn-primary tap poll-slider-vote" data-poll-vote data-ripple>Votar</button>
        <div class="poll-slider-result" data-poll-slider-result>
          <div class="cell"><div class="val" data-slider-avg>${avg}</div><div class="label">Média</div></div>
          <div class="cell"><div class="val" data-slider-count>${count}</div><div class="label">Votos</div></div>
          <div class="cell"><div class="val" data-slider-mine>—</div><div class="label">Teu voto</div></div>
        </div>
      </div>`;
  }
  return "";
}

// ─── Feed (posts) ─────────────────────────────────────
let _subscribedFeed = false;
let _blockedUids = new Set();
let _followingUids = new Set();
let _pinnedPostsCache = [];
let _feedFilter = "global"; // "global" | "following"
let _latestPosts = [];      // cache of last snapshot (pre-filter)
let _feedFirstLoad = true;
let _seenPostIds = new Set();

function getSavedFeedFilter() {
  try {
    const v = localStorage.getItem("alfaFeedFilter");
    return v === "following" ? "following" : "global";
  } catch { return "global"; }
}

function setSavedFeedFilter(v) {
  try { localStorage.setItem("alfaFeedFilter", v); } catch {}
}

function renderFeedFromCache() {
  const feed = document.getElementById("feed");
  if (!feed) return;
  const now = Date.now();

  // Apply filter
  let visible = _latestPosts.slice();
  if (_feedFilter === "following") {
    const selfUid = CURRENT_USER?.uid;
    visible = visible.filter(p => _followingUids.has(p.uid) || p.uid === selfUid);
  }

  if (!visible.length) {
    feed.innerHTML = _feedFilter === "following"
      ? `<div class="empty">
           <div style="font-size:16px;font-weight:600;margin-bottom:4px;">Ainda não segues ninguém.</div>
           <div>Deves achar que és o maior.</div>
         </div>`
      : `<div class="empty">
           <div style="font-size:16px;font-weight:600;margin-bottom:4px;">Ainda nada por aqui.</div>
           <div>Sê o primeiro a publicar algo!</div>
         </div>`;
    return;
  }

  // Sort: pinned (unexpired) first
  visible.sort((a, b) => {
    const aPin = a.pinnedUntil && a.pinnedUntil > now;
    const bPin = b.pinnedUntil && b.pinnedUntil > now;
    if (aPin && !bPin) return -1;
    if (bPin && !aPin) return 1;
    return 0;
  });

  // Preserve deleting animation nodes
  const deleting = new Map();
  feed.querySelectorAll("article.post.deleting").forEach(el => deleting.set(el.dataset.id, el));
  const existing = new Map();
  feed.querySelectorAll("article.post").forEach(el => existing.set(el.dataset.id, el));

  const desiredNodes = [];
  visible.forEach(p => {
    if (deleting.has(p.id)) { desiredNodes.push(deleting.get(p.id)); return; }
    let el = existing.get(p.id);
    if (!el) {
      const temp = document.createElement("div");
      temp.innerHTML = renderPost(p).trim();
      el = temp.firstElementChild;
      if (!_feedFirstLoad && !_seenPostIds.has(p.id)) {
        el.classList.add("just-posted");
        setTimeout(() => el.classList.remove("just-posted"), 700);
      }
    } else {
      const likeEl = el.querySelector(".count-likes");
      const dislikeEl = el.querySelector(".count-dislikes");
      const commentEl = el.querySelector(".count-comments");
      if (likeEl) likeEl.textContent = p.likes || 0;
      if (dislikeEl) dislikeEl.textContent = p.dislikes || 0;
      if (commentEl) commentEl.textContent = p.commentsCount || 0;
    }
    desiredNodes.push(el);
  });
  const currentNodes = Array.from(feed.childNodes);
  const sameTree =
    currentNodes.length === desiredNodes.length &&
    currentNodes.every((node, idx) => node === desiredNodes[idx]);
  if (!sameTree) {
    const frag = document.createDocumentFragment();
    desiredNodes.forEach(node => frag.appendChild(node));
    feed.replaceChildren(frag);
  }
  bindPostActions(feed);
  visible.forEach(p => _seenPostIds.add(p.id));
  _feedFirstLoad = false;
}

function wireFeedFilter() {
  const bar = document.getElementById("feedFilter");
  if (!bar || bar._wired) return;
  bar._wired = true;
  _feedFilter = getSavedFeedFilter();
  bar.querySelectorAll(".feed-filter-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === _feedFilter);
    btn.addEventListener("click", () => {
      const f = btn.dataset.filter;
      if (f === _feedFilter) return;
      _feedFilter = f;
      setSavedFeedFilter(f);
      bar.querySelectorAll(".feed-filter-btn").forEach(b => b.classList.toggle("active", b === btn));
      renderFeedFromCache();
    });
  });
}

function subscribeFeed() {
  if (_subscribedFeed) return; // guard against double-subscription
  _subscribedFeed = true;
  const feed = document.getElementById("feed");

  // load blocked + following uids once per subscription
  try {
    const blocked = CURRENT_PROFILE?.blocked || [];
    _blockedUids = new Set(blocked);
  } catch { _blockedUids = new Set(); }
  try {
    const following = CURRENT_PROFILE?.following || [];
    _followingUids = new Set(following);
  } catch { _followingUids = new Set(); }

  // Restore persisted filter and wire UI
  _feedFilter = getSavedFeedFilter();
  wireFeedFilter();

  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(80));
  const unsub = onSnapshot(q, (snap) => {
    const posts = [];
    snap.forEach(d => {
      const p = d.data();
      p.id = d.id;
      if (_blockedUids.has(p.uid)) return;
      posts.push(p);
    });
    _latestPosts = posts;
    renderFeedFromCache();
  }, (err) => {
    console.error("Feed error", err);
    feed.innerHTML = `<div class="empty" style="color:#fca5a5;">Erro ao carregar o feed.<br><span style="font-size:12px;">${escapeHTML(err.message)}</span></div>`;
  });
  unsubscribers.push(unsub);
}

function renderPost(p) {
  const authorPhoto = p.authorPhoto
    ? `<img src="${escapeHTML(p.authorPhoto)}" loading="lazy" />`
    : `<div class="avatar-fallback" style="width:38px;height:38px;font-size:13px;">${escapeHTML((p.authorName || "?").slice(0,1).toUpperCase())}</div>`;
  const authorColor = p.uid === CURRENT_USER.uid ? (CURRENT_PROFILE?.nameColor || "") : (p.authorNameColor || "");
  const authorStyle = p.uid === CURRENT_USER.uid ? (CURRENT_PROFILE?.nameStyle || "") : (p.authorNameStyle || "");
  const when = timeAgo(p.createdAt);
  const mediaHTML = p.mediaType === "video"
    ? `<div class="post-video"><video src="${escapeHTML(p.mediaURL || "")}" controls preload="metadata" playsinline></video></div>`
    : (p.mediaType === "image" && p.mediaURL)
      ? `<div class="post-image"><img src="${escapeHTML(p.mediaURL)}" loading="lazy" alt="" /></div>`
      : "";
  const isPinned = p.pinnedUntil && p.pinnedUntil > Date.now();
  return `
    <article class="post${isPinned ? " pinned" : ""}" data-id="${p.id}" data-uid="${p.uid}">
      <div class="post-head">
        <a class="post-avatar" href="./profile.html?u=${encodeURIComponent(p.authorUsername || '')}">${authorPhoto}</a>
        <div style="flex:1;min-width:0;">
          <a class="post-user" href="./profile.html?u=${encodeURIComponent(p.authorUsername || '')}">${nameStyleHTML({ name: p.authorName, nameColor: authorColor, nameStyle: authorStyle })}${adminBadgeHTML({ isAdmin: p.authorIsAdmin })}${modBadgeHTML({ isMod: p.authorIsMod, role: p.authorRole })}</a>
          <div class="post-meta">@${escapeHTML(p.authorUsername || "")} · ${when}${p.editedAt ? ' · <span style="font-style:italic;opacity:.75;">editado</span>' : ''}</div>
        </div>
        ${(() => {
          const isOwner = p.uid === CURRENT_USER.uid;
          const isAdminOrMod = !!CURRENT_PROFILE?.isAdmin || CURRENT_PROFILE?.role === "mod";
          const canDelete = isOwner || isAdminOrMod;
          const isPinned = p.pinnedUntil && p.pinnedUntil > Date.now();
          let btns = "";
          if (CURRENT_PROFILE?.isAdmin) {
            btns += `<button class="btn-icon tap post-admin-btn" data-action="admin-menu" aria-label="Admin" data-ripple title="Ações admin"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg></button>`;
          }
          if (canDelete) {
            btns += `<button class="btn-icon tap" data-action="delete" aria-label="Apagar" data-ripple><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`;
          }
          return btns;
        })()}
      </div>
      ${p.text ? `<div class="post-body">${escapeHTML(p.text || "")}</div>` : ""}
      ${mediaHTML}
      ${pollHTML(p)}
      <div class="post-actions">
        <button class="action-btn tap" data-action="like" data-ripple>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/></svg>
          <span class="count-likes">${p.likes || 0}</span>
        </button>
        <button class="action-btn tap" data-action="dislike" data-ripple>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3l4 8v-5h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-3z" transform="rotate(180 12 12)"/></svg>
          <span class="count-dislikes">${p.dislikes || 0}</span>
        </button>
        <button class="action-btn tap" data-action="comment-toggle" data-ripple>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5A8.38 8.38 0 0 1 12.5 20a8.5 8.5 0 0 1-7.5-4.2L3 21l2.2-5.5A8.5 8.5 0 0 1 12.5 3a8.38 8.38 0 0 1 8.5 8.5z"/></svg>
          <span class="count-comments">${p.commentsCount || 0}</span>
        </button>
      </div>
      <div class="comments hidden" data-comments></div>
    </article>
  `;
}

function bindPostActions(root) {
  root.querySelectorAll("article.post").forEach(post => {
    if (post._bound) return;
    post._bound = true;
    const id = post.dataset.id;

    post.querySelector('[data-action="like"]')?.addEventListener("click", () => handleVote(id, post, "like"));
    post.querySelector('[data-action="dislike"]')?.addEventListener("click", () => handleVote(id, post, "dislike"));
    post.querySelector('[data-action="comment-toggle"]')?.addEventListener("click", () => openComments(id, post));
    post.querySelector('[data-action="delete"]')?.addEventListener("click", () => deletePost(id, post));
    post.querySelector('[data-action="admin-menu"]')?.addEventListener("click", () => openPostAdminMenu(id, post));

    // Reflect current like/dislike state
    refreshMyVote(id, post);

    // Poll voting
    const pollEl = post.querySelector(".poll");
    if (pollEl && !pollEl._bound) {
      pollEl._bound = true;
      const kind = pollEl.dataset.pollKind;
      if (kind === "options") {
        pollEl.querySelectorAll("[data-poll-opt]").forEach(opt => {
          opt.addEventListener("click", () => handlePollOptionVote(id, post, parseInt(opt.dataset.pollOpt, 10)));
        });
      } else if (kind === "slider") {
        const input = pollEl.querySelector("[data-poll-slider]");
        const valEl = pollEl.querySelector("[data-poll-slider-value]");
        input?.addEventListener("input", () => { if (valEl) valEl.textContent = input.value; });
        pollEl.querySelector("[data-poll-vote]")?.addEventListener("click", () => {
          const v = parseInt(input?.value || "50", 10);
          handlePollSliderVote(id, post, v);
        });
      }
      refreshMyPollVote(id, post);
    }
  });
}

async function refreshMyPollVote(postId, postEl) {
  try {
    const pollEl = postEl.querySelector(".poll");
    if (!pollEl) return;
    const ref = doc(db, "posts", postId, "pollVotes", CURRENT_USER.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const d = snap.data();
    if (pollEl.dataset.pollKind === "options" && typeof d.choice === "number") {
      const opt = pollEl.querySelector(`[data-poll-opt="${d.choice}"]`);
      opt?.classList.add("voted");
    } else if (pollEl.dataset.pollKind === "slider" && typeof d.value === "number") {
      const mine = pollEl.querySelector("[data-slider-mine]");
      if (mine) mine.textContent = d.value;
      // Disable button since already voted (can revote)
    }
  } catch {}
}

async function handlePollOptionVote(postId, postEl, idx) {
  tap();
  try {
    const voteRef = doc(db, "posts", postId, "pollVotes", CURRENT_USER.uid);
    const postRef = doc(db, "posts", postId);
    await runTransaction(db, async (tx) => {
      const [vSnap, pSnap] = await Promise.all([tx.get(voteRef), tx.get(postRef)]);
      if (!pSnap.exists()) throw new Error("Post já não existe");
      const poll = pSnap.data().poll;
      if (!poll || poll.kind !== "options" || !Array.isArray(poll.options)) throw new Error("Poll inválida");
      if (idx < 0 || idx >= poll.options.length) throw new Error("Opção inválida");

      const options = poll.options.map(o => ({ text: o.text, votes: o.votes || 0 }));
      const prev = vSnap.exists() ? vSnap.data().choice : null;
      if (prev === idx) {
        // Unvote
        options[idx].votes = Math.max(0, (options[idx].votes || 0) - 1);
        tx.delete(voteRef);
      } else {
        if (typeof prev === "number" && prev >= 0 && prev < options.length) {
          options[prev].votes = Math.max(0, (options[prev].votes || 0) - 1);
        }
        options[idx].votes = (options[idx].votes || 0) + 1;
        tx.set(voteRef, { choice: idx, at: serverTimestamp() });
      }
      tx.update(postRef, { "poll.options": options });
    });
    // Re-render the poll portion from a fresh read
    const fresh = await getDoc(postRef);
    if (fresh.exists()) refreshPollUI(postEl, { id: postId, ...fresh.data() });
  } catch (err) {
    console.error(err);
    toast("Erro: " + err.message, "error");
  }
}

async function handlePollSliderVote(postId, postEl, value) {
  tap();
  const v = Math.max(0, Math.min(100, parseInt(value, 10) || 0));
  try {
    const voteRef = doc(db, "posts", postId, "pollVotes", CURRENT_USER.uid);
    const postRef = doc(db, "posts", postId);
    await runTransaction(db, async (tx) => {
      const [vSnap, pSnap] = await Promise.all([tx.get(voteRef), tx.get(postRef)]);
      if (!pSnap.exists()) throw new Error("Post já não existe");
      const poll = pSnap.data().poll;
      if (!poll || poll.kind !== "slider") throw new Error("Poll inválida");

      const prev = vSnap.exists() ? vSnap.data().value : null;
      const sum = poll.sum || 0;
      const count = poll.count || 0;
      let newSum = sum + v;
      let newCount = count + 1;
      if (typeof prev === "number") {
        newSum -= prev;
        newCount -= 1;
      }
      tx.set(voteRef, { value: v, at: serverTimestamp() });
      tx.update(postRef, { "poll.sum": newSum, "poll.count": newCount });
    });
    const fresh = await getDoc(postRef);
    if (fresh.exists()) refreshPollUI(postEl, { id: postId, ...fresh.data() });
    toast("Voto registado", "success");
  } catch (err) {
    console.error(err);
    toast("Erro: " + err.message, "error");
  }
}

// Re-render the poll block in place (keeps animations clean)
function refreshPollUI(postEl, p) {
  const pollEl = postEl.querySelector(".poll");
  if (!pollEl || !p.poll) return;
  if (p.poll.kind === "options") {
    const total = (p.poll.options || []).reduce((s, o) => s + (o.votes || 0), 0);
    (p.poll.options || []).forEach((o, i) => {
      const opt = pollEl.querySelector(`[data-poll-opt="${i}"]`);
      if (!opt) return;
      const votes = o.votes || 0;
      const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
      const fill = opt.querySelector(".poll-option-fill");
      const pctEl = opt.querySelector(".poll-option-pct");
      if (fill) fill.style.width = pct + "%";
      if (pctEl) pctEl.textContent = pct + "%";
    });
    const meta = pollEl.querySelector(".poll-meta");
    if (meta) meta.textContent = `${total} ${total === 1 ? "voto" : "votos"}`;
    // Refresh voted class
    pollEl.querySelectorAll("[data-poll-opt]").forEach(o => o.classList.remove("voted"));
    refreshMyPollVote(p.id, postEl);
  } else if (p.poll.kind === "slider") {
    const avg = (p.poll.count || 0) > 0 ? Math.round((p.poll.sum || 0) / p.poll.count) : 0;
    const avgEl = pollEl.querySelector("[data-slider-avg]");
    const countEl = pollEl.querySelector("[data-slider-count]");
    if (avgEl) avgEl.textContent = avg;
    if (countEl) countEl.textContent = p.poll.count || 0;
    refreshMyPollVote(p.id, postEl);
  }
}

async function refreshMyVote(postId, postEl) {
  try {
    const likeBtn = postEl.querySelector('[data-action="like"]');
    const dislikeBtn = postEl.querySelector('[data-action="dislike"]');
    likeBtn?.classList.remove("liked");
    dislikeBtn?.classList.remove("disliked");
    const ref = doc(db, "posts", postId, "votes", CURRENT_USER.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const t = snap.data().type;
      likeBtn?.classList.toggle("liked", t === "like");
      dislikeBtn?.classList.toggle("disliked", t === "dislike");
    }
  } catch {}
}

async function handleVote(postId, postEl, type) {
  tap();
  const btn = postEl.querySelector(`[data-action="${type}"]`);
  const svg = btn.querySelector("svg");
  svg.classList.remove("heart-pop");
  void svg.offsetWidth;
  svg.classList.add("heart-pop");

  try {
    const voteRef = doc(db, "posts", postId, "votes", CURRENT_USER.uid);
    const postRef = doc(db, "posts", postId);
    const postAuthorUid = postEl.dataset.uid;

    await runTransaction(db, async (tx) => {
      const [vSnap, pSnap] = await Promise.all([tx.get(voteRef), tx.get(postRef)]);
      if (!pSnap.exists()) throw new Error("Post já não existe");
      const current = vSnap.exists() ? vSnap.data().type : null;

      let dLikes = 0, dDislikes = 0;
      if (current === type) {
        tx.delete(voteRef);
        if (type === "like") dLikes = -1; else dDislikes = -1;
      } else {
        if (current === "like") dLikes = -1;
        if (current === "dislike") dDislikes = -1;
        if (type === "like") dLikes += 1;
        if (type === "dislike") dDislikes += 1;
        tx.set(voteRef, { type, at: serverTimestamp() });
      }
      tx.update(postRef, {
        likes: increment(dLikes),
        dislikes: increment(dDislikes)
      });
      if (postAuthorUid && postAuthorUid !== CURRENT_USER.uid && dLikes !== 0) {
        const authorRef = doc(db, "users", postAuthorUid);
        tx.update(authorRef, { points: increment(dLikes) });
      }
    });

    if (type === "like" && postEl.dataset.uid !== CURRENT_USER.uid) {
      const voteSnap = await getDoc(doc(db, "posts", postId, "votes", CURRENT_USER.uid));
      if (voteSnap.exists() && voteSnap.data().type === "like") {
        await createNotif(postEl.dataset.uid, {
          type: "like",
          fromUid: CURRENT_USER.uid,
          fromName: CURRENT_PROFILE.name,
          fromUsername: CURRENT_PROFILE.username,
          fromPhoto: CURRENT_PROFILE.photoURL || "",
          postId,
          text: "gostou do teu post"
        });
      }
    }

    refreshMyVote(postId, postEl);
  } catch (err) {
    console.error(err);
    toast("Erro: " + err.message, "error");
  }
}

async function openPostAdminMenu(postId, postEl) {
  if (!CURRENT_PROFILE?.isAdmin) return;
  tap();
  // Fetch current pin state
  let pinnedUntil = 0;
  try {
    const snap = await getDoc(doc(db, "posts", postId));
    pinnedUntil = snap.data()?.pinnedUntil || 0;
  } catch {}
  const isPinned = pinnedUntil && pinnedUntil > Date.now();
  const authorUid = postEl.dataset.uid;
  modal({
    title: "ADMIN SETTINGS",
    bodyHTML: `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button type="button" class="btn-primary" data-act="pin">${isPinned ? "Desafixar" : "Afixar Post"}</button>
        <button type="button" class="btn-ghost" data-act="edit-text">Editar texto do post</button>
        <button type="button" class="btn-ghost" data-act="adj-pts">Ajustar pontos do autor</button>
        <button type="button" class="btn-ghost" data-act="timeout">Timeout ao autor</button>
      </div>
    `,
    confirmLabel: "Fechar",
    onOpen: (root, wrap) => {
      root.querySelector('[data-act="pin"]').addEventListener("click", async () => {
        try {
          if (isPinned) {
            await updateDoc(doc(db, "posts", postId), { pinnedUntil: null });
            toast("Post desafixado", "success");
          } else {
            await updateDoc(doc(db, "posts", postId), { pinnedUntil: Date.now() + 24 * 3600000 });
            toast("Post afixado 24h!", "success");
          }
          wrap.remove();
        } catch (err) { toast("Erro: " + err.message, "error"); }
      });
      root.querySelector('[data-act="edit-text"]').addEventListener("click", async () => {
        try {
          const snap = await getDoc(doc(db, "posts", postId));
          const currentText = snap.data()?.text || "";
          const next = prompt("Editar texto do post:", currentText);
          if (next === null) return;
          const trimmed = next.trim();
          if (trimmed === currentText.trim()) return;
          await updateDoc(doc(db, "posts", postId), {
            text: trimmed,
            editedAt: serverTimestamp(),
            editedBy: CURRENT_USER.uid
          });
          toast("Post editado", "success");
          wrap.remove();
        } catch (err) { toast("Erro: " + err.message, "error"); }
      });
      root.querySelector('[data-act="adj-pts"]').addEventListener("click", async () => {
        const s = prompt("Ajustar pontos (ex: +10 ou -5):");
        if (!s) return;
        const n = parseInt(s.replace(/\s/g, ""), 10);
        if (!n) return;
        try {
          await updateDoc(doc(db, "users", authorUid), {
            points: increment(n),
            ...(n > 0 ? { totalPointsEarned: increment(n) } : {})
          });
          toast((n > 0 ? "+" : "") + n + " pts", "success");
          wrap.remove();
        } catch (err) { toast("Erro: " + err.message, "error"); }
      });
      root.querySelector('[data-act="timeout"]').addEventListener("click", async () => {
        const s = prompt("Timeout em horas (0 para remover):", "24");
        if (s === null) return;
        const hrs = parseInt(s, 10);
        try {
          await updateDoc(doc(db, "users", authorUid), {
            timeoutUntil: hrs > 0 ? Date.now() + hrs * 3600000 : null
          });
          toast(hrs > 0 ? `Timeout ${hrs}h aplicado` : "Timeout removido", "success");
          wrap.remove();
        } catch (err) { toast("Erro: " + err.message, "error"); }
      });
    }
  });
}

async function deletePost(postId, postEl) {
  if (!confirm("Apagar este post?")) return;
  try {
    // Animate out first, then delete — and remove the DOM node once the
    // animation ends so the snapshot listener doesn't see any orphan element.
    postEl.classList.add("deleting");
    const cleanup = () => { postEl.remove(); };
    postEl.addEventListener("animationend", cleanup, { once: true });
    setTimeout(cleanup, 520); // fallback safety
    await deleteDoc(doc(db, "posts", postId));
    toast("Post apagado", "success");
  } catch (err) {
    postEl.classList.remove("deleting");
    toast("Erro: " + err.message, "error");
  }
}

// ─── Comments ─────────────────────────────────────────
const openCommentUnsubs = new Map();

function openComments(postId, postEl) {
  const box = postEl.querySelector("[data-comments]");
  if (!box.classList.contains("hidden")) {
    box.classList.add("hidden");
    const u = openCommentUnsubs.get(postId);
    if (u) { u(); openCommentUnsubs.delete(postId); }
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = `
    <div id="cl-${postId}"></div>
    <form class="comment-form" style="display:flex;gap:8px;margin-top:10px;">
      <input class="input" placeholder="Adiciona um comentário..." style="flex:1;padding:10px 14px;font-size:13px;" />
      <button class="btn-primary" style="padding:10px 16px;font-size:13px;" data-ripple>Enviar</button>
    </form>
  `;
  const list = box.querySelector("#cl-" + postId);
  const form = box.querySelector(".comment-form");
  const input = form.querySelector("input");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = input.value.trim();
    if (!t) return;
    input.value = "";
    try {
      await addDoc(collection(db, "posts", postId, "comments"), {
        uid: CURRENT_USER.uid,
        authorName: CURRENT_PROFILE.name,
        authorUsername: CURRENT_PROFILE.username,
        authorPhoto: CURRENT_PROFILE.photoURL || "",
        authorIsAdmin: !!CURRENT_PROFILE.isAdmin,
        authorIsMod: CURRENT_PROFILE.role === "mod",
        authorRole: CURRENT_PROFILE.role || "user",
        authorNameColor: CURRENT_PROFILE.nameColor || "",
        authorNameStyle: CURRENT_PROFILE.nameStyle || "",
        text: t,
        at: serverTimestamp()
      });
      await updateDoc(doc(db, "posts", postId), { commentsCount: increment(1) });
      if (postEl.dataset.uid !== CURRENT_USER.uid) {
        await createNotif(postEl.dataset.uid, {
          type: "comment",
          fromUid: CURRENT_USER.uid,
          fromName: CURRENT_PROFILE.name,
          fromUsername: CURRENT_PROFILE.username,
          fromPhoto: CURRENT_PROFILE.photoURL || "",
          postId,
          text: `comentou: "${t.slice(0, 60)}${t.length > 60 ? "…" : ""}"`
        });
      }
    } catch (err) {
      toast("Erro: " + err.message, "error");
    }
  });

  const cq = query(collection(db, "posts", postId, "comments"), orderBy("at", "asc"), limit(50));
  const unsub = onSnapshot(cq, (snap) => {
    if (snap.empty) {
      list.innerHTML = `<div style="font-size:12px;color:var(--muted);padding:6px 2px;">Sem comentários ainda.</div>`;
      return;
    }
    list.innerHTML = Array.from(snap.docs).map(d => {
      const c = d.data();
      const commentColor = c.uid === CURRENT_USER.uid ? (CURRENT_PROFILE?.nameColor || "") : (c.authorNameColor || "");
      const commentStyle = c.uid === CURRENT_USER.uid ? (CURRENT_PROFILE?.nameStyle || "") : (c.authorNameStyle || "");
      return `
        <div class="comment">
          <div class="comment-avatar">${avatarHTML({ photoURL: c.authorPhoto, name: c.authorName, username: c.authorUsername }, 28)}</div>
          <div class="comment-body">
            <div class="comment-user">${nameStyleHTML({ name: c.authorName, nameColor: commentColor, nameStyle: commentStyle })}${adminBadgeHTML({ isAdmin: c.authorIsAdmin })}${modBadgeHTML({ isMod: c.authorIsMod, role: c.authorRole })} <span style="color:var(--muted-2);font-weight:400;">@${escapeHTML(c.authorUsername || "")} · ${timeAgo(c.at)}</span></div>
            ${escapeHTML(c.text)}
          </div>
        </div>
      `;
    }).join("");
  });
  openCommentUnsubs.set(postId, unsub);
}

// ─── Stories ──────────────────────────────────────────
function subscribeStories() {
  const row = document.getElementById("storiesRow");
  const q = query(collection(db, "stories"), orderBy("createdAt", "desc"), limit(50));
  const unsub = onSnapshot(q, (snap) => {
    const now = Date.now();
    const byUser = new Map();
    snap.forEach(d => {
      const s = d.data();
      s.id = d.id;
      const exp = s.expiresAt?.toMillis ? s.expiresAt.toMillis() : 0;
      if (exp && exp < now) return;
      const arr = byUser.get(s.uid) || [];
      arr.push(s);
      byUser.set(s.uid, arr);
    });

    const items = [];
    items.push(`
      <div class="story-item" id="addStoryTile" role="button">
        <div class="story-avatar add">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </div>
        <div class="story-name">A tua story</div>
      </div>
    `);
    byUser.forEach((arr, uid) => {
      const first = arr[0];
      items.push(`
        <div class="story-item" data-uid="${uid}">
          <div class="story-avatar">
            ${first.authorPhoto
              ? `<img src="${escapeHTML(first.authorPhoto)}" loading="lazy" />`
              : `<div class="avatar-fallback" style="width:100%;height:100%;">${escapeHTML((first.authorName || "?").slice(0,1).toUpperCase())}</div>`
            }
          </div>
          <div class="story-name">${escapeHTML(first.authorUsername || "")}</div>
        </div>
      `);
    });
    row.innerHTML = items.join("");
    row.querySelector("#addStoryTile")?.addEventListener("click", openStoryComposer);
    row.querySelectorAll(".story-item[data-uid]").forEach(tile => {
      tile.addEventListener("click", () => {
        const arr = byUser.get(tile.dataset.uid);
        if (arr && arr.length) openStoryViewer(arr);
      });
    });
  });
  unsubscribers.push(unsub);
}

// ─── Story composer ────────────────────────────────────
async function openStoryComposer() {
  tap();
  let pickedMedia = null; // { url, type }

  const bodyHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <textarea id="storyText" maxlength="240" rows="3" placeholder="Diz alguma coisa..." class="input" style="font-size:14px;padding:10px 14px;resize:vertical;"></textarea>
      <div id="storyMediaPreview" class="hidden" style="position:relative;border-radius:14px;overflow:hidden;border:1px solid var(--border);background:#0f0f0f;max-height:280px;"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <input id="storyMediaInput" type="file" accept="image/*,video/*" class="hidden" />
        <button type="button" class="btn-ghost" data-act="pickStoryFile" style="flex:1;font-size:13px;padding:9px 12px;">
          <span style="display:inline-flex;align-items:center;gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            Foto / vídeo
          </span>
        </button>
        <button type="button" class="btn-ghost" data-act="pickStoryUrl" style="flex:1;font-size:13px;padding:9px 12px;">
          <span style="display:inline-flex;align-items:center;gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            URL
          </span>
        </button>
      </div>
      <div id="storyUploadProgress" class="hidden" style="height:4px;background:#1a1a1a;border-radius:2px;overflow:hidden;">
        <div id="storyUploadBar" style="height:100%;width:0%;background:var(--grad);transition:width .2s;"></div>
      </div>
      <div style="font-size:11px;color:var(--muted-2);">Desaparece em 24h. Podes pôr só texto, só foto/vídeo, ou ambos.</div>
    </div>
  `;

  // Hook up picker handlers once the modal's body is in the DOM.
  requestAnimationFrame(() => {
    const fileInput = document.getElementById("storyMediaInput");
    const preview = document.getElementById("storyMediaPreview");
    const progress = document.getElementById("storyUploadProgress");
    const bar = document.getElementById("storyUploadBar");

    document.querySelector('[data-act="pickStoryFile"]')?.addEventListener("click", () => fileInput?.click());
    document.querySelector('[data-act="pickStoryUrl"]')?.addEventListener("click", async () => {
      const res = await promptMediaURL();
      if (!res) return;
      pickedMedia = res;
      renderPreview();
    });

    fileInput?.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        progress?.classList.remove("hidden");
        if (bar) bar.style.width = "0%";
        const up = await uploadMedia(f, (p) => {
          if (bar) bar.style.width = Math.round(p * 100) + "%";
        });
        pickedMedia = { url: up.url, type: up.type };
        renderPreview();
        toast("Ficheiro carregado", "success");
      } catch (err) {
        toast(err.message, "error");
      } finally {
        progress?.classList.add("hidden");
      }
    });

    function renderPreview() {
      if (!preview) return;
      if (!pickedMedia?.url) {
        preview.classList.add("hidden");
        preview.innerHTML = "";
        return;
      }
      preview.classList.remove("hidden");
      const mediaTag = pickedMedia.type === "video"
        ? `<video src="${escapeHTML(pickedMedia.url)}" controls style="display:block;width:100%;max-height:280px;object-fit:cover;"></video>`
        : `<img src="${escapeHTML(pickedMedia.url)}" alt="" style="display:block;width:100%;max-height:280px;object-fit:cover;" />`;
      preview.innerHTML = `${mediaTag}
        <button type="button" id="storyMediaRemove" class="btn-icon" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.65);" aria-label="Remover">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>`;
      document.getElementById("storyMediaRemove")?.addEventListener("click", () => {
        pickedMedia = null;
        renderPreview();
      });
    }
  });

  await modal({
    title: "Nova story",
    bodyHTML,
    confirmLabel: "Publicar",
    onConfirm: async (body) => {
      const text = body.querySelector("#storyText").value.trim();
      if (!text && !pickedMedia) throw new Error("Põe texto ou foto/vídeo.");
      const now = Date.now();
      await addDoc(collection(db, "stories"), {
        uid: CURRENT_USER.uid,
        authorName: CURRENT_PROFILE.name,
        authorUsername: CURRENT_PROFILE.username,
        authorPhoto: CURRENT_PROFILE.photoURL || "",
        text: text.slice(0, 240),
        mediaURL: pickedMedia?.url || "",
        mediaType: pickedMedia?.type || "",
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(now + 24 * 60 * 60 * 1000)
      });
      toast("Story adicionada!", "success");
      return true;
    }
  });
}

function initStoryViewer() {
  document.getElementById("closeStoryBtn").addEventListener("click", closeStoryViewer);
}
let storyTimer = null;
let currentStoryList = null;
let currentStoryIdx = 0;

function openStoryViewer(stories) {
  const v = document.getElementById("storyViewer");
  const content = document.getElementById("storyContent");
  const userInfo = document.getElementById("storyUserInfo");
  const bar = document.getElementById("storyBar");
  const deleteBtn = document.getElementById("deleteStoryBtn");
  v.classList.add("open");
  currentStoryList = stories;
  currentStoryIdx = 0;
  const DURATION = 6000; // slightly longer to give media time
  const DURATION_VIDEO = 12000;

  const show = () => {
    if (currentStoryIdx >= currentStoryList.length) { closeStoryViewer(); return; }
    const s = currentStoryList[currentStoryIdx];
    // Stories store the avatar under `authorPhoto` (not `photoURL`), so rebuild
    // a mini-profile object for avatarHTML.
    const authorAvatarObj = {
      photoURL: s.authorPhoto || s.photoURL || "",
      name: s.authorName,
      username: s.authorUsername
    };
    userInfo.innerHTML = `${avatarHTML(authorAvatarObj, 32)} <div>${escapeHTML(s.authorName || "")} <span style="opacity:.7;font-weight:400;font-size:12px;">${timeAgo(s.createdAt)}</span></div>`;

    // Render content — media + text
    let html = "";
    if (s.mediaURL) {
      if (s.mediaType === "video") {
        html += `<video src="${escapeHTML(s.mediaURL)}" autoplay playsinline muted loop style="max-width:100%;max-height:72vh;object-fit:contain;border-radius:14px;display:block;margin:0 auto;"></video>`;
      } else {
        html += `<img src="${escapeHTML(s.mediaURL)}" alt="" style="max-width:100%;max-height:72vh;object-fit:contain;border-radius:14px;display:block;margin:0 auto;" />`;
      }
    }
    if (s.text) {
      html += `<div style="${s.mediaURL ? "margin-top:14px;padding:10px 14px;background:rgba(0,0,0,.45);border-radius:12px;backdrop-filter:blur(6px);font-size:16px;max-width:560px;margin-left:auto;margin-right:auto;" : "font-size:22px;line-height:1.4;"}">${escapeHTML(s.text)}</div>`;
    }
    content.innerHTML = html;

    // Show/hide delete button based on authorship
    if (deleteBtn) {
      if (s.uid === CURRENT_USER.uid) {
        deleteBtn.classList.remove("hidden");
        deleteBtn.onclick = (e) => {
          e.stopPropagation();
          deleteStory(s.id);
        };
      } else {
        deleteBtn.classList.add("hidden");
      }
    }

    const dur = s.mediaType === "video" ? DURATION_VIDEO : DURATION;
    bar.style.transition = "none";
    bar.style.width = "0%";
    requestAnimationFrame(() => {
      bar.style.transition = `width ${dur}ms linear`;
      bar.style.width = "100%";
    });
    clearTimeout(storyTimer);
    storyTimer = setTimeout(() => { currentStoryIdx++; show(); }, dur);
  };
  v.onclick = (e) => {
    if (e.target.closest("#closeStoryBtn") || e.target.closest("#deleteStoryBtn")) return;
    // don't advance if clicking media controls
    if (e.target.tagName === "VIDEO") return;
    currentStoryIdx++; show();
  };
  show();
}

async function deleteStory(storyId) {
  clearTimeout(storyTimer); // pause the auto-advance
  if (!confirm("Apagar esta story?")) {
    // resume timer if cancelled
    if (currentStoryList && currentStoryIdx < currentStoryList.length) {
      const s = currentStoryList[currentStoryIdx];
      const dur = s.mediaType === "video" ? 12000 : 6000;
      storyTimer = setTimeout(() => { currentStoryIdx++; /* onSnapshot will re-render */ }, dur);
    }
    return;
  }
  try {
    await deleteDoc(doc(db, "stories", storyId));
    toast("Story apagada", "success");
    // Remove from current list so viewer advances
    if (currentStoryList) {
      currentStoryList.splice(currentStoryIdx, 1);
      if (currentStoryIdx >= currentStoryList.length) {
        closeStoryViewer();
      } else {
        // re-render current idx (now points to next story)
        openStoryViewer(currentStoryList);
      }
    }
  } catch (err) {
    toast("Erro: " + err.message, "error");
  }
}

function closeStoryViewer() {
  const v = document.getElementById("storyViewer");
  v.classList.remove("open");
  clearTimeout(storyTimer);
  currentStoryList = null;
}

// ─── Notifications ────────────────────────────────────
async function createNotif(toUid, payload) {
  try {
    await addDoc(collection(db, "notifications", toUid, "items"), {
      ...payload,
      at: serverTimestamp(),
      read: false
    });
  } catch (err) {
    console.warn("notif failed", err);
  }
}

function subscribeNotifications() {
  const q = query(
    collection(db, "notifications", CURRENT_USER.uid, "items"),
    orderBy("at", "desc"),
    limit(40)
  );
  const list = document.getElementById("notifsList");
  const badge = document.getElementById("notifBadge");
  let prevUnread = 0;
  let firstSnap = true;
  const unsub = onSnapshot(q, (snap) => {
    if (snap.empty) {
      list.innerHTML = `<div class="empty" style="padding:24px;"><div class="empty-emoji">🔔</div>Sem notificações.</div>`;
      badge?.classList.add("hidden");
      return;
    }
    let unread = 0;
    let latestUnread = null;
    const html = [];
    snap.forEach(d => {
      const n = d.data();
      if (!n.read) {
        unread++;
        if (!latestUnread) latestUnread = n; // first one in desc order
      }
      html.push(`
        <div class="notif ${n.read ? "" : "unread"}" data-id="${d.id}">
          <div style="width:36px;height:36px;flex-shrink:0;">${avatarHTML({ photoURL: n.fromPhoto, name: n.fromName, username: n.fromUsername }, 36)}</div>
          <div style="flex:1;">
            <div class="nt-text"><b>${escapeHTML(n.fromName || "Alguém")}</b> ${escapeHTML(n.text || "")}</div>
            <div class="nt-time">${timeAgo(n.at)}</div>
          </div>
        </div>
      `);
    });
    list.innerHTML = html.join("");
    badge?.classList.toggle("hidden", unread === 0);
    // Play beep + push notification if unread count increased (skip on first load)
    if (!firstSnap && unread > prevUnread && latestUnread) {
      playBeep();
      showLocalNotification({
        title: `🔔 ${latestUnread.fromName || "Alguém"}`,
        body: latestUnread.text || "Tens uma nova notificação",
        tag: "notif-" + (latestUnread.postId || Date.now()),
        data: { url: "./index.html?notifs=1" },
        source: "client",
        category: "engagement"
      });
    }
    firstSnap = false;
    prevUnread = unread;
  });
  unsubscribers.push(unsub);
}

async function markNotifsRead() {
  try {
    const qs = await getDocs(
      query(collection(db, "notifications", CURRENT_USER.uid, "items"), where("read", "==", false), limit(20))
    );
    await Promise.all(qs.docs.map(d => updateDoc(d.ref, { read: true })));
  } catch {}
}

// ─── Ranking ──────────────────────────────────────────
let _rankingMode = "current";

async function loadRanking(mode = "current") {
  const list = document.getElementById("rankingList");
  list.innerHTML = `<div class="empty" style="padding:24px;">A carregar<span class="dots"></span></div>`;
  try {
    // "current" ranks by live points; "alltime" ranks by totalPointsEarned
    const field = mode === "alltime" ? "totalPointsEarned" : "points";
    const qRank = query(collection(db, "users"), orderBy(field, "desc"), limit(25));
    const snap = await getDocs(qRank);
    if (snap.empty) {
      list.innerHTML = `<div class="empty" style="padding:24px;">Ainda sem ranking.</div>`;
      return;
    }
    list.innerHTML = snap.docs.map((d, i) => {
      const u = d.data();
      const pos = i + 1;
      const medal = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : "";
      const val = mode === "alltime" ? (u.totalPointsEarned || u.points || 0) : (u.points || 0);
      return `
        <a href="./profile.html?u=${encodeURIComponent(u.username || "")}" class="rank-row tap" data-ripple>
          <div class="pos ${pos <= 3 ? "top" : ""}">${medal || pos}</div>
          <div style="width:36px;height:36px;">${avatarHTML(u, 36)}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;">${nameStyleHTML(u)}${adminBadgeHTML(u)}</div>
            <div style="font-size:12px;color:var(--muted);">@${escapeHTML(u.username || "")}</div>
          </div>
          <div style="font-weight:700;" class="grad-text">${val} pts</div>
        </a>
      `;
    }).join("");
  } catch (err) {
    // totalPointsEarned may not exist → fallback to points
    if (mode === "alltime") return loadRanking("current");
    list.innerHTML = `<div class="empty" style="padding:24px;color:#fca5a5;">Erro: ${escapeHTML(err.message)}</div>`;
  }
}

// ─── Header settings btn + logo easter egg helpers ────
function initHeaderSettingsBtn() {
  const btn = document.getElementById("headerSettingsBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    showPanel("settingsPanel");
    document.getElementById("drawer").classList.add("open");
    document.getElementById("drawerBackdrop").classList.add("open");
    hydrateSettings();
  });
}

// ─── Settings panel ───────────────────────────────────
function hydrateSettings() {
  // master toggle state
  const t = document.getElementById("pushNotifsToggle");
  if (t) t.checked = !!getPushNotifsEnabled();
  // granular category toggles
  const prefs = getNotifPrefs();
  document.querySelectorAll('[data-notif-pref]').forEach(el => {
    const cat = el.getAttribute("data-notif-pref");
    el.checked = !!prefs[cat];
  });
  _reflectNotifCategoriesDisabled();
  // theme active
  const theme = getSavedTheme() || "dark";
  document.querySelectorAll(".theme-option").forEach(opt => {
    opt.classList.toggle("active", opt.dataset.theme === theme);
  });
  // admin section
  const adminSec = document.getElementById("adminSettingsSection");
  if (adminSec) {
    adminSec.classList.toggle("hidden", !CURRENT_PROFILE?.isAdmin);
    if (CURRENT_PROFILE?.isAdmin) loadAdminUsersList();
  }
}

// Grey-out the category toggles when the master push is OFF so the user
// doesn't tweak sub-toggles that would have no effect.
function _reflectNotifCategoriesDisabled() {
  const master = !!getPushNotifsEnabled();
  const box = document.getElementById("notifCategoriesBox");
  if (!box) return;
  box.classList.toggle("is-muted", !master);
  box.querySelectorAll('input[data-notif-pref]').forEach(el => {
    el.disabled = !master;
  });
}

function initSettingsPanel() {
  // push toggle (master)
  const tog = document.getElementById("pushNotifsToggle");
  tog?.addEventListener("change", async () => {
    if (tog.checked) {
      if (!("Notification" in window)) {
        toast("Browser não suporta notificações", "error");
        tog.checked = false;
        return;
      }
      const ok = await requestNotifPermissionOnce();
      if (!ok) {
        toast("Permissão recusada", "error");
        tog.checked = false;
        return;
      }
      setPushNotifsEnabled(true);
      toast("Push activado ✨", "success");
    } else {
      setPushNotifsEnabled(false);
      toast("Push desactivado");
    }
    _reflectNotifCategoriesDisabled();
  });

  // granular category toggles
  document.querySelectorAll('input[data-notif-pref]').forEach(el => {
    el.addEventListener("change", () => {
      const cat = el.getAttribute("data-notif-pref");
      setNotifPref(cat, el.checked);
      const label = el.closest(".settings-row")?.querySelector(".settings-row-label")?.textContent?.trim() || cat;
      toast(`${label}: ${el.checked ? "ativado" : "desativado"}`, "success");
    });
  });

  // theme picker
  document.querySelectorAll(".theme-option").forEach(opt => {
    opt.addEventListener("click", () => {
      const t = opt.dataset.theme;
      applyTheme(t);
      saveTheme(t);
      document.querySelectorAll(".theme-option").forEach(o => o.classList.remove("active"));
      opt.classList.add("active");
      toast(`Tema "${opt.querySelector(".theme-name").textContent}" aplicado`, "success");
    });
  });

  // change password
  document.getElementById("changePwBtn")?.addEventListener("click", () => openChangePasswordModal());
}

async function openChangePasswordModal() {
  const bodyHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <input class="input" id="pwOld"  type="password" placeholder="Password actual" autocomplete="current-password" />
      <input class="input" id="pwNew"  type="password" placeholder="Nova password (min 6)" autocomplete="new-password" />
      <input class="input" id="pwNew2" type="password" placeholder="Confirmar nova password" autocomplete="new-password" />
      <div style="font-size:11px;color:var(--muted);">Por segurança pedimos a password atual.</div>
    </div>`;
  await modal({
    title: "Mudar password",
    bodyHTML,
    confirmLabel: "Atualizar",
    onConfirm: async (body) => {
      const old = body.querySelector("#pwOld").value;
      const n1 = body.querySelector("#pwNew").value;
      const n2 = body.querySelector("#pwNew2").value;
      if (!old || !n1 || !n2) throw new Error("Preenche todos os campos.");
      if (n1.length < 6) throw new Error("Nova password muito curta.");
      if (n1 !== n2) throw new Error("As passwords não coincidem.");
      if (!CURRENT_USER.email) throw new Error("Conta sem email associado.");
      const cred = EmailAuthProvider.credential(CURRENT_USER.email, old);
      await reauthenticateWithCredential(CURRENT_USER, cred);
      await updatePassword(CURRENT_USER, n1);
      toast("Password atualizada ✨", "success");
      return true;
    }
  });
}

async function loadAdminUsersList() {
  const box = document.getElementById("adminUsersList");
  if (!box) return;
  box.innerHTML = `<div class="empty" style="padding:14px 0;">A carregar<span class="dots"></span></div>`;
  try {
    const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(100)));
    if (snap.empty) { box.innerHTML = `<div class="empty" style="padding:14px 0;">Sem utilizadores.</div>`; return; }
    box.innerHTML = "";
    snap.forEach(d => {
      const u = d.data();
      const uid = d.id;
      if (uid === CURRENT_USER.uid) return; // don't self-manage
      const role = u.isAdmin ? "admin" : u.isMod ? "mod" : "user";
      const row = document.createElement("div");
      row.className = "admin-user-row";
      const timeoutHrs = u.timeoutUntil && u.timeoutUntil > Date.now()
        ? Math.ceil((u.timeoutUntil - Date.now()) / 3600000)
        : 0;
      row.innerHTML = `
        <div style="width:34px;height:34px;">${avatarHTML(u, 34)}</div>
        <div class="au-body">
          <div style="font-weight:600;font-size:13px;">${escapeHTML(u.name || "")}</div>
          <div style="font-size:11px;color:var(--muted);">@${escapeHTML(u.username || "")} · ${u.points || 0} pts${timeoutHrs ? ` · 🔇${timeoutHrs}h` : ""}</div>
          <div class="au-controls" style="margin-top:6px;display:flex;flex-direction:column;gap:6px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted-2);">
              <span style="min-width:54px;">Timeout</span>
              <input type="range" min="0" max="72" step="1" data-timeout value="0" style="flex:1;" />
              <span data-timeout-label style="font-variant-numeric:tabular-nums;min-width:26px;text-align:right;">0h</span>
              <button type="button" data-timeout-apply class="btn-ghost tap" style="padding:4px 10px;font-size:11px;">Aplicar</button>
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted-2);">
              <span style="min-width:54px;">Pontos</span>
              <input type="number" data-points-delta value="0" style="flex:1;background:#1a1a1a;border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:8px;font-size:12px;width:60px;" placeholder="±" />
              <button type="button" data-points-apply class="btn-ghost tap" style="padding:4px 10px;font-size:11px;">Aplicar</button>
            </label>
          </div>
        </div>
        <select data-role>
          <option value="user"  ${role === "user"  ? "selected" : ""}>User</option>
          <option value="mod"   ${role === "mod"   ? "selected" : ""}>Mod</option>
          <option value="admin" ${role === "admin" ? "selected" : ""}>Admin</option>
        </select>
        <button class="ban-btn" data-edit-user title="Editar info" style="background:#1a1a1a;color:#a5b4fc;border:1px solid var(--border);">Editar</button>
        <button class="ban-btn ${u.banned ? "banned" : ""}" data-ban>${u.banned ? "Desbanir" : "Banir"}</button>
      `;
      row.innerHTML = buildAdminUserRowMarkup(u, role, timeoutHrs);
      row.querySelector("[data-role]").addEventListener("change", async (e) => {
        const v = e.target.value;
        try {
          const roleData = {
            isAdmin: v === "admin",
            isMod:   v === "mod",
            role:    v
          };
          await updateDoc(doc(db, "users", uid), roleData);
          toast(`Role definido: ${v}`, "success");
          // Propagate role/badges retroactively so old posts/comments reflect it
          propagateAuthorUpdate(uid, roleData).catch(() => {});
        } catch (err) { toast("Erro: " + err.message, "error"); }
      });
      row.querySelector("[data-ban]").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const nowBanned = !u.banned;
        try {
          await updateDoc(doc(db, "users", uid), { banned: nowBanned });
          u.banned = nowBanned;
          btn.textContent = nowBanned ? "Desbanir" : "Banir";
          btn.classList.toggle("banned", nowBanned);
          toast(nowBanned ? "Utilizador banido" : "Utilizador desbanido", "success");
        } catch (err) { toast("Erro: " + err.message, "error"); }
      });
      // Admin: edit user info
      row.querySelector("[data-edit-user]")?.addEventListener("click", () => openAdminEditUser(uid, u));
      // Admin: assign invisible roles for archive visibility
      row.querySelector("[data-edit-roles]")?.addEventListener("click",
        () => openUserRolesEditor(uid, u.roles || []));
      // Timeout slider
      const tRange = row.querySelector("[data-timeout]");
      const tLabel = row.querySelector("[data-timeout-label]");
      tRange?.addEventListener("input", () => { tLabel.textContent = tRange.value + "h"; });
      row.querySelector("[data-timeout-apply]")?.addEventListener("click", async () => {
        const hrs = parseInt(tRange.value, 10) || 0;
        try {
          if (hrs === 0) {
            await updateDoc(doc(db, "users", uid), { timeoutUntil: null });
            toast("Timeout removido", "success");
          } else {
            await updateDoc(doc(db, "users", uid), { timeoutUntil: Date.now() + hrs * 3600000 });
            toast(`Timeout de ${hrs}h aplicado`, "success");
          }
        } catch (err) { toast("Erro: " + err.message, "error"); }
      });
      // Points adjust
      row.querySelector("[data-points-apply]")?.addEventListener("click", async () => {
        const delta = parseInt(row.querySelector("[data-points-delta]").value, 10) || 0;
        if (!delta) return;
        try {
          await updateDoc(doc(db, "users", uid), {
            points: increment(delta),
            ...(delta > 0 ? { totalPointsEarned: increment(delta) } : {})
          });
          toast((delta > 0 ? "+" : "") + delta + " pts", "success");
          row.querySelector("[data-points-delta]").value = 0;
        } catch (err) { toast("Erro: " + err.message, "error"); }
      });
      box.appendChild(row);
    });
  } catch (err) {
    box.innerHTML = `<div class="empty" style="padding:14px 0;color:#fca5a5;">Erro: ${escapeHTML(err.message)}</div>`;
  }
}

// Admin god-mode: edit any user's name, username, bio, photo
async function openAdminEditUser(uid, u) {
  const body = `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <label style="font-size:12px;color:var(--muted);">
        Nome
        <input id="auName" class="input" value="${escapeHTML(u.name || "")}" style="width:100%;margin-top:4px;" />
      </label>
      <label style="font-size:12px;color:var(--muted);">
        @username
        <input id="auUser" class="input" value="${escapeHTML(u.username || "")}" style="width:100%;margin-top:4px;" />
      </label>
      <label style="font-size:12px;color:var(--muted);">
        Bio
        <textarea id="auBio" class="input" rows="3" style="width:100%;margin-top:4px;resize:vertical;">${escapeHTML(u.bio || "")}</textarea>
      </label>
      <label style="font-size:12px;color:var(--muted);">
        URL da foto de perfil
        <input id="auPhoto" class="input" value="${escapeHTML(u.photoURL || "")}" placeholder="https://..." style="width:100%;margin-top:4px;" />
      </label>
      <label style="font-size:12px;color:var(--muted);">
        Pontos
        <input id="auPoints" class="input" type="number" value="${u.points || 0}" style="width:100%;margin-top:4px;" />
      </label>
    </div>
  `;
  await modal({
    title: "Editar utilizador (admin)",
    bodyHTML: body,
    confirmLabel: "Guardar",
    onConfirm: async (root) => {
      const name = root.querySelector("#auName").value.trim();
      const newUser = root.querySelector("#auUser").value.trim().toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_]/g, "");
      const bio = root.querySelector("#auBio").value.trim();
      const photoURL = root.querySelector("#auPhoto").value.trim();
      const points = parseInt(root.querySelector("#auPoints").value, 10) || 0;
      if (!name) throw new Error("Nome obrigatório");
      if (!newUser || newUser.length < 3) throw new Error("Username inválido");
      // If username changed, make sure it's unique
      if (newUser !== (u.username || "")) {
        const qs = await getDocs(query(collection(db, "users"), where("username", "==", newUser), limit(1)));
        if (!qs.empty && qs.docs[0].id !== uid) throw new Error("@username já existe");
      }
      try {
        await updateDoc(doc(db, "users", uid), {
          name, username: newUser, bio, photoURL, points
        });
        toast("Perfil atualizado", "success");
        // Propagate to target user's old posts/stories/comments so the name,
        // username and photo update retroactively.
        propagateAuthorUpdate(uid, { name, username: newUser, photoURL }).catch(() => {});
        loadAdminUsersList();
        return true;
      } catch (err) {
        throw new Error("Erro: " + err.message);
      }
    }
  });
}

// ─── Shop ──────────────────────────────────────────────
const SHOP_ITEMS = [
  { id: "color_cyan",    name: "Cor Azul",           sub: "Nome em Azul",           price: 15,  preview: `<span class="name-sample" style="color:#22d3ee;">Nome</span>`, apply: { nameColor: "#22d3ee" } },
  { id: "color_pink",    name: "Cor Rosa",            sub: "Nome em rosa (Gay)",     price: 15,  preview: `<span class="name-sample" style="color:#ec4899;">Nome</span>`, apply: { nameColor: "#ec4899" } },
  { id: "color_green",   name: "Cor verde",           sub: "Nome em verde",      price: 15,  preview: `<span class="name-sample" style="color:#22c55e;">Nome</span>`, apply: { nameColor: "#22c55e" } },
  { id: "color_gold",    name: "Dourado especial",    sub: "Cor dourada com glow",    price: 100, preview: `<span class="name-sample name-gold">Nome</span>`,             apply: { nameStyle: "gold" } },
  { id: "grad_anim",     name: "Degradê animado",     sub: "Nome com gradiente animado", price: 30, preview: `<span class="name-sample name-grad-anim">Nome</span>`,    apply: { nameStyle: "grad" } },
  { id: "change_user",   name: "Mudar @username",     sub: "Escolher um novo @",      price: 50,  preview: `<span style="font-weight:700;">@</span>`, action: "changeUsername" },
  { id: "timeout_user",  name: "Timeout 24h",         sub: "Silenciar um user 24h",   price: 50,  preview: `<span style="font-weight:700;opacity:.7;">🔇</span>`, action: "timeoutUser" },
  { id: "reset_color",   name: "Remover Modificações", sub: "Voltar à cor padrão",     price: 0,   preview: `<span class="name-sample">Nome</span>`, apply: { nameColor: null, nameStyle: null } },
];

// Profile themes — animated backgrounds for your profile page
const SHOP_PROFILE_THEMES = [
  { id: "ptheme_none",    name: "Nenhum",              sub: "Sem tema de perfil",          price: 0,   preview: `<span class="pt-preview pt-preview-none">—</span>`,      apply: { profileTheme: null } },
  { id: "ptheme_flames",  name: "Chamas",              sub: "Perfil em chamas animadas",   price: 20, preview: `<span class="pt-preview pt-preview-flames"></span>`,     apply: { profileTheme: "flames" } },
  { id: "ptheme_aurora",  name: "Aurora",              sub: "Ondas de aurora boreal",      price: 20, preview: `<span class="pt-preview pt-preview-aurora"></span>`,     apply: { profileTheme: "aurora" } },
  { id: "ptheme_neon",    name: "Neon Grid",           sub: "Grelha vaporwave animada",    price: 25, preview: `<span class="pt-preview pt-preview-neon"></span>`,       apply: { profileTheme: "neon" } },
  { id: "ptheme_galaxy",  name: "Galáxia",             sub: "Estrelas e nebulosa",         price: 25, preview: `<span class="pt-preview pt-preview-galaxy"></span>`,     apply: { profileTheme: "galaxy" } },
  { id: "ptheme_cyber",   name: "Cyber HUD",           sub: "Linhas neon em scan",         price: 30, preview: `<span class="pt-preview pt-preview-cyber"></span>`,      apply: { profileTheme: "cyber" } },
  { id: "ptheme_sakura",  name: "Sakura",              sub: "Pétalas a cair",              price: 30, preview: `<span class="pt-preview pt-preview-sakura"></span>`,     apply: { profileTheme: "sakura" } },
];

async function renderShop() {
  const box = document.getElementById("shopContent");
  document.getElementById("shopPointsValue").textContent = CURRENT_PROFILE?.points || 0;
  if (!box) return;

  const renderItemRow = (it, kind) => {
    const owned = (kind === "ptheme")
      ? (CURRENT_PROFILE.profileTheme === it.apply?.profileTheme)
      : false;
    return `
      <div class="shop-item" data-sid="${it.id}" data-kind="${kind}">
        <div class="shop-item-icon">${it.preview}</div>
        <div class="shop-item-body">
          <div class="shop-item-title">${escapeHTML(it.name)}</div>
          <div class="shop-item-sub">${escapeHTML(it.sub)}</div>
        </div>
        <div class="shop-price">${it.price} pts</div>
        <button class="shop-buy-btn" data-buy ${owned ? 'disabled' : ''}>${owned ? 'Ativo' : (it.price === 0 ? 'Aplicar' : 'Comprar')}</button>
      </div>
    `;
  };

  box.innerHTML =
    `<div class="shop-section-title">Personalização</div>` +
    SHOP_ITEMS.map(it => renderItemRow(it, "item")).join("") +
    `<div class="shop-section-title" style="margin-top:18px;">Temas de perfil</div>` +
    `<div class="shop-section-sub">Fundos animados para a tua página de perfil</div>` +
    SHOP_PROFILE_THEMES.map(it => renderItemRow(it, "ptheme")).join("") +
    `<div class="shop-coming-soon">Mais perks brevemente…</div>`;

  box.querySelectorAll(".shop-item").forEach(row => {
    const id = row.dataset.sid;
    const kind = row.dataset.kind;
    const it = (kind === "ptheme")
      ? SHOP_PROFILE_THEMES.find(x => x.id === id)
      : SHOP_ITEMS.find(x => x.id === id);
    const btn = row.querySelector("[data-buy]");
    if (!btn || !it) return;
    if (btn.disabled) return;
    if (it.price > 0 && (CURRENT_PROFILE.points || 0) < it.price) { btn.disabled = true; btn.textContent = "Sem pts"; return; }
    btn.addEventListener("click", () => buyShopItem(it, btn));
  });
}

async function buyShopItem(it, btn) {
  if ((CURRENT_PROFILE.points || 0) < it.price) { toast("Pontos insuficientes", "error"); return; }
  try {
    // Action types need extra input
    let extra = null;
    if (it.action === "changeUsername") {
      const body = `<input class="input" id="newU" placeholder="novo_username" />`;
      let newU = null;
      await modal({
        title: "Novo @username",
        bodyHTML: body,
        confirmLabel: "Confirmar",
        onConfirm: async (root) => {
          newU = root.querySelector("#newU").value.trim().toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_]/g, "");
          if (!newU || newU.length < 3) throw new Error("Username inválido");
          // check unique
          const q = query(collection(db, "users"), where("username", "==", newU), limit(1));
          const s = await getDocs(q);
          if (!s.empty) throw new Error("@username já usado");
          return true;
        }
      });
      if (!newU) return;
      extra = { username: newU };
    } else if (it.action === "timeoutUser") {
      const body = `<input class="input" id="tUser" placeholder="@username a silenciar 24h" />`;
      let target = null;
      await modal({
        title: "Timeout 24h",
        bodyHTML: body,
        confirmLabel: "Aplicar",
        onConfirm: async (root) => {
          target = root.querySelector("#tUser").value.trim().toLowerCase().replace(/^@/, "");
          if (!target) throw new Error("Username inválido");
          const q = query(collection(db, "users"), where("username", "==", target), limit(1));
          const s = await getDocs(q);
          if (s.empty) throw new Error("Utilizador não encontrado");
          extra = { targetUid: s.docs[0].id };
          return true;
        }
      });
      if (!extra) return;
    }

    await runTransaction(db, async (tx) => {
      const meRef = doc(db, "users", CURRENT_USER.uid);
      const me = await tx.get(meRef);
      const cur = me.data().points || 0;
      if (cur < it.price) throw new Error("Pontos insuficientes");
      const update = { points: increment(-it.price) };
      if (it.apply) Object.assign(update, it.apply);
      if (extra?.username) update.username = extra.username;
      tx.update(meRef, update);
      if (extra?.targetUid) {
        const tRef = doc(db, "users", extra.targetUid);
        tx.update(tRef, { timeoutUntil: Date.now() + 24 * 60 * 60 * 1000 });
      }
    });

    CURRENT_PROFILE.points = (CURRENT_PROFILE.points || 0) - it.price;
    if (it.apply?.nameColor !== undefined) CURRENT_PROFILE.nameColor = it.apply.nameColor;
    if (it.apply?.nameStyle !== undefined) CURRENT_PROFILE.nameStyle = it.apply.nameStyle;
    if (it.apply && Object.prototype.hasOwnProperty.call(it.apply, "profileTheme")) {
      CURRENT_PROFILE.profileTheme = it.apply.profileTheme;
    }
    if (extra?.username) CURRENT_PROFILE.username = extra.username;

    // Update profile to sync old posts/comments
    const profileUpdate = {};
    if (it.apply?.nameColor !== undefined) profileUpdate.nameColor = it.apply.nameColor;
    if (it.apply?.nameStyle !== undefined) profileUpdate.nameStyle = it.apply.nameStyle;
    if (extra?.username) profileUpdate.username = extra.username;
    if (Object.keys(profileUpdate).length > 0) {
      await updateMyProfile(profileUpdate);
    }

    toast(it.price === 0 ? "Aplicado!" : "Comprado! ✨", "success");
    renderShop();
  } catch (err) {
    toast("Erro: " + err.message, "error");
  }
}

// ─── Bug reports ──────────────────────────────────────
function initBugsPanel() {
  const input = document.getElementById("bugReportInput");
  const btn = document.getElementById("bugReportSubmit");
  btn?.addEventListener("click", async () => {
    const text = (input?.value || "").trim();
    if (!text) { toast("Escreve o bug primeiro", "error"); return; }
    btn.disabled = true;
    try {
      await addDoc(collection(db, "bugReports"), {
        uid: CURRENT_USER.uid,
        authorName: CURRENT_PROFILE.name,
        authorUsername: CURRENT_PROFILE.username,
        text,
        at: serverTimestamp(),
        resolved: false
      });
      input.value = "";
      toast("Report enviado! Obrigado.", "success");
    } catch (err) { toast("Erro: " + err.message, "error"); }
    btn.disabled = false;
  });

  // Show bugs tab in notifsPanel only for admins
  if (CURRENT_PROFILE?.isAdmin) {
    document.getElementById("notifsSegmented")?.style.setProperty("display", "flex");
  }
}

async function loadBugReports() {
  const box = document.getElementById("notifsBugsList");
  if (!box) return;
  box.innerHTML = `<div class="empty" style="padding:16px;">A carregar<span class="dots"></span></div>`;
  try {
    const snap = await getDocs(query(collection(db, "bugReports"), orderBy("at", "desc"), limit(40)));
    if (snap.empty) { box.innerHTML = `<div class="empty" style="padding:16px;"><div class="empty-emoji">🐛</div>Sem reports.</div>`; return; }
    box.innerHTML = snap.docs.map(d => {
      const b = d.data();
      return `
        <div class="notif ${b.resolved ? "" : "unread"}" data-bid="${d.id}">
          <div style="font-size:20px;">🐛</div>
          <div style="flex:1;">
            <div class="nt-text"><b>${escapeHTML(b.authorName || "")}</b> @${escapeHTML(b.authorUsername || "")}</div>
            <div class="nt-text" style="margin-top:4px;white-space:pre-wrap;">${escapeHTML(b.text)}</div>
            <div class="nt-time">${timeAgo(b.at)}</div>
          </div>
        </div>`;
    }).join("");
  } catch (err) {
    box.innerHTML = `<div class="empty" style="padding:16px;color:#fca5a5;">Erro: ${escapeHTML(err.message)}</div>`;
  }
}

// ─── Admin god-mode panel ─────────────────────────────
// Universal Firestore editor + wipe-all button. Only wired up for admins.
let _adminLastCol = null;
let _adminLastDocs = [];
function initAdminPanel() {
  const sel = document.getElementById("adminColSelect");
  const custom = document.getElementById("adminColCustom");
  const loadBtn = document.getElementById("adminLoadColBtn");
  const newBtn = document.getElementById("adminNewDocBtn");
  const filter = document.getElementById("adminDocFilter");
  const list = document.getElementById("adminDocsList");
  const wipeBtn = document.getElementById("adminWipeBtn");
  if (!sel || !loadBtn || !list) return;

  sel.addEventListener("change", () => {
    custom.classList.toggle("hidden", sel.value !== "__custom__");
  });

  const getCurrentCol = () => {
    const v = sel.value;
    if (v === "__custom__") return (custom.value || "").trim();
    return v;
  };

  loadBtn.addEventListener("click", () => loadAdminCollection(getCurrentCol(), list, filter));
  filter.addEventListener("input", () => renderAdminDocsList(list, filter.value.trim().toLowerCase()));
  newBtn.addEventListener("click", () => openAdminDocEditor(getCurrentCol(), null, null));
  wipeBtn.addEventListener("click", () => confirmWipeAllData());
}

async function loadAdminCollection(colName, listEl, filterEl) {
  if (!colName) { toast("Escolhe uma colecção", "error"); return; }
  listEl.innerHTML = `<div class="empty" style="padding:16px;">A carregar <span class="dots"></span></div>`;
  try {
    const snap = await getDocs(query(collection(db, colName), limit(200)));
    _adminLastCol = colName;
    _adminLastDocs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    renderAdminDocsList(listEl, (filterEl?.value || "").trim().toLowerCase());
  } catch (err) {
    listEl.innerHTML = `<div class="empty" style="padding:16px;color:#fca5a5;">Erro: ${escapeHTML(err.message)}</div>`;
  }
}

function renderAdminDocsList(listEl, filterQ) {
  if (!_adminLastDocs.length) {
    listEl.innerHTML = `<div class="empty" style="padding:16px;color:var(--muted);">Sem documentos.</div>`;
    return;
  }
  const filtered = !filterQ
    ? _adminLastDocs
    : _adminLastDocs.filter(({ id, data }) => {
        if (id.toLowerCase().includes(filterQ)) return true;
        try { return JSON.stringify(data).toLowerCase().includes(filterQ); } catch { return false; }
      });
  listEl.innerHTML = filtered.map(({ id, data }) => {
    const preview = summarizeDoc(data);
    return `
      <div class="admin-doc-row" data-admin-edit="${escapeHTML(id)}"
           style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:#111;margin-bottom:8px;cursor:pointer;">
        <div style="min-width:0;flex:1;">
          <div style="font-family:ui-monospace,monospace;font-size:12px;color:#a3e635;word-break:break-all;">${escapeHTML(id)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHTML(preview)}</div>
        </div>
        <button class="btn-ghost" data-admin-del="${escapeHTML(id)}" style="padding:6px 10px;font-size:12px;color:#fca5a5;">Apagar</button>
      </div>
    `;
  }).join("");
  listEl.querySelectorAll("[data-admin-edit]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("[data-admin-del]")) return;
      const id = row.dataset.adminEdit;
      const d = _adminLastDocs.find(x => x.id === id);
      if (d) openAdminDocEditor(_adminLastCol, id, d.data);
    });
  });
  listEl.querySelectorAll("[data-admin-del]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.adminDel;
      if (!confirm(`Apagar ${_adminLastCol}/${id}? Esta acção é irreversível.`)) return;
      try {
        await deleteDoc(doc(db, _adminLastCol, id));
        _adminLastDocs = _adminLastDocs.filter(x => x.id !== id);
        renderAdminDocsList(listEl, "");
        toast("Documento apagado", "success");
      } catch (err) { toast("Erro: " + err.message, "error"); }
    });
  });
}

function summarizeDoc(data) {
  try {
    const keys = Object.keys(data || {}).slice(0, 3);
    return keys.map(k => {
      let v = data[k];
      if (v && typeof v === "object" && v.toDate) v = v.toDate().toISOString();
      if (typeof v === "string") v = v.slice(0, 40);
      return `${k}: ${typeof v === "object" ? JSON.stringify(v).slice(0, 40) : String(v).slice(0, 40)}`;
    }).join(" · ");
  } catch { return ""; }
}

function openAdminDocEditor(colName, docId, data) {
  if (!colName) { toast("Escolhe uma colecção primeiro", "error"); return; }
  const isNew = !docId;
  const initialJSON = JSON.stringify(data || {}, (k, v) => {
    // Firestore Timestamp → ISO for readable editing
    if (v && typeof v === "object" && typeof v.toDate === "function") return { __timestamp: v.toDate().toISOString() };
    return v;
  }, 2);
  modal({
    title: isNew ? `Novo doc em ${colName}` : `Editar ${colName}/${docId}`,
    bodyHTML: `
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px;">
        ${isNew ? "Deixa o ID vazio para auto-ID." : `ID: <code>${escapeHTML(docId)}</code>`}
      </div>
      ${isNew ? `<input class="input" id="adminNewId" placeholder="ID (opcional)" style="font-size:13px;margin-bottom:8px;">` : ""}
      <textarea id="adminJsonEdit" class="input" rows="14" spellcheck="false"
        style="font-family:ui-monospace,monospace;font-size:12px;line-height:1.4;resize:vertical;">${escapeHTML(initialJSON)}</textarea>
      <div style="font-size:11px;color:var(--muted);margin-top:6px;">
        Dica: timestamps aparecem como <code>{"__timestamp":"ISO"}</code>. Podes editar.
      </div>
    `,
    confirmLabel: "Guardar",
    onConfirm: async () => {
      const ta = document.getElementById("adminJsonEdit");
      const raw = (ta?.value || "").trim();
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch (e) { throw new Error("JSON inválido: " + e.message); }
      const revived = reviveAdminJson(parsed);
      try {
        if (isNew) {
          const wantedId = (document.getElementById("adminNewId")?.value || "").trim();
          if (wantedId) await setDoc(doc(db, colName, wantedId), revived);
          else await addDoc(collection(db, colName), revived);
        } else {
          await setDoc(doc(db, colName, docId), revived);
        }
        toast("Guardado", "success");
        // Refresh listing in place
        const listEl = document.getElementById("adminDocsList");
        const filterEl = document.getElementById("adminDocFilter");
        if (listEl) loadAdminCollection(colName, listEl, filterEl);
      } catch (err) {
        toast("Erro: " + err.message, "error");
        throw err;
      }
    }
  });
}

function reviveAdminJson(obj) {
  if (obj && typeof obj === "object") {
    if (!Array.isArray(obj) && obj.__timestamp && typeof obj.__timestamp === "string") {
      const t = new Date(obj.__timestamp);
      if (!isNaN(t)) return Timestamp.fromDate(t);
    }
    if (Array.isArray(obj)) return obj.map(reviveAdminJson);
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = reviveAdminJson(v);
    return out;
  }
  return obj;
}

// Dangerous: wipes every top-level collection known to the app. Requires
// typing "APAGAR TUDO" to confirm. Ignores subcollections (they get orphaned
// but not indexed; a follow-up import/export could clean up if needed).
async function confirmWipeAllData() {
  modal({
    title: "⚠️ Apagar TODOS os dados?",
    bodyHTML: `
      <div style="color:#fca5a5;font-size:13px;line-height:1.5;">
        Isto vai apagar <b>tudo</b> nas colecções principais:<br>
        <code>users, posts, stories, news, reports, bugReports, chats, dmMeta, stickers, shop, notifications</code>.
        <br><br>
        Escreve <b>APAGAR TUDO</b> para confirmar.
      </div>
      <input class="input" id="wipeConfirm" placeholder="APAGAR TUDO"
             style="font-size:14px;margin-top:12px;letter-spacing:.04em;">
    `,
    confirmLabel: "Apagar TUDO",
    onConfirm: async () => {
      const val = (document.getElementById("wipeConfirm")?.value || "").trim();
      if (val !== "APAGAR TUDO") throw new Error("Confirmação incorrecta");
      toast("A apagar todos os dados…", "info");
      const cols = ["users","posts","stories","news","reports","bugReports","chats","dmMeta","stickers","shop","notifications"];
      let total = 0;
      for (const c of cols) {
        try {
          const snap = await getDocs(collection(db, c));
          for (const d of snap.docs) {
            try { await deleteDoc(doc(db, c, d.id)); total++; } catch {}
          }
        } catch (err) {
          console.warn("wipe failed for", c, err);
        }
      }
      toast(`Apagados ${total} documentos`, "success");
    }
  });
}

// ─── DM drawer unread glow ────────────────────────────
function subscribeDmUnreadDrawer() {
  const dmItem = document.querySelector(".drawer-item.dm-item");
  if (!dmItem) return;
  const q = query(collection(db, "dmMeta", CURRENT_USER.uid, "chats"), where("unread", ">", 0), limit(5));
  const unsub = onSnapshot(q, (snap) => {
    dmItem.classList.toggle("has-dm-unread", !snap.empty);
  }, () => {});
  unsubscribers.push(unsub);
}

// ─── Pull-to-refresh (Instagram-style) ──────────────
function initPullToRefresh() {
  const container = document.querySelector(".container");
  if (!container) return;
  container.classList.add("pull-container");

  const THRESHOLD = 70;
  const MAX_PULL = 110;

  let pullStartY = 0;
  let isPulling = false;
  let activePull = false;
  let indicator = null;
  let pulled = 0;
  let refreshing = false;      // locks out new pulls while animation finishes
  let resetTimer = null;       // so we can cancel/replace a pending reset
  let clearInlineTimer = null;

  const createIndicator = () => {
    if (indicator) return;
    indicator = document.createElement("div");
    indicator.className = "pull-indicator";
    indicator.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10"/>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
      </svg>`;
    document.body.appendChild(indicator);
  };

  // Hard reset: always brings the page/indicator back to their neutral state,
  // no matter what went wrong. Safe to call from any path.
  const resetView = () => {
    if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
    if (clearInlineTimer) { clearTimeout(clearInlineTimer); clearInlineTimer = null; }

    if (container) {
      container.classList.remove("pulling");
      // Force a reflow so the browser picks up the transition for translateY(0).
      // (Removing .pulling re-enables the CSS transition.)
      // eslint-disable-next-line no-unused-expressions
      container.offsetHeight;
      container.style.transform = "translateY(0px)";
      clearInlineTimer = setTimeout(() => {
        if (container) container.style.transform = "";
        clearInlineTimer = null;
      }, 400);
    }
    if (indicator) {
      const ind = indicator;
      indicator = null;
      ind.classList.remove("ready", "refreshing");
      ind.style.transition = "transform .3s ease, opacity .3s ease";
      ind.style.opacity = "0";
      ind.style.transform = "translateX(-50%) translateY(-10px) scale(.7)";
      setTimeout(() => { try { ind.remove(); } catch {} }, 350);
    }
    refreshing = false;
  };

  document.addEventListener("touchstart", (e) => {
    // Don't start a new pull while we're mid-refresh animation — otherwise the
    // user can "capture" the indicator mid-flight and prevent cleanup.
    if (refreshing) return;
    if (window.scrollY > 2) return;
    if (e.touches.length !== 1) return;
    pullStartY = e.touches[0].clientY;
    isPulling = true;
    activePull = false;
    pulled = 0;
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (refreshing || !isPulling || e.touches.length !== 1) return;
    const delta = e.touches[0].clientY - pullStartY;
    if (delta <= 0) return;
    if (window.scrollY > 2) { isPulling = false; return; }

    // Start: create indicator and lock page
    if (!activePull && delta > 6) {
      activePull = true;
      createIndicator();
      container.classList.add("pulling");
    }
    if (!activePull) return;

    // Rubber-band dampening
    pulled = Math.min(MAX_PULL, delta * 0.55);
    e.preventDefault();

    container.style.transform = `translateY(${pulled}px)`;
    if (indicator) {
      const progress = Math.min(1, pulled / THRESHOLD);
      indicator.style.opacity = String(progress);
      const rot = pulled * 4;
      const scale = 0.7 + 0.3 * progress;
      const ty = Math.min(pulled * 0.55, 36);
      indicator.style.transform = `translateX(-50%) translateY(${ty}px) scale(${scale}) rotate(${rot}deg)`;
      indicator.classList.toggle("ready", pulled > THRESHOLD);
    }
  }, { passive: false });

  const endPull = () => {
    if (!isPulling) return;
    isPulling = false;
    if (!activePull) { activePull = false; pulled = 0; return; }
    activePull = false;

    if (pulled > THRESHOLD) {
      refreshing = true;
      container.classList.remove("pulling");
      container.style.transform = "translateY(44px)";
      if (indicator) {
        indicator.classList.add("refreshing");
        indicator.classList.add("ready");
        indicator.style.opacity = "1";
        indicator.style.transform = `translateX(-50%) translateY(28px) scale(1) rotate(0deg)`;
      }
      // Run the actual refresh. We never throw from here, but guard anyway —
      // the reset MUST happen even if refreshFeed explodes.
      try { refreshFeed(); } catch (e) { console.warn("[ptr] refreshFeed threw", e); }
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => { resetView(); }, 650);
    } else {
      resetView();
    }
    pulled = 0;
  };

  document.addEventListener("touchend", endPull);
  // Safety net: if the OS steals the touch (notification, phone call, etc.)
  // touchcancel fires instead of touchend. Without this handler the
  // indicator + pulled page would stay stuck forever.
  document.addEventListener("touchcancel", () => {
    if (!isPulling && !refreshing && !indicator) return;
    isPulling = false;
    activePull = false;
    pulled = 0;
    resetView();
  });

  // Safety net: if the tab goes to the background mid-refresh the 650ms
  // timeout can get throttled or dropped. On visibility return, force-reset.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && (refreshing || indicator)) {
      resetView();
    }
  });
}

function refreshFeed() {
  toast("Feed atualizado!", "success");
  // Recarregar perfil para atualizar drawer (pontos, etc.)
  getCurrentProfile().then(profile => {
    if (profile) {
      CURRENT_PROFILE = profile;
      document.getElementById("drawerAvatar").innerHTML = `<div class="grad-border" style="border-radius:50%;width:54px;height:54px;">${avatarHTML(profile, 50)}</div>`;
      document.getElementById("drawerName").innerHTML = escapeHTML(profile.name || "—") + adminBadgeHTML(profile);
      document.getElementById("drawerUser").textContent = "@" + (profile.username || "—");
      const adminTag = document.getElementById("drawerAdminTag");
      if (adminTag) adminTag.style.display = profile.isAdmin ? "inline" : "none";
    }
  }).catch(err => console.warn("Failed to refresh profile:", err));
  // Real-time via onSnapshot — nothing else to do.
}
