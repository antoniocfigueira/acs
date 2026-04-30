// =========================================================
// Alfa Club Social — Global Chat (Firebase Realtime Database)
// =========================================================
import { rtdb, db } from "./firebase-config.js";
import {
  ref, push, onChildAdded, onChildRemoved, onChildChanged, onValue, query as rtQuery,
  limitToLast, serverTimestamp as rtServerTimestamp,
  onDisconnect, set, remove, update
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  collection, addDoc, onSnapshot, orderBy, query as fsQuery,
  serverTimestamp as fsServerTimestamp, deleteDoc, doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { requireAuth } from "./auth.js";
import { avatarHTML, escapeHTML, timeAgo, toast, tap, wireHeaderNotifButton, wireDmNotifButton, uploadMedia, modal, nameStyleHTML, modBadgeHTML, adminBadgeHTML, maybePromptForNotifs } from "./app.js";
import { bootGames, attachGameView, GAME_TYPES } from "./games.js";

import "./sw-register.js";

let ME = null;      // firebase user
let PROFILE = null; // firestore profile
let unsubscribers = [];
window.__alfaPageScope?.addCleanup(() => {
  for (const u of unsubscribers) try { u(); } catch {}
  unsubscribers = [];
});

const chatWrap = document.getElementById("chatWrap");
const input = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const onlineCount = document.getElementById("onlineCount");

requireAuth((user, profile) => {
  ME = user;
  PROFILE = profile;
  wireHeaderNotifButton(user);
  wireDmNotifButton(user);
  maybePromptForNotifs();
  bootChat();
  bootPresence();
  bootStickers();
  bootGames({ me: user, profile, onlineUsersRef: () => ONLINE_USERS });
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
  // Source of truth for "is the on-screen keyboard up": the visual viewport
  // shrinks by the keyboard's height the moment iOS shows it. Tying our
  // logic to vv.height (instead of focus events) makes the trigger reliable
  // even when iOS swallows focusin/focusout (a known PWA-from-home-screen
  // quirk).
  const apply = () => {
    const layoutH = window.innerHeight;
    const visualH = vv.height;
    const offsetTop = vv.offsetTop || 0;
    const kbHeight = Math.max(0, layoutH - visualH - offsetTop);
    const keyboardOpen = isMobileLike() && kbHeight > 0;
    document.body.classList.toggle("keyboard-open", keyboardOpen);
    // Shrink the body to the visible viewport when the keyboard is up.
    // The chat-footer is now a normal flex sibling (see chat.html), so
    // the column re-flows automatically and the footer lands on top of
    // the keyboard with zero positioning math — sidesteps the iOS PWA
    // bug where position:fixed elements get re-anchored behind keys.
    document.body.style.height = visualH + "px";
    document.body.style.minHeight = visualH + "px";
    if (offsetTop !== 0) window.scrollTo(0, 0);
  };
  vv.addEventListener("resize", apply);
  vv.addEventListener("scroll", apply);
  // iOS auto-scrolls the document up when an input is focused, even when
  // <body> has overflow:hidden. Pinning <html> to position:fixed used to
  // prevent that, but it broke env(safe-area-inset-bottom) (the bottom-nav
  // ended up not covering the home indicator). Instead, while a text
  // entry is focused we hard-revert any window scroll the OS tries to
  // do. The listener is `passive: true` so it doesn't block touch.
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
        apply(); // final settle
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
      if (chatWrap) chatWrap.scrollTop = chatWrap.scrollHeight;
    }, 420);
  });
  document.addEventListener("focusout", () => {
    setTimeout(apply, 60);
    setTimeout(apply, 260);
    pollVV();
  });
  apply();
}

