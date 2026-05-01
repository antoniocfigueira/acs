import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, increment, serverTimestamp, setDoc } from "firebase/firestore";
import { ChevronLeft, Coins, Gamepad2, Play, RotateCcw, Smartphone, Trophy } from "lucide-react";
import { AppHeader, BottomNav, GradientDefs, PageFrame } from "../components/Shell.jsx";
import { useAuthProfile } from "../lib/auth.js";
import { db } from "../lib/firebase.js";
import { Loading, toast } from "../lib/ui.jsx";

const GAME_W = 360;
const GAME_H = 560;
const PLAYER_R = 14;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makePlatform(x, y, w = 74, kind = "normal") {
  return { x, y, w, h: 12, kind };
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
    height: 0,
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

function drawGame(ctx, state, tiltReady) {
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
    const glow = ctx.createLinearGradient(platform.x, platform.y, platform.x + platform.w, platform.y);
    glow.addColorStop(0, "#a855f7");
    glow.addColorStop(0.55, "#ec4899");
    glow.addColorStop(1, "#7dd3fc");
    ctx.shadowColor = "rgba(236,72,153,.35)";
    ctx.shadowBlur = 14;
    ctx.fillStyle = glow;
    drawRoundRect(ctx, platform.x, platform.y, platform.w, platform.h, 8);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,.72)";
    drawRoundRect(ctx, platform.x + 7, platform.y + 2, platform.w - 14, 2, 2);
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
  ctx.fillText(tiltReady ? "inclina para controlar" : "setas/toque, ou ativa o movimento", 18, 52);
}

