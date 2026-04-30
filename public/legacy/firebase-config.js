// =========================================================
// Firebase configuration
// =========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

// 🔻 CONFIG 🔻
const firebaseConfig = {
  apiKey: "AIzaSyBL4clPmPLR8_uFaBZ1Yah18GQFwIckHf8",
  authDomain: "alfa-club-social.firebaseapp.com",
  databaseURL: "https://alfa-club-social-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "alfa-club-social",
  storageBucket: "alfa-club-social.firebasestorage.app",
  messagingSenderId: "591980705826",
  appId: "1:591980705826:web:352d9152e465f3b610f27b",
  measurementId: "G-CHNL535RB8"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
export const storage = getStorage(app);

// =========================================================
// PUSH (FCM)
// =========================================================
export const fcmVapidKey = "BPYbr8V2LZ-n-GkMGp0NefSf_B5i_J_nAtJejLeX-tPfq5ggiWoyucXFb3Cu9OkC-49smu6B6xVa3rjsW_54TJw";

export const messaging = getMessaging(app);

// Registers the firebase-messaging service worker (relative path) under
// a dedicated scope so it does not conflict with the main service-worker.js
// which is registered at the site root.
export async function registerMessagingSW() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    // Scope must be a subpath so it doesn't clobber the main SW.
    // The SW file itself lives at ./firebase-messaging-sw.js (site root).
    const reg = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js",
      { scope: "/firebase-cloud-messaging-push-scope/" }
    );
    // Wait until the SW is active so getToken() doesn't race.
    if (reg.installing) {
      await new Promise((resolve) => {
        reg.installing.addEventListener("statechange", (e) => {
          if (e.target.state === "activated" || e.target.state === "redundant") resolve();
        });
      });
    }
    return reg;
  } catch (e) {
    console.warn("[Alfa] FCM SW register falhou:", e?.message || e);
    return null;
  }
}

// Kept for backwards compatibility. Callers should prefer
// requestNotifPermissionOnce() / setupFCMTokenIfAvailable() in app.js.
export async function initPush() {
  try {
    if (!("Notification" in window)) return null;
    if (Notification.permission !== "granted") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return null;
    }
    const registration = await registerMessagingSW();
    if (!registration) return null;
    const token = await getToken(messaging, {
      vapidKey: fcmVapidKey,
      serviceWorkerRegistration: registration
    });
    return token || null;
  } catch (err) {
    console.warn("[Alfa] initPush erro:", err?.message || err);
    return null;
  }
}

// helper
if (firebaseConfig.apiKey === "YOUR_API_KEY") {
  console.warn("[Alfa] ⚠️ firebase-config.js não configurado");
}