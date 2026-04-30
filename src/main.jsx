import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { legacyPages } from "./legacy-pages.generated.js";
import { ChatPage } from "./pages/ChatPage.jsx";
import { DMPage } from "./pages/DMPage.jsx";
import { FeedPage } from "./pages/FeedPage.jsx";
import { LoginPage } from "./pages/LoginPage.jsx";
import { NewsPage } from "./pages/NewsPage.jsx";
import { ProfilePage } from "./pages/ProfilePage.jsx";
import { currentRoute, navigateHref, normalizeLocalHref, routeTo } from "./lib/navigation.js";

const SCRIPT_BY_PAGE = {
  "index.html": "feed.js",
  "chat.html": "chat.js",
  "dm.html": "dm.js",
  "news.html": "news.js",
  "profile.html": "profile.js"
};

const BODY_CLASS_BY_PAGE = {
  "index.html": "page feed-page",
  "login.html": "page login-page",
  "chat.html": "page chat-page",
  "dm.html": "page dm-page",
  "news.html": "page news-page",
  "profile.html": "page profile-page"
};

function ensureLegacyRuntime() {
  if (window.__alfaLegacyRuntime) return window.__alfaLegacyRuntime;

  const originalAdd = EventTarget.prototype.addEventListener;
  const originalRemove = EventTarget.prototype.removeEventListener;
  const originalSetTimeout = window.setTimeout.bind(window);
  const originalClearTimeout = window.clearTimeout.bind(window);
  const originalSetInterval = window.setInterval.bind(window);
  const originalClearInterval = window.clearInterval.bind(window);
  let currentScope = null;

  const runtime = {
    start(label) {
      const scope = { label, alive: true, listeners: [], timeouts: new Set(), intervals: new Set(), cleanups: new Set() };
      currentScope = scope;
      window.__alfaPageScope = {
        addCleanup(fn) { if (typeof fn === "function" && scope.alive) scope.cleanups.add(fn); },
        isActive() { return scope.alive && currentScope === scope; }
      };
      return scope;
    },
    cleanup(scope) {
      if (!scope || !scope.alive) return;
      scope.alive = false;
      if (currentScope === scope) currentScope = null;
      for (const cleanup of scope.cleanups) {
        try { cleanup(); } catch (err) { console.warn("[Alfa React] cleanup failed:", err); }
      }
      scope.cleanups.clear();
      for (const [target, type, listener, options] of scope.listeners) {
        try { originalRemove.call(target, type, listener, options); } catch {}
      }
      scope.listeners.length = 0;
      for (const id of scope.timeouts) originalClearTimeout(id);
      for (const id of scope.intervals) originalClearInterval(id);
      scope.timeouts.clear();
      scope.intervals.clear();
    }
  };

  EventTarget.prototype.addEventListener = function patchedAddEventListener(type, listener, options) {
    if (currentScope?.alive && typeof listener !== "undefined") currentScope.listeners.push([this, type, listener, options]);
    return originalAdd.call(this, type, listener, options);
  };
  window.setTimeout = function patchedSetTimeout(handler, timeout, ...args) {
    const scope = currentScope?.alive ? currentScope : null;
    const id = originalSetTimeout((...cbArgs) => {
      if (scope) scope.timeouts.delete(id);
      if (!scope || scope.alive) {
        if (typeof handler === "function") handler(...cbArgs);
      }
    }, timeout, ...args);
    if (scope) scope.timeouts.add(id);
    return id;
  };
  window.clearTimeout = function patchedClearTimeout(id) { currentScope?.timeouts?.delete(id); return originalClearTimeout(id); };
  window.setInterval = function patchedSetInterval(handler, timeout, ...args) {
    const scope = currentScope?.alive ? currentScope : null;
    const id = originalSetInterval((...cbArgs) => {
      if (!scope || scope.alive) {
        if (typeof handler === "function") handler(...cbArgs);
      }
    }, timeout, ...args);
    if (scope) scope.intervals.add(id);
    return id;
  };
  window.clearInterval = function patchedClearInterval(id) { currentScope?.intervals?.delete(id); return originalClearInterval(id); };
  window.__alfaLegacyRuntime = runtime;
  return runtime;
}

window.__alfaNavigate = navigateHref;

