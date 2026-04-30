import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
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
import { Camera, Image as ImageIcon, Menu, Newspaper, Search, Settings, Trophy, X } from "lucide-react";
import { BottomNav, GradientDefs, PageFrame } from "../components/Shell.jsx";
import { SheetModal } from "../components/Modal.jsx";
import { PostCard } from "../components/PostCard.jsx";
import { logout, updateMyProfile, useAuthProfile } from "../lib/auth.js";
import { db } from "../lib/firebase.js";
import { routeTo } from "../lib/navigation.js";
import { uploadMedia } from "../lib/upload.js";
import { Avatar, Empty, Loading, RoleBadges, StyledName, toast } from "../lib/ui.jsx";

const SHOP_ITEMS = [
  { id: "color_cyan", name: "Cor Azul", sub: "Nome em azul", price: 15, preview: <span className="name-sample" style={{ color: "#22d3ee" }}>Nome</span>, apply: { nameColor: "#22d3ee" } },
  { id: "color_pink", name: "Cor Rosa", sub: "Nome em rosa", price: 15, preview: <span className="name-sample" style={{ color: "#ec4899" }}>Nome</span>, apply: { nameColor: "#ec4899" } },
  { id: "color_green", name: "Cor Verde", sub: "Nome em verde", price: 15, preview: <span className="name-sample" style={{ color: "#22c55e" }}>Nome</span>, apply: { nameColor: "#22c55e" } },
  { id: "color_gold", name: "Dourado especial", sub: "Cor dourada com glow", price: 100, preview: <span className="name-sample name-gold">Nome</span>, apply: { nameStyle: "gold" } },
  { id: "grad_anim", name: "Degrade animado", sub: "Nome com gradiente animado", price: 30, preview: <span className="name-sample name-grad-anim">Nome</span>, apply: { nameStyle: "grad" } },
  { id: "reset_color", name: "Remover modificacoes", sub: "Voltar a cor padrao", price: 0, preview: <span className="name-sample">Nome</span>, apply: { nameColor: null, nameStyle: null } },
  { id: "change_user", name: "Mudar @username", sub: "Escolher um novo @", price: 50, preview: <span style={{ fontWeight: 700 }}>@</span>, action: "changeUsername" },
  { id: "timeout_user", name: "Timeout 24h", sub: "Silenciar um user 24h", price: 50, preview: <span style={{ fontWeight: 700, opacity: 0.7 }}>mute</span>, action: "timeoutUser" }
];

const SHOP_PROFILE_THEMES = [
  { id: "ptheme_none", name: "Nenhum", sub: "Sem tema de perfil", price: 0, preview: <span className="pt-preview pt-preview-none">-</span>, apply: { profileTheme: null } },
  { id: "ptheme_flames", name: "Chamas", sub: "Perfil em chamas animadas", price: 20, preview: <span className="pt-preview pt-preview-flames" />, apply: { profileTheme: "flames" } },
  { id: "ptheme_aurora", name: "Aurora", sub: "Ondas de aurora boreal", price: 20, preview: <span className="pt-preview pt-preview-aurora" />, apply: { profileTheme: "aurora" } },
  { id: "ptheme_neon", name: "Neon Grid", sub: "Grelha vaporwave animada", price: 25, preview: <span className="pt-preview pt-preview-neon" />, apply: { profileTheme: "neon" } },
  { id: "ptheme_galaxy", name: "Galaxia", sub: "Estrelas e nebulosa", price: 25, preview: <span className="pt-preview pt-preview-galaxy" />, apply: { profileTheme: "galaxy" } },
  { id: "ptheme_cyber", name: "Cyber HUD", sub: "Linhas neon em scan", price: 30, preview: <span className="pt-preview pt-preview-cyber" />, apply: { profileTheme: "cyber" } },
  { id: "ptheme_sakura", name: "Sakura", sub: "Petalas a cair", price: 30, preview: <span className="pt-preview pt-preview-sakura" />, apply: { profileTheme: "sakura" } }
];

