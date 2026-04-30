// =========================================================
// Alfa Club Social — Authentication module
// =========================================================
import { auth, db, rtdb } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, setDoc, getDoc, updateDoc, serverTimestamp,
  collection, collectionGroup, query, where, getDocs, runTransaction, writeBatch, increment, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref as rtRef, query as rtQuery, orderByChild, equalTo,
  get as rtGet, update as rtUpdate
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// Tracks an in-flight registration so redirectIfAuthed / ensureProfile
// don't race with the profile write and generate a random username.
let REGISTERING = false;

// Registo ──────────────────────────────────────────────
export async function registerUser({ email, password, name, username, bio = "" }) {
  username = username.trim().toLowerCase().replace(/[^a-z0-9_.]/g, "");
  if (!username) throw new Error("Nome de utilizador inválido.");
  if (username.length < 3) throw new Error("Username muito curto (mínimo 3).");

  const usernameRef = doc(db, "usernames", username);
  const usernameSnap = await getDoc(usernameRef);
  if (usernameSnap.exists()) throw new Error("Esse @username já está usado.");

  REGISTERING = true;
  // Store across page loads too (in case redirect fires immediately)
  try { sessionStorage.setItem("alfa_registering", "1"); } catch {}
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    try { await updateProfile(cred.user, { displayName: name }); } catch {}

    const userId = await generateIdNumber();

    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      email,
      name,
      username,
      bio,
      photoURL: "",
      idNumber: userId,
      followers: 0,
      following: 0,
      postsCount: 0,
      createdAt: serverTimestamp(),
      points: 0
    });

    await setDoc(usernameRef, { uid: cred.user.uid });

    return cred.user;
  } finally {
    REGISTERING = false;
    try { sessionStorage.removeItem("alfa_registering"); } catch {}
  }
}

function isRegistering() {
  if (REGISTERING) return true;
  try { return sessionStorage.getItem("alfa_registering") === "1"; } catch { return false; }
}

// Gera um ID# sequencial via transaction
async function generateIdNumber() {
  const counterRef = doc(db, "meta", "userCounter");
  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const next = snap.exists() ? (snap.data().count || 0) + 1 : 1;
    tx.set(counterRef, { count: next }, { merge: true });
    return next;
  });
}

// Encontra um @username livre (para auto-criação)
async function findFreeUsername(base) {
  base = base.toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 15);
  if (base.length < 3) base = "user";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : base + i;
    const snap = await getDoc(doc(db, "usernames", candidate));
    if (!snap.exists()) return candidate;
  }
  return base + Date.now();
}

// Cria perfil automaticamente se o user só existe no Firebase Auth (ex: criado na consola)
export async function ensureProfile(user) {
  const ref = doc(db, "users", user.uid);
  let snap = await getDoc(ref);
  if (snap.exists()) return snap.data();

  // If a registration is in flight (just created the auth user but Firestore
  // write hasn't landed yet), retry-wait a few seconds before auto-generating.
  if (isRegistering()) {
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 400));
      snap = await getDoc(ref);
      if (snap.exists()) return snap.data();
      if (!isRegistering()) break;
    }
    // One more check after the flag clears
    snap = await getDoc(ref);
    if (snap.exists()) return snap.data();
  }

  const seedName = user.displayName || (user.email ? user.email.split("@")[0] : "User");
  const username = await findFreeUsername(seedName);
  const userId = await generateIdNumber();

  const profile = {
    uid: user.uid,
    email: user.email || "",
    name: seedName,
    username,
    bio: "",
    photoURL: user.photoURL || "",
    idNumber: userId,
    followers: 0,
    following: 0,
    postsCount: 0,
    createdAt: serverTimestamp(),
    points: 0
  };
  await setDoc(ref, profile);
  await setDoc(doc(db, "usernames", username), { uid: user.uid });
  console.info("[Alfa] Perfil criado automaticamente:", username);
  return profile;
}

// Login ────────────────────────────────────────────────
export async function loginUser({ email, password }) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  // make sure profile exists (cobre users criados na consola)
  try { await ensureProfile(cred.user); } catch (e) { console.warn("ensureProfile:", e); }
  return cred.user;
}

// Logout ───────────────────────────────────────────────
export async function logout() {
  await signOut(auth);
  window.location.href = "./login.html";
}

// Obter perfil do user atual ───────────────────────────
export async function getCurrentProfile() {
  const u = auth.currentUser;
  if (!u) return null;
  const snap = await getDoc(doc(db, "users", u.uid));
  return snap.exists() ? snap.data() : null;
}

