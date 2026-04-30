import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getFirestore } from "firebase/firestore";
import { getMessaging, getToken, isSupported as isMessagingSupported } from "firebase/messaging";
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

export async function initPush() {
  try {
    if (!("Notification" in window)) return null;
    if (!(await isMessagingSupported())) return null;
    if (!messaging) messaging = getMessaging(app);
    if (Notification.permission !== "granted") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return null;
    }
    const registration = await registerMessagingSW();
    if (!registration) return null;
    return await getToken(messaging, {
      vapidKey: fcmVapidKey,
      serviceWorkerRegistration: registration
    });
  } catch (err) {
    console.warn("[Alfa] initPush erro:", err?.message || err);
    return null;
  }
}
