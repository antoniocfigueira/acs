import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  query,
  updateDoc,
  where
} from "firebase/firestore";
import { Edit3, LogOut, Share2 } from "lucide-react";
import { AppHeader, BottomNav, GradientDefs, PageFrame } from "../components/Shell.jsx";
import { SheetModal } from "../components/Modal.jsx";
import { PostCard } from "../components/PostCard.jsx";
import { usePullToRefresh } from "../hooks/usePullToRefresh.js";
import { logout, updateMyProfile, useAuthProfile } from "../lib/auth.js";
import { useAdminMode } from "../lib/adminMode.js";
import { db } from "../lib/firebase.js";
import { routeTo } from "../lib/navigation.js";
import { uploadMedia } from "../lib/upload.js";
import { Avatar, buildDmChatId, Empty, Loading, RoleBadges, StyledName, toast } from "../lib/ui.jsx";

function useProfile(username, currentUser, currentProfile, refreshKey = 0) {
  const [state, setState] = useState({ loading: true, profile: null, error: null });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!username && currentProfile) {
          setState({ loading: false, profile: currentProfile, error: null });
          return;
        }
        if (!username || username === currentProfile?.username) {
          setState({ loading: false, profile: currentProfile, error: null });
          return;
        }
        const snap = await getDocs(query(collection(db, "users"), where("username", "==", username), fsLimit(1)));
        if (!alive) return;
        if (snap.empty) setState({ loading: false, profile: null, error: new Error("Perfil não encontrado.") });
        else setState({ loading: false, profile: { uid: snap.docs[0].id, ...snap.docs[0].data() }, error: null });
      } catch (err) {
        if (alive) setState({ loading: false, profile: null, error: err });
      }
    })();
    return () => {
      alive = false;
    };
  }, [currentProfile, currentUser, refreshKey, username]);
  return state;
}

function useUserPosts(uid, refreshKey = 0) {
  const [state, setState] = useState({ loading: true, posts: [], error: null });
  useEffect(() => {
    if (!uid) return undefined;
    const q = query(collection(db, "posts"), where("uid", "==", uid), fsLimit(100));
    return onSnapshot(q, (snap) => {
      const posts = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
      posts.sort((a, b) => {
        const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return tb - ta;
      });
      setState({ loading: false, posts, error: null });
    }, (err) => setState({ loading: false, posts: [], error: err }));
  }, [refreshKey, uid]);
  return state;
}

