import { useEffect, useRef } from "react";

const INDICATOR_SVG = `
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="23 4 23 10 17 10"/>
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>`;

export function usePullToRefresh(containerRef, { enabled = true, onRefresh } = {}) {
  const refreshRef = useRef(onRefresh);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const container = containerRef?.current;
    if (!enabled || !container) return undefined;

    container.classList.add("pull-container");

    const threshold = 70;
    const maxPull = 110;
    let pullStartY = 0;
    let isPulling = false;
    let activePull = false;
    let indicator = null;
    let pulled = 0;
    let refreshing = false;
    let resetTimer = null;
    let clearInlineTimer = null;

    const atTop = () => {
      const y = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
      return y <= 2;
    };

    const blockedByOverlay = () => document.body.classList.contains("drawer-open") || !!document.querySelector(".sheet-modal-backdrop");

    const createIndicator = () => {
      if (indicator) return;
      indicator = document.createElement("div");
      indicator.className = "pull-indicator";
      indicator.innerHTML = INDICATOR_SVG;
      document.body.appendChild(indicator);
    };

    const resetView = () => {
      if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
      if (clearInlineTimer) {
        clearTimeout(clearInlineTimer);
        clearInlineTimer = null;
      }

      container.classList.remove("pulling");
      container.offsetHeight;
      container.style.transform = "translateY(0px)";
      clearInlineTimer = window.setTimeout(() => {
        container.style.transform = "";
        clearInlineTimer = null;
      }, 400);

      if (indicator) {
        const current = indicator;
        indicator = null;
        current.classList.remove("ready", "refreshing");
        current.style.transition = "transform .3s ease, opacity .3s ease";
        current.style.opacity = "0";
        current.style.transform = "translateX(-50%) translateY(-10px) scale(.7)";
        window.setTimeout(() => {
          try { current.remove(); } catch {}
        }, 350);
      }
      refreshing = false;
    };

    const touchStart = (event) => {
      if (refreshing || blockedByOverlay() || !atTop()) return;
      if (event.touches.length !== 1) return;
      pullStartY = event.touches[0].clientY;
      isPulling = true;
      activePull = false;
      pulled = 0;
    };

    const touchMove = (event) => {
      if (refreshing || !isPulling || event.touches.length !== 1) return;
      const delta = event.touches[0].clientY - pullStartY;
      if (delta <= 0) return;
      if (blockedByOverlay() || !atTop()) {
        isPulling = false;
        return;
      }

      if (!activePull && delta > 6) {
        activePull = true;
        createIndicator();
        container.classList.add("pulling");
      }
      if (!activePull) return;

      pulled = Math.min(maxPull, delta * 0.55);
      event.preventDefault();
      container.style.transform = `translateY(${pulled}px)`;

      if (indicator) {
        const progress = Math.min(1, pulled / threshold);
        indicator.style.opacity = String(progress);
        const rot = pulled * 4;
        const scale = 0.7 + 0.3 * progress;
        const ty = Math.min(pulled * 0.55, 36);
        indicator.style.transform = `translateX(-50%) translateY(${ty}px) scale(${scale}) rotate(${rot}deg)`;
        indicator.classList.toggle("ready", pulled > threshold);
      }
    };

    const endPull = () => {
      if (!isPulling) return;
      isPulling = false;
      if (!activePull) {
        activePull = false;
        pulled = 0;
        return;
      }
      activePull = false;

      if (pulled > threshold) {
        refreshing = true;
        container.classList.remove("pulling");
        container.style.transform = "translateY(44px)";
        if (indicator) {
          indicator.classList.add("refreshing", "ready");
          indicator.style.opacity = "1";
          indicator.style.transform = "translateX(-50%) translateY(28px) scale(1) rotate(0deg)";
        }
        try {
          Promise.resolve(refreshRef.current?.()).catch(() => {});
        } catch {}
        resetTimer = window.setTimeout(resetView, 650);
      } else {
        resetView();
      }
      pulled = 0;
    };

    const cancelPull = () => {
      if (!isPulling && !refreshing && !indicator) return;
      isPulling = false;
      activePull = false;
      pulled = 0;
      resetView();
    };

    const visibilityReset = () => {
      if (document.visibilityState === "visible" && (refreshing || indicator)) resetView();
    };

    document.addEventListener("touchstart", touchStart, { passive: true });
    document.addEventListener("touchmove", touchMove, { passive: false });
    document.addEventListener("touchend", endPull);
    document.addEventListener("touchcancel", cancelPull);
    document.addEventListener("visibilitychange", visibilityReset);

    return () => {
      document.removeEventListener("touchstart", touchStart);
      document.removeEventListener("touchmove", touchMove);
      document.removeEventListener("touchend", endPull);
      document.removeEventListener("touchcancel", cancelPull);
      document.removeEventListener("visibilitychange", visibilityReset);
      if (resetTimer) clearTimeout(resetTimer);
      if (clearInlineTimer) clearTimeout(clearInlineTimer);
      container.classList.remove("pull-container", "pulling");
      container.style.transform = "";
      if (indicator) {
        try { indicator.remove(); } catch {}
      }
    };
  }, [containerRef, enabled]);
}
