import { registerMessagingSW, auth as _appAuth } from "./firebase-config.js";

let _fcmSetupPromise = null;
let _fcmOnMessageAttached = false;

// =========================================================
// Alfa Club Social — Shared utilities
// =========================================================

// Toast ───────────────────────────────────────────────
let _toastTimer;
export function toast(message, type = "") {
  let el = document.getElementById("_toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "_toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.className = "toast " + type;
  el.textContent = message;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

// Time ago ───────────────────────────────────────────
export function timeAgo(date) {
  if (!date) return "";
  const ts = date?.toMillis ? date.toMillis() : date?.seconds ? date.seconds * 1000 : +date;
  if (!ts || Number.isNaN(ts)) return "";
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.floor(diff / 1000);
  if (s < 60) return "agora";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  const d = Math.floor(h / 24);
  if (d < 7) return d + "d";
  const w = Math.floor(d / 7);
  if (w < 4) return w + "sem";
  return new Date(ts).toLocaleDateString("pt-PT", { day: "numeric", month: "short" });
}

// Avatar: image if available, otherwise initials with gradient bg ─────
export function avatarHTML({ photoURL, name, username }, size = 38) {
  const initials = (name || username || "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  if (photoURL) {
    return `<img src="${escapeAttr(photoURL)}" alt="${escapeAttr(name || username)}" loading="lazy" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;" />`;
  }
  return `<div class="avatar-fallback" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px;">${escapeHTML(initials)}</div>`;
}

export function escapeHTML(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
export function escapeAttr(s) { return escapeHTML(s); }

// Admin badge (star) — rendered next to name when user is admin
const ADMIN_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l2.39 5.46L20 8.27l-4.19 3.94L17.03 18 12 15.27 6.97 18l1.22-5.79L4 8.27l5.61-.81L12 2z"/></svg>`;
export function adminBadgeHTML(userLike) {
  if (!userLike?.isAdmin) return "";
  return `<span class="admin-badge role-badge" role="button" tabindex="0" data-role-info="admin" title="Admin">${ADMIN_SVG}</span>`;
}
export function adminPillHTML(userLike) {
  if (!userLike?.isAdmin) return "";
  return `<span class="admin-pill role-badge" role="button" tabindex="0" data-role-info="admin">${ADMIN_SVG} Admin</span>`;
}

// Global delegated listener — show a nice info popup when a user taps
// an admin or mod badge anywhere on the site. Installed once.
if (typeof document !== "undefined" && !window.__roleBadgeInfoWired) {
  window.__roleBadgeInfoWired = true;
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-role-info]");
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const role = el.dataset.roleInfo;
    const isAdmin = role === "admin";
    const title = isAdmin ? "Administrador" : "Moderador";
    const msg = isAdmin
      ? "Este usuário tem acesso de Administrador"
      : "Este usuário tem acesso de Moderador";
    const icon = isAdmin
      ? `<svg width="30" height="30" viewBox="0 0 24 24" fill="url(#gradStroke)" stroke="none"><path d="M12 2l2.39 5.46L20 8.27l-4.19 3.94L17.03 18 12 15.27 6.97 18l1.22-5.79L4 8.27l5.61-.81L12 2z"/></svg>`
      : `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="url(#gradStroke)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></svg>`;
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.68);backdrop-filter:blur(8px);animation:fadeIn .18s ease;";
    wrap.innerHTML = `
      <div style="background:#121212;border:1px solid var(--border);border-radius:18px;padding:24px 22px 18px;width:min(92vw,360px);box-shadow:0 24px 60px -10px rgba(0,0,0,.7);animation:popIn .26s cubic-bezier(.2,.8,.2,1);text-align:center;">
        <div style="display:grid;place-items:center;width:56px;height:56px;border-radius:50%;background:rgba(139,92,246,.12);border:1px solid rgba(139,92,246,.28);margin:0 auto 10px;">${icon}</div>
        <h3 style="margin:0 0 4px;font-size:17px;font-weight:700;letter-spacing:-.01em;">${title}</h3>
        <p style="margin:0;color:var(--muted);font-size:14px;line-height:1.4;">${msg}</p>
        <button type="button" data-close style="margin-top:16px;width:100%;padding:11px;border-radius:12px;background:var(--grad);color:white;font-weight:600;font-size:14px;box-shadow:0 8px 22px -6px rgba(236,72,153,.5);">Fechar</button>
      </div>
      <style>@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes popIn{from{opacity:0;transform:scale(.9) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}</style>
    `;
    document.body.appendChild(wrap);
    const closeIt = () => { try { wrap.remove(); } catch {} };
    wrap.addEventListener("click", (ev) => {
      if (ev.target === wrap || ev.target.closest("[data-close]")) closeIt();
    });
  }, true);
}

