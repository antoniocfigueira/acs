// =========================================================
// Alfa Club Social — Alfa News (admin-only publishing)
// Collection: news/{id} { uid, authorName, authorUsername, authorPhoto,
//   authorIsAdmin, title, body, mediaURL, mediaType, createdAt }
// =========================================================
import { db } from "./firebase-config.js";
import {
  collection, query, orderBy, limit, onSnapshot, addDoc,
  doc, getDoc, deleteDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { requireAuth } from "./auth.js";
import {
  toast, timeAgo, avatarHTML, escapeHTML, tap, adminBadgeHTML,
  modal, uploadMedia, promptMediaURL, wireHeaderNotifButton, wireDmNotifButton,
  maybePromptForNotifs
} from "./app.js";

import "./sw-register.js";

let CURRENT_USER = null;
let CURRENT_PROFILE = null;
let feedUnsub = null;

requireAuth((user, profile) => {
  CURRENT_USER = user;
  CURRENT_PROFILE = profile || {};
  wireHeaderNotifButton(user);
  wireDmNotifButton(user);
  maybePromptForNotifs();

  // Only admins see the compose hero
  if (CURRENT_PROFILE?.isAdmin === true) {
    const hero = document.getElementById("adminHero");
    hero?.classList.remove("hidden");
    document.getElementById("newNewsBtn")?.addEventListener("click", openComposer);
  }

  subscribeFeed();
});

// =========================================================
// FEED
// =========================================================
function subscribeFeed() {
  const container = document.getElementById("newsFeed");
  if (feedUnsub) feedUnsub();

  const q = query(collection(db, "news"), orderBy("createdAt", "desc"), limit(50));
  feedUnsub = onSnapshot(q, (snap) => {
    if (snap.empty) {
      container.innerHTML = `
        <div class="empty" style="padding:60px 24px;text-align:center;">
          <div class="empty-emoji">📰</div>
          <div style="font-size:16px;font-weight:600;margin-top:6px;">Ainda sem notícias.</div>
          <div style="color:var(--muted);margin-top:6px;">${
            (CURRENT_PROFILE?.isAdmin || CURRENT_PROFILE?.role === "mod")
              ? "Carrega em “+ Nova” para publicar a primeira."
              : "O admin ainda não publicou nada aqui."
          }</div>
        </div>`;
      return;
    }

    const html = [];
    snap.forEach(d => {
      const n = d.data();
      n.id = d.id;
      html.push(renderNewsCard(n));
    });
    container.innerHTML = html.join("");

    // Wire delete buttons for any allowed news items
    container.querySelectorAll("[data-del]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.del;
        if (!confirm("Apagar esta notícia?")) return;
        try {
          await deleteDoc(doc(db, "news", id));
          toast("Notícia apagada");
        } catch (err) {
          toast("Erro ao apagar: " + err.message, "error");
        }
      });
    });
    container.querySelectorAll("[data-edit]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.edit;
        await openNewsEditor(id);
      });
    });
  }, (err) => {
    console.error(err);
    container.innerHTML = `
      <div class="empty" style="padding:40px 24px;color:var(--muted);">
        <div style="font-size:14px;">Não foi possível carregar as notícias.</div>
        <div style="font-size:12px;color:var(--muted-2);margin-top:6px;word-break:break-word;">${escapeHTML(err.message)}</div>
      </div>`;
  });
}

