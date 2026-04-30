// Alfa Club Social — Service Worker
// Strategy:
//   - HTML (navigations)     → network-first (with cache fallback when offline)
//   - JS / CSS (modules)     → network-first  (deploys need fresh module graph)
//   - Images / icons / fonts → stale-while-revalidate (fast, updates in bg)
//   - Firebase / gstatic     → not intercepted
// Bump CACHE version on every deploy. The browser compares the SW file
// byte-for-byte; if a single byte changes (e.g. this version constant),
// it installs the new SW, which calls skipWaiting + clients.claim and
// posts {type:"sw-updated"} to all open tabs so they reload.
// Tip: just `git add` the bumped number → it ships with each deploy.
const CACHE = "alfa-club-social-v16";
const STATIC_EXT = /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf)$/i;
const SKIP_HOSTS = [
  "firebaseio.com",
  "googleapis.com",
  "firebaseapp.com",
  "gstatic.com",
  "cdn.tailwindcss.com",
  "res.cloudinary.com"
];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Drop every cache that isn't the current one (incl. any from the broken
    // deploy mentioned in the postmortem).
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    // Tell every open tab to reload so they pick up the new module graph.
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    wins.forEach((w) => {
      try { w.postMessage({ type: "sw-updated", version: CACHE }); } catch {}
    });
  })());
});

// ───── Push notifications ─────────────────────────────────
// NOTE: Push handling is owned exclusively by firebase-messaging-sw.js
// (registered under ./firebase-cloud-messaging-push-scope/). Adding a
// `push` listener here would cause BOTH service workers to fire for the
// same push event — users would see each notification twice. The main SW
// only handles `notificationclick` for notifications it already owns.

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "./index.html";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        try {
          const wurl = new URL(w.url);
          if (wurl.origin === self.location.origin) {
            w.focus();
            if ("navigate" in w) return w.navigate(url);
            return w.postMessage({ type: "navigate", url });
          }
        } catch {}
      }
      return self.clients.openWindow(url);
    })
  );
});

// ───── Fetch handler ──────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Hands-off for 3rd party (Firebase, Google, Tailwind, Cloudinary)
  if (SKIP_HOSTS.some((h) => url.hostname.includes(h))) return;
  if (url.origin !== self.location.origin) return;

  // Images / fonts / icons → stale-while-revalidate
  if (STATIC_EXT.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  // Everything else (HTML, JS, CSS, JSON) → network-first
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    return cached || new Response("", { status: 504 });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then((res) => {
      if (res && res.status === 200) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => cached);
  return cached || networkPromise;
}