// Build a canonical DM chat id from two uids (sorted, joined by "_")
export function buildDmChatId(a, b) {
  if (!a || !b) return "";
  return [a, b].sort().join("_");
}

// Drawer ─────────────────────────────────────────────────
// Locks scroll on body+html and blocks touchmove outside the drawer so the
// feed behind cannot be interacted with while the drawer is open. A
// MutationObserver watches `#drawer.open` so this works no matter WHO opens
// the drawer (the hamburger button, openNotifsPanel, shop CTAs, etc.) —
// previously several places were toggling the .open class directly and
// bypassing the lock.
export function initDrawer() {
  const drawer = document.getElementById("drawer");
  const backdrop = document.getElementById("drawerBackdrop");
  const openBtn = document.getElementById("openDrawerBtn");
  const closeBtn = document.getElementById("closeDrawerBtn");
  if (!drawer) return;

  let savedScrollY = 0;
  let locked = false;
  let touchStartY = 0;

  // Track touchstart so blockTouch can tell swipe direction and stop
  // overscroll-chaining from a sub-panel at its boundary.
  const onTouchStart = (e) => {
    const t = e.touches && e.touches[0];
    touchStartY = t ? t.clientY : 0;
  };
  // Prevent any touch outside the drawer from scrolling the feed behind.
  // For touches INSIDE the drawer, allow scroll — except when the scrollable
  // sub-panel is already at its top or bottom edge and the user continues to
  // swipe in that direction (classic iOS/Android scroll-chain).
  const blockTouch = (e) => {
    const target = e.target;
    const drawerEl = target.closest && target.closest("#drawer");
    if (!drawerEl) { e.preventDefault(); return; }
    // Find the nearest scrollable ancestor inside the drawer.
    const scroller = target.closest && target.closest(".sub-panel, #drawer");
    if (!scroller) { e.preventDefault(); return; }
    const t = e.touches && e.touches[0];
    if (!t) return;
    const deltaY = t.clientY - touchStartY;
    const atTop = scroller.scrollTop <= 0;
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    // swipe-down at top OR swipe-up at bottom → would chain to body. Block.
    if ((deltaY > 0 && atTop) || (deltaY < 0 && atBottom)) {
      e.preventDefault();
    }
  };
  // Block wheel (trackpad / mouse) on desktop too.
  const blockWheel = (e) => {
    if (e.target.closest("#drawer")) return;
    e.preventDefault();
  };
  // Block keyboard scroll keys.
  const blockKeys = (e) => {
    if (!["ArrowUp","ArrowDown","PageUp","PageDown","Home","End","Space"," "].includes(e.key)) return;
    if (e.target.closest("#drawer")) return;
    if (e.target.matches("input, textarea, select, [contenteditable='true']")) return;
    e.preventDefault();
  };

  const lock = () => {
    if (locked) return;
    locked = true;
    savedScrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
    // Ensure backdrop class is in sync
    backdrop?.classList.add("open");
    document.body.classList.add("drawer-open");
    document.documentElement.classList.add("drawer-open");
    // Pin the body — this is the most reliable scroll lock on mobile.
    document.body.style.position = "fixed";
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    document.addEventListener("touchmove", blockTouch, { passive: false, capture: true });
    document.addEventListener("wheel", blockWheel, { passive: false, capture: true });
    document.addEventListener("keydown", blockKeys, { capture: true });
  };

  const unlock = () => {
    if (!locked) return;
    locked = false;
    backdrop?.classList.remove("open");
    document.body.classList.remove("drawer-open");
    document.documentElement.classList.remove("drawer-open");
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
    document.removeEventListener("touchstart", onTouchStart, { capture: true });
    document.removeEventListener("touchmove", blockTouch, { capture: true });
    document.removeEventListener("wheel", blockWheel, { capture: true });
    document.removeEventListener("keydown", blockKeys, { capture: true });
    window.scrollTo(0, savedScrollY);
  };

  // React to ANY caller adding/removing the .open class on #drawer.
  const applyState = () => {
    if (drawer.classList.contains("open")) lock(); else unlock();
  };
  const mo = new MutationObserver(applyState);
  mo.observe(drawer, { attributes: true, attributeFilter: ["class"] });
  // Run once for initial state
  applyState();

  const open  = () => { drawer.classList.add("open"); };
  const close = () => { drawer.classList.remove("open"); };

  openBtn?.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  backdrop?.addEventListener("click", close);

  // Escape key closes the drawer
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer.classList.contains("open")) close();
  });

  return { open, close };
}