// Atualiza perfil ──────────────────────────────────────
export async function updateMyProfile(data) {
  const u = auth.currentUser;
  if (!u) throw new Error("Not signed in");
  await updateDoc(doc(db, "users", u.uid), data);
  if (data.name) { try { await updateProfile(u, { displayName: data.name }); } catch {} }

  // Fire-and-forget propagation to old posts / comments / stories.
  // This must NEVER block the main profile update — the collectionGroup
  // query requires an index in Firestore, which may not be configured
  // in every deployment. If it fails we still want the save to succeed.
  try {
    const historyFields = {};
    if (data.name !== undefined) historyFields.authorName = data.name;
    if (data.photoURL !== undefined) historyFields.authorPhoto = data.photoURL || "";
    if (data.username !== undefined) historyFields.authorUsername = data.username || "";
    if (data.nameColor !== undefined) historyFields.authorNameColor = data.nameColor === null ? deleteField() : (data.nameColor || "");
    if (data.nameStyle !== undefined) historyFields.authorNameStyle = data.nameStyle === null ? deleteField() : (data.nameStyle || "");
    if (data.isAdmin !== undefined) historyFields.authorIsAdmin = !!data.isAdmin;
    if (data.isMod !== undefined) historyFields.authorIsMod = !!data.isMod;
    if (data.role !== undefined) historyFields.authorRole = data.role || "user";
    if (Object.keys(historyFields).length === 0) return;

    const tasks = [];

    // Posts — always try (requires single-field index on "uid")
    tasks.push((async () => {
      try {
        const postsSnap = await getDocs(query(collection(db, "posts"), where("uid", "==", u.uid)));
        if (!postsSnap.empty) {
          const batch = writeBatch(db);
          postsSnap.forEach(s => batch.update(s.ref, historyFields));
          await batch.commit();
        }
      } catch (e) { console.warn("posts history update skipped:", e?.message); }
    })());

    // Stories — same pattern
    tasks.push((async () => {
      try {
        const storiesSnap = await getDocs(query(collection(db, "stories"), where("uid", "==", u.uid)));
        if (!storiesSnap.empty) {
          const batch = writeBatch(db);
          storiesSnap.forEach(s => batch.update(s.ref, historyFields));
          await batch.commit();
        }
      } catch (e) { console.warn("stories history update skipped:", e?.message); }
    })());

    // Comments — uses a collectionGroup query which requires an index.
    // Skip silently if unavailable.
    tasks.push((async () => {
      try {
        const commentsSnap = await getDocs(query(collectionGroup(db, "comments"), where("uid", "==", u.uid)));
        if (!commentsSnap.empty) {
          const batch = writeBatch(db);
          commentsSnap.forEach(s => batch.update(s.ref, historyFields));
          await batch.commit();
        }
      } catch (e) { console.warn("comments history update skipped:", e?.message); }
    })());

    await Promise.all(tasks);
  } catch (e) {
    console.warn("history propagation non-fatal:", e?.message);
  }
}