function bootChat() {
  const messagesRef = rtQuery(ref(rtdb, "chat/messages"), limitToLast(1000));
  let firstLoadDone = false;
  const pending = [];
  chatWrap.innerHTML = "";

  let lastDayKey = "";
  unsubscribers.push(onChildAdded(messagesRef, (snap) => {
    const m = snap.val();
    if (!m) return;
    const wasAtBottom = isAtBottom();
    const time = m.at || Date.now();
    const dayKey = new Date(time).toDateString();
    if (dayKey !== lastDayKey) {
      lastDayKey = dayKey;
      chatWrap.insertAdjacentHTML("beforeend", dayDivider(time));
    }
    chatWrap.insertAdjacentHTML("beforeend", renderMsg(m, snap.key));
    bindDeleteHandler(snap.key);
    // If this was a game message, attach the live game view
    if (m.type === "game" && m.gameId) {
      const host = chatWrap.querySelector(`.msg[data-key="${snap.key}"] .game-host`);
      if (host) attachGameView(host, m.gameId);
    }
    if (firstLoadDone && wasAtBottom) scrollToBottom();
    if (!firstLoadDone) pending.push(true);
  }));

  // Remove deleted messages from the DOM
  unsubscribers.push(onChildRemoved(messagesRef, (snap) => {
    const el = chatWrap.querySelector(`.msg[data-key="${snap.key}"]`);
    if (el) {
      el.style.transition = "opacity .25s, transform .25s";
      el.style.opacity = "0";
      el.style.transform = "translateX(-30px)";
      setTimeout(() => el.remove(), 250);
    }
  }));

  // Update edited messages in place (god-mode edits from any admin)
  unsubscribers.push(onChildChanged(messagesRef, (snap) => {
    const m = snap.val();
    if (!m) return;
    const el = chatWrap.querySelector(`.msg[data-key="${snap.key}"]`);
    if (!el) return;
    // Replace just the text + edited tag, keep layout stable
    const textEl = el.querySelector(".msg-text");
    if (textEl && typeof m.text === "string") textEl.textContent = m.text;
    const metaEl = el.querySelector(".msg-meta");
    if (metaEl && m.editedAt && !metaEl.querySelector(".msg-edited")) {
      metaEl.insertAdjacentHTML("beforeend", ` <span class="msg-edited" title="editada">(editado)</span>`);
    }
  }));

  // After 300ms, assume initial load completed (no great other way without a query once)
  unsubscribers.push(onValue(messagesRef, () => {
    if (!firstLoadDone) {
      firstLoadDone = true;
      scrollToBottomReliably();
    }
  }, { onlyOnce: true }));

  // Input handling
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(140, input.scrollHeight) + "px";
    sendBtn.disabled = !input.value.trim();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });
  sendBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    sendMessage();
  });
  // Ensure scroll to bottom after load (even if onValue fired before this ran)
  scrollToBottomReliably();
}

