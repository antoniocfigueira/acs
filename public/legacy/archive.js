// =========================================================
// Alfa Club Social — Arquivo (sections) + Roles
// =========================================================
//
// Data model:
//
//   archiveSections/{sectionId}
//     name: string              -- shown in the list + title bar
//     description?: string      -- one-line subtitle
//     icon?: string             -- single emoji rendered next to the name
//     order: number             -- ascending ordering for the list
//     requiredRoles: string[]   -- empty array → visible to every signed-in user.
//                                  non-empty → user must have at least one of
//                                  these roles to see the section. Admins
//                                  always see every section.
//     createdAt, updatedAt, createdBy
//
//   archiveSections/{sectionId}/entries/{entryId}
//     title: string
//     body: string              -- plain text, newlines preserved
//     imageURL?: string
//     order: number
//     createdAt, updatedAt, createdBy
//
//   roles/{roleId}
//     name: string              -- "Trusted", "Inner Circle", whatever the
//                                  admin types. Never shown to non-admins.
//     color: string             -- hex (#8b5cf6 etc.) for the chip swatch.
//     createdAt, createdBy
//
//   users/{uid}
//     ...existing fields...
//     roles: string[]           -- array of roleIds the admin has assigned.
//
// Visibility rule (client-side, since Firestore can't do array-intersect on
// a single field server-side without exploding the rule budget):
//   - admin → sees all sections regardless of requiredRoles
//   - non-admin →
//       requiredRoles.length === 0 → visible
//       else → visible iff user.roles ∩ requiredRoles ≠ ∅
//
// Security note: client filtering is the v1. The data of restricted
// sections is still readable to any signed-in user via direct Firestore
// queries — which is fine for "soft" privacy (organisational), but if you
// ever store anything sensitive here, layer in Firestore rules that mirror
// the visibility check.
import { db, auth } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, setDoc,
  query, orderBy, serverTimestamp, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  toast, modal, escapeHTML, alertPretty, uploadMedia
} from "./app.js";

// ─── Local state ────────────────────────────────────────
let _profile = null;
let _allRoles = [];          // [{ id, name, color }]
let _sectionsCache = [];     // last-loaded sections
let _openSectionId = null;   // null → root list view; string → section detail
let _sectionsLoading = false;
let _rolesLoading = false;

// Public bootstrap — feed.js calls this once we have the auth profile.
export function initArchive(profile) {
  _profile = profile;
  wireDrawerEntry();
  wireRolesUI();
  // Pre-load roles silently so admins can use them without an extra round
  // trip when they open the modals. Non-admins use roles purely to evaluate
  // their own visibility against section.requiredRoles.
  loadAllRoles().catch(() => {});
}

// ─── Drawer wiring ──────────────────────────────────────
function wireDrawerEntry() {
  // The sub-panel is opened by the standard data-subpanel handler in
  // app.js (it just toggles the .active class). Here we attach the
  // listeners for the buttons inside the panel itself.
  const newSecBtn = document.getElementById("archiveNewSectionBtn");
  const newEntryBtn = document.getElementById("archiveNewEntryBtn");
  const backBtn = document.querySelector("#archivePanel [data-archive-back]");
  newSecBtn?.addEventListener("click", () => openSectionModal(null));
  newEntryBtn?.addEventListener("click", () => openEntryModal(null));
  backBtn?.addEventListener("click", (e) => {
    // Inside a section detail view → back to the sections list, not the
    // drawer root. The drawer's own close handler will only fire when we
    // already are at the root.
    if (_openSectionId) {
      e.stopImmediatePropagation();
      e.preventDefault();
      showSectionsRoot();
    }
  }, true);
  // Render whenever the panel is opened. We hook into the drawer's
  // generic dispatcher by listening on body for the same data-subpanel
  // clicks that toggle visibility.
  document.body.addEventListener("click", (e) => {
    const t = e.target.closest("[data-subpanel]");
    if (t && t.dataset.subpanel === "archivePanel") {
      // Defer one tick so the panel has switched to .active before the
      // contents render (avoids flicker).
      setTimeout(() => showSectionsRoot(), 0);
    }
  }, true);
}

