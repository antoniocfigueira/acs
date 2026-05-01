import React, { useCallback, useEffect, useRef, useState } from "react";
import { doc, increment, serverTimestamp, setDoc } from "firebase/firestore";
import { Battery, ChevronLeft, Coins, Play, RotateCcw, Smartphone, Trophy, Wifi } from "lucide-react";
import { AppHeader, BottomNav, GradientDefs, PageFrame } from "../components/Shell.jsx";
import { useAuthProfile } from "../lib/auth.js";
import { db } from "../lib/firebase.js";
import { toast } from "../lib/ui.jsx";

const GAME_W = 360;
const GAME_H = 560;
const PLAYER_R = 14;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makePlatform(x, y, w = 74, kind = "normal") {
  return { x, y, w, h: 12, kind, press: 0 };
}

function makeInitialState() {
  const platforms = [
    makePlatform(132, 500, 96),
    makePlatform(42, 430, 78),
    makePlatform(220, 356, 82),
    makePlatform(92, 282, 76),
    makePlatform(236, 208, 84),
    makePlatform(52, 134, 72),
    makePlatform(200, 62, 82)
  ];
  return {
    player: { x: GAME_W / 2, y: 462, vx: 0, vy: -10.8 },
    platforms,
    score: 0,
    running: true,
    gameOver: false
  };
}

function nextPlatformY(platforms) {
  return Math.min(...platforms.map((platform) => platform.y)) - (58 + Math.random() * 26);
}

function drawRoundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawGame(ctx, state, tiltReady, started) {
  ctx.clearRect(0, 0, GAME_W, GAME_H);

  const bg = ctx.createLinearGradient(0, 0, 0, GAME_H);
  bg.addColorStop(0, "#151027");
  bg.addColorStop(0.55, "#070b12");
  bg.addColorStop(1, "#050506");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, GAME_W, GAME_H);

  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#70e0ff";
  ctx.lineWidth = 1;
  for (let x = 0; x <= GAME_W; x += 45) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, GAME_H);
    ctx.stroke();
  }
  for (let y = 0; y <= GAME_H; y += 45) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(GAME_W, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  state.platforms.forEach((platform) => {
    const press = platform.press || 0;
    const y = platform.y + press;
    const glow = ctx.createLinearGradient(platform.x, y, platform.x + platform.w, y);
    glow.addColorStop(0, "#a855f7");
    glow.addColorStop(0.55, "#ec4899");
    glow.addColorStop(1, "#7dd3fc");
    ctx.shadowColor = "rgba(236,72,153,.35)";
    ctx.shadowBlur = 14 - Math.min(press, 8);
    ctx.fillStyle = glow;
    drawRoundRect(ctx, platform.x, y, platform.w, platform.h, 8);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,.72)";
    drawRoundRect(ctx, platform.x + 7, y + 2, platform.w - 14, 2, 2);
    ctx.fill();
  });

  const p = state.player;
  const body = ctx.createRadialGradient(p.x - 5, p.y - 7, 3, p.x, p.y, PLAYER_R + 6);
  body.addColorStop(0, "#fff6a0");
  body.addColorStop(0.35, "#ffd54a");
  body.addColorStop(1, "#f59e0b");
  ctx.shadowColor = "rgba(245,158,11,.38)";
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(p.x, p.y, PLAYER_R, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#151515";
  ctx.beginPath();
  ctx.arc(p.x - 5, p.y - 3, 2.3, 0, Math.PI * 2);
  ctx.arc(p.x + 5, p.y - 3, 2.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#151515";
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.arc(p.x, p.y + 3, 5, 0.15, Math.PI - 0.15);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,.92)";
  ctx.font = "800 22px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(`${state.score}`, 18, 34);
  ctx.font = "600 11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,.52)";
  ctx.fillText(started ? (tiltReady ? "inclina para controlar" : "teclado de teste") : "ativa o acelerometro para começar", 18, 52);
}

