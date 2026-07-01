import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";

import { ApiError } from "../api";
import { useAuth } from "../state/auth";

const isNativeApp = Capacitor.isNativePlatform();

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleButtonOptions = {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  width?: number;
  locale?: string;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          renderButton: (parent: HTMLElement, options: GoogleButtonOptions) => void;
        };
      };
    };
  }
}

let googleScriptPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }
  if (googleScriptPromise) {
    return googleScriptPromise;
  }

  googleScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-identity="true"]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("No se pudo cargar Google.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("No se pudo cargar Google."));
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

function toFriendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = error.detail;
    if (error.status === 401 && detail.includes("Invalid credentials")) {
      return "Contrasena invalida o usuario no encontrado.";
    }
    if (error.status === 409 && detail.includes("Email already registered")) {
      return "El correo ya existe.";
    }
    if (error.status === 409 && detail.includes("Phone already registered")) {
      return "El numero de celular ya existe.";
    }
    if (error.status === 400 && detail.includes("Invalid email")) {
      return "Correo invalido.";
    }
    if (error.status === 400 && detail.includes("Invalid phone number")) {
      return "Numero de celular invalido.";
    }
    if (error.status === 503 && detail.includes("Google login is not configured")) {
      return "Inicio con Google no configurado en el servidor.";
    }
    if (error.status === 403 && detail.includes("Guest login is disabled")) {
      return "El ingreso invitado esta deshabilitado en este entorno.";
    }
    if (error.status === 500 && detail.includes("migrations are up to date")) {
      return "El acceso invitado fallo por migraciones pendientes en backend.";
    }
    if (error.status === 401 && detail.includes("Google")) {
      return "No se pudo validar tu cuenta de Google.";
    }
    return detail;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "No se pudo completar la autenticacion.";
}