// ─── Roles: load + admin UI ────────────────────────────
async function loadAllRoles() {
  if (_rolesLoading) return _allRoles;
  _rolesLoading = true;
  try {
    const snap = await getDocs(query(collection(db, "roles"), orderBy("name")));
    _allRoles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    // Non-admins may not be allowed to read /roles — that's expected.
    _allRoles = [];
  } finally {
    _rolesLoading = false;
  }
  return _allRoles;
}

function wireRolesUI() {
  if (!_profile?.isAdmin) return;
  const addBtn = document.getElementById("adminAddRoleBtn");
  const nameIn = document.getElementById("adminNewRoleName");
  const colorIn = document.getElementById("adminNewRoleColor");
  if (!addBtn || !nameIn || !colorIn) return;
  // Render the existing list whenever the admin panel is opened.
  document.body.addEventListener("click", (e) => {
    const t = e.target.closest("[data-subpanel]");
    if (t && t.dataset.subpanel === "adminPanel") {
      setTimeout(() => renderAdminRolesList(), 0);
    }
  }, true);
  addBtn.addEventListener("click", async () => {
    const name = (nameIn.value || "").trim();
    const color = colorIn.value || "#8b5cf6";
    if (!name) { toast("Dá um nome ao role.", "error"); return; }
    try {
      await addDoc(collection(db, "roles"), {
        name, color,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid || ""
      });
      nameIn.value = "";
      await loadAllRoles();
      renderAdminRolesList();
      toast("Role criado.", "success");
    } catch (err) {
      toast("Erro: " + err.message, "error");
    }
  });
  // First render
  loadAllRoles().then(renderAdminRolesList);
}

async function renderAdminRolesList() {
  if (!_profile?.isAdmin) return;
  const box = document.getElementById("adminRolesList");
  if (!box) return;
  await loadAllRoles();
  if (!_allRoles.length) {
    box.innerHTML = `<div class="empty" style="padding:14px 0;">Sem roles ainda.</div>`;
    return;
  }
  box.innerHTML = "";
  _allRoles.forEach(r => {
    const row = document.createElement("div");
    row.className = "role-row";
    row.innerHTML = `
      <span class="role-chip" style="background:${escapeHTML(r.color || "#8b5cf6")};"></span>
      <input class="input role-name-input" data-role-name value="${escapeHTML(r.name || "")}"
             style="flex:1;font-size:13px;padding:8px 10px;" />
      <input type="color" data-role-color value="${escapeHTML(r.color || "#8b5cf6")}"
             style="width:36px;height:36px;border:1px solid var(--border);border-radius:8px;background:var(--bg-1);padding:2px;cursor:pointer;" />
      <button class="btn-ghost" data-role-save
              style="font-size:11px;padding:6px 10px;">Guardar</button>
      <button class="btn-ghost" data-role-delete
              style="font-size:11px;padding:6px 10px;color:#fca5a5;">×</button>
    `;
    row.querySelector("[data-role-save]").addEventListener("click", async () => {
      const newName = row.querySelector("[data-role-name]").value.trim();
      const newColor = row.querySelector("[data-role-color]").value;
      if (!newName) { toast("Nome vazio.", "error"); return; }
      try {
        await updateDoc(doc(db, "roles", r.id), { name: newName, color: newColor });
        await loadAllRoles();
        renderAdminRolesList();
        toast("Role atualizado.", "success");
      } catch (err) { toast("Erro: " + err.message, "error"); }
    });
    row.querySelector("[data-role-delete]").addEventListener("click", async () => {
      if (!confirm(`Apagar role "${r.name}"? Isto remove-o de todas as secções e users.`)) return;
      try {
        // 1. Delete the role doc itself.
        await deleteDoc(doc(db, "roles", r.id));
        // 2. Strip the roleId from every user's roles array. We can't do
        //    this server-side without a Cloud Function — for v1 we just
        //    leave stale IDs in place; a periodic cleanup is left for
        //    later. Visibility checks already ignore unknown IDs.
        await loadAllRoles();
        renderAdminRolesList();
        toast("Role apagado.", "success");
      } catch (err) { toast("Erro: " + err.message, "error"); }
    });
    box.appendChild(row);
  });
}