function runStep(state, input) {
  const next = {
    ...state,
    player: { ...state.player },
    platforms: state.platforms.map((platform) => ({ ...platform }))
  };
  const p = next.player;
  next.platforms.forEach((platform) => {
    platform.press = Math.max(0, (platform.press || 0) * 0.72 - 0.18);
  });
  p.vx = input * 4.3;
  p.x += p.vx;
  p.vy += 0.34;
  p.y += p.vy;

  if (p.x < -PLAYER_R) p.x = GAME_W + PLAYER_R;
  if (p.x > GAME_W + PLAYER_R) p.x = -PLAYER_R;

  if (p.vy > 0) {
    for (const platform of next.platforms) {
      const above = p.y + PLAYER_R >= platform.y && p.y + PLAYER_R <= platform.y + platform.h + 10;
      const inside = p.x >= platform.x - PLAYER_R && p.x <= platform.x + platform.w + PLAYER_R;
      if (above && inside) {
        p.y = platform.y - PLAYER_R;
        p.vy = -10.8;
        platform.press = 8;
        next.score += 1;
        break;
      }
    }
  }

  if (p.y < GAME_H * 0.42) {
    const scroll = GAME_H * 0.42 - p.y;
    p.y = GAME_H * 0.42;
    next.platforms.forEach((platform) => {
      platform.y += scroll;
    });
  }

  next.platforms = next.platforms.filter((platform) => platform.y < GAME_H + 28);
  while (next.platforms.length < 8) {
    const y = nextPlatformY(next.platforms);
    const w = 60 + Math.random() * 34;
    const x = 14 + Math.random() * (GAME_W - w - 28);
    next.platforms.push(makePlatform(x, y, w));
  }

  if (p.y - PLAYER_R > GAME_H) {
    next.running = false;
    next.gameOver = true;
  }
  return next;
}

const GAME_SLOTS = [
  { id: "alfaJump", title: "Alfa Jump", status: "Disponível", available: true },
  { id: "empty1", title: "Slot vazio", status: "Em breve" },
  { id: "empty2", title: "Slot vazio", status: "Em breve" },
  { id: "empty3", title: "Slot vazio", status: "Em breve" },
  { id: "empty4", title: "Slot vazio", status: "Em breve" },
  { id: "empty5", title: "Slot vazio", status: "Em breve" }
];

function AlfaJumpIcon({ small = false }) {
  return (
    <span className={`alfa-jump-icon ${small ? "small" : ""}`} aria-hidden="true">
      <span className="jump-sky" />
      <span className="jump-platform p1" />
      <span className="jump-platform p2" />
      <span className="jump-character">
        <span />
      </span>
    </span>
  );
}

function EmptyGameIcon() {
  return (
    <span className="empty-game-icon" aria-hidden="true">
      <span />
    </span>
  );
}

function AlfaJumpArtwork({ best }) {
  return (
    <div className="alfa-artwork">
      <div className="alfa-art-bg" />
      <div className="alfa-art-score">
        <span>Recorde</span>
        <strong>{best}</strong>
      </div>
      <div className="art-platform one" />
      <div className="art-platform two" />
      <div className="art-platform three" />
      <div className="art-character">
        <span />
      </div>
      <div className="alfa-art-title">
        <strong>Alfa Jump</strong>
        <span>Inclina o telemovel para subir. Jogo de Merda.</span>
      </div>
    </div>
  );
}

function EmptyArtwork({ index }) {
  return (
    <div className="empty-artwork empty-artwork-blank" aria-label={`Slot ${index} vazio`} />
  );
}

