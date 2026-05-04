import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "firebase/firestore";
import { Archive, Bell, Bug, Camera, ChevronLeft, Edit3, Image as ImageIcon, LogOut, Mail, Menu, Newspaper, Search, Settings, Shield, SlidersHorizontal, Star, Store, Trash2, Trophy, X } from "lucide-react";
import { BottomNav, GradientDefs, LegacySettingsIcon, PageFrame } from "../components/Shell.jsx";
import { SheetModal, SideDrawer } from "../components/Modal.jsx";
import { NotificationsButton, NotificationsModal } from "../components/Notifications.jsx";
import { PostCard } from "../components/PostCard.jsx";
import { usePullToRefresh } from "../hooks/usePullToRefresh.js";
import { logout, updateMyProfile, useAuthProfile } from "../lib/auth.js";
import { setAdminPlusEnabled, setAdminViewEnabled, useAdminMode } from "../lib/adminMode.js";
import { db, initPush, rtdb } from "../lib/firebase.js";
import { ref as rtRef, set as rtSet } from "firebase/database";
import { routeTo } from "../lib/navigation.js";
import { uploadMedia } from "../lib/upload.js";
import { Avatar, debugToastsEnabled, Empty, Loading, RoleBadges, StyledName, toast } from "../lib/ui.jsx";

// SYSTEM-mode "wipe everything" implementation. Iterates each top-level
// collection we consider "user-generated public content" and deletes
// every document. For collections with subcollections (archiveSections
// → entries, posts → comments / votes, etc.) we recurse one level so
// stray children don't survive. Users + appConfig + usernames are
// deliberately preserved so accounts and app-level settings stay intact.
//
// We deliberately use simple per-doc deleteDoc calls (no batching) for
// portability — on small/medium datasets this is fast enough and gives
// us per-doc error isolation. For very large datasets a Cloud Function
// equivalent would be preferable.
async function wipeFirestoreCollection(collName, recurseSubcols = []) {
  const snap = await getDocs(collection(db, collName));
  for (const docSnap of snap.docs) {
    for (const sub of recurseSubcols) {
      try {
        const subSnap = await getDocs(collection(db, collName, docSnap.id, sub));
        for (const subDoc of subSnap.docs) {
          await deleteDoc(subDoc.ref).catch(() => {});
        }
      } catch {}
    }
    await deleteDoc(docSnap.ref).catch(() => {});
  }
}

async function wipeAllData() {
  // Realtime Database — global chat lives at /chat/messages.
  try { await rtSet(rtRef(rtdb, "chat/messages"), null); } catch {}
  // Firestore — public collections. Order doesn't really matter; we
  // run them in parallel for speed.
  await Promise.all([
    wipeFirestoreCollection("posts", ["comments", "votes", "pollVotes"]),
    wipeFirestoreCollection("stories"),
    wipeFirestoreCollection("news"),
    wipeFirestoreCollection("reports"),
    wipeFirestoreCollection("archiveSections", ["entries"]),
    wipeFirestoreCollection("roles"),
    wipeFirestoreCollection("notifications", ["items"]),
    wipeFirestoreCollection("chats", ["messages"])
  ]);
}

const SHOP_ITEMS = [
  { id: "color_cyan", unlockField: "unlockedNameColors", unlockValue: "#22d3ee", name: "Cor Azul", sub: "Nome em azul", price: 50, preview: <span className="name-sample" style={{ color: "#22d3ee" }}>Nome</span>, apply: { nameColor: "#22d3ee" } },
  { id: "color_pink", unlockField: "unlockedNameColors", unlockValue: "#ec4899", name: "Cor Rosa", sub: "Nome em rosa (Gay)", price: 50, preview: <span className="name-sample" style={{ color: "#ec4899" }}>Nome</span>, apply: { nameColor: "#ec4899" } },
  { id: "color_green", unlockField: "unlockedNameColors", unlockValue: "#22c55e", name: "Cor Verde", sub: "Nome em verde", price: 50, preview: <span className="name-sample" style={{ color: "#22c55e" }}>Nome</span>, apply: { nameColor: "#22c55e" } },
  { id: "color_red", unlockField: "unlockedNameColors", unlockValue: "#ef4444", name: "Cor Vermelha", sub: "Nome em vermelho", price: 50, preview: <span className="name-sample" style={{ color: "#ef4444" }}>Nome</span>, apply: { nameColor: "#ef4444" } },
  { id: "color_purple", unlockField: "unlockedNameColors", unlockValue: "#a855f7", name: "Cor Roxa", sub: "Nome em roxo", price: 50, preview: <span className="name-sample" style={{ color: "#a855f7" }}>Nome</span>, apply: { nameColor: "#a855f7" } },
  { id: "color_orange", unlockField: "unlockedNameColors", unlockValue: "#f97316", name: "Cor Laranja", sub: "Nome em laranja", price: 50, preview: <span className="name-sample" style={{ color: "#f97316" }}>Nome</span>, apply: { nameColor: "#f97316" } },
  { id: "color_gold", unlockField: "unlockedNameColors", unlockValue: "gold", name: "Cor Dourada", sub: "Nome dourado com glow", price: 300, preview: <span className="name-sample name-gold">Nome</span>, apply: { nameColor: "gold", nameStyle: null } },
  { id: "grad_anim", unlockField: "unlockedNameStyles", unlockValue: "grad", name: "Degrade animado", sub: "Nome com gradiente animado", price: 100, preview: <span className="name-sample name-grad-anim">Nome</span>, apply: { nameStyle: "grad" } },
  { id: "glow_name", unlockField: "unlockedNameStyles", unlockValue: "glow", name: "Glow", sub: "Nome com brilho da tua cor", price: 80, preview: <span className="name-sample name-glow" style={{ "--name-glow-base": "#ec4899" }}>Nome</span>, apply: { nameStyle: "glow" } },
  { id: "reset_color", name: "Remover modificações", sub: "Voltar a cor padrão", price: 0, preview: <span className="name-sample">Nome</span>, apply: { nameColor: null, nameStyle: null } },
  { id: "change_user", name: "Mudar @username", sub: "Escolher um novo @", price: 300, preview: <span style={{ fontWeight: 700 }}>@</span>, action: "changeUsername" },
  { id: "timeout_user", name: "Timeout 24h", sub: "Silenciar um user 24h", price: 50, preview: <span style={{ fontWeight: 700, opacity: 0.7 }}>mute</span>, action: "timeoutUser" }
];

const SHOP_PROFILE_THEMES = [
  { id: "ptheme_none", name: "Nenhum", sub: "Sem tema de perfil", price: 0, preview: <span className="pt-preview pt-preview-none">-</span>, apply: { profileTheme: null } },
  { id: "ptheme_flames", unlockField: "unlockedProfileThemes", unlockValue: "flames", name: "Chamas", sub: "Perfil em chamas animadas", price: 100, preview: <span className="pt-preview pt-preview-flames" />, apply: { profileTheme: "flames" } },
  { id: "ptheme_aurora", unlockField: "unlockedProfileThemes", unlockValue: "aurora", name: "Aurora", sub: "Ondas de aurora boreal", price: 100, preview: <span className="pt-preview pt-preview-aurora" />, apply: { profileTheme: "aurora" } },
  { id: "ptheme_neon", unlockField: "unlockedProfileThemes", unlockValue: "neon", name: "Neon Grid", sub: "Grelha vaporwave animada", price: 100, preview: <span className="pt-preview pt-preview-neon" />, apply: { profileTheme: "neon" } },
  { id: "ptheme_galaxy", unlockField: "unlockedProfileThemes", unlockValue: "galaxy", name: "Galaxia", sub: "Estrelas e nebulosa", price: 100, preview: <span className="pt-preview pt-preview-galaxy" />, apply: { profileTheme: "galaxy" } },
  { id: "ptheme_cyber", unlockField: "unlockedProfileThemes", unlockValue: "cyber", name: "Cyber HUD", sub: "Linhas neon em scan", price: 100, preview: <span className="pt-preview pt-preview-cyber" />, apply: { profileTheme: "cyber" } },
  { id: "ptheme_sakura", unlockField: "unlockedProfileThemes", unlockValue: "sakura", name: "Sakura", sub: "Pétalas a cair", price: 100, preview: <span className="pt-preview pt-preview-sakura" />, apply: { profileTheme: "sakura" } }
];

const APP_THEMES = [
  { id: "dark", name: "Escuro", preview: "preview-dark" },
  { id: "light", name: "Claro", preview: "preview-light" },
  { id: "vaporwave", name: "Vaporwave", preview: "preview-vaporwave" },
  { id: "cyberpunk", name: "Cyberpunk", preview: "preview-cyberpunk" },
  { id: "space", name: "Space", preview: "preview-space" },
  { id: "steampunk", name: "Steampunk", preview: "preview-steampunk" }
];

const NOTIF_PREF_DEFAULTS = { dm: true, globalChat: false, news: true, engagement: true };

function readNotifPrefs() {
  try {
    return { ...NOTIF_PREF_DEFAULTS, ...(JSON.parse(localStorage.getItem("acs_notif_prefs_v1") || "{}") || {}) };
  } catch {
    return { ...NOTIF_PREF_DEFAULTS };
  }
}

function saveNotifPrefs(prefs, user) {
  try { localStorage.setItem("acs_notif_prefs_v1", JSON.stringify(prefs)); } catch {}
  if (user?.uid) updateDoc(doc(db, "users", user.uid), { notifPrefs: prefs }).catch(() => {});
}

function applyAppTheme(theme) {
  const safeTheme = APP_THEMES.some((item) => item.id === theme) ? theme : "dark";
  document.documentElement.setAttribute("data-theme", safeTheme);
  try { localStorage.setItem("acs_theme_v1", safeTheme); } catch {}
}

function usePosts(user, profile, filter, refreshKey = 0) {
  const [state, setState] = useState({ loading: true, posts: [], error: null });
  useEffect(() => {
    if (!user) return undefined;
    const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), fsLimit(80));
    return onSnapshot(q, (snap) => {
      const blocked = new Set(profile?.blocked || []);
      const following = new Set(Array.isArray(profile?.following) ? profile.following : []);
      const posts = [];
      snap.forEach((item) => {
        const post = { id: item.id, ...item.data() };
        if (blocked.has(post.uid)) return;
        if (filter === "following" && post.uid !== user.uid && !following.has(post.uid)) return;
        posts.push(post);
      });
      setState({ loading: false, posts, error: null });
    }, (err) => setState({ loading: false, posts: [], error: err }));
  }, [filter, profile, refreshKey, user]);
  return state;
}

