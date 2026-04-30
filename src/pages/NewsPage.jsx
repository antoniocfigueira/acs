import React, { useEffect, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from "firebase/firestore";
import { Edit3, Plus, Trash2 } from "lucide-react";
import { AppHeader, BottomNav, GradientDefs, PageFrame } from "../components/Shell.jsx";
import { SheetModal } from "../components/Modal.jsx";
import { useAuthProfile } from "../lib/auth.js";
import { db } from "../lib/firebase.js";
import { uploadMedia } from "../lib/upload.js";
import { Avatar, Empty, Loading, RoleBadges, StyledName, timeAgo, toast } from "../lib/ui.jsx";

function useNews() {
  const [state, setState] = useState({ loading: true, news: [], error: null });
  useEffect(() => {
    const q = query(collection(db, "news"), orderBy("createdAt", "desc"), fsLimit(50));
    return onSnapshot(q, (snap) => {
      setState({ loading: false, news: snap.docs.map((item) => ({ id: item.id, ...item.data() })), error: null });
    }, (err) => setState({ loading: false, news: [], error: err }));
  }, []);
  return state;
}

function NewsComposer({ profile, user, initial, onClose }) {
  const [title, setTitle] = useState(initial?.title || "");
  const [body, setBody] = useState(initial?.body || "");
  const [media, setMedia] = useState(initial?.mediaURL ? { url: initial.mediaURL, type: initial.mediaType || "image" } : null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const pickFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const up = await uploadMedia(file);
      setMedia({ url: up.url, type: up.type });
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async () => {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      toast("Poe um titulo.", "error");
      return;
    }
    setBusy(true);
    try {
      if (initial?.id) {
        await updateDoc(doc(db, "news", initial.id), {
          title: cleanTitle.slice(0, 120),
          body: body.trim().slice(0, 2000),
          mediaURL: media?.url || "",
          mediaType: media?.type || "",
          editedAt: serverTimestamp(),
          editedBy: user.uid
        });
        toast("Noticia atualizada");
      } else {
        await addDoc(collection(db, "news"), {
          uid: user.uid,
          authorName: profile.name || "",
          authorUsername: profile.username || "",
          authorPhoto: profile.photoURL || "",
          authorIsAdmin: !!profile.isAdmin,
          authorIsMod: profile.role === "mod",
          title: cleanTitle.slice(0, 120),
          body: body.trim().slice(0, 2000),
          mediaURL: media?.url || "",
          mediaType: media?.type || "",
          createdAt: serverTimestamp()
        });
        toast("Noticia publicada");
      }
      onClose();
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetModal title={initial ? "Editar noticia" : "Publicar noticia"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input className="input" type="text" maxLength="120" placeholder="Titulo" value={title} onChange={(event) => setTitle(event.target.value)} style={{ padding: "10px 14px" }} />
        <textarea className="input" maxLength="2000" placeholder="Escreve a noticia..." rows="5" value={body} onChange={(event) => setBody(event.target.value)} style={{ padding: "10px 14px", fontFamily: "inherit", resize: "vertical" }} />
        {media ? (
          <div className="news-media" style={{ position: "relative", marginTop: 0 }}>
            {media.type === "video" ? <video src={media.url} controls /> : <img src={media.url} alt="" />}
            <button className="btn-icon" type="button" aria-label="Remover" onClick={() => setMedia(null)} style={{ position: "absolute", right: 8, top: 8, background: "rgba(0,0,0,.65)" }}>x</button>
          </div>
        ) : null}
        <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: "none" }} onChange={(event) => pickFile(event.target.files?.[0])} />
        <button className="btn-ghost" type="button" onClick={() => fileRef.current?.click()} disabled={busy}>Carregar ficheiro</button>
        <button className="btn-primary" type="button" onClick={save} disabled={busy}>{busy ? "A guardar" : initial ? "Guardar" : "Publicar"}</button>
      </div>
    </SheetModal>
  );
}

function NewsCard({ item, user, profile, onEdit }) {
  const author = {
    name: item.authorName || "Alfa",
    username: item.authorUsername || "alfa",
    photoURL: item.authorPhoto || "",
    isAdmin: !!item.authorIsAdmin,
    role: item.authorRole
  };
  const canEdit = !!profile?.isAdmin;
  const canDelete = !!profile?.isAdmin || (item.uid === user?.uid && profile?.role === "mod");
  const deleteNews = async () => {
    if (!confirm("Apagar esta noticia?")) return;
    try {
      await deleteDoc(doc(db, "news", item.id));
      toast("Noticia apagada");
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  return (
    <article className="news-card">
      <div className="news-head">
        <div className="avatar"><Avatar user={author} size={28} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center" }}>
            <StyledName user={author} /><RoleBadges user={author} />
          </div>
          <div style={{ fontSize: 11, color: "var(--muted-2)" }}>@{author.username} · {timeAgo(item.createdAt)}</div>
        </div>
      </div>
      <div className="news-title" style={{ marginTop: 10 }}>{item.title || ""}</div>
      {item.body ? <div className="news-body">{item.body}</div> : null}
      {item.mediaURL ? (
        <div className="news-media">
          {item.mediaType === "video" ? <video src={item.mediaURL} controls preload="metadata" playsInline /> : <img src={item.mediaURL} alt="" loading="lazy" />}
        </div>
      ) : null}
      {canEdit || canDelete ? (
        <div className="news-actions">
          {canEdit ? <button className="btn-ghost" type="button" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => onEdit(item)}><Edit3 size={14} /> Editar</button> : null}
          {canDelete ? <button className="btn-ghost" type="button" style={{ padding: "6px 10px", fontSize: 12 }} onClick={deleteNews}><Trash2 size={14} /> Apagar</button> : null}
        </div>
      ) : null}
    </article>
  );
}

export function NewsPage() {
  const { loading: authLoading, user, profile, error: authError } = useAuthProfile({ requireUser: true });
  const news = useNews();
  const [composer, setComposer] = useState(null);
  const isAdmin = !!profile?.isAdmin;

  return (
    <PageFrame page="news.html">
      <GradientDefs />
      <AppHeader title="Alfa News" right={isAdmin ? <button className="icon-btn tap" type="button" aria-label="Nova noticia" onClick={() => setComposer({})}><Plus size={22} /></button> : null} />
      <div className="container">
        {authLoading ? <Loading /> : null}
        {authError ? <Empty title="Nao foi possivel abrir as noticias." detail={authError.message} /> : null}
        {!authLoading && isAdmin ? (
          <div className="compose-hero">
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Publicar uma noticia</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>So admins podem publicar aqui.</div>
            </div>
            <button className="btn-primary" type="button" onClick={() => setComposer({})}>+ Nova</button>
          </div>
        ) : null}
        {news.loading ? <Loading /> : null}
        {news.error ? <Empty title="Nao foi possivel carregar as noticias." detail={news.error.message} /> : null}
        {!news.loading && !news.news.length ? <Empty emoji="📰" title="Ainda sem noticias." detail={isAdmin ? "Carrega em + Nova para publicar a primeira." : "O admin ainda nao publicou nada aqui."} /> : null}
        {news.news.map((item) => <NewsCard key={item.id} item={item} user={user} profile={profile} onEdit={setComposer} />)}
      </div>
      <BottomNav active="news.html" />
      {composer ? <NewsComposer initial={composer.id ? composer : null} user={user} profile={profile} onClose={() => setComposer(null)} /> : null}
    </PageFrame>
  );
}
