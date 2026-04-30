/*
 * Alfa Club — Cache recovery guard.
 * Runs BEFORE any ES module import. If a module script fails to load (the
 * classic symptom of a broken deploy + stale service-worker cache), we:
 *   1. unregister every service worker for this origin
 *   2. clear every cache the browser has for us
 *   3. reload the page once
 * We set a session flag so we don't recover-loop if the failure is real.
 *
 * This file is intentionally a plain script (no modules) and is included
 * with `?v=<ts>` from every HTML entry so the browser always re-fetches it.
 */
(function () {
  var RECOVERY_KEY = "acs_recovery_attempt_v1";
  var RECOVERY_TS_KEY = "acs_recovery_ts_v1";

  // Allow a MANUAL recovery via ?reset=1 in the URL — for support cases.
  try {
    var params = new URLSearchParams(location.search);
    if (params.get("reset") === "1") {
      params.delete("reset");
      var qs = params.toString();
      var cleanUrl = location.pathname + (qs ? "?" + qs : "") + location.hash;
      history.replaceState(null, "", cleanUrl);
      nukeAndReload("manual-reset");
      return;
    }
  } catch (e) {}

  // Any script/stylesheet load failure (bubble=false, so use capture)
  window.addEventListener("error", function (e) {
    var t = e && e.target;
    if (!t) return;
    var tag = (t.tagName || "").toUpperCase();
    if (tag !== "SCRIPT" && tag !== "LINK") return;
    var src = t.src || t.href || "";
    try {
      if (!src || new URL(src, location.href).origin !== location.origin) return;
    } catch (_) { return; }
    console.warn("[Alfa] asset failed to load:", src);
    tryRecover("asset-failed:" + src.split("/").pop());
  }, true);

  // Dynamic import / module evaluation failures
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    var msg = (r && (r.message || String(r))) || "";
    // The exact signature of stale-cache breakage:
    //   "does not provide an export named 'initPush'"
    //   "Failed to fetch dynamically imported module"
    //   "Importing binding name ... is not found."
    if (/does not provide an export named|Failed to fetch dynamically imported module|Importing binding name/i.test(msg)) {
      console.warn("[Alfa] module graph mismatch:", msg);
      tryRecover("module-mismatch");
    }
  });

  function tryRecover(reason) {
    var now = Date.now();
    try {
      var last = parseInt(sessionStorage.getItem(RECOVERY_TS_KEY) || "0", 10);
      var attempted = sessionStorage.getItem(RECOVERY_KEY);
      // If we already recovered this session within the last 60s, stop —
      // probably a real bug, not cache. Don't loop.
      if (attempted === "1" && (now - last) < 60000) {
        console.warn("[Alfa] recovery already attempted this session, not retrying.");
        return;
      }
      sessionStorage.setItem(RECOVERY_KEY, "1");
      sessionStorage.setItem(RECOVERY_TS_KEY, String(now));
    } catch (_) {}
    nukeAndReload(reason);
  }

  function nukeAndReload(reason) {
    console.warn("[Alfa] recovering (" + reason + ")");
    var jobs = [];
    try {
      if ("caches" in window) {
        jobs.push(caches.keys().then(function (keys) {
          return Promise.all(keys.map(function (k) {
            try { return caches.delete(k); } catch (_) {}
          }));
        }).catch(function () {}));
      }
      if ("serviceWorker" in navigator) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
          return Promise.all(regs.map(function (r) {
            try { return r.unregister(); } catch (_) {}
          }));
        }).catch(function () {}));
      }
    } catch (_) {}

    var done = false;
    var reload = function () {
      if (done) return; done = true;
      try { location.reload(); } catch (_) {}
    };
    Promise.all(jobs).then(reload, reload);
    // Hard fallback in case the nuke hangs
    setTimeout(reload, 3000);
  }
})();