function useStories(refreshKey = 0) {
  const [stories, setStories] = useState([]);
  useEffect(() => {
    const applySnapshot = (snap) => {
      const now = Date.now();
      const rows = [];
      snap.forEach((item) => {
        const story = { id: item.id, ...item.data() };
        const exp = story.expiresAt?.toMillis ? story.expiresAt.toMillis() : story.expiresAt || 0;
        if (exp && exp < now) return;
        rows.push(story);
      });
      const timestamp = (story) => story.createdAt?.toMillis ? story.createdAt.toMillis() : Number(story.createdAt || 0);
      rows.sort((a, b) => timestamp(b) - timestamp(a));
      setStories(rows.slice(0, 50));
    };

    return onSnapshot(collection(db, "stories"), applySnapshot, (err) => {
      console.warn("stories:", err?.message || err);
      setStories([]);
    });
  }, [refreshKey]);
  return stories;
}

function useRoles(enabled = true) {
  const [roles, setRoles] = useState([]);
  useEffect(() => {
    if (!enabled) {
      setRoles([]);
      return undefined;
    }
    const q = query(collection(db, "roles"), orderBy("name", "asc"));
    return onSnapshot(q, (snap) => {
      setRoles(snap.docs.map((item) => ({ id: item.id, ...item.data() })));
    }, () => setRoles([]));
  }, [enabled]);
  return roles;
}

function useDmUnread(user) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!user?.uid) {
      setCount(0);
      return undefined;
    }
    const q = query(collection(db, "chats"), where("participants", "array-contains", user.uid), fsLimit(100));
    return onSnapshot(q, (snap) => {
      let total = 0;
      snap.forEach((item) => {
        total += item.data()?.[`unread_${user.uid}`] || 0;
      });
      setCount(total);
    }, () => setCount(0));
  }, [user?.uid]);
  return count;
}

function itemIsUnlocked(profile, item) {
  if (item.price === 0) return true;
  if (!item.unlockField || item.unlockValue === undefined) return false;
  if (item.unlockValue === "gold" && profile?.nameStyle === "gold") return true;
  const activeByLegacyField = item.apply && Object.entries(item.apply).some(([key, value]) => value && profile?.[key] === value);
  return activeByLegacyField || (Array.isArray(profile?.[item.unlockField]) && profile[item.unlockField].includes(item.unlockValue));
}

function Composer({ user, profile }) {
  const adminMode = useAdminMode(profile);
  const [text, setText] = useState("");
  const [media, setMedia] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [notifyAll, setNotifyAll] = useState(false);
  const fileRef = useRef(null);
  const applyPoll = (poll) => {
    setMedia({ type: "poll", poll });
    setPollOpen(false);
    const keepTop = () => window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    keepTop();
    requestAnimationFrame(keepTop);
    window.setTimeout(keepTop, 80);
    window.setTimeout(keepTop, 220);
  };

  const pickFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const up = await uploadMedia(file);
      setMedia({ type: up.type, url: up.url });
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const publish = async () => {
    const clean = text.trim();
    if (!clean && !media) return;
    setBusy(true);
    try {
      const data = {
        uid: user.uid,
        authorName: profile.name || "",
        authorUsername: profile.username || "",
        authorPhoto: profile.photoURL || "",
        authorIsAdmin: !!profile.isAdmin,
        authorIsMod: profile.role === "mod",
        authorRole: profile.role || "user",
        authorNameColor: profile.nameColor || "",
        authorNameStyle: profile.nameStyle || "",
        text: clean.slice(0, 500),
        likes: 0,
        dislikes: 0,
        commentsCount: 0,
        notifyAll: !!(adminMode.adminView && notifyAll),
        createdAt: serverTimestamp()
      };
      if (media?.type === "image" || media?.type === "video") {
        data.mediaURL = media.url;
        data.mediaType = media.type;
      }
      if (media?.type === "poll") data.poll = media.poll;
      await addDoc(collection(db, "posts"), data);
      setText("");
      setMedia(null);
      setNotifyAll(false);
      toast("Publicado");
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer card" style={{ margin: "8px 12px", borderRadius: 16 }}>
      <div style={{ flexShrink: 0 }}>
        <Avatar user={profile} size={38} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="O que dizem os teus olhos?" maxLength="500" />
        {media ? (
          <div className={`media-preview ${media.type === "poll" ? "poll-media-preview" : ""}`} style={{ position: "relative" }}>
            {media.type === "image" ? <img src={media.url} alt="" style={{ width: "100%", display: "block" }} /> : null}
            {media.type === "video" ? <video src={media.url} controls style={{ width: "100%", display: "block" }} /> : null}
            {media.type === "poll" ? (
              <div className="poll-preview composer-poll-preview">
                <SlidersHorizontal size={18} style={{ color: "#ec4899", flexShrink: 0 }} />
                <div className="poll-preview-label">{media.poll.question}</div>
                <div className="poll-preview-type">{media.poll.kind === "slider" ? "Slider 0-100" : `${media.poll.options?.length || 0} opções`}</div>
              </div>
            ) : null}
            <button type="button" className="remove-media" aria-label="Remover" onClick={() => setMedia(null)}>x</button>
          </div>
        ) : null}
        <div className="tools">
          <div className="char-count">{text.length} / 500</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <label className={`btn-ghost tap native-file-trigger ${busy ? "is-disabled" : ""}`} style={{ padding: "8px 12px", fontSize: 13 }} title="Adicionar foto/video" aria-label="Adicionar foto/video">
              <ImageIcon size={16} />
              <input ref={fileRef} className="native-file-input" type="file" accept="image/*,video/*" disabled={busy} onChange={(event) => pickFile(event.target.files?.[0])} />
            </label>
            {adminMode.adminView ? (
              <button className={`btn-ghost tap admin-broadcast-btn ${notifyAll ? "active" : ""}`} type="button" aria-pressed={notifyAll} style={{ padding: "8px 12px", fontSize: 13 }} title="Notificar todos os users" onClick={() => setNotifyAll((v) => !v)}>
                <Bell size={16} />
              </button>
            ) : null}
            <button className="btn-ghost tap poll-tool-btn" type="button" style={{ padding: "8px 12px", fontSize: 13 }} title="Adicionar sondagem" aria-label="Adicionar sondagem" onClick={() => setPollOpen(true)}>
              <PollToolIcon />
            </button>
            <button className="btn-primary" type="button" style={{ padding: "8px 18px", fontSize: 13 }} disabled={busy || (!text.trim() && !media)} onClick={publish}>
              {busy ? "A enviar" : "Publicar"}
            </button>
          </div>
        </div>
      </div>
      {pollOpen ? <PollBuilderModal onClose={() => setPollOpen(false)} onCreate={applyPoll} /> : null}
    </div>
  );
}

function PollToolIcon() {
  return (
    <svg className="poll-tool-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="5" y="13" width="2.7" height="6.5" rx="1.35" fill="currentColor" />
      <rect x="10.65" y="3.8" width="2.7" height="15.7" rx="1.35" fill="currentColor" />
      <rect x="16.3" y="7.5" width="2.7" height="12" rx="1.35" fill="currentColor" />
    </svg>
  );
}

function PollBuilderModal({ onClose, onCreate }) {
  const [kind, setKind] = useState("options");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const create = () => {
    const q = question.trim();
    if (!q) {
      toast("Escreve a pergunta.", "error");
      return;
    }
    if (kind === "slider") {
      onCreate({ kind: "slider", question: q, sum: 0, count: 0 });
      return;
    }
    const clean = options.map((item) => item.trim()).filter(Boolean).slice(0, 5);
    if (clean.length < 2) {
      toast("Precisas de pelo menos 2 opções.", "error");
      return;
    }
    onCreate({ kind: "options", question: q, options: clean.map((item) => ({ text: item, votes: 0 })) });
  };
  return (
    <SheetModal title="Criar sondagem" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className={`${kind === "options" ? "btn-primary" : "btn-ghost"} tap`} style={{ flex: 1, padding: 10, fontSize: 13 }} onClick={() => setKind("options")}>Opções</button>
          <button type="button" className={`${kind === "slider" ? "btn-primary" : "btn-ghost"} tap`} style={{ flex: 1, padding: 10, fontSize: 13 }} onClick={() => setKind("slider")}>Slider 0-100</button>
        </div>
        <div className="field">
          <label style={{ display: "block", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6, paddingLeft: 4 }}>Pergunta</label>
          <input className="input" maxLength="120" placeholder="Qual e a tua pergunta?" value={question} onChange={(event) => setQuestion(event.target.value)} style={{ padding: "11px 14px" }} />
        </div>
        {kind === "options" ? (
          <div>
            <label style={{ display: "block", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6, paddingLeft: 4 }}>Opções</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {options.map((value, index) => (
                <input key={index} className="input" placeholder={`Opção ${index + 1}`} value={value} onChange={(event) => setOptions((prev) => prev.map((item, i) => i === index ? event.target.value : item))} style={{ padding: "10px 12px" }} />
              ))}
            </div>
            {options.length < 5 ? <button className="btn-ghost tap" type="button" style={{ marginTop: 8, padding: "8px 12px", fontSize: 12 }} onClick={() => setOptions((prev) => [...prev, ""])}>+ Opção</button> : null}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--muted)", padding: 10, background: "rgba(255,255,255,.04)", border: "1px solid var(--border)", borderRadius: 10 }}>
            Os votantes escolhem um valor de 0 a 100. E mostrada a media + numero de votos.
          </div>
        )}
        <button className="btn-primary" type="button" onClick={create}>Adicionar</button>
      </div>
    </SheetModal>
  );
}