// ─── Visibility & permission helpers ───────────────────
function userCanSeeSection(section) {
  if (_profile?.isAdmin) return true;
  const required = Array.isArray(section.requiredRoles) ? section.requiredRoles : [];
  if (!required.length) return true; // public
  const mine = Array.isArray(_profile?.roles) ? _profile.roles : [];
  return required.some(r => mine.includes(r));
}
// Who can edit / delete a section, add entries, or edit/delete entries
// inside it: the section's creator and every admin. Other authenticated
// users get read-only access.
function userCanManageSection(section) {
  if (_profile?.isAdmin) return true;
  const me = auth.currentUser?.uid;
  return !!(me && section && section.createdBy === me);
}

// ─── Sections (root list) ──────────────────────────────
async function showSectionsRoot() {
  _openSectionId = null;
  const titleEl = document.getElementById("archiveTitle");
  const newSecBtn = document.getElementById("archiveNewSectionBtn");
  const newEntryBtn = document.getElementById("archiveNewEntryBtn");
  const sectionsBox = document.getElementById("archiveSectionsList");
  const entriesBox = document.getElementById("archiveEntriesList");
  if (titleEl) titleEl.textContent = "Arquivo";
  // Every authenticated user can create a section. Admins additionally
  // see a roles selector inside the modal — see openSectionModal().
  newSecBtn?.classList.remove("hidden");
  newEntryBtn?.classList.add("hidden");
  sectionsBox?.classList.remove("hidden");
  entriesBox?.classList.add("hidden");
  if (entriesBox) entriesBox.innerHTML = "";
  await loadAndRenderSections();
}

async function loadAndRenderSections() {
  const box = document.getElementById("archiveSectionsList");
  if (!box) return;
  if (_sectionsLoading) return;
  _sectionsLoading = true;
  box.innerHTML = `<div class="empty" style="padding:14px 0;">A carregar<span class="dots"></span></div>`;
  try {
    const snap = await getDocs(query(collection(db, "archiveSections"), orderBy("order", "asc")));
    _sectionsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    box.innerHTML = `<div class="empty" style="padding:14px 0;color:#fca5a5;">Erro a carregar secções: ${escapeHTML(e.message)}</div>`;
    _sectionsLoading = false;
    return;
  }
  _sectionsLoading = false;
  const visible = _sectionsCache.filter(userCanSeeSection);
  if (!visible.length) {
    box.innerHTML = `<div class="empty" style="padding:18px 0;text-align:center;color:var(--muted);">Sem secções — cria a primeira com '+ Nova secção'.</div>`;
    return;
  }
  box.innerHTML = "";
  visible.forEach(s => box.appendChild(renderSectionCard(s)));
}

