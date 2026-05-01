import React from "react";

export function toast(message, type = "") {
  let el = document.getElementById("_toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "_toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.className = `toast ${type}`;
  el.textContent = message;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(window.__alfaToastTimer);
  window.__alfaToastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

export function timeAgo(date) {
  if (!date) return "";
  const ts = date?.toMillis ? date.toMillis() : date?.seconds ? date.seconds * 1000 : +date;
  if (!ts || Number.isNaN(ts)) return "";
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.floor(diff / 1000);
  if (s < 60) return "agora";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 4) return `${w}sem`;
  return new Date(ts).toLocaleDateString("pt-PT", { day: "numeric", month: "short" });
}

export function buildDmChatId(a, b) {
  if (!a || !b) return "";
  return [a, b].sort().join("_");
}

export function Avatar({ user, size = 38, className = "" }) {
  const name = user?.name || user?.authorName || user?.username || "?";
  const username = user?.username || user?.authorUsername || "";
  const photoURL = user?.photoURL || user?.authorPhoto || "";
  const initials = (name || username || "?")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (photoURL) {
    return (
      <img
        className={className}
        src={photoURL}
        alt={name || username}
        loading="lazy"
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover" }}
      />
    );
  }
  return (
    <div className={`avatar-fallback ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
      {initials}
    </div>
  );
}

export function StyledName({ user }) {
  const name = user?.name || user?.authorName || "Anónimo";
  if (user?.nameStyle === "gold") return <span className="name-gold">{name}</span>;
  if (user?.nameStyle === "grad") {
    const baseColor = user?.nameColor || user?.authorNameColor || "#f8fafc";
    return <span className="name-grad-anim" style={{ "--name-grad-base": baseColor }}>{name}</span>;
  }
  if (user?.nameStyle === "glow") {
    const baseColor = user?.nameColor || user?.authorNameColor || "#ec4899";
    return <span className="name-glow" style={{ "--name-glow-base": baseColor, color: baseColor }}>{name}</span>;
  }
  if (user?.nameColor) return <span style={{ color: user.nameColor }}>{name}</span>;
  return <>{name}</>;
}

export function RoleBadges({ user }) {
  const showInfo = (role, event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const isAdmin = role === "admin";
    const wrap = document.createElement("div");
    const symbol = isAdmin
      ? `<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true"><path d="M12 2l2.39 5.46L20 8.27l-4.19 3.94L17.03 18 12 15.27 6.97 18l1.22-5.79L4 8.27l5.61-.81L12 2z"/></svg>`
      : `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.2-2.8 7.8-7 10-4.2-2.2-7-5.8-7-10V6l7-3z"/><path d="M9 12l2 2 4-5"/></svg>`;
    wrap.className = "role-info-backdrop";
    wrap.style.cssText = "position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.68);backdrop-filter:blur(8px);";
    wrap.innerHTML = `
      <div class="role-info-card" style="background:#121212;border:1px solid var(--border);border-radius:18px;padding:24px 22px 18px;width:min(92vw,360px);box-shadow:0 24px 60px -10px rgba(0,0,0,.7);text-align:center;">
        <div style="display:grid;place-items:center;width:56px;height:56px;border-radius:50%;background:rgba(139,92,246,.12);border:1px solid rgba(139,92,246,.28);margin:0 auto 10px;color:${isAdmin ? "#fde047" : "#a78bfa"};font-weight:800;">${symbol}</div>
        <h3 style="margin:0 0 4px;font-size:17px;font-weight:700;letter-spacing:-.01em;">${isAdmin ? "Administrador" : "Moderador"}</h3>
        <p style="margin:0;color:var(--muted);font-size:14px;line-height:1.4;">Este utilizador tem acesso de ${isAdmin ? "Administrador" : "Moderador"}.</p>
        <button type="button" data-close style="margin-top:16px;width:100%;padding:11px;border-radius:12px;background:var(--grad);color:white;font-weight:600;font-size:14px;">Fechar</button>
      </div>
    `;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", (ev) => {
      if (ev.target === wrap || ev.target.closest("[data-close]")) wrap.remove();
    });
  };
  return (
    <>
      {user?.isAdmin ? (
        <button type="button" className="admin-badge role-badge role-badge-button" title="Admin" aria-label="Admin" onClick={(event) => showInfo("admin", event)}>
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M12 2l2.39 5.46L20 8.27l-4.19 3.94L17.03 18 12 15.27 6.97 18l1.22-5.79L4 8.27l5.61-.81L12 2z" />
          </svg>
        </button>
      ) : null}
      {user?.isMod || user?.role === "mod" ? (
        <button type="button" className="mod-pill role-badge role-badge-button" title="Moderador" onClick={(event) => showInfo("mod", event)}>
          mod
        </button>
      ) : null}
    </>
  );
}

export function DayDivider({ ts }) {
  const date = new Date(ts || Date.now());
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  let label;
  if (date.toDateString() === today.toDateString()) label = "Hoje";
  else if (date.toDateString() === yesterday.toDateString()) label = "Ontem";
  else label = date.toLocaleDateString("pt-PT", { day: "numeric", month: "long" });
  return (
    <div className="day-divider">
      <span>{label}</span>
    </div>
  );
}

export function Loading({ label = "A carregar" }) {
  return (
    <div className="empty" style={{ padding: "30px 24px", textAlign: "center" }}>
      <span className="dots">{label}</span>
    </div>
  );
}

export function Empty({ emoji, title, detail }) {
  return (
    <div className="empty" style={{ padding: "60px 24px", textAlign: "center" }}>
      {emoji ? <div className="empty-emoji">{emoji}</div> : null}
      {title ? <div style={{ fontSize: 16, fontWeight: 600, marginTop: 6 }}>{title}</div> : null}
      {detail ? <div style={{ color: "var(--muted)", marginTop: 6 }}>{detail}</div> : null}
    </div>
  );
}