function EditProfileModal({ profile, onClose }) {
  const [form, setForm] = useState({
    name: profile.name || "",
    bio: profile.bio || "",
    photoURL: profile.photoURL || "",
    nameColor: profile.nameStyle === "gold" ? "gold" : profile.nameColor || "",
    nameStyle: profile.nameStyle === "gold" ? "" : profile.nameStyle || "",
    profileTheme: profile.profileTheme || ""
  });
  const [busy, setBusy] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const fileRef = useRef(null);

  const uploadPhoto = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const up = await uploadMedia(file);
      setForm((prev) => ({ ...prev, photoURL: up.url }));
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast("Indica o teu nome.", "error");
      return;
    }
    setBusy(true);
    try {
      await updateMyProfile({
        name: form.name.trim(),
        bio: form.bio.trim().slice(0, 180),
        photoURL: form.photoURL,
        nameColor: form.nameColor || null,
        nameStyle: form.nameStyle || null,
        profileTheme: form.profileTheme || null,
        unlockedNameColors: colorOptions.filter(Boolean),
        unlockedNameStyles: styleOptions.filter(Boolean),
        unlockedProfileThemes: themeOptions.filter(Boolean)
      });
      toast("Perfil atualizado");
      onClose();
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    } finally {
      setBusy(false);
    }
  };
  const colorOptions = [...new Set(["", ...(Array.isArray(profile.unlockedNameColors) ? profile.unlockedNameColors : []), profile.nameStyle === "gold" ? "gold" : "", profile.nameColor || ""])];
  const styleOptions = [...new Set(["", ...(Array.isArray(profile.unlockedNameStyles) ? profile.unlockedNameStyles : []), profile.nameStyle === "gold" ? "" : profile.nameStyle || ""])];
  const themeOptions = [...new Set(["", ...(Array.isArray(profile.unlockedProfileThemes) ? profile.unlockedProfileThemes : []), profile.profileTheme || ""])];
  const colorLabel = (value) => ({
    "": "Padrao",
    "#22d3ee": "Azul",
    "#ec4899": "Rosa",
    "#22c55e": "Verde",
    "#ef4444": "Vermelho",
    "#a855f7": "Roxo",
    "#f97316": "Laranja",
    gold: "Dourado"
  })[value] || value;
  const styleLabel = (value) => ({ "": "Sem efeito", grad: "Gradiente", glow: "Glow" })[value] || value;
  const themeLabel = (value) => ({
    "": "Sem tema",
    flames: "Chamas",
    aurora: "Aurora",
    neon: "Neon Grid",
    galaxy: "Galaxia",
    cyber: "Cyber HUD",
    sakura: "Sakura"
  })[value] || value;

  return (
    <SheetModal title="Editar perfil" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar user={form} size={58} />
          <label className={`btn-ghost native-file-trigger ${busy ? "is-disabled" : ""}`}>
            Foto
            <input ref={fileRef} className="native-file-input" type="file" accept="image/*" disabled={busy} onChange={(event) => uploadPhoto(event.target.files?.[0])} />
          </label>
        </div>
        <input className="input" placeholder="Nome" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} style={{ padding: "11px 14px" }} />
        <textarea className="input" placeholder="Bio" value={form.bio} maxLength="180" rows="4" onChange={(event) => setForm((prev) => ({ ...prev, bio: event.target.value }))} style={{ padding: "11px 14px", fontFamily: "inherit", resize: "vertical" }} />
        <div className="profile-edit-perks">
          <button className="profile-edit-perks-toggle tap" type="button" onClick={() => setCustomOpen((value) => !value)} aria-expanded={customOpen}>
            <span>
              <strong>Personalização comprada</strong>
              <small>{[colorLabel(form.nameColor), styleLabel(form.nameStyle), themeLabel(form.profileTheme)].filter(Boolean).join(" · ")}</small>
            </span>
            <span aria-hidden="true">{customOpen ? "−" : "+"}</span>
          </button>
          {customOpen ? (
            <div className="profile-edit-perks-body">
              <label className="profile-select-row">
                <span>Cores do nome</span>
                <select className="input" value={form.nameColor} onChange={(event) => setForm((prev) => ({ ...prev, nameColor: event.target.value }))}>
                  {colorOptions.map((value) => <option key={value || "default-color"} value={value}>{colorLabel(value)}</option>)}
                </select>
              </label>
              <label className="profile-select-row">
                <span>Efeitos do nome</span>
                <select className="input" value={form.nameStyle} onChange={(event) => setForm((prev) => ({ ...prev, nameStyle: event.target.value }))}>
                  {styleOptions.map((value) => <option key={value || "default-style"} value={value}>{styleLabel(value)}</option>)}
                </select>
              </label>
              <label className="profile-select-row">
                <span>Temas de perfil</span>
                <select className="input" value={form.profileTheme} onChange={(event) => setForm((prev) => ({ ...prev, profileTheme: event.target.value }))}>
                  {themeOptions.map((value) => <option key={value || "default-theme"} value={value}>{themeLabel(value)}</option>)}
                </select>
              </label>
            </div>
          ) : null}
        </div>
        <button className="btn-primary" type="button" onClick={save} disabled={busy}>{busy ? "A guardar" : "Guardar"}</button>
      </div>
    </SheetModal>
  );
}