function GamesHub({ profile, onStart }) {
  const [selectedId, setSelectedId] = useState("alfaJump");
  const [opening, setOpening] = useState(false);
  const best = profile?.gameStats?.alfaJumpBest || profile?.["gameStats.alfaJumpBest"] || 0;
  const points = profile?.points || 0;
  const now = new Date();
  const dateLabel = now.toLocaleDateString("pt-PT", { day: "numeric", month: "numeric", weekday: "short" }).replace(".", "");
  const timeLabel = now.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  const selected = GAME_SLOTS.find((game) => game.id === selectedId) || GAME_SLOTS[0];

  const openSelected = () => {
    if (!selected.available || opening) return;
    setOpening(true);
    window.setTimeout(onStart, 360);
  };

  return (
    <section className={`games-hub ${opening ? "is-opening-game" : ""}`}>
      <div className="games-device ds-home dark-ds" aria-label="Menu de jogos">
        <div className="games-top-screen">
          <div className="ds-statusbar">
            <div className="ds-net">
              <Wifi size={13} />
              <span>Internet</span>
            </div>
            <div className="ds-coins">
              <Coins size={13} />
              <strong>{points}</strong>
            </div>
            <div className="ds-time">{dateLabel} {timeLabel}</div>
            <Battery size={16} />
          </div>
          {selected.id === "alfaJump" ? <AlfaJumpArtwork best={best} /> : <EmptyArtwork index={GAME_SLOTS.findIndex((game) => game.id === selected.id) + 1} />}
          <div className="ds-boot-logo" aria-hidden="true">
            <span>AlfaDS</span>
          </div>
        </div>
        <div className="games-hinge" />
        <div className="games-bottom-screen">
          <div className="ds-game-grid">
            {GAME_SLOTS.map((game, index) => (
              <button
                key={game.id}
                className={`game-tile tap ${selectedId === game.id ? "active" : ""} ${game.available ? "" : "empty-slot"}`.trim()}
                type="button"
                aria-label={game.available ? `${game.title} Recorde ${best}` : `Slot ${index + 1} Em breve`}
                aria-pressed={selectedId === game.id}
                onClick={() => setSelectedId(game.id)}
              >
                <span className={`game-cover ${game.available ? "" : "muted"}`.trim()}>
                  {game.available ? <AlfaJumpIcon small /> : <EmptyGameIcon />}
                </span>
                <span className="game-title" aria-hidden="true">{game.available ? game.title : `Slot ${index + 1}`}</span>
                <span className="game-meta">
                  {game.available ? <Trophy size={14} /> : null}
                  {game.available ? `Recorde ${best}` : game.status}
                </span>
              </button>
            ))}
          </div>
          <div className="ds-action-row">
            <div className="ds-selected-label">
              <strong>{selected.title}</strong>
              <span>{selected.available ? "Pronto para jogar" : "Ainda não disponível"}</span>
            </div>
            <button className="ds-start-btn tap" type="button" disabled={!selected.available || opening} onClick={openSelected}>
              <Play size={16} />
              {opening ? "A abrir..." : "Abrir"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function JumpGame({ user, profile, onExit }) {
  const canvasRef = useRef(null);
  const frameRef = useRef(0);
  const stateRef = useRef(makeInitialState());
  const inputRef = useRef({ tilt: 0, key: 0, touch: 0 });
  const finishRef = useRef(false);
  const bestRef = useRef(profile?.gameStats?.alfaJumpBest || profile?.["gameStats.alfaJumpBest"] || 0);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [earned, setEarned] = useState(0);
  const [tiltReady, setTiltReady] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    bestRef.current = profile?.gameStats?.alfaJumpBest || profile?.["gameStats.alfaJumpBest"] || 0;
  }, [profile?.gameStats?.alfaJumpBest, profile?.["gameStats.alfaJumpBest"]]);

  const finishGame = useCallback(async (finalScore) => {
    if (finishRef.current) return;
    finishRef.current = true;
    setGameOver(true);
    const shopPoints = Math.floor(finalScore / 10);
    setEarned(shopPoints);
    if (!user?.uid) {
      toast("Não consegui guardar o recorde.", "error");
      return;
    }
    try {
      const updates = {
        gameStats: {
          alfaJumpLast: finalScore,
          alfaJumpPlays: increment(1),
          alfaJumpUpdatedAt: serverTimestamp()
        }
      };
      if (finalScore > bestRef.current) {
        updates.gameStats.alfaJumpBest = finalScore;
        bestRef.current = finalScore;
      }
      if (shopPoints > 0) {
        updates.points = increment(shopPoints);
        updates.totalPointsEarned = increment(shopPoints);
      }
      await setDoc(doc(db, "users", user.uid), updates, { merge: true });
      if (shopPoints > 0) toast(`+${shopPoints} pontos da loja`);
    } catch (err) {
      console.warn("game reward:", err?.message || err);
      toast("Não consegui guardar os pontos.", "error");
    }
  }, [user?.uid]);

  const resetGame = useCallback(() => {
    stateRef.current = makeInitialState();
    finishRef.current = false;
    setScore(0);
    setEarned(0);
    setGameOver(false);
    setStarted(tiltReady);
  }, [tiltReady]);

  const enableTilt = useCallback(async () => {
    try {
      const OrientationEvent = window.DeviceOrientationEvent;
      if (OrientationEvent && typeof OrientationEvent.requestPermission === "function") {
        const result = await OrientationEvent.requestPermission();
        if (result !== "granted") {
          toast("Movimento não autorizado.");
          return;
        }
      }
      setTiltReady(true);
      setStarted(true);
      toast("Controlo por movimento ativo.");
    } catch (err) {
      console.warn("tilt:", err?.message || err);
      toast("Este dispositivo não deu acesso ao acelerómetro.");
    }
  }, []);

  useEffect(() => {
    if (!tiltReady) return undefined;
    const onOrientation = (event) => {
      const gamma = typeof event.gamma === "number" ? event.gamma : 0;
      inputRef.current.tilt = clamp(gamma / 18, -1, 1);
    };
    window.addEventListener("deviceorientation", onOrientation, true);
    return () => window.removeEventListener("deviceorientation", onOrientation, true);
  }, [tiltReady]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") inputRef.current.key = -1;
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") inputRef.current.key = 1;
      if (event.key === " " && !started) setStarted(true);
    };
    const onKeyUp = (event) => {
      if (["ArrowLeft", "ArrowRight", "a", "A", "d", "D"].includes(event.key)) inputRef.current.key = 0;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [started]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = GAME_W * dpr;
    canvas.height = GAME_H * dpr;
    canvas.style.aspectRatio = `${GAME_W} / ${GAME_H}`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let lastScore = 0;
    const loop = () => {
      const input = tiltReady ? inputRef.current.tilt : inputRef.current.key;
      if (started && !stateRef.current.gameOver) {
        stateRef.current = runStep(stateRef.current, input);
        if (stateRef.current.score !== lastScore) {
          lastScore = stateRef.current.score;
          setScore(lastScore);
        }
        if (stateRef.current.gameOver) finishGame(stateRef.current.score);
      }
      drawGame(ctx, stateRef.current, tiltReady, started);
      frameRef.current = requestAnimationFrame(loop);
    };
    frameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameRef.current);
  }, [finishGame, started, tiltReady]);

  const potentialPoints = Math.floor(score / 10);
  return (
    <section className="jump-page">
      <div className="jump-topbar">
        <button className="icon-btn tap" type="button" aria-label="Voltar aos jogos" onClick={onExit}>
          <ChevronLeft size={30} />
        </button>
        <div>
          <strong>Alfa Jump</strong>
          <span>Joga inclinando o telemóvel</span>
        </div>
        <button className="icon-btn tap" type="button" aria-label="Reiniciar" onClick={resetGame}>
          <RotateCcw size={20} />
        </button>
      </div>

      <div className="jump-hud">
        <div>
          <span>Score</span>
          <strong>{score}</strong>
        </div>
        <div>
          <span>Loja</span>
          <strong>+{gameOver ? earned : potentialPoints}</strong>
        </div>
        <div>
          <span>Record</span>
          <strong>{Math.max(profile?.gameStats?.alfaJumpBest || profile?.["gameStats.alfaJumpBest"] || 0, score)}</strong>
        </div>
      </div>

      <div className="jump-stage">
        <canvas ref={canvasRef} className="jump-canvas" aria-label="Alfa Jump" />
        {!started ? (
          <div className="jump-overlay">
            <div className="jump-result jump-start">
              <Smartphone size={30} />
              <strong>Movimento</strong>
              <span>Ativa o acelerómetro e inclina o telemóvel para controlar.</span>
              <button className="primary tap" type="button" onClick={enableTilt}>
                <Smartphone size={18} />
                Ativar acelerómetro
              </button>
              <small>Desktop: usa espaço para iniciar.</small>
            </div>
          </div>
        ) : null}
        {gameOver ? (
          <div className="jump-overlay">
            <div className="jump-result">
              <Trophy size={28} />
              <strong>{score}</strong>
              <span>{earned > 0 ? `Ganhaste ${earned} pontos da loja` : "Chega aos 10 pontos para ganhar na loja"}</span>
              <button className="primary tap" type="button" onClick={resetGame}>
                <RotateCcw size={18} />
                Jogar outra vez
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="jump-actions">
        <button className={`tilt-btn tap ${tiltReady ? "active" : ""}`} type="button" onClick={enableTilt}>
          <Smartphone size={18} />
          {tiltReady ? "Movimento ativo" : "Ativar acelerómetro"}
        </button>
      </div>
    </section>
  );
}

export function GamesPage() {
  const { loading, user, profile, error } = useAuthProfile({ requireUser: true });
  const [mode, setMode] = useState("hub");
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    setBooting(true);
    const timer = window.setTimeout(() => setBooting(false), 1450);
    return () => window.clearTimeout(timer);
  }, []);

  if (!loading && (error || !user)) {
    return (
      <PageFrame page="games.html">
        <GradientDefs />
        <AppHeader title="Jogos" />
        <div className="empty">Não foi possível carregar os jogos.</div>
        <BottomNav active="games.html" />
      </PageFrame>
    );
  }

  return (
    <PageFrame page="games.html">
      <div className="games-page-route">
        <GradientDefs />
        <div className="games-page-click-layer">
          <div className={`games-page-shell ${booting && mode === "hub" ? "is-booting" : ""}`}>
            {mode === "hub" ? <AppHeader title="AlfaDS" /> : null}
            {mode === "hub" ? (
              <GamesHub profile={profile} onStart={() => setMode("jump")} />
            ) : (
              <JumpGame user={user} profile={profile} onExit={() => setMode("hub")} />
            )}
          </div>
        </div>
        <BottomNav active="games.html" />
      </div>
    </PageFrame>
  );
}
