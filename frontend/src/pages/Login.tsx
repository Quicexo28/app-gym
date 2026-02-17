import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { useAuth } from "../state/auth";

export default function Login() {
  const { isAuthenticated, login, register } = useAuth();
  const nav = useNavigate();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (isAuthenticated) {
    return <Navigate to="/home" replace />;
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password);
      }
      nav("/home", { replace: true });
    } catch (e: unknown) {
      setError(String((e as { message?: string })?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="loginWrap">
      <section className="surface loginCard">
        <div className="titleBlock">
          <h1>Coach AI Engineer</h1>
          <p>Inicia sesión para gestionar atletas, sesiones y escenarios.</p>
        </div>

        <div className="pillGroup">
          <button type="button" className={`pill ${mode === "login" ? "active" : ""}`} onClick={() => setMode("login")}>
            <span>Iniciar sesión</span>
            <small>Acceso con cuenta existente</small>
          </button>
          <button
            type="button"
            className={`pill ${mode === "register" ? "active" : ""}`}
            onClick={() => setMode("register")}
          >
            <span>Crear cuenta</span>
            <small>Registro rápido inicial</small>
          </button>
        </div>

        {error ? <div className="message error">{error}</div> : null}

        <div className="stack">
          <div>
            <label className="smallLabel">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div>
            <label className="smallLabel">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </div>

        <div className="quickActions">
          <button type="button" className="btn primary" onClick={submit} disabled={busy || !email || !password}>
            {busy ? "Procesando..." : mode === "login" ? "Entrar" : "Crear cuenta"}
          </button>
        </div>
      </section>
    </div>
  );
}
