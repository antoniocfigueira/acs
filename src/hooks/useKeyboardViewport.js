import { useEffect } from "react";

export function useKeyboardViewport({ enabled = true, scrollRef } = {}) {
  useEffect(() => {
    if (!enabled) return undefined;
    const vv = window.visualViewport;
    if (!vv) return undefined;

    const isMobileLike = () => window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 820;
    let pollId = null;
    let resetId = null;

    const apply = () => {
      const layoutH = window.innerHeight;
      const visualH = vv.height;
      const offsetTop = vv.offsetTop || 0;
      const kbHeight = Math.max(0, layoutH - visualH - offsetTop);
      const keyboardOpen = isMobileLike() && kbHeight > 0;
      document.body.classList.toggle("keyboard-open", keyboardOpen);
      document.documentElement.style.setProperty("--alfa-viewport-height", keyboardOpen ? `${visualH}px` : "100dvh");
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
      if (isTextEntryFocused()) return;
      document.body.classList.remove("keyboard-open");
      document.body.style.height = "";
      document.body.style.minHeight = "";
      document.documentElement.style.setProperty("--alfa-viewport-height", "100dvh");
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
      setTimeout(apply, 60);
      setTimeout(apply, 260);
      resetId = setTimeout(forceReset, 520);
      poll();
    };

    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("focusin", focusIn);
    document.addEventListener("focusout", focusOut);
    apply();

    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("focusout", focusOut);
      if (pollId) clearInterval(pollId);
      if (resetId) clearTimeout(resetId);
      document.body.classList.remove("keyboard-open");
      document.body.style.height = "";
      document.body.style.minHeight = "";
      document.documentElement.style.removeProperty("--alfa-viewport-height");
    };
  }, [enabled, scrollRef]);
}
