import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { logout, updateMyProfile, useAuthProfile } from "../lib/auth.js";
import { db } from "../lib/firebase.js";
import { routeTo } from "../lib/navigation.js";
import { uploadMedia } from "../lib/upload.js";
import { Avatar, buildDmChatId, Empty, Loading, RoleBadges, StyledName, toast } from "../lib/ui.jsx";

function useProfile(username, currentUser, currentProfile) {
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
        if (snap.empty) setState({ loading: false, profile: null, error: new Error("Perfil nao encontrado.") });
        else setState({ loading: false, profile: { uid: snap.docs[0].id, ...snap.docs[0].data() }, error: null });
      } catch (err) {
        if (alive) setState({ loading: false, profile: null, error: err });
      }
    })();
    return () => {
      alive = false;
    };
  }, [currentProfile, currentUser, username]);
  return state;
}

function useUserPosts(uid) {
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
  }, [uid]);
  return state;
}

function EditProfileModal({ profile, onClose }) {
  const [form, setForm] = useState({
    name: profile.name || "",
    bio: profile.bio || "",
    photoURL: profile.photoURL || "",
    nameColor: profile.nameColor || "",
    nameStyle: profile.nameStyle || "",
    profileTheme: profile.profileTheme || ""
  });
  const [busy, setBusy] = useState(false);
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
        photoURL: form.photoURL.trim(),
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
  const colorOptions = [...new Set(["", ...(Array.isArray(profile.unlockedNameColors) ? profile.unlockedNameColors : []), profile.nameColor || ""])];
  const styleOptions = [...new Set(["", ...(Array.isArray(profile.unlockedNameStyles) ? profile.unlockedNameStyles : []), profile.nameStyle || ""])];
  const themeOptions = [...new Set(["", ...(Array.isArray(profile.unlockedProfileThemes) ? profile.unlockedProfileThemes : []), profile.profileTheme || ""])];
  const colorLabel = (value) => ({
    "": "Padrao",
    "#22d3ee": "Azul",
    "#ec4899": "Rosa",
    "#22c55e": "Verde"
  })[value] || value;
  const styleLabel = (value) => ({ "": "Sem efeito", gold: "Dourado", grad: "Gradiente" })[value] || value;
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
          <button className="btn-ghost" type="button" onClick={() => fileRef.current?.click()} disabled={busy}>Foto</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(event) => uploadPhoto(event.target.files?.[0])} />
        </div>
        <input className="input" placeholder="Nome" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} style={{ padding: "11px 14px" }} />
        <textarea className="input" placeholder="Bio" value={form.bio} maxLength="180" rows="4" onChange={(event) => setForm((prev) => ({ ...prev, bio: event.target.value }))} style={{ padding: "11px 14px", fontFamily: "inherit", resize: "vertical" }} />
        <input className="input" placeholder="URL da foto" value={form.photoURL} onChange={(event) => setForm((prev) => ({ ...prev, photoURL: event.target.value }))} style={{ padding: "11px 14px" }} />
        <div className="profile-edit-perks">
          <div className="profile-edit-perk-section">
            <div className="profile-edit-perk-title">Cores do nome</div>
            <div className="profile-unlock-grid">
              {colorOptions.map((value) => (
                <button key={value || "default-color"} className={`profile-unlock-option ${form.nameColor === value ? "active" : ""}`} type="button" onClick={() => setForm((prev) => ({ ...prev, nameColor: value }))}>
                  <span style={value ? { color: value } : null}>{colorLabel(value)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="profile-edit-perk-section">
            <div className="profile-edit-perk-title">Efeitos do nome</div>
            <div className="profile-unlock-grid">
              {styleOptions.map((value) => (
                <button key={value || "default-style"} className={`profile-unlock-option ${form.nameStyle === value ? "active" : ""}`} type="button" onClick={() => setForm((prev) => ({ ...prev, nameStyle: value }))}>
                  <span className={value === "gold" ? "name-gold" : value === "grad" ? "name-grad-anim" : ""}>{styleLabel(value)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="profile-edit-perk-section">
            <div className="profile-edit-perk-title">Temas de perfil</div>
            <div className="profile-unlock-grid profile-unlock-grid--themes">
              {themeOptions.map((value) => (
                <button key={value || "default-theme"} className={`profile-unlock-option ${form.profileTheme === value ? "active" : ""}`} type="button" onClick={() => setForm((prev) => ({ ...prev, profileTheme: value }))}>
                  {themeLabel(value)}
                </button>
              ))}
            </div>
          </div>
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

export function ProfilePage({ search }) {
  const { loading: authLoading, user, profile: currentProfile, error: authError } = useAuthProfile({ requireUser: true });
  const params = useMemo(() => new URLSearchParams(search || ""), [search]);
  const username = params.get("u") || "";
  const viewed = useProfile(username, user, currentProfile);
  const posts = useUserPosts(viewed.profile?.uid);
  const [tab, setTab] = useState("posts");
  const [editOpen, setEditOpen] = useState(false);
  const [followList, setFollowList] = useState(null);

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
      <div className="container">
        {authLoading || viewed.loading ? <Loading /> : null}
        {authError ? <Empty title="Nao foi possivel abrir o perfil." detail={authError.message} /> : null}
        {viewed.error ? <Empty title="Perfil nao encontrado." detail={viewed.error.message} /> : null}
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
      {followList === "followers" ? <FollowListModal title="Seguidores" uids={followers} empty="Ainda ninguem segue este perfil." onClose={() => setFollowList(null)} /> : null}
      {followList === "following" ? <FollowListModal title="A seguir" uids={following} empty="Este perfil ainda nao segue ninguem." onClose={() => setFollowList(null)} /> : null}
    </PageFrame>
  );
}