function renderSectionCard(s) {
  const card = document.createElement("div");
  card.className = "archive-section-card";
  const hasRestriction = Array.isArray(s.requiredRoles) && s.requiredRoles.length > 0;
  const restrictionChips = hasRestriction
    ? s.requiredRoles.map(rid => {
        const r = _allRoles.find(x => x.id === rid);
        if (!r) return "";
        return `<span class="role-chip-mini" style="background:${escapeHTML(r.color)}" title="${escapeHTML(r.name)}"></span>`;
      }).join("")
    : "";
  // Edit/delete are visible to admins and to the section's own creator.
  const canManage = userCanManageSection(s);
  card.innerHTML = `
    <button type="button" class="archive-section-body" data-open>
      <span class="archive-section-icon">${escapeHTML(s.icon || "📁")}</span>
      <span class="archive-section-meta">
        <span class="archive-section-name">${escapeHTML(s.name || "Sem nome")}</span>
        ${s.description ? `<span class="archive-section-desc">${escapeHTML(s.description)}</span>` : ""}
      </span>
      ${restrictionChips ? `<span class="archive-section-roles">${restrictionChips}</span>` : ""}
      <svg class="archive-section-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    ${canManage ? `
      <div class="archive-section-actions">
        <button class="icon-btn" data-edit title="Editar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn" data-delete title="Apagar" style="color:#fca5a5;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>
    ` : ""}
  `;
  card.querySelector("[data-open]").addEventListener("click", () => openSection(s.id));
  if (canManage) {
    card.querySelector("[data-edit]").addEventListener("click", (e) => {
      e.stopPropagation();
      openSectionModal(s);
    });
    card.querySelector("[data-delete]").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Apagar a secção "${s.name}" e todas as suas entradas?`)) return;
      await deleteSectionAndEntries(s.id);
      await loadAndRenderSections();
      toast("Secção apagada.", "success");
    });
  }
  return card;
}

async function deleteSectionAndEntries(sectionId) {
  // Cascade delete: list entries, delete each, then the section.
  try {
    const entriesSnap = await getDocs(collection(db, "archiveSections", sectionId, "entries"));
    await Promise.all(entriesSnap.docs.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "archiveSections", sectionId));
  } catch (err) {
    toast("Erro a apagar: " + err.message, "error");
    throw err;
  }
}

// ─── Section detail (entries list) ─────────────────────
async function openSection(sectionId) {
  _openSectionId = sectionId;
  const sectionsBox = document.getElementById("archiveSectionsList");
  const entriesBox = document.getElementById("archiveEntriesList");
  const titleEl = document.getElementById("archiveTitle");
  const newSecBtn = document.getElementById("archiveNewSectionBtn");
  const newEntryBtn = document.getElementById("archiveNewEntryBtn");
  sectionsBox?.classList.add("hidden");
  entriesBox?.classList.remove("hidden");
  newSecBtn?.classList.add("hidden");
  // Only the section's owner (or an admin) can post entries into it.
  const section = _sectionsCache.find(s => s.id === sectionId);
  newEntryBtn?.classList.toggle("hidden", !userCanManageSection(section));
  if (titleEl && section) titleEl.textContent = section.name || "Arquivo";
  await loadAndRenderEntries(sectionId);
}

async function loadAndRenderEntries(sectionId) {
  const box = document.getElementById("archiveEntriesList");
  if (!box) return;
  box.innerHTML = `<div class="empty" style="padding:14px 0;">A carregar<span class="dots"></span></div>`;
  let entries = [];
  try {
    const snap = await getDocs(query(
      collection(db, "archiveSections", sectionId, "entries"),
      orderBy("order", "asc")
    ));
    entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    box.innerHTML = `<div class="empty" style="padding:14px 0;color:#fca5a5;">Erro: ${escapeHTML(e.message)}</div>`;
    return;
  }
  if (!entries.length) {
    const parent = _sectionsCache.find(x => x.id === sectionId);
    const canAdd = userCanManageSection(parent);
    box.innerHTML = `<div class="empty" style="padding:18px 0;text-align:center;color:var(--muted);">Sem entradas${canAdd ? " — adiciona com '+ Nova entrada'" : ""}.</div>`;
    return;
  }
  box.innerHTML = "";
  entries.forEach(en => box.appendChild(renderEntryCard(sectionId, en)));
}

// ─── Link helpers ──────────────────────────────────────
// Sanitise/normalise a URL string. Returns null if it's not a safe http(s)
// URL — guards against javascript: and data: schemes that would be XSS
// vectors when injected into anchors.
function sanitiseUrl(raw) {
  if (!raw) return null;
  let url = String(raw).trim();
  if (!url) return null;
  // If the user typed "example.com/foo", auto-prepend https:// so it
  // resolves as an absolute URL.
  if (!/^https?:\/\//i.test(url) && !/^[a-z][a-z0-9+\-.]*:/i.test(url)) {
    url = "https://" + url;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

// Best-effort short label for an unlabelled link — host minus the leading
// www., so `https://github.com/foo` becomes `github.com`.
function shortLinkLabel(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname && u.pathname !== "/" ? u.pathname : "");
  } catch { return url; }
}

// Convert URLs in a plain-text body to anchor tags. Run AFTER escapeHTML so
// we never inject untrusted markup; the URL itself is double-validated by
// sanitiseUrl before being placed in href.
const URL_RE = /(\bhttps?:\/\/[^\s<]+)/gi;
function linkifyBody(escapedHtml) {
  return escapedHtml.replace(URL_RE, (match) => {
    const safe = sanitiseUrl(match);
    if (!safe) return match;
    return `<a href="${escapeHTML(safe)}" target="_blank" rel="noopener noreferrer" class="archive-inline-link">${escapeHTML(match)}</a>`;
  });
}

