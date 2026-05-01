import { useEffect } from "react";

export function useKeyboardViewport({ enabled = true, scrollRef } = {}) {
  useEffect(() => {
    if (!enabled) return undefined;
    const vv = window.visualViewport;
    if (!vv) return undefined;

    const isMobileLike = () => window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 820;
    let pollId = null;
    let resetId = null;
    let maxViewportHeight = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0, vv.height || 0);

    const apply = () => {
      const layoutH = window.innerHeight;
      const visualH = vv.height;
      const offsetTop = vv.offsetTop || 0;
      if (!isTextEntryFocused()) {
        maxViewportHeight = Math.max(maxViewportHeight, layoutH, document.documentElement.clientHeight || 0, visualH);
      }
      const kbHeight = Math.max(0, layoutH - visualH - offsetTop);
      const keyboardDelta = Math.max(kbHeight, maxViewportHeight - visualH);
      const keyboardOpen = isMobileLike() && keyboardDelta > 80 && isTextEntryFocused();
      document.body.classList.toggle("keyboard-open", keyboardOpen);
      document.documentElement.style.setProperty("--alfa-viewport-height", `${Math.round(visualH)}px`);
      if (keyboardOpen) {
        document.body.style.height = `${visualH}px`;
        document.body.style.minHeight = `${visualH}px`;
      } else {
        document.body.style.height = "";
        document.body.style.minHeight = "";
      }
      if (offsetTop !== 0) window.scrollTo(0, 0);
    };

    const forceReset = () => {
      document.body.classList.remove("keyboard-open");
      document.body.style.height = "";
      document.body.style.minHeight = "";
      const fullHeight = Math.max(
        maxViewportHeight,
        window.innerHeight || 0,
        document.documentElement.clientHeight || 0,
        vv.height || 0
      );
      maxViewportHeight = fullHeight;
      document.documentElement.style.setProperty("--alfa-viewport-height", `${Math.round(fullHeight)}px`);
      const node = scrollRef?.current;
      if (node) node.scrollTop = node.scrollHeight;
      window.scrollTo(0, 0);
    };

    const isTextEntryFocused = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable);
    };

    const onScroll = () => {
      if (!isTextEntryFocused()) return;
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    };

    const poll = () => {
      if (pollId) clearInterval(pollId);
      let last = vv.height;
      let ticks = 0;
      pollId = setInterval(() => {
        ticks++;
        if (vv.height !== last) {
          last = vv.height;
          apply();
        }
        if (ticks >= 12) {
          clearInterval(pollId);
          pollId = null;
          apply();
        }
      }, 90);
    };

    const focusIn = () => {
      apply();
      setTimeout(apply, 50);
      setTimeout(apply, 180);
      setTimeout(apply, 360);
      poll();
      setTimeout(() => {
        const node = scrollRef?.current;
        if (node) node.scrollTop = node.scrollHeight;
      }, 420);
    };

    const focusOut = () => {
      if (resetId) clearTimeout(resetId);
      requestAnimationFrame(forceReset);
      setTimeout(forceReset, 90);
      setTimeout(apply, 180);
      resetId = setTimeout(forceReset, 320);
      poll();
    };

    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("focusin", focusIn);
    document.addEventListener("focusout", focusOut);
    document.addEventListener("visibilitychange", apply);
    apply();

    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("focusout", focusOut);
      document.removeEventListener("visibilitychange", apply);
      if (pollId) clearInterval(pollId);
      if (resetId) clearTimeout(resetId);
      document.body.classList.remove("keyboard-open");
      document.body.style.height = "";
      document.body.style.minHeight = "";
      document.documentElement.style.removeProperty("--alfa-viewport-height");
    };
  }, [enabled, scrollRef]);
}