function PasswordVisibilityIcon({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg className="passwordIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 3L21 21" />
        <path d="M10.7 10.7A3 3 0 0 0 13.3 13.3" />
        <path d="M9.2 5.1A10.7 10.7 0 0 1 12 4.8c5.1 0 9.4 3.1 11.1 7.2a11 11 0 0 1-2.9 4.1" />
        <path d="M6.2 6.2A10.9 10.9 0 0 0 1 12c1.7 4.1 6 7.2 11 7.2 1.8 0 3.5-.4 5.1-1.1" />
      </svg>
    );
  }

  return (
    <svg className="passwordIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.1 12a11.4 11.4 0 0 1 19.8 0 11.4 11.4 0 0 1-19.8 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function Login() {
  const { isAuthenticated, login, register, loginWithGoogle, loginAsGuest } = useAuth();
  const nav = useNavigate();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? "";
  const canGuestLogin =
    import.meta.env.DEV ||
    ((import.meta.env.VITE_ENABLE_GUEST_LOGIN as string | undefined)?.trim().toLowerCase() === "true");

  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [googleStatus, setGoogleStatus] = useState<"idle" | "ready" | "unavailable">(
    googleClientId ? "idle" : "unavailable",
  );

  // Nativo (Capacitor): Google Sign-In por Credential Manager; GIS web no funciona en webview.
  useEffect(() => {
    if (!isNativeApp || !googleClientId || isAuthenticated) return;

    let cancelled = false;
    import("@capgo/capacitor-social-login")
      .then(({ SocialLogin }) => SocialLogin.initialize({ google: { webClientId: googleClientId } }))
      .then(() => {
        if (!cancelled) setGoogleStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setGoogleStatus("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [googleClientId, isAuthenticated]);

  async function submitGoogleNative() {
    setBusy(true);
    setError("");
    try {
      const { SocialLogin } = await import("@capgo/capacitor-social-login");
      const response = await SocialLogin.login({
        provider: "google",
        options: { scopes: ["email", "profile"] },
      });
      const idToken = "idToken" in response.result ? response.result.idToken?.trim() : "";
      if (!idToken) {
        setError("No se pudo obtener la credencial de Google.");
        return;
      }
      await loginWithGoogle(idToken);
      nav("/home", { replace: true });
    } catch (e: unknown) {
      // el usuario cancelo el dialogo nativo: no mostrar error
      if (e instanceof Error && /cancel/i.test(e.message)) return;
      setError(toFriendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (isNativeApp || !googleClientId || isAuthenticated) return;

    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled) return;
        const googleId = window.google?.accounts?.id;
        const target = googleButtonRef.current;
        if (!googleId || !target) {
          setGoogleStatus("unavailable");
          return;
        }

        googleId.initialize({
          client_id: googleClientId,
          callback: (response) => {
            const credential = response.credential?.trim();
            if (!credential) {
              setError("No se pudo obtener la credencial de Google.");
              return;
            }
            setBusy(true);
            setError("");
            loginWithGoogle(credential)
              .then(() => nav("/home", { replace: true }))
              .catch((cause: unknown) => setError(toFriendlyError(cause)))
              .finally(() => setBusy(false));
          },
        });

        target.replaceChildren();
        googleId.renderButton(target, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "pill",
          logo_alignment: "left",
          width: 320,
          locale: "es",
        });
        setGoogleStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setGoogleStatus("unavailable");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleClientId, isAuthenticated]);

  if (isAuthenticated) {
    return <Navigate to="/home" replace />;
  }

  async function submit() {
    const cleanIdentifier = identifier.trim();
    const cleanEmail = email.trim();
    const cleanPhone = phoneNumber.trim();

    if (mode === "register" && password !== confirmPassword) {
      setError("Las contrasenas no coinciden.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      if (mode === "login") {
        await login(cleanIdentifier, password);
      } else {
        await register(cleanEmail, password, cleanPhone || undefined);
      }
      nav("/home", { replace: true });
    } catch (e: unknown) {
      setError(toFriendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitGuest() {
    setBusy(true);
    setError("");
    try {
      await loginAsGuest();
      nav("/home", { replace: true });
    } catch (e: unknown) {
      setError(toFriendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    mode === "login"
      ? identifier.trim().length > 0 && password.length > 0
      : email.trim().length > 0 && password.length > 0 && confirmPassword.length > 0 && password === confirmPassword;

  return (
    <div className="loginWrap">
      <section className="surface loginCard">
        <div className="titleBlock">
          <h1>Alzo</h1>
          <p>Inicia sesion para gestionar atletas, sesiones y escenarios.</p>
        </div>

        <div className="pillGroup">
          <button type="button" className={`pill ${mode === "login" ? "active" : ""}`} onClick={() => setMode("login")}>
            <span>Iniciar sesion</span>
            <small>Correo o celular con contrasena</small>
          </button>
          <button
            type="button"
            className={`pill ${mode === "register" ? "active" : ""}`}
            onClick={() => setMode("register")}
          >
            <span>Crear cuenta</span>
            <small>Incluye celular opcional y confirmacion</small>
          </button>
        </div>

        {error ? <div className="message error">{error}</div> : null}

        <div className="stack">
          {mode === "login" ? (
            <div>
              <label className="smallLabel">Correo o celular</label>
              <input
                className="input"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="usuario@dominio.com o +5491112345678"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="smallLabel">Correo</label>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>

              <div>
                <label className="smallLabel">Numero celular (opcional)</label>
                <input
                  className="input"
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+5491112345678"
                />
              </div>
            </>
          )}

          <div>
            <label className="smallLabel">Contrasena</label>
            <div className="passwordInputWrap">
              <input
                className="input passwordInput"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
              <button
                type="button"
                className="passwordToggle"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? "Ocultar contrasena" : "Mostrar contrasena"}
                title={showPassword ? "Ocultar contrasena" : "Mostrar contrasena"}
              >
                <PasswordVisibilityIcon visible={showPassword} />
              </button>
            </div>
          </div>

          {mode === "register" ? (
            <div>
              <label className="smallLabel">Confirmar contrasena</label>
              <div className="passwordInputWrap">
                <input
                  className="input passwordInput"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="passwordToggle"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  aria-label={showConfirmPassword ? "Ocultar contrasena" : "Mostrar contrasena"}
                  title={showConfirmPassword ? "Ocultar contrasena" : "Mostrar contrasena"}
                >
                  <PasswordVisibilityIcon visible={showConfirmPassword} />
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="quickActions">
          <button type="button" className="btn primary" onClick={submit} disabled={busy || !canSubmit}>
            {busy ? "Procesando..." : mode === "login" ? "Entrar" : "Crear cuenta"}
          </button>

          <div className="loginDivider" role="separator">
            <span>o</span>
          </div>

          <div className="googleSignIn" aria-busy={busy}>
            {isNativeApp ? (
              googleStatus === "ready" ? (
                <button type="button" className="btn" onClick={submitGoogleNative} disabled={busy}>
                  Continuar con Google
                </button>
              ) : null
            ) : (
              <div ref={googleButtonRef} className="googleSignInButton" />
            )}
            {googleStatus === "idle" ? <div className="smallLabel">Cargando Google...</div> : null}
            {googleStatus === "unavailable" ? (
              <div className="smallLabel">
                {googleClientId
                  ? "Inicio con Google no disponible (sin conexion con Google)."
                  : "Inicio con Google no configurado."}
              </div>
            ) : null}
          </div>

          {canGuestLogin ? (
            <button type="button" className="btn" onClick={submitGuest} disabled={busy}>
              Entrar como invitado (debug)
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