// Modal (simple) ─────────────────────────────────────
export function modal({ title, bodyHTML, confirmLabel = "OK", onConfirm, onOpen }) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;inset:0;z-index:200;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(6px);";
  wrap.innerHTML = `
    <div style="width:100%;max-width:520px;background:#121212;border-top:1px solid var(--border);border-radius:22px 22px 0 0;padding:22px 20px calc(22px + env(safe-area-inset-bottom));animation:slideUp .3s cubic-bezier(.2,.8,.2,1);box-shadow:0 -20px 60px -10px rgba(0,0,0,.8);">
      <div style="width:36px;height:4px;border-radius:2px;background:#333;margin:0 auto 14px;"></div>
      <h3 style="font-weight:700;font-size:18px;margin:0 0 12px;letter-spacing:-.01em;">${escapeHTML(title)}</h3>
      <div class="modal-body">${bodyHTML || ""}</div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button class="btn-ghost" style="flex:1;" data-act="cancel">Cancelar</button>
        <button class="btn-primary" style="flex:1;" data-act="ok">${escapeHTML(confirmLabel)}</button>
      </div>
    </div>
    <style>@keyframes slideUp { from { transform: translateY(100%);} to { transform: translateY(0);} }</style>
  `;
  document.body.appendChild(wrap);
  if (onOpen) {
    try { onOpen(wrap.querySelector(".modal-body"), wrap); } catch (e) { console.warn("modal onOpen:", e); }
  }
  return new Promise((resolve) => {
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap || e.target.dataset.act === "cancel") {
        wrap.remove();
        resolve(null);
      } else if (e.target.dataset.act === "ok") {
        const body = wrap.querySelector(".modal-body");
        const r = onConfirm ? onConfirm(body) : true;
        Promise.resolve(r).then(result => {
          wrap.remove();
          resolve(result);
        }).catch(err => {
          toast(err.message || "Erro", "error");
        });
      }
    });
  });
}

// Tap haptics (soft) ─────────────────────────────────
export function tap() {
  if (navigator.vibrate) navigator.vibrate(8);
}

// Helper: animate number change
export function animateCount(el, to) {
  const from = parseInt(el.textContent || "0", 10) || 0;
  const diff = to - from;
  if (diff === 0) return;
  const steps = 12;
  let i = 0;
  const id = setInterval(() => {
    i++;
    el.textContent = Math.round(from + (diff * i) / steps);
    if (i >= steps) clearInterval(id);
  }, 25);
}