function renderNewsCard(n) {
  const author = {
    name: n.authorName || "Alfa",
    username: n.authorUsername || "alfa",
    photoURL: n.authorPhoto || "",
    isAdmin: !!n.authorIsAdmin
  };

  let media = "";
  if (n.mediaURL) {
    if (n.mediaType === "video") {
      media = `
        <div class="news-media">
          <video src="${escapeHTML(n.mediaURL)}" controls preload="metadata" playsinline></video>
        </div>`;
    } else {
      media = `
        <div class="news-media">
          <img src="${escapeHTML(n.mediaURL)}" alt="" loading="lazy" />
        </div>`;
    }
  }

  const canDelete = CURRENT_USER && (CURRENT_PROFILE?.isAdmin === true || ((n.uid === CURRENT_USER.uid) && CURRENT_PROFILE?.role === "mod"));
  const canEdit = CURRENT_PROFILE?.isAdmin === true;
  const deleteBtn = canDelete ? `
    <button class="btn-ghost" data-del="${escapeHTML(n.id)}" data-ripple style="padding:6px 10px;font-size:12px;">Apagar</button>
  ` : "";
  const editBtn = canEdit ? `
    <button class="btn-ghost" data-edit="${escapeHTML(n.id)}" data-ripple style="padding:6px 10px;font-size:12px;">Editar</button>
  ` : "";

  return `
    <article class="news-card">
      <div class="news-head">
        <div class="avatar">${avatarHTML(author, 28)}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:13px;color:var(--text);display:flex;align-items:center;">
            ${escapeHTML(author.name)}${adminBadgeHTML(author)}
          </div>
          <div style="font-size:11px;color:var(--muted-2);">@${escapeHTML(author.username)} · ${timeAgo(n.createdAt)}</div>
        </div>
      </div>
      <div class="news-title" style="margin-top:10px;">${escapeHTML(n.title || "")}</div>
      ${n.body ? `<div class="news-body">${escapeHTML(n.body)}</div>` : ""}
      ${media}
      ${deleteBtn || editBtn ? `<div class="news-actions">${editBtn}${deleteBtn}</div>` : ""}
    </article>
  `;
}

// =========================================================
// COMPOSER (admin-only)
// =========================================================
async function openComposer() {
  if (!CURRENT_PROFILE?.isAdmin) {
    toast("Só admins podem publicar.", "error");
    return;
  }

  let pickedMedia = null; // { url, type }
  let pickedFile = null;

  const bodyHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <input id="newsTitle" type="text" maxlength="120" placeholder="Título" class="input" style="width:100%;padding:10px 14px;background:#141414;border:1px solid var(--border);color:var(--text);border-radius:14px;font-size:14px;" />
      <textarea id="newsBody" maxlength="2000" placeholder="Escreve a notícia..." rows="5" class="input" style="width:100%;padding:10px 14px;background:#141414;border:1px solid var(--border);color:var(--text);border-radius:14px;font-size:14px;font-family:inherit;resize:vertical;"></textarea>

      <div id="newsMediaPreview" class="hidden" style="position:relative;border-radius:14px;overflow:hidden;border:1px solid var(--border);background:#0f0f0f;max-height:280px;"></div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <input id="newsMediaInput" type="file" accept="image/*,video/*" class="hidden" />
        <button type="button" class="btn-ghost" data-act="pickFile" style="flex:1;font-size:13px;padding:9px 12px;">
          <span style="display:inline-flex;align-items:center;gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            Carregar ficheiro
          </span>
        </button>
        <button type="button" class="btn-ghost" data-act="pickUrl" style="flex:1;font-size:13px;padding:9px 12px;">
          <span style="display:inline-flex;align-items:center;gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            Colar URL
          </span>
        </button>
      </div>

      <div id="newsUploadProgress" class="hidden" style="height:4px;background:#1a1a1a;border-radius:2px;overflow:hidden;">
        <div id="newsUploadBar" style="height:100%;width:0%;background:var(--grad);transition:width .2s;"></div>
      </div>
    </div>
  `;

  await modal({
    title: "Publicar notícia",
    bodyHTML,
    confirmLabel: "Publicar",
    onConfirm: async (body) => {
      const title = body.querySelector("#newsTitle").value.trim();
      const text = body.querySelector("#newsBody").value.trim();
      if (!title) throw new Error("Põe um título.");

      tap();
      await addDoc(collection(db, "news"), {
        uid: CURRENT_USER.uid,
        authorName: CURRENT_PROFILE.name || "",
        authorUsername: CURRENT_PROFILE.username || "",
        authorPhoto: CURRENT_PROFILE.photoURL || "",
        authorIsAdmin: !!CURRENT_PROFILE?.isAdmin,
        authorIsMod: CURRENT_PROFILE?.role === "mod",
        title: title.slice(0, 120),
        body: text.slice(0, 2000),
        mediaURL: pickedMedia?.url || "",
        mediaType: pickedMedia?.type || "",
        createdAt: serverTimestamp()
      });
      toast("Notícia publicada");
      return true;
    }
  });

  // Wire up picker buttons after modal renders
  // (modal() appends DOM synchronously, so we can attach handlers right after; but we wait a tick
  // for robustness)
  requestAnimationFrame(() => {
    const fileInput = document.getElementById("newsMediaInput");
    const preview = document.getElementById("newsMediaPreview");
    const progress = document.getElementById("newsUploadProgress");
    const bar = document.getElementById("newsUploadBar");

    document.querySelectorAll('[data-act="pickFile"]').forEach(b => {
      b.addEventListener("click", () => fileInput?.click());
    });
    document.querySelectorAll('[data-act="pickUrl"]').forEach(b => {
      b.addEventListener("click", async () => {
        const res = await promptMediaURL();
        if (!res) return;
        pickedMedia = res;
        pickedFile = null;
        renderPreview();
      });
    });

    fileInput?.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      pickedFile = f;
      try {
        progress?.classList.remove("hidden");
        if (bar) bar.style.width = "0%";
        const up = await uploadMedia(f, (p) => {
          if (bar) bar.style.width = Math.round(p * 100) + "%";
        });
        pickedMedia = { url: up.url, type: up.type };
        renderPreview();
        toast("Ficheiro carregado");
      } catch (err) {
        toast(err.message, "error");
      } finally {
        progress?.classList.add("hidden");
      }
    });

    function renderPreview() {
      if (!preview) return;
      if (!pickedMedia?.url) {
        preview.classList.add("hidden");
        preview.innerHTML = "";
        return;
      }
      preview.classList.remove("hidden");
      if (pickedMedia.type === "video") {
        preview.innerHTML = `<video src="${escapeHTML(pickedMedia.url)}" controls style="display:block;width:100%;max-height:280px;object-fit:cover;"></video>
          <button type="button" id="newsMediaRemove" class="btn-icon" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.65);" aria-label="Remover">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>`;
      } else {
        preview.innerHTML = `<img src="${escapeHTML(pickedMedia.url)}" alt="" style="display:block;width:100%;max-height:280px;object-fit:cover;" />
          <button type="button" id="newsMediaRemove" class="btn-icon" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.65);" aria-label="Remover">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>`;
      }
      document.getElementById("newsMediaRemove")?.addEventListener("click", () => {
        pickedMedia = null;
        pickedFile = null;
        renderPreview();
      });
    }
  });
}

