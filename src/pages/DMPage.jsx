import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
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
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "firebase/firestore";
import { onValue as rtOnValue, ref as rtRef } from "firebase/database";
import { Edit3, Trash2 } from "lucide-react";
import { AppHeader, BottomNav, GradientDefs, HeaderNewDmButton, PageFrame, SendIcon } from "../components/Shell.jsx";
import { SheetModal } from "../components/Modal.jsx";
import { useKeyboardViewport } from "../hooks/useKeyboardViewport.js";
import { markLegacyDmNotificationsRead, useAuthProfile } from "../lib/auth.js";
import { db, rtdb } from "../lib/firebase.js";
import { routeTo } from "../lib/navigation.js";
import { Avatar, buildDmChatId, Empty, Loading, RoleBadges, StyledName, timeAgo, toast } from "../lib/ui.jsx";

function useOnlineUids() {
  const [online, setOnline] = useState(new Set());
  useEffect(() => {
    const presenceRef = rtRef(rtdb, "presence");
    return rtOnValue(presenceRef, (snap) => {
      setOnline(new Set(Object.keys(snap.val() || {})));
    });
  }, []);
  return online;
}

function useInbox(user, profile, onlineUids, active) {
  const [state, setState] = useState({ loading: true, rows: [], error: null });

  useEffect(() => {
    if (!user || !active) return undefined;
    setState((prev) => ({ ...prev, loading: true }));
    const q = query(collection(db, "chats"), where("participants", "array-contains", user.uid), fsLimit(100));
    return onSnapshot(
      q,
      async (snap) => {
        try {
          if (snap.empty) {
            setState({ loading: false, rows: [], error: null });
            return;
          }
          const baseRows = [];
          snap.forEach((item) => {
            const meta = { id: item.id, ...item.data() };
            const otherUid = (meta.participants || []).find((uid) => uid !== user.uid);
            if (otherUid) baseRows.push({ meta, otherUid });
          });
          baseRows.sort((a, b) => {
            const ta = a.meta.lastAt?.toMillis ? a.meta.lastAt.toMillis() : 0;
            const tb = b.meta.lastAt?.toMillis ? b.meta.lastAt.toMillis() : 0;
            return tb - ta;
          });
          const unique = [...new Set(baseRows.map((row) => row.otherUid))];
          const docs = await Promise.all(unique.map((uid) => getDoc(doc(db, "users", uid))));
          const byUid = new Map();
          docs.forEach((item) => {
            if (item.exists()) byUid.set(item.id, { uid: item.id, ...item.data() });
          });
          const blocked = new Set(profile?.blocked || []);
          const rows = baseRows
            .filter((row) => !blocked.has(row.otherUid))
            .map((row) => ({
              ...row,
              other: byUid.get(row.otherUid) || { uid: row.otherUid, name: "User", username: "user", photoURL: "" },
              unread: (row.meta[`unread_${user.uid}`] || 0) > 0,
              online: onlineUids.has(row.otherUid)
            }));
          setState({ loading: false, rows, error: null });
        } catch (err) {
          setState({ loading: false, rows: [], error: err });
        }
      },
      (err) => setState({ loading: false, rows: [], error: err })
    );
  }, [active, onlineUids, profile, user]);

  return state;
}

function InboxRow({ row }) {
  const open = (event) => {
    event.preventDefault();
    routeTo("dm.html", `?c=${encodeURIComponent(row.meta.id)}&to=${encodeURIComponent(row.otherUid)}`);
  };
  return (
    <a href={`./dm.html?c=${encodeURIComponent(row.meta.id)}&to=${encodeURIComponent(row.otherUid)}`} className={`dm-row ${row.unread ? "unread" : ""} ${row.online ? "is-online" : ""}`} data-uid={row.otherUid} onClick={open}>
      <div className="dm-avatar-wrap">
        <div className="avatar">
          <Avatar user={row.other} size={46} />
        </div>
        <span className="dm-presence-dot" aria-hidden="true" />
      </div>
      <div className="content">
        <div className="name">
          <StyledName user={row.other} />
          <RoleBadges user={row.other} />
        </div>
        <div className="preview">{row.meta.lastMessage || ""}</div>
      </div>
      <div className="when">{timeAgo(row.meta.lastAt)}</div>
    </a>
  );
}

