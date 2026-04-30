import React, { useEffect, useMemo, useRef, useState } from "react";
import { collection, addDoc, deleteDoc, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp as fsServerTimestamp, setDoc } from "firebase/firestore";
import { limitToLast, onChildAdded, onChildChanged, onChildRemoved, onDisconnect, onValue, push, query as rtQuery, ref, remove, set, update } from "firebase/database";
import { Edit3, Gamepad2, Smile, Trash2, Upload } from "lucide-react";
import { AppHeader, BottomNav, GradientDefs, HeaderUsersButton, PageFrame, SendIcon } from "../components/Shell.jsx";
import { SheetModal } from "../components/Modal.jsx";
import { useKeyboardViewport } from "../hooks/useKeyboardViewport.js";
import { useAuthProfile } from "../lib/auth.js";
import { db, rtdb } from "../lib/firebase.js";
import { routeTo } from "../lib/navigation.js";
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

function useChatMessages(user) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) {
      setMessages([]);
      setLoading(true);
      return undefined;
    }
    setLoading(true);
    const messagesRef = rtQuery(ref(rtdb, "chat/messages"), limitToLast(1000));
    const byId = new Map();
    const publish = () => {
      setMessages([...byId.values()].sort((a, b) => (a.at || 0) - (b.at || 0)));
    };
    const handleError = (err) => {
      toast(`Erro no chat: ${err.message}`, "error");
      setLoading(false);
    };
    const unsubAdded = onChildAdded(messagesRef, (snap) => {
      if (snap.exists()) byId.set(snap.key, { id: snap.key, ...snap.val() });
      publish();
    }, handleError);
    const unsubChanged = onChildChanged(messagesRef, (snap) => {
      if (snap.exists()) byId.set(snap.key, { id: snap.key, ...snap.val() });
      publish();
    }, handleError);
    const unsubRemoved = onChildRemoved(messagesRef, (snap) => {
      byId.delete(snap.key);
      publish();
    }, handleError);
    const unsubReady = onValue(messagesRef, () => setLoading(false), handleError, { onlyOnce: true });
    return () => {
      unsubAdded();
      unsubChanged();
      unsubRemoved();
      unsubReady();
    };
  }, [user?.uid]);

  return { messages, loading };
}

const GAME_TYPES = {
  tictactoe: {
    name: "Jogo do Galo",
    sub: "3 em linha",
    icon: "XO",
    initialState: () => ({ board: Array(9).fill(""), winLine: null })
  },
  rps: {
    name: "Pedra, Papel, Tesoura",
    sub: "A melhor de 3",
    icon: "RPS",
    initialState: () => ({ round: 1, bestOf: 3, wins: { p1: 0, p2: 0 }, moves: { p1: null, p2: null }, history: [] })
  },
  connect4: {
    name: "4 em Linha",
    sub: "Grelha 7x6",
    icon: "4",
    initialState: () => ({ board: Array.from({ length: 6 }, () => Array(7).fill(0)), winCells: null })
  }
};

const TTT_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];

function playerSlot(game, uid) {
  if (game?.p1?.uid === uid) return "p1";
  if (game?.p2?.uid === uid) return "p2";
  return null;
}

function winnerName(game) {
  if (game?.winner === "p1") return game.p1?.name || "P1";
  if (game?.winner === "p2") return game.p2?.name || "P2";
  if (game?.winner === "draw") return "Empate";
  return "";
}

function ticTacToeResult(board) {
  for (const line of TTT_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a] === "x" ? "p1" : "p2", line };
    }
  }
  if (board.every(Boolean)) return { winner: "draw", line: null };
  return { winner: null, line: null };
}

function rpsResult(p1, p2) {
  if (p1 === p2) return "draw";
  if (
    (p1 === "rock" && p2 === "scissors") ||
    (p1 === "paper" && p2 === "rock") ||
    (p1 === "scissors" && p2 === "paper")
  ) return "p1";
  return "p2";
}

