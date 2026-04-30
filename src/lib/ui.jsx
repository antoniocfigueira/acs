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
  if (user?.nameStyle === "grad") return <span className="name-grad-anim">{name}</span>;
  if (user?.nameColor) return <span style={{ color: user.nameColor }}>{name}</span>;
  return <>{name}</>;
}

export function RoleBadges({ user }) {
  return (
    <>
      {user?.isAdmin ? (
        <span className="admin-badge role-badge" title="Admin" aria-label="Admin">
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M12 2l2.39 5.46L20 8.27l-4.19 3.94L17.03 18 12 15.27 6.97 18l1.22-5.79L4 8.27l5.61-.81L12 2z" />
          </svg>
        </span>
      ) : null}
      {user?.isMod || user?.role === "mod" ? (
        <span className="mod-pill role-badge" title="Moderador">
          mod
        </span>
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
