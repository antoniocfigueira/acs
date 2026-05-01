import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { getFirestore } from "firebase/firestore";
import { getMessaging, getToken, isSupported as isMessagingSupported, onMessage } from "firebase/messaging";
import { getStorage } from "firebase/storage";

export const firebaseConfig = {
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

export const fcmVapidKey = "BPYbr8V2LZ-n-GkMGp0NefSf_B5i_J_nAtJejLeX-tPfq5ggiWoyucXFb3Cu9OkC-49smu6B6xVa3rjsW_54TJw";
export let messaging = null;
let fcmSetupPromise = null;
let foregroundMessageAttached = false;
const localNotifShown = new Map();

export async function registerMessagingSW() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const base = import.meta.env.BASE_URL || "/";
    const reg = await navigator.serviceWorker.register(`${base}firebase-messaging-sw.js`, {
      scope: `${base}firebase-cloud-messaging-push-scope/`
    });
    if (reg.installing) {
      await new Promise((resolve) => {
        reg.installing.addEventListener("statechange", (event) => {
          if (event.target.state === "activated" || event.target.state === "redundant") resolve();
        });
      });
    }
    return reg;
  } catch (err) {
    console.warn("[Alfa] FCM SW register falhou:", err?.message || err);
    return null;
  }
}

export function getNotifPrefs() {
  try {
    return {
      dm: true,
      globalChat: false,
      news: true,
      engagement: true,
      ...(JSON.parse(localStorage.getItem("acs_notif_prefs_v1") || "{}") || {})
    };
  } catch {
    return { dm: true, globalChat: false, news: true, engagement: true };
  }
}

export function getNotifPref(category) {
  if (!category) return true;
  return !!getNotifPrefs()[category];
}

export function canShowNotifs() {
  return "Notification" in window && Notification.permission === "granted";
}

export function playNotificationSound({ force = false } = {}) {
  try {
    if (!force && localStorage.getItem("acs_notification_sound_v1") === "0") return false;
    const base = import.meta.env.BASE_URL || "/";
    const audio = new Audio(`${base}sounds/notification.mp3`);
    audio.preload = "auto";
    audio.volume = 0.8;
    const result = audio.play();
    if (result?.catch) result.catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export function showLocalNotification({ title, body, icon, tag, data, forceVisible = false, source = "fcm", category = null }) {
  try {
    if (!canShowNotifs()) return null;
    if (localStorage.getItem("acs_push_pref_v1") === "0") return null;
    if (category && !getNotifPref(category)) return null;
    if (source === "client" && window.__fcmActive === true) return null;

    const dedupTag = tag || "alfa-notif";
    const now = Date.now();
    for (const [key, at] of localNotifShown) {
      if (now - at > 4000) localNotifShown.delete(key);
    }
    const previous = localNotifShown.get(dedupTag);
    if (previous && now - previous < 4000) return null;
    localNotifShown.set(dedupTag, now);

    const isActive = document.visibilityState === "visible" && document.hasFocus();
    if (!forceVisible && isActive) return null;
    playNotificationSound();

    const options = {
      body: body || "",
      icon: icon || `${import.meta.env.BASE_URL || "/"}icons/icon-192.png`,
      badge: `${import.meta.env.BASE_URL || "/"}icons/icon-192.png`,
      tag: dedupTag,
      data: data || {},
      vibrate: [50, 30, 50]
    };

    if (navigator.serviceWorker?.ready) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification(title || "Alfa Club", options))
        .catch(() => new Notification(title || "Alfa Club", options));
    } else {
      new Notification(title || "Alfa Club", options);
    }
    return true;
  } catch {
    return false;
  }
}

export async function writeMessagingSelfUid(uid) {
  try {
    const req = indexedDB.open("alfa-sw-state", 1);
    await new Promise((resolve) => {
      req.onupgradeneeded = () => {
        try { req.result.createObjectStore("kv"); } catch {}
      };
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction("kv", "readwrite");
          tx.objectStore("kv").put(uid || "", "selfUid");
          tx.oncomplete = () => { try { req.result.close(); } catch {}; resolve(); };
          tx.onerror = () => { try { req.result.close(); } catch {}; resolve(); };
        } catch {
          resolve();
        }
      };
      req.onerror = () => resolve();
    });
  } catch {}
}

function deviceId() {
  try {
    let id = localStorage.getItem("acs_device_id") || "";
    if (!id) {
      id = crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("acs_device_id", id);
    }
    return id;
  } catch {
    return "";
  }
}

export async function initPush({ user = auth.currentUser, requestPermission = true } = {}) {
  try {
    if (!("Notification" in window)) return null;
    if (!(await isMessagingSupported())) return null;
    if (!messaging) messaging = getMessaging(app);
    if (Notification.permission !== "granted") {
      if (!requestPermission) return null;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return null;
    }
    const registration = await registerMessagingSW();
    if (!registration) return null;
    const token = await getToken(messaging, {
      vapidKey: fcmVapidKey,
      serviceWorkerRegistration: registration
    });
    if (token) {
      window.__fcmActive = true;
      const uid = user?.uid || auth.currentUser?.uid || "";
      await writeMessagingSelfUid(uid);
      if (uid) {
        const id = deviceId();
        await setDoc(doc(db, "users", uid, "fcmTokens", token), {
          at: serverTimestamp(),
          ua: navigator.userAgent.slice(0, 200),
          deviceId: id
        }, { merge: true });
        try {
          const tokensSnap = await getDocs(collection(db, "users", uid, "fcmTokens"));
          await Promise.all(tokensSnap.docs.map((item) => {
            if (item.id === token) return null;
            if (id && item.data()?.deviceId === id) return deleteDoc(item.ref);
            return null;
          }).filter(Boolean));
        } catch {}
      }
    }

    if (!foregroundMessageAttached) {
      foregroundMessageAttached = true;
      onMessage(messaging, (payload) => {
        const n = payload.notification || {};
        const d = payload.data || {};
        const uid = auth.currentUser?.uid || "";
        if (uid && d.senderUid && d.senderUid === uid) return;
        showLocalNotification({
          title: d.title || n.title || "Alfa Club",
          body: d.body || n.body || "",
          icon: d.icon || n.icon,
          tag: d.tag || n.tag || "alfa-fcm",
          data: d,
          forceVisible: true,
          source: "fcm"
        });
      });
    }
    return token;
  } catch (err) {
    console.warn("[Alfa] initPush erro:", err?.message || err);
    return null;
  }
}

export function setupPushIfAllowed(user) {
  if (fcmSetupPromise) return fcmSetupPromise;
  fcmSetupPromise = (async () => {
    await writeMessagingSelfUid(user?.uid || "");
    if (!("Notification" in window)) return null;
    if (Notification.permission !== "granted") return null;
    if (localStorage.getItem("acs_push_pref_v1") === "0") return null;
    return initPush({ user, requestPermission: false });
  })().finally(() => {
    fcmSetupPromise = null;
  });
  return fcmSetupPromise;
}
