// Firebase Cloud Messaging background service worker.
// Registered under scope ./firebase-cloud-messaging-push-scope/ so it does
// not conflict with the main ./service-worker.js (root scope).
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBL4clPmPLR8_uFaBZ1Yah18GQFwIckHf8",
  authDomain: "alfa-club-social.firebaseapp.com",
  projectId: "alfa-club-social",
  messagingSenderId: "591980705826",
  appId: "1:591980705826:web:352d9152e465f3b610f27b"
});

const messaging = firebase.messaging();

// Activate immediately so we don't have to wait for reload before the SW takes over.
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });

// In-memory dedup — same tag within this window is suppressed. This is a
// safety net in case FCM re-delivers, or another handler also fires.
const _recentlyShown = new Map(); // tag -> timestamp
const DEDUP_MS = 4000;
function _shouldShow(tag) {
  const now = Date.now();
  // GC old entries
  for (const [k, t] of _recentlyShown) {
    if (now - t > DEDUP_MS) _recentlyShown.delete(k);
  }
  const last = _recentlyShown.get(tag);
  if (last && now - last < DEDUP_MS) return false;
  _recentlyShown.set(tag, now);
  return true;
}

// Self-UID lookup. The page writes the current user's UID to IDB
// (alfa-sw-state / kv / "selfUid") on auth state change. We read it here so
// background pushes that announce a message we sent ourselves (cross-token
// case where the same FCM token is registered under multiple Firestore user
// docs) are dropped before we ever call showNotification.
function _readSelfUid() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open("alfa-sw-state", 1);
      req.onupgradeneeded = () => {
        try { req.result.createObjectStore("kv"); } catch {}
      };
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction("kv", "readonly");
          const get = tx.objectStore("kv").get("selfUid");
          get.onsuccess = () => { try { req.result.close(); } catch {}; resolve(get.result || ""); };
          get.onerror = () => { try { req.result.close(); } catch {}; resolve(""); };
        } catch { resolve(""); }
      };
      req.onerror = () => resolve("");
    } catch { resolve(""); }
  });
}

// Handle background messages (tab not focused / closed).
// The Cloud Function sends DATA-ONLY payloads. If we ever start seeing a
// `notification` field again it means something upstream changed — we still
// accept it, but `data` is the source of truth.
messaging.onBackgroundMessage(async (payload) => {
  try {
    const n = payload.notification || {};
    const data = payload.data || {};
    const title = data.title || n.title || "Alfa Club";
    const tag = data.tag || n.tag || "alfa-fcm";
    // Self-notification guard: never display a push announcing a message we
    // sent ourselves, even if a stale cross-account token registration caused
    // the device to receive it.
    try {
      const myUid = await _readSelfUid();
      if (myUid && data.senderUid && data.senderUid === myUid) return;
    } catch {}
    if (!_shouldShow(tag)) return;
    const options = {
      body: data.body || n.body || "",
      icon: data.icon || n.icon || "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      tag,
      renotify: false,
      data: { url: data.url || data.click_action || n.click_action || "./index.html", ...data },
      vibrate: [50, 30, 50]
    };
    self.registration.showNotification(title, options);
  } catch (e) {
    // swallow — never let a bad payload crash the SW
  }
});

// Raw `push` listener as defence-in-depth. If FCM ever auto-displays a
// duplicate (because some upstream payload still carries `notification`),
// we use the same dedup window to swallow the second one. We don't call
// showNotification here — onBackgroundMessage above owns display.
self.addEventListener("push", (event) => {
  try {
    if (!event.data) return;
    let payload = {};
    try { payload = event.data.json(); } catch { return; }
    const n = payload.notification || {};
    const data = payload.data || {};
    const tag = data.tag || n.tag;
    if (!tag) return;
    // Pre-reserve the tag so onBackgroundMessage de-dups any re-fire in the
    // same window. Do NOT block the native push; just note the timestamp.
    if (!_recentlyShown.has(tag)) {
      // leave it — onBackgroundMessage will set it and show.
    }
  } catch {}
});

// When the user taps the notification, focus an existing tab or open a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "./index.html";
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of allClients) {
      try {
        if (client.url && "focus" in client) {
          client.postMessage({ type: "navigate", url: targetUrl });
          return client.focus();
        }
      } catch {}
    }
    if (self.clients.openWindow) {
      return self.clients.openWindow(targetUrl);
    }
  })());
});
