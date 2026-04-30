// =========================================================
// Alfa Club Social — Private DMs (Firestore)
// Collection layout:
//   chats/{chatId}           meta: { participants:[uidA,uidB], lastMessage, lastAt, unread_<uid> }
//   chats/{chatId}/messages  docs: { uid, text, at }
// chatId = sorted(uidA, uidB).join("_")
// =========================================================
import { db, rtdb } from "./firebase-config.js";
import {
  collection, query, where, orderBy, limit, onSnapshot, addDoc,
  doc, getDoc, setDoc, updateDoc, serverTimestamp, getDocs, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref as rtRef, onValue as rtOnValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { requireAuth } from "./auth.js";
import {
  toast, timeAgo, avatarHTML, escapeHTML, tap, adminBadgeHTML,
  buildDmChatId, wireHeaderNotifButton, wireDmNotifButton,
  nameStyleHTML, modBadgeHTML, maybePromptForNotifs
} from "./app.js";

// Track online users (mirrored from rtdb presence)
let ONLINE_UIDS = new Set();
let _presenceUnsub = null;

// Reliable scroll-to-bottom for the DM thread. Repeats across several frames
// to survive late-loading images, font swaps, and the dynamic viewport on
// mobile. Uses an incrementing pass counter so newer calls cancel older ones.
let _dmScrollPass = 0;
function dmScrollToBottomReliably() {
  const wrap = document.getElementById("threadWrap") || document.getElementById("dmMessages") || document.getElementById("messages");
  if (!wrap) return;
  _dmScrollPass++;
  const myPass = _dmScrollPass;
  const tries = [0, 50, 150, 300, 600, 1200];
  tries.forEach((ms) => {
    setTimeout(() => {
      if (myPass !== _dmScrollPass) return;
      wrap.scrollTop = wrap.scrollHeight + 9999;
      const last = wrap.lastElementChild;
      if (last && last.scrollIntoView) {
        try { last.scrollIntoView({ block: "end", behavior: "auto" }); } catch {}
      }
    }, ms);
  });
  try {
    wrap.querySelectorAll("img").forEach((img) => {
      if (img.complete || img._bottomBound) return;
      img._bottomBound = true;
      img.addEventListener("load", () => {
        const nearBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 80;
        if (nearBottom) wrap.scrollTop = wrap.scrollHeight + 9999;
      }, { once: true });
    });
  } catch {}
}

import "./sw-register.js";

let CURRENT_USER = null;
let CURRENT_PROFILE = null;
let currentThreadUnsub = null;
let inboxUnsub = null;

const params = new URLSearchParams(location.search);
const openChatId = params.get("c");
const openToUid = params.get("to");

requireAuth(async (user, profile) => {
  CURRENT_USER = user;
  CURRENT_PROFILE = profile;
  wireHeaderNotifButton(user);
  wireDmNotifButton(user);
  maybePromptForNotifs();

  // Subscribe to presence to show online indicators in the inbox
  try {
    const presenceRef = rtRef(rtdb, "presence");
    _presenceUnsub = rtOnValue(presenceRef, (snap) => {
      const val = snap.val() || {};
      ONLINE_UIDS = new Set(Object.keys(val));
      // Update any currently rendered rows
      document.querySelectorAll(".dm-row[data-uid]").forEach(row => {
        const uid = row.dataset.uid;
        row.classList.toggle("is-online", ONLINE_UIDS.has(uid));
      });
    });
  } catch {}

  wireNewConvButton();

  if (openChatId && openToUid) {
    // Open thread directly
    await openThread(openChatId, openToUid);
  } else {
    renderInbox();
  }

  setupKeyboardAwareLayout();
});

// Keep the page pinned and resize body to the visible viewport when the
// on-screen keyboard opens — so focusing the textarea doesn't scroll the
// whole page up (header / top messages disappearing).
function setupKeyboardAwareLayout() {
  const vv = window.visualViewport;
  if (!vv) return;
  const isMobileLike = () =>
    window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 820;
  const footerEl = () => document.getElementById("dmFooter");
  const wrapEl = () => document.getElementById("threadWrap");
  // Tie keyboard detection to vv.height (the visual viewport shrinks when
  // iOS shows the keyboard) — much more reliable than focus events,
  // especially for PWAs launched from the home screen where focusin can
  // be swallowed.
  const apply = () => {
    const layoutH = window.innerHeight;
    const visualH = vv.height;
    const offsetTop = vv.offsetTop || 0;
    const kbHeight = Math.max(0, layoutH - visualH - offsetTop);
    const keyboardOpen = isMobileLike() && kbHeight > 0;
    document.body.classList.toggle("keyboard-open", keyboardOpen);
    // Shrink the body to the visible viewport when the keyboard is up.
    // The dm-footer is now a normal flex sibling (see dm.html), so the
    // column re-flows automatically and the footer lands on top of the
    // keyboard with zero positioning math — sidesteps the iOS PWA bug
    // where position:fixed elements get re-anchored behind keys.
    document.body.style.height = visualH + "px";
    document.body.style.minHeight = visualH + "px";
    if (offsetTop !== 0) window.scrollTo(0, 0);
  };
  vv.addEventListener("resize", apply);
  vv.addEventListener("scroll", apply);
  // iOS auto-scrolls the document up when an input is focused, even when
  // <body> has overflow:hidden. We avoid pinning <html> to position:fixed
  // because it breaks env(safe-area-inset-bottom). Instead, while a
  // text entry is focused, hard-revert any window scroll the OS tries.
  window.addEventListener("scroll", () => {
    if (!isTextEntryFocused()) return;
    if (window.scrollY !== 0 || window.scrollX !== 0) {
      window.scrollTo(0, 0);
    }
  }, { passive: true });
  function isTextEntryFocused() {
    const el = document.activeElement;
    return !!el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable);
  }
  // iOS PWA-from-home-screen sometimes swallows the first vv.resize tick,
  // so we also poll for ~1s after focus / blur. As soon as vv.height
  // settles we run apply once more and the footer lands on the correct
  // row before the user even types a character.
  let pollId = null;
  function pollVV() {
    if (pollId) clearInterval(pollId);
    let last = vv.height;
    let ticks = 0;
    pollId = setInterval(() => {
      ticks++;
      if (vv.height !== last) {
        last = vv.height;
        apply();
      }
      if (ticks >= 12) {
        clearInterval(pollId);
        pollId = null;
        apply();
      }
    }, 90);
  }
  document.addEventListener("focusin", () => {
    apply();
    setTimeout(apply, 50);
    setTimeout(apply, 180);
    setTimeout(apply, 360);
    pollVV();
    setTimeout(() => {
      const wrap = wrapEl();
      if (wrap && !wrap.classList.contains("hidden")) wrap.scrollTop = wrap.scrollHeight;
    }, 420);
  });
  document.addEventListener("focusout", () => {
    setTimeout(apply, 60);
    setTimeout(apply, 260);
    pollVV();
  });
  apply();
}

