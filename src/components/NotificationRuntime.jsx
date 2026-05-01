import { useEffect } from "react";
import { addDoc, collection, limit as fsLimit, onSnapshot, query, orderBy, serverTimestamp, where } from "firebase/firestore";
import { db, showLocalNotification } from "../lib/firebase.js";

export function NotificationRuntime({ user }) {
  useEffect(() => {
    if (!user?.uid) return undefined;
    let firstSnap = true;
    let previousUnread = 0;
    const q = query(collection(db, "notifications", user.uid, "items"), orderBy("at", "desc"), fsLimit(40));
    return onSnapshot(q, (snap) => {
      let unread = 0;
      let latestUnread = null;
      snap.forEach((item) => {
        const data = { id: item.id, ...item.data() };
        if (!data.read) {
          unread += 1;
          if (!latestUnread) latestUnread = data;
        }
      });
      if (!firstSnap && unread > previousUnread && latestUnread) {
        showLocalNotification({
          title: `🔔 ${latestUnread.fromName || "Alfa Club"}`,
          body: latestUnread.text || "Tens uma nova notificacao",
          tag: `notif-${latestUnread.postId || latestUnread.id}`,
          data: { url: "./index.html?notifs=1" },
          source: "client",
          category: "engagement"
        });
      }
      firstSnap = false;
      previousUnread = unread;
    });
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return undefined;
    let firstSnap = true;
    let latestSeen = 0;
    try {
      latestSeen = Number(localStorage.getItem("acs_latest_news_seen_v1") || "0");
    } catch {}
    const q = query(collection(db, "news"), orderBy("createdAt", "desc"), fsLimit(8));
    return onSnapshot(q, (snap) => {
      let newest = latestSeen;
      const fresh = [];
      snap.forEach((item) => {
        const data = { id: item.id, ...item.data() };
        const ts = data.createdAt?.toMillis ? data.createdAt.toMillis() : 0;
        if (ts > newest) newest = ts;
        if (!firstSnap && ts && ts > latestSeen && data.uid !== user.uid) fresh.push(data);
      });
      if (newest > latestSeen) {
        latestSeen = newest;
        try { localStorage.setItem("acs_latest_news_seen_v1", String(newest)); } catch {}
      }
      fresh.slice(0, 3).forEach((item) => {
        addDoc(collection(db, "notifications", user.uid, "items"), {
          type: "news",
          fromUid: item.uid || "",
          fromName: "Alfa News",
          fromUsername: item.authorUsername || "",
          fromPhoto: item.authorPhoto || "",
          newsId: item.id,
          newsTitle: item.title || "",
          text: "nova publicacao nos Alfa News",
          read: false,
          at: serverTimestamp()
        }).catch(() => {});
      });
      firstSnap = false;
    });
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return undefined;
    let previousUnread = 0;
    const q = query(collection(db, "chats"), where("participants", "array-contains", user.uid), fsLimit(100));
    return onSnapshot(q, (snap) => {
      let unread = 0;
      let latest = null;
      snap.forEach((item) => {
        const data = item.data();
        const count = data[`unread_${user.uid}`] || 0;
        unread += count;
        if (count > 0 && data.lastMessage) {
          latest = {
            chatId: item.id,
            from: data.lastMessageFrom || "Alguem",
            text: data.lastMessage
          };
        }
      });
      if (unread > previousUnread) {
        if (latest) {
          showLocalNotification({
            title: latest.from,
            body: latest.text.slice(0, 120),
            tag: `dm-${latest.chatId}`,
            data: { url: `./dm.html?c=${encodeURIComponent(latest.chatId)}` },
            source: "client",
            category: "dm"
          });
        } else {
          showLocalNotification({
            title: "Nova mensagem privada",
            body: `Tens ${unread} mensagem${unread === 1 ? "" : "s"} por ler.`,
            tag: "dm-unread",
            data: { url: "./dm.html" },
            source: "client",
            category: "dm"
          });
        }
      }
      previousUnread = unread;
    });
  }, [user?.uid]);

  return null;
}