function renderEntryCard(sectionId, en) {
  const card = document.createElement("div");
  card.className = "archive-entry-card";
  // Render the explicit links list — each entry can carry an array of
  // { label, url } objects. Sanitise every URL before injecting so a
  // malicious javascript:/data: URL can't slip through.
  const links = Array.isArray(en.links) ? en.links : [];
  const linksHTML = links
    .map(l => {
      const safe = sanitiseUrl(l && l.url);
      if (!safe) return "";
      const label = (l && l.label && String(l.label).trim()) || shortLinkLabel(safe);
      return `
        <a class="archive-entry-link" href="${escapeHTML(safe)}"
           target="_blank" rel="noopener noreferrer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          <span>${escapeHTML(label)}</span>
        </a>`;
    })
    .filter(Boolean)
    .join("");
  const bodyHTML = en.body
    ? linkifyBody(escapeHTML(en.body)).replace(/\n/g, "<br>")
    : "";
  // Entries inherit the parent section's ownership: the section creator
  // (or any admin) can edit/delete every entry inside their section.
  const parent = _sectionsCache.find(x => x.id === sectionId);
  const canManage = userCanManageSection(parent);
  card.innerHTML = `
    ${en.imageURL ? `<div class="archive-entry-image"><img loading="lazy" src="${escapeHTML(en.imageURL)}" alt=""></div>` : ""}
    <div class="archive-entry-body">
      <div class="archive-entry-title">${escapeHTML(en.title || "")}</div>
      ${bodyHTML ? `<div class="archive-entry-text">${bodyHTML}</div>` : ""}
      ${linksHTML ? `<div class="archive-entry-links">${linksHTML}</div>` : ""}
    </div>
    ${canManage ? `
      <div class="archive-entry-actions">
        <button class="icon-btn" data-edit title="Editar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn" data-delete title="Apagar" style="color:#fca5a5;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    ` : ""}
  `;
  if (canManage) {
    card.querySelector("[data-edit]").addEventListener("click", () => openEntryModal({ sectionId, ...en }));
    card.querySelector("[data-delete]").addEventListener("click", async () => {
      if (!confirm(`Apagar a entrada "${en.title}"?`)) return;
      try {
        await deleteDoc(doc(db, "archiveSections", sectionId, "entries", en.id));
        await loadAndRenderEntries(sectionId);
        toast("Entrada apagada.", "success");
      } catch (err) { toast("Erro: " + err.message, "error"); }
    });
  }
  return card;
}

// ─── Section create/edit modal ─────────────────────────
async function openSectionModal(existing) {
  const isEdit = !!existing;
  const isAdmin = !!_profile?.isAdmin;
  // Only admins ever see (or can set) the requiredRoles picker. A regular
  // user creating a section always produces a public one (visible to
  // every authenticated user) — this keeps role-gated visibility a pure
  // moderator-tool privilege.
  let rolesPickerHTML = "";
  if (isAdmin) {
    await loadAllRoles();
    rolesPickerHTML = _allRoles.length
      ? _allRoles.map(r => {
          const checked = existing && Array.isArray(existing.requiredRoles) && existing.requiredRoles.includes(r.id);
          return `
            <label class="role-pick">
              <input type="checkbox" data-role-required value="${escapeHTML(r.id)}" ${checked ? "checked" : ""} />
              <span class="role-chip" style="background:${escapeHTML(r.color)};"></span>
              <span>${escapeHTML(r.name)}</span>
            </label>`;
        }).join("")
      : `<div class="empty" style="font-size:12px;color:var(--muted);">Sem roles definidos. Cria-os no painel God Mode.</div>`;
  }
  await modal({
    title: isEdit ? "Editar secção" : "Nova secção",
    confirmLabel: isEdit ? "Guardar" : "Criar",
    bodyHTML: `
      <label class="field-label" style="display:block;font-size:11px;color:var(--muted);margin:4px 0 4px;">Nome</label>
      <input class="input" id="archSecName" placeholder="Ex: Códigos para jogos"
             value="${escapeHTML(existing?.name || "")}" style="font-size:14px;padding:10px 12px;" />
      <label class="field-label" style="display:block;font-size:11px;color:var(--muted);margin:10px 0 4px;">Descrição (opcional)</label>
      <input class="input" id="archSecDesc" placeholder="Pequeno subtítulo"
             value="${escapeHTML(existing?.description || "")}" style="font-size:13px;padding:9px 12px;" />
      <label class="field-label" style="display:block;font-size:11px;color:var(--muted);margin:10px 0 4px;">Emoji (opcional)</label>
      <input class="input" id="archSecIcon" placeholder="📁" maxlength="4"
             value="${escapeHTML(existing?.icon || "")}" style="font-size:18px;padding:8px 12px;width:80px;text-align:center;" />
      ${isAdmin ? `
        <label class="field-label" style="display:block;font-size:11px;color:var(--muted);margin:14px 0 6px;">Visível para (vazio = todos os users)</label>
        <div class="role-picker-list">${rolesPickerHTML}</div>
      ` : ""}
    `,
    onConfirm: async (body) => {
      const name = body.querySelector("#archSecName").value.trim();
      const description = body.querySelector("#archSecDesc").value.trim();
      const icon = body.querySelector("#archSecIcon").value.trim();
      // Non-admins can never set requiredRoles — defaults to [] (public).
      // Editing path: if a non-admin somehow opens an existing section
      // (their own), preserve whatever requiredRoles already exists
      // rather than overwriting to [].
      let requiredRoles;
      if (isAdmin) {
        requiredRoles = Array.from(body.querySelectorAll("[data-role-required]:checked")).map(el => el.value);
      } else if (isEdit && Array.isArray(existing.requiredRoles)) {
        requiredRoles = existing.requiredRoles;
      } else {
        requiredRoles = [];
      }
      if (!name) throw new Error("Nome obrigatório.");
      const data = {
        name, description, icon, requiredRoles,
        updatedAt: serverTimestamp()
      };
      if (isEdit) {
        await updateDoc(doc(db, "archiveSections", existing.id), data);
        toast("Secção atualizada.", "success");
      } else {
        const order = (_sectionsCache.length || 0) + 1;
        await addDoc(collection(db, "archiveSections"), {
          ...data,
          order,
          createdAt: serverTimestamp(),
          createdBy: auth.currentUser?.uid || ""
        });
        toast("Secção criada.", "success");
      }
      await loadAndRenderSections();
      return true;
    }
  });
}

// Build the markup for one editable link row inside the modal.
function _linkRowHTML(link) {
  const url = (link && link.url) || "";
  const label = (link && link.label) || "";
  return `
    <div class="archive-link-row">
      <input class="input archive-link-label" data-link-label
             placeholder="Texto (opcional)"
             value="${escapeHTML(label)}" />
      <input class="input archive-link-url" data-link-url type="url"
             placeholder="https://…"
             value="${escapeHTML(url)}" />
      <button type="button" class="icon-btn archive-link-remove" data-link-remove
              title="Remover" aria-label="Remover link">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
}