// =========================================================
// INBOX
// =========================================================
function renderInbox() {
  const list = document.getElementById("dmList");
  document.getElementById("threadWrap").classList.add("hidden");
  document.getElementById("dmFooter").classList.add("hidden");
  list.classList.remove("hidden");
  document.body.classList.remove("dm-thread-open");
  document.getElementById("dmHeaderInfo").innerHTML = `<div class="logo grad-text" style="font-size:18px;">Mensagens</div><div style="font-size:11px;color:var(--muted);">Conversas privadas</div>`;
  const newConvBtn = document.getElementById("dmNewConvBtn");
  if (newConvBtn) newConvBtn.style.display = "";

  if (inboxUnsub) inboxUnsub();

  // Avoid composite index: no orderBy here, sort client-side.
  const q = query(
    collection(db, "chats"),
    where("participants", "array-contains", CURRENT_USER.uid),
    limit(100)
  );
  inboxUnsub = onSnapshot(q, async (snap) => {
    if (snap.empty) {
      list.innerHTML = `
        <div class="empty" style="padding:60px 24px;text-align:center;">
          <div class="empty-emoji">💬</div>
          <div style="font-size:16px;font-weight:600;margin-top:6px;">Ainda sem conversas.</div>
          <div style="color:var(--muted);margin-top:6px;">Vai ao perfil de alguém e clica em "Mensagem" para começar.</div>
        </div>`;
      return;
    }
    // gather other participants and read their profiles
    const rows = [];
    for (const d of snap.docs) {
      const meta = d.data();
      meta.id = d.id;
      const otherUid = (meta.participants || []).find(u => u !== CURRENT_USER.uid);
      if (!otherUid) continue;
      rows.push({ meta, otherUid });
    }
    // Client-side sort by lastAt desc (newest first)
    rows.sort((a, b) => {
      const ta = a.meta.lastAt?.toMillis ? a.meta.lastAt.toMillis() : 0;
      const tb = b.meta.lastAt?.toMillis ? b.meta.lastAt.toMillis() : 0;
      return tb - ta;
    });
    // Fetch the user profiles in parallel (avoid duplicates)
    const uniqueUids = [...new Set(rows.map(r => r.otherUid))];
    const userDocs = await Promise.all(uniqueUids.map(u => getDoc(doc(db, "users", u))));
    const byUid = new Map();
    userDocs.forEach(s => { if (s.exists()) byUid.set(s.id, s.data()); });

    list.innerHTML = rows.map(({ meta, otherUid }) => {
      const u = byUid.get(otherUid) || { name: "User", username: "user", photoURL: "" };
      const unread = (meta["unread_" + CURRENT_USER.uid] || 0) > 0;
      const isOnline = ONLINE_UIDS.has(otherUid);
      return `
        <a href="./dm.html?c=${encodeURIComponent(meta.id)}&to=${encodeURIComponent(otherUid)}" class="dm-row ${unread ? "unread" : ""} ${isOnline ? "is-online" : ""}" data-uid="${escapeHTML(otherUid)}" data-ripple>
          <div class="dm-avatar-wrap">
            <div class="avatar">${avatarHTML(u, 46)}</div>
            <span class="dm-presence-dot" aria-hidden="true"></span>
          </div>
          <div class="content">
            <div class="name">${nameStyleHTML(u)}${adminBadgeHTML(u)}${modBadgeHTML(u)}</div>
            <div class="preview">${escapeHTML(meta.lastMessage || "")}</div>
          </div>
          <div class="when">${timeAgo(meta.lastAt)}</div>
        </a>
      `;
    }).join("");
  }, (err) => {
    console.error(err);
    list.innerHTML = `
      <div class="empty" style="padding:40px 24px;color:var(--muted);">
        <div style="font-size:14px;">Não foi possível carregar as conversas.</div>
        <div style="font-size:12px;color:var(--muted-2);margin-top:6px;word-break:break-word;">${escapeHTML(err.message)}</div>
      </div>`;
  });
}