function Stories({ stories, user, profile }) {
  const [viewer, setViewer] = useState(null);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const fileRef = useRef(null);
  const grouped = useMemo(() => {
    const map = new Map();
    for (const story of stories) {
      const rows = map.get(story.uid) || [];
      rows.push(story);
      map.set(story.uid, rows);
    }
    const timestamp = (story) => story.createdAt?.toMillis ? story.createdAt.toMillis() : Number(story.createdAt || 0);
    return [...map.values()].map((items) => [...items].sort((a, b) => timestamp(a) - timestamp(b)));
  }, [stories]);

  const createStory = async (file, storyText = "") => {
    const cleanText = storyText.trim().slice(0, 160);
    if (!file && !cleanText) return;
    try {
      const up = file ? await uploadMedia(file) : null;
      await addDoc(collection(db, "stories"), {
        uid: user.uid,
        authorName: profile.name || "",
        authorUsername: profile.username || "",
        authorPhoto: profile.photoURL || "",
        text: cleanText,
        mediaURL: up?.url || "",
        mediaType: up?.type || "",
        createdAt: serverTimestamp(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
      });
      toast("Story publicada");
      setCreatorOpen(false);
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <div className="stories-row">
        <div className="story-item" role="button" onClick={() => setCreatorOpen(true)}>
          <div className="story-avatar add">
            <Camera size={22} />
          </div>
          <div className="story-name">A tua story</div>
        </div>
        {grouped.map((items) => {
          const story = items[0];
          return (
            <div className="story-item" key={story.uid} role="button" onClick={() => setViewer(items)}>
              <div className="story-avatar">
                <Avatar user={{ name: story.authorName, username: story.authorUsername, photoURL: story.authorPhoto }} size={64} />
              </div>
              <div className="story-name">{story.authorName || story.authorUsername || "Story"}</div>
            </div>
          );
        })}
      </div>
      {viewer ? <StoryViewer stories={viewer} user={user} profile={profile} onClose={() => setViewer(null)} /> : null}
      {creatorOpen ? <StoryCreateModal fileRef={fileRef} onClose={() => setCreatorOpen(false)} onCreate={createStory} /> : null}
    </>
  );
}

function StoryCreateModal({ fileRef, onClose, onCreate }) {
  const [file, setFile] = useState(null);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState("");
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const pick = (nextFile) => {
    setFile(nextFile || null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(nextFile ? URL.createObjectURL(nextFile) : "");
  };
  return (
    <SheetModal title="Nova story" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label className="btn-ghost native-file-trigger">
          Escolher foto/video
          <input ref={fileRef} className="native-file-input" type="file" accept="image/*,video/*" onChange={(event) => pick(event.target.files?.[0])} />
        </label>
        {preview ? (
          <div style={{ position: "relative", borderRadius: 14, overflow: "hidden", border: "1px solid var(--border)", background: "#050505" }}>
            {file?.type?.startsWith("video/") ? <video src={preview} controls style={{ width: "100%", maxHeight: 280 }} /> : <img src={preview} alt="" style={{ width: "100%", maxHeight: 280, objectFit: "contain", display: "block" }} />}
          </div>
        ) : null}
        <textarea className="input" rows="3" maxLength="160" placeholder="Texto da story..." value={text} onChange={(event) => setText(event.target.value)} style={{ padding: 12, fontFamily: "inherit", resize: "vertical" }} />
        <button className="btn-primary" type="button" disabled={!file && !text.trim()} onClick={() => onCreate(file, text)}>Publicar story</button>
      </div>
    </SheetModal>
  );
}

// SYSTEM editor for an individual story. Lets an admin with SYSTEM on
// rewrite literally every editable field on the story doc (text, media,
// expiry, view counter). Wrapped in a SheetModal so it sits above the
// story viewer overlay without fighting its full-screen click handler.
function SystemStoryEditor({ story, onClose }) {
  const [text, setText] = useState(story.text || "");
  const [mediaURL, setMediaURL] = useState(story.mediaURL || "");
  const [mediaType, setMediaType] = useState(story.mediaType || "");
  const [authorName, setAuthorName] = useState(story.authorName || "");
  const [authorUsername, setAuthorUsername] = useState(story.authorUsername || "");
  const [authorPhoto, setAuthorPhoto] = useState(story.authorPhoto || "");
  const [expiresAtMs, setExpiresAtMs] = useState(String(story.expiresAt || ""));
  const [viewers, setViewers] = useState(String(
    Array.isArray(story.viewers) ? story.viewers.length :
    (typeof story.viewersCount === "number" ? story.viewersCount : 0)
  ));
  const save = async () => {
    try {
      await updateDoc(doc(db, "stories", story.id), {
        text: text.slice(0, 240),
        mediaURL: mediaURL.trim(),
        mediaType: mediaType.trim(),
        authorName: authorName.trim(),
        authorUsername: authorUsername.trim().replace(/^@/, ""),
        authorPhoto: authorPhoto.trim(),
        expiresAt: expiresAtMs.trim() ? Number(expiresAtMs) : null,
        viewersCount: Number(viewers) || 0,
        adminEditedAt: serverTimestamp()
      });
      toast("Story atualizada (SYSTEM)", "success");
      onClose();
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };
  return (
    <SheetModal title="SYSTEM — story" onClose={onClose}>
      <div className="admin-plus-inline">
        <label className="field-label">Conteúdo</label>
        <textarea className="input" rows="3" value={text} onChange={(event) => setText(event.target.value)} placeholder="Texto" />
        <input className="input" value={mediaURL} onChange={(event) => setMediaURL(event.target.value)} placeholder="Media URL" />
        <input className="input" value={mediaType} onChange={(event) => setMediaType(event.target.value)} placeholder="Media type (image/video)" />
        <label className="field-label">Autor (denormalizado)</label>
        <input className="input" value={authorName} onChange={(event) => setAuthorName(event.target.value)} placeholder="Nome" />
        <input className="input" value={authorUsername} onChange={(event) => setAuthorUsername(event.target.value)} placeholder="@username" />
        <input className="input" value={authorPhoto} onChange={(event) => setAuthorPhoto(event.target.value)} placeholder="Foto URL" />
        <label className="field-label">Métricas / expiry</label>
        <input className="input" type="number" value={viewers} onChange={(event) => setViewers(event.target.value)} placeholder="Nº de views" />
        <input className="input" value={expiresAtMs} onChange={(event) => setExpiresAtMs(event.target.value)} placeholder="expiresAt em ms (Date.now()+...) — vazio para nunca expira" />
        <button className="btn-primary" type="button" onClick={save}>Guardar (SYSTEM)</button>
      </div>
    </SheetModal>
  );
}

function StoryViewer({ stories, user, profile, onClose }) {
  const adminMode = useAdminMode(profile);
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [systemOpen, setSystemOpen] = useState(false);
  const story = stories[index] || stories[0];
  const next = () => {
    if (index >= stories.length - 1) onClose();
    else setIndex((i) => i + 1);
  };
  useEffect(() => {
    setProgress(0);
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      const value = Math.min(1, (Date.now() - startedAt) / 5000);
      setProgress(value);
      if (value >= 1) {
        window.clearInterval(interval);
        next();
      }
    }, 60);
    return () => window.clearInterval(interval);
  }, [index]);
  if (!story) return null;
  const mediaURL = story.mediaURL || story.mediaUrl || story.media || story.imageUrl || story.imageURL || story.videoUrl || story.videoURL || story.url || "";
  const mediaType = story.mediaType || story.type || (/\.(mp4|webm|mov)(\?|$)/i.test(mediaURL) ? "video" : mediaURL ? "image" : "");
  const storyText = story.text || story.caption || story.body || "";
  const author = { name: story.authorName, username: story.authorUsername, photoURL: story.authorPhoto };
  const deleteStory = async () => {
    if (!confirm("Apagar esta story?")) return;
    try {
      await deleteDoc(doc(db, "stories", story.id));
      onClose();
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };
  return createPortal(
    <div className="story-viewer-react" onClick={next}>
      <div className="story-progress" aria-hidden="true">
        {stories.map((item, itemIndex) => (
          <span key={item.id || itemIndex}>
            <i style={{ transform: `scaleX(${itemIndex < index ? 1 : itemIndex === index ? progress : 0})` }} />
          </span>
        ))}
      </div>
      <div className="story-viewer-author" onClick={(event) => event.stopPropagation()}>
        <Avatar user={author} size={42} />
        <div className="story-viewer-author-text">
          <strong>{story.authorName || story.authorUsername || "Story"}</strong>
          <span>agora</span>
        </div>
      </div>
      <div className="story-top-actions-react" onClick={(event) => event.stopPropagation()}>
        {story.uid === user?.uid ? <button className="story-viewer-delete tap" type="button" onClick={deleteStory}>Apagar</button> : null}
        {adminMode.system ? <button className="story-viewer-delete tap" type="button" style={{ background: "rgba(251,191,36,.18)", color: "#fcd34d", borderColor: "rgba(251,191,36,.45)" }} onClick={() => setSystemOpen(true)}>SYSTEM</button> : null}
        <button className="icon-btn tap story-viewer-close" type="button" aria-label="Fechar" onClick={onClose}>
          <X size={22} />
        </button>
      </div>
      {systemOpen ? <SystemStoryEditor story={story} onClose={() => setSystemOpen(false)} /> : null}
      <div className="story-stage" onClick={(event) => event.stopPropagation()}>
      {mediaURL ? (
        mediaType === "video" ? <video className="story-media-el" src={mediaURL} controls autoPlay playsInline /> : <img className="story-media-el" src={mediaURL} alt="" />
      ) : (
        <div className="story-text-only">{storyText || "Story"}</div>
      )}
      </div>
      {mediaURL && storyText ? <div className="story-caption">{storyText}</div> : null}
    </div>,
    document.body
  );
}

function SearchModal({ onClose }) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);
  const inputRef = useRef(null);
  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 180);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const needle = q.trim().toLowerCase().replace(/^@/, "");
      if (!needle) {
        setUsers([]);
        return;
      }
      const snap = await getDocs(query(collection(db, "users"), fsLimit(150)));
      const rows = [];
      snap.forEach((item) => {
        const data = { uid: item.id, ...item.data() };
        if ((data.username || "").toLowerCase().includes(needle) || (data.name || "").toLowerCase().includes(needle)) rows.push(data);
      });
      if (alive) setUsers(rows.slice(0, 30));
    };
    const t = setTimeout(run, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);
  const clean = q.trim();
  return (
    <SheetModal title="Pesquisar" onClose={onClose}>
      <div className="search-modal">
        <div className="search-field-wrap">
          <Search size={19} />
          <input ref={inputRef} className="search-input" placeholder="Nome ou @username" value={q} onChange={(event) => setQ(event.target.value)} />
          {q ? (
            <button className="search-clear-btn" type="button" aria-label="Limpar pesquisa" onClick={() => setQ("")}>
              <X size={18} />
            </button>
          ) : null}
        </div>
        <div className="search-results">
          {!clean ? (
            <div className="search-empty-state">
              <Search size={22} />
              <span>Procura por nome ou @username.</span>
            </div>
          ) : null}
          {clean && !users.length ? (
            <div className="search-empty-state">
              <span>Nenhum perfil encontrado.</span>
            </div>
          ) : null}
          {users.map((item) => (
            <button key={item.uid} className="user-list-item search-user-row" type="button" onClick={() => { onClose(); routeTo("profile.html", `?u=${encodeURIComponent(item.username || "")}`); }}>
              <div className="user-list-avatar"><Avatar user={item} size={48} /></div>
              <div className="user-list-meta">
                <div className="user-list-name"><StyledName user={item} /><RoleBadges user={item} /></div>
                <div className="user-list-user">@{item.username || ""}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </SheetModal>
  );
}

function RankingModal({ onClose }) {
  const [users, setUsers] = useState([]);
  useEffect(() => {
    getDocs(query(collection(db, "users"), orderBy("points", "desc"), fsLimit(25))).then((snap) => {
      setUsers(snap.docs.map((item) => ({ uid: item.id, ...item.data() })));
    }).catch((err) => toast(`Erro: ${err.message}`, "error"));
  }, []);
  return (
    <SheetModal title="Ranking" onClose={onClose}>
      <div className="ranking-modern">
        <div className="ranking-hero">
          <div className="ranking-trophy"><Trophy size={34} /></div>
          <strong>Top Alfa Club</strong>
          <span>Os users com mais pontos da loja</span>
        </div>
        {users.map((item, idx) => (
          <button key={item.uid} className={`rank-row rank-row-modern ${idx < 3 ? "rank-podium" : ""}`} type="button" onClick={() => { onClose(); routeTo("profile.html", `?u=${encodeURIComponent(item.username || "")}`); }}>
            <div className={`pos ${idx < 3 ? "top" : ""}`}>{idx + 1}</div>
            <Avatar user={item} size={40} />
            <div className="rank-user-meta">
              <div className="rank-user-name"><StyledName user={item} /><RoleBadges user={item} /></div>
              <div className="rank-user-handle">@{item.username || ""}</div>
            </div>
            <div className="rank-points grad-text">{item.points || 0}</div>
          </button>
        ))}
      </div>
    </SheetModal>
  );
}

function ShopModal({ user, profile, onClose }) {
  const [actionItem, setActionItem] = useState(null);
  const [actionValue, setActionValue] = useState("");
  const buy = async (item, rawValue = "") => {
    const unlocked = itemIsUnlocked(profile, item);
    const cost = unlocked ? 0 : item.price;
    if ((profile.points || 0) < cost) {
      toast("Pontos insuficientes", "error");
      return;
    }
    let extra = {};
    if (item.action === "changeUsername") {
      const username = rawValue.trim().toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_.]/g, "");
      if (!username || username.length < 3) return;
      const taken = await getDocs(query(collection(db, "users"), where("username", "==", username), fsLimit(1)));
      if (!taken.empty) {
        toast("@username ja usado", "error");
        return;
      }
      extra.username = username;
    }
    if (item.action === "timeoutUser") {
      const username = rawValue.trim().toLowerCase().replace(/^@/, "");
      if (!username) return;
      const target = await getDocs(query(collection(db, "users"), where("username", "==", username), fsLimit(1)));
      if (target.empty) {
        toast("Utilizador não encontrado", "error");
        return;
      }
      extra.targetUid = target.docs[0].id;
    }
    try {
      await runTransaction(db, async (tx) => {
        const meRef = doc(db, "users", user.uid);
        const snap = await tx.get(meRef);
        const points = snap.data()?.points || 0;
        const alreadyUnlocked = itemIsUnlocked(snap.data(), item);
        const txCost = alreadyUnlocked ? 0 : item.price;
        if (points < txCost) throw new Error("Pontos insuficientes");
        const update = txCost > 0 ? { points: increment(-txCost) } : {};
        if (item.apply) Object.assign(update, item.apply);
        if (item.unlockField && item.unlockValue !== undefined && !alreadyUnlocked) update[item.unlockField] = arrayUnion(item.unlockValue);
        if (extra.username) update.username = extra.username;
        tx.update(meRef, update);
        if (extra.targetUid) tx.update(doc(db, "users", extra.targetUid), { timeoutUntil: Date.now() + 24 * 60 * 60 * 1000 });
      });
      const profileUpdate = {};
      if (item.apply?.nameColor !== undefined) profileUpdate.nameColor = item.apply.nameColor;
      if (item.apply?.nameStyle !== undefined) profileUpdate.nameStyle = item.apply.nameStyle;
      if (item.apply && Object.prototype.hasOwnProperty.call(item.apply, "profileTheme")) profileUpdate.profileTheme = item.apply.profileTheme;
      if (extra.username) profileUpdate.username = extra.username;
      if (Object.keys(profileUpdate).length) await updateMyProfile(profileUpdate);
      toast(cost === 0 ? "Aplicado" : "Comprado para sempre", "success");
      setActionItem(null);
      setActionValue("");
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };
  const rows = [
    ...SHOP_ITEMS,
    { id: "__profile_themes", separator: true, title: "Temas de perfil", sub: "Fundos animados para a tua pagina de perfil" },
    ...SHOP_PROFILE_THEMES
  ];
  return (
    <SheetModal title="Loja" onClose={onClose}>
      <div className="shop-content-modern">
        <div className="shop-points-card">
          <span>Os teus pontos</span>
          <strong className="grad-text">{profile.points || 0}</strong>
        </div>
        <div className="shop-section-title">Customização de nome</div>
        {rows.map((item) => {
          if (item.separator) {
            return (
              <div className="shop-section-heading" key={item.id}>
                <div className="shop-section-title">{item.title}</div>
                <div className="shop-section-sub">{item.sub}</div>
              </div>
            );
          }
          const active = item.apply && Object.entries(item.apply).every(([key, value]) => (profile[key] || null) === value);
          const owned = itemIsUnlocked(profile, item);
          const disabled = active || owned || (!owned && (profile.points || 0) < item.price);
          return (
            <div className={`shop-item ${owned && item.price > 0 ? "owned" : ""}`} key={item.id}>
              <div className="shop-item-icon">{item.preview}</div>
              <div className="shop-item-body">
                <div className="shop-item-title">{item.name}</div>
                <div className="shop-item-sub">{item.sub}</div>
                {owned && item.price > 0 ? <div className="shop-owned-badge">Comprado</div> : null}
              </div>
              <div className="shop-price">{item.price} pts</div>
              <button className="shop-buy-btn" type="button" disabled={disabled} onClick={() => item.action ? (setActionItem(item), setActionValue("")) : buy(item)}>
                {active ? "Ativo" : owned ? "Comprado" : disabled ? "Sem pts" : item.price === 0 ? "Aplicar" : "Comprar"}
              </button>
            </div>
          );
        })}
        <div className="shop-coming-soon">Mais perks brevemente...</div>
      </div>
      {actionItem ? (
        <SheetModal title={actionItem.action === "changeUsername" ? "Mudar username" : "Timeout 24h"} onClose={() => setActionItem(null)}>
          <input
            className="input"
            placeholder={actionItem.action === "changeUsername" ? "Novo @username" : "@username a silenciar"}
            value={actionValue}
            onChange={(event) => setActionValue(event.target.value)}
            style={{ width: "100%", padding: "11px 14px" }}
          />
          <button className="btn-primary" type="button" style={{ width: "100%", marginTop: 10 }} onClick={() => buy(actionItem, actionValue)}>
            Confirmar
          </button>
        </SheetModal>
      ) : null}
    </SheetModal>
  );
}

function BugReportModal({ user, profile, onClose }) {
  const [text, setText] = useState("");
  const [reports, setReports] = useState([]);
  const adminMode = useAdminMode(profile);
  useEffect(() => {
    if (!adminMode.adminView) return undefined;
    const q = query(collection(db, "bugReports"), orderBy("at", "desc"), fsLimit(40));
    return onSnapshot(q, (snap) => setReports(snap.docs.map((item) => ({ id: item.id, ...item.data() }))));
  }, [adminMode.adminView]);
  const submit = async () => {
    const clean = text.trim();
    if (!clean) return;
    try {
      await addDoc(collection(db, "bugReports"), {
        uid: user.uid,
        authorName: profile.name,
        authorUsername: profile.username,
        text: clean,
        at: serverTimestamp(),
        resolved: false
      });
      setText("");
      toast("Report enviado", "success");
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };
  return (
    <SheetModal title="Reportar bug" onClose={onClose}>
      <textarea className="input" rows="5" placeholder="Descreve o bug..." value={text} onChange={(event) => setText(event.target.value)} style={{ width: "100%", padding: 12, fontFamily: "inherit" }} />
      <button className="btn-primary" type="button" style={{ width: "100%", marginTop: 10 }} onClick={submit}>Enviar report</button>
      {adminMode.adminView ? (
        <div style={{ marginTop: 14, maxHeight: 260, overflowY: "auto" }}>
          {reports.map((report) => (
            <div className={`notif ${report.resolved ? "" : "unread"}`} key={report.id}>
              <div style={{ flex: 1 }}>
                <div className="nt-text"><b>{report.authorName}</b> @{report.authorUsername}</div>
                <div className="nt-text" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{report.text}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </SheetModal>
  );
}

function Toggle({ checked, disabled, onChange }) {
  return (
    <span className="toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle-slider" />
    </span>
  );
}

function ThemePreview({ item }) {
  return (
    <span className={`theme-preview ${item.preview}`}>
      {item.id === "vaporwave" ? <><span className="pv-sun" /><span className="pv-grid" /></> : null}
      {item.id === "cyberpunk" ? <><span className="pv-scan" /><span className="pv-corner pv-tl" /><span className="pv-corner pv-br" /></> : null}
      {item.id === "space" ? <><span className="pv-planet" /><span className="pv-shoot" /></> : null}
      {item.id === "steampunk" ? <><span className="pv-gear pv-gear-a" /><span className="pv-gear pv-gear-b" /><span className="pv-pipe" /></> : null}
    </span>
  );
}

function SettingsPanel({ user, profile, onClose, onBack, onAdmin }) {
  const adminMode = useAdminMode(profile);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("acs_theme_v1") || "dark"; } catch { return "dark"; }
  });
  const [pushEnabled, setPushEnabled] = useState(() => {
    try {
      const value = localStorage.getItem("acs_push_pref_v1");
      if (value === "1") return true;
      if (value === "0") return false;
      return "Notification" in window && Notification.permission === "granted";
    } catch {
      return false;
    }
  });
  const [prefs, setPrefs] = useState(readNotifPrefs);
  const [debug, setDebug] = useState(debugToastsEnabled);

  const chooseTheme = (nextTheme) => {
    setTheme(nextTheme);
    applyAppTheme(nextTheme);
    toast("Tema aplicado", "success");
  };

  const togglePush = async () => {
    let next = !pushEnabled;
    if (next) {
      if (!("Notification" in window)) {
        next = false;
        toast("Este browser não suporta notificações.", "error");
      } else {
        const token = await initPush({ user, requestPermission: true });
        next = !!token;
        if (next) toast("Push activado", "success");
        else toast("Não consegui registar este dispositivo para push.", "error");
      }
    } else {
      toast("Push desactivado");
    }
    setPushEnabled(next);
    try { localStorage.setItem("acs_push_pref_v1", next ? "1" : "0"); } catch {}
  };

  const setPref = (key, value) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    saveNotifPrefs(next, user);
  };

  const toggleDebug = (value) => {
    setDebug(value);
    try { localStorage.setItem("acs_debug_toasts_v1", value ? "1" : "0"); } catch {}
  };
  const toggleAdminView = (value) => {
    setAdminViewEnabled(value);
  };
  const toggleAdminPlus = (value) => {
    setAdminPlusEnabled(value);
  };

  return (
    <SideDrawer onClose={onClose}>
      {({ close }) => <div className="sub-panel active">
        <div className="sub-panel-head">
          <button className="icon-btn tap" type="button" aria-label="Voltar" onClick={() => (onBack ? onBack() : close())}>
            <ChevronLeft size={20} />
          </button>
          <div style={{ fontWeight: 700 }}>Definições</div>
        </div>

        <div className="settings-section">
          <div className="settings-title">Tema</div>
          <div className="theme-grid">
            {APP_THEMES.map((item) => (
              <button key={item.id} className={`theme-option ${theme === item.id ? "active" : ""}`} type="button" data-theme={item.id} onClick={() => chooseTheme(item.id)}>
                <ThemePreview item={item} />
                <span className="theme-name" style={item.id === "light" ? { color: "#17171a", textShadow: "none" } : null}>{item.name}</span>
                <span className="theme-check">v</span>
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-title">Notificações</div>
          <label className="settings-row">
            <span className="settings-row-text">
              <span className="settings-row-label">Push notifications</span>
              <span className="settings-row-hint">Receber avisos fora da app</span>
            </span>
            <Toggle checked={pushEnabled} onChange={togglePush} />
          </label>
          <div className="settings-subsection" id="notifCategoriesBox">
          {[
            ["dm", "DMs"],
            ["globalChat", "Chat global"],
            ["news", "Alfa News"],
            ["engagement", "Likes e comentários"]
          ].map(([key, label]) => (
            <label className="settings-row" key={key}>
              <span className="settings-row-text">
                <span className="settings-row-label">{label}</span>
              </span>
              <Toggle checked={!!prefs[key]} disabled={!pushEnabled} onChange={(value) => setPref(key, value)} />
            </label>
          ))}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-title">Debug</div>
          <label className="settings-row">
            <span className="settings-row-text">
              <span className="settings-row-label">Debug</span>
              <span className="settings-row-hint">Mostrar avisos informativos da app</span>
            </span>
            <Toggle checked={debug} onChange={toggleDebug} />
          </label>
        </div>

        {profile?.isAdmin ? (
          <div className="settings-section" id="adminSettingsSection">
            <div className="settings-title">Admin</div>
            <label className="settings-row">
              <span className="settings-row-text">
                <span className="settings-row-label">Modo admin</span>
                <span className="settings-row-hint">Ver a app como admin ou como user</span>
              </span>
              <Toggle checked={adminMode.adminView} onChange={toggleAdminView} />
            </label>
            <label className="settings-row">
              <span className="settings-row-text">
                <span className="settings-row-label">SYSTEM</span>
                <span className="settings-row-hint">Acesso total — editar qualquer campo da app, incluindo foto, pontos, seguidores e métricas de posts/stories.</span>
              </span>
              <Toggle checked={adminMode.system} disabled={!adminMode.adminView} onChange={toggleAdminPlus} />
            </label>
            {/* The "Editar users, roles e pontos" shortcut used to live here
                — removed because the same God Mode entry already exists
                in the hamburger drawer, so users had two ways into the
                same panel from the same screen. */}
          </div>
        ) : null}

        <div className="settings-section">
          <button className="drawer-item w-full" type="button" style={{ color: "#fca5a5" }} onClick={async () => { if (confirm("Sair da conta?")) await logout(); }}>
            <DrawerIcon><LogOut size={18} /></DrawerIcon>
            <span className="drawer-label">Sair</span>
          </button>
        </div>
      </div>}
    </SideDrawer>
  );
}

function DrawerIcon({ children, className = "" }) {
  return <span className={`icon-wrap ${className}`.trim()}>{children}</span>;
}

function FeedMenu({ onClose, onSearch, onRanking, onShop, onBugs, onArchive, onSettings, onAdmin, user, profile }) {
  const dmUnread = useDmUnread(user);
  const adminMode = useAdminMode(profile);
  const [versionText, setVersionText] = useState("versao beta 1.1");
  useEffect(() => {
    return onSnapshot(doc(db, "appConfig", "ui"), (snap) => {
      const value = snap.data()?.drawerVersionText;
      setVersionText(typeof value === "string" && value.trim() ? value.trim().slice(0, 60) : "versao beta 1.1");
    }, () => setVersionText("versao beta 1.1"));
  }, []);
  const open = (fn) => {
    fn();
  };
  const editVersionText = async () => {
    const next = window.prompt("Texto da versão no menu", versionText);
    if (next === null) return;
    const clean = next.trim().slice(0, 60) || "versao beta 1.1";
    try {
      await setDoc(doc(db, "appConfig", "ui"), { drawerVersionText: clean }, { merge: true });
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };
  return (
    <SideDrawer onClose={onClose}>
      {({ close }) => <div className="sub-panel active">
        <div className="drawer-head">
          <button
            className="drawer-me"
            type="button"
            onClick={() => {
              onClose();
              routeTo("profile.html");
            }}
          >
            <div id="drawerAvatar">
              <div className="grad-border" style={{ borderRadius: "50%", width: 54, height: 54 }}>
                <Avatar user={profile} size={50} />
              </div>
            </div>
            <div className="drawer-me-text">
              <div className="drawer-me-name"><StyledName user={profile} /><RoleBadges user={profile} /></div>
              <div className="drawer-me-user">@{profile?.username || "—"}</div>
            </div>
          </button>
          <button className="btn-icon tap" type="button" aria-label="Fechar" onClick={close}>
            <X size={18} />
          </button>
        </div>

        <div className="drawer-section drawer-nav">
          <button className="drawer-item w-full" style={{ "--drawer-item-index": 0 }} type="button" onClick={() => open(onSearch)}>
            <DrawerIcon><Search size={18} /></DrawerIcon>
            <span className="drawer-label">Pesquisar</span>
          </button>
          <button className="drawer-item w-full" style={{ "--drawer-item-index": 1 }} type="button" onClick={() => { onClose(); routeTo("news.html"); }}>
            <DrawerIcon><Newspaper size={18} /></DrawerIcon>
            <span className="drawer-label">Alfa News</span>
          </button>
          <button className="drawer-item w-full dm-item" style={{ "--drawer-item-index": 2 }} type="button" onClick={() => { onClose(); routeTo("dm.html"); }}>
            <DrawerIcon><Mail size={18} /></DrawerIcon>
            <span className="drawer-label">Mensagens Privadas</span>
            {dmUnread ? <span className="drawer-unread-dot" aria-hidden="true" /> : null}
          </button>
          <button className="drawer-item w-full" style={{ "--drawer-item-index": 3 }} type="button" onClick={() => open(onRanking)}>
            <DrawerIcon className="star-wrap"><Star size={18} fill="#fde047" stroke="#facc15" /></DrawerIcon>
            <span className="drawer-label">Ranking</span>
          </button>
          <button className="drawer-item w-full" style={{ "--drawer-item-index": 4 }} type="button" onClick={() => open(onShop)}>
            <DrawerIcon className="shop-wrap"><Store size={18} /></DrawerIcon>
            <span className="drawer-label">Loja</span>
          </button>
          <button className="drawer-item w-full" style={{ "--drawer-item-index": 5 }} type="button" onClick={() => open(onArchive)}>
            <DrawerIcon><Archive size={18} /></DrawerIcon>
            <span className="drawer-label">Arquivo</span>
          </button>
          <button className="drawer-item w-full" style={{ "--drawer-item-index": 6 }} type="button" onClick={() => open(onSettings)}>
            <DrawerIcon><Settings size={18} /></DrawerIcon>
            <span className="drawer-label">Definições</span>
          </button>
          {adminMode.adminView ? (
            <button className="drawer-item w-full" id="drawerAdminBtn" style={{ "--drawer-item-index": 7 }} type="button" onClick={() => open(onAdmin)}>
              <DrawerIcon className="god-wrap"><Shield size={18} /></DrawerIcon>
              <span className="drawer-label">God Mode</span>
            </button>
          ) : null}
          <button className="drawer-item w-full" style={{ "--drawer-item-index": adminMode.adminView ? 8 : 7 }} type="button" onClick={() => open(onBugs)}>
            <DrawerIcon><Bug size={18} /></DrawerIcon>
            <span className="drawer-label">{adminMode.adminView ? "Bugs Report" : "Bugs / Report"}</span>
          </button>
        </div>

        <div style={{ flex: 1 }} />
        <div className="drawer-version">
          <span>{versionText}</span>
          {adminMode.adminView ? (
            <button className="drawer-version-edit" type="button" aria-label="Editar texto da versão" onClick={editVersionText}>
              <Edit3 size={12} />
            </button>
          ) : null}
          {adminMode.adminView ? <><span> · </span><span className="grad-text">Admin Access</span></> : null}
          {!adminMode.adminView && (profile?.role === "mod" || profile?.isMod) ? <><span> · </span><span className="grad-text">Moderator Access</span></> : null}
        </div>
        <div className="drawer-section" style={{ borderTop: "1px solid var(--border)", padding: "12px 18px" }}>
          {/* SYSTEM-only nuke. Two prompts before anything happens:
              (1) a confirm() with the scope, (2) a typed-string check
              ("APAGAR TUDO") so a stray tap can't trigger a wipe. */}
          {adminMode.system ? (
            <button
              className="drawer-item w-full"
              type="button"
              style={{ color: "#fca5a5" }}
              onClick={async () => {
                if (!window.confirm("Apagar TODOS os dados públicos do servidor?\n\nVai apagar:\n  • posts, stories, news, reports\n  • notificações, archive, roles\n  • DMs e chat global\n\nMantém: utilizadores e configuração.\n\nContinuar?")) return;
                const typed = window.prompt("Confirmação final.\nEscreve APAGAR TUDO para prosseguir.");
                if (typed?.trim() !== "APAGAR TUDO") {
                  toast("Wipe cancelado.", "info");
                  return;
                }
                try {
                  await wipeAllData();
                  toast("Dados apagados.", "success");
                  onClose();
                } catch (err) {
                  toast(`Erro a apagar: ${err.message}`, "error");
                }
              }}
            >
              <DrawerIcon><Trash2 size={18} /></DrawerIcon>
              <span className="drawer-label">Apagar TUDO (server)</span>
            </button>
          ) : null}
          <button className="drawer-item w-full" type="button" style={{ color: "#fca5a5" }} onClick={async () => { if (confirm("Sair da conta?")) await logout(); }}>
            <DrawerIcon><LogOut size={18} /></DrawerIcon>
            <span className="drawer-label">Sair</span>
          </button>
        </div>
      </div>}
    </SideDrawer>
  );
}

function SimpleInfoModal({ title, children, onClose }) {
  return <SheetModal title={title} onClose={onClose}>{children}</SheetModal>;
}

function AdminPanelModal({ onClose }) {
  const [users, setUsers] = useState([]);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState(null);
  const [rolesOpen, setRolesOpen] = useState(null);

  useEffect(() => {
    const q = query(collection(db, "users"), fsLimit(300));
    return onSnapshot(q, (snap) => {
      const rows = snap.docs.map((item) => ({ uid: item.id, ...item.data() }));
      rows.sort((a, b) => (a.name || a.username || "").localeCompare(b.name || b.username || ""));
      setUsers(rows);
    }, (err) => toast(`Erro admin: ${err.message}`, "error"));
  }, []);

  const filtered = users.filter((item) => {
    const needle = filter.trim().toLowerCase().replace(/^@/, "");
    if (!needle) return true;
    return [item.name, item.username, item.uid].some((value) => String(value || "").toLowerCase().includes(needle));
  });

  const setRole = async (item, role) => {
    try {
      await updateDoc(doc(db, "users", item.uid), {
        role,
        isAdmin: role === "admin",
        isMod: role === "mod"
      });
      toast("Role atualizada", "success");
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  const applyTimeout = async (item, hours) => {
    const h = Number(hours) || 0;
    try {
      await updateDoc(doc(db, "users", item.uid), { timeoutUntil: h > 0 ? Date.now() + h * 60 * 60 * 1000 : null });
      toast(h > 0 ? "Timeout aplicado" : "Timeout removido", "success");
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  const applyPoints = async (item, delta) => {
    const amount = Number(delta) || 0;
    if (!amount) return;
    try {
      await updateDoc(doc(db, "users", item.uid), {
        points: increment(amount),
        totalPointsEarned: amount > 0 ? increment(amount) : increment(0)
      });
      toast("Pontos atualizados", "success");
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  const toggleBan = async (item) => {
    try {
      await updateDoc(doc(db, "users", item.uid), { banned: !item.banned });
      toast(item.banned ? "User desbanido" : "User banido", "success");
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  return (
    <SheetModal title="God Mode" onClose={onClose}>
      <input className="input" placeholder="Filtrar docs" value={filter} onChange={(event) => setFilter(event.target.value)} style={{ width: "100%", padding: 10, marginBottom: 10 }} />
      <div style={{ maxHeight: "65vh", overflowY: "auto" }}>
        {filtered.map((item) => (
          <AdminUserRow key={item.uid} item={item} onRole={setRole} onTimeout={applyTimeout} onPoints={applyPoints} onBan={toggleBan} onEdit={setEditing} onRoles={setRolesOpen} />
        ))}
        {!filtered.length ? <Empty title="Sem users encontrados." /> : null}
      </div>
      {editing ? <AdminUserEditor item={editing} onClose={() => setEditing(null)} /> : null}
      {rolesOpen ? <AdminRolesEditor item={rolesOpen} onClose={() => setRolesOpen(null)} /> : null}
    </SheetModal>
  );
}

function AdminUserRow({ item, onRole, onTimeout, onPoints, onBan, onEdit, onRoles }) {
  const [timeoutHours, setTimeoutHours] = useState("0");
  const [pointsDelta, setPointsDelta] = useState("0");
  const role = item.isAdmin ? "admin" : item.role === "mod" || item.isMod ? "mod" : "user";
  const timeoutLeft = item.timeoutUntil && item.timeoutUntil > Date.now() ? Math.ceil((item.timeoutUntil - Date.now()) / 3600000) : 0;
  return (
    <div className="admin-user-row">
      <div className="au-main">
        <div className="au-avatar"><Avatar user={item} size={44} /></div>
        <div className="au-body">
          <div className="au-name"><StyledName user={item} /><RoleBadges user={item} /></div>
          <div className="au-meta">@{item.username || ""} - {item.points || 0} pts{timeoutLeft ? ` - timeout ${timeoutLeft}h` : ""}</div>
        </div>
      </div>
      <div className="au-toolbar">
        <label className="au-role-field">
          <span className="au-label">Role</span>
          <select value={role} onChange={(event) => onRole(item, event.target.value)}>
            <option value="user">User</option>
            <option value="mod">Mod</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <div className="au-actions">
          <button className="admin-user-btn admin-user-btn--edit" type="button" onClick={() => onEdit(item)}>Editar</button>
          <button className="admin-user-btn" type="button" style={{ background: "rgba(139,92,246,.12)", color: "#a5b4fc", borderColor: "rgba(139,92,246,.3)" }} onClick={() => onRoles(item)}>Roles</button>
          <button className={`ban-btn admin-user-btn ${item.banned ? "banned" : ""}`} type="button" onClick={() => onBan(item)}>{item.banned ? "Desbanir" : "Banir"}</button>
        </div>
      </div>
      <div className="au-control-grid">
        <div className="au-control">
          <div className="au-control-head">
            <span className="au-label">Timeout</span>
            <span className="au-value">{timeoutHours}h</span>
          </div>
          <div className="au-control-row au-control-row--range">
            <input type="range" min="0" max="72" step="1" value={timeoutHours} onChange={(event) => setTimeoutHours(event.target.value)} />
            <button type="button" className="btn-ghost tap admin-user-apply" onClick={() => onTimeout(item, timeoutHours)}>Aplicar</button>
          </div>
        </div>
        <div className="au-control">
          <div className="au-control-head">
            <span className="au-label">Pontos</span>
          </div>
          <div className="au-control-row">
            <input type="number" value={pointsDelta} onChange={(event) => setPointsDelta(event.target.value)} className="au-number-input" placeholder="+/-" />
            <button type="button" className="btn-ghost tap admin-user-apply" onClick={() => { onPoints(item, pointsDelta); setPointsDelta("0"); }}>Aplicar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminUserEditor({ item, onClose }) {
  const [form, setForm] = useState({
    name: item.name || "",
    username: item.username || "",
    bio: item.bio || "",
    photoURL: item.photoURL || ""
  });
  const save = async () => {
    try {
      await updateDoc(doc(db, "users", item.uid), {
        name: form.name.trim(),
        username: form.username.trim().toLowerCase().replace(/^@/, ""),
        bio: form.bio.trim(),
        photoURL: form.photoURL.trim()
      });
      toast("User atualizado", "success");
      onClose();
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  return (
    <SheetModal title="Editar user" onClose={onClose}>
      <div style={{ display: "grid", gap: 10 }}>
        <input className="input" placeholder="Nome" value={form.name} onChange={(event) => set("name", event.target.value)} />
        <input className="input" placeholder="@username" value={form.username} onChange={(event) => set("username", event.target.value)} />
        <textarea className="input" rows="4" placeholder="Bio" value={form.bio} onChange={(event) => set("bio", event.target.value)} />
        <input className="input" placeholder="URL da foto" value={form.photoURL} onChange={(event) => set("photoURL", event.target.value)} />
        <button className="btn-primary" type="button" onClick={save}>Guardar</button>
      </div>
    </SheetModal>
  );
}

function AdminRolesEditor({ item, onClose }) {
  const allRoles = useRoles(true);
  const [selected, setSelected] = useState(() => new Set(Array.isArray(item.roles) ? item.roles : []));
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleColor, setNewRoleColor] = useState("#8b5cf6");
  const toggle = (roleId) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(roleId)) next.delete(roleId);
    else next.add(roleId);
    return next;
  });
  const createRole = async () => {
    const name = newRoleName.trim();
    if (!name) return;
    try {
      const created = await addDoc(collection(db, "roles"), {
        name,
        color: newRoleColor,
        createdAt: serverTimestamp()
      });
      setSelected((prev) => new Set([...prev, created.id]));
      setNewRoleName("");
      toast("Role criado.", "success");
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };
  const save = async () => {
    try {
      await updateDoc(doc(db, "users", item.uid), { roles: [...selected] });
      toast("Roles guardadas", "success");
      onClose();
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };
  return (
    <SheetModal title={`Roles de @${item.username || item.name || "user"}`} onClose={onClose}>
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Seleciona as roles invisiveis que controlam o arquivo, como na versao legacy.</div>
        <div className="role-picker-list">
          {allRoles.map((role) => (
            <label className="role-pick" key={role.id}>
              <input type="checkbox" checked={selected.has(role.id)} onChange={() => toggle(role.id)} />
              <span className="role-chip" style={{ background: role.color || "#8b5cf6" }} />
              <span>{role.name || role.id}</span>
            </label>
          ))}
          {!allRoles.length ? <div className="empty" style={{ padding: 10 }}>Sem roles ainda.</div> : null}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="input" placeholder="Nova role" value={newRoleName} onChange={(event) => setNewRoleName(event.target.value)} />
          <input type="color" value={newRoleColor} onChange={(event) => setNewRoleColor(event.target.value)} style={{ width: 42, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-1)" }} />
          <button className="btn-ghost tap" type="button" onClick={createRole}>Criar</button>
        </div>
        <button className="btn-primary" type="button" onClick={save}>Guardar roles</button>
      </div>
    </SheetModal>
  );
}

function ArchiveModal({ user, profile, onClose, onBack }) {
  const [sections, setSections] = useState([]);
  const [entries, setEntries] = useState([]);
  const [openSection, setOpenSection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [archiveError, setArchiveError] = useState("");
  const [entriesError, setEntriesError] = useState("");
  const [editor, setEditor] = useState(null);
  const adminMode = useAdminMode(profile);
  const isArchiveAdmin = !!adminMode.adminView;
  const allRoles = useRoles(isArchiveAdmin);
  const rolesById = useMemo(() => new Map(allRoles.map((role) => [role.id, role])), [allRoles]);
  const sortArchiveItems = (items) => [...items].sort((a, b) => {
    const ao = Number.isFinite(Number(a.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;
    const bo = Number.isFinite(Number(b.order)) ? Number(b.order) : Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
    const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
    return at - bt;
  });
  const getSectionRoles = (section) => {
    const raw = Array.isArray(section?.requiredRoles) ? section.requiredRoles
      : Array.isArray(section?.roles) ? section.roles
        : Array.isArray(section?.visibleToRoles) ? section.visibleToRoles
          : Array.isArray(section?.allowedRoles) ? section.allowedRoles
            : [];
    return raw.map((role) => String(role).trim()).filter(Boolean);
  };

  useEffect(() => {
    return onSnapshot(collection(db, "archiveSections"), (snap) => {
      setSections(sortArchiveItems(snap.docs.map((item) => ({ id: item.id, ...item.data() }))));
      setArchiveError("");
      setLoading(false);
    }, (err) => {
      setLoading(false);
      setArchiveError(err.message || "Erro desconhecido.");
      toast(`Erro no arquivo: ${err.message}`, "error");
    });
  }, []);

  useEffect(() => {
    if (!openSection?.id) {
      setEntries([]);
      setEntriesError("");
      return undefined;
    }
    return onSnapshot(collection(db, "archiveSections", openSection.id, "entries"), (snap) => {
      setEntries(sortArchiveItems(snap.docs.map((item) => ({ id: item.id, ...item.data() }))));
      setEntriesError("");
    }, (err) => {
      setEntriesError(err.message || "Erro desconhecido.");
      toast(`Erro nas entradas: ${err.message}`, "error");
    });
  }, [openSection?.id]);

  const profileRoles = useMemo(() => {
    const roles = new Set(Array.isArray(profile?.roles) ? profile.roles : []);
    if (profile?.role) roles.add(profile.role);
    if (adminMode.adminView) roles.add("admin");
    if (profile?.isMod || profile?.role === "mod") roles.add("mod");
    return roles;
  }, [adminMode.adminView, profile]);

  const canSeeSection = (section) => {
    if (isArchiveAdmin || section?.createdBy === user?.uid) return true;
    const required = getSectionRoles(section);
    return !required.length || required.some((role) => profileRoles.has(role));
  };

  const canManageSection = (section) => isArchiveAdmin || section?.createdBy === user?.uid;
  const visibleSections = sections.filter(canSeeSection);

  const saveSection = async (values) => {
    const currentRequiredRoles = Array.isArray(editor?.item?.requiredRoles) ? editor.item.requiredRoles : [];
    const data = {
      name: values.name.trim(),
      description: values.description.trim(),
      icon: values.icon.trim() || "📁",
      requiredRoles: isArchiveAdmin ? values.requiredRoles.split(",").map((item) => item.trim()).filter(Boolean) : currentRequiredRoles,
      order: Number(values.order) || sections.length + 1,
      updatedAt: serverTimestamp()
    };
    if (!data.name) {
      toast("Da um nome a secção.", "error");
      return;
    }
    if (editor?.item?.id) {
      await updateDoc(doc(db, "archiveSections", editor.item.id), data);
      toast("Secção atualizada.", "success");
    } else {
      await addDoc(collection(db, "archiveSections"), { ...data, createdAt: serverTimestamp(), createdBy: user.uid });
      toast("Secção criada.", "success");
    }
    setEditor(null);
  };

  const saveEntry = async (values) => {
    if (!openSection?.id) return;
    const data = {
      title: values.title.trim(),
      body: values.body.trim(),
      imageURL: values.imageURL.trim(),
      links: values.linkUrl.trim() ? [{ label: values.linkLabel.trim() || values.linkUrl.trim(), url: values.linkUrl.trim() }] : [],
      order: Number(values.order) || entries.length + 1,
      updatedAt: serverTimestamp()
    };
    if (!data.title && !data.body) {
      toast("Escreve titulo ou texto.", "error");
      return;
    }
    if (editor?.item?.id) {
      await updateDoc(doc(db, "archiveSections", openSection.id, "entries", editor.item.id), data);
      toast("Entrada atualizada.", "success");
    } else {
      await addDoc(collection(db, "archiveSections", openSection.id, "entries"), { ...data, createdAt: serverTimestamp(), createdBy: user.uid });
      toast("Entrada criada.", "success");
    }
    setEditor(null);
  };

  const deleteSection = async (section) => {
    if (!confirm(`Apagar a secção "${section.name || "Arquivo"}"?`)) return;
    try {
      const snap = await getDocs(collection(db, "archiveSections", section.id, "entries"));
      await Promise.all(snap.docs.map((item) => deleteDoc(item.ref)));
      await deleteDoc(doc(db, "archiveSections", section.id));
      if (openSection?.id === section.id) setOpenSection(null);
      toast("Secção apagada.", "success");
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  const deleteEntry = async (entry) => {
    if (!openSection?.id || !confirm(`Apagar a entrada "${entry.title || "sem titulo"}"?`)) return;
    try {
      await deleteDoc(doc(db, "archiveSections", openSection.id, "entries", entry.id));
      toast("Entrada apagada.", "success");
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  return (
    <>
      <SideDrawer onClose={onClose}>
        {() => <div className="sub-panel active">
          <div className="sub-panel-head">
            {openSection ? (
              <button className="icon-btn tap" type="button" aria-label="Voltar" onClick={() => setOpenSection(null)}><ChevronLeft size={20} /></button>
            ) : (
              <button className="icon-btn tap" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft size={20} /></button>
            )}
            <div id="archiveTitle" style={{ fontWeight: 700 }}>{openSection?.name || "Arquivo"}</div>
            <button className="btn-ghost tap" type="button" style={{ padding: "7px 10px", fontSize: 12 }} onClick={() => setEditor(openSection ? { type: "entry" } : { type: "section" })} disabled={!!openSection && !canManageSection(openSection)}>
              {openSection ? "+ Entrada" : "+ Secção"}
            </button>
          </div>

        {!openSection ? (
          <div id="archiveSectionsList" className="settings-section" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {loading ? <Loading /> : null}
            {!loading && archiveError ? <Empty title="Não consegui carregar o arquivo." detail={archiveError} /> : null}
            {!loading && !archiveError && !sections.length ? <Empty title="Ainda não há secções." detail="Cria uma secção para organizar o arquivo." /> : null}
            {!loading && !archiveError && sections.length > 0 && !visibleSections.length ? <Empty title="Sem secções visíveis." detail="Há secções no arquivo, mas nenhuma está disponível para as tuas roles." /> : null}
            {visibleSections.map((section) => (
              <div className="archive-section-card" key={section.id}>
                <button type="button" className="archive-section-body" onClick={() => setOpenSection(section)}>
                  <span className="archive-section-icon">{section.icon || "📁"}</span>
                  <span className="archive-section-meta">
                    <span className="archive-section-name">{section.name || "Sem nome"}</span>
                    {section.description ? <span className="archive-section-desc">{section.description}</span> : null}
                  </span>
                  {Array.isArray(section.requiredRoles) && section.requiredRoles.length ? (
                    <span className="archive-section-roles">
                      {section.requiredRoles.map((role) => <span key={role} className="role-chip-mini" title={rolesById.get(role)?.name || role} style={{ background: rolesById.get(role)?.color || undefined }} />)}
                    </span>
                  ) : null}
                  <span className="archive-section-chev">&gt;</span>
                </button>
                {canManageSection(section) ? (
                  <div className="archive-section-actions">
                    <button className="icon-btn" type="button" title="Editar" onClick={() => setEditor({ type: "section", item: section })}><Edit3 size={16} /></button>
                    <button className="icon-btn" type="button" title="Apagar" style={{ color: "#fca5a5" }} onClick={() => deleteSection(section)}><Trash2 size={16} /></button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div id="archiveEntriesList" className="settings-section" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {entriesError ? <Empty title="Não consegui carregar esta secção." detail={entriesError} /> : null}
            {!entriesError && !entries.length ? <Empty title="Esta secção esta vazia." detail={canManageSection(openSection) ? "Adiciona uma entrada." : ""} /> : null}
            {entries.map((entry) => (
              <div className="archive-entry-card" key={entry.id}>
                {entry.imageURL ? <div className="archive-entry-image"><img src={entry.imageURL} alt="" loading="lazy" /></div> : null}
                <div className="archive-entry-body">
                  {entry.title ? <div className="archive-entry-title">{entry.title}</div> : null}
                  {entry.body ? <div className="archive-entry-text" style={{ whiteSpace: "pre-wrap" }}>{entry.body}</div> : null}
                  {Array.isArray(entry.links) && entry.links.length ? (
                    <div className="archive-entry-links">
                      {entry.links.map((link, index) => link?.url ? <a key={index} className="archive-entry-link" href={link.url} target="_blank" rel="noreferrer"><span>{link.label || link.url}</span></a> : null)}
                    </div>
                  ) : null}
                </div>
                {canManageSection(openSection) ? (
                  <div className="archive-entry-actions">
                    <button className="icon-btn" type="button" title="Editar" onClick={() => setEditor({ type: "entry", item: entry })}><Edit3 size={14} /></button>
                    <button className="icon-btn" type="button" title="Apagar" style={{ color: "#fca5a5" }} onClick={() => deleteEntry(entry)}><Trash2 size={14} /></button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
        </div>}
      </SideDrawer>
      {editor?.type === "section" ? <ArchiveSectionEditor item={editor.item} sectionsCount={sections.length} isAdmin={isArchiveAdmin} roles={allRoles} onClose={() => setEditor(null)} onSave={saveSection} /> : null}
      {editor?.type === "entry" ? <ArchiveEntryEditor item={editor.item} entriesCount={entries.length} onClose={() => setEditor(null)} onSave={saveEntry} /> : null}
    </>
  );
}

function ArchiveSectionEditor({ item, sectionsCount, isAdmin, roles = [], onClose, onSave }) {
  const [values, setValues] = useState({
    name: item?.name || "",
    description: item?.description || "",
    icon: item?.icon || "📁",
    order: item?.order || sectionsCount + 1,
    requiredRoles: Array.isArray(item?.requiredRoles) ? item.requiredRoles.join(", ") : ""
  });
  const set = (key, value) => setValues((prev) => ({ ...prev, [key]: value }));
  const selectedRoles = new Set(values.requiredRoles.split(",").map((role) => role.trim()).filter(Boolean));
  const toggleRole = (roleId) => {
    const next = new Set(selectedRoles);
    if (next.has(roleId)) next.delete(roleId);
    else next.add(roleId);
    set("requiredRoles", [...next].join(", "));
  };
  return (
    <SheetModal title={item ? "Editar secção" : "Nova secção"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input className="input" placeholder="Nome" value={values.name} onChange={(event) => set("name", event.target.value)} style={{ padding: 11 }} />
        <input className="input" placeholder="Descrição" value={values.description} onChange={(event) => set("description", event.target.value)} style={{ padding: 11 }} />
        <input className="input" placeholder="Ícone" value={values.icon} onChange={(event) => set("icon", event.target.value)} style={{ padding: 11 }} />
        <input className="input" type="number" placeholder="Ordem" value={values.order} onChange={(event) => set("order", event.target.value)} style={{ padding: 11 }} />
        {isAdmin ? (
          <div className="role-picker-list">
            {roles.map((role) => (
              <label className="role-pick" key={role.id}>
                <input type="checkbox" checked={selectedRoles.has(role.id)} onChange={() => toggleRole(role.id)} />
                <span className="role-chip" style={{ background: role.color || "#8b5cf6" }} />
                <span>{role.name || role.id}</span>
              </label>
            ))}
            {!roles.length ? <div className="empty" style={{ padding: 10 }}>Sem roles definidas.</div> : null}
          </div>
        ) : null}
        <button className="btn-primary" type="button" onClick={() => onSave(values)}>Guardar</button>
      </div>
    </SheetModal>
  );
}

function ArchiveEntryEditor({ item, entriesCount, onClose, onSave }) {
  const firstLink = Array.isArray(item?.links) ? item.links[0] : null;
  const [values, setValues] = useState({
    title: item?.title || "",
    body: item?.body || "",
    imageURL: item?.imageURL || "",
    linkLabel: firstLink?.label || "",
    linkUrl: firstLink?.url || "",
    order: item?.order || entriesCount + 1
  });
  const set = (key, value) => setValues((prev) => ({ ...prev, [key]: value }));
  return (
    <SheetModal title={item ? "Editar entrada" : "Nova entrada"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input className="input" placeholder="Titulo" value={values.title} onChange={(event) => set("title", event.target.value)} style={{ padding: 11 }} />
        <textarea className="input" rows="6" placeholder="Texto" value={values.body} onChange={(event) => set("body", event.target.value)} style={{ padding: 11, fontFamily: "inherit" }} />
        <input className="input" placeholder="URL de imagem opcional" value={values.imageURL} onChange={(event) => set("imageURL", event.target.value)} style={{ padding: 11 }} />
        <input className="input" placeholder="Label do link opcional" value={values.linkLabel} onChange={(event) => set("linkLabel", event.target.value)} style={{ padding: 11 }} />
        <input className="input" placeholder="URL do link opcional" value={values.linkUrl} onChange={(event) => set("linkUrl", event.target.value)} style={{ padding: 11 }} />
        <input className="input" type="number" placeholder="Ordem" value={values.order} onChange={(event) => set("order", event.target.value)} style={{ padding: 11 }} />
        <button className="btn-primary" type="button" onClick={() => onSave(values)}>Guardar</button>
      </div>
    </SheetModal>
  );
}

export function FeedPage({ search = "" }) {
  const { loading: authLoading, user, profile, error } = useAuthProfile({ requireUser: true });
  const adminMode = useAdminMode(profile);
  const [filter, setFilter] = useState(() => localStorage.getItem("alfa_feed_filter") || "global");
  const [modal, setModal] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const containerRef = useRef(null);
  const logoTimerRef = useRef(null);
  const logoAudioRef = useRef(null);
  const [logoEggActive, setLogoEggActive] = useState(false);
  const posts = usePosts(user, profile, filter, refreshKey);
  const stories = useStories(refreshKey);
  const refreshFeed = useCallback(() => {
    setRefreshKey((value) => value + 1);
    toast("Feed atualizado!", "success");
  }, []);
  const playLogoEggSound = useCallback(() => {
    try {
      const audio = logoAudioRef.current || new Audio(`${import.meta.env.BASE_URL || "/"}sounds/notification.mp3`);
      logoAudioRef.current = audio;
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 0.85;
      audio.play()?.catch?.(() => {});
    } catch {}
  }, []);
  const popLogo = useCallback(() => {
    playLogoEggSound();
    if (logoTimerRef.current) window.clearTimeout(logoTimerRef.current);
    setLogoEggActive(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setLogoEggActive(true));
      logoTimerRef.current = window.setTimeout(() => setLogoEggActive(false), 900);
    });
  }, [playLogoEggSound]);

  usePullToRefresh(containerRef, {
    enabled: !!user && !!profile && !modal,
    onRefresh: refreshFeed
  });

  useEffect(() => () => {
    if (logoTimerRef.current) window.clearTimeout(logoTimerRef.current);
  }, []);

  useEffect(() => {
    localStorage.setItem("alfa_feed_filter", filter);
  }, [filter]);

  useEffect(() => {
    if (new URLSearchParams(search || "").get("notifs") === "1") setModal("notifications");
  }, [search]);

  return (
    <PageFrame page="index.html">
      <GradientDefs />
      <header className="app-header app-header-centered">
        <div className="app-header-left">
          <button className="icon-btn tap" type="button" aria-label="Definições" onClick={() => setModal("settings")}><LegacySettingsIcon size={22} /></button>
        </div>
        <div className="app-header-title">
          <div
            id="appLogoTitle"
            className={`logo grad-text alfa-club-egg ${logoEggActive ? "alfa-club-egg-active" : ""}`}
            role="button"
            tabIndex={0}
            onPointerDown={popLogo}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                popLogo();
              }
            }}
          >
            Alfa Club
          </div>
          {/* When SYSTEM is on the admin sees a tiny amber subtitle so
              they're never in any doubt that destructive controls are
              currently armed. */}
          {adminMode.system ? <div className="system-access-tag">system access</div> : null}
        </div>
        <div className="app-header-right">
          <NotificationsButton user={user} onOpen={() => setModal("notifications")} />
          <button className="icon-btn tap" type="button" aria-label="Menu" onClick={() => setModal("menu")}><Menu size={22} /></button>
        </div>
      </header>

      <div className="container" ref={containerRef}>
        {authLoading ? <Loading /> : null}
        {error ? <Empty title="ão foi possível abrir a app." detail={error.message} /> : null}
        {!authLoading && user && profile ? (
          <>
            <Stories stories={stories} user={user} profile={profile} />
            <Composer user={user} profile={profile} />
            <div className="feed-filter">
              <button className={`feed-filter-btn ${filter === "global" ? "active" : ""}`} type="button" onClick={() => setFilter("global")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <path d="M12 3a15 15 0 0 1 0 18" />
                  <path d="M12 3a15 15 0 0 0 0 18" />
                </svg>
                Global
              </button>
              <button className={`feed-filter-btn ${filter === "following" ? "active" : ""}`} type="button" onClick={() => setFilter("following")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <polyline points="17 11 19 13 23 9" />
                </svg>
                A seguir
              </button>
            </div>
            <div>
              {posts.loading ? <Loading /> : null}
              {posts.error ? <Empty title="Erro ao carregar o feed." detail={posts.error.message} /> : null}
              {!posts.loading && !posts.error && !posts.posts.length ? <Empty title="Ainda não há posts." detail="Publica o primeiro." /> : null}
              {posts.posts.map((post) => <PostCard key={post.id} post={post} user={user} profile={profile} />)}
            </div>
          </>
        ) : null}
      </div>
      <BottomNav active="index.html" />
      {modal === "search" ? <SearchModal onClose={() => setModal(null)} /> : null}
      {modal === "ranking" ? <RankingModal onClose={() => setModal(null)} /> : null}
      {modal === "shop" && user && profile ? <ShopModal user={user} profile={profile} onClose={() => setModal(null)} /> : null}
      {modal === "bugs" && user && profile ? <BugReportModal user={user} profile={profile} onClose={() => setModal(null)} /> : null}
      {modal === "notifications" && user ? <NotificationsModal user={user} onClose={() => setModal(null)} /> : null}
      {modal === "archive" && user && profile ? <ArchiveModal user={user} profile={profile} onClose={() => setModal(null)} onBack={() => setModal("menu")} /> : null}
      {(modal === "settings" || modal === "settings-menu") && user && profile ? <SettingsPanel user={user} profile={profile} onClose={() => setModal(null)} onBack={modal === "settings-menu" ? () => setModal("menu") : undefined} onAdmin={() => setModal("admin")} /> : null}
      {modal === "admin" ? <AdminPanelModal onClose={() => setModal(null)} /> : null}
      {modal === "menu" ? <FeedMenu onClose={() => setModal(null)} onSearch={() => setModal("search")} onRanking={() => setModal("ranking")} onShop={() => setModal("shop")} onBugs={() => setModal("bugs")} onArchive={() => setModal("archive")} onSettings={() => setModal("settings-menu")} onAdmin={() => setModal("admin")} user={user} profile={profile} /> : null}
    </PageFrame>
  );
}