function LegacyPage({ page, search }) {
  const legacy = legacyPages[page] || legacyPages["index.html"];
  const script = SCRIPT_BY_PAGE[page];
  const templateKey = useMemo(() => `${page}:${search}`, [page, search]);

  useEffect(() => {
    const runtime = ensureLegacyRuntime();
    const scope = runtime.start(`${page}:${search}`);
    document.title = legacy.title || "Alfa Club";
    document.body.className = legacy.bodyClass || BODY_CLASS_BY_PAGE[page] || "page";

    let cancelled = false;
    const load = async () => {
      if (page === "login.html") {
        await import(/* @vite-ignore */ `${import.meta.env.BASE_URL}legacy/auth.js?react=${Date.now()}`);
        await runLoginController();
        return;
      }
      if (script) {
        await import(/* @vite-ignore */ `${import.meta.env.BASE_URL}legacy/${script}?react=${Date.now()}`);
      }
    };

    queueMicrotask(() => {
      load().catch((err) => {
        if (!cancelled) console.error("[Alfa React] Legacy page failed:", err);
      });
    });

    return () => {
      cancelled = true;
      runtime.cleanup(scope);
    };
  }, [page, search, legacy.title, script]);

  useEffect(() => {
    const onClick = (event) => {
      const anchor = event.target.closest?.("a[href]");
      if (!anchor || anchor.target || event.defaultPrevented) return;
      const local = normalizeLocalHref(anchor.getAttribute("href"));
      if (!local) return;
      event.preventDefault();
      routeTo(local.page, local.search, local.hash);
    };

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: legacy.inlineStyles }} />
      <main
        key={templateKey}
        data-react-page={page}
        dangerouslySetInnerHTML={{ __html: legacy.body }}
      />
    </>
  );
}

function App() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const onPop = () => setRoute(currentRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  if (route.page === "index.html") return <FeedPage />;
  if (route.page === "login.html") return <LoginPage />;
  if (route.page === "chat.html") return <ChatPage search={route.search} />;
  if (route.page === "dm.html") return <DMPage search={route.search} />;
  if (route.page === "news.html") return <NewsPage />;
  if (route.page === "profile.html") return <ProfilePage search={route.search} />;
  return <LegacyPage page={route.page} search={route.search} />;
}