function renderMsg(m, key) {
  const mine = m.uid === ME.uid;
  const isAdmin = !!PROFILE?.isAdmin;
  const isMod = PROFILE?.role === "mod";
  const canDelete = mine || isAdmin || isMod;
  // God-mode: admins/mods can edit anyone's text messages. Non-admins only own.
  const canEdit = (mine || isAdmin) && (!m.type || m.type === "text");
  const timeStr = new Date(m.at || Date.now()).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  const deleteBtn = canDelete
    ? `<button class="msg-delete-btn" data-del="${key}" aria-label="Apagar mensagem" title="Apagar">
         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
       </button>`
    : "";
  const editBtn = canEdit
    ? `<button class="msg-edit-btn" data-edit="${key}" aria-label="Editar mensagem" title="Editar">
         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
       </button>`
    : "";
  const editedTag = m.editedAt ? `<span class="msg-edited" title="editada">(editado)</span>` : "";

  const authorBadges = adminBadgeHTML({ isAdmin: !!m.isAdmin }) + modBadgeHTML({ role: m.role });
  const nameHTML = nameStyleHTML({ name: m.name || "Anónimo", nameColor: m.nameColor, nameStyle: m.nameStyle }) + authorBadges;

  // Game message (inline mini-game)
  if (m.type === "game" && m.gameId) {
    const gMeta = GAME_TYPES[m.gameType] || { name: m.gameType, emoji: "🎮" };
    return `
      <div class="msg game-msg ${mine ? "mine" : ""}" data-key="${key}">
        <a href="./profile.html?u=${encodeURIComponent(m.username || "")}" class="msg-avatar">${avatarHTML({ photoURL: m.photoURL, name: m.name, username: m.username }, 34)}</a>
        <div class="msg-body">
          <div class="msg-meta">${nameHTML} 🎮 iniciou um jogo · ${timeStr}</div>
          <div class="game-host" data-game-id="${escapeHTML(m.gameId)}">
            <div class="game-card game-loading">${gMeta.icon || "🎮"} A carregar <strong>${escapeHTML(gMeta.name || "jogo")}</strong>…</div>
          </div>
          ${deleteBtn}
        </div>
      </div>
    `;
  }

  // Sticker message
  if (m.type === "sticker" && m.stickerUrl) {
    return `
      <div class="msg ${mine ? "mine" : ""} sticker-wrap" data-key="${key}">
        <a href="./profile.html?u=${encodeURIComponent(m.username || "")}" class="msg-avatar">${avatarHTML({ photoURL: m.photoURL, name: m.name, username: m.username }, 34)}</a>
        <div class="msg-body">
          <div class="msg-meta">${nameHTML} · ${timeStr}</div>
          <div class="msg-bubble sticker-msg" style="background:transparent;border:0;padding:0;box-shadow:none;">
            <img src="${escapeHTML(m.stickerUrl)}" alt="sticker" style="display:block;width:120px;height:120px;object-fit:contain;" />
            ${deleteBtn}
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="msg ${mine ? "mine" : ""}" data-key="${key}">
      <a href="./profile.html?u=${encodeURIComponent(m.username || "")}" class="msg-avatar">${avatarHTML({ photoURL: m.photoURL, name: m.name, username: m.username }, 34)}</a>
      <div class="msg-body">
        <div class="msg-meta">${nameHTML} · ${timeStr} ${editedTag}</div>
        <div class="msg-bubble">
          <div class="msg-text">${escapeHTML(m.text || "")}</div>
          ${editBtn}${deleteBtn}
        </div>
      </div>
    </div>
  `;
}

function bindDeleteHandler(key) {
  const btn = chatWrap.querySelector(`[data-del="${key}"]`);
  if (btn && !btn._bound) {
    btn._bound = true;
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!confirm("Apagar esta mensagem?")) return;
      try {
        await remove(ref(rtdb, "chat/messages/" + key));
      } catch (err) {
        toast("Erro: " + err.message, "error");
      }
    });
  }
  const editBtn = chatWrap.querySelector(`[data-edit="${key}"]`);
  if (editBtn && !editBtn._bound) {
    editBtn._bound = true;
    editBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const msgEl = editBtn.closest(".msg");
      const textEl = msgEl?.querySelector(".msg-text");
      if (!textEl) return;
      const current = textEl.textContent || "";
      const next = prompt("Editar mensagem:", current);
      if (next === null) return;
      const trimmed = next.trim();
      if (!trimmed || trimmed === current) return;
      try {
        await update(ref(rtdb, "chat/messages/" + key), {
          text: trimmed,
          editedAt: Date.now(),
          editedBy: ME.uid
        });
      } catch (err) {
        toast("Erro: " + err.message, "error");
      }
    });
  }
}

function dayDivider(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  let label;
  if (d.toDateString() === today.toDateString()) label = "Hoje";
  else if (d.toDateString() === yesterday.toDateString()) label = "Ontem";
  else label = d.toLocaleDateString("pt-PT", { day: "numeric", month: "long" });
  return `<div class="day-divider"><span>${label}</span></div>`;
}

function isAtBottom() {
  return chatWrap.scrollHeight - chatWrap.scrollTop - chatWrap.clientHeight < 80;
}
function scrollToBottom() {
  chatWrap.scrollTop = chatWrap.scrollHeight + 9999;
}
// Reliable scroll-to-bottom: repeats across several frames to account for
// late-loading images, font swaps, and the dynamic mobile viewport. Also
// re-scrolls when images inside the wrapper finish loading.
let _scrollBottomPassCount = 0;
function scrollToBottomReliably() {
  _scrollBottomPassCount++;
  const myPass = _scrollBottomPassCount;
  const tries = [0, 50, 150, 300, 600, 1200];
  tries.forEach((ms) => {
    setTimeout(() => {
      // If another newer "anchor to bottom" was scheduled, stop.
      if (myPass !== _scrollBottomPassCount) return;
      chatWrap.scrollTop = chatWrap.scrollHeight + 9999;
      const last = chatWrap.lastElementChild;
      if (last && last.scrollIntoView) {
        try { last.scrollIntoView({ block: "end", behavior: "auto" }); } catch {}
      }
    }, ms);
  });
  // Re-scroll when any image in the current view finishes loading.
  try {
    const imgs = chatWrap.querySelectorAll("img");
    imgs.forEach((img) => {
      if (img.complete || img._bottomBound) return;
      img._bottomBound = true;
      img.addEventListener("load", () => {
        if (isAtBottom()) chatWrap.scrollTop = chatWrap.scrollHeight + 9999;
      }, { once: true });
    });
  } catch {}
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;
  tap();
  sendBtn.disabled = true;
  try {
    await push(ref(rtdb, "chat/messages"), {
      uid: ME.uid,
      name: PROFILE.name,
      username: PROFILE.username,
      photoURL: PROFILE.photoURL || "",
      isAdmin: !!PROFILE.isAdmin,
      role: PROFILE.role || "user",
      nameColor: PROFILE.nameColor || "",
      nameStyle: PROFILE.nameStyle || "",
      text: text.slice(0, 500),
      at: Date.now()
    });
    input.value = "";
    input.style.height = "auto";
    // Always re-anchor to the bottom after the user hits send, regardless of
    // their current scroll position. The onChildAdded listener only scrolls
    // when wasAtBottom — but after a send we *want* the new message to come
    // into view even if the user had scrolled up to read history.
    scrollToBottomReliably();
  } catch (err) {
    toast("Erro: " + err.message, "error");
  } finally {
    sendBtn.disabled = !input.value.trim();
    input.focus();
  }
}

