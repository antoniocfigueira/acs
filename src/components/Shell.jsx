import React, { useEffect } from "react";
import { Bell, Home, MessageCircle, Newspaper, Plus, Send, User, Users } from "lucide-react";
import { legacyPages } from "../legacy-pages.generated.js";
import { hrefFor, navigateHref, routeTo } from "../lib/navigation.js";

export function PageFrame({ page, children, threadOpen = false }) {
  useEffect(() => {
    const bodyClass = {
      "index.html": "page feed-page",
      "login.html": "page login-page",
      "chat.html": "page chat-page",
      "dm.html": "page dm-page"
    }[page] || "page";
    document.body.className = `${bodyClass}${threadOpen ? " dm-thread-open" : ""}`;
    document.title = page === "chat.html" ? "Chat Global" : page === "dm.html" ? "Mensagens" : "Alfa Club";
    return () => {
      document.body.className = "page";
    };
  }, [page, threadOpen]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: legacyPages[page]?.inlineStyles || "" }} />
      <main data-react-page={page}>{children}</main>
    </>
  );
}

export function GradientDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="gradStroke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="55%" stopColor="#ec4899" />
          <stop offset="100%" stopColor="#7dd3fc" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function BackButton() {
  return (
    <button
      className="icon-btn tap"
      aria-label="Voltar"
      type="button"
      onClick={() => {
        if (window.history.length > 1) window.history.back();
        else routeTo("index.html");
      }}
    >
      <LegacyBackIcon />
    </button>
  );
}

export function LegacyBackIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function LegacySettingsIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function AppHeader({ title, subtitle, right, children }) {
  return (
    <header className="app-header app-header-centered">
      <div className="app-header-left">
        <BackButton />
      </div>
      <div className="app-header-title">
        {children || (
          <>
            <div className="logo grad-text" style={{ fontSize: 18 }}>
              {title}
            </div>
            {subtitle ? <div style={{ fontSize: 11, color: "var(--muted)" }}>{subtitle}</div> : null}
          </>
        )}
      </div>
      <div className="app-header-right">{right}</div>
    </header>
  );
}

function NavLink({ page, active, label, children, className = "" }) {
  return (
    <a
      href={hrefFor(page)}
      className={`${active ? "active" : ""} ${className}`.trim()}
      aria-label={label}
      onClick={(event) => {
        event.preventDefault();
        navigateHref(page);
      }}
    >
      {children}
      <span>{label}</span>
    </a>
  );
}

export function BottomNav({ active }) {
  const fabPhase = `${-((Date.now() % 10000) / 1000)}s`;
  return (
    <nav className="bottom-nav">
      <NavLink page="index.html" active={active === "index.html"} label="Inicio">
        <Home size={22} />
      </NavLink>
      <NavLink page="dm.html" active={active === "dm.html"} label="DMs">
        <MessageCircle size={22} />
      </NavLink>
      <a
        href={hrefFor("index.html", "", "#create")}
        className="create"
        aria-label="Criar post"
        style={{ "--fab-phase": fabPhase }}
        onClick={(event) => {
          event.preventDefault();
          routeTo("index.html", "", "#create");
        }}
      >
        <Plus size={22} />
      </a>
      <NavLink page="chat.html" active={active === "chat.html"} label="Chat Global">
        <LegacyChatIcon />
      </NavLink>
      <NavLink page="profile.html" active={active === "profile.html"} label="Eu">
        <User size={22} />
      </NavLink>
    </nav>
  );
}

function LegacyChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  );
}

export function SendIcon() {
  return <Send size={18} />;
}

export function HeaderUsersButton({ onClick }) {
  return (
    <button className="icon-btn tap" type="button" aria-label="Utilizadores online" onClick={onClick}>
      <Users size={22} />
    </button>
  );
}

export function HeaderNewDmButton({ onClick }) {
  return (
    <button className="icon-btn tap" type="button" aria-label="Nova conversa" title="Nova conversa" onClick={onClick}>
      <MessageCircle size={22} />
    </button>
  );
}

export function HeaderNewsButton({ onClick }) {
  return (
    <button className="icon-btn tap" type="button" aria-label="Alfa News" onClick={onClick}>
      <Newspaper size={22} />
    </button>
  );
}

export function HeaderNotifButton({ onClick }) {
  return (
    <button className="icon-btn tap" type="button" aria-label="Notificacoes" onClick={onClick}>
      <Bell size={22} />
    </button>
  );
}
