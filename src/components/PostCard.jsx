import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc
} from "firebase/firestore";
import { Edit3, Heart, MessageCircle, MoreHorizontal, Pin, ThumbsDown, Trash2 } from "lucide-react";
import { db } from "../lib/firebase.js";
import { routeTo } from "../lib/navigation.js";
import { Avatar, RoleBadges, StyledName, timeAgo, toast } from "../lib/ui.jsx";
import { SheetModal } from "./Modal.jsx";
import { createNotification } from "./Notifications.jsx";

export function PostCard({ post, user, profile, compact = false }) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [myVote, setMyVote] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const mine = post.uid === user?.uid;
  const canDelete = mine || profile?.isAdmin || profile?.role === "mod";
  const canEdit = mine || profile?.isAdmin;
  const isPinned = post.pinnedUntil && post.pinnedUntil > Date.now();
  const author = useMemo(() => ({
    uid: post.uid,
    name: post.uid === user?.uid ? profile?.name || post.authorName : post.authorName,
    username: post.authorUsername,
    photoURL: post.uid === user?.uid ? profile?.photoURL || post.authorPhoto : post.authorPhoto,
    isAdmin: post.authorIsAdmin,
    role: post.authorRole,
    isMod: post.authorIsMod,
    nameColor: post.uid === user?.uid ? profile?.nameColor || post.authorNameColor : post.authorNameColor,
    nameStyle: post.uid === user?.uid ? profile?.nameStyle || post.authorNameStyle : post.authorNameStyle
  }), [post, profile, user?.uid]);

  useEffect(() => {
    if (!user?.uid || !post.id) return undefined;
    let alive = true;
    getDoc(doc(db, "posts", post.id, "votes", user.uid)).then((snap) => {
      if (alive) setMyVote(snap.exists() ? snap.data().type : null);
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, [post.id, user?.uid]);

  const vote = async (type) => {
    if (!user?.uid) return;
    let createdLike = false;
    try {
      const voteRef = doc(db, "posts", post.id, "votes", user.uid);
      const postRef = doc(db, "posts", post.id);
      await runTransaction(db, async (tx) => {
        const [voteSnap, postSnap] = await Promise.all([tx.get(voteRef), tx.get(postRef)]);
        if (!postSnap.exists()) throw new Error("Post ja nao existe");
        const current = voteSnap.exists() ? voteSnap.data().type : null;
        let dLikes = 0;
        let dDislikes = 0;
        let next = null;
        if (current === type) {
          if (type === "like") dLikes = -1;
          else dDislikes = -1;
          tx.delete(voteRef);
        } else {
          next = type;
          if (current === "like") dLikes = -1;
          if (current === "dislike") dDislikes = -1;
          if (type === "like") dLikes += 1;
          if (type === "dislike") dDislikes += 1;
          tx.set(voteRef, { type, at: serverTimestamp() });
        }
        tx.update(postRef, { likes: increment(dLikes), dislikes: increment(dDislikes) });
        if (post.uid) tx.update(doc(db, "users", post.uid), { points: increment(dLikes) });
        createdLike = type === "like" && next === "like";
        setMyVote(next);
      });
      if (createdLike && post.uid && post.uid !== user.uid) {
        await createNotification(post.uid, {
          type: "like",
          fromUid: user.uid,
          fromName: profile?.name || "",
          fromUsername: profile?.username || "",
          fromPhoto: profile?.photoURL || "",
          postId: post.id,
          text: "gostou do teu post"
        });
      }
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  const deletePost = async () => {
    if (!confirm("Apagar este post?")) return;
    try {
      await deleteDoc(doc(db, "posts", post.id));
      toast("Post apagado");
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  const pinPost = async () => {
    try {
      await updateDoc(doc(db, "posts", post.id), { pinnedUntil: isPinned ? null : Date.now() + 24 * 60 * 60 * 1000 });
      setAdminOpen(false);
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  return (
    <article className={`post ${isPinned ? "pinned" : ""}`} data-id={post.id} data-uid={post.uid}>
      <div className="post-head">
        <a
          className="post-avatar"
          href={`./profile.html?u=${encodeURIComponent(author.username || "")}`}
          onClick={(event) => {
            event.preventDefault();
            routeTo("profile.html", `?u=${encodeURIComponent(author.username || "")}`);
          }}
        >
          <Avatar user={author} size={38} />
        </a>
        <div style={{ flex: 1, minWidth: 0 }}>
          <a
            className="post-user"
            href={`./profile.html?u=${encodeURIComponent(author.username || "")}`}
            onClick={(event) => {
              event.preventDefault();
              routeTo("profile.html", `?u=${encodeURIComponent(author.username || "")}`);
            }}
          >
            <StyledName user={author} />
            <RoleBadges user={author} />
          </a>
          <div className="post-meta">
            @{author.username || ""} · {timeAgo(post.createdAt)}
            {post.editedAt ? <span style={{ fontStyle: "italic", opacity: 0.75 }}> · editado</span> : null}
          </div>
        </div>
        {profile?.isAdmin ? (
          <button className="btn-icon tap post-admin-btn" type="button" aria-label="Admin" title="Acoes admin" onClick={() => setAdminOpen(true)}>
            <MoreHorizontal size={16} />
          </button>
        ) : null}
        {canEdit ? (
          <button className="btn-icon tap" type="button" aria-label="Editar" onClick={() => setEditOpen(true)}>
            <Edit3 size={16} />
          </button>
        ) : null}
        {canDelete ? (
          <button className="btn-icon tap" type="button" aria-label="Apagar" onClick={deletePost}>
            <Trash2 size={16} />
          </button>
        ) : null}
      </div>

      {post.text ? <div className="post-body">{post.text}</div> : null}
      <PostMedia post={post} />
      <PollBlock post={post} user={user} />

      {!compact ? (
        <>
          <div className="post-actions">
            <button className={`action-btn tap ${myVote === "like" ? "liked" : ""}`} type="button" onClick={() => vote("like")}>
              <Heart size={18} />
              <span className="count-likes">{post.likes || 0}</span>
            </button>
            <button className={`action-btn tap ${myVote === "dislike" ? "disliked" : ""}`} type="button" onClick={() => vote("dislike")}>
              <ThumbsDown size={18} />
              <span className="count-dislikes">{post.dislikes || 0}</span>
            </button>
            <button className="action-btn tap" type="button" onClick={() => setCommentsOpen((v) => !v)}>
              <MessageCircle size={18} />
              <span className="count-comments">{post.commentsCount || 0}</span>
            </button>
          </div>
          <div className={`comments ${commentsOpen ? "" : "hidden"}`}>{commentsOpen ? <Comments post={post} user={user} profile={profile} /> : null}</div>
        </>
      ) : null}
      {editOpen ? <EditPostModal post={post} onClose={() => setEditOpen(false)} /> : null}
      {adminOpen ? (
        <SheetModal title="Acoes admin" onClose={() => setAdminOpen(false)}>
          <button className="drawer-item w-full" type="button" onClick={pinPost}><Pin size={18} /><span className="drawer-label">{isPinned ? "Desafixar post" : "Fixar por 24h"}</span></button>
          <button className="drawer-item w-full" type="button" onClick={() => setEditOpen(true)}><Edit3 size={18} /><span className="drawer-label">Editar post</span></button>
          <button className="drawer-item w-full" type="button" onClick={deletePost}><Trash2 size={18} /><span className="drawer-label">Apagar post</span></button>
        </SheetModal>
      ) : null}
    </article>
  );
}

function EditPostModal({ post, onClose }) {
  const [text, setText] = useState(post.text || "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await updateDoc(doc(db, "posts", post.id), {
        text: text.trim().slice(0, 500),
        editedAt: serverTimestamp()
      });
      toast("Post atualizado");
      onClose();
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <SheetModal title="Editar post" onClose={onClose}>
      <textarea className="input" rows="6" maxLength="500" value={text} onChange={(event) => setText(event.target.value)} style={{ width: "100%", padding: 12, fontFamily: "inherit", resize: "vertical" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
        <div className="char-count">{text.length} / 500</div>
        <button className="btn-primary" type="button" onClick={save} disabled={busy}>Guardar</button>
      </div>
    </SheetModal>
  );
}

function PostMedia({ post }) {
  if (!post.mediaURL) return null;
  if (post.mediaType === "video") {
    return (
      <div className="post-video">
        <video src={post.mediaURL} controls preload="metadata" playsInline />
      </div>
    );
  }
  if (post.mediaType === "image") {
    return (
      <div className="post-image">
        <img src={post.mediaURL} loading="lazy" alt="" />
      </div>
    );
  }
  return null;
}

function PollBlock({ post, user }) {
  const poll = post.poll;
  const [myPollVote, setMyPollVote] = useState(null);
  const [sliderValue, setSliderValue] = useState(50);

  useEffect(() => {
    if (!poll || !user?.uid || !post.id) return undefined;
    let alive = true;
    getDoc(doc(db, "posts", post.id, "pollVotes", user.uid)).then((snap) => {
      if (alive) setMyPollVote(snap.exists() ? snap.data() : null);
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, [poll, post.id, user?.uid]);

  if (!poll) return null;

  const voteOption = async (idx) => {
    if (!user?.uid) return;
    try {
      const voteRef = doc(db, "posts", post.id, "pollVotes", user.uid);
      const postRef = doc(db, "posts", post.id);
      await runTransaction(db, async (tx) => {
        const [voteSnap, postSnap] = await Promise.all([tx.get(voteRef), tx.get(postRef)]);
        if (!postSnap.exists()) throw new Error("Post ja nao existe");
        const freshPoll = postSnap.data().poll;
        const options = (freshPoll.options || []).map((o) => ({ text: o.text, votes: o.votes || 0 }));
        const prev = voteSnap.exists() ? voteSnap.data().choice : null;
        if (prev === idx) {
          options[idx].votes = Math.max(0, options[idx].votes - 1);
          tx.delete(voteRef);
          setMyPollVote(null);
        } else {
          if (typeof prev === "number" && options[prev]) options[prev].votes = Math.max(0, options[prev].votes - 1);
          options[idx].votes += 1;
          tx.set(voteRef, { choice: idx, at: serverTimestamp() });
          setMyPollVote({ choice: idx });
        }
        tx.update(postRef, { "poll.options": options });
      });
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  const voteSlider = async (value) => {
    if (!user?.uid) return;
    const v = Math.max(0, Math.min(100, Number(value) || 0));
    try {
      const voteRef = doc(db, "posts", post.id, "pollVotes", user.uid);
      const postRef = doc(db, "posts", post.id);
      await runTransaction(db, async (tx) => {
        const [voteSnap, postSnap] = await Promise.all([tx.get(voteRef), tx.get(postRef)]);
        if (!postSnap.exists()) throw new Error("Post ja nao existe");
        const freshPoll = postSnap.data().poll || {};
        const prev = voteSnap.exists() ? voteSnap.data().value : null;
        let sum = freshPoll.sum || 0;
        let count = freshPoll.count || 0;
        if (typeof prev === "number") {
          sum -= prev;
          count -= 1;
        }
        sum += v;
        count += 1;
        tx.set(voteRef, { value: v, at: serverTimestamp() });
        tx.update(postRef, { "poll.sum": sum, "poll.count": count });
        setMyPollVote({ value: v });
      });
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  if (poll.kind === "slider") {
    const avg = poll.count ? Math.round((poll.sum || 0) / poll.count) : 0;
    return (
      <div className="poll" data-poll-kind="slider">
        {poll.question ? <div className="poll-question">{poll.question}</div> : null}
        <div className="poll-slider-row">
          <input className="poll-slider-input" type="range" min="0" max="100" value={sliderValue} onChange={(event) => setSliderValue(Number(event.target.value) || 0)} />
          <div className="poll-slider-value">{sliderValue}</div>
        </div>
        <button type="button" className="btn-primary tap poll-slider-vote" onClick={() => voteSlider(sliderValue)}>Votar</button>
        <div className="poll-slider-result">
          <div className="cell"><div className="val">{avg}</div><div className="label">Media</div></div>
          <div className="cell"><div className="val">{poll.count || 0}</div><div className="label">Votos</div></div>
          <div className="cell"><div className="val">{myPollVote?.value ?? "-"}</div><div className="label">Teu voto</div></div>
        </div>
      </div>
    );
  }

  const options = poll.options || [];
  const total = options.reduce((sum, opt) => sum + (opt.votes || 0), 0);
  return (
    <div className="poll" data-poll-kind="options">
      {poll.question ? <div className="poll-question">{poll.question}</div> : null}
      {options.map((option, idx) => {
        const votes = option.votes || 0;
        const pct = total ? Math.round((votes / total) * 100) : 0;
        return (
          <button key={`${option.text}-${idx}`} type="button" data-poll-opt={idx} className={`poll-option ${myPollVote?.choice === idx ? "voted" : ""}`} onClick={() => voteOption(idx)}>
            <span className="poll-option-fill" style={{ width: `${pct}%` }} />
            <span className="poll-option-text">{option.text}</span>
            <span className="poll-option-pct">{pct}%</span>
          </button>
        );
      })}
      <div className="poll-meta">{total} {total === 1 ? "voto" : "votos"}</div>
    </div>
  );
}

function Comments({ post, user, profile }) {
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");

  useEffect(() => {
    const q = query(collection(db, "posts", post.id, "comments"), orderBy("at", "asc"), fsLimit(50));
    return onSnapshot(q, (snap) => {
      setComments(snap.docs.map((item) => ({ id: item.id, ...item.data() })));
    });
  }, [post.id]);

  const submit = async (event) => {
    event.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    setText("");
    try {
      await addDoc(collection(db, "posts", post.id, "comments"), {
        uid: user.uid,
        authorName: profile.name,
        authorUsername: profile.username,
        authorPhoto: profile.photoURL || "",
        authorIsAdmin: !!profile.isAdmin,
        authorIsMod: profile.role === "mod",
        authorRole: profile.role || "user",
        authorNameColor: profile.nameColor || "",
        authorNameStyle: profile.nameStyle || "",
        text: clean,
        at: serverTimestamp()
      });
      await updateDoc(doc(db, "posts", post.id), { commentsCount: increment(1) });
      if (post.uid && post.uid !== user.uid) {
        await createNotification(post.uid, {
          type: "comment",
          fromUid: user.uid,
          fromName: profile?.name || "",
          fromUsername: profile?.username || "",
          fromPhoto: profile?.photoURL || "",
          postId: post.id,
          text: `comentou: "${clean.slice(0, 60)}${clean.length > 60 ? "..." : ""}"`
        });
      }
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
      setText(clean);
    }
  };

  return (
    <>
      <div>
        {comments.length ? comments.map((comment) => {
          const author = {
            name: comment.uid === user.uid ? profile.name : comment.authorName,
            username: comment.authorUsername,
            photoURL: comment.uid === user.uid ? profile.photoURL || comment.authorPhoto : comment.authorPhoto,
            isAdmin: comment.authorIsAdmin,
            role: comment.authorRole,
            isMod: comment.authorIsMod,
            nameColor: comment.uid === user.uid ? profile.nameColor : comment.authorNameColor,
            nameStyle: comment.uid === user.uid ? profile.nameStyle : comment.authorNameStyle
          };
          return (
            <div className="comment" key={comment.id}>
              <div className="comment-avatar">
                <Avatar user={author} size={28} />
              </div>
              <div className="comment-body">
                <div className="comment-user">
                  <StyledName user={author} />
                  <RoleBadges user={author} /> <span style={{ color: "var(--muted-2)", fontWeight: 400 }}>@{author.username || ""} · {timeAgo(comment.at)}</span>
                </div>
                {comment.text}
              </div>
            </div>
          );
        }) : <div style={{ fontSize: 12, color: "var(--muted)", padding: "6px 2px" }}>Sem comentarios ainda.</div>}
      </div>
      <form className="comment-form" style={{ display: "flex", gap: 8, marginTop: 10 }} onSubmit={submit}>
        <input className="input" placeholder="Adiciona um comentario..." style={{ flex: 1, padding: "10px 14px", fontSize: 13 }} value={text} onChange={(event) => setText(event.target.value)} />
        <button className="btn-primary" style={{ padding: "10px 16px", fontSize: 13 }} type="submit">Enviar</button>
      </form>
    </>
  );
}