function rpsLabel(choice) {
  return { rock: "Pedra", paper: "Papel", scissors: "Tesoura" }[choice] || "?";
}

function connect4Result(board) {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];
  for (let r = 0; r < 6; r += 1) {
    for (let c = 0; c < 7; c += 1) {
      const value = board[r]?.[c];
      if (!value) continue;
      for (const [dr, dc] of directions) {
        const cells = [[r, c]];
        for (let step = 1; step < 4; step += 1) {
          const nr = r + dr * step;
          const nc = c + dc * step;
          if (nr < 0 || nr >= 6 || nc < 0 || nc >= 7 || board[nr]?.[nc] !== value) break;
          cells.push([nr, nc]);
        }
        if (cells.length === 4) return { winner: value === 1 ? "p1" : "p2", cells };
      }
    }
  }
  if (board.every((row) => row.every(Boolean))) return { winner: "draw", cells: null };
  return { winner: null, cells: null };
}

function GamePicker({ user, profile, onlineUsers, onClose }) {
  const [gameType, setGameType] = useState(null);
  const opponents = onlineUsers.filter(([uid]) => uid !== user.uid);

  const createGame = async (opponent) => {
    if (!gameType || !GAME_TYPES[gameType]) return;
    try {
      const gameRef = doc(collection(db, "chat_games"));
      const p1 = {
        uid: user.uid,
        name: profile.name || "",
        username: profile.username || "",
        photoURL: profile.photoURL || ""
      };
      const p2 = {
        uid: opponent[0],
        name: opponent[1]?.name || "",
        username: opponent[1]?.username || "",
        photoURL: opponent[1]?.photoURL || ""
      };
      await setDoc(gameRef, {
        type: gameType,
        p1,
        p2,
        state: GAME_TYPES[gameType].initialState(),
        turn: "p1",
        status: "active",
        winner: null,
        startedAt: fsServerTimestamp(),
        updatedAt: fsServerTimestamp()
      });
      await push(ref(rtdb, "chat/messages"), {
        uid: user.uid,
        name: profile.name,
        username: profile.username,
        photoURL: profile.photoURL || "",
        isAdmin: !!profile.isAdmin,
        role: profile.role || "user",
        nameColor: profile.nameColor || "",
        nameStyle: profile.nameStyle || "",
        type: "game",
        gameId: gameRef.id,
        gameType,
        gameTitle: `${p1.name} vs ${p2.name}`,
        at: Date.now()
      });
      toast("Jogo criado!", "success");
      onClose();
    } catch (err) {
      toast(`Erro a criar jogo: ${err.message}`, "error");
    }
  };

  return (
    <SheetModal title={gameType ? `VS quem? (${GAME_TYPES[gameType].name})` : "Jogos"} onClose={onClose}>
      {!gameType ? (
        <div className="games-picker">
          {Object.entries(GAME_TYPES).map(([id, game]) => (
            <button className="game-choice" type="button" key={id} onClick={() => setGameType(id)}>
              <div className="game-choice-emoji">{game.icon}</div>
              <div className="game-choice-body">
                <div className="game-choice-name">{game.name}</div>
                <div className="game-choice-sub">{game.sub}</div>
              </div>
              <div className="game-choice-arrow">&gt;</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="opp-list">
          {opponents.length ? opponents.map((entry) => {
            const [, item] = entry;
            return (
              <button className="opp-row" type="button" key={entry[0]} onClick={() => createGame(entry)}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}>
                  <Avatar user={item} size={36} />
                </div>
                <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{item.name || "User"}</div>
                  <div style={{ color: "var(--muted)", fontSize: 11 }}>@{item.username || ""}</div>
                </div>
                <span className="dm-online-dot" title="Online" />
              </button>
            );
          }) : (
            <div className="empty" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Ninguem online para jogar de momento.</div>
          )}
        </div>
      )}
    </SheetModal>
  );
}

function GameHeader({ game }) {
  const meta = GAME_TYPES[game.type] || { name: game.type || "Jogo" };
  return (
    <div className="game-head">
      <div className="game-players">
        <div className={`gp gp1 ${game.turn === "p1" && game.status === "active" ? "gp-turn" : ""}`}>
          <div className="gp-avatar"><Avatar user={game.p1} size={28} /></div>
          <div className="gp-name">{game.p1?.name || "P1"}</div>
        </div>
        <div className="gp-vs">vs</div>
        <div className={`gp gp2 ${game.turn === "p2" && game.status === "active" ? "gp-turn" : ""}`}>
          <div className="gp-avatar"><Avatar user={game.p2} size={28} /></div>
          <div className="gp-name">{game.p2?.name || "P2"}</div>
        </div>
      </div>
      <div className="game-title">{meta.name}</div>
      <div className="game-status">{game.status === "done" ? `Resultado: ${winnerName(game)}` : `Vez de ${game.turn === "p1" ? game.p1?.name || "P1" : game.p2?.name || "P2"}`}</div>
    </div>
  );
}

function GameMessage({ gameId, user }) {
  const [game, setGame] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!gameId) return undefined;
    return onSnapshot(doc(db, "chat_games", gameId), (snap) => {
      if (!snap.exists()) {
        setMissing(true);
        setGame(null);
        return;
      }
      setMissing(false);
      setGame({ id: snap.id, ...snap.data() });
    }, () => {
      setMissing(true);
      setGame(null);
    });
  }, [gameId]);

  if (missing) return <div className="game-card game-missing">Este jogo ja nao existe.</div>;
  if (!game) return <div className="game-card game-loading">A carregar jogo...</div>;

  return (
    <div className="game-card">
      <GameHeader game={game} />
      {game.type === "tictactoe" ? <TicTacToeGame game={game} user={user} /> : null}
      {game.type === "rps" ? <RpsGame game={game} user={user} /> : null}
      {game.type === "connect4" ? <Connect4Game game={game} user={user} /> : null}
    </div>
  );
}

