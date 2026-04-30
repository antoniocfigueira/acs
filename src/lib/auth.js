import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, updateProfile } from "firebase/auth";
import {
  collection,
  collectionGroup,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "firebase/firestore";
import { equalTo, get as rtGet, orderByChild, query as rtQuery, ref as rtRef, update as rtUpdate } from "firebase/database";
import { useEffect, useState } from "react";
import { auth, db, rtdb } from "./firebase.js";
import { routeTo } from "./navigation.js";

let registering = false;

function isRegistering() {
  if (registering) return true;
  try {
    return sessionStorage.getItem("alfa_registering") === "1";
  } catch {
    return false;
  }
}

async function generateIdNumber() {
  return await runTransaction(db, async (tx) => {
    const counterRef = doc(db, "meta", "userCounter");
    const snap = await tx.get(counterRef);
    const next = snap.exists() ? (snap.data().count || 0) + 1 : 1;
    tx.set(counterRef, { count: next }, { merge: true });
    return next;
  });
}

async function findFreeUsername(base) {
  let root = base.toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 15);
  if (root.length < 3) root = "user";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}${i}`;
    const snap = await getDoc(doc(db, "usernames", candidate));
    if (!snap.exists()) return candidate;
  }
  return `${root}${Date.now()}`;
}

export async function ensureProfile(user) {
  const userRef = doc(db, "users", user.uid);
  let snap = await getDoc(userRef);
  if (snap.exists()) return snap.data();

  if (isRegistering()) {
    for (let i = 0; i < 15; i++) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      snap = await getDoc(userRef);
      if (snap.exists()) return snap.data();
      if (!isRegistering()) break;
    }
    snap = await getDoc(userRef);
    if (snap.exists()) return snap.data();
  }

  const seedName = user.displayName || (user.email ? user.email.split("@")[0] : "User");
  const username = await findFreeUsername(seedName);
  const idNumber = await generateIdNumber();
  const profile = {
    uid: user.uid,
    email: user.email || "",
    name: seedName,
    username,
    bio: "",
    photoURL: user.photoURL || "",
    idNumber,
    followers: 0,
    following: 0,
    postsCount: 0,
    createdAt: serverTimestamp(),
    points: 0
  };
  await setDoc(userRef, profile);
  await setDoc(doc(db, "usernames", username), { uid: user.uid });
  return profile;
}

export async function registerUser({ email, password, name, username, bio = "" }) {
  const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_.]/g, "");
  if (!cleanUsername) throw new Error("Nome de utilizador invalido.");
  if (cleanUsername.length < 3) throw new Error("Username muito curto (minimo 3).");

  const usernameRef = doc(db, "usernames", cleanUsername);
  const usernameSnap = await getDoc(usernameRef);
  if (usernameSnap.exists()) throw new Error("Esse @username ja esta usado.");

  registering = true;
  try {
    sessionStorage.setItem("alfa_registering", "1");
  } catch {}
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    try {
      await updateProfile(cred.user, { displayName: name });
    } catch {}
    const idNumber = await generateIdNumber();
    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      email,
      name,
      username: cleanUsername,
      bio,
      photoURL: "",
      idNumber,
      followers: 0,
      following: 0,
      postsCount: 0,
      createdAt: serverTimestamp(),
      points: 0
    });
    await setDoc(usernameRef, { uid: cred.user.uid });
    return cred.user;
  } finally {
    registering = false;
    try {
      sessionStorage.removeItem("alfa_registering");
    } catch {}
  }
}

export async function loginUser({ email, password }) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  try {
    await ensureProfile(cred.user);
  } catch (err) {
    console.warn("ensureProfile:", err);
  }
  return cred.user;
}

export async function logout() {
  await signOut(auth);
  routeTo("login.html");
}

export async function getCurrentProfile() {
  const user = auth.currentUser;
  if (!user) return null;
  const snap = await getDoc(doc(db, "users", user.uid));
  return snap.exists() ? snap.data() : null;
}

export function useAuthProfile({ requireUser = false, redirectToLogin = true } = {}) {
  const [state, setState] = useState({ loading: true, user: null, profile: null, error: null });

  useEffect(() => {
    let alive = true;
    let profileUnsub = null;
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (profileUnsub) {
        profileUnsub();
        profileUnsub = null;
      }
      if (!alive) return;
      if (!user) {
        setState({ loading: false, user: null, profile: null, error: null });
        if (requireUser && redirectToLogin) routeTo("login.html");
        return;
      }
      try {
        await ensureProfile(user);
        profileUnsub = onSnapshot(doc(db, "users", user.uid), (snap) => {
          if (!alive) return;
          setState({ loading: false, user, profile: snap.exists() ? snap.data() : null, error: null });
        }, (err) => {
          if (alive) setState({ loading: false, user, profile: null, error: err });
        });
      } catch (err) {
        if (alive) setState({ loading: false, user, profile: null, error: err });
      }
    });
    return () => {
      alive = false;
      if (profileUnsub) profileUnsub();
      unsub();
    };
  }, [redirectToLogin, requireUser]);

  return state;
}

export async function updateMyProfile(data) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  await updateDoc(doc(db, "users", user.uid), data);
  if (data.name) {
    try {
      await updateProfile(user, { displayName: data.name });
    } catch {}
  }

  const historyFields = {};
  if (data.name !== undefined) historyFields.authorName = data.name;
  if (data.photoURL !== undefined) historyFields.authorPhoto = data.photoURL || "";
  if (data.username !== undefined) historyFields.authorUsername = data.username || "";
  if (data.nameColor !== undefined) historyFields.authorNameColor = data.nameColor === null ? deleteField() : data.nameColor || "";
  if (data.nameStyle !== undefined) historyFields.authorNameStyle = data.nameStyle === null ? deleteField() : data.nameStyle || "";
  if (data.isAdmin !== undefined) historyFields.authorIsAdmin = !!data.isAdmin;
  if (data.isMod !== undefined) historyFields.authorIsMod = !!data.isMod;
  if (data.role !== undefined) historyFields.authorRole = data.role || "user";
  if (!Object.keys(historyFields).length) return;

  await Promise.all([
    propagateCollectionAuthor("posts", user.uid, historyFields),
    propagateCollectionAuthor("stories", user.uid, historyFields),
    propagateCommentAuthor(user.uid, historyFields),
    propagateGlobalChatAuthor(user.uid, historyFields)
  ]);
}

async function propagateCollectionAuthor(name, uid, fields) {
  try {
    const snap = await getDocs(query(collection(db, name), where("uid", "==", uid)));
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.forEach((item) => batch.update(item.ref, fields));
    await batch.commit();
  } catch (err) {
    console.warn(`${name} history update skipped:`, err?.message || err);
  }
}

async function propagateCommentAuthor(uid, fields) {
  try {
    const snap = await getDocs(query(collectionGroup(db, "comments"), where("uid", "==", uid)));
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.forEach((item) => batch.update(item.ref, fields));
    await batch.commit();
  } catch (err) {
    console.warn("comments history update skipped:", err?.message || err);
  }
}

async function propagateGlobalChatAuthor(uid, fields) {
  try {
    const fieldMap = {
      authorName: "name",
      authorUsername: "username",
      authorPhoto: "photoURL",
      authorIsAdmin: "isAdmin",
      authorRole: "role",
      authorNameColor: "nameColor",
      authorNameStyle: "nameStyle"
    };
    const updates = {};
    const snap = await rtGet(rtQuery(rtRef(rtdb, "chat/messages"), orderByChild("uid"), equalTo(uid)));
    if (!snap.exists()) return;
    snap.forEach((child) => {
      for (const [source, target] of Object.entries(fieldMap)) {
        if (Object.prototype.hasOwnProperty.call(fields, source)) {
          updates[`${child.key}/${target}`] = fields[source];
        }
      }
    });
    if (Object.keys(updates).length) await rtUpdate(rtRef(rtdb, "chat/messages"), updates);
  } catch (err) {
    console.warn("global chat history update skipped:", err?.message || err);
  }
}

export async function incrementUserPoints(uid, amount) {
  if (!uid || !amount) return;
  try {
    await updateDoc(doc(db, "users", uid), { points: increment(amount), totalPointsEarned: increment(Math.max(0, amount)) });
  } catch (err) {
    console.warn("points update:", err?.message || err);
  }
}

export async function getUserByUsername(username) {
  const clean = (username || "").toLowerCase().replace(/^@/, "");
  if (!clean) return null;
  const snap = await getDoc(doc(db, "usernames", clean));
  if (!snap.exists()) return null;
  const userSnap = await getDoc(doc(db, "users", snap.data().uid));
  return userSnap.exists() ? userSnap.data() : null;
}

export async function markLegacyDmNotificationsRead(uid, chatId) {
  if (!uid || !chatId) return;
  try {
    const notificationsRef = rtRef(rtdb, `notifications/${uid}`);
    const q = rtQuery(notificationsRef, orderByChild("chatId"), equalTo(chatId));
    const snap = await rtGet(q);
    if (!snap.exists()) return;
    const updates = {};
    snap.forEach((child) => {
      updates[`${child.key}/read`] = true;
    });
    await rtUpdate(notificationsRef, updates);
  } catch {}
}
