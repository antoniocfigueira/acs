// Centralised service-worker registration with aggressive update polling.
//
// Why aggressive polling? On iOS, a PWA launched from the home-screen
// shortcut runs in a separate context that doesn't always check for SW
// updates on its own. Without these triggers users get stuck on whatever
// version was active the last time they killed the app — even after a
// firebase deploy. We force a `registration.update()` on:
//   1. initial load
//   2. visibilitychange → visible  (e.g. swiping back into the PWA)
//   3. window focus
//   4. every 5 minutes while the tab is open
// The actual reload happens in app.js when the SW posts {type:"sw-updated"}
// after activating — see service-worker.js's activate handler.
(function registerAlfaSW() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol === "file:") return;
  navigator.serviceWorker.register("./service-worker.js").then((reg) => {
    if (!reg) return;
    const recheck = () => { try { reg.update(); } catch {} };
    recheck();
    setInterval(recheck, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") recheck();
    });
    window.addEventListener("focus", recheck);
    window.addEventListener("pageshow", (e) => {
      // bfcache restore — make sure we're not on a stale SW
      if (e.persisted) recheck();
    });
  }).catch(() => {});
})();