async function openNewsEditor(newsId) {
  try {
    const snap = await getDoc(doc(db, "news", newsId));
    if (!snap.exists()) {
      toast("Notícia não encontrada.", "error");
      return;
    }
    const n = snap.data();
    await modal({
      title: "Editar notícia",
      bodyHTML: `
        <div style="display:flex;flex-direction:column;gap:10px;">
          <input id="newsTitle" type="text" maxlength="120" placeholder="Título" class="input" style="width:100%;padding:10px 14px;background:#141414;border:1px solid var(--border);color:var(--text);border-radius:14px;font-size:14px;" value="${escapeHTML(n.title || "")}" />
          <textarea id="newsBody" maxlength="2000" placeholder="Escreve a notícia..." rows="5" class="input" style="width:100%;padding:10px 14px;background:#141414;border:1px solid var(--border);color:var(--text);border-radius:14px;font-size:14px;font-family:inherit;resize:vertical;">${escapeHTML(n.body || "")}</textarea>
        </div>
      `,
      confirmLabel: "Guardar",
      onConfirm: async (body) => {
        const title = body.querySelector("#newsTitle").value.trim();
        const text = body.querySelector("#newsBody").value.trim();
        if (!title) throw new Error("Põe um título.");
        await updateDoc(doc(db, "news", newsId), {
          title: title.slice(0, 120),
          body: text.slice(0, 2000),
          editedAt: serverTimestamp(),
          editedBy: CURRENT_USER.uid
        });
        toast("Notícia atualizada");
        return true;
      }
    });
  } catch (err) {
    toast("Erro ao editar notícia: " + err.message, "error");
  }
}
