import React, { useEffect, useMemo, useRef, useState } from "react";
import { collection, addDoc, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp as fsServerTimestamp } from "firebase/firestore";
import { limitToLast, off, onDisconnect, onValue, push, query as rtQuery, ref, remove, set, update } from "firebase/database";
import { Edit3, Smile, Trash2, Upload } from "lucide-react";
import { AppHeader, BottomNav, GradientDefs, HeaderUsersButton, PageFrame, SendIcon } from "../components/Shell.jsx";
import { SheetModal } from "../components/Modal.jsx";
import { useKeyboardViewport } from "../hooks/useKeyboardViewport.js";
import { useAuthProfile } from "../lib/auth.js";
import { db, rtdb } from "../lib/firebase.js";
import { uploadMedia } from "../lib/upload.js";
import { Avatar, DayDivider, Empty, Loading, RoleBadges, StyledName, toast } from "../lib/ui.jsx";

function usePresence(user, profile) {
  const [online, setOnline] = useState({});

  useEffect(() => {
    if (!user || !profile) return undefined;
    const connectedRef = ref(rtdb, ".info/connected");
    const myStatusRef = ref(rtdb, `presence/${user.uid}`);
    const presenceRef = ref(rtdb, "presence");

    const connectedUnsub = onValue(connectedRef, (snap) => {
      if (snap.val() !== true) return;
      onDisconnect(myStatusRef).remove().then(() => {
        set(myStatusRef, {
          name: profile.name,
          username: profile.username,
          photoURL: profile.photoURL || "",
          online: true,
          lastSeen: Date.now()
        });
      });
    });
    const presenceUnsub = onValue(presenceRef, (snap) => setOnline(snap.val() || {}));
    const beforeUnload = () => remove(myStatusRef).catch(() => {});
    window.addEventListener("beforeunload", beforeUnload);

    return () => {
      connectedUnsub();
      presenceUnsub();
      window.removeEventListener("beforeunload", beforeUnload);
      remove(myStatusRef).catch(() => {});
    };
  }, [profile, user]);

  return online;
}

