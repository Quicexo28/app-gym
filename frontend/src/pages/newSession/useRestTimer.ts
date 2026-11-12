import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { TICK_MS } from "../../lib/session/sessionTimer";
import { detectNotificationCapability } from "../../lib/session/format";
import type { NotificationCapability, RestTimerState } from "../../lib/session/types";

// Reloj compartido de la sesión (`nowMs`) y temporizador de descanso entre series con notificación al terminar.
export function useRestTimer(initialRestTimer: RestTimerState | null) {
  const [restTimer, setRestTimer] = useState<RestTimerState | null>(initialRestTimer);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [notificationCapability, setNotificationCapability] = useState<NotificationCapability>(() => detectNotificationCapability());

  const restTimeoutRef = useRef<number | null>(null);
  const restRemainingSec = useMemo(() => {
    if (!restTimer) return 0;
    return Math.max(0, Math.ceil((restTimer.ends_at_ms - nowMs) / 1_000));
  }, [nowMs, restTimer]);
  const restRemainingSecSigned = useMemo(() => {
    if (!restTimer) return 0;
    return Math.ceil((restTimer.ends_at_ms - nowMs) / 1_000);
  }, [nowMs, restTimer]);
  const restProgressPct = useMemo(() => {
    if (!restTimer || restTimer.duration_seconds <= 0) return 0;
    const elapsedMs = Math.max(0, nowMs - restTimer.started_at_ms);
    return Math.min(100, Math.round((elapsedMs / (restTimer.duration_seconds * 1_000)) * 100));
  }, [nowMs, restTimer]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const syncNow = () => setNowMs(Date.now());
    const onVisibility = () => {
      if (document.visibilityState === "visible") syncNow();
    };
    window.addEventListener("focus", syncNow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", syncNow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    setNotificationCapability(detectNotificationCapability());
  }, []);

  useEffect(() => {
    if (restTimeoutRef.current !== null) {
      window.clearTimeout(restTimeoutRef.current);
      restTimeoutRef.current = null;
    }
    if (!restTimer) return;
    const delayMs = Math.max(0, restTimer.ends_at_ms - Date.now());
    restTimeoutRef.current = window.setTimeout(() => setNowMs(Date.now()), delayMs + 30);
    return () => {
      if (restTimeoutRef.current !== null) {
        window.clearTimeout(restTimeoutRef.current);
        restTimeoutRef.current = null;
      }
    };
  }, [restTimer]);

  async function requestDeviceNotifications() {
    if (!("Notification" in window)) {
      setNotificationCapability("unsupported");
      return;
    }
    if (Notification.permission === "granted") {
      setNotificationCapability("granted");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setNotificationCapability(permission);
    } catch {
      setNotificationCapability(detectNotificationCapability());
    }
  }

  function clearRestTimer() {
    setRestTimer(null);
  }

  return {
    restTimer,
    setRestTimer,
    nowMs,
    setNowMs,
    notificationCapability,
    restRemainingSec,
    restRemainingSecSigned,
    restProgressPct,
    requestDeviceNotifications,
    clearRestTimer,
  };
}

// Avisa una sola vez cuando termina el descanso. Va aparte de `useRestTimer` para que el
// componente lo llame DESPUÉS del efecto que restaura el borrador (el orden importa: si no,
// el borrador pisa `notified: true`).
export function useRestFinishedNotice(
  restTimer: RestTimerState | null,
  setRestTimer: Dispatch<SetStateAction<RestTimerState | null>>,
  restRemainingSec: number,
  notificationCapability: NotificationCapability,
) {
  useEffect(() => {
    if (!restTimer || restRemainingSec > 0 || restTimer.notified) return;
    setRestTimer((prev) => {
      if (!prev || prev.notified) return prev;
      return { ...prev, notified: true };
    });
    if (notificationCapability === "granted" && "Notification" in window) {
      try {
        new Notification("Descanso finalizado", {
          body: `Continua con el siguiente ejercicio. Último completado: ${restTimer.exercise_name}.`,
        });
      } catch {
        // El navegador puede bloquear notificaciones en segundo plano.
      }
    }
  }, [notificationCapability, restRemainingSec, restTimer, setRestTimer]);
}
