import React, { useEffect } from "react";
import { Bell, ChevronLeft, Home, MessageCircle, Newspaper, Plus, Send, User, Users } from "lucide-react";
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
      <ChevronLeft size={22} />
    </button>
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
        onClick={(event) => {
          event.preventDefault();
          routeTo("index.html", "", "#create");
        }}
      >
        <Plus size={22} />
      </a>
      <NavLink page="chat.html" active={active === "chat.html"} label="Chat">
        <Users size={22} />
      </NavLink>
      <NavLink page="profile.html" active={active === "profile.html"} label="Eu">
        <User size={22} />
      </NavLink>
    </nav>
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