function useChatMessages() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const messagesRef = rtQuery(ref(rtdb, "chat/messages"), limitToLast(1000));
    const unsub = onValue(
      messagesRef,
      (snap) => {
        const rows = [];
        snap.forEach((child) => rows.push({ id: child.key, ...child.val() }));
        rows.sort((a, b) => (a.at || 0) - (b.at || 0));
        setMessages(rows);
        setLoading(false);
      },
      (err) => {
        toast(`Erro: ${err.message}`, "error");
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  return { messages, loading };
}

function ChatMessage({ message, previous, user, profile }) {
  const mine = message.uid === user.uid;
  const canDelete = mine || profile?.isAdmin || profile?.role === "mod";
  const canEdit = (mine || profile?.isAdmin) && (!message.type || message.type === "text");
  const timeStr = new Date(message.at || Date.now()).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  const showDay = !previous || new Date(previous.at || 0).toDateString() !== new Date(message.at || Date.now()).toDateString();

  const editMessage = async () => {
    const next = prompt("Editar mensagem:", message.text || "");
    if (next === null) return;
    const text = next.trim();
    if (!text || text === message.text) return;
    try {
      await update(ref(rtdb, `chat/messages/${message.id}`), { text, editedAt: Date.now(), editedBy: user.uid });
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  const deleteMessage = async () => {
    if (!confirm("Apagar esta mensagem?")) return;
    try {
      await remove(ref(rtdb, `chat/messages/${message.id}`));
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  const author = {
    name: message.name || "Anonimo",
    username: message.username || "",
    photoURL: message.photoURL || "",
    isAdmin: !!message.isAdmin,
    role: message.role,
    nameColor: message.nameColor,
    nameStyle: message.nameStyle
  };

  return (
    <>
      {showDay ? <DayDivider ts={message.at} /> : null}
      <div className={`msg ${mine ? "mine" : ""} ${message.type === "sticker" ? "sticker-wrap" : ""}`} data-key={message.id}>
        <a href={`./profile.html?u=${encodeURIComponent(message.username || "")}`} className="msg-avatar">
          <Avatar user={author} size={34} />
        </a>
        <div className="msg-body">
          <div className="msg-meta">
            <StyledName user={author} /> <RoleBadges user={author} /> · {timeStr}
            {message.editedAt ? <span className="msg-edited">(editado)</span> : null}
          </div>
          <div className={`msg-bubble ${message.type === "sticker" ? "sticker-msg" : ""}`} style={message.type === "sticker" ? { background: "transparent", border: 0, padding: 0, boxShadow: "none" } : null}>
            {message.type === "sticker" && message.stickerUrl ? (
              <img src={message.stickerUrl} alt="sticker" style={{ display: "block", width: 120, height: 120, objectFit: "contain" }} />
            ) : (
              <div className="msg-text">{message.text || ""}</div>
            )}
            {canEdit ? (
              <button className="msg-edit-btn" type="button" aria-label="Editar mensagem" title="Editar" onClick={editMessage}>
                <Edit3 size={14} />
              </button>
            ) : null}
            {canDelete ? (
              <button className="msg-delete-btn" type="button" aria-label="Apagar mensagem" title="Apagar" onClick={deleteMessage}>
                <Trash2 size={14} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

function StickerPicker({ user, profile, onClose, onSend }) {
  const [stickers, setStickers] = useState([]);
  const [uploadPct, setUploadPct] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const q = query(collection(db, "stickers"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setStickers(snap.docs.map((item) => ({ id: item.id, ...item.data() })));
    });
  }, []);

  const uploadSticker = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("So imagens!", "error");
      return;
    }
    try {
      setUploadPct(0);
      const up = await uploadMedia(file, (pct) => setUploadPct(Math.round(pct * 100)));
      await addDoc(collection(db, "stickers"), {
        url: up.url,
        uploadedBy: user.uid,
        uploadedByName: profile.name || "",
        createdAt: fsServerTimestamp()
      });
      toast("Sticker adicionado!", "success");
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    } finally {
      setUploadPct(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <SheetModal title="Stickers" onClose={onClose}>
      <div className="sticker-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(90px,1fr))", gap: 8, maxHeight: 300, overflowY: "auto" }}>
        {stickers.length ? (
          stickers.map((sticker) => {
            const canDelete = profile?.isAdmin || sticker.uploadedBy === user.uid;
            return (
              <button
                key={sticker.id}
                type="button"
                className="sticker-pick"
                style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 12, padding: 4, cursor: "pointer", position: "relative" }}
                onClick={() => {
                  onSend(sticker.url);
                  onClose();
                }}
              >
                <img src={sticker.url} alt="" style={{ width: 80, height: 80, objectFit: "contain", display: "block" }} />
                {canDelete ? (
                  <span
                    className="sticker-del"
                    style={{ position: "absolute", top: 2, right: 2, background: "rgba(239,68,68,.8)", color: "white", width: 20, height: 20, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 12, lineHeight: 1 }}
                    onClick={async (event) => {
                      event.stopPropagation();
                      if (!confirm("Apagar sticker?")) return;
                      try {
                        await deleteDoc(doc(db, "stickers", sticker.id));
                        toast("Sticker apagado", "success");
                      } catch (err) {
                        toast(`Erro: ${err.message}`, "error");
                      }
                    }}
                  >
                    x
                  </span>
                ) : null}
              </button>
            );
          })
        ) : (
          <div style={{ gridColumn: "1/-1", textAlign: "center", color: "var(--muted)", padding: 20 }}>Sem stickers. Se o primeiro a carregar um!</div>
        )}
      </div>
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
        <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(event) => uploadSticker(event.target.files?.[0])} />
        <button type="button" className="btn-primary" style={{ width: "100%", padding: 10, fontSize: 13 }} onClick={() => inputRef.current?.click()} disabled={uploadPct !== null}>
          <Upload size={16} /> {uploadPct === null ? "Carregar sticker" : `A enviar ${uploadPct}%`}
        </button>
      </div>
    </SheetModal>
  );
}

export function ChatPage() {
  const { loading: authLoading, user, profile, error } = useAuthProfile({ requireUser: true });
  const { messages, loading } = useChatMessages();
  const [text, setText] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const online = usePresence(user, profile);
  useKeyboardViewport({ enabled: !!user, scrollRef: wrapRef });

  const onlineUsers = useMemo(() => Object.entries(online || {}), [online]);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 160;
    if (nearBottom) requestAnimationFrame(() => (node.scrollTop = node.scrollHeight + 9999));
  }, [messages.length]);

  const sendMessage = async () => {
    const clean = text.trim();
    if (!clean || !user || !profile) return;
    setText("");
    try {
      await push(ref(rtdb, "chat/messages"), {
        uid: user.uid,
        name: profile.name,
        username: profile.username,
        photoURL: profile.photoURL || "",
        isAdmin: !!profile.isAdmin,
        role: profile.role || "user",
        nameColor: profile.nameColor || "",
        nameStyle: profile.nameStyle || "",
        text: clean.slice(0, 500),
        at: Date.now()
      });
      inputRef.current?.focus();
      requestAnimationFrame(() => {
        if (wrapRef.current) wrapRef.current.scrollTop = wrapRef.current.scrollHeight + 9999;
      });
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
      setText(clean);
    }
  };

  const sendSticker = async (stickerUrl) => {
    if (!user || !profile || !stickerUrl) return;
    try {
      await push(ref(rtdb, "chat/messages"), {
        uid: user.uid,
        name: profile.name,
        username: profile.username,
        photoURL: profile.photoURL || "",
        isAdmin: !!profile.isAdmin,
        role: profile.role || "user",
        nameColor: profile.nameColor || "",
        nameStyle: profile.nameStyle || "",
        type: "sticker",
        stickerUrl,
        at: Date.now()
      });
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  const showOnline = () => {
    const rows = onlineUsers.length
      ? onlineUsers.map(([, item]) => `${item.name || "User"} @${item.username || ""}`).join("\n")
      : "Ninguem online de momento.";
    alert(rows);
  };

  return (
    <PageFrame page="chat.html">
      <GradientDefs />
      <AppHeader
        title="Chat Global"
        right={<HeaderUsersButton onClick={showOnline} />}
      >
        <div className="logo grad-text" style={{ fontSize: 18 }}>Chat Global</div>
        <div className="online-badge">
          <span className="online-dot" /> <span>{onlineUsers.length === 1 ? "1 online" : `${onlineUsers.length} online`}</span>
        </div>
      </AppHeader>

      <div className="chat-wrap" ref={wrapRef}>
        {authLoading || loading ? <Loading label="A carregar mensagens" /> : null}
        {error ? <Empty title="Nao foi possivel abrir o chat." detail={error.message} /> : null}
        {!authLoading && !loading && !messages.length ? <Empty emoji="💬" title="Ainda sem mensagens." detail="Escreve a primeira." /> : null}
        {user && profile
          ? messages.map((message, index) => (
              <ChatMessage key={message.id} message={message} previous={messages[index - 1]} user={user} profile={profile} />
            ))
          : null}
      </div>

      <div className="typing" style={{ display: "none" }} />
      <footer className="chat-footer">
        <button type="button" className="chat-sticker-btn tap" aria-label="Stickers" onClick={() => setPickerOpen(true)} style={{ width: 42, height: 42, borderRadius: "50%", background: "#1a1a1a", border: "1px solid var(--border)", display: "grid", placeItems: "center", color: "var(--text)" }}>
          <Smile size={22} />
        </button>
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder="Diz alguma merda..."
          rows="1"
          maxLength="500"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              sendMessage();
            }
          }}
        />
        <button className="chat-send" type="button" disabled={!text.trim() || !user || !profile} aria-label="Enviar" onPointerDown={(event) => { event.preventDefault(); sendMessage(); }}>
          <SendIcon />
        </button>
      </footer>
      <BottomNav active="chat.html" />
      {pickerOpen && user && profile ? <StickerPicker user={user} profile={profile} onClose={() => setPickerOpen(false)} onSend={sendSticker} /> : null}
    </PageFrame>
  );
}
