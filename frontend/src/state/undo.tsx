/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

const DEFAULT_TIMEOUT_MS = 7000;
const MAX_QUEUE_ITEMS = 20;

export type UndoRegistration = {
  message: string;
  actionLabel?: string;
  timeoutMs?: number;
  onUndo: () => void | Promise<void>;
};

type UndoQueueItem = {
  id: string;
  message: string;
  actionLabel: string;
  timeoutMs: number;
  onUndo: () => void | Promise<void>;
};

type UndoContextValue = {
  current: UndoQueueItem | null;
  pending: boolean;
  queueSize: number;
  registerUndo: (registration: UndoRegistration) => void;
  undoCurrent: () => Promise<void>;
  dismissCurrent: () => void;
  clearQueue: () => void;
};

const UndoContext = createContext<UndoContextValue | null>(null);

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.floor(timeoutMs);
}

function shiftQueue(items: UndoQueueItem[]): UndoQueueItem[] {
  if (items.length <= 1) return [];
  return items.slice(1);
}

function appendWithCompression(items: UndoQueueItem[], nextItem: UndoQueueItem): UndoQueueItem[] {
  const previous = items[items.length - 1];

  // Si el último item es equivalente, reemplazamos para evitar ruido de cola.
  if (
    previous &&
    previous.message === nextItem.message &&
    previous.actionLabel === nextItem.actionLabel &&
    previous.timeoutMs === nextItem.timeoutMs
  ) {
    const replaced = [...items];
    replaced[replaced.length - 1] = nextItem;
    return replaced;
  }

  const appended = [...items, nextItem];
  if (appended.length <= MAX_QUEUE_ITEMS) return appended;

  // Conserva el actual y recorta el backlog antiguo.
  const current = appended[0];
  const tail = appended.slice(-(MAX_QUEUE_ITEMS - 1));
  return [current, ...tail];
}

export function UndoProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<UndoQueueItem[]>([]);
  const [pending, setPending] = useState(false);
  const nextIdRef = useRef(1);

  const current = queue[0] || null;
  const queueSize = queue.length;

  const registerUndo = useCallback((registration: UndoRegistration) => {
    const message = registration.message.trim();
    if (!message) return;

    const id = String(nextIdRef.current++);
    const nextItem: UndoQueueItem = {
      id,
      message,
      actionLabel: registration.actionLabel?.trim() || "Deshacer",
      timeoutMs: normalizeTimeout(registration.timeoutMs),
      onUndo: registration.onUndo,
    };
    setQueue((prev) => appendWithCompression(prev, nextItem));
  }, []);

  const dismissCurrent = useCallback(() => {
    if (pending) return;
    setQueue((prev) => shiftQueue(prev));
  }, [pending]);

  const clearQueue = useCallback(() => {
    if (pending) return;
    setQueue([]);
  }, [pending]);

  const undoCurrent = useCallback(async () => {
    const item = current;
    if (!item || pending) return;

    setPending(true);
    try {
      await item.onUndo();
      setQueue((prev) => {
        if (prev.length === 0) return prev;
        if (prev[0]?.id === item.id) return shiftQueue(prev);
        return prev.filter((entry) => entry.id !== item.id);
      });
    } catch (cause) {
      // The caller may retry while this item remains active in the queue.
      console.error("Undo action failed", cause);
    } finally {
      setPending(false);
    }
  }, [current, pending]);

  useEffect(() => {
    if (!current || pending) return;

    const timer = window.setTimeout(() => {
      setQueue((prev) => {
        if (prev[0]?.id !== current.id) return prev;
        return shiftQueue(prev);
      });
    }, current.timeoutMs);

    return () => window.clearTimeout(timer);
  }, [current, pending]);

  const value = useMemo<UndoContextValue>(
    () => ({
      current,
      pending,
      queueSize,
      registerUndo,
      undoCurrent,
      dismissCurrent,
      clearQueue,
    }),
    [clearQueue, current, dismissCurrent, pending, queueSize, registerUndo, undoCurrent],
  );

  return <UndoContext.Provider value={value}>{children}</UndoContext.Provider>;
}

export function useUndo(): UndoContextValue {
  const ctx = useContext(UndoContext);
  if (!ctx) {
    throw new Error("useUndo must be used inside UndoProvider");
  }
  return ctx;
}