async function sendSticker(stickerUrl) {
  try {
    await push(ref(rtdb, "chat/messages"), {
      uid: ME.uid,
      name: PROFILE.name,
      username: PROFILE.username,
      photoURL: PROFILE.photoURL || "",
      isAdmin: !!PROFILE.isAdmin,
      role: PROFILE.role || "user",
      nameColor: PROFILE.nameColor || "",
      nameStyle: PROFILE.nameStyle || "",
      type: "sticker",
      stickerUrl,
      at: Date.now()
    });
  } catch (err) {
    toast("Erro: " + err.message, "error");
  }
}

// ─── Stickers ──────────────────────────────────────
let LOADED_STICKERS = [];
function bootStickers() {
  // Insert sticker button before send button
  const footer = document.querySelector(".chat-footer");
  if (!footer || document.getElementById("stickerBtn")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "stickerBtn";
  btn.className = "chat-sticker-btn tap";
  btn.setAttribute("aria-label", "Stickers");
  btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 14.5L14.5 21M21 14.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9.5"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M9 15c1 1 4 1 6 0"/></svg>`;
  btn.style.cssText = "width:42px;height:42px;border-radius:50%;background:#1a1a1a;border:1px solid var(--border);display:grid;place-items:center;color:var(--text);";
  footer.insertBefore(btn, sendBtn);

  btn.addEventListener("click", openStickerPicker);

  // subscribe to stickers collection
  try {
    const q = fsQuery(collection(db, "stickers"), orderBy("createdAt", "desc"));
    unsubscribers.push(onSnapshot(q, (snap) => {
      LOADED_STICKERS = [];
      snap.forEach(d => { const s = d.data(); s.id = d.id; LOADED_STICKERS.push(s); });
  }));
  } catch (e) { console.warn("stickers subscribe:", e); }
}

function openStickerPicker() {
  const isAdmin = !!PROFILE?.isAdmin;
  const stickerList = LOADED_STICKERS.length
    ? LOADED_STICKERS.map(s => {
        const mine = s.uploadedBy === ME.uid;
        const canDelete = isAdmin || mine;
        return `<button type="button" class="sticker-pick" data-url="${escapeHTML(s.url)}" data-id="${escapeHTML(s.id)}" style="background:transparent;border:1px solid var(--border);border-radius:12px;padding:4px;cursor:pointer;position:relative;">
         <img src="${escapeHTML(s.url)}" alt="" style="width:80px;height:80px;object-fit:contain;display:block;" />
         ${canDelete ? `<span class="sticker-del" data-del-sticker="${escapeHTML(s.id)}" style="position:absolute;top:2px;right:2px;background:rgba(239,68,68,.8);color:white;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:12px;line-height:1;">×</span>` : ""}
       </button>`;
      }).join("")
    : `<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:20px;">Sem stickers. Sê o primeiro a carregar um!</div>`;

  // Upload is now open to every user
  const uploadSection = `<div style="border-top:1px solid var(--border);padding-top:12px;margin-top:12px;">
         <input type="file" id="stickerUpload" accept="image/*" style="display:none;" />
         <button type="button" id="stickerUploadBtn" class="btn-primary" style="width:100%;padding:10px;font-size:13px;">+ Carregar sticker</button>
         <div id="stickerUploadProgress" style="display:none;height:4px;background:#1a1a1a;border-radius:2px;overflow:hidden;margin-top:8px;"><div id="stickerUploadBar" style="width:0%;height:100%;background:var(--grad);"></div></div>
       </div>`;
  const adminSection = uploadSection;

  modal({
    title: "Stickers",
    bodyHTML: `
      <div class="sticker-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px;max-height:300px;overflow-y:auto;">
        ${stickerList}
      </div>
      ${adminSection}
    `,
    confirmLabel: "Fechar",
    onOpen: (root, wrap) => {
      // Send sticker on click
      root.querySelectorAll(".sticker-pick").forEach(b => {
        b.addEventListener("click", (e) => {
          if (e.target.closest(".sticker-del")) return;
          const url = b.dataset.url;
          sendSticker(url);
          wrap.remove();
        });
      });
      // Admin: delete sticker
      root.querySelectorAll("[data-del-sticker]").forEach(b => {
        b.addEventListener("click", async (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (!confirm("Apagar sticker?")) return;
          try {
            await deleteDoc(doc(db, "stickers", b.dataset.delSticker));
            toast("Sticker apagado", "success");
            b.closest(".sticker-pick").remove();
          } catch (err) { toast("Erro: " + err.message, "error"); }
        });
      });
      // Upload (all users)
      {
        const btn = root.querySelector("#stickerUploadBtn");
        const fileInput = root.querySelector("#stickerUpload");
        const prog = root.querySelector("#stickerUploadProgress");
        const bar = root.querySelector("#stickerUploadBar");
        btn?.addEventListener("click", () => fileInput.click());
        fileInput?.addEventListener("change", async () => {
          const f = fileInput.files?.[0];
          if (!f) return;
          if (!f.type.startsWith("image/")) { toast("Só imagens!", "error"); return; }
          btn.disabled = true;
          btn.textContent = "A enviar...";
          prog.style.display = "block";
          try {
            const up = await uploadMedia(f, (pct) => { bar.style.width = Math.round(pct * 100) + "%"; });
            await addDoc(collection(db, "stickers"), {
              url: up.url,
              uploadedBy: ME.uid,
              uploadedByName: PROFILE.name || "",
              createdAt: fsServerTimestamp()
            });
            toast("Sticker adicionado!", "success");
            wrap.remove();
            openStickerPicker(); // reopen with new sticker
          } catch (err) {
            toast("Erro: " + err.message, "error");
            btn.disabled = false;
            btn.textContent = "+ Carregar sticker";
            prog.style.display = "none";
          }
        });
      }
    }
  });
}

// ─── Presence ──────────────────────────────────────
let ONLINE_USERS = {};

function bootPresence() {
  const connectedRef = ref(rtdb, ".info/connected");
  const myStatusRef = ref(rtdb, "presence/" + ME.uid);
  const presenceRef = ref(rtdb, "presence");

  unsubscribers.push(onValue(connectedRef, (snap) => {
    if (snap.val() === true) {
      onDisconnect(myStatusRef).remove().then(() => {
        set(myStatusRef, {
          name: PROFILE.name,
          username: PROFILE.username,
          photoURL: PROFILE.photoURL || "",
          online: true,
          lastSeen: Date.now()
        });
      });
    }
  }));

  unsubscribers.push(onValue(presenceRef, (snap) => {
    const val = snap.val() || {};
    ONLINE_USERS = val;
    const n = Object.keys(val).length;
    onlineCount.textContent = n === 1 ? "1 online" : n + " online";
  }));

  window.addEventListener("beforeunload", () => {
    try { remove(myStatusRef); } catch {}
  });

  // Wire the new "online users" button in the header
  const onlineBtn = document.getElementById("onlineUsersBtn");
  onlineBtn?.addEventListener("click", showOnlineUsers);
}

function showOnlineUsers() {
  const users = Object.entries(ONLINE_USERS || {});
  const rows = users.length
    ? users.map(([uid, u]) => `
        <a class="user-row" href="./profile.html?u=${encodeURIComponent(u.username || "")}">
          ${avatarHTML({ photoURL: u.photoURL, name: u.name, username: u.username }, 34)}
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:13px;">${escapeHTML(u.name || "—")}</div>
            <div style="color:var(--muted);font-size:11px;">@${escapeHTML(u.username || "")}</div>
          </div>
          <span class="dm-online-dot" title="Online"></span>
        </a>
      `).join("")
    : `<div class="empty" style="padding:14px;">Ninguém online de momento.</div>`;

  modal({
    title: `Online agora (${users.length})`,
    bodyHTML: `<div class="online-users-list">${rows}</div>`,
    confirmLabel: "Fechar"
  });
}
