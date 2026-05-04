import { useEffect, useState } from "react";

const ADMIN_VIEW_KEY = "acs_admin_view_v1";
const ADMIN_PLUS_KEY = "acs_admin_plus_v1";
const EVENT = "alfa-admin-mode";

function readFlag(key, fallback = false) {
  try {
    const value = localStorage.getItem(key);
    if (value === null) return fallback;
    return value === "1";
  } catch {
    return fallback;
  }
}

function writeFlag(key, value) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {}
}

export function getAdminViewEnabled() {
  return readFlag(ADMIN_VIEW_KEY, true);
}

export function setAdminViewEnabled(value) {
  writeFlag(ADMIN_VIEW_KEY, !!value);
  if (!value) writeFlag(ADMIN_PLUS_KEY, false);
}

export function getAdminPlusEnabled() {
  return readFlag(ADMIN_PLUS_KEY, false);
}

export function setAdminPlusEnabled(value) {
  writeFlag(ADMIN_PLUS_KEY, !!value);
}

export function useAdminMode(profile) {
  const isAdmin = !!profile?.isAdmin;
  const read = () => {
    const adminView = isAdmin ? getAdminViewEnabled() : false;
    const adminPlus = adminView && isAdmin ? getAdminPlusEnabled() : false;
    return { isAdmin, adminView, adminPlus };
  };
  const [state, setState] = useState(read);

  useEffect(() => {
    const update = () => setState(read());
    update();
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, [isAdmin]);

  return state;
}
