// =========================================================
// Alfa Club Social — Profile logic
// =========================================================
import { db, auth } from "./firebase-config.js";
import {
  collection, query, where, limit, getDocs, doc, getDoc, deleteDoc, updateDoc,
  arrayUnion, arrayRemove, setDoc, increment, runTransaction, addDoc,
  onSnapshot, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { requireAuth, logout, updateMyProfile, getCurrentProfile } from "./auth.js";
import { toast, timeAgo, avatarHTML, escapeHTML, modal, tap, animateCount, adminBadgeHTML, buildDmChatId, wireHeaderNotifButton, wireDmNotifButton, uploadMedia, modBadgeHTML, nameStyleHTML, pointBadgesHTML, alertPretty } from "./app.js";

import "./sw-register.js";

let CURRENT_USER = null;
let CURRENT_PROFILE = null;
let VIEWING_PROFILE = null;

const params = new URLSearchParams(location.search);
const usernameParam = (params.get("u") || "").trim().toLowerCase().replace(/^@/, "");

requireAuth(async (user, profile) => {
  CURRENT_USER = user;
  CURRENT_PROFILE = profile;

  if (!usernameParam || usernameParam === profile.username) {
    VIEWING_PROFILE = profile;
  } else {
    const q = query(collection(db, "users"), where("username", "==", usernameParam), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) {
      document.querySelector(".container").innerHTML = `
        <div class="empty" style="padding:80px 24px;text-align:center;color:var(--muted)">
          <div style="font-size:42px;">🔍</div>
          <div style="font-size:16px;font-weight:600;margin-top:8px;">User não encontrado</div>
          <div style="margin-top:4px;">@${escapeHTML(usernameParam)}</div>
          <a href="./index.html" class="btn-primary" style="display:inline-flex;margin-top:18px;">Voltar ao feed</a>
        </div>
      `;
      return;
    }
    VIEWING_PROFILE = snap.docs[0].data();
  }

  renderProfile();
  loadUserPosts(VIEWING_PROFILE.uid);

  document.getElementById("shareBtn").addEventListener("click", async () => {
    tap();
    const url = location.origin + location.pathname + "?u=" + encodeURIComponent(VIEWING_PROFILE.username || "");
    try {
      if (navigator.share) {
        await navigator.share({ title: `Alfa Club — @${VIEWING_PROFILE.username}`, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast("Link copiado!", "success");
      }
    } catch {}
  });

  // Header notif button + DM unread pulse
  wireHeaderNotifButton(user);
  wireDmNotifButton(user);

  // Pull-to-refresh
  initPullToRefresh();
});

function renderProfile() {
  const p = VIEWING_PROFILE;
  const nameEl = document.getElementById("profileName");
  nameEl.innerHTML = nameStyleHTML(p) + adminBadgeHTML(p) + modBadgeHTML(p);
  document.getElementById("profileUser").textContent = "@" + (p.username || "");
  document.getElementById("profileId").innerHTML = `ID <span style="color:var(--text);margin-left:4px;font-weight:700;">#${p.idNumber || "?"}</span>`;
  const bio = (p.bio || "").trim();
  document.getElementById("profileBio").textContent = bio || (p.uid === CURRENT_USER.uid ? "Adiciona uma bio ao teu perfil..." : "");
  document.getElementById("statPosts").textContent = p.postsCount ?? "0";
  document.getElementById("statPoints").textContent = p.points || 0;

  // Followers / Following — counts + click to open list
  const followers = Array.isArray(p.followers) ? p.followers : [];
  const following = Array.isArray(p.following) ? p.following : [];
  const followersEl = document.getElementById("statFollowers");
  const followingEl = document.getElementById("statFollowing");
  if (followersEl) followersEl.textContent = followers.length;
  if (followingEl) followingEl.textContent = following.length;
  const followersWrap = document.getElementById("statFollowersWrap");
  const followingWrap = document.getElementById("statFollowingWrap");
  if (followersWrap) {
    followersWrap.onclick = () => openFollowList("followers", followers);
  }
  if (followingWrap) {
    followingWrap.onclick = () => openFollowList("following", following);
  }

  // Apply profile hero theme (purchased in shop)
  const hero = document.querySelector(".profile-hero");
  if (hero) {
    // Strip any previous profile-theme-* classes
    hero.classList.forEach(cls => {
      if (cls.startsWith("profile-theme-")) hero.classList.remove(cls);
    });
    const theme = p.profileTheme;
    if (theme && typeof theme === "string" && /^[a-z0-9_-]+$/i.test(theme)) {
      hero.classList.add("profile-theme-" + theme);
    }
  }

  // Badge showcase (hidden — milestone badges removed)
  const badgesEl = document.getElementById("profileBadges");
  if (badgesEl) {
    badgesEl.innerHTML = "";
    badgesEl.style.display = "none";
  }
  const pic = document.getElementById("profilePic");
  pic.innerHTML = p.photoURL
    ? `<img src="${escapeHTML(p.photoURL)}" loading="lazy" />`
    : `<div class="avatar-fallback">${escapeHTML((p.name || p.username || "?").slice(0,1).toUpperCase())}</div>`;

  if (p.uid === CURRENT_USER.uid) {
    const editBtn = document.getElementById("editBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    editBtn.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
    editBtn.addEventListener("click", openEditModal);
    logoutBtn.addEventListener("click", async () => {
      if (confirm("Sair da conta?")) await logout();
    });
  } else {
    // Show DM button when viewing someone else's profile
    const dmBtn = document.getElementById("dmBtn");
    if (dmBtn) {
      dmBtn.classList.remove("hidden");
      dmBtn.addEventListener("click", () => {
        const chatId = buildDmChatId(CURRENT_USER.uid, p.uid);
        window.__alfaNavigate?.(`./dm.html?c=${encodeURIComponent(chatId)}&to=${encodeURIComponent(p.uid)}`) || (location.href = `./dm.html?c=${encodeURIComponent(chatId)}&to=${encodeURIComponent(p.uid)}`);
      });
    }
    // Follow / Block buttons
    wireFollowBlockButtons(p);
  }
}

// ─── Followers / Following list modal ──────────────
async function openFollowList(type, uids) {
  tap();
  const title = type === "followers" ? "Seguidores" : "A seguir";
  const emptyMsg = type === "followers"
    ? "Ainda ninguém segue este gajo."
    : "Este gajo ainda não segue ninguém. Deve ser bueda fixe.";
  await modal({
    title,
    bodyHTML: `<div id="followList" style="max-height:60vh;overflow-y:auto;margin:-6px -4px 0;">
      <div class="user-list-empty"><span class="dots">A carregar</span></div>
    </div>`,
    confirmLabel: "Fechar",
    onOpen: async (body) => {
      const listBox = body.querySelector("#followList");
      if (!uids.length) {
        listBox.innerHTML = `<div class="user-list-empty">${emptyMsg}</div>`;
        return;
      }
      try {
        const users = await fetchUsersByUids(uids);
        if (!users.length) {
          listBox.innerHTML = `<div class="user-list-empty">${emptyMsg}</div>`;
          return;
        }
        // Sort alphabetically by name for consistency
        users.sort((a, b) => (a.name || a.username || "").localeCompare(b.name || b.username || ""));
        listBox.innerHTML = users.map(u => {
          const nameHTML = nameStyleHTML({ name: u.name || u.username || "?", nameColor: u.nameColor, nameStyle: u.nameStyle });
          const photoBlock = u.photoURL
            ? `<img src="${escapeHTML(u.photoURL)}" loading="lazy" alt="" />`
            : escapeHTML((u.name || u.username || "?").slice(0,1).toUpperCase());
          return `
            <a class="user-list-item tap" data-ripple href="./profile.html?u=${encodeURIComponent(u.username || "")}">
              <div class="user-list-avatar">${photoBlock}</div>
              <div class="user-list-meta">
                <div class="user-list-name">${nameHTML}${adminBadgeHTML(u)}${modBadgeHTML(u)}</div>
                <div class="user-list-user">@${escapeHTML(u.username || "")}</div>
              </div>
            </a>`;
        }).join("");
      } catch (err) {
        console.error("openFollowList error:", err);
        listBox.innerHTML = `<div class="user-list-empty">Erro a carregar: ${escapeHTML(err.message || "")}</div>`;
      }
    }
  });
}

// Batch-fetch users by uid. Firestore doesn't have an efficient `in` for huge
// arrays, so we simply parallel-fetch individual docs (followers lists are
// small enough for this to be fine).
async function fetchUsersByUids(uids) {
  if (!Array.isArray(uids) || !uids.length) return [];
  const unique = [...new Set(uids)].filter(Boolean);
  // Cap at a reasonable number to avoid hammering Firestore
  const capped = unique.slice(0, 500);
  const results = await Promise.all(capped.map(async (uid) => {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      if (!snap.exists()) return null;
      const d = snap.data();
      return { uid, ...d };
    } catch { return null; }
  }));
  return results.filter(Boolean);
}

async function wireFollowBlockButtons(targetProfile) {
  const followBtn = document.getElementById("followBtn");
  const blockBtn = document.getElementById("blockBtn");
  if (!followBtn || !blockBtn) return;

  const following = Array.isArray(CURRENT_PROFILE.following) ? CURRENT_PROFILE.following : [];
  const blocked = Array.isArray(CURRENT_PROFILE.blocked) ? CURRENT_PROFILE.blocked : [];

  const isFollowing = following.includes(targetProfile.uid);
  const isBlocked = blocked.includes(targetProfile.uid);

  followBtn.classList.remove("hidden");
  blockBtn.classList.remove("hidden");
  followBtn.textContent = isFollowing ? "A seguir" : "Seguir";
  followBtn.classList.toggle("btn-ghost", isFollowing);
  followBtn.classList.toggle("btn-primary", !isFollowing);
  blockBtn.textContent = isBlocked ? "Desbloquear" : "Bloquear";

  followBtn.onclick = async () => {
    tap();
    try {
      const myRef = doc(db, "users", CURRENT_USER.uid);
      const themRef = doc(db, "users", targetProfile.uid);
      if (followBtn.textContent === "A seguir") {
        await updateDoc(myRef, { following: arrayRemove(targetProfile.uid) });
        await updateDoc(themRef, { followers: arrayRemove(CURRENT_USER.uid) }).catch(() => {});
        followBtn.textContent = "Seguir";
        followBtn.classList.add("btn-primary");
        followBtn.classList.remove("btn-ghost");
        toast("Deixaste de seguir", "success");
      } else {
        await updateDoc(myRef, { following: arrayUnion(targetProfile.uid) });
        await updateDoc(themRef, { followers: arrayUnion(CURRENT_USER.uid) }).catch(() => {});
        followBtn.textContent = "A seguir";
        followBtn.classList.remove("btn-primary");
        followBtn.classList.add("btn-ghost");
        toast("A seguir!", "success");
      }
      CURRENT_PROFILE = await getCurrentProfile();
    } catch (err) {
      toast("Erro: " + err.message, "error");
    }
  };

  blockBtn.onclick = async () => {
    tap();
    try {
      const myRef = doc(db, "users", CURRENT_USER.uid);
      if (blockBtn.textContent === "Desbloquear") {
        await updateDoc(myRef, { blocked: arrayRemove(targetProfile.uid) });
        blockBtn.textContent = "Bloquear";
        toast("Desbloqueado", "success");
      } else {
        if (!confirm("Bloquear este utilizador? Deixarás de ver os posts dele.")) return;
        await updateDoc(myRef, { blocked: arrayUnion(targetProfile.uid) });
        // If following, also unfollow
        if (followBtn.textContent === "A seguir") {
          await updateDoc(myRef, { following: arrayRemove(targetProfile.uid) });
          const themRef = doc(db, "users", targetProfile.uid);
          await updateDoc(themRef, { followers: arrayRemove(CURRENT_USER.uid) }).catch(() => {});
          followBtn.textContent = "Seguir";
        }
        blockBtn.textContent = "Desbloquear";
        toast("Bloqueado", "success");
      }
      CURRENT_PROFILE = await getCurrentProfile();
    } catch (err) {
      toast("Erro: " + err.message, "error");
    }
  };
}

async function openEditModal() {
  const p = CURRENT_PROFILE;
  const body = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:12px;margin-bottom:18px;">
      <div class="edit-avatar-preview" id="ed-avatar-preview" style="width:96px;height:96px;border-radius:50%;overflow:hidden;background:var(--grad);display:grid;place-items:center;color:#fff;font-size:36px;font-weight:800;box-shadow:0 14px 32px -10px rgba(236,72,153,.5);position:relative;">
        ${p.photoURL
          ? `<img src="${escapeHTML(p.photoURL)}" style="width:100%;height:100%;object-fit:cover;" />`
          : escapeHTML((p.name || p.username || "?").slice(0,1).toUpperCase())}
      </div>
      <button type="button" id="ed-upload-btn" class="btn-primary tap" style="padding:10px 18px;font-size:13px;display:inline-flex;align-items:center;gap:8px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <span id="ed-upload-label">Carregar foto</span>
      </button>
      <input type="file" id="ed-photo-file" accept="image/*" style="display:none;" />
      <div id="ed-upload-progress" style="display:none;width:80%;height:4px;background:#1a1a1a;border-radius:999px;overflow:hidden;">
        <div id="ed-upload-bar" style="width:0%;height:100%;background:var(--grad);transition:width .2s ease;"></div>
      </div>
    </div>
    <div class="field" style="margin-bottom:12px;">
      <label class="field-label" style="display:block;font-size:11px;color:var(--muted);text-transform:uppercase;margin-bottom:6px;padding-left:4px;">Nome</label>
      <input class="input" id="ed-name" value="${escapeHTML(p.name || "")}" />
    </div>
    <div class="field" style="margin-bottom:6px;">
      <label class="field-label" style="display:block;font-size:11px;color:var(--muted);text-transform:uppercase;margin-bottom:6px;padding-left:4px;">Bio</label>
      <textarea class="input" id="ed-bio" rows="3" maxlength="160" placeholder="Conta algo sobre ti...">${escapeHTML(p.bio || "")}</textarea>
    </div>
    <input type="hidden" id="ed-photo" value="${escapeHTML(p.photoURL || "")}" />
  `;
  await modal({
    title: "Editar perfil",
    bodyHTML: body,
    confirmLabel: "Guardar",
    onOpen: (root) => {
      const btn = root.querySelector("#ed-upload-btn");
      const fileInput = root.querySelector("#ed-photo-file");
      const preview = root.querySelector("#ed-avatar-preview");
      const hidden = root.querySelector("#ed-photo");
      const label = root.querySelector("#ed-upload-label");
      const progressWrap = root.querySelector("#ed-upload-progress");
      const bar = root.querySelector("#ed-upload-bar");

      btn.addEventListener("click", (e) => { e.preventDefault(); fileInput.click(); });
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) { toast("Só imagens!", "error"); return; }
        // Instant local preview
        try {
          const fr = new FileReader();
          fr.onload = (e) => { preview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;" />`; };
          fr.readAsDataURL(file);
        } catch {}
        btn.disabled = true;
        label.textContent = "A enviar...";
        progressWrap.style.display = "block";
        try {
          const up = await uploadMedia(file, (pct) => { bar.style.width = Math.round(pct * 100) + "%"; });
          hidden.value = up.url;
          bar.style.width = "100%";
          label.textContent = "Foto carregada ✓";
          setTimeout(() => { progressWrap.style.display = "none"; label.textContent = "Alterar foto"; btn.disabled = false; }, 800);
        } catch (err) {
          toast("Erro: " + (err.message || "falhou"), "error");
          label.textContent = "Carregar foto";
          progressWrap.style.display = "none";
          btn.disabled = false;
        }
      });
    },
    onConfirm: async (root) => {
      const data = {
        name: root.querySelector("#ed-name").value.trim().slice(0, 60),
        bio: root.querySelector("#ed-bio").value.trim().slice(0, 160),
        photoURL: root.querySelector("#ed-photo").value.trim()
      };
      await updateMyProfile(data);
      toast("Perfil atualizado", "success");
      // re-read and re-render
      CURRENT_PROFILE = await getCurrentProfile();
      VIEWING_PROFILE = CURRENT_PROFILE;
      renderProfile();
      return true;
    }
  });
}

