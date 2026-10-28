import { useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_CONTACT_EMAIL_MISSING,
  LEGAL_LAST_UPDATED,
  LEGAL_OWNER_NAME,
  LEGAL_OWNER_NAME_MISSING,
} from "../../lib/legal";
import { useAuth } from "../../state/auth";

/** Correo de contacto como enlace `mailto:`; si no está configurado, lo dice en vez de inventarlo. */
export function LegalContactEmail({ subject }: { subject?: string }) {
  if (!LEGAL_CONTACT_EMAIL) return <strong>{LEGAL_CONTACT_EMAIL_MISSING}</strong>;
  const href = subject
    ? `mailto:${LEGAL_CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`
    : `mailto:${LEGAL_CONTACT_EMAIL}`;
  return <a href={href}>{LEGAL_CONTACT_EMAIL}</a>;
}

export function LegalOwnerName() {
  return <strong>{LEGAL_OWNER_NAME || LEGAL_OWNER_NAME_MISSING}</strong>;
}

/** Bloque de sección: mismo patrón `surface` + `sectionHead` del resto de la app. */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="surface">
      <div className="sectionHead">
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

/**
 * Marco de las páginas legales. Son públicas (fuera de RequireAuth): se abren
 * desde la app y también por URL directa desde las tiendas, sin historial.
 */
export default function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  const nav = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  function goBack() {
    // react-router marca con key "default" la primera entrada: no hay a dónde volver dentro de la app.
    if (location.key !== "default") {
      nav(-1);
      return;
    }
    nav(isAuthenticated ? "/home" : "/login", { replace: true });
  }

  return (
    <div className="container stack legalPage">
      <header className="titleBlock">
        <h1>{title}</h1>
        <p>Última actualización: {LEGAL_LAST_UPDATED}</p>
        <div className="quickActions" style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={goBack}>
            Volver
          </button>
        </div>
      </header>

      {children}
    </div>
  );
}