function FollowListModal({ title, uids, empty, onClose }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = [];
        for (const uid of uids || []) {
          const snap = await getDoc(doc(db, "users", uid));
          if (snap.exists()) rows.push({ uid, ...snap.data() });
        }
        rows.sort((a, b) => (a.name || a.username || "").localeCompare(b.name || b.username || ""));
        if (alive) setUsers(rows);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [uids]);
  return (
    <SheetModal title={title} onClose={onClose}>
      <div style={{ maxHeight: "60vh", overflowY: "auto", margin: "-6px -4px 0" }}>
        {loading ? <Loading /> : null}
        {!loading && !users.length ? <div className="user-list-empty">{empty}</div> : null}
        {users.map((item) => (
          <button key={item.uid} className="user-list-item tap" type="button" onClick={() => { onClose(); routeTo("profile.html", `?u=${encodeURIComponent(item.username || "")}`); }}>
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

function AdminPlusProfileModal({ profile, onClose }) {
  const [form, setForm] = useState({
    name: profile.name || "",
    username: profile.username || "",
    photoURL: profile.photoURL || "",
    bio: profile.bio || "",
    points: String(profile.points || 0),
    nameColor: profile.nameColor || "",
    nameStyle: profile.nameStyle || "",
    role: profile.role || "user"
  });
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const save = async () => {
    try {
      await updateDoc(doc(db, "users", profile.uid), {
        name: form.name.trim(),
        username: form.username.trim().toLowerCase().replace(/^@/, ""),
        photoURL: form.photoURL.trim(),
        bio: form.bio.trim().slice(0, 180),
        points: Number(form.points) || 0,
        nameColor: form.nameColor.trim() || null,
        nameStyle: form.nameStyle.trim() || null,
        role: form.role,
        isAdmin: form.role === "admin",
        isMod: form.role === "mod"
      });
      toast("Perfil atualizado por Admin+", "success");
      onClose();
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };
  return (
    <SheetModal title="Admin+ perfil" onClose={onClose}>
      <div className="admin-plus-inline">
        <input className="input" placeholder="Nome" value={form.name} onChange={(event) => set("name", event.target.value)} />
        <input className="input" placeholder="@username" value={form.username} onChange={(event) => set("username", event.target.value)} />
        <input className="input" placeholder="Foto URL" value={form.photoURL} onChange={(event) => set("photoURL", event.target.value)} />
        <textarea className="input" rows="4" placeholder="Bio" value={form.bio} onChange={(event) => set("bio", event.target.value)} />
        <input className="input" type="number" placeholder="Pontos" value={form.points} onChange={(event) => set("points", event.target.value)} />
        <input className="input" placeholder="Cor do nome (#hex, gold...)" value={form.nameColor} onChange={(event) => set("nameColor", event.target.value)} />
        <select className="input" value={form.nameStyle} onChange={(event) => set("nameStyle", event.target.value)}>
          <option value="">Sem efeito</option>
          <option value="grad">Gradiente</option>
          <option value="glow">Glow</option>
        </select>
        <select className="input" value={form.role} onChange={(event) => set("role", event.target.value)}>
          <option value="user">User</option>
          <option value="mod">Mod</option>
          <option value="admin">Admin</option>
        </select>
        <button className="btn-primary" type="button" onClick={save}>Guardar</button>
      </div>
    </SheetModal>
  );
}

export function ProfilePage({ search }) {
  const { loading: authLoading, user, profile: currentProfile, error: authError } = useAuthProfile({ requireUser: true });
  const params = useMemo(() => new URLSearchParams(search || ""), [search]);
  const username = params.get("u") || "";
  const [refreshKey, setRefreshKey] = useState(0);
  const containerRef = useRef(null);
  const viewed = useProfile(username, user, currentProfile, refreshKey);
  const posts = useUserPosts(viewed.profile?.uid, refreshKey);
  const [tab, setTab] = useState("posts");
  const [editOpen, setEditOpen] = useState(false);
  const [followList, setFollowList] = useState(null);
  const [adminEditOpen, setAdminEditOpen] = useState(false);
  const adminMode = useAdminMode(currentProfile);
  const refreshProfile = useCallback(() => {
    setRefreshKey((value) => value + 1);
    toast("Perfil atualizado!", "success");
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [username]);

  usePullToRefresh(containerRef, {
    enabled: !!user && !!viewed.profile && !editOpen && !followList,
    onRefresh: refreshProfile
  });

  const isMe = user?.uid && viewed.profile?.uid === user.uid;
  const followers = Array.isArray(viewed.profile?.followers) ? viewed.profile.followers : [];
  const following = Array.isArray(viewed.profile?.following) ? viewed.profile.following : [];
  const myFollowing = Array.isArray(currentProfile?.following) ? currentProfile.following : [];
  const iFollow = viewed.profile?.uid ? myFollowing.includes(viewed.profile.uid) : false;
  const blocked = Array.isArray(currentProfile?.blocked) ? currentProfile.blocked : [];
  const isBlocked = viewed.profile?.uid ? blocked.includes(viewed.profile.uid) : false;

  const follow = async () => {
    if (!user?.uid || !viewed.profile?.uid || isMe) return;
    try {
      const myRef = doc(db, "users", user.uid);
      const themRef = doc(db, "users", viewed.profile.uid);
      if (iFollow) {
        await updateDoc(myRef, { following: arrayRemove(viewed.profile.uid) });
        await updateDoc(themRef, { followers: arrayRemove(user.uid) });
      } else {
        await updateDoc(myRef, { following: arrayUnion(viewed.profile.uid) });
        await updateDoc(themRef, { followers: arrayUnion(user.uid) });
      }
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  const block = async () => {
    if (!user?.uid || !viewed.profile?.uid || isMe) return;
    try {
      const myRef = doc(db, "users", user.uid);
      if (isBlocked) {
        await updateDoc(myRef, { blocked: arrayRemove(viewed.profile.uid) });
        toast("Desbloqueado", "success");
      } else {
        if (!confirm("Bloquear este utilizador? Deixaras de ver os posts dele.")) return;
        await updateDoc(myRef, { blocked: arrayUnion(viewed.profile.uid), following: arrayRemove(viewed.profile.uid) });
        await updateDoc(doc(db, "users", viewed.profile.uid), { followers: arrayRemove(user.uid) }).catch(() => {});
        toast("Bloqueado", "success");
      }
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  const openDm = () => {
    if (!user?.uid || !viewed.profile?.uid) return;
    const chatId = buildDmChatId(user.uid, viewed.profile.uid);
    routeTo("dm.html", `?c=${encodeURIComponent(chatId)}&to=${encodeURIComponent(viewed.profile.uid)}`);
  };

  const share = async () => {
    try {
      await navigator.share?.({ title: viewed.profile?.name || "Perfil", url: window.location.href });
    } catch {}
  };

  const imagePosts = posts.posts.filter((post) => post.mediaType === "image" && post.mediaURL);

  return (
    <PageFrame page="profile.html">
      <GradientDefs />
      <AppHeader title="Perfil" right={<button className="icon-btn tap" type="button" aria-label="Partilhar" onClick={share}><Share2 size={22} /></button>} />
      <div className="container" ref={containerRef}>
        {authLoading || viewed.loading ? <Loading /> : null}
        {authError ? <Empty title="Não foi possível abrir o perfil." detail={authError.message} /> : null}
        {viewed.error ? <Empty title="Perfil não encontrado." detail={viewed.error.message} /> : null}
        {!authLoading && viewed.profile ? (
          <>
            <div className={`profile-hero ${viewed.profile.profileTheme ? `profile-theme-${viewed.profile.profileTheme}` : ""}`}>
              <div className="profile-pic-wrap">
                <div className="profile-pic">
                  <Avatar user={viewed.profile} size={104} />
                </div>
              </div>
              <div className="profile-name"><StyledName user={viewed.profile} /><RoleBadges user={viewed.profile} /></div>
              <div className="profile-user">@{viewed.profile.username || ""}</div>
              <div className="profile-id">ID <span style={{ color: "var(--text)", marginLeft: 4, fontWeight: 700 }}>#{viewed.profile.idNumber || "?"}</span></div>
              <div className="profile-bio">{(viewed.profile.bio || "").trim() || (isMe ? "Adiciona uma bio ao teu perfil..." : "")}</div>
              <div className="profile-stats">
                <div className="stat"><div className="n">{posts.posts.length || viewed.profile.postsCount || 0}</div><div className="l">Posts</div></div>
                <button className="stat stat-clickable tap" type="button" onClick={() => setFollowList("followers")}><div className="n">{followers.length}</div><div className="l">Seguidores</div></button>
                <button className="stat stat-clickable tap" type="button" onClick={() => setFollowList("following")}><div className="n">{following.length}</div><div className="l">A seguir</div></button>
                <div className="stat"><div className="n grad-text">{viewed.profile.points || 0}</div><div className="l">Pontos</div></div>
              </div>
              <div className="profile-cta">
                {isMe ? <button className="btn-primary" type="button" onClick={() => setEditOpen(true)}>Editar perfil</button> : null}
                {!isMe ? <button className={iFollow ? "btn-ghost" : "btn-primary"} type="button" onClick={follow}>{iFollow ? "A seguir" : "Seguir"}</button> : null}
                {!isMe ? <button className="btn-primary" type="button" onClick={openDm}>Mensagem</button> : null}
                {!isMe ? <button className="btn-ghost" type="button" onClick={block}>{isBlocked ? "Desbloquear" : "Bloquear"}</button> : null}
                {!isMe && adminMode.adminPlus ? <button className="btn-ghost" type="button" onClick={() => setAdminEditOpen(true)}>Admin+</button> : null}
                {isMe ? <button className="btn-ghost" type="button" onClick={async () => { if (confirm("Sair da conta?")) await logout(); }}>Sair</button> : null}
              </div>
            </div>

            <div className="tabs-profile">
              <button className={tab === "posts" ? "active" : ""} type="button" onClick={() => setTab("posts")}>Posts</button>
              <button className={tab === "images" ? "active" : ""} type="button" onClick={() => setTab("images")}>Imagens</button>
            </div>

            {tab === "posts" ? (
              <div>
                {posts.loading ? <Loading /> : null}
                {!posts.loading && !posts.posts.length ? <div className="posts-grid-empty">Sem posts ainda.</div> : null}
                {posts.posts.map((post) => <PostCard key={post.id} post={post} user={user} profile={currentProfile} />)}
              </div>
            ) : (
              <div className="images-grid">
                {imagePosts.map((post) => (
                  <button key={post.id} type="button" className="image-tile" onClick={() => window.open(post.mediaURL, "_blank")}>
                    <img src={post.mediaURL} alt="" loading="lazy" />
                  </button>
                ))}
                {!imagePosts.length ? <div className="posts-grid-empty">Sem imagens ainda.</div> : null}
              </div>
            )}
          </>
        ) : null}
      </div>
      <BottomNav active="profile.html" />
      {editOpen && viewed.profile ? <EditProfileModal profile={viewed.profile} onClose={() => setEditOpen(false)} /> : null}
      {adminEditOpen && viewed.profile ? <AdminPlusProfileModal profile={viewed.profile} onClose={() => setAdminEditOpen(false)} /> : null}
      {followList === "followers" ? <FollowListModal title="Seguidores" uids={followers} empty="Ainda ninguém segue este perfil." onClose={() => setFollowList(null)} /> : null}
      {followList === "following" ? <FollowListModal title="A seguir" uids={following} empty="Este perfil ainda não segue ninguém." onClose={() => setFollowList(null)} /> : null}
    </PageFrame>
  );
}