async function loadUserPosts(uid) {
  const box = document.getElementById("userPosts");
  box.innerHTML = `<div class="empty" style="padding:40px;"><span class="dots">A carregar</span></div>`;
  try {
    // No orderBy here → no composite index required.
    // We fetch by uid only, then sort client-side.
    const q = query(collection(db, "posts"), where("uid", "==", uid), limit(100));
    const snap = await getDocs(q);
    if (snap.empty) {
      box.innerHTML = `<div class="posts-grid-empty"><div style="margin-top:8px;">Ainda não publicaste nada.</div></div>`;
      // Still initialize the Imagens grid + wire the tab switcher so
      // the user can switch tabs even with zero posts.
      renderImagesGrid([]);
      wireProfileTabs();
      animateCount(document.getElementById("statPosts"), 0);
      return;
    }
    const posts = [];
    snap.forEach(d => { const p = d.data(); p.id = d.id; posts.push(p); });

    // Client-side sort by createdAt desc. Works even if some docs don't have the field yet.
    posts.sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
      return tb - ta;
    });

    const isMine = VIEWING_PROFILE.uid === CURRENT_USER.uid;
    const isAdminOrMod = !!CURRENT_PROFILE?.isAdmin || CURRENT_PROFILE?.role === "mod";
    box.innerHTML = posts.map(p => {
      const mediaHTML = p.mediaType === "video"
        ? `<div class="post-video"><video src="${escapeHTML(p.mediaURL || "")}" controls preload="metadata" playsinline></video></div>`
        : p.mediaType === "image" && p.mediaURL
          ? `<div class="post-image"><img src="${escapeHTML(p.mediaURL)}" loading="lazy" alt="" /></div>`
          : "";
      const canDelete = isMine || isAdminOrMod;
      const canEditAsAdmin = !!CURRENT_PROFILE?.isAdmin;
      return `
      <article class="post" data-id="${p.id}" data-uid="${p.uid}">
        <div class="post-head">
          <div class="post-avatar">${avatarHTML({ photoURL: p.authorPhoto, name: p.authorName, username: p.authorUsername }, 38)}</div>
          <div style="flex:1;min-width:0;">
            <div class="post-user">${nameStyleHTML({ name: p.authorName, nameColor: p.uid === CURRENT_USER.uid ? (CURRENT_PROFILE?.nameColor || "") : (p.authorNameColor || ""), nameStyle: p.uid === CURRENT_USER.uid ? (CURRENT_PROFILE?.nameStyle || "") : (p.authorNameStyle || "") })}${adminBadgeHTML({ isAdmin: VIEWING_PROFILE.isAdmin })}</div>
            <div class="post-meta">${timeAgo(p.createdAt)}${p.editedAt ? ' · <span style="font-style:italic;opacity:.75;">editado</span>' : ''}</div>
          </div>
          ${canEditAsAdmin ? `<button class="btn-icon tap" data-action="edit-post" aria-label="Editar" data-ripple title="Editar texto"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>` : ""}
          ${canDelete ? `<button class="btn-icon tap" data-action="delete-post" aria-label="Apagar" data-ripple><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : ""}
        </div>
        ${p.text ? `<div class="post-body">${escapeHTML(p.text || "")}</div>` : ""}
        ${mediaHTML}
        <div class="post-actions">
          <button class="action-btn tap" data-action="like" data-ripple>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/></svg>
            <span class="count-likes">${p.likes || 0}</span>
          </button>
          <button class="action-btn tap" data-action="dislike" data-ripple>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3l4 8v-5h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-3z" transform="rotate(180 12 12)"/></svg>
            <span class="count-dislikes">${p.dislikes || 0}</span>
          </button>
          <button class="action-btn tap" data-action="comment-toggle" data-ripple>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5A8.38 8.38 0 0 1 12.5 20a8.5 8.5 0 0 1-7.5-4.2L3 21l2.2-5.5A8.5 8.5 0 0 1 12.5 3a8.38 8.38 0 0 1 8.5 8.5z"/></svg>
            <span class="count-comments">${p.commentsCount || 0}</span>
          </button>
        </div>
        <div class="comments hidden" data-comments></div>
      </article>`;
    }).join("");

    // Wire up delete buttons
    if (isMine || isAdminOrMod) {
      box.querySelectorAll('[data-action="delete-post"]').forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const article = btn.closest("article.post");
          const postId = article?.dataset.id;
          if (!postId) return;
          if (!confirm("Apagar este post?")) return;
          try {
            await deleteDoc(doc(db, "posts", postId));
            article.style.transition = "opacity .3s, transform .3s";
            article.style.opacity = "0";
            article.style.transform = "translateX(-100%)";
            setTimeout(() => article.remove(), 300);
            toast("Post apagado", "success");
          } catch (err) {
            toast("Erro: " + err.message, "error");
          }
        });
      });
    }

    // God-mode: admins can edit any post text
    if (CURRENT_PROFILE?.isAdmin) {
      box.querySelectorAll('[data-action="edit-post"]').forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const article = btn.closest("article.post");
          const postId = article?.dataset.id;
          if (!postId) return;
          try {
            const snap = await getDoc(doc(db, "posts", postId));
            const current = snap.data()?.text || "";
            const next = prompt("Editar texto do post:", current);
            if (next === null) return;
            const trimmed = next.trim();
            if (trimmed === current.trim()) return;
            await updateDoc(doc(db, "posts", postId), {
              text: trimmed,
              editedAt: serverTimestamp(),
              editedBy: CURRENT_USER.uid
            });
            // Update in place
            const body = article.querySelector(".post-body");
            if (body) body.textContent = trimmed;
            else if (trimmed) {
              const newBody = document.createElement("div");
              newBody.className = "post-body";
              newBody.textContent = trimmed;
              article.querySelector(".post-head").after(newBody);
            }
            const meta = article.querySelector(".post-meta");
            if (meta && !meta.innerHTML.includes("editado")) {
              meta.innerHTML += ' · <span style="font-style:italic;opacity:.75;">editado</span>';
            }
            toast("Post editado", "success");
          } catch (err) { toast("Erro: " + err.message, "error"); }
        });
      });
    }

    // Wire up interactive like / dislike / comments
    bindProfilePostActions(box);

    // animate the stats counters
    animateCount(document.getElementById("statPosts"), posts.length);

    // Also render images grid + wire tab switching
    renderImagesGrid(posts);
    wireProfileTabs();
  } catch (err) {
    console.error(err);
    // graceful message (no composite index required now, but just in case)
    const link = (err.message || "").match(/https?:\/\/console\.firebase\.google\.com[^\s]+/);
    const hint = link
      ? `<a href="${link[0]}" target="_blank" class="grad-text" style="text-decoration:underline;">Clica aqui para criar o índice necessário.</a>`
      : "";
    box.innerHTML = `
      <div class="empty" style="padding:30px;color:var(--muted);">
        <div style="font-size:32px;margin-bottom:10px;">😕</div>
        <div>Não foi possível carregar os posts.</div>
        <div style="font-size:12px;color:var(--muted-2);margin-top:8px;word-break:break-word;">${escapeHTML(err.message || "")}</div>
        ${hint ? `<div style="margin-top:10px;">${hint}</div>` : ""}
      </div>`;
  }
}

// Render only image/video posts as a clickable grid
function renderImagesGrid(posts) {
  const grid = document.getElementById("userImages");
  if (!grid) return;
  const media = posts.filter(p => p.mediaURL && (p.mediaType === "image" || p.mediaType === "video"));
  if (!media.length) {
    grid.innerHTML = `<div class="posts-grid-empty" style="padding:40px;text-align:center;color:var(--muted);">Ainda sem imagens.</div>`;
    return;
  }
  grid.innerHTML = media.map(p => {
    const thumb = p.mediaType === "video"
      ? `<video src="${escapeHTML(p.mediaURL || "")}" muted playsinline preload="metadata"></video>
         <span class="media-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20"/></svg></span>`
      : `<img src="${escapeHTML(p.mediaURL || "")}" loading="lazy" alt="" />`;
    return `<a class="img-cell" href="#post-${escapeHTML(p.id)}" data-id="${escapeHTML(p.id)}" data-type="${escapeHTML(p.mediaType || "image")}" data-url="${escapeHTML(p.mediaURL || "")}">
      ${thumb}
    </a>`;
  }).join("");

  // Simple lightbox on tap
  grid.querySelectorAll(".img-cell").forEach(cell => {
    cell.addEventListener("click", (e) => {
      e.preventDefault();
      const url = cell.dataset.url;
      const type = cell.dataset.type;
      const overlay = document.createElement("div");
      overlay.className = "img-lightbox";
      overlay.innerHTML = type === "video"
        ? `<video src="${escapeHTML(url)}" controls autoplay playsinline></video>`
        : `<img src="${escapeHTML(url)}" alt="" />`;
      overlay.addEventListener("click", () => overlay.remove());
      document.body.appendChild(overlay);
    });
  });
}

// Wire tab switching (Posts / Imagens)
let _profileTabsWired = false;
function wireProfileTabs() {
  if (_profileTabsWired) return;
  _profileTabsWired = true;
  const tabs = document.querySelectorAll(".tabs-profile button[data-tab]");
  const postsBox = document.getElementById("userPosts");
  const imgsBox  = document.getElementById("userImages");
  if (!tabs.length || !postsBox || !imgsBox) return;
  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      tabs.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const t = btn.dataset.tab;
      if (t === "images") {
        postsBox.style.display = "none";
        imgsBox.style.display  = "";
      } else {
        postsBox.style.display = "";
        imgsBox.style.display  = "none";
      }
    });
  });
}

// ─── Pull-to-refresh (Instagram-style) ──────────────
function initPullToRefresh() {
  const container = document.querySelector(".container");
  if (!container) return;
  if (container._ptrBound) return; // avoid double-binding on bfcache restore
  container._ptrBound = true;
  container.classList.add("pull-container");

  const THRESHOLD = 70;
  const MAX_PULL = 110;

  let pullStartY = 0;
  let isPulling = false;
  let activePull = false;
  let indicator = null;
  let pulled = 0;

  // Helper: is the window essentially at the top of the page?
  const atTop = () => {
    const y = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
    return y <= 2;
  };

  const createIndicator = () => {
    if (indicator) return;
    indicator = document.createElement("div");
    indicator.className = "pull-indicator";
    indicator.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10"/>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
      </svg>`;
    document.body.appendChild(indicator);
  };

  const resetView = () => {
    if (container) {
      container.style.transform = "";
      container.classList.remove("pulling");
    }
    if (indicator) {
      indicator.style.opacity = "";
      indicator.style.transform = "";
      indicator.classList.remove("ready", "refreshing");
      setTimeout(() => {
        if (indicator) { indicator.remove(); indicator = null; }
      }, 320);
    }
  };

  window.addEventListener("touchstart", (e) => {
    if (!atTop()) return;
    if (e.touches.length !== 1) return;
    pullStartY = e.touches[0].clientY;
    isPulling = true;
    activePull = false;
    pulled = 0;
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (!isPulling || e.touches.length !== 1) return;
    const delta = e.touches[0].clientY - pullStartY;
    if (delta <= 0) return;
    if (!atTop()) { isPulling = false; return; }

    if (!activePull && delta > 6) {
      activePull = true;
      createIndicator();
      container.classList.add("pulling");
    }
    if (!activePull) return;

    pulled = Math.min(MAX_PULL, delta * 0.55);
    e.preventDefault();

    container.style.transform = `translateY(${pulled}px)`;
    if (indicator) {
      const progress = Math.min(1, pulled / THRESHOLD);
      indicator.style.opacity = String(progress);
      const rot = pulled * 4;
      const scale = 0.7 + 0.3 * progress;
      const ty = Math.min(pulled * 0.55, 36);
      indicator.style.transform = `translateX(-50%) translateY(${ty}px) scale(${scale}) rotate(${rot}deg)`;
      indicator.classList.toggle("ready", pulled > THRESHOLD);
    }
  }, { passive: false });

  window.addEventListener("touchend", () => {
    if (!isPulling) return;
    isPulling = false;
    if (!activePull) return;

    if (pulled > THRESHOLD) {
      container.classList.remove("pulling");
      container.style.transform = "translateY(44px)";
      if (indicator) {
        indicator.classList.add("refreshing");
        indicator.classList.add("ready");
        indicator.style.opacity = "1";
        indicator.style.transform = `translateX(-50%) translateY(28px) scale(1) rotate(0deg)`;
      }
      setTimeout(() => {
        refreshProfile();
        resetView();
      }, 700);
    } else {
      resetView();
    }
    activePull = false;
    pulled = 0;
  });
}

