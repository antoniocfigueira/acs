import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  updateDoc,
  where
} from "firebase/firestore";
import { Archive, Bell, Bug, Camera, ChevronLeft, Edit3, Image as ImageIcon, LogOut, Mail, Menu, Newspaper, Search, Settings, Shield, SlidersHorizontal, Star, Store, Trash2, X } from "lucide-react";
import { BottomNav, GradientDefs, LegacySettingsIcon, PageFrame } from "../components/Shell.jsx";
import { SheetModal, SideDrawer } from "../components/Modal.jsx";
import { NotificationsButton, NotificationsModal } from "../components/Notifications.jsx";
import { PostCard } from "../components/PostCard.jsx";
import { usePullToRefresh } from "../hooks/usePullToRefresh.js";
import { logout, updateMyProfile, useAuthProfile } from "../lib/auth.js";
import { db, initPush, playNotificationSound } from "../lib/firebase.js";
import { routeTo } from "../lib/navigation.js";
import { uploadMedia } from "../lib/upload.js";
import { Avatar, Empty, Loading, RoleBadges, StyledName, toast } from "../lib/ui.jsx";

const SHOP_ITEMS = [
  { id: "color_cyan", unlockField: "unlockedNameColors", unlockValue: "#22d3ee", name: "Cor Azul", sub: "Nome em azul", price: 50, preview: <span className="name-sample" style={{ color: "#22d3ee" }}>Nome</span>, apply: { nameColor: "#22d3ee" } },
  { id: "color_pink", unlockField: "unlockedNameColors", unlockValue: "#ec4899", name: "Cor Rosa", sub: "Nome em rosa", price: 50, preview: <span className="name-sample" style={{ color: "#ec4899" }}>Nome</span>, apply: { nameColor: "#ec4899" } },
  { id: "color_green", unlockField: "unlockedNameColors", unlockValue: "#22c55e", name: "Cor Verde", sub: "Nome em verde", price: 50, preview: <span className="name-sample" style={{ color: "#22c55e" }}>Nome</span>, apply: { nameColor: "#22c55e" } },
  { id: "color_gold", unlockField: "unlockedNameStyles", unlockValue: "gold", name: "Dourado especial", sub: "Cor dourada com glow", price: 50, preview: <span className="name-sample name-gold">Nome</span>, apply: { nameStyle: "gold" } },
  { id: "grad_anim", unlockField: "unlockedNameStyles", unlockValue: "grad", name: "Degrade animado", sub: "Nome com gradiente animado", price: 30, preview: <span className="name-sample name-grad-anim">Nome</span>, apply: { nameStyle: "grad" } },
  { id: "reset_color", name: "Remover modificacoes", sub: "Voltar a cor padrao", price: 0, preview: <span className="name-sample">Nome</span>, apply: { nameColor: null, nameStyle: null } },
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
  { id: "ptheme_sakura", unlockField: "unlockedProfileThemes", unlockValue: "sakura", name: "Sakura", sub: "Petalas a cair", price: 100, preview: <span className="pt-preview pt-preview-sakura" />, apply: { profileTheme: "sakura" } }
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
    const q = query(collection(db, "stories"), orderBy("createdAt", "desc"), fsLimit(50));
    return onSnapshot(q, (snap) => {
      const now = Date.now();
      const rows = [];
      snap.forEach((item) => {
        const story = { id: item.id, ...item.data() };
        const exp = story.expiresAt?.toMillis ? story.expiresAt.toMillis() : story.expiresAt || 0;
        if (exp && exp < now) return;
        rows.push(story);
      });
      setStories(rows);
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

function itemIsUnlocked(profile, item) {
  if (item.price === 0) return true;
  if (!item.unlockField || item.unlockValue === undefined) return false;
  const activeByLegacyField = item.apply && Object.entries(item.apply).some(([key, value]) => value && profile?.[key] === value);
  return activeByLegacyField || (Array.isArray(profile?.[item.unlockField]) && profile[item.unlockField].includes(item.unlockValue));
}

function Composer({ user, profile }) {
  const [text, setText] = useState("");
  const [media, setMedia] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [notifyAll, setNotifyAll] = useState(false);
  const fileRef = useRef(null);

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
        notifyAll: !!(profile.isAdmin && notifyAll),
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
          <div className="media-preview" style={{ position: "relative" }}>
            {media.type === "image" ? <img src={media.url} alt="" style={{ width: "100%", display: "block" }} /> : null}
            {media.type === "video" ? <video src={media.url} controls style={{ width: "100%", display: "block" }} /> : null}
            {media.type === "poll" ? (
              <div className="poll-preview">
                <SlidersHorizontal size={18} style={{ color: "#ec4899", flexShrink: 0 }} />
                <div className="poll-preview-label">{media.poll.question}</div>
                <div className="poll-preview-type">{media.poll.kind === "slider" ? "Slider 0-100" : `${media.poll.options?.length || 0} opcoes`}</div>
              </div>
            ) : null}
            <button type="button" className="remove-media" aria-label="Remover" onClick={() => setMedia(null)}>x</button>
          </div>
        ) : null}
        <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: "none" }} onChange={(event) => pickFile(event.target.files?.[0])} />
        <div className="tools">
          <div className="char-count">{text.length} / 500</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button className="btn-ghost tap" type="button" style={{ padding: "8px 12px", fontSize: 13 }} title="Adicionar foto/video" onClick={() => fileRef.current?.click()} disabled={busy}>
              <ImageIcon size={16} />
            </button>
            {profile?.isAdmin ? (
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
      {pollOpen ? <PollBuilderModal onClose={() => setPollOpen(false)} onCreate={(poll) => { setMedia({ type: "poll", poll }); setPollOpen(false); }} /> : null}
    </div>
  );
}

