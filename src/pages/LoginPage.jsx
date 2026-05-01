import React, { useEffect, useState } from "react";
import { GradientDefs, PageFrame } from "../components/Shell.jsx";
import { loginUser, registerUser, useAuthProfile } from "../lib/auth.js";
import { routeTo } from "../lib/navigation.js";

const INVITE_KEY = "alfa_invite_ok_v1";
const VALID_INVITE = "2002";

function friendlyError(err) {
  const code = err?.code || "";
  const map = {
    "auth/invalid-email": "Email invalido.",
    "auth/invalid-credential": "Email ou password errados.",
    "auth/wrong-password": "Password errada.",
    "auth/user-not-found": "Utilizador não encontrado.",
    "auth/email-already-in-use": "Esse email já está registado. Usa outro ou clica em Entrar.",
    "auth/weak-password": "Password muito fraca (minimo 6 caracteres).",
    "auth/too-many-requests": "Demasiadas tentativas. Espera um pouco.",
    "auth/network-request-failed": "Sem ligação a internet.",
    "auth/operation-not-allowed": "Email/Password não está ativado no Firebase.",
    "auth/api-key-not-valid": "API key do Firebase invalida.",
    "auth/invalid-api-key": "API key do Firebase invalida."
  };
  if (map[code]) return map[code];
  return err?.message || "Ocorreu um erro.";
}

export function LoginPage() {
  const { user, loading } = useAuthProfile();
  const [inviteOk, setInviteOk] = useState(() => {
    try {
      return localStorage.getItem(INVITE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [invite, setInvite] = useState("");
  const [tab, setTab] = useState("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState({ email: "", password: "" });
  const [register, setRegister] = useState({ name: "", username: "", email: "", password: "" });

  useEffect(() => {
    if (!loading && user) routeTo("index.html");
  }, [loading, user]);

  const submitInvite = (event) => {
    event.preventDefault();
    setError("");
    if (invite.trim() === VALID_INVITE) {
      try {
        localStorage.setItem(INVITE_KEY, "1");
      } catch {}
      setInviteOk(true);
      return;
    }
    setError("Codigo invalido.");
  };

  const submitLogin = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await loginUser({ email: login.email.trim(), password: login.password });
      routeTo("index.html");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitRegister = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (!register.name.trim()) throw new Error("Indica o teu nome.");
      if (!register.username.trim()) throw new Error("Escolhe um @username.");
      await registerUser({
        name: register.name.trim(),
        username: register.username.trim(),
        email: register.email.trim(),
        password: register.password
      });
      routeTo("index.html");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageFrame page="login.html">
      <GradientDefs />
      <div className="blob-bg">
        <div className="blob b1" />
        <div className="blob b2" />
        <div className="blob b3" />
      </div>

      <div className="login-shell">
        <div className="login-card">
          <div className="logo-wrap">
            <img className="logo-circle" src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="Alfa Club" />
            <div className="logo-name">
              <span className="grad-text">Alfa Club</span>
            </div>
          </div>

          {!inviteOk ? (
            <form className="panel active" autoComplete="off" noValidate onSubmit={submitInvite}>
              <div className="field">
                <label className="field-label" htmlFor="inviteCode">Invite code</label>
                <input
                  className={`input ${error ? "shake" : ""}`}
                  type="text"
                  id="inviteCode"
                  placeholder="Codigo de acesso"
                  autoComplete="off"
                  inputMode="numeric"
                  value={invite}
                  onChange={(event) => setInvite(event.target.value)}
                  required
                />
              </div>
              {error ? <div className="error-msg">{error}</div> : null}
              <button type="submit" className="btn-primary submit-btn">
                <span className="btn-label">Continuar</span>
              </button>
              <div className="small-link" style={{ opacity: 0.65 }}>Precisas de um codigo para entrar.</div>
            </form>
          ) : (
            <>
              <div className="tabs" data-tab={tab}>
                <div className="tab-indicator" />
                <button type="button" className={`tab-btn ${tab === "login" ? "active" : ""}`} onClick={() => { setTab("login"); setError(""); }}>Entrar</button>
                <button type="button" className={`tab-btn ${tab === "register" ? "active" : ""}`} onClick={() => { setTab("register"); setError(""); }}>Criar conta</button>
              </div>

              {error ? <div className="error-msg">{error}</div> : null}

              <form className={`panel ${tab === "login" ? "active" : ""}`} autoComplete="on" onSubmit={submitLogin}>
                <div className="field">
                  <label className="field-label" htmlFor="li-email">Email</label>
                  <input className="input" type="email" id="li-email" placeholder="tu@exemplo.com" autoComplete="email" value={login.email} onChange={(event) => setLogin((prev) => ({ ...prev, email: event.target.value }))} required />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="li-pass">Password</label>
                  <input className="input" type="password" id="li-pass" placeholder="........" autoComplete="current-password" value={login.password} onChange={(event) => setLogin((prev) => ({ ...prev, password: event.target.value }))} required />
                </div>
                <button type="submit" className="btn-primary submit-btn" disabled={busy}>
                  <span className="btn-label">{busy ? <span className="dots">A processar</span> : "Entrar"}</span>
                </button>
                <div className="small-link">Ainda não tens conta? <a href="#" onClick={(event) => { event.preventDefault(); setTab("register"); }} className="grad-text font-semibold">Es burro.</a></div>
              </form>

              <form className={`panel ${tab === "register" ? "active" : ""}`} autoComplete="on" onSubmit={submitRegister}>
                <div className="field">
                  <label className="field-label" htmlFor="rg-name">Nome</label>
                  <input className="input" type="text" id="rg-name" placeholder="O teu nome" autoComplete="name" value={register.name} onChange={(event) => setRegister((prev) => ({ ...prev, name: event.target.value }))} required />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="rg-user">@username</label>
                  <input className="input" type="text" id="rg-user" placeholder="username" autoComplete="off" value={register.username} onChange={(event) => setRegister((prev) => ({ ...prev, username: event.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, "") }))} required />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="rg-email">Email</label>
                  <input className="input" type="email" id="rg-email" placeholder="tu@exemplo.com" autoComplete="email" value={register.email} onChange={(event) => setRegister((prev) => ({ ...prev, email: event.target.value }))} required />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="rg-pass">Password</label>
                  <input className="input" type="password" id="rg-pass" placeholder="Minimo 6 caracteres" autoComplete="new-password" minLength="6" value={register.password} onChange={(event) => setRegister((prev) => ({ ...prev, password: event.target.value }))} required />
                </div>
                <button type="submit" className="btn-primary submit-btn" disabled={busy}>
                  <span className="btn-label">{busy ? <span className="dots">A processar</span> : "Criar conta"}</span>
                </button>
                <div className="small-link">Ja tens conta? <a href="#" onClick={(event) => { event.preventDefault(); setTab("login"); }} className="grad-text font-semibold">Entra aqui</a></div>
              </form>
            </>
          )}
        </div>
      </div>
    </PageFrame>
  );
}