function refreshProfile() {
  toast("Perfil atualizado!", "success");
  // Recarregar perfil se for o próprio para atualizar pontos, etc.
  if (VIEWING_PROFILE.uid === CURRENT_USER.uid) {
    getCurrentProfile().then(profile => {
      if (profile) {
        CURRENT_PROFILE = profile;
        VIEWING_PROFILE = profile;
        renderProfile();
      }
    }).catch(err => console.warn("Failed to refresh profile:", err));
  }
  loadUserPosts(VIEWING_PROFILE.uid);
}

// =========================================================
// Interactive post actions (like / dislike / comments)
// Mirrors feed.js behaviour so posts on profile pages are live.
// =========================================================
function bindProfilePostActions(root) {
  root.querySelectorAll("article.post").forEach(post => {
    if (post._bound) return;
    post._bound = true;
    const id = post.dataset.id;
    post.querySelector('[data-action="like"]')?.addEventListener("click", () => handleProfileVote(id, post, "like"));
    post.querySelector('[data-action="dislike"]')?.addEventListener("click", () => handleProfileVote(id, post, "dislike"));
    post.querySelector('[data-action="comment-toggle"]')?.addEventListener("click", () => toggleProfileComments(id, post));
    refreshProfileVote(id, post);
  });
}

async function refreshProfileVote(postId, postEl) {
  try {
    const likeBtn = postEl.querySelector('[data-action="like"]');
    const dislikeBtn = postEl.querySelector('[data-action="dislike"]');
    likeBtn?.classList.remove("liked");
    dislikeBtn?.classList.remove("disliked");
    const ref = doc(db, "posts", postId, "votes", CURRENT_USER.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const t = snap.data().type;
      likeBtn?.classList.toggle("liked", t === "like");
      dislikeBtn?.classList.toggle("disliked", t === "dislike");
    }
  } catch {}
}