// =========================================================
// THREAD
// =========================================================
async function openThread(chatId, otherUid) {
  if (inboxUnsub) { inboxUnsub(); inboxUnsub = null; }
  const list = document.getElementById("dmList");
  const wrap = document.getElementById("threadWrap");
  const footer = document.getElementById("dmFooter");
  list.classList.add("hidden");
  wrap.classList.remove("hidden");
  footer.classList.remove("hidden");
  document.body.classList.add("dm-thread-open");
  const newConvBtn = document.getElementById("dmNewConvBtn");
  if (newConvBtn) newConvBtn.style.display = "none";
  wrap.innerHTML = `<div class="empty" style="padding:30px 24px;text-align:center;"><span class="dots">A abrir</span></div>`;

  // Make sure the chat doc exists with both participants
  const chatRef = doc(db, "chats", chatId);
  const existing = await getDoc(chatRef);
  if (!existing.exists()) {
    await setDoc(chatRef, {
      participants: [CURRENT_USER.uid, otherUid].sort(),
      lastMessage: "",
      lastAt: serverTimestamp(),
      ["unread_" + CURRENT_USER.uid]: 0,
      ["unread_" + otherUid]: 0
    });
  } else {
    // reset my unread count
    await updateDoc(chatRef, { ["unread_" + CURRENT_USER.uid]: 0 }).catch(() => {});
  }

  // Header info (other user's profile)
  const otherSnap = await getDoc(doc(db, "users", otherUid));
  const other = otherSnap.exists() ? otherSnap.data() : { name: "User", username: "user" };
  document.getElementById("dmHeaderInfo").innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;">
      <div style="width:36px;height:36px;border-radius:50%;overflow:hidden;">${avatarHTML(other, 36)}</div>
      <div style="min-width:0;">
        <a href="./profile.html?u=${encodeURIComponent(other.username || "")}" style="font-weight:700;font-size:14px;display:flex;align-items:center;">
          ${nameStyleHTML(other)}${adminBadgeHTML(other)}${modBadgeHTML(other)}
        </a>
        <div style="font-size:11px;color:var(--muted);">@${escapeHTML(other.username || "")}</div>
      </div>
    </div>
  `;

  // Subscribe to messages
  if (currentThreadUnsub) currentThreadUnsub();
  const mq = query(collection(db, "chats", chatId, "messages"), orderBy("at", "asc"), limit(200));
  const seenMsgIds = new Set();
  let dmFirstLoad = true;
  currentThreadUnsub = onSnapshot(mq, (snap) => {
    if (snap.empty) {
      wrap.innerHTML = `<div class="empty" style="padding:40px 24px;text-align:center;color:var(--muted);"><div style="font-size:32px;">👋</div><div style="margin-top:6px;">Vomita-te todo.</div></div>`;
      return;
    }
    const html = [];
    let lastDay = "";
    const currentIds = [];
    snap.forEach(d => {
      const m = d.data();
      const ts = m.at?.toMillis ? m.at.toMillis() : 0;
      const day = ts ? new Date(ts).toLocaleDateString("pt-PT", { day: "numeric", month: "short" }) : "";
      if (day && day !== lastDay) {
        html.push(`<div style="text-align:center;font-size:11px;color:var(--muted-2);margin:12px 0 8px;"><span style="background:#141414;border:1px solid var(--border);padding:3px 10px;border-radius:999px;">${escapeHTML(day)}</span></div>`);
        lastDay = day;
      }
      const mine = m.uid === CURRENT_USER.uid;
      const isAdmin = !!CURRENT_PROFILE?.isAdmin;
      const canDelete = mine || isAdmin;
      const canEdit = mine || isAdmin;
      const isNew = !dmFirstLoad && !seenMsgIds.has(d.id);
      currentIds.push(d.id);
      const deleteBtn = canDelete
        ? `<button class="msg-delete-btn" data-del="${escapeHTML(d.id)}" aria-label="Apagar mensagem" title="Apagar">
             <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
           </button>`
        : "";
      const editBtn = canEdit
        ? `<button class="msg-edit-btn" data-edit="${escapeHTML(d.id)}" aria-label="Editar mensagem" title="Editar">
             <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
           </button>`
        : "";
      const editedTag = m.editedAt ? `<span class="msg-edited" title="editada">(editado)</span>` : "";
      html.push(`
        <div class="msg ${mine ? "mine" : ""} ${isNew ? "msg-new" : ""}" data-mid="${escapeHTML(d.id)}">
          <div class="msg-avatar">${mine ? avatarHTML(CURRENT_PROFILE, 32) : avatarHTML(other, 32)}</div>
          <div>
            <div class="msg-bubble"><span class="msg-text">${escapeHTML(m.text || "")}</span>${editBtn}${deleteBtn}</div>
            <div style="font-size:10px;color:var(--muted-2);margin-top:2px;${mine ? "text-align:right;" : ""}">${timeAgo(m.at)} ${editedTag}</div>
          </div>
        </div>
      `);
    });
    const wasAtBottom = !dmFirstLoad
      ? (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 80)
      : true;
    wrap.innerHTML = html.join("");
    // On first load OR when the user was already at the bottom, re-anchor
    // with retries to beat late-loading avatars/images and the dynamic
    // mobile viewport that often lands the user partway up the thread.
    if (dmFirstLoad || wasAtBottom) dmScrollToBottomReliably();
    currentIds.forEach(id => seenMsgIds.add(id));
    dmFirstLoad = false;
    // Wire delete handlers
    wrap.querySelectorAll("[data-del]").forEach(btn => {
      if (btn._bound) return;
      btn._bound = true;
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const mid = btn.dataset.del;
        if (!confirm("Apagar esta mensagem?")) return;
        try {
          await deleteDoc(doc(db, "chats", chatId, "messages", mid));
        } catch (err) {
          toast("Erro: " + err.message, "error");
        }
      });
    });
    // Wire edit handlers
    wrap.querySelectorAll("[data-edit]").forEach(btn => {
      if (btn._bound) return;
      btn._bound = true;
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const mid = btn.dataset.edit;
        const msgEl = btn.closest(".msg");
        const textEl = msgEl?.querySelector(".msg-text");
        if (!textEl) return;
        const current = textEl.textContent || "";
        const next = prompt("Editar mensagem:", current);
        if (next === null) return;
        const trimmed = next.trim();
        if (!trimmed || trimmed === current) return;
        try {
          await updateDoc(doc(db, "chats", chatId, "messages", mid), {
            text: trimmed,
            editedAt: serverTimestamp(),
            editedBy: CURRENT_USER.uid
          });
        } catch (err) {
          toast("Erro: " + err.message, "error");
        }
      });
    });
  }, (err) => {
    console.error(err);
    wrap.innerHTML = `<div class="empty" style="padding:30px;color:#fca5a5;">Erro: ${escapeHTML(err.message)}</div>`;
  });

  // Ensure scroll to bottom after load (robust across image/font loads)
  dmScrollToBottomReliably();

  // Input wiring
  const input = document.getElementById("dmInput");
  const sendBtn = document.getElementById("dmSendBtn");
  input.value = "";
  input.focus();
  const refreshSend = () => { sendBtn.disabled = !input.value.trim(); };
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(140, input.scrollHeight) + "px";
    refreshSend();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  sendBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    send();
  });

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = ""; refreshSend();
    input.style.height = "auto";
    tap();
    try {
      await addDoc(collection(db, "chats", chatId, "messages"), {
        uid: CURRENT_USER.uid,
        name: CURRENT_PROFILE.name,
        text,
        at: serverTimestamp()
      });
      await updateDoc(chatRef, {
        lastMessage: text.slice(0, 80),
        lastAt: serverTimestamp(),
        ["unread_" + otherUid]: (existing.exists() ? (existing.data()["unread_" + otherUid] || 0) : 0) + 1
      });
      // Always re-anchor to the bottom after we hit send. The render loop
      // only re-scrolls when wasAtBottom, but post-send we *want* the new
      // message in view even if the user had scrolled up to read history.
      dmScrollToBottomReliably();
    } catch (err) {
      toast("Erro ao enviar: " + err.message, "error");
    }
  }
}

// =========================================================
// NEW CONVERSATION PICKER
// Header button → opens a modal with a search bar + user list.
// Picking a user navigates to ./dm.html?c=<chatId>&to=<otherUid>
// =========================================================
function wireNewConvButton() {
  const btn = document.getElementById("dmNewConvBtn");
  if (!btn || btn._bound) return;
  btn._bound = true;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    tap();
    openNewConvPicker();
  });
}

async function openNewConvPicker() {
  const bodyHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <input
        id="dmPickSearch"
        class="input"
        placeholder="Pesquisar por nome ou @username…"
        autocomplete="off"
        autocapitalize="none"
        style="font-size:14px;padding:11px 14px;"
      />
      <div
        id="dmPickList"
        style="max-height:min(60vh, 460px);overflow-y:auto;margin:-6px -4px 0;padding:0 4px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;"
      >
        <div class="empty" style="padding:24px;text-align:center;color:var(--muted);">
          <span class="dots">A carregar utilizadores</span>
        </div>
      </div>
    </div>
  `;

  // We use modal() for the chrome (backdrop, animated slide-up), but we
  // hide its OK button since picking a user commits immediately.
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;inset:0;z-index:200;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(6px);";
  wrap.innerHTML = `
    <div style="width:100%;max-width:520px;background:#121212;border-top:1px solid var(--border);border-radius:22px 22px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom));animation:slideUp .28s cubic-bezier(.2,.8,.2,1);box-shadow:0 -20px 60px -10px rgba(0,0,0,.8);">
      <div style="width:36px;height:4px;border-radius:2px;background:#333;margin:0 auto 12px;"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 12px;">
        <h3 style="font-weight:700;font-size:17px;margin:0;letter-spacing:-.01em;">Nova conversa</h3>
        <button class="icon-btn tap" data-act="close" aria-label="Fechar" style="margin:-6px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      ${bodyHTML}
    </div>
    <style>@keyframes slideUp { from { transform: translateY(100%);} to { transform: translateY(0);} }</style>
  `;
  document.body.appendChild(wrap);

  const close = () => { wrap.remove(); };
  wrap.addEventListener("click", (ev) => {
    if (ev.target === wrap) close();
    const closeBtn = ev.target.closest && ev.target.closest('[data-act="close"]');
    if (closeBtn) close();
  });

  const searchEl = wrap.querySelector("#dmPickSearch");
  const listEl = wrap.querySelector("#dmPickList");

  // Load up to 300 users, skip self and blocked users.
  let users = [];
  try {
    const snap = await getDocs(query(collection(db, "users"), limit(300)));
    const blocked = new Set(CURRENT_PROFILE?.blocked || []);
    snap.forEach(d => {
      if (d.id === CURRENT_USER.uid) return;
      if (blocked.has(d.id)) return;
      const u = { uid: d.id, ...d.data() };
      // Hide banned accounts from normal users (admins still see them).
      if (u.banned && !CURRENT_PROFILE?.isAdmin) return;
      users.push(u);
    });
    // Sort: online first, then alphabetical by name.
    users.sort((a, b) => {
      const oa = ONLINE_UIDS.has(a.uid) ? 0 : 1;
      const ob = ONLINE_UIDS.has(b.uid) ? 0 : 1;
      if (oa !== ob) return oa - ob;
      const na = (a.name || a.username || "").toLowerCase();
      const nb = (b.name || b.username || "").toLowerCase();
      return na.localeCompare(nb);
    });
  } catch (err) {
    listEl.innerHTML = `<div class="empty" style="padding:24px;color:#fca5a5;">Erro a carregar utilizadores: ${escapeHTML(err.message)}</div>`;
    return;
  }

  const renderList = (filter) => {
    const f = (filter || "").trim().toLowerCase().replace(/^@/, "");
    const visible = !f ? users : users.filter(u => {
      const name = (u.name || "").toLowerCase();
      const uname = (u.username || "").toLowerCase();
      return name.includes(f) || uname.includes(f);
    });
    if (!visible.length) {
      listEl.innerHTML = `<div class="empty" style="padding:24px;text-align:center;color:var(--muted);">Sem resultados.</div>`;
      return;
    }
    listEl.innerHTML = visible.map(u => {
      const isOnline = ONLINE_UIDS.has(u.uid);
      return `
        <button type="button" class="dm-pick-row" data-uid="${escapeHTML(u.uid)}"
          style="display:flex;align-items:center;gap:12px;padding:10px 10px;width:100%;border-radius:12px;background:transparent;border:0;text-align:left;cursor:pointer;transition:background .15s;">
          <div style="position:relative;width:42px;height:42px;flex-shrink:0;">
            <div style="width:42px;height:42px;border-radius:50%;overflow:hidden;">${avatarHTML(u, 42)}</div>
            ${isOnline ? `<span style="position:absolute;right:-1px;bottom:-1px;width:11px;height:11px;border-radius:50%;background:#22c55e;border:2px solid #121212;box-shadow:0 0 8px rgba(34,197,94,.7);"></span>` : ""}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:14px;display:flex;align-items:center;gap:4px;">
              ${nameStyleHTML(u)}${adminBadgeHTML(u)}${modBadgeHTML(u)}
            </div>
            <div style="font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">@${escapeHTML(u.username || "")}</div>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--muted-2);flex-shrink:0;"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      `;
    }).join("");
    // hover state via inline handlers
    listEl.querySelectorAll(".dm-pick-row").forEach(row => {
      row.addEventListener("mouseenter", () => { row.style.background = "#1a1a1a"; });
      row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
      row.addEventListener("click", () => {
        const otherUid = row.dataset.uid;
        const chatId = buildDmChatId(CURRENT_USER.uid, otherUid);
        close();
        // Navigate rather than calling openThread() directly, so reload /
        // back-button behaviour matches the existing dm row click path.
        location.href = `./dm.html?c=${encodeURIComponent(chatId)}&to=${encodeURIComponent(otherUid)}`;
      });
    });
  };

  renderList("");
  searchEl.addEventListener("input", () => renderList(searchEl.value));
  // Auto-focus, but give the slide-up animation a beat so mobile doesn't
  // abort the animation by yanking the viewport for the keyboard.
  setTimeout(() => { try { searchEl.focus(); } catch {} }, 280);
}