function DMMessage({ message, other, user, profile, chatId }) {
  const mine = message.uid === user.uid;
  const canDelete = mine || profile?.isAdmin;
  const canEdit = mine || profile?.isAdmin;

  const deleteMessage = async () => {
    if (!confirm("Apagar esta mensagem?")) return;
    try {
      await deleteDoc(doc(db, "chats", chatId, "messages", message.id));
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  const editMessage = async () => {
    const next = prompt("Editar mensagem:", message.text || "");
    if (next === null) return;
    const text = next.trim();
    if (!text || text === message.text) return;
    try {
      await updateDoc(doc(db, "chats", chatId, "messages", message.id), {
        text,
        editedAt: serverTimestamp(),
        editedBy: user.uid
      });
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  return (
    <div className={`msg ${mine ? "mine" : ""} msg-new`} data-mid={message.id}>
      <div className="msg-avatar">
        <Avatar user={mine ? profile : other} size={32} />
      </div>
      <div>
        <div className="msg-bubble">
          <span className="msg-text">{message.text || ""}</span>
          {canEdit ? (
            <button className="msg-edit-btn" type="button" aria-label="Editar mensagem" title="Editar" onClick={editMessage}>
              <Edit3 size={13} />
            </button>
          ) : null}
          {canDelete ? (
            <button className="msg-delete-btn" type="button" aria-label="Apagar mensagem" title="Apagar" onClick={deleteMessage}>
              <Trash2 size={13} />
            </button>
          ) : null}
        </div>
        <div style={{ fontSize: 10, color: "var(--muted-2)", marginTop: 2, textAlign: mine ? "right" : "left" }}>
          {timeAgo(message.at)} {message.editedAt ? <span className="msg-edited">(editado)</span> : null}
        </div>
      </div>
    </div>
  );
}

function Thread({ chatId, otherUid, user, profile, onOtherLoaded }) {
  const [other, setOther] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  useKeyboardViewport({ enabled: true, scrollRef: wrapRef });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const chatRef = doc(db, "chats", chatId);
        const existing = await getDoc(chatRef);
        if (!existing.exists()) {
          await setDoc(chatRef, {
            participants: [user.uid, otherUid].sort(),
            lastMessage: "",
            lastAt: serverTimestamp(),
            [`unread_${user.uid}`]: 0,
            [`unread_${otherUid}`]: 0
          });
        } else {
          await updateDoc(chatRef, { [`unread_${user.uid}`]: 0 }).catch(() => {});
        }
        await markLegacyDmNotificationsRead(user.uid, chatId);
        const otherSnap = await getDoc(doc(db, "users", otherUid));
        const nextOther = otherSnap.exists() ? { uid: otherUid, ...otherSnap.data() } : { uid: otherUid, name: "User", username: "user" };
        if (alive) {
          setOther(nextOther);
          onOtherLoaded(nextOther);
        }
      } catch (err) {
        toast(`Erro: ${err.message}`, "error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [chatId, onOtherLoaded, otherUid, user.uid]);

  useEffect(() => {
    const q = query(collection(db, "chats", chatId, "messages"), orderBy("at", "asc"), fsLimit(200));
    return onSnapshot(
      q,
      (snap) => {
        setMessages(snap.docs.map((item) => ({ id: item.id, ...item.data() })));
        setLoading(false);
      },
      (err) => {
        toast(`Erro: ${err.message}`, "error");
        setLoading(false);
      }
    );
  }, [chatId]);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (wrapRef.current) wrapRef.current.scrollTop = wrapRef.current.scrollHeight + 9999;
    });
  }, [messages.length]);

  const send = async () => {
    const clean = text.trim();
    if (!clean) return;
    setText("");
    try {
      await addDoc(collection(db, "chats", chatId, "messages"), {
        uid: user.uid,
        name: profile.name,
        text: clean,
        at: serverTimestamp()
      });
      await updateDoc(doc(db, "chats", chatId), {
        lastMessage: clean.slice(0, 80),
        lastAt: serverTimestamp(),
        [`unread_${otherUid}`]: increment(1),
        [`unread_${user.uid}`]: 0
      });
      inputRef.current?.focus();
    } catch (err) {
      toast(`Erro ao enviar: ${err.message}`, "error");
      setText(clean);
    }
  };

  return (
    <>
      <div className="thread-wrap" ref={wrapRef}>
        {loading ? <Loading label="A abrir" /> : null}
        {!loading && !messages.length ? <Empty emoji="👋" title="Vomita-te todo." /> : null}
        {messages.map((message, index) => {
          const ts = message.at?.toMillis ? message.at.toMillis() : 0;
          const prevTs = messages[index - 1]?.at?.toMillis ? messages[index - 1].at.toMillis() : 0;
          const showDay = !index || new Date(ts).toDateString() !== new Date(prevTs).toDateString();
          return (
            <React.Fragment key={message.id}>
              {showDay && ts ? (
                <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted-2)", margin: "12px 0 8px" }}>
                  <span style={{ background: "#141414", border: "1px solid var(--border)", padding: "3px 10px", borderRadius: 999 }}>
                    {new Date(ts).toLocaleDateString("pt-PT", { day: "numeric", month: "short" })}
                  </span>
                </div>
              ) : null}
              <DMMessage message={message} other={other || {}} user={user} profile={profile} chatId={chatId} />
            </React.Fragment>
          );
        })}
      </div>
      <footer className="dm-footer">
        <textarea
          ref={inputRef}
          className="dm-input"
          placeholder="Escreve uma mensagem..."
          rows="1"
          maxLength="1000"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button className="dm-send" type="button" disabled={!text.trim()} aria-label="Enviar" onPointerDown={(event) => { event.preventDefault(); send(); }}>
          <SendIcon />
        </button>
      </footer>
    </>
  );
}