// ─── Entry create/edit modal ───────────────────────────
async function openEntryModal(existing) {
  if (!_openSectionId) {
    toast("Abre uma secção primeiro.", "error");
    return;
  }
  const isEdit = !!(existing && existing.id);
  const initialLinks = Array.isArray(existing?.links) && existing.links.length
    ? existing.links
    : [];
  const linksRowsHTML = initialLinks.length
    ? initialLinks.map(_linkRowHTML).join("")
    : "";
  await modal({
    title: isEdit ? "Editar entrada" : "Nova entrada",
    confirmLabel: isEdit ? "Guardar" : "Criar",
    bodyHTML: `
      <label class="field-label" style="display:block;font-size:11px;color:var(--muted);margin:4px 0 4px;">Título</label>
      <input class="input" id="archEntTitle" placeholder="Ex: FIFA 25 — código premium"
             value="${escapeHTML(existing?.title || "")}" style="font-size:14px;padding:10px 12px;" />
      <label class="field-label" style="display:block;font-size:11px;color:var(--muted);margin:10px 0 4px;">Conteúdo</label>
      <textarea class="input" id="archEntBody" rows="6" placeholder="Texto livre…"
                style="font-size:13px;padding:10px 12px;resize:vertical;">${escapeHTML(existing?.body || "")}</textarea>
      <label class="field-label" style="display:block;font-size:11px;color:var(--muted);margin:10px 0 4px;">Links (opcional)</label>
      <div id="archEntLinks" class="archive-link-editor">${linksRowsHTML}</div>
      <button type="button" id="archEntAddLink" class="btn-ghost"
              style="margin-top:6px;font-size:12px;padding:6px 12px;">+ Adicionar link</button>
      <label class="field-label" style="display:block;font-size:11px;color:var(--muted);margin:14px 0 4px;">Imagem (opcional)</label>
      <input type="file" accept="image/*" id="archEntImage" style="font-size:12px;color:var(--muted);" />
      ${existing?.imageURL ? `<div style="margin-top:8px;"><img src="${escapeHTML(existing.imageURL)}" alt="" style="max-width:100%;border-radius:8px;border:1px solid var(--border);" /></div>` : ""}
    `,
    onOpen: (body) => {
      const list = body.querySelector("#archEntLinks");
      const addBtn = body.querySelector("#archEntAddLink");
      // Wire add/remove. Delegated remove keeps it working for newly
      // appended rows without re-binding every time.
      addBtn.addEventListener("click", () => {
        list.insertAdjacentHTML("beforeend", _linkRowHTML(null));
      });
      list.addEventListener("click", (e) => {
        const removeBtn = e.target.closest("[data-link-remove]");
        if (removeBtn) removeBtn.closest(".archive-link-row")?.remove();
      });
    },
    onConfirm: async (body) => {
      const title = body.querySelector("#archEntTitle").value.trim();
      const text = body.querySelector("#archEntBody").value.trim();
      const fileEl = body.querySelector("#archEntImage");
      const file = fileEl?.files?.[0];
      if (!title) throw new Error("Título obrigatório.");
      // Collect link rows. Drop rows whose URL is empty or invalid; drop
      // labels that are pure whitespace. Saving the cleaned shape means
      // the renderer never has to revalidate.
      const linkRows = Array.from(body.querySelectorAll(".archive-link-row"));
      const links = linkRows
        .map(row => {
          const labelRaw = (row.querySelector("[data-link-label]")?.value || "").trim();
          const urlRaw = (row.querySelector("[data-link-url]")?.value || "").trim();
          const safe = sanitiseUrl(urlRaw);
          if (!safe) return null;
          const out = { url: safe };
          if (labelRaw) out.label = labelRaw;
          return out;
        })
        .filter(Boolean);
      let imageURL = existing?.imageURL || "";
      if (file) {
        try {
          imageURL = await uploadMedia(file);
        } catch (e) {
          throw new Error("Upload falhou: " + e.message);
        }
      }
      const data = {
        title, body: text, imageURL, links,
        updatedAt: serverTimestamp()
      };
      if (isEdit) {
        await updateDoc(doc(db, "archiveSections", _openSectionId, "entries", existing.id), data);
        toast("Entrada atualizada.", "success");
      } else {
        // Order = current count + 1 (entries appear in creation order).
        const snap = await getDocs(collection(db, "archiveSections", _openSectionId, "entries"));
        await addDoc(collection(db, "archiveSections", _openSectionId, "entries"), {
          ...data,
          order: snap.size + 1,
          createdAt: serverTimestamp(),
          createdBy: auth.currentUser?.uid || ""
        });
        toast("Entrada criada.", "success");
      }
      await loadAndRenderEntries(_openSectionId);
      return true;
    }
  });
}

// ─── Public helper: edit a user's roles (called from feed.js admin row) ─
export async function openUserRolesEditor(targetUid, currentRoles) {
  if (!_profile?.isAdmin) return;
  await loadAllRoles();
  if (!_allRoles.length) {
    alertPretty("Cria roles primeiro no painel God Mode.");
    return;
  }
  const has = (id) => Array.isArray(currentRoles) && currentRoles.includes(id);
  const html = _allRoles.map(r => `
    <label class="role-pick">
      <input type="checkbox" data-uid-role value="${escapeHTML(r.id)}" ${has(r.id) ? "checked" : ""} />
      <span class="role-chip" style="background:${escapeHTML(r.color)};"></span>
      <span>${escapeHTML(r.name)}</span>
    </label>
  `).join("");
  await modal({
    title: "Roles do utilizador",
    confirmLabel: "Guardar",
    bodyHTML: `<div class="role-picker-list">${html}</div>`,
    onConfirm: async (body) => {
      const next = Array.from(body.querySelectorAll("[data-uid-role]:checked")).map(el => el.value);
      try {
        await updateDoc(doc(db, "users", targetUid), { roles: next });
        toast("Roles atualizados.", "success");
      } catch (err) { throw new Error(err.message); }
      return true;
    }
  });
}
