import { useEffect, useState } from "react";

const ADMIN_VIEW_KEY = "acs_admin_view_v1";
// Stored under the legacy `acs_admin_plus_v1` key so existing toggles
// stay in sync; the user-facing label changed to SYSTEM but the wire
// value is the same boolean.
const SYSTEM_KEY = "acs_admin_plus_v1";
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
  if (!value) writeFlag(SYSTEM_KEY, false);
}

// SYSTEM (formerly "Admin+") — the unrestricted edit-everything mode.
// Granting an admin SYSTEM access lets them edit literally any database
// variable (profile photo upload, points, followers, post counters,
// stories metadata, etc.) and exposes destructive controls like the
// "wipe everything" button in the drawer.
export function getSystemEnabled() {
  return readFlag(SYSTEM_KEY, false);
}

export function setSystemEnabled(value) {
  writeFlag(SYSTEM_KEY, !!value);
}

// ── Back-compat aliases. Older imports across the codebase still ask
// for getAdminPlusEnabled / setAdminPlusEnabled — keep them as thin
// wrappers so we don't have to touch every call-site at once.
export const getAdminPlusEnabled = getSystemEnabled;
export const setAdminPlusEnabled = setSystemEnabled;

export function useAdminMode(profile) {
  const isAdmin = !!profile?.isAdmin;
  const read = () => {
    const adminView = isAdmin ? getAdminViewEnabled() : false;
    const system = adminView && isAdmin ? getSystemEnabled() : false;
    return {
      isAdmin,
      adminView,
      // New name (preferred)
      system,
      // Legacy name (kept for components not yet migrated)
      adminPlus: system
    };
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
