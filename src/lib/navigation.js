export const ROUTES = new Set(["index.html", "login.html", "chat.html", "dm.html", "news.html", "profile.html", "games.html"]);

export function basePath() {
  return new URL(import.meta.env.BASE_URL, window.location.origin).pathname;
}

export function currentRoute() {
  const base = basePath();
  const pathname = window.location.pathname.startsWith(base)
    ? window.location.pathname.slice(base.length)
    : window.location.pathname.slice(1);
  const file = pathname.split("/").pop();
  return {
    page: file && file.endsWith(".html") ? file : "index.html",
    search: window.location.search,
    hash: window.location.hash
  };
}

export function routeTo(page, search = "", hash = "") {
  const pagePath = page === "index.html" ? "" : page;
  window.history.pushState({}, "", `${basePath()}${pagePath}${search}${hash}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
  if (!hash) {
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }
}

export function normalizeLocalHref(rawHref) {
  if (!rawHref || rawHref === "#") return null;
  let url;
  try {
    url = new URL(rawHref, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  const file = url.pathname.split("/").pop() || "index.html";
  return ROUTES.has(file) ? { page: file, search: url.search, hash: url.hash } : null;
}

export function navigateHref(rawHref) {
  const local = normalizeLocalHref(rawHref);
  if (!local) return false;
  routeTo(local.page, local.search, local.hash);
  return true;
}

export function hrefFor(page, search = "", hash = "") {
  return `${basePath()}${page === "index.html" ? "" : page}${search}${hash}`;
}