async function handleProfileVote(postId, postEl, type) {
  tap();
  const btn = postEl.querySelector(`[data-action="${type}"]`);
  const svg = btn?.querySelector("svg");
  if (svg) { svg.classList.remove("heart-pop"); void svg.offsetWidth; svg.classList.add("heart-pop"); }
  try {
    const voteRef = doc(db, "posts", postId, "votes", CURRENT_USER.uid);
    const postRef = doc(db, "posts", postId);
    const postAuthorUid = postEl.dataset.uid;
    await runTransaction(db, async (tx) => {
      const [vSnap, pSnap] = await Promise.all([tx.get(voteRef), tx.get(postRef)]);
      if (!pSnap.exists()) throw new Error("Post já não existe");
      const current = vSnap.exists() ? vSnap.data().type : null;
      let dLikes = 0, dDislikes = 0;
      if (current === type) {
        tx.delete(voteRef);
        if (type === "like") dLikes = -1; else dDislikes = -1;
      } else {
        if (current === "like") dLikes = -1;
        if (current === "dislike") dDislikes = -1;
        if (type === "like") dLikes += 1;
        if (type === "dislike") dDislikes += 1;
        tx.set(voteRef, { type, at: serverTimestamp() });
      }
      tx.update(postRef, { likes: increment(dLikes), dislikes: increment(dDislikes) });
      if (postAuthorUid && postAuthorUid !== CURRENT_USER.uid && dLikes !== 0) {
        tx.update(doc(db, "users", postAuthorUid), { points: increment(dLikes) });
      }
    });
    // Update local counters from a fresh read (simple and reliable)
    const fresh = await getDoc(postRef);
    if (fresh.exists()) {
      const d = fresh.data();
      const lc = postEl.querySelector(".count-likes");
      const dc = postEl.querySelector(".count-dislikes");
      if (lc) lc.textContent = d.likes || 0;
      if (dc) dc.textContent = d.dislikes || 0;
    }
    refreshProfileVote(postId, postEl);
  } catch (err) {
    console.error(err);
    toast("Erro: " + err.message, "error");
  }
}