function PollToolIcon() {
  return (
    <svg className="poll-tool-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="5" y="13" width="2.7" height="6.5" rx="1.35" fill="currentColor" />
      <rect x="10.65" y="7.5" width="2.7" height="12" rx="1.35" fill="currentColor" />
      <rect x="16.3" y="3.8" width="2.7" height="15.7" rx="1.35" fill="currentColor" />
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
      toast("Precisas de pelo menos 2 opcoes.", "error");
      return;
    }
    onCreate({ kind: "options", question: q, options: clean.map((item) => ({ text: item, votes: 0 })) });
  };
  return (
    <SheetModal title="Criar sondagem" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className={`${kind === "options" ? "btn-primary" : "btn-ghost"} tap`} style={{ flex: 1, padding: 10, fontSize: 13 }} onClick={() => setKind("options")}>Opcoes</button>
          <button type="button" className={`${kind === "slider" ? "btn-primary" : "btn-ghost"} tap`} style={{ flex: 1, padding: 10, fontSize: 13 }} onClick={() => setKind("slider")}>Slider 0-100</button>
        </div>
        <div className="field">
          <label style={{ display: "block", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6, paddingLeft: 4 }}>Pergunta</label>
          <input className="input" maxLength="120" placeholder="Qual e a tua pergunta?" value={question} onChange={(event) => setQuestion(event.target.value)} style={{ padding: "11px 14px" }} />
        </div>
        {kind === "options" ? (
          <div>
            <label style={{ display: "block", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6, paddingLeft: 4 }}>Opcoes</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {options.map((value, index) => (
                <input key={index} className="input" placeholder={`Opcao ${index + 1}`} value={value} onChange={(event) => setOptions((prev) => prev.map((item, i) => i === index ? event.target.value : item))} style={{ padding: "10px 12px" }} />
              ))}
            </div>
            {options.length < 5 ? <button className="btn-ghost tap" type="button" style={{ marginTop: 8, padding: "8px 12px", fontSize: 12 }} onClick={() => setOptions((prev) => [...prev, ""])}>+ Opcao</button> : null}
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
    return [...map.values()];
  }, [stories]);

  const createStory = async (file, storyText = "") => {
    if (!file) return;
    try {
      const up = await uploadMedia(file);
      await addDoc(collection(db, "stories"), {
        uid: user.uid,
        authorName: profile.name || "",
        authorUsername: profile.username || "",
        authorPhoto: profile.photoURL || "",
        text: storyText.trim().slice(0, 160),
        mediaURL: up.url,
        mediaType: up.type,
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
      {viewer ? <StoryViewer stories={viewer} user={user} onClose={() => setViewer(null)} /> : null}
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
        <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: "none" }} onChange={(event) => pick(event.target.files?.[0])} />
        <button className="btn-ghost" type="button" onClick={() => fileRef.current?.click()}>Escolher foto/video</button>
        {preview ? (
          <div style={{ position: "relative", borderRadius: 14, overflow: "hidden", border: "1px solid var(--border)", background: "#050505" }}>
            {file?.type?.startsWith("video/") ? <video src={preview} controls style={{ width: "100%", maxHeight: 280 }} /> : <img src={preview} alt="" style={{ width: "100%", maxHeight: 280, objectFit: "contain", display: "block" }} />}
          </div>
        ) : null}
        <textarea className="input" rows="3" maxLength="160" placeholder="Texto da story..." value={text} onChange={(event) => setText(event.target.value)} style={{ padding: 12, fontFamily: "inherit", resize: "vertical" }} />
        <button className="btn-primary" type="button" disabled={!file} onClick={() => onCreate(file, text)}>Publicar story</button>
      </div>
    </SheetModal>
  );
}

function StoryViewer({ stories, user, onClose }) {
  const [index, setIndex] = useState(0);
  const story = stories[index] || stories[0];
  if (!story) return null;
  const next = () => {
    if (index >= stories.length - 1) onClose();
    else setIndex((i) => i + 1);
  };
  const deleteStory = async () => {
    if (!confirm("Apagar esta story?")) return;
    try {
      await deleteDoc(doc(db, "stories", story.id));
      onClose();
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };
  return (
    <div className="story-viewer-react" style={{ position: "fixed", inset: 0, zIndex: 220, background: "rgba(0,0,0,.92)", display: "grid", placeItems: "center" }} onClick={next}>
      <button className="icon-btn tap story-viewer-close" type="button" aria-label="Fechar" onClick={(event) => { event.stopPropagation(); onClose(); }}>
        <X size={22} />
      </button>
      {story.uid === user.uid ? <button className="story-viewer-delete tap" type="button" onClick={(event) => { event.stopPropagation(); deleteStory(); }}>Apagar</button> : null}
      {story.mediaType === "video" ? <video src={story.mediaURL} controls autoPlay style={{ maxWidth: "100vw", maxHeight: "86vh" }} /> : <img src={story.mediaURL} alt="" style={{ maxWidth: "100vw", maxHeight: "86vh", objectFit: "contain" }} />}
      {story.text ? <div style={{ position: "absolute", left: 20, right: 20, bottom: "calc(28px + env(safe-area-inset-bottom))", textAlign: "center", color: "white", fontWeight: 700, fontSize: 20, textShadow: "0 2px 12px rgba(0,0,0,.9)", whiteSpace: "pre-wrap" }}>{story.text}</div> : null}
    </div>
  );
}

function SearchModal({ onClose }) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);
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
  return (
    <SheetModal title="Pesquisar" onClose={onClose}>
      <input className="input" placeholder="Nome ou @username" value={q} onChange={(event) => setQ(event.target.value)} style={{ width: "100%", padding: "11px 14px" }} />
      <div style={{ marginTop: 10, maxHeight: "60vh", overflowY: "auto" }}>
        {users.map((item) => (
          <button key={item.uid} className="user-list-item" type="button" onClick={() => { onClose(); routeTo("profile.html", `?u=${encodeURIComponent(item.username || "")}`); }}>
            <div className="user-list-avatar"><Avatar user={item} size={42} /></div>
            <div className="user-list-meta">
              <div className="user-list-name"><StyledName user={item} /><RoleBadges user={item} /></div>
              <div className="user-list-user">@{item.username || ""}</div>
            </div>
          </button>
        ))}
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
      {users.map((item, idx) => (
        <button key={item.uid} className="rank-row" type="button" onClick={() => { onClose(); routeTo("profile.html", `?u=${encodeURIComponent(item.username || "")}`); }}>
          <div className={`pos ${idx < 3 ? "top" : ""}`}>{idx + 1}</div>
          <Avatar user={item} size={36} />
          <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <div style={{ fontWeight: 700 }}><StyledName user={item} /><RoleBadges user={item} /></div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>@{item.username || ""}</div>
          </div>
          <div className="grad-text" style={{ fontWeight: 800 }}>{item.points || 0}</div>
        </button>
      ))}
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
        toast("Utilizador nao encontrado", "error");
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
        <div className="shop-section-title">Customizacao de nome</div>
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
  useEffect(() => {
    if (!profile?.isAdmin) return undefined;
    const q = query(collection(db, "bugReports"), orderBy("at", "desc"), fsLimit(40));
    return onSnapshot(q, (snap) => setReports(snap.docs.map((item) => ({ id: item.id, ...item.data() }))));
  }, [profile?.isAdmin]);
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
      {profile?.isAdmin ? (
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
        toast("Este browser nao suporta notificacoes.", "error");
      } else {
        const token = await initPush({ user, requestPermission: true });
        next = !!token;
        if (next) toast("Push activado", "success");
        else toast("Nao consegui registar este dispositivo para push.", "error");
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

  return (
    <SideDrawer onClose={onClose}>
      {({ close }) => <div className="sub-panel active">
        <div className="sub-panel-head">
          <button className="icon-btn tap" type="button" aria-label="Voltar" onClick={onBack}>
            <ChevronLeft size={20} />
          </button>
          <div style={{ fontWeight: 700 }}>Definicoes</div>
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
          <div className="settings-title">Notificacoes</div>
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
            ["engagement", "Likes e comentarios"]
          ].map(([key, label]) => (
            <label className="settings-row" key={key}>
              <span className="settings-row-text">
                <span className="settings-row-label">{label}</span>
              </span>
              <Toggle checked={!!prefs[key]} disabled={!pushEnabled} onChange={(value) => setPref(key, value)} />
            </label>
          ))}
          </div>
          <button className="settings-action tap" type="button" onClick={() => playNotificationSound({ force: true })}>
            <DrawerIcon><Bell size={18} /></DrawerIcon>
            <span className="settings-row-text">
              <span className="settings-row-label">Testar som</span>
              <span className="settings-row-hint">Usa public/sounds/notification.mp3</span>
            </span>
          </button>
        </div>

        {profile?.isAdmin ? (
          <div className="settings-section" id="adminSettingsSection">
            <div className="settings-title">Admin</div>
            <button className="drawer-item w-full" type="button" onClick={() => { onClose(); onAdmin?.(); }}>
              <DrawerIcon className="god-wrap"><Shield size={18} /></DrawerIcon>
              <span className="drawer-label">God mode</span>
            </button>
            <button className="drawer-item w-full" type="button" onClick={() => { onClose(); onAdmin?.(); }}>
              <DrawerIcon><Edit3 size={18} /></DrawerIcon>
              <span className="drawer-label">Editar users, roles e pontos</span>
            </button>
            <div className="settings-row-hint" style={{ marginTop: 8 }}>As opcoes especiais de admin aparecem aqui e no menu hamburger, como na versao antiga.</div>
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

function FeedMenu({ onClose, onSearch, onRanking, onShop, onBugs, onArchive, onSettings, onAdmin, profile }) {
  const open = (fn) => {
    fn();
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
            <span className="drawer-label">Definicoes</span>
          </button>
          {profile?.isAdmin ? (
            <button className="drawer-item w-full" id="drawerAdminBtn" style={{ "--drawer-item-index": 7 }} type="button" onClick={() => open(onAdmin)}>
              <DrawerIcon className="god-wrap"><Shield size={18} /></DrawerIcon>
              <span className="drawer-label">God mode</span>
            </button>
          ) : null}
          <button className="drawer-item w-full" style={{ "--drawer-item-index": profile?.isAdmin ? 8 : 7 }} type="button" onClick={() => open(onBugs)}>
            <DrawerIcon><Bug size={18} /></DrawerIcon>
            <span className="drawer-label">{profile?.isAdmin ? "Bugs reports" : "Bugs / Report"}</span>
          </button>
        </div>

        <div style={{ flex: 1 }} />
        <div className="drawer-version">
          <span>versao beta 1.1</span>
          {profile?.isAdmin ? <><span> · </span><span className="grad-text">Admin Access</span></> : null}
          {!profile?.isAdmin && (profile?.role === "mod" || profile?.isMod) ? <><span> · </span><span className="grad-text">Moderator Access</span></> : null}
        </div>
        <div className="drawer-section" style={{ borderTop: "1px solid var(--border)", padding: "12px 18px" }}>
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
    <SheetModal title="God mode" onClose={onClose}>
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
  const isArchiveAdmin = !!profile?.isAdmin || profile?.role === "admin";
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
    if (profile?.isAdmin || profile?.role === "admin") roles.add("admin");
    if (profile?.isMod || profile?.role === "mod") roles.add("mod");
    return roles;
  }, [profile]);

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
      toast("Da um nome a seccao.", "error");
      return;
    }
    if (editor?.item?.id) {
      await updateDoc(doc(db, "archiveSections", editor.item.id), data);
      toast("Seccao atualizada.", "success");
    } else {
      await addDoc(collection(db, "archiveSections"), { ...data, createdAt: serverTimestamp(), createdBy: user.uid });
      toast("Seccao criada.", "success");
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
    if (!confirm(`Apagar a seccao "${section.name || "Arquivo"}"?`)) return;
    try {
      const snap = await getDocs(collection(db, "archiveSections", section.id, "entries"));
      await Promise.all(snap.docs.map((item) => deleteDoc(item.ref)));
      await deleteDoc(doc(db, "archiveSections", section.id));
      if (openSection?.id === section.id) setOpenSection(null);
      toast("Seccao apagada.", "success");
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
              {openSection ? "+ Entrada" : "+ Seccao"}
            </button>
          </div>

        {!openSection ? (
          <div id="archiveSectionsList" className="settings-section" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {loading ? <Loading /> : null}
            {!loading && archiveError ? <Empty title="Nao consegui carregar o arquivo." detail={archiveError} /> : null}
            {!loading && !archiveError && !sections.length ? <Empty title="Ainda nao ha seccoes." detail="Cria uma seccao para organizar o arquivo." /> : null}
            {!loading && !archiveError && sections.length > 0 && !visibleSections.length ? <Empty title="Sem seccoes visiveis." detail="Ha seccoes no arquivo, mas nenhuma esta disponivel para as tuas roles." /> : null}
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
            {entriesError ? <Empty title="Nao consegui carregar esta seccao." detail={entriesError} /> : null}
            {!entriesError && !entries.length ? <Empty title="Esta seccao esta vazia." detail={canManageSection(openSection) ? "Adiciona uma entrada." : ""} /> : null}
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
    <SheetModal title={item ? "Editar seccao" : "Nova seccao"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input className="input" placeholder="Nome" value={values.name} onChange={(event) => set("name", event.target.value)} style={{ padding: 11 }} />
        <input className="input" placeholder="Descricao" value={values.description} onChange={(event) => set("description", event.target.value)} style={{ padding: 11 }} />
        <input className="input" placeholder="Icone" value={values.icon} onChange={(event) => set("icon", event.target.value)} style={{ padding: 11 }} />
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
            {!roles.length ? <div className="empty" style={{ padding: 10 }}>Sem roles definidas. Cria-as no God mode.</div> : null}
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
  const [filter, setFilter] = useState(() => localStorage.getItem("alfa_feed_filter") || "global");
  const [modal, setModal] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const containerRef = useRef(null);
  const logoTimerRef = useRef(null);
  const [logoPop, setLogoPop] = useState(false);
  const posts = usePosts(user, profile, filter, refreshKey);
  const stories = useStories(refreshKey);
  const refreshFeed = useCallback(() => {
    setRefreshKey((value) => value + 1);
    toast("Feed atualizado!", "success");
  }, []);
  const popLogo = useCallback(() => {
    if (logoTimerRef.current) window.clearTimeout(logoTimerRef.current);
    setLogoPop(false);
    requestAnimationFrame(() => {
      setLogoPop(true);
      logoTimerRef.current = window.setTimeout(() => setLogoPop(false), 800);
    });
  }, []);

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
          <button className="icon-btn tap" type="button" aria-label="Definicoes" onClick={() => setModal("settings")}><LegacySettingsIcon size={22} /></button>
        </div>
        <div className="app-header-title">
          <div
            id="appLogoTitle"
            className={`logo grad-text ${logoPop ? "logo-pop" : ""}`}
            role="button"
            tabIndex={0}
            onClick={popLogo}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                popLogo();
              }
            }}
          >
            Alfa Club
          </div>
        </div>
        <div className="app-header-right">
          <NotificationsButton user={user} onOpen={() => setModal("notifications")} />
          <button className="icon-btn tap" type="button" aria-label="Menu" onClick={() => setModal("menu")}><Menu size={22} /></button>
        </div>
      </header>

      <div className="container" ref={containerRef}>
        {authLoading ? <Loading /> : null}
        {error ? <Empty title="Nao foi possivel abrir a app." detail={error.message} /> : null}
        {!authLoading && user && profile ? (
          <>
            <Stories stories={stories} user={user} profile={profile} />
            <Composer user={user} profile={profile} />
            <div className="feed-filter">
              <button className={`feed-filter-btn ${filter === "global" ? "active" : ""}`} type="button" onClick={() => setFilter("global")}>Global</button>
              <button className={`feed-filter-btn ${filter === "following" ? "active" : ""}`} type="button" onClick={() => setFilter("following")}>A seguir</button>
            </div>
            <div>
              {posts.loading ? <Loading /> : null}
              {posts.error ? <Empty title="Erro ao carregar o feed." detail={posts.error.message} /> : null}
              {!posts.loading && !posts.error && !posts.posts.length ? <Empty title="Ainda nao ha posts." detail="Publica o primeiro." /> : null}
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
      {modal === "settings" && user && profile ? <SettingsPanel user={user} profile={profile} onClose={() => setModal(null)} onBack={() => setModal("menu")} onAdmin={() => setModal("admin")} /> : null}
      {modal === "admin" ? <AdminPanelModal onClose={() => setModal(null)} /> : null}
      {modal === "menu" ? <FeedMenu onClose={() => setModal(null)} onSearch={() => setModal("search")} onRanking={() => setModal("ranking")} onShop={() => setModal("shop")} onBugs={() => setModal("bugs")} onArchive={() => setModal("archive")} onSettings={() => setModal("settings")} onAdmin={() => setModal("admin")} profile={profile} /> : null}
    </PageFrame>
  );
}
