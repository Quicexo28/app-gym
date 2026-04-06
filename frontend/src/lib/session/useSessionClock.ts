import { useEffect, useState } from "react";

export function useSessionClock(tickMs: number): [number, (next: number) => void] {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), tickMs);
    return () => window.clearInterval(intervalId);
  }, [tickMs]);

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

  return [nowMs, setNowMs];
}
