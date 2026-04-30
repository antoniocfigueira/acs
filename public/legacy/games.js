// =========================================================
// Alfa Club Social — Mini-jogos Multiplayer (Chat Global)
// =========================================================
// Inline games played between two users in the chat.
// - Firestore collection: chat_games/{gameId}
// - A chat RTDB message is pushed with { type: "game", gameId, gameType }
// - The game message subscribes to the Firestore doc and renders live
// - Only the 2 players can make moves; every other user sees it as spectator
// =========================================================
import { db, rtdb } from "./firebase-config.js";
import {
  doc, setDoc, onSnapshot, serverTimestamp, updateDoc, getDoc, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref as rtRef, push as rtPush
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { modal, toast, tap, avatarHTML, escapeHTML } from "./app.js";

// ─── Game types registry ──────────────────────────────
export const GAME_TYPES = {
  tictactoe: {
    name: "Jogo do Galo",
    icon: "🎯",
    sub: "3 em linha",
    initialState: () => ({ board: Array(9).fill(""), winLine: null }),
  },
  rps: {
    name: "Pedra • Papel • Tesoura",
    icon: "🪨",
    sub: "À melhor de 3",
    initialState: () => ({
      round: 1,
      bestOf: 3,
      wins: { p1: 0, p2: 0 },
      moves: { p1: null, p2: null },
      history: [],
    }),
  },
  connect4: {
    name: "4 em Linha",
    icon: "🧩",
    sub: "Grelha 7×6",
    initialState: () => ({ board: Array.from({ length: 6 }, () => Array(7).fill(0)), winCells: null }),
  },
};

let ME = null;
let PROFILE = null;
let ONLINE_USERS_REF = null;

// Tracks subscriptions per rendered game-msg element to avoid leaks
const ACTIVE_GAME_SUBS = new Map();

// ─── Public API ────────────────────────────────────────
export function bootGames({ me, profile, onlineUsersRef }) {
  ME = me;
  PROFILE = profile;
  ONLINE_USERS_REF = onlineUsersRef;

  const footer = document.querySelector(".chat-footer");
  const sendBtn = document.getElementById("sendBtn");
  if (!footer || !sendBtn || document.getElementById("gamesBtn")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "gamesBtn";
  btn.className = "chat-games-btn tap";
  btn.setAttribute("aria-label", "Jogos");
  btn.setAttribute("title", "Jogos");
  btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="3"/><line x1="7" y1="10" x2="7" y2="14"/><line x1="5" y1="12" x2="9" y2="12"/><circle cx="15" cy="11" r="1"/><circle cx="17" cy="13" r="1"/></svg>`;
  btn.style.cssText = "width:42px;height:42px;border-radius:50%;background:#1a1a1a;border:1px solid var(--border);display:grid;place-items:center;color:var(--text);";

  // Insert right before the stickers button if present, otherwise before send
  const stickerBtn = document.getElementById("stickerBtn");
  footer.insertBefore(btn, stickerBtn || sendBtn);

  btn.addEventListener("click", openGamePicker);
}

// Subscribe a rendered game-msg element to live updates
export function attachGameView(wrapEl, gameId) {
  if (!wrapEl || !gameId) return;
  // Avoid duplicate subscriptions
  if (ACTIVE_GAME_SUBS.has(wrapEl)) return;

  const unsub = onSnapshot(doc(db, "chat_games", gameId), (snap) => {
    if (!snap.exists()) {
      wrapEl.innerHTML = `<div class="game-card game-missing">Este jogo já não existe.</div>`;
      return;
    }
    const g = snap.data();
    g._id = snap.id;
    renderGameCard(wrapEl, g);
  }, (err) => {
    console.warn("game snapshot error:", err);
    wrapEl.innerHTML = `<div class="game-card game-missing">Erro a carregar o jogo.</div>`;
  });

  ACTIVE_GAME_SUBS.set(wrapEl, unsub);

  // Cleanup if node removed
  const mo = new MutationObserver(() => {
    if (!document.body.contains(wrapEl)) {
      try { unsub(); } catch {}
      ACTIVE_GAME_SUBS.delete(wrapEl);
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
}

// ─── Game picker ───────────────────────────────────────
function openGamePicker() {
  tap();
  const body = `
    <div class="games-picker">
      ${Object.entries(GAME_TYPES).map(([id, g]) => `
        <button class="game-choice" data-gid="${id}">
          <div class="game-choice-emoji">${g.icon || "🎮"}</div>
          <div class="game-choice-body">
            <div class="game-choice-name">${g.emoji} ${escapeHTML(g.name)}</div>
            <div class="game-choice-sub">${escapeHTML(g.sub)}</div>
          </div>
          <div class="game-choice-arrow">▶️</div>
        </button>
      `).join("")}
    </div>
  `;
  modal({
    title: "🎮 Escolhe um jogo",
    bodyHTML: body,
    confirmLabel: "Cancelar",
    onOpen: (root, wrap) => {
      root.querySelectorAll(".game-choice").forEach(b => {
        b.addEventListener("click", () => {
          const gid = b.dataset.gid;
          wrap.remove();
          openOpponentPicker(gid);
        });
      });
    }
  });
}

// ─── Opponent picker ───────────────────────────────────
function openOpponentPicker(gameType) {
  const online = ONLINE_USERS_REF?.() || {};
  const entries = Object.entries(online).filter(([uid]) => uid !== ME.uid);

  let body;
  if (!entries.length) {
    body = `<div class="empty" style="padding:24px;text-align:center;color:var(--muted);">😕 Ninguém online para jogar de momento.</div>`;
  } else {
    body = `
      <div style="font-size:12px;color:var(--muted);padding:0 0 8px;">🎯 Escolhe o teu adversário (só jogadores online):</div>
      <div class="opp-list">
        ${entries.map(([uid, u]) => `
          <button class="opp-row" data-uid="${escapeHTML(uid)}" data-name="${escapeHTML(u.name || "")}" data-username="${escapeHTML(u.username || "")}" data-photo="${escapeHTML(u.photoURL || "")}">
            <div style="width:36px;height:36px;border-radius:50%;overflow:hidden;flex-shrink:0;">${avatarHTML({ photoURL: u.photoURL, name: u.name, username: u.username }, 36)}</div>
            <div style="flex:1;min-width:0;text-align:left;">
              <div style="font-weight:700;font-size:13px;">${escapeHTML(u.name || "—")}</div>
              <div style="color:var(--muted);font-size:11px;">@${escapeHTML(u.username || "")}</div>
            </div>
            <span class="dm-online-dot" title="Online"></span>
          </button>
        `).join("")}
      </div>
    `;
  }

  modal({
    title: `⚔️ VS quem? (${GAME_TYPES[gameType].name})`,
    bodyHTML: body,
    confirmLabel: "Cancelar",
    onOpen: (root, wrap) => {
      root.querySelectorAll(".opp-row").forEach(b => {
        b.addEventListener("click", async () => {
          const opponent = {
            uid: b.dataset.uid,
            name: b.dataset.name,
            username: b.dataset.username,
            photoURL: b.dataset.photo,
          };
          wrap.remove();
          await createGame(gameType, opponent);
        });
      });
    }
  });
}

// ─── Create game ───────────────────────────────────────
async function createGame(gameType, opp) {
  if (!GAME_TYPES[gameType]) return;
  try {
    tap();
    const p1 = {
      uid: ME.uid,
      name: PROFILE.name || "",
      username: PROFILE.username || "",
      photoURL: PROFILE.photoURL || "",
    };
    const p2 = opp;

    // Create the game document with a generated id (use doc() + setDoc)
    const gameRef = doc(db, "chat_games", crypto.randomUUID());
    const base = GAME_TYPES[gameType].initialState();
    await setDoc(gameRef, {
      type: gameType,
      p1, p2,
      state: base,
      turn: "p1",
      status: "active",
      winner: null,
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Push a chat message linking the game
    await rtPush(rtRef(rtdb, "chat/messages"), {
      uid: ME.uid,
      name: PROFILE.name,
      username: PROFILE.username,
      photoURL: PROFILE.photoURL || "",
      isAdmin: !!PROFILE.isAdmin,
      role: PROFILE.role || "user",
      nameColor: PROFILE.nameColor || "",
      nameStyle: PROFILE.nameStyle || "",
      type: "game",
      gameId: gameRef.id,
      gameType,
      gameTitle: `${p1.name} vs ${p2.name}`,
      at: Date.now(),
    });

    toast("🎮 Jogo criado!", "success");
  } catch (err) {
    console.error(err);
    toast("Erro a criar jogo: " + err.message, "error");
  }
}

// ─── Render game card ──────────────────────────────────
function renderGameCard(wrapEl, g) {
  const { p1, p2, type, state, turn, status, winner } = g;
  const amP1 = ME.uid === p1.uid;
  const amP2 = ME.uid === p2.uid;
  const isPlayer = amP1 || amP2;
  const myTurn = (turn === "p1" && amP1) || (turn === "p2" && amP2);
  const meta = GAME_TYPES[type] || { name: type };

  const headerHTML = `
    <div class="game-head">
      <div class="game-players">
        <div class="gp gp1 ${turn === "p1" && status === "active" ? "gp-turn" : ""}">
          <div class="gp-avatar">${avatarHTML(p1, 28)}</div>
          <div class="gp-name">${escapeHTML(p1.name || "—")}</div>
        </div>
        <div class="gp-vs">vs</div>
        <div class="gp gp2 ${turn === "p2" && status === "active" ? "gp-turn" : ""}">
          <div class="gp-avatar">${avatarHTML(p2, 28)}</div>
          <div class="gp-name">${escapeHTML(p2.name || "—")}</div>
        </div>
      </div>
      <div class="game-title">${meta.icon || "🎮"} ${meta.emoji || ""} ${escapeHTML(meta.name || type)}</div>
    </div>
  `;

  let bodyHTML = "";
  if (type === "tictactoe") bodyHTML = renderTicTacToe(g, { amP1, amP2, myTurn, isPlayer });
  else if (type === "rps") bodyHTML = renderRPS(g, { amP1, amP2, isPlayer });
  else if (type === "connect4") bodyHTML = renderConnect4(g, { amP1, amP2, myTurn, isPlayer });
  else bodyHTML = `<div style="padding:14px;color:var(--muted);">Jogo desconhecido.</div>`;

  const footerHTML = renderGameFooter(g, { isPlayer, amP1, amP2 });

  wrapEl.classList.add("game-card");
  wrapEl.innerHTML = `${headerHTML}${bodyHTML}${footerHTML}`;

  // Wire moves (only for players)
  if (status === "active" && isPlayer) {
    if (type === "tictactoe") wireTicTacToeMoves(wrapEl, g, amP1, amP2);
    else if (type === "rps") wireRPSMoves(wrapEl, g, amP1, amP2);
    else if (type === "connect4") wireConnect4Moves(wrapEl, g, amP1, amP2);
  }
}

function renderGameFooter(g, { isPlayer, amP1, amP2 }) {
  const { p1, p2, status, winner, turn } = g;
  if (status === "finished") {
    if (winner === "draw") return `<div class="game-foot game-foot-draw">🤝 Empate! 🤝</div>`;
    const w = winner === "p1" ? p1 : p2;
    const youWon = (winner === "p1" && amP1) || (winner === "p2" && amP2);
    return `<div class="game-foot ${youWon ? "game-foot-win" : "game-foot-end"}">🏆 <strong>${escapeHTML(w.name || "—")}</strong> venceu${youWon ? " — parabéns! 🎉" : " 👏"}</div>`;
  }
  if (!isPlayer) {
    return `<div class="game-foot game-foot-spec">👀 Estás a assistir 🍿</div>`;
  }
  const myTurn = (turn === "p1" && amP1) || (turn === "p2" && amP2);
  return `<div class="game-foot ${myTurn ? "game-foot-mine" : "game-foot-wait"}">${myTurn ? "👉 É a tua vez! ✨" : "⏳ A aguardar adversário…"}</div>`;
}

// ─── Tic-Tac-Toe ───────────────────────────────────────
const TTT_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];
function tttCheckWin(board) {
  for (const line of TTT_LINES) {
    const [a,b,c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  if (board.every(c => c)) return { winner: "draw", line: null };
  return null;
}
function renderTicTacToe(g, { amP1, amP2, myTurn, isPlayer }) {
  const board = g.state?.board || Array(9).fill("");
  const winLine = g.state?.winLine;
  return `
    <div class="ttt-board" ${(!isPlayer || !myTurn || g.status !== "active") ? 'data-locked="1"' : ""}>
      ${board.map((c, i) => `
        <button class="ttt-cell ${c ? "ttt-filled ttt-" + c : ""} ${winLine && winLine.includes(i) ? "ttt-win" : ""}" data-i="${i}" ${c || g.status !== "active" ? "disabled" : ""}>
          ${c === "x" ? `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="3" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>` :
            c === "o" ? `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7dd3fc" stroke-width="3"><circle cx="12" cy="12" r="7"/></svg>` : ""}
        </button>
      `).join("")}
    </div>
    <div class="game-hint">${amP1 ? "🫵 Jogas com ❌" : amP2 ? "🫵 Jogas com ⭕" : "❌ P1 · ⭕ P2"}</div>
  `;
}
function wireTicTacToeMoves(wrapEl, g, amP1, amP2) {
  const board = g.state?.board || Array(9).fill("");
  wrapEl.querySelectorAll(".ttt-cell").forEach(btn => {
    if (btn.disabled) return;
    btn.addEventListener("click", async () => {
      const i = Number(btn.dataset.i);
      if (board[i]) return;
      const myMark = amP1 ? "x" : "o";
      const isMyTurn = (g.turn === "p1" && amP1) || (g.turn === "p2" && amP2);
      if (!isMyTurn) { toast("Não é a tua vez", "error"); return; }
      tap();
      try {
        await runTransaction(db, async (tx) => {
          const ref = doc(db, "chat_games", g._id);
          const snap = await tx.get(ref);
          if (!snap.exists()) throw new Error("Jogo não encontrado");
          const cur = snap.data();
          if (cur.status !== "active") throw new Error("Jogo terminado");
          const myTurnNow = (cur.turn === "p1" && amP1) || (cur.turn === "p2" && amP2);
          if (!myTurnNow) throw new Error("Não é a tua vez");
          const b = [...(cur.state?.board || Array(9).fill(""))];
          if (b[i]) throw new Error("Casa ocupada");
          b[i] = myMark;
          const res = tttCheckWin(b);
          const update = {
            "state.board": b,
            updatedAt: serverTimestamp(),
          };
          if (res) {
            update.status = "finished";
            if (res.winner === "draw") update.winner = "draw";
            else update.winner = res.winner === "x" ? "p1" : "p2";
            update["state.winLine"] = res.line;
            update.finishedAt = serverTimestamp();
          } else {
            update.turn = cur.turn === "p1" ? "p2" : "p1";
          }
          tx.update(ref, update);
        });
      } catch (err) {
        toast("Erro: " + err.message, "error");
      }
    });
  });
}

// ─── Rock-Paper-Scissors ───────────────────────────────
function renderRPS(g, { amP1, amP2, isPlayer }) {
  const st = g.state || {};
  const moves = st.moves || { p1: null, p2: null };
  const wins = st.wins || { p1: 0, p2: 0 };
  const round = st.round || 1;
  const bestOf = st.bestOf || 3;
  const myMark = amP1 ? "p1" : amP2 ? "p2" : null;
  const opMark = amP1 ? "p2" : amP2 ? "p1" : null;

  const myMove = myMark ? moves[myMark] : null;
  const oppMove = opMark ? moves[opMark] : null;
  const waitingOpp = !!myMove && !oppMove;
  const waitingMe = !myMove && !!oppMove;
  const bothPicked = !!myMove && !!oppMove;

  const statusText = g.status === "finished"
    ? `🏁 Terminado`
    : `🎯 Ronda ${round}/${bestOf} · Placar <strong>${wins.p1}</strong> – <strong>${wins.p2}</strong>`;

  const lastRound = Array.isArray(st.history) && st.history.length ? st.history[st.history.length - 1] : null;
  const lastRoundHTML = lastRound ? `
    <div class="rps-lastround">
      🔁 Ronda anterior: <strong>${rpsEmoji(lastRound.p1)}</strong> vs <strong>${rpsEmoji(lastRound.p2)}</strong> →
      ${lastRound.winner === "draw" ? "🤝 Empate" : "🏆 " + (lastRound.winner === "p1" ? escapeHTML(g.p1.name) : escapeHTML(g.p2.name))}
    </div>` : "";

  let mainHTML;
  if (g.status === "finished") {
    mainHTML = `<div class="rps-done">Placar final: <strong>${wins.p1}</strong>–<strong>${wins.p2}</strong></div>`;
  } else if (!isPlayer) {
    mainHTML = `<div class="rps-spec">
      <div class="rps-side">${rpsSideLabel(g.p1, moves.p1, false)}</div>
      <div class="rps-vs-big">vs</div>
      <div class="rps-side">${rpsSideLabel(g.p2, moves.p2, false)}</div>
    </div>`;
  } else {
    mainHTML = `
      <div class="rps-me">
        ${myMove
          ? `<div class="rps-locked">🔒 Escolheste <strong>${rpsEmoji(myMove)}</strong></div>`
          : `<div class="rps-pick-row">
              <button class="rps-pick" data-m="rock"     title="Pedra">✊</button>
              <button class="rps-pick" data-m="paper"    title="Papel">✋</button>
              <button class="rps-pick" data-m="scissors" title="Tesoura">✌️</button>
            </div>`}
      </div>
      <div class="rps-status-line">
        ${bothPicked ? "✨ A revelar…"
          : waitingOpp ? `⏳ À espera de ${escapeHTML(amP1 ? g.p2.name : g.p1.name)}…`
          : waitingMe ? `⚡ ${escapeHTML(amP1 ? g.p2.name : g.p1.name)} já jogou — tua vez!`
          : "👇 Escolhe o teu movimento"}
      </div>
    `;
  }

  return `
    <div class="rps-body">
      <div class="rps-header">${statusText}</div>
      ${mainHTML}
      ${lastRoundHTML}
    </div>
  `;
}
function rpsEmoji(m) {
  return m === "rock" ? "✊" : m === "paper" ? "✋" : m === "scissors" ? "✌️" : "?";
}
function rpsSideLabel(p, move, reveal) {
  const showMove = reveal && move ? rpsEmoji(move) : (move ? "🔒" : "…");
  return `<div style="text-align:center;">
    <div style="font-size:24px;">${showMove}</div>
    <div style="font-size:11px;color:var(--muted);margin-top:2px;">${escapeHTML(p.name || "—")}</div>
  </div>`;
}
function rpsDecideRound(a, b) {
  if (a === b) return "draw";
  if ((a === "rock" && b === "scissors") ||
      (a === "paper" && b === "rock") ||
      (a === "scissors" && b === "paper")) return "p1";
  return "p2";
}
function wireRPSMoves(wrapEl, g, amP1, amP2) {
  const myMark = amP1 ? "p1" : "p2";
  wrapEl.querySelectorAll(".rps-pick").forEach(btn => {
    btn.addEventListener("click", async () => {
      const m = btn.dataset.m;
      tap();
      try {
        await runTransaction(db, async (tx) => {
          const ref = doc(db, "chat_games", g._id);
          const snap = await tx.get(ref);
          if (!snap.exists()) throw new Error("Jogo não encontrado");
          const cur = snap.data();
          if (cur.status !== "active") throw new Error("Jogo terminado");
          const st = cur.state || {};
          const moves = { ...(st.moves || {}) };
          if (moves[myMark]) throw new Error("Já escolheste");
          moves[myMark] = m;

          const update = { updatedAt: serverTimestamp() };

          if (moves.p1 && moves.p2) {
            // Resolve round
            const w = rpsDecideRound(moves.p1, moves.p2); // "p1"|"p2"|"draw"
            const wins = { ...(st.wins || { p1: 0, p2: 0 }) };
            if (w === "p1") wins.p1++; else if (w === "p2") wins.p2++;
            const history = [...(st.history || []), { p1: moves.p1, p2: moves.p2, winner: w }];
            const round = (st.round || 1) + 1;
            const bestOf = st.bestOf || 3;
            const needed = Math.ceil(bestOf / 2);
            const finished = wins.p1 >= needed || wins.p2 >= needed || round > bestOf;

            update["state.moves"] = { p1: null, p2: null };
            update["state.wins"] = wins;
            update["state.history"] = history;
            update["state.round"] = finished ? (round - 1) : round;

            if (finished) {
              update.status = "finished";
              update.winner = wins.p1 > wins.p2 ? "p1" : wins.p2 > wins.p1 ? "p2" : "draw";
              update.finishedAt = serverTimestamp();
            }
          } else {
            update["state.moves"] = moves;
          }

          tx.update(ref, update);
        });
      } catch (err) {
        toast("Erro: " + err.message, "error");
      }
    });
  });
}

// ─── Connect 4 ─────────────────────────────────────────
const C4_ROWS = 6, C4_COLS = 7;
function c4CheckWin(board, lastR, lastC, player) {
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (const [dr, dc] of dirs) {
    const cells = [[lastR, lastC]];
    // walk positive
    let r = lastR + dr, c = lastC + dc;
    while (r >= 0 && r < C4_ROWS && c >= 0 && c < C4_COLS && board[r][c] === player) {
      cells.push([r, c]); r += dr; c += dc;
    }
    // walk negative
    r = lastR - dr; c = lastC - dc;
    while (r >= 0 && r < C4_ROWS && c >= 0 && c < C4_COLS && board[r][c] === player) {
      cells.unshift([r, c]); r -= dr; c -= dc;
    }
    if (cells.length >= 4) return cells.slice(0, 4);
  }
  return null;
}
function c4IsFull(board) {
  return board.every(row => row.every(v => v !== 0));
}
function renderConnect4(g, { amP1, amP2, myTurn, isPlayer }) {
  const board = g.state?.board || Array.from({ length: C4_ROWS }, () => Array(C4_COLS).fill(0));
  const winCells = g.state?.winCells || null;
  const canPlay = isPlayer && myTurn && g.status === "active";

  // Top row = column selectors
  const topRow = Array.from({ length: C4_COLS }, (_, c) => {
    const colFull = board[0][c] !== 0;
    return `<button class="c4-col-btn" data-c="${c}" ${canPlay && !colFull ? "" : "disabled"}>▼</button>`;
  }).join("");

  const cells = [];
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      const v = board[r][c];
      const isWin = winCells && winCells.some(([wr, wc]) => wr === r && wc === c);
      cells.push(`<div class="c4-cell ${v === 1 ? "c4-p1" : v === 2 ? "c4-p2" : ""} ${isWin ? "c4-win" : ""}"></div>`);
    }
  }

  return `
    <div class="c4-wrap">
      <div class="c4-cols">${topRow}</div>
      <div class="c4-grid">${cells.join("")}</div>
      <div class="game-hint">${amP1 ? "🫵 Jogas com 🔴" : amP2 ? "🫵 Jogas com 🟡" : "🔴 P1 · 🟡 P2"}</div>
    </div>
  `;
}
function wireConnect4Moves(wrapEl, g, amP1, amP2) {
  const board = (g.state?.board || []).map(row => row.slice());
  const player = amP1 ? 1 : 2;
  wrapEl.querySelectorAll(".c4-col-btn").forEach(btn => {
    if (btn.disabled) return;
    btn.addEventListener("click", async () => {
      const col = Number(btn.dataset.c);
      tap();
      try {
        await runTransaction(db, async (tx) => {
          const ref = doc(db, "chat_games", g._id);
          const snap = await tx.get(ref);
          if (!snap.exists()) throw new Error("Jogo não encontrado");
          const cur = snap.data();
          if (cur.status !== "active") throw new Error("Jogo terminado");
          const myTurnNow = (cur.turn === "p1" && amP1) || (cur.turn === "p2" && amP2);
          if (!myTurnNow) throw new Error("Não é a tua vez");

          const b = (cur.state?.board || []).map(row => row.slice());
          // Drop into first empty row from bottom
          let landedRow = -1;
          for (let r = C4_ROWS - 1; r >= 0; r--) {
            if (b[r][col] === 0) { b[r][col] = player; landedRow = r; break; }
          }
          if (landedRow === -1) throw new Error("Coluna cheia");

          const winCells = c4CheckWin(b, landedRow, col, player);
          const update = {
            "state.board": b,
            updatedAt: serverTimestamp(),
          };
          if (winCells) {
            update.status = "finished";
            update.winner = player === 1 ? "p1" : "p2";
            update["state.winCells"] = winCells;
            update.finishedAt = serverTimestamp();
          } else if (c4IsFull(b)) {
            update.status = "finished";
            update.winner = "draw";
            update.finishedAt = serverTimestamp();
          } else {
            update.turn = cur.turn === "p1" ? "p2" : "p1";
          }
          tx.update(ref, update);
        });
      } catch (err) {
        toast("Erro: " + err.message, "error");
      }
    });
  });
}