async function runLoginController() {
  const { loginUser, registerUser, redirectIfAuthed } = await import(/* @vite-ignore */ `${import.meta.env.BASE_URL}legacy/auth.js?login=${Date.now()}`);
  const { auth } = await import(/* @vite-ignore */ `${import.meta.env.BASE_URL}legacy/firebase-config.js?login=${Date.now()}`);

  import(/* @vite-ignore */ `${import.meta.env.BASE_URL}legacy/sw-register.js?login=${Date.now()}`).catch(() => {});

  try {
    const opts = auth?.app?.options || {};
    const unconfigured =
      !opts.apiKey ||
      opts.apiKey === "YOUR_API_KEY" ||
      !opts.projectId ||
      opts.projectId === "YOUR_PROJECT_ID";
    if (unconfigured) {
      document.getElementById("configBanner")?.classList.remove("hidden");
    }
  } catch (err) {
    console.warn("config check:", err);
  }

  redirectIfAuthed();

  const tabs = document.querySelector(".tabs");
  const loginPanel = document.getElementById("loginPanel");
  const registerPanel = document.getElementById("registerPanel");
  const errorBox = document.getElementById("errorBox");
  const invitePanel = document.getElementById("invitePanel");
  const inviteInput = document.getElementById("inviteCode");

  if (!tabs || !loginPanel || !registerPanel) return;

  const setTab = (tab) => {
    const which = tab || "login";
    const isRegister = which === "register";
    tabs.dataset.tab = which;
    tabs.querySelectorAll(".tab-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.target === which);
    });
    loginPanel.classList.toggle("active", !isRegister);
    registerPanel.classList.toggle("active", isRegister);
    hideError();
  };

  const showError = (message) => {
    if (!errorBox) return;
    errorBox.innerHTML = message;
    errorBox.classList.remove("hidden");
  };

  const hideError = () => errorBox?.classList.add("hidden");

  const INVITE_KEY = "alfa_invite_ok_v1";
  const VALID_INVITE = "2002";

  const unlockLoginUI = () => {
    invitePanel?.classList.add("hidden");
    invitePanel?.classList.remove("active");
    tabs.classList.remove("hidden");
    loginPanel.classList.remove("hidden");
    registerPanel.classList.remove("active");
    loginPanel.classList.add("active");
    setTimeout(() => document.getElementById("li-email")?.focus?.(), 120);
  };

  try {
    if (localStorage.getItem(INVITE_KEY) === "1") {
      unlockLoginUI();
    } else {
      setTimeout(() => inviteInput?.focus?.(), 200);
    }
  } catch {
    setTimeout(() => inviteInput?.focus?.(), 200);
  }

  invitePanel?.addEventListener("submit", (event) => {
    event.preventDefault();
    hideError();
    const code = (inviteInput?.value || "").trim();
    if (code === VALID_INVITE) {
      try {
        localStorage.setItem(INVITE_KEY, "1");
      } catch {}
      unlockLoginUI();
      return;
    }

    inviteInput?.classList.remove("shake");
    if (inviteInput) void inviteInput.offsetWidth;
    inviteInput?.classList.add("shake");
    showError("Código inválido.");
    inviteInput?.select?.();
  });

  const setLoading = (btn, loading) => {
    const label = btn?.querySelector(".btn-label");
    if (!btn || !label) return;
    if (loading) {
      btn.dataset.label = label.textContent;
      label.innerHTML = '<span class="dots">A processar</span>';
      btn.disabled = true;
      btn.style.opacity = 0.75;
    } else {
      label.textContent = btn.dataset.label || "";
      btn.disabled = false;
      btn.style.opacity = 1;
    }
  };

  const friendlyError = (err) => {
    console.error("[Alfa]", err);
    const code = err?.code || "";
    const map = {
      "auth/invalid-email": "Email inválido.",
      "auth/invalid-credential": "Email ou password errados.",
      "auth/wrong-password": "Password errada.",
      "auth/user-not-found": "Utilizador não encontrado.",
      "auth/email-already-in-use": "Esse email já está registado. Usa outro ou clica em Entrar.",
      "auth/weak-password": "Password muito fraca (mínimo 6 caracteres).",
      "auth/too-many-requests": "Demasiadas tentativas. Espera um pouco.",
      "auth/network-request-failed": "Sem ligação à internet.",
      "auth/operation-not-allowed": "Email/Password não está ativado no Firebase. Vai a Authentication -> Sign-in method.",
      "auth/api-key-not-valid": "API key do Firebase inválida. Verifica firebase-config.js.",
      "auth/invalid-api-key": "API key do Firebase inválida. Verifica firebase-config.js."
    };
    if (map[code]) return map[code];
    const msg = err?.message || "Ocorreu um erro.";
    return code ? `${msg}<br><small style="opacity:.7;">código: <code>${code}</code></small>` : msg;
  };

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest(".tab-btn");
    if (button) setTab(button.dataset.target);
  });
  document.querySelectorAll("[data-switch]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setTab(link.dataset.switch);
    });
  });

  loginPanel.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideError();
    const btn = document.getElementById("loginBtn");
    setLoading(btn, true);
    try {
      await loginUser({
        email: document.getElementById("li-email").value.trim(),
        password: document.getElementById("li-pass").value
      });
      routeTo("index.html");
    } catch (err) {
      showError(friendlyError(err));
      setLoading(btn, false);
    }
  });

  registerPanel.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideError();
    const btn = document.getElementById("registerBtn");
    setLoading(btn, true);
    try {
      const name = document.getElementById("rg-name").value.trim();
      const username = document.getElementById("rg-user").value.trim();
      const email = document.getElementById("rg-email").value.trim();
      const password = document.getElementById("rg-pass").value;
      if (!name) throw new Error("Indica o teu nome.");
      if (!username) throw new Error("Escolhe um @username.");
      await registerUser({ name, username, email, password });
      routeTo("index.html");
    } catch (err) {
      showError(friendlyError(err));
      setLoading(btn, false);
    }
  });

  document.getElementById("rg-user")?.addEventListener("input", (event) => {
    event.target.value = event.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, "");
  });
}

createRoot(document.getElementById("root")).render(<App />);