function TicTacToeGame({ game, user }) {
  const slot = playerSlot(game, user.uid);
  const myTurn = slot && game.turn === slot && game.status === "active";
  const board = Array.isArray(game.state?.board) ? game.state.board : Array(9).fill("");
  const winLine = game.state?.winLine || [];

  const play = async (index) => {
    if (!myTurn || board[index]) return;
    try {
      await runTransaction(db, async (tx) => {
        const gameRef = doc(db, "chat_games", game.id);
        const snap = await tx.get(gameRef);
        if (!snap.exists()) return;
        const fresh = snap.data();
        const freshSlot = playerSlot(fresh, user.uid);
        if (!freshSlot || fresh.turn !== freshSlot || fresh.status !== "active") return;
        const nextBoard = [...(fresh.state?.board || Array(9).fill(""))];
        if (nextBoard[index]) return;
        nextBoard[index] = freshSlot === "p1" ? "x" : "o";
        const result = ticTacToeResult(nextBoard);
        tx.update(gameRef, {
          state: { ...(fresh.state || {}), board: nextBoard, winLine: result.line },
          turn: freshSlot === "p1" ? "p2" : "p1",
          status: result.winner ? "done" : "active",
          winner: result.winner,
          updatedAt: fsServerTimestamp()
        });
      });
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  return (
    <>
      <div className="ttt-board" data-locked={!myTurn ? "1" : undefined}>
        {board.map((cell, index) => (
          <button key={index} className={`ttt-cell ${cell ? `ttt-filled ttt-${cell}` : ""} ${winLine?.includes(index) ? "ttt-win" : ""}`} type="button" disabled={!!cell || game.status !== "active"} onClick={() => play(index)}>
            {cell === "x" ? "X" : cell === "o" ? "O" : ""}
          </button>
        ))}
      </div>
      <div className="game-hint">{slot === "p1" ? "Jogas com X" : slot === "p2" ? "Jogas com O" : "X P1 · O P2"}</div>
    </>
  );
}

function RpsGame({ game, user }) {
  const slot = playerSlot(game, user.uid);
  const state = game.state || {};
  const moves = state.moves || {};
  const myMove = slot ? moves[slot] : null;
  const canPick = slot && !myMove && game.status === "active";

  const pick = async (choice) => {
    if (!canPick) return;
    try {
      await runTransaction(db, async (tx) => {
        const gameRef = doc(db, "chat_games", game.id);
        const snap = await tx.get(gameRef);
        if (!snap.exists()) return;
        const fresh = snap.data();
        const freshSlot = playerSlot(fresh, user.uid);
        const freshState = fresh.state || {};
        const freshMoves = { ...(freshState.moves || {}) };
        if (!freshSlot || fresh.status !== "active" || freshMoves[freshSlot]) return;
        freshMoves[freshSlot] = choice;
        const wins = { p1: freshState.wins?.p1 || 0, p2: freshState.wins?.p2 || 0 };
        const history = Array.isArray(freshState.history) ? [...freshState.history] : [];
        let winner = null;
        let status = "active";
        let nextMoves = freshMoves;
        let round = freshState.round || 1;
        if (freshMoves.p1 && freshMoves.p2) {
          const result = rpsResult(freshMoves.p1, freshMoves.p2);
          if (result === "p1") wins.p1 += 1;
          if (result === "p2") wins.p2 += 1;
          history.push({ round, p1: freshMoves.p1, p2: freshMoves.p2, result });
          if (wins.p1 >= 2 || wins.p2 >= 2) {
            status = "done";
            winner = wins.p1 > wins.p2 ? "p1" : "p2";
          } else {
            round += 1;
            nextMoves = { p1: null, p2: null };
          }
        }
        tx.update(gameRef, {
          state: { ...freshState, moves: nextMoves, wins, history, round },
          status,
          winner,
          updatedAt: fsServerTimestamp()
        });
      });
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  const last = Array.isArray(state.history) ? state.history[state.history.length - 1] : null;
  return (
    <div className="rps-body">
      <div className="rps-header">Ronda {state.round || 1} - {state.wins?.p1 || 0} - {state.wins?.p2 || 0}</div>
      {canPick ? (
        <div className="rps-pick-row">
          <button className="rps-pick" type="button" title="Pedra" onClick={() => pick("rock")}>R</button>
          <button className="rps-pick" type="button" title="Papel" onClick={() => pick("paper")}>P</button>
          <button className="rps-pick" type="button" title="Tesoura" onClick={() => pick("scissors")}>T</button>
        </div>
      ) : (
        <div className="rps-locked">{slot ? (myMove ? `Escolheste ${rpsLabel(myMove)}` : "Espera pela tua vez") : "Modo espectador"}</div>
      )}
      <div className="rps-status-line">
        {moves.p1 ? "P1 pronto" : "P1 a escolher"} - {moves.p2 ? "P2 pronto" : "P2 a escolher"}
      </div>
      {last ? <div className="rps-lastround">Ultima: {rpsLabel(last.p1)} vs {rpsLabel(last.p2)}</div> : null}
    </div>
  );
}

function Connect4Game({ game, user }) {
  const slot = playerSlot(game, user.uid);
  const myTurn = slot && game.turn === slot && game.status === "active";
  const myValue = slot === "p1" ? 1 : 2;
  const board = Array.isArray(game.state?.board) ? game.state.board : Array.from({ length: 6 }, () => Array(7).fill(0));
  const winCells = game.state?.winCells || [];
  const isWinCell = (r, c) => winCells?.some?.(([wr, wc]) => wr === r && wc === c);

  const drop = async (col) => {
    if (!myTurn) return;
    try {
      await runTransaction(db, async (tx) => {
        const gameRef = doc(db, "chat_games", game.id);
        const snap = await tx.get(gameRef);
        if (!snap.exists()) return;
        const fresh = snap.data();
        const freshSlot = playerSlot(fresh, user.uid);
        if (!freshSlot || fresh.turn !== freshSlot || fresh.status !== "active") return;
        const value = freshSlot === "p1" ? 1 : 2;
        const nextBoard = (fresh.state?.board || Array.from({ length: 6 }, () => Array(7).fill(0))).map((row) => [...row]);
        let row = -1;
        for (let r = 5; r >= 0; r -= 1) {
          if (!nextBoard[r][col]) {
            row = r;
            break;
          }
        }
        if (row < 0) return;
        nextBoard[row][col] = value;
        const result = connect4Result(nextBoard);
        tx.update(gameRef, {
          state: { ...(fresh.state || {}), board: nextBoard, winCells: result.cells },
          turn: freshSlot === "p1" ? "p2" : "p1",
          status: result.winner ? "done" : "active",
          winner: result.winner,
          updatedAt: fsServerTimestamp()
        });
      });
    } catch (err) {
      toast(`Erro: ${err.message}`, "error");
    }
  };

  return (
    <div className="c4-wrap">
      <div className="c4-cols">
        {Array.from({ length: 7 }).map((_, col) => (
          <button key={col} className="c4-col-btn" type="button" disabled={!myTurn || !!board[0]?.[col]} onClick={() => drop(col)}>v</button>
        ))}
      </div>
      <div className="c4-grid">
        {board.map((row, r) => row.map((cell, c) => (
          <div key={`${r}-${c}`} className={`c4-cell ${cell === 1 ? "c4-p1" : cell === 2 ? "c4-p2" : ""} ${isWinCell(r, c) ? "c4-win" : ""}`} />
        )))}
      </div>
      <div className="game-hint">{slot ? `Tu jogas como P${myValue}` : "Modo espectador"}</div>
    </div>
  );
}

function ChatMessage({ message, previous, user, profile }) {
  const [editing, setEditing] = useState(false);
  const mine = message.uid === user.uid;
  const canDelete = mine || profile?.isAdmin || profile?.role === "mod";
  const canEdit = (mine || profile?.isAdmin) && (!message.type || message.type === "text");
  const timeStr = new Date(message.at || Date.now()).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  const showDay = !previous || new Date(previous.at || 0).toDateString() !== new Date(message.at || Date.now()).toDateString();

  const editMessage = async () => {
    setEditing(true);
  };

  const saveEdit = async (next) => {
    const text = next.trim();
    if (!text || text === message.text) return;
    try {
      await update(ref(rtdb, `chat/messages/${message.id}`), { text, editedAt: Date.now(), editedBy: user.uid });
      setEditing(false);
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

  if (message.type === "game" && message.gameId) {
    const gameMeta = GAME_TYPES[message.gameType] || { name: message.gameType || "jogo" };
    return (
      <>
        {showDay ? <DayDivider ts={message.at} /> : null}
        <div className={`msg game-msg ${mine ? "mine" : ""}`} data-key={message.id}>
          <a href={`./profile.html?u=${encodeURIComponent(message.username || "")}`} className="msg-avatar">
            <Avatar user={author} size={34} />
          </a>
          <div className="msg-body">
            <div className="msg-meta">
              <StyledName user={author} /> <RoleBadges user={author} /> iniciou {gameMeta.name} - {timeStr}
            </div>
            <div className="game-host" data-game-id={message.gameId}>
              <GameMessage gameId={message.gameId} user={user} />
            </div>
            {canDelete ? (
              <button className="msg-delete-btn" type="button" aria-label="Apagar mensagem" title="Apagar" onClick={deleteMessage}>
                <Trash2 size={14} />
              </button>
            ) : null}
          </div>
        </div>
      </>
    );
  }

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
      {editing ? <MessageEditModal initial={message.text || ""} onClose={() => setEditing(false)} onSave={saveEdit} /> : null}
    </>
  );
}

function MessageEditModal({ initial, onClose, onSave }) {
  const [text, setText] = useState(initial);
  return (
    <SheetModal title="Editar mensagem" onClose={onClose}>
      <textarea className="input" rows="4" maxLength="500" value={text} onChange={(event) => setText(event.target.value)} style={{ width: "100%", padding: 12, fontFamily: "inherit" }} />
      <button className="btn-primary" type="button" style={{ width: "100%", marginTop: 10 }} onClick={() => onSave(text)}>Guardar</button>
    </SheetModal>
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

function OnlineUsersModal({ onlineUsers, onClose }) {
  return (
    <SheetModal title={`Online agora (${onlineUsers.length})`} onClose={onClose}>
      <div className="online-users-list">
        {onlineUsers.length ? onlineUsers.map(([uid, item]) => (
          <button className="user-row" type="button" key={uid} onClick={() => routeTo("profile.html", `?u=${encodeURIComponent(item.username || "")}`)}>
            <Avatar user={item} size={34} />
            <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{item.name || "User"}</div>
              <div style={{ color: "var(--muted)", fontSize: 11 }}>@{item.username || ""}</div>
            </div>
            <span className="dm-online-dot" title="Online" />
          </button>
        )) : (
          <div className="empty" style={{ padding: 14 }}>Ninguem online de momento.</div>
        )}
      </div>
    </SheetModal>
  );
}

export function ChatPage() {
  const { loading: authLoading, user, profile, error } = useAuthProfile({ requireUser: true });
  const { messages, loading } = useChatMessages(user);
  const [text, setText] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [gamePickerOpen, setGamePickerOpen] = useState(false);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const didInitialScroll = useRef(false);
  const online = usePresence(user, profile);
  useKeyboardViewport({ enabled: !!user, scrollRef: wrapRef });

  const onlineUsers = useMemo(() => Object.entries(online || {}), [online]);

  const scrollToLatest = () => {
    const node = wrapRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight + 9999;
  };

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 220;
    if (!nearBottom && didInitialScroll.current) return undefined;
    const timers = [0, 60, 180, 420].map((delay) => window.setTimeout(scrollToLatest, delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [messages.length]);

  useEffect(() => {
    if (loading || didInitialScroll.current || !messages.length) return;
    didInitialScroll.current = true;
    const timers = [0, 80, 240, 600].map((delay) => window.setTimeout(scrollToLatest, delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [loading, messages.length]);

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
      requestAnimationFrame(scrollToLatest);
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

  return (
    <PageFrame page="chat.html">
      <GradientDefs />
      <AppHeader
        title="Chat Global"
        right={<HeaderUsersButton onClick={() => setOnlineOpen(true)} />}
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
        <button type="button" className="chat-games-btn tap" aria-label="Jogos" title="Jogos" onClick={() => setGamePickerOpen(true)} style={{ width: 42, height: 42, borderRadius: "50%", background: "#1a1a1a", border: "1px solid var(--border)", display: "grid", placeItems: "center", color: "var(--text)", position: "relative" }}>
          <Gamepad2 size={22} />
        </button>
        <button type="button" className="chat-sticker-btn tap" aria-label="Stickers" onClick={() => setPickerOpen(true)} style={{ width: 42, height: 42, borderRadius: "50%", background: "#1a1a1a", border: "1px solid var(--border)", display: "grid", placeItems: "center", color: "var(--text)" }}>
          <Smile size={22} />
        </button>
        <button className="chat-send" type="button" disabled={!text.trim() || !user || !profile} aria-label="Enviar" onPointerDown={(event) => { event.preventDefault(); sendMessage(); }}>
          <SendIcon />
        </button>
      </footer>
      <BottomNav active="chat.html" />
      {pickerOpen && user && profile ? <StickerPicker user={user} profile={profile} onClose={() => setPickerOpen(false)} onSend={sendSticker} /> : null}
      {gamePickerOpen && user && profile ? <GamePicker user={user} profile={profile} onlineUsers={onlineUsers} onClose={() => setGamePickerOpen(false)} /> : null}
      {onlineOpen ? <OnlineUsersModal onlineUsers={onlineUsers} onClose={() => setOnlineOpen(false)} /> : null}
    </PageFrame>
  );
}