function usePosts(user, profile, filter) {
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
  }, [filter, profile, user]);
  return state;
}

function useStories() {
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
  }, []);
  return stories;
}

function Composer({ user, profile }) {
  const [text, setText] = useState("");
  const [media, setMedia] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const addPoll = () => {
    const question = prompt("Pergunta da sondagem:");
    if (!question) return;
    const raw = prompt("Opcoes separadas por virgula:");
    const options = (raw || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 6);
    if (options.length < 2) {
      toast("Precisas de pelo menos 2 opcoes.", "error");
      return;
    }
    setMedia({ type: "poll", poll: { kind: "options", question: question.trim(), options: options.map((option) => ({ text: option, votes: 0 })) } });
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
            {media.type === "poll" ? <div className="poll-preview">{media.poll.question}</div> : null}
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
            <button className="btn-ghost tap" type="button" style={{ padding: "8px 12px", fontSize: 13 }} title="Adicionar sondagem" onClick={addPoll}>
              <Trophy size={16} />
            </button>
            <button className="btn-primary" type="button" style={{ padding: "8px 18px", fontSize: 13 }} disabled={busy || (!text.trim() && !media)} onClick={publish}>
              {busy ? "A enviar" : "Publicar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stories({ stories, user, profile }) {
  const [viewer, setViewer] = useState(null);
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

  const createStory = async (file) => {
    if (!file) return;
    try {
      const up = await uploadMedia(file);
      await addDoc(collection(db, "stories"), {
        uid: user.uid,
        authorName: profile.name || "",
        authorUsername: profile.username || "",
        authorPhoto: profile.photoURL || "",
        mediaURL: up.url,
        mediaType: up.type,
        createdAt: serverTimestamp(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
      });
      toast("Story publicada");
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <div className="stories-row">
        <div className="story-item" role="button" onClick={() => fileRef.current?.click()}>
          <div className="story-avatar add">
            <Camera size={22} />
          </div>
          <div className="story-name">A tua story</div>
        </div>
        <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: "none" }} onChange={(event) => createStory(event.target.files?.[0])} />
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
    </>
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
    <div style={{ position: "fixed", inset: 0, zIndex: 220, background: "rgba(0,0,0,.92)", display: "grid", placeItems: "center" }} onClick={next}>
      <button className="icon-btn tap" type="button" aria-label="Fechar" onClick={(event) => { event.stopPropagation(); onClose(); }} style={{ position: "absolute", top: 14, right: 14 }}>
        <X size={22} />
      </button>
      {story.uid === user.uid ? <button className="btn-ghost" type="button" onClick={(event) => { event.stopPropagation(); deleteStory(); }} style={{ position: "absolute", top: 14, left: 14 }}>Apagar</button> : null}
      {story.mediaType === "video" ? <video src={story.mediaURL} controls autoPlay style={{ maxWidth: "100vw", maxHeight: "86vh" }} /> : <img src={story.mediaURL} alt="" style={{ maxWidth: "100vw", maxHeight: "86vh", objectFit: "contain" }} />}
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
  const buy = async (item) => {
    if ((profile.points || 0) < item.price) {
      toast("Pontos insuficientes", "error");
      return;
    }
    let extra = {};
    if (item.action === "changeUsername") {
      const username = prompt("Novo @username:")?.trim().toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_.]/g, "");
      if (!username || username.length < 3) return;
      const taken = await getDocs(query(collection(db, "users"), where("username", "==", username), fsLimit(1)));
      if (!taken.empty) {
        toast("@username ja usado", "error");
        return;
      }
      extra.username = username;
    }
    if (item.action === "timeoutUser") {
      const username = prompt("@username a silenciar 24h:")?.trim().toLowerCase().replace(/^@/, "");
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
        if (points < item.price) throw new Error("Pontos insuficientes");
        const update = { points: increment(-item.price) };
        if (item.apply) Object.assign(update, item.apply);
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
      toast(item.price === 0 ? "Aplicado" : "Comprado", "success");
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };
  const rows = [...SHOP_ITEMS, ...SHOP_PROFILE_THEMES];
  return (
    <SheetModal title={`Loja · ${profile.points || 0} pts`} onClose={onClose}>
      <div style={{ maxHeight: "65vh", overflowY: "auto" }}>
        {rows.map((item) => {
          const active = item.apply && Object.entries(item.apply).every(([key, value]) => (profile[key] || null) === value);
          const disabled = active || (profile.points || 0) < item.price;
          return (
            <div className="shop-item" key={item.id}>
              <div className="shop-item-icon">{item.preview}</div>
              <div className="shop-item-body">
                <div className="shop-item-title">{item.name}</div>
                <div className="shop-item-sub">{item.sub}</div>
              </div>
              <div className="shop-price">{item.price} pts</div>
              <button className="shop-buy-btn" type="button" disabled={disabled} onClick={() => buy(item)}>
                {active ? "Ativo" : disabled ? "Sem pts" : item.price === 0 ? "Aplicar" : "Comprar"}
              </button>
            </div>
          );
        })}
      </div>
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

function FeedMenu({ onClose, onSearch, onRanking, onShop, onBugs, profile }) {
  return (
    <SheetModal title="Menu" onClose={onClose}>
      <button className="drawer-item w-full" type="button" onClick={onSearch}><Search size={18} /><span className="drawer-label">Pesquisar</span></button>
      <button className="drawer-item w-full" type="button" onClick={() => { onClose(); routeTo("news.html"); }}><Newspaper size={18} /><span className="drawer-label">Alfa News</span></button>
      <button className="drawer-item w-full" type="button" onClick={() => { onClose(); routeTo("dm.html"); }}><Menu size={18} /><span className="drawer-label">Mensagens Privadas</span></button>
      <button className="drawer-item w-full" type="button" onClick={onRanking}><Trophy size={18} /><span className="drawer-label">Ranking</span></button>
      <button className="drawer-item w-full" type="button" onClick={onShop}><Settings size={18} /><span className="drawer-label">Loja</span></button>
      <button className="drawer-item w-full" type="button" onClick={onBugs}><Settings size={18} /><span className="drawer-label">{profile?.isAdmin ? "Bugs reports" : "Reportar bug"}</span></button>
      <button className="drawer-item w-full" type="button" onClick={async () => { if (confirm("Sair da conta?")) await logout(); }}><Settings size={18} /><span className="drawer-label">Sair</span></button>
    </SheetModal>
  );
}

export function FeedPage() {
  const { loading: authLoading, user, profile, error } = useAuthProfile({ requireUser: true });
  const [filter, setFilter] = useState(() => localStorage.getItem("alfa_feed_filter") || "global");
  const [modal, setModal] = useState(null);
  const posts = usePosts(user, profile, filter);
  const stories = useStories();

  useEffect(() => {
    localStorage.setItem("alfa_feed_filter", filter);
  }, [filter]);

  return (
    <PageFrame page="index.html">
      <GradientDefs />
      <header className="app-header app-header-centered">
        <div className="app-header-left">
          <button className="icon-btn tap" type="button" aria-label="Definicoes" onClick={() => setModal("menu")}><Settings size={22} /></button>
        </div>
        <div className="app-header-title">
          <div className="logo grad-text">Alfa Club</div>
        </div>
        <div className="app-header-right">
          <button className="icon-btn tap" type="button" aria-label="Pesquisar" onClick={() => setModal("search")}><Search size={22} /></button>
          <button className="icon-btn tap" type="button" aria-label="Menu" onClick={() => setModal("menu")}><Menu size={22} /></button>
        </div>
      </header>

      <div className="container">
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
      {modal === "menu" ? <FeedMenu onClose={() => setModal(null)} onSearch={() => setModal("search")} onRanking={() => setModal("ranking")} onShop={() => setModal("shop")} onBugs={() => setModal("bugs")} profile={profile} /> : null}
    </PageFrame>
  );
}