function runStep(state, input) {
  const next = {
    ...state,
    player: { ...state.player },
    platforms: state.platforms.map((platform) => ({ ...platform }))
  };
  const p = next.player;
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
        break;
      }
    }
  }

  if (p.y < GAME_H * 0.42) {
    const scroll = GAME_H * 0.42 - p.y;
    p.y = GAME_H * 0.42;
    next.height += scroll;
    next.score = Math.floor(next.height / 10);
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

function GamesHub({ profile, onStart }) {
  const best = profile?.gameStats?.alfaJumpBest || 0;
  const points = profile?.points || 0;
  return (
    <section className="games-hub">
      <div className="games-hero">
        <div>
          <span className="games-eyebrow">Arcade Alfa</span>
          <h1>Jogos</h1>
          <p>Jogos singleplayer para ganhar pontos da loja.</p>
        </div>
        <div className="games-points">
          <Coins size={18} />
          <span>{points}</span>
        </div>
      </div>

      <div className="games-device" aria-label="Menu de jogos">
        <div className="games-top-screen">
          <div className="games-feature-art">
            <div className="jump-orb">AJ</div>
            <div>
              <strong>Alfa Jump</strong>
              <span>10 pontos no jogo = 1 ponto da loja</span>
            </div>
          </div>
        </div>
        <div className="games-hinge" />
        <div className="games-bottom-screen">
          <button className="game-tile active tap" type="button" onClick={onStart}>
            <span className="game-cover">
              <Gamepad2 size={30} />
            </span>
            <span className="game-title">Alfa Jump</span>
            <span className="game-meta">
              <Trophy size={14} />
              Recorde {best}
            </span>
          </button>
          <button className="game-tile locked" type="button" disabled>
            <span className="game-cover muted">
              <Gamepad2 size={30} />
            </span>
            <span className="game-title">Em breve</span>
            <span className="game-meta">Novo jogo</span>
          </button>
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
  const bestRef = useRef(profile?.gameStats?.alfaJumpBest || 0);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [earned, setEarned] = useState(0);
  const [tiltReady, setTiltReady] = useState(false);

  useEffect(() => {
    bestRef.current = profile?.gameStats?.alfaJumpBest || 0;
  }, [profile?.gameStats?.alfaJumpBest]);

  const finishGame = useCallback(async (finalScore) => {
    if (finishRef.current) return;
    finishRef.current = true;
    setGameOver(true);
    const shopPoints = Math.floor(finalScore / 10);
    setEarned(shopPoints);
    try {
      const updates = {
        "gameStats.alfaJumpLast": finalScore,
        "gameStats.alfaJumpPlays": increment(1),
        "gameStats.alfaJumpUpdatedAt": serverTimestamp()
      };
      if (finalScore > bestRef.current) updates["gameStats.alfaJumpBest"] = finalScore;
      if (shopPoints > 0) {
        updates.points = increment(shopPoints);
        updates.totalPointsEarned = increment(shopPoints);
      }
      await setDoc(doc(db, "users", user.uid), updates, { merge: true });
      if (shopPoints > 0) toast(`+${shopPoints} pontos da loja`);
    } catch (err) {
      console.warn("game reward:", err?.message || err);
      toast("Nao consegui guardar os pontos.", "error");
    }
  }, [user.uid]);

  const resetGame = useCallback(() => {
    stateRef.current = makeInitialState();
    finishRef.current = false;
    setScore(0);
    setEarned(0);
    setGameOver(false);
  }, []);

  const enableTilt = useCallback(async () => {
    try {
      const OrientationEvent = window.DeviceOrientationEvent;
      if (OrientationEvent && typeof OrientationEvent.requestPermission === "function") {
        const result = await OrientationEvent.requestPermission();
        if (result !== "granted") {
          toast("Movimento nao autorizado.");
          return;
        }
      }
      setTiltReady(true);
      toast("Controlo por movimento ativo.");
    } catch (err) {
      console.warn("tilt:", err?.message || err);
      toast("Este dispositivo nao deu acesso ao acelerometro.");
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
  }, []);

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
      const input = inputRef.current.key || inputRef.current.touch || inputRef.current.tilt || 0;
      if (!stateRef.current.gameOver) {
        stateRef.current = runStep(stateRef.current, input);
        if (stateRef.current.score !== lastScore) {
          lastScore = stateRef.current.score;
          setScore(lastScore);
        }
        if (stateRef.current.gameOver) finishGame(stateRef.current.score);
      }
      drawGame(ctx, stateRef.current, tiltReady);
      frameRef.current = requestAnimationFrame(loop);
    };
    frameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameRef.current);
  }, [finishGame, tiltReady]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const setTouch = (event) => {
      const rect = canvas.getBoundingClientRect();
      inputRef.current.touch = event.clientX - rect.left < rect.width / 2 ? -1 : 1;
    };
    const clearTouch = () => {
      inputRef.current.touch = 0;
    };
    canvas.addEventListener("pointerdown", setTouch);
    canvas.addEventListener("pointermove", setTouch);
    canvas.addEventListener("pointerup", clearTouch);
    canvas.addEventListener("pointercancel", clearTouch);
    canvas.addEventListener("pointerleave", clearTouch);
    return () => {
      canvas.removeEventListener("pointerdown", setTouch);
      canvas.removeEventListener("pointermove", setTouch);
      canvas.removeEventListener("pointerup", clearTouch);
      canvas.removeEventListener("pointercancel", clearTouch);
      canvas.removeEventListener("pointerleave", clearTouch);
    };
  }, []);

  const potentialPoints = Math.floor(score / 10);
  return (
    <section className="jump-page">
      <div className="jump-topbar">
        <button className="icon-btn tap" type="button" aria-label="Voltar aos jogos" onClick={onExit}>
          <ChevronLeft size={30} />
        </button>
        <div>
          <strong>Alfa Jump</strong>
          <span>inclina, toca ou usa as setas</span>
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
          <span>Recorde</span>
          <strong>{Math.max(profile?.gameStats?.alfaJumpBest || 0, score)}</strong>
        </div>
      </div>

      <div className="jump-stage">
        <canvas ref={canvasRef} className="jump-canvas" aria-label="Alfa Jump" />
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
          {tiltReady ? "Movimento ativo" : "Ativar acelerometro"}
        </button>
      </div>
    </section>
  );
}

export function GamesPage() {
  const { loading, user, profile, error } = useAuthProfile({ requireUser: true });
  const [mode, setMode] = useState("hub");
  const subtitle = useMemo(() => {
    const points = profile?.points || 0;
    return `${points} pontos da loja`;
  }, [profile?.points]);

  if (loading) {
    return (
      <PageFrame page="games.html">
        <GradientDefs />
        <AppHeader title="Jogos" subtitle="A preparar arcade" />
        <Loading />
        <BottomNav active="games.html" />
      </PageFrame>
    );
  }

  if (error || !user) {
    return (
      <PageFrame page="games.html">
        <GradientDefs />
        <AppHeader title="Jogos" />
        <div className="empty">Nao foi possivel carregar os jogos.</div>
        <BottomNav active="games.html" />
      </PageFrame>
    );
  }

  return (
    <PageFrame page="games.html">
      <GradientDefs />
      {mode === "hub" ? <AppHeader title="Jogos" subtitle={subtitle} /> : null}
      {mode === "hub" ? (
        <GamesHub profile={profile} onStart={() => setMode("jump")} />
      ) : (
        <JumpGame user={user} profile={profile} onExit={() => setMode("hub")} />
      )}
      <BottomNav active="games.html" />
    </PageFrame>
  );
}
