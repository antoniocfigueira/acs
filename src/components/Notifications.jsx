import React, { useEffect, useState } from "react";
import { collection, doc, limit as fsLimit, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { Bell, X } from "lucide-react";
import { db } from "../lib/firebase.js";
import { routeTo } from "../lib/navigation.js";
import { Avatar, Empty, Loading, timeAgo, toast } from "../lib/ui.jsx";
import { SideDrawer } from "./Modal.jsx";

export function useNotifications(user) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!user?.uid) return undefined;
    const q = query(collection(db, "notifications", user.uid, "items"), orderBy("at", "desc"), fsLimit(50));
    return onSnapshot(q, (snap) => {
      setItems(snap.docs.map((item) => ({ id: item.id, ...item.data() })));
      setLoading(false);
    }, () => setLoading(false));
  }, [user?.uid]);
  return { items, loading, unread: items.filter((item) => !item.read).length };
}

export function NotificationsButton({ user, onOpen }) {
  const { unread } = useNotifications(user);
  return (
    <button className="icon-btn tap" type="button" aria-label="Notificações" onClick={onOpen}>
      <Bell size={22} />
      {unread ? <span className="icon-badge-dot" /> : null}
    </button>
  );
}

export function NotificationsModal({ user, onClose }) {
  const { items, loading } = useNotifications(user);

  useEffect(() => {
    if (!user?.uid) return;
    const unread = items.filter((item) => !item.read).slice(0, 20);
    if (!unread.length) return;
    Promise.all(unread.map((item) => updateDoc(doc(db, "notifications", user.uid, "items", item.id), { read: true }).catch(() => {}))).catch(() => {});
  }, [items, user?.uid]);

  const openItem = (item) => {
    onClose();
    if (item.postId) routeTo("index.html");
    else if (item.chatId && item.fromUid) routeTo("dm.html", `?c=${encodeURIComponent(item.chatId)}&to=${encodeURIComponent(item.fromUid)}`);
    else if (item.fromUsername) routeTo("profile.html", `?u=${encodeURIComponent(item.fromUsername)}`);
  };

  return (
    <SideDrawer onClose={onClose}>
      <div className="sub-panel active">
        <div className="sub-panel-head">
          <button className="icon-btn tap" type="button" aria-label="Fechar" onClick={onClose}>
            <X size={18} />
          </button>
          <div style={{ fontWeight: 700 }}>Notificações</div>
        </div>
        <div id="notifsList">
        {loading ? <Loading /> : null}
        {!loading && !items.length ? <Empty title="Sem notificações." /> : null}
        {items.map((item) => (
          <button key={item.id} type="button" className={`notif ${item.read ? "" : "unread"}`} style={{ width: "100%", textAlign: "left", border: 0, background: "transparent", color: "inherit" }} onClick={() => openItem(item)}>
            <Avatar user={{ name: item.fromName, username: item.fromUsername, photoURL: item.fromPhoto }} size={34} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nt-text"><b>{item.fromName || "Alfa"}</b> {item.text || item.type || ""}</div>
              {item.postText ? <div className="nt-post-ref">{item.postText.slice(0, 90)}</div> : null}
              {item.type === "news" && item.newsTitle ? <div className="nt-post-ref">{item.newsTitle}</div> : null}
              <div className="nt-time">{timeAgo(item.at)}</div>
            </div>
          </button>
        ))}
        </div>
      </div>
    </SideDrawer>
  );
}

export async function createNotification(toUid, payload) {
  if (!toUid) return;
  try {
    await import("firebase/firestore").then(({ addDoc, collection, serverTimestamp }) =>
      addDoc(collection(db, "notifications", toUid, "items"), { ...payload, read: false, at: serverTimestamp() })
    );
  } catch (err) {
    toast(`Notif falhou: ${err.message}`, "error");
  }
}
