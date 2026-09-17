import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  adjustCoachSeats,
  getCoachBilling,
  getCoachInvite,
  openCoachBillingPortal,
  rotateCoachInvite,
  setCoachInviteEnabled,
  subscribeCoachPlan,
  type CoachBilling,
  type CoachInvite as CoachInviteData,
} from "../api";
import { useViewScopes } from "../state/viewScopes";

export default function CoachInvite() {
  const { coachView } = useViewScopes();
  const [searchParams, setSearchParams] = useSearchParams();

  const [invite, setInvite] = useState<CoachInviteData | null>(null);
  const [billing, setBilling] = useState<CoachBilling | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [inviteRes, billingRes] = await Promise.all([getCoachInvite(), getCoachBilling()]);
      setInvite(inviteRes);
      setBilling(billingRes);
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    }
  }, []);

  useEffect(() => {
    if (!coachView) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [coachView, refresh]);

  useEffect(() => {
    const checkout = searchParams.get("checkout");
    if (!checkout) return;
    setInfo(checkout === "success" ? "Pago confirmado." : "Pago cancelado.");
    void refresh();
    const next = new URLSearchParams(searchParams);
    next.delete("checkout");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copyInviteLink() {
    if (!invite) return;
    const link = `${window.location.origin}/coach/invite?code=${encodeURIComponent(invite.invite_code)}`;
    try {
      await navigator.clipboard.writeText(link);
      setInfo("Link copiado.");
    } catch {
      setInfo(`Código: ${invite.invite_code}`);
    }
  }

  async function rotateCode() {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const res = await rotateCoachInvite();
      setInvite(res);
      setInfo("Código regenerado.");
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled() {
    if (!invite) return;
    setBusy(true);
    setError("");
    try {
      const res = await setCoachInviteEnabled(!invite.invite_enabled);
      setInvite(res);
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setBusy(false);
    }
  }

  async function activatePlan() {
    setBusy(true);
    setError("");
    try {
      const res = await subscribeCoachPlan();
      window.location.href = res.checkout_url;
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
      setBusy(false);
    }
  }

  async function buySeat() {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const res = await adjustCoachSeats(1);
      setBilling(res);
      setInfo("Asiento extra agregado. Se cobra en tu próximo ciclo.");
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setBusy(false);
    }
  }

  async function openPortal() {
    setBusy(true);
    setError("");
    try {
      const res = await openCoachBillingPortal();
      window.location.href = res.portal_url;
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
      setBusy(false);
    }
  }

  if (!coachView) {
    return (
      <div className="container stack">
        <header className="titleBlock">
          <h1>Invitaciones y cupo</h1>
          <p>Esta vista esta disponible con la vista coach encendida (interruptor arriba en la barra superior).</p>
        </header>
      </div>
    );
  }

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Invitaciones y cupo</h1>
        <p>Comparte tu código para que tus atletas se unan, y gestiona tu plan coach.</p>
      </header>

      {error ? <section className="message error">{error}</section> : null}
      {info ? <section className="message">{info}</section> : null}

      {loading || !invite ? (
        <section className="surface">
          <div className="emptyState">Cargando...</div>
        </section>
      ) : (
        <>
          <section className="surface stack compactStack">
            <div className="sectionHead">
              <h3>Tu código de invitación</h3>
              <p>Privado: solo entra quien reciba este código o link directamente de ti.</p>
            </div>
            <div className="chipRow">
              <span className="chip">{invite.invite_code}</span>
              <span className="chip">{invite.invite_enabled ? "Invitaciones abiertas" : "Invitaciones pausadas"}</span>
              <span className="chip">
                {`Cupo: ${invite.capacity.used} / ${invite.capacity.total} (${invite.capacity.included} incluidos + ${invite.capacity.extra} extra)`}
              </span>
            </div>
            <div className="quickActions">
              <button className="btn" onClick={() => void copyInviteLink()} disabled={busy}>
                Copiar link
              </button>
              <button className="btn" onClick={() => void rotateCode()} disabled={busy}>
                Regenerar código
              </button>
              <button className="btn" onClick={() => void toggleEnabled()} disabled={busy}>
                {invite.invite_enabled ? "Pausar invitaciones" : "Reanudar invitaciones"}
              </button>
            </div>
          </section>

          <section className="surface stack compactStack">
            <div className="sectionHead">
              <h3>Plan coach</h3>
              <p>Estado: {billing?.status === "active" ? "activo" : billing?.status === "past_due" ? "pago pendiente" : "sin activar"}</p>
            </div>
            {!billing?.has_subscription ? (
              <div className="quickActions">
                <button className="btn primary" onClick={() => void activatePlan()} disabled={busy}>
                  Activar plan coach
                </button>
              </div>
            ) : (
              <div className="quickActions">
                <button className="btn primary" onClick={() => void buySeat()} disabled={busy}>
                  Comprar asiento extra
                </button>
                <button className="btn" onClick={() => void openPortal()} disabled={busy}>
                  Gestionar pago
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