// Propagate profile-like changes (name, photo, username, role, colors) for a
// specific target user uid to their existing posts/stories/comments. Used by
// the admin panel when an admin promotes/demotes another user or edits their
// profile info, so the author data on old content updates retroactively.
//
// `data` uses the same shape as updateMyProfile — each field is optional:
//   { name, photoURL, username, nameColor, nameStyle, isAdmin, isMod, role }
// Each collection update is wrapped in its own try/catch so a missing index
// on one query does not abort the others.
export async function propagateAuthorUpdate(uid, data) {
  if (!uid || !data) return;
  const historyFields = {};
  if (data.name !== undefined) historyFields.authorName = data.name;
  if (data.photoURL !== undefined) historyFields.authorPhoto = data.photoURL || "";
  if (data.username !== undefined) historyFields.authorUsername = data.username || "";
  if (data.nameColor !== undefined) historyFields.authorNameColor = data.nameColor === null ? deleteField() : (data.nameColor || "");
  if (data.nameStyle !== undefined) historyFields.authorNameStyle = data.nameStyle === null ? deleteField() : (data.nameStyle || "");
  if (data.isAdmin !== undefined) historyFields.authorIsAdmin = !!data.isAdmin;
  if (data.isMod !== undefined) historyFields.authorIsMod = !!data.isMod;
  if (data.role !== undefined) historyFields.authorRole = data.role || "user";
  if (Object.keys(historyFields).length === 0) return;

  const tasks = [];

  tasks.push((async () => {
    try {
      const postsSnap = await getDocs(query(collection(db, "posts"), where("uid", "==", uid)));
      if (!postsSnap.empty) {
        const batch = writeBatch(db);
        postsSnap.forEach(s => batch.update(s.ref, historyFields));
        await batch.commit();
      }
    } catch (e) { console.warn("[propagate] posts skipped:", e?.message); }
  })());

  tasks.push((async () => {
    try {
      const storiesSnap = await getDocs(query(collection(db, "stories"), where("uid", "==", uid)));
      if (!storiesSnap.empty) {
        const batch = writeBatch(db);
        storiesSnap.forEach(s => batch.update(s.ref, historyFields));
        await batch.commit();
      }
    } catch (e) { console.warn("[propagate] stories skipped:", e?.message); }
  })());

  tasks.push((async () => {
    try {
      const commentsSnap = await getDocs(query(collectionGroup(db, "comments"), where("uid", "==", uid)));
      if (!commentsSnap.empty) {
        const batch = writeBatch(db);
        commentsSnap.forEach(s => batch.update(s.ref, historyFields));
        await batch.commit();
      }
    } catch (e) { console.warn("[propagate] comments skipped:", e?.message); }
  })());

  // Global chat lives in the Realtime Database (chat/messages), not
  // Firestore. The denormalised author photo / name on each message
  // doesn't auto-update when the user edits their profile, so old
  // messages keep showing the old picture. Patch every chat message
  // authored by `uid` in a single multi-path update — RTDB does the
  // batching natively. We translate the firestore `historyFields`
  // (authorName / authorPhoto / authorUsername / etc.) to the field
  // names chat messages use (`authorName`, `photoURL`, `authorUsername`,
  // …) so the renderer's existing read paths pick them up.
  tasks.push((async () => {
    try {
      const msgsRef = rtRef(rtdb, "chat/messages");
      const q = rtQuery(msgsRef, orderByChild("uid"), equalTo(uid));
      const snap = await rtGet(q);
      if (!snap.exists()) return;
      const updates = {};
      snap.forEach(child => {
        const k = child.key;
        if (data.name !== undefined) updates[`chat/messages/${k}/authorName`] = data.name || "";
        if (data.photoURL !== undefined) updates[`chat/messages/${k}/photoURL`] = data.photoURL || "";
        if (data.username !== undefined) updates[`chat/messages/${k}/authorUsername`] = data.username || "";
        if (data.nameColor !== undefined) updates[`chat/messages/${k}/authorNameColor`] = data.nameColor || null;
        if (data.nameStyle !== undefined) updates[`chat/messages/${k}/authorNameStyle`] = data.nameStyle || null;
        if (data.isAdmin !== undefined) updates[`chat/messages/${k}/authorIsAdmin`] = !!data.isAdmin;
        if (data.isMod !== undefined) updates[`chat/messages/${k}/authorIsMod`] = !!data.isMod;
        if (data.role !== undefined) updates[`chat/messages/${k}/authorRole`] = data.role || "user";
      });
      if (Object.keys(updates).length) await rtUpdate(rtRef(rtdb), updates);
    } catch (e) { console.warn("[propagate] chat skipped:", e?.message); }
  })());

  try { await Promise.all(tasks); } catch (e) { console.warn("[propagate] non-fatal:", e?.message); }
}

// Persist the current user's UID to a small IDB key (alfa-sw-state / kv /
// "selfUid"). The firebase-messaging service worker reads this to drop push
// notifications whose data.senderUid matches us — defends against the case
// where the same FCM token has been registered under multiple Firestore user
// docs and we'd otherwise receive a push for our own message.
function _writeSelfUidToIDB(uid) {
  try {
    const req = indexedDB.open("alfa-sw-state", 1);
    req.onupgradeneeded = () => {
      try { req.result.createObjectStore("kv"); } catch {}
    };
    req.onsuccess = () => {
      try {
        const tx = req.result.transaction("kv", "readwrite");
        tx.objectStore("kv").put(uid || "", "selfUid");
        tx.oncomplete = () => { try { req.result.close(); } catch {} };
      } catch {}
    };
  } catch {}
}

// Guards ───────────────────────────────────────────────
export function requireAuth(onReady) {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        // Clear the self-uid so background pushes don't get filtered against
        // a stale uid after logout.
        _writeSelfUidToIDB("");
        const here = window.location.pathname.split("/").pop() || "";
        if (here !== "login.html" && here !== "") {
          window.location.replace("./login.html");
        }
        resolve(null);
        return;
      }
      _writeSelfUidToIDB(user.uid);
      let profile = null;
      try {
        profile = await ensureProfile(user);
      } catch (err) {
        console.error("[Alfa] ensureProfile failed:", err);
      }
      if (onReady) onReady(user, profile);
      resolve({ user, profile });
    });
  });
}

export function redirectIfAuthed() {
  onAuthStateChanged(auth, (user) => {
    // Never redirect away from login during an active registration,
    // otherwise index.html's ensureProfile would race the profile write
    // and generate a random @username.
    if (user && !isRegistering()) window.location.replace("./index.html");
  });
}

export { onAuthStateChanged };