function NewConversationPicker({ user, profile, onlineUids, onClose }) {
  const [filter, setFilter] = useState("");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "users"), fsLimit(300)));
        const blocked = new Set(profile?.blocked || []);
        const rows = [];
        snap.forEach((item) => {
          if (item.id === user.uid || blocked.has(item.id)) return;
          const data = { uid: item.id, ...item.data() };
          if (data.banned && !profile?.isAdmin) return;
          rows.push(data);
        });
        rows.sort((a, b) => {
          const oa = onlineUids.has(a.uid) ? 0 : 1;
          const ob = onlineUids.has(b.uid) ? 0 : 1;
          if (oa !== ob) return oa - ob;
          return (a.name || a.username || "").localeCompare(b.name || b.username || "");
        });
        if (alive) setUsers(rows);
      } catch (err) {
        toast(`Erro: ${err.message}`, "error");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [onlineUids, profile, user.uid]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase().replace(/^@/, "");
    if (!needle) return users;
    return users.filter((item) => (item.name || "").toLowerCase().includes(needle) || (item.username || "").toLowerCase().includes(needle));
  }, [filter, users]);

  const pick = (otherUid) => {
    const chatId = buildDmChatId(user.uid, otherUid);
    onClose();
    routeTo("dm.html", `?c=${encodeURIComponent(chatId)}&to=${encodeURIComponent(otherUid)}`);
  };

  return (
    <SheetModal title="Nova conversa" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          className="input"
          placeholder="Pesquisar por nome ou @username..."
          autoComplete="off"
          autoCapitalize="none"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          style={{ fontSize: 14, padding: "11px 14px" }}
        />
        <div style={{ maxHeight: "min(60vh, 460px)", overflowY: "auto", margin: "-6px -4px 0", padding: "0 4px", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
          {loading ? <Loading label="A carregar utilizadores" /> : null}
          {!loading && !visible.length ? <div className="empty" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Sem resultados.</div> : null}
          {visible.map((item) => (
            <button
              key={item.uid}
              type="button"
              className="dm-pick-row"
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px", width: "100%", borderRadius: 12, background: "transparent", border: 0, textAlign: "left", cursor: "pointer", transition: "background .15s" }}
              onClick={() => pick(item.uid)}
            >
              <div style={{ position: "relative", width: 42, height: 42, flexShrink: 0 }}>
                <div style={{ width: 42, height: 42, borderRadius: "50%", overflow: "hidden" }}>
                  <Avatar user={item} size={42} />
                </div>
                {onlineUids.has(item.uid) ? <span style={{ position: "absolute", right: -1, bottom: -1, width: 11, height: 11, borderRadius: "50%", background: "#22c55e", border: "2px solid #121212", boxShadow: "0 0 8px rgba(34,197,94,.7)" }} /> : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 4 }}>
                  <StyledName user={item} />
                  <RoleBadges user={item} />
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{item.username || ""}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </SheetModal>
  );
}

export function DMPage({ search }) {
  const { loading: authLoading, user, profile, error } = useAuthProfile({ requireUser: true });
  const params = useMemo(() => new URLSearchParams(search || ""), [search]);
  const chatId = params.get("c") || "";
  const otherUid = params.get("to") || "";
  const inThread = !!(chatId && otherUid);
  const onlineUids = useOnlineUids();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [other, setOther] = useState(null);
  const inbox = useInbox(user, profile, onlineUids, !!user && !inThread);

  useEffect(() => {
    if (!inThread) setOther(null);
  }, [inThread]);

  return (
    <PageFrame page="dm.html" threadOpen={inThread}>
      <GradientDefs />
      <AppHeader
        title="Mensagens"
        subtitle={!inThread ? "Conversas privadas" : null}
        right={!inThread ? <HeaderNewDmButton onClick={() => setPickerOpen(true)} /> : null}
      >
        {inThread && other ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", overflow: "hidden" }}>
              <Avatar user={other} size={36} />
            </div>
            <div style={{ minWidth: 0 }}>
              <a href={`./profile.html?u=${encodeURIComponent(other.username || "")}`} style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center" }}>
                <StyledName user={other} />
                <RoleBadges user={other} />
              </a>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>@{other.username || ""}</div>
            </div>
          </div>
        ) : (
          <>
            <div className="logo grad-text" style={{ fontSize: 18 }}>Mensagens</div>
            {!inThread ? <div style={{ fontSize: 11, color: "var(--muted)" }}>Conversas privadas</div> : null}
          </>
        )}
      </AppHeader>

      {authLoading ? <div className="dm-list"><Loading /></div> : null}
      {error ? <div className="dm-list"><Empty title="Nao foi possivel abrir as mensagens." detail={error.message} /></div> : null}
      {!authLoading && user && profile && inThread ? (
        <Thread chatId={chatId} otherUid={otherUid} user={user} profile={profile} onOtherLoaded={setOther} />
      ) : null}
      {!authLoading && user && profile && !inThread ? (
        <div className="dm-list">
          {inbox.loading ? <Loading /> : null}
          {inbox.error ? <Empty title="Nao foi possivel carregar as conversas." detail={inbox.error.message} /> : null}
          {!inbox.loading && !inbox.error && !inbox.rows.length ? <Empty emoji="💬" title="Ainda sem conversas." detail={'Vai ao perfil de alguem e clica em "Mensagem" para comecar.'} /> : null}
          {inbox.rows.map((row) => <InboxRow key={row.meta.id} row={row} />)}
        </div>
      ) : null}
      <BottomNav active="dm.html" />
      {pickerOpen && user && profile ? <NewConversationPicker user={user} profile={profile} onlineUids={onlineUids} onClose={() => setPickerOpen(false)} /> : null}
    </PageFrame>
  );
}
