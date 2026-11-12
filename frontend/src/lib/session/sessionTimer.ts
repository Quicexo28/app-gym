import type { SessionTimerState } from "./types";

export const IDLE_SESSION_TIMER: SessionTimerState = {
  started_at_ms: null,
  running_since_ms: null,
  accumulated_ms: 0,
  completed_at_ms: null,
};

export const TICK_MS = 1_000;

export function createRunningSessionTimer(nowMs: number): SessionTimerState {
  return {
    started_at_ms: nowMs,
    running_since_ms: nowMs,
    accumulated_ms: 0,
    completed_at_ms: null,
  };
}

export function computeSessionElapsedMs(timer: SessionTimerState, nowMs: number): number {
  const chunkMs = timer.running_since_ms === null ? 0 : Math.max(0, nowMs - timer.running_since_ms);
  return Math.max(0, timer.accumulated_ms + chunkMs);
}

export function pauseSessionTimerState(timer: SessionTimerState, nowMs: number): SessionTimerState {
  if (timer.running_since_ms === null || timer.completed_at_ms !== null) return timer;
  return {
    ...timer,
    running_since_ms: null,
    accumulated_ms: computeSessionElapsedMs(timer, nowMs),
  };
}

export function resumeSessionTimerState(timer: SessionTimerState, nowMs: number): SessionTimerState {
  if (timer.completed_at_ms !== null) return timer;
  if (timer.running_since_ms !== null) return timer;
  if (timer.started_at_ms === null) {
    return createRunningSessionTimer(nowMs);
  }
  return {
    ...timer,
    running_since_ms: nowMs,
  };
}

export function completeSessionTimerState(timer: SessionTimerState, nowMs: number): SessionTimerState {
  if (timer.completed_at_ms !== null) return timer;
  const elapsedMs = computeSessionElapsedMs(timer, nowMs);
  return {
    started_at_ms: timer.started_at_ms ?? nowMs,
    running_since_ms: null,
    accumulated_ms: elapsedMs,
    completed_at_ms: nowMs,
  };
}

export function formatTimer(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatTimerSigned(totalSeconds: number): string {
  if (totalSeconds < 0) return `-${formatTimer(-totalSeconds)}`;
  return formatTimer(totalSeconds);
}