// =========================================================
// Media upload — Cloudinary (no payment needed, unsigned)
// =========================================================
// The user can set CLOUDINARY config in firebase-config.js (cloudName + unsignedPreset)
// or leave it empty to allow URL-only attach via a prompt.
export async function uploadMedia(file, onProgress) {
  if (!file) return null;
  // Type sanity
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  if (!isImage && !isVideo) throw new Error("Só podes enviar imagens ou vídeos.");

  // Size limits (Cloudinary free: 10MB images, 100MB videos)
  const MAX_IMG = 10 * 1024 * 1024;
  const MAX_VID = 100 * 1024 * 1024;
  if (isImage && file.size > MAX_IMG) throw new Error("Imagem maior que 10MB.");
  if (isVideo && file.size > MAX_VID) throw new Error("Vídeo maior que 100MB.");

  // Lazy import so the page doesn't fail if the file is absent
  let cfg;
  try {
    const m = await import("./cloudinary-config.js");
    cfg = m.cloudinaryConfig;
  } catch {
    cfg = null;
  }
  if (!cfg || !cfg.cloudName || !cfg.unsignedPreset || cfg.cloudName === "YOUR_CLOUD_NAME") {
    throw new Error(
      "Upload não configurado. Abre cloudinary-config.js e cola o teu cloudName e unsignedPreset (free account em cloudinary.com). " +
      "Em alternativa, cola um URL de imagem/vídeo."
    );
  }

  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloudName)}/${isVideo ? "video" : "image"}/upload`;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", cfg.unsignedPreset);

  return await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({
            url: res.secure_url,
            type: isVideo ? "video" : "image",
            width: res.width,
            height: res.height,
            bytes: res.bytes
          });
        } else {
          reject(new Error(res?.error?.message || "Upload falhou"));
        }
      } catch (e) {
        reject(new Error("Resposta inválida do Cloudinary"));
      }
    };
    xhr.onerror = () => reject(new Error("Erro de rede no upload"));
    xhr.send(fd);
  });
}

// Prompt for a URL fallback when Cloudinary isn't configured
export async function promptMediaURL() {
  const url = prompt("Cola o link direto de uma imagem ou vídeo (.jpg, .png, .mp4...):");
  if (!url) return null;
  const clean = url.trim();
  if (!/^https?:\/\//i.test(clean)) {
    toast("URL inválido", "error");
    return null;
  }
  const isVideo = /\.(mp4|webm|mov|ogg)(\?|$)/i.test(clean);
  return { url: clean, type: isVideo ? "video" : "image" };
}

// Header notif button wiring (used on profile, chat, dm, news, index).
// If `user` is provided, also subscribes to DM unread counts and pulses the hamburger and DM drawer item.
let _dmNotifUnsub = null;

// Play a beep sound for notifications
export function playBeep() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.2);
  } catch (e) {
    // Fallback: no sound if AudioContext fails
  }
}

export function wireHeaderNotifButton(user) {
  const btn = document.getElementById("headerNotifBtn");
  if (!btn) return;
  const path = (location.pathname || "").toLowerCase();
  const isIndexPage = path.endsWith("/index.html") || path.endsWith("/") || path === "";
  if (isIndexPage) return;

  // Default click → open notifs panel on index
  if (!btn._wired) {
    btn.addEventListener("click", () => {
      window.__alfaNavigate?.("./index.html?notifs=1") || (location.href = "./index.html?notifs=1");
    });
    btn._wired = true;
  }
}

export function wireDmNotifButton(user) {
  if (!user?.uid) return;
  if (_dmNotifUnsub) { _dmNotifUnsub(); _dmNotifUnsub = null; }

  let prevUnread = 0;

  import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js").then(({
    collection, query, where, limit, onSnapshot
  }) => {
    import("./firebase-config.js").then(({ db }) => {
      // Avoid composite index: no orderBy, client-side aggregation.
      const q = query(
        collection(db, "chats"),
        where("participants", "array-contains", user.uid),
        limit(100)
      );
      _dmNotifUnsub = onSnapshot(q, (snap) => {
        let unread = 0;
        let latestMsg = null;
        snap.forEach(d => {
          const data = d.data();
          const count = data["unread_" + user.uid] || 0;
          unread += count;
          if (count > 0 && data.lastMessage) {
            latestMsg = {
              from: data.lastMessageFrom || "Alguém",
              text: data.lastMessage,
              chatId: d.id
            };
          }
        });
        // Silently show a native notification if unread count increased — no beep
        if (unread > prevUnread) {
          if (latestMsg) {
            showLocalNotification({
              title: latestMsg.from,
              body: latestMsg.text.slice(0, 120),
              tag: "dm-" + latestMsg.chatId,
              data: { url: `./dm.html?c=${encodeURIComponent(latestMsg.chatId)}` },
              source: "client",
              category: "dm"
            });
          } else {
            showLocalNotification({
              title: "Nova mensagem privada",
              body: "Tens " + unread + " mensagem" + (unread === 1 ? "" : "s") + " por ler.",
              tag: "dm-unread",
              data: { url: "./dm.html" },
              source: "client",
              category: "dm"
            });
          }
        }
        prevUnread = unread;
        // Pulse hamburger and DM drawer item
        const hamburger = document.getElementById("openDrawerBtn");
        const dmItem = document.querySelector('a[href="./dm.html"].drawer-item');
        const show = unread > 0;
        hamburger?.classList.toggle("has-dm-unread", show);
        dmItem?.classList.toggle("has-unread", show);
        dmItem?.classList.toggle("has-dm-unread", show);
      }, (err) => {
        console.warn("[Alfa] DM unread listener:", err.message);
      });
    });
  });
}

// =========================================================
// Push notifications (Browser Notification API + optional FCM)
// =========================================================
// This gives the user:
// 1) Foreground notifications: while the tab is open but blurred, new DMs/
//    mentions/notifs trigger a native browser notification.
// 2) Opt-in prompt: requested gently the first time the user opens the app.
// 3) FCM ready: if they later add a VAPID key in firebase-config.js, push
//    messages from a backend will be delivered via service-worker.js.
//
// The opt-in flag is stored in localStorage to avoid re-asking every load.

const NOTIF_ASKED_KEY = "acs_notif_asked_v1";

export function canShowNotifs() {
  return ("Notification" in window) && Notification.permission === "granted";
}

export async function requestNotifPermissionOnce(ctx = "geral") {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") {
    setupFCMTokenIfAvailable().catch(() => {});
    return true;
  }
  if (Notification.permission === "denied") return false;
  // Only prompt once per install (unless they haven't answered)
  if (localStorage.getItem(NOTIF_ASKED_KEY) === "1" && Notification.permission === "default") {
    // already asked; skip unless explicitly re-requested
  }
  try {
    localStorage.setItem(NOTIF_ASKED_KEY, "1");
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      toast("Notificações ativadas", "success");
      setupFCMTokenIfAvailable().catch(() => {});
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Show a local notification. Silently no-ops if permission isn't granted.
// By default only fires when the tab is NOT focused — pass `forceVisible: true`
// to always show (useful for "Test notification" and DMs that arrive while the
// user is on a different page of the app).
//
// `source`:
//   "fcm"    → the push came from FCM (background or onMessage foreground).
//              Always respected; this is the single source of truth when the
//              Cloud Functions backend is deployed.
//   "client" → the call is from a Firestore onSnapshot fallback. Suppressed
//              whenever FCM is active, to avoid duplicate notifications on
//              mobile. Still fires if FCM didn't register (no VAPID / iOS
//              without PWA install).
// `category` enables per-category preference filtering ("dm", "globalChat",
// "news", "engagement"). If omitted, no category check is run.
// In-memory dedup map — same tag within 4s is swallowed. Belt & suspenders
// for the case where FCM foreground + a client-side onSnapshot both fire.
const _localNotifShown = new Map(); // tag -> timestamp
export function showLocalNotification({ title, body, icon, tag, data, forceVisible = false, source = "fcm", category = null }) {
  try {
    if (!canShowNotifs()) return null;
    // Respect master toggle
    try {
      const pref = localStorage.getItem("acs_push_pref_v1");
      if (pref === "0") return null;
    } catch {}
    // Respect per-category toggle
    if (category && !getNotifPref(category)) return null;
    // Suppress client-side fallback when the FCM pipeline is doing the work.
    // This is the main duplicate-notification fix: previously both the Cloud
    // Function (FCM) and the Firestore onSnapshot listener would fire their
    // own notifications for the same event.
    if (source === "client" && window.__fcmActive === true) return null;
    // Tag-based dedup window (mirrors the SW). Same tag firing twice within
    // 4s is almost certainly a duplicate, not an intentional re-notify.
    try {
      const dedupTag = tag || "alfa-notif";
      const now = Date.now();
      for (const [k, t] of _localNotifShown) {
        if (now - t > 4000) _localNotifShown.delete(k);
      }
      const last = _localNotifShown.get(dedupTag);
      if (last && now - last < 4000) return null;
      _localNotifShown.set(dedupTag, now);
    } catch {}
    // Allow the notification through if the tab is hidden OR not focused.
    // (Previously we blocked whenever the tab was visible, which caused DMs
    // received while on /dm.html to never produce a visible notification even
    // when the browser window was buried behind other apps.)
    const isActive = document.visibilityState === "visible" && document.hasFocus();
    if (!forceVisible && isActive) return null;

    // Prefer ServiceWorkerRegistration.showNotification so it can be clicked
    // to open/focus the page (and keeps working after close on supported browsers).
    if (navigator.serviceWorker?.ready) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title || "Alfa Club", {
          body: body || "",
          icon: icon || "./icons/icon-192.png",
          badge: "./icons/icon-192.png",
          tag: tag || "alfa-notif",
          data: data || {},
          vibrate: [50, 30, 50]
        });
      }).catch(() => {
        new Notification(title || "Alfa Club", { body: body || "", icon });
      });
    } else {
      new Notification(title || "Alfa Club", { body: body || "", icon });
    }
    return true;
  } catch {
    return false;
  }
}

// Try to register for FCM background push. No-op if VAPID key missing.
async function setupFCMTokenIfAvailable() {
  if (_fcmSetupPromise) return _fcmSetupPromise;
  _fcmSetupPromise = (async () => {
    try {
      // iOS requires the app to be installed as a PWA (added to Home Screen)
      // before push notifications work. Log a helpful diagnostic.
      try {
        const isStandalone = window.matchMedia("(display-mode: standalone)").matches
          || window.navigator.standalone === true;
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        if (isIOS && !isStandalone) {
          console.info("[Alfa] iOS detected — adiciona ao ecrã inicial para receberes notificações push.");
        }
      } catch {}

      const cfg = await import("./firebase-config.js");
      const vapid = cfg.fcmVapidKey;
      if (!vapid || vapid.startsWith("YOUR_")) return;
      const { getMessaging, getToken, onMessage } =
        await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js");
      const messaging = getMessaging(cfg.app);
      // Register the dedicated firebase-messaging-sw.js under its own scope
      // (the main service-worker.js is registered at site root and handles
      // general PWA + web-push delivery). FCM getToken() needs this specific SW.
      let reg = await cfg.registerMessagingSW();
      if (!reg) {
        // Fallback to the default ready SW (won't fire FCM pushes, but at least
        // it keeps the call from throwing).
        reg = await navigator.serviceWorker.ready;
      }
      const token = await getToken(messaging, { vapidKey: vapid, serviceWorkerRegistration: reg });
      if (token) {
        // Mark FCM as active so client-side Firestore listeners stop firing
        // their own local notifications (dedupe).
        try { window.__fcmActive = true; } catch {}
        // Store under users/{uid}/fcmTokens/{token} so the Cloud Function can
        // target pushes. Also clean up stale tokens from this same device so
        // we don't pile up unused entries every time the token rotates.
        const auth = (await import("./firebase-config.js")).auth;
        const { doc, setDoc, serverTimestamp, collection, getDocs, deleteDoc } =
          await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        const db = (await import("./firebase-config.js")).db;
        const user = auth.currentUser;
        if (user) {
          // A stable-ish per-device id so we can recognise stale tokens from
          // this same device/browser after they rotate.
          let deviceId = "";
          try {
            deviceId = localStorage.getItem("acs_device_id") || "";
            if (!deviceId) {
              deviceId = (crypto?.randomUUID?.() || (Date.now() + "-" + Math.random().toString(36).slice(2)));
              localStorage.setItem("acs_device_id", deviceId);
            }
          } catch {}

          await setDoc(doc(db, "users", user.uid, "fcmTokens", token), {
            at: serverTimestamp(),
            ua: navigator.userAgent.slice(0, 200),
            deviceId
          }, { merge: true });

          // Remove any OTHER tokens previously stored for this same deviceId
          // (FCM rotates tokens periodically and we don't want the old ones
          // sitting around — the Cloud Function would try to send to them).
          try {
            const tokensSnap = await getDocs(collection(db, "users", user.uid, "fcmTokens"));
            const cleanup = [];
            tokensSnap.forEach(d => {
              if (d.id === token) return;
              if ((d.data().deviceId || "") === deviceId && deviceId) {
                cleanup.push(deleteDoc(d.ref));
              }
            });
            if (cleanup.length) await Promise.all(cleanup);
          } catch (e) { console.info("[Alfa] old token cleanup skipped:", e?.message); }
        }
      }
      // Foreground messages → show as local notification. Preserve the tag
      // that the Cloud Function set (so iOS/Android collapse duplicates with
      // the same tag instead of stacking two badges).
      if (!_fcmOnMessageAttached) {
        _fcmOnMessageAttached = true;
        onMessage(messaging, (payload) => {
          // Cloud Function now sends DATA-ONLY payloads, so title/body/icon
          // live in `data`. We still fall back to `notification` for
          // backwards compatibility with any in-flight legacy messages.
          const n = payload.notification || {};
          const d = payload.data || {};
          // Self-notification guard: if this push announces a message that
          // *we* sent, swallow it. The Cloud Function already excludes the
          // sender, but if the same FCM token has somehow been registered
          // under another user (multi-account on one device, stale token
          // entries) the device would still receive its own message.
          try {
            const myUid = (_appAuth && _appAuth.currentUser && _appAuth.currentUser.uid) || "";
            if (myUid && d && d.senderUid && d.senderUid === myUid) return;
          } catch {}
          showLocalNotification({
            title: d.title || n.title || "Alfa Club",
            body: d.body || n.body || "",
            icon: d.icon || n.icon,
            tag: d.tag || n.tag || "alfa-fcm",
            data: d,
            forceVisible: true,
            source: "fcm"
          });
        });
      }
    } catch (e) {
      console.info("[Alfa] FCM not set up:", e?.message);
    }
  })();
  return _fcmSetupPromise;
}

// When the service worker tells us to navigate (after a notification click),
// respect that request. We also listen for `sw-updated` so every open tab
// auto-reloads right after a new deploy activates — stops users from sitting
// on stale JS whose imports don't match the new module graph.
if ("serviceWorker" in navigator) {
  let _reloadingForSWUpdate = false;
  navigator.serviceWorker.addEventListener("message", (e) => {
    const t = e?.data?.type;
    if (t === "navigate" && typeof e.data.url === "string") {
      window.__alfaNavigate?.(e.data.url) || (location.href = e.data.url);
    } else if (t === "sw-updated" && !_reloadingForSWUpdate) {
      _reloadingForSWUpdate = true;
      // Small delay so the new SW fully takes control first.
      setTimeout(() => { try { location.reload(); } catch {} }, 300);
    }
  });
}

// Test notification (used by Settings → Testar notificação)
export async function testPushNotification() {
  if (!("Notification" in window)) { toast("Este browser não suporta notificações.", "error"); return false; }
  if (Notification.permission === "denied") {
    toast("Notificações bloqueadas. Ativa nas definições do browser.", "error");
    return false;
  }
  if (Notification.permission !== "granted") {
    const ok = await requestNotifPermissionOnce("teste");
    if (!ok) return false;
  }
  // Force the preference on if user is testing
  setPushNotifsEnabled(true);
  const shown = showLocalNotification({
    title: "✨ Alfa Club",
    body: "As notificações estão a funcionar!",
    tag: "test-notif",
    forceVisible: true
  });
  if (shown) {
    toast("Notificação enviada!", "success");
    return true;
  }
  toast("Não foi possível mostrar a notificação.", "error");
  return false;
}

// Auto-ask on first meaningful interaction (after auth, not on login page).
// Call this from the top of the flow on pages that require auth.
export function maybePromptForNotifs() {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "default") {
    if (Notification.permission === "granted") setupFCMTokenIfAvailable().catch(() => {});
    return;
  }
  // Delay slightly so the user sees the page first
  setTimeout(() => {
    requestNotifPermissionOnce().catch(() => {});
  }, 2500);
}

// Click-ripple effect for any element with data-ripple
document.addEventListener("pointerdown", (e) => {
  const t = e.target.closest("[data-ripple]");
  if (!t) return;
  const rect = t.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const r = document.createElement("span");
  r.style.cssText = `position:absolute;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px;width:${size}px;height:${size}px;border-radius:50%;pointer-events:none;background:radial-gradient(circle,rgba(236,72,153,.35),rgba(139,92,246,0));transform:scale(0);animation:ripple .55s ease forwards;`;
  t.style.position = t.style.position || "relative";
  t.style.overflow = "hidden";
  t.appendChild(r);
  setTimeout(() => r.remove(), 600);
});
const style = document.createElement("style");
style.textContent = `@keyframes ripple { to { transform: scale(2.4); opacity: 0; } }`;
document.head.appendChild(style);

// =========================================================
// Themes — applied on every page load via localStorage
// =========================================================
const THEME_KEY = "acs_theme_v1";
export function getSavedTheme() {
  try { return localStorage.getItem(THEME_KEY) || "dark"; } catch { return "dark"; }
}
export function saveTheme(t) {
  try { localStorage.setItem(THEME_KEY, t); } catch {}
}
const VALID_THEMES = ["dark", "light", "vaporwave", "cyberpunk", "space"];
export function applyTheme(t) {
  if (!t || !VALID_THEMES.includes(t)) t = "dark";
  document.documentElement.setAttribute("data-theme", t);
}
// auto-apply on load
(() => { try { applyTheme(getSavedTheme()); } catch {} })();

// =========================================================
// Push notif preference (local)
// =========================================================
const PUSH_PREF_KEY = "acs_push_pref_v1";
export function getPushNotifsEnabled() {
  try {
    const v = localStorage.getItem(PUSH_PREF_KEY);
    if (v === "1") return true;
    if (v === "0") return false;
    // default: infer from browser permission
    return ("Notification" in window) && Notification.permission === "granted";
  } catch { return false; }
}
export function setPushNotifsEnabled(v) {
  try { localStorage.setItem(PUSH_PREF_KEY, v ? "1" : "0"); } catch {}
}

// =========================================================
// Granular notification preferences
// =========================================================
// Users can individually toggle DM, global chat, Alfa News, and engagement
// (likes/dislikes/comments) notifications. Preferences are mirrored in:
//   - localStorage  → fast read for client-side gating
//   - Firestore (users/{uid}.notifPrefs) → read by Cloud Functions before pushing
//
// Categories: "dm", "globalChat", "news", "engagement"
// Defaults: DMs/news/engagement ON, global chat OFF (noisy).
const NOTIF_PREFS_KEY = "acs_notif_prefs_v1";
export const NOTIF_PREF_DEFAULTS = Object.freeze({
  dm: true,
  globalChat: false,
  news: true,
  engagement: true
});

function _readPrefsFromLS() {
  try {
    const raw = localStorage.getItem(NOTIF_PREFS_KEY);
    if (!raw) return { ...NOTIF_PREF_DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...NOTIF_PREF_DEFAULTS, ...(parsed || {}) };
  } catch { return { ...NOTIF_PREF_DEFAULTS }; }
}
function _writePrefsToLS(prefs) {
  try { localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

export function getNotifPrefs() { return _readPrefsFromLS(); }
export function getNotifPref(category) {
  const p = _readPrefsFromLS();
  return category in p ? !!p[category] : !!NOTIF_PREF_DEFAULTS[category];
}
export function setNotifPref(category, value) {
  const p = _readPrefsFromLS();
  p[category] = !!value;
  _writePrefsToLS(p);
  // Fire-and-forget Firestore mirror
  _syncPrefsToFirestore(p).catch(() => {});
  return p;
}

async function _syncPrefsToFirestore(prefs) {
  try {
    const [{ auth, db }, { doc, setDoc }] = await Promise.all([
      import("./firebase-config.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
    ]);
    const uid = auth?.currentUser?.uid;
    if (!uid) return;
    await setDoc(doc(db, "users", uid), { notifPrefs: prefs }, { merge: true });
  } catch (e) {
    console.info("[Alfa] sync notifPrefs:", e?.message);
  }
}

// Called after auth: if Firestore has prefs, mirror them into localStorage
// (so the SW / fast client reads are consistent across devices).
export async function loadNotifPrefsFromFirestore() {
  try {
    const [{ auth, db }, { doc, getDoc }] = await Promise.all([
      import("./firebase-config.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
    ]);
    const uid = auth?.currentUser?.uid;
    if (!uid) return _readPrefsFromLS();
    const snap = await getDoc(doc(db, "users", uid));
    const remote = snap.exists() ? (snap.data().notifPrefs || null) : null;
    if (remote && typeof remote === "object") {
      const merged = { ...NOTIF_PREF_DEFAULTS, ...remote };
      _writePrefsToLS(merged);
      return merged;
    }
    // No remote prefs yet → seed from defaults / current local
    const local = _readPrefsFromLS();
    await _syncPrefsToFirestore(local);
    return local;
  } catch { return _readPrefsFromLS(); }
}

// =========================================================
// Mod badge + name style helpers
// =========================================================
export function modBadgeHTML(userLike) {
  if (!userLike?.isMod) return "";
  return `<span class="mod-pill role-badge" role="button" tabindex="0" data-role-info="mod" title="Moderador">mod</span>`;
}
// nameStyleHTML: honours nameColor / nameStyle picked up in the shop.
// Falls back to escaped plain name.
export function nameStyleHTML(userLike) {
  if (!userLike) return "";
  const name = escapeHTML(userLike.name || userLike.authorName || "");
  if (userLike.nameStyle === "gold") return `<span class="name-gold">${name}</span>`;
  if (userLike.nameStyle === "grad") return `<span class="name-grad-anim">${name}</span>`;
  if (userLike.nameColor)            return `<span style="color:${escapeAttr(userLike.nameColor)};">${name}</span>`;
  return name;
}

// =========================================================
// Point badges (rendered on profile)
// =========================================================
export function pointBadgesHTML(profile) {
  const pts = profile?.totalPointsEarned || profile?.points || 0;
  const badges = [];
  if (pts >= 10)   badges.push(`<span class="pt-badge pts-10">⭐ 10 pts</span>`);
  if (pts >= 50)   badges.push(`<span class="pt-badge pts-50">🌿 50 pts</span>`);
  if (pts >= 100)  badges.push(`<span class="pt-badge pts-100">💎 100 pts</span>`);
  if (pts >= 500)  badges.push(`<span class="pt-badge pts-500">🏆 500 pts</span>`);
  if (profile?.betaTester) badges.push(`<span class="pt-badge beta">✨ Beta tester</span>`);
  if (!badges.length) return "";
  return `<div class="badges-row">${badges.join("")}</div>`;
}

// =========================================================
// Logo easter egg — click the "Alfa Club" title → glow + mini-zoom
// =========================================================
export function initLogoEasterEgg(elId = "appLogoTitle") {
  const el = document.getElementById(elId);
  if (!el) return;
  el.addEventListener("click", () => {
    el.classList.remove("logo-pop");
    // force reflow to restart animation
    void el.offsetWidth;
    el.classList.add("logo-pop");
    setTimeout(() => el.classList.remove("logo-pop"), 800);
  });
}

// =========================================================
// Pretty alert (glass card, rises from bottom)
// =========================================================
let _apTimer;
export function alertPretty(message, type = "") {
  let el = document.getElementById("_alertPretty");
  if (!el) {
    el = document.createElement("div");
    el.id = "_alertPretty";
    el.className = "alert-pretty";
    document.body.appendChild(el);
  }
  el.className = "alert-pretty " + type;
  el.innerHTML = `
    <span class="ap-icon">
      ${type === "error"
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
        : type === "success"
          ? `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`}
    </span>
    <span>${escapeHTML(message)}</span>`;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(_apTimer);
  _apTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

// Note: main PWA service-worker.js is registered per-page (feed/chat/dm/profile/...).
// The FCM firebase-messaging-sw.js is registered lazily inside
// setupFCMTokenIfAvailable() so we don't prompt the user for notifications
// or spin up an extra SW until they actually opt in.