import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function SheetModal({ title, children, onClose }) {
  const node = (
    <div
      className="sheet-modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "rgba(0,0,0,.6)",
        backdropFilter: "blur(6px)"
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: "#121212",
          borderTop: "1px solid var(--border)",
          borderRadius: "22px 22px 0 0",
          padding: "18px 18px calc(18px + env(safe-area-inset-bottom))",
          animation: "slideUp .28s cubic-bezier(.2,.8,.2,1)",
          boxShadow: "0 -20px 60px -10px rgba(0,0,0,.8)"
        }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "#333", margin: "0 auto 12px" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ fontWeight: 700, fontSize: 17, margin: 0, letterSpacing: "-.01em" }}>{title}</h3>
          <button className="icon-btn tap" type="button" aria-label="Fechar" onClick={onClose} style={{ margin: -6 }}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
      <style>{`@keyframes slideUp { from { transform: translateY(100%);} to { transform: translateY(0);} }`}</style>
    </div>
  );
  return createPortal(node, document.body);
}

export function SideDrawer({ children, onClose }) {
  const [closing, setClosing] = useState(false);
  const close = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => onClose?.(), 340);
  };

  useEffect(() => {
    document.body.classList.add("drawer-open");
    document.documentElement.classList.add("drawer-open");
    return () => {
      document.body.classList.remove("drawer-open");
      document.documentElement.classList.remove("drawer-open");
    };
  }, []);

  const node = (
    <>
      <div className={`drawer-backdrop ${closing ? "" : "open"}`} onClick={close} />
      <aside id="drawer" className={`drawer ${closing ? "" : "open"}`} role="dialog" aria-modal="true">
        {typeof children === "function" ? children({ close }) : children}
      </aside>
    </>
  );
  return createPortal(node, document.body);
}