const _profileCommentUnsubs = new Map();

function toggleProfileComments(postId, postEl) {
  const box = postEl.querySelector("[data-comments]");
  if (!box) return;
  if (!box.classList.contains("hidden")) {
    box.classList.add("hidden");
    const u = _profileCommentUnsubs.get(postId);
    if (u) { u(); _profileCommentUnsubs.delete(postId); }
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = `
    <div id="pcl-${postId}"></div>
    <form class="comment-form" style="display:flex;gap:8px;margin-top:10px;">
      <input class="input" placeholder="Adiciona um comentário..." style="flex:1;padding:10px 14px;font-size:13px;" />
      <button class="btn-primary" style="padding:10px 16px;font-size:13px;" data-ripple>Enviar</button>
    </form>
  `;
  const list = box.querySelector("#pcl-" + postId);
  const form = box.querySelector(".comment-form");
  const input = form.querySelector("input");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = input.value.trim();
    if (!t) return;
    input.value = "";
    try {
      await addDoc(collection(db, "posts", postId, "comments"), {
        uid: CURRENT_USER.uid,
        authorName: CURRENT_PROFILE.name,
        authorUsername: CURRENT_PROFILE.username,
        authorPhoto: CURRENT_PROFILE.photoURL || "",
        authorIsAdmin: !!CURRENT_PROFILE.isAdmin,
        authorIsMod: CURRENT_PROFILE.role === "mod",
        authorRole: CURRENT_PROFILE.role || "user",
        authorNameColor: CURRENT_PROFILE.nameColor || "",
        authorNameStyle: CURRENT_PROFILE.nameStyle || "",
        text: t,
        at: serverTimestamp()
      });
      await updateDoc(doc(db, "posts", postId), { commentsCount: increment(1) });
      const cc = postEl.querySelector(".count-comments");
      if (cc) cc.textContent = (parseInt(cc.textContent, 10) || 0) + 1;
    } catch (err) { toast("Erro: " + err.message, "error"); }
  });
  const cq = query(collection(db, "posts", postId, "comments"), orderBy("at", "asc"), limit(50));
  const unsub = onSnapshot(cq, (snap) => {
    if (snap.empty) {
      list.innerHTML = `<div style="font-size:12px;color:var(--muted);padding:6px 2px;">Sem comentários ainda.</div>`;
      return;
    }
    list.innerHTML = Array.from(snap.docs).map(d => {
      const c = d.data();
      return `
        <div class="comment">
          <div class="comment-avatar">${avatarHTML({ photoURL: c.authorPhoto, name: c.authorName, username: c.authorUsername }, 28)}</div>
          <div class="comment-body">
            <div class="comment-user">${nameStyleHTML({ name: c.authorName, nameColor: c.uid === CURRENT_USER.uid ? (CURRENT_PROFILE?.nameColor || "") : (c.authorNameColor || ""), nameStyle: c.uid === CURRENT_USER.uid ? (CURRENT_PROFILE?.nameStyle || "") : (c.authorNameStyle || "") })}${adminBadgeHTML({ isAdmin: c.authorIsAdmin })}${modBadgeHTML({ isMod: c.authorIsMod, role: c.authorRole })} <span style="color:var(--muted-2);font-weight:400;">@${escapeHTML(c.authorUsername || "")} · ${timeAgo(c.at)}</span></div>
            ${escapeHTML(c.text)}
          </div>
        </div>
      `;
    }).join("");
  });
  _profileCommentUnsubs.set(postId, unsub);
}
