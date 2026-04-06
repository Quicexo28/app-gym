import type { VoiceCommandIntent } from "./types";
import { normalizeVoiceTranscript } from "./wakePhrase";

export const VOICE_TRAINING_STORAGE_KEY = "coach_ai_voice_training_v1";

export const VOICE_TRAINABLE_INTENTS: VoiceCommandIntent[] = [
  "set_reps",
  "set_load",
  "set_set_effort",
  "set_set_completed",
];

export const VOICE_TRAINABLE_INTENT_LABELS: Record<VoiceCommandIntent, string> = {
  set_reps: "Repeticiones",
  set_load: "Carga/Peso",
  set_set_effort: "Esfuerzo (RPE/RIR)",
  set_set_completed: "Marcar serie completa",
};

export type VoiceTrainingProfile = {
  updated_at_ms: number;
  custom_keywords: Record<VoiceCommandIntent, string[]>;
  wake_aliases: string[];
  phrase_corrections: VoicePhraseCorrection[];
};

export type VoicePhraseCorrection = {
  from: string;
  to: string;
};

const MAX_KEYWORDS_PER_INTENT = 80;
const MAX_KEYWORD_LENGTH = 48;
const MAX_WAKE_ALIASES = 20;
const MAX_PHRASE_CORRECTIONS = 80;

function blankKeywords(): Record<VoiceCommandIntent, string[]> {
  return {
    set_reps: [],
    set_load: [],
    set_set_effort: [],
    set_set_completed: [],
  };
}

export function createDefaultVoiceTrainingProfile(): VoiceTrainingProfile {
  return {
    updated_at_ms: 0,
    custom_keywords: blankKeywords(),
    wake_aliases: [],
    phrase_corrections: [],
  };
}

function sanitizeKeyword(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const normalized = normalizeVoiceTranscript(raw).slice(0, MAX_KEYWORD_LENGTH).trim();
  return normalized;
}

function sanitizeKeywordList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const keyword = sanitizeKeyword(item);
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    out.push(keyword);
    if (out.length >= MAX_KEYWORDS_PER_INTENT) break;
  }
  return out;
}

function sanitizePhraseCorrection(raw: unknown): VoicePhraseCorrection | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as { from?: unknown; to?: unknown };
  const from = sanitizeKeyword(source.from);
  const to = sanitizeKeyword(source.to);
  if (!from || !to || from === to) return null;
  return { from, to };
}

function sanitizePhraseCorrections(raw: unknown): VoicePhraseCorrection[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: VoicePhraseCorrection[] = [];
  for (const item of raw) {
    const parsed = sanitizePhraseCorrection(item);
    if (!parsed) continue;
    const key = `${parsed.from}=>${parsed.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
    if (out.length >= MAX_PHRASE_CORRECTIONS) break;
  }
  return out;
}

function normalizeProfile(raw: unknown): VoiceTrainingProfile {
  const base = createDefaultVoiceTrainingProfile();
  if (!raw || typeof raw !== "object") return base;
  const source = raw as {
    updated_at_ms?: unknown;
    custom_keywords?: Partial<Record<VoiceCommandIntent, unknown>>;
    wake_aliases?: unknown;
    phrase_corrections?: unknown;
  };

  const wakeAliases = sanitizeKeywordList(source.wake_aliases).slice(0, MAX_WAKE_ALIASES);
  const phraseCorrections = sanitizePhraseCorrections(source.phrase_corrections);

  return {
    updated_at_ms:
      typeof source.updated_at_ms === "number" && Number.isFinite(source.updated_at_ms)
        ? source.updated_at_ms
        : 0,
    custom_keywords: {
      set_reps: sanitizeKeywordList(source.custom_keywords?.set_reps),
      set_load: sanitizeKeywordList(source.custom_keywords?.set_load),
      set_set_effort: sanitizeKeywordList(source.custom_keywords?.set_set_effort),
      set_set_completed: sanitizeKeywordList(source.custom_keywords?.set_set_completed),
    },
    wake_aliases: wakeAliases,
    phrase_corrections: phraseCorrections,
  };
}

export function loadVoiceTrainingProfile(): VoiceTrainingProfile {
  if (typeof window === "undefined") return createDefaultVoiceTrainingProfile();
  try {
    const raw = window.localStorage.getItem(VOICE_TRAINING_STORAGE_KEY);
    if (!raw) return createDefaultVoiceTrainingProfile();
    return normalizeProfile(JSON.parse(raw));
  } catch {
    return createDefaultVoiceTrainingProfile();
  }
}

export function saveVoiceTrainingProfile(profile: VoiceTrainingProfile): VoiceTrainingProfile {
  const normalized: VoiceTrainingProfile = {
    ...normalizeProfile(profile),
    updated_at_ms: Date.now(),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(VOICE_TRAINING_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function clearVoiceTrainingProfile(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(VOICE_TRAINING_STORAGE_KEY);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyVoicePhraseCorrections(text: string, corrections: VoicePhraseCorrection[]): string {
  let normalized = normalizeVoiceTranscript(text);
  if (!normalized || corrections.length === 0) return normalized;

  const sorted = [...corrections].sort((a, b) => b.from.length - a.from.length);
  for (const correction of sorted) {
    const from = normalizeVoiceTranscript(correction.from);
    const to = normalizeVoiceTranscript(correction.to);
    if (!from || !to || from === to) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(from)}\\b`, "g");
    normalized = normalized.replace(pattern, to).replace(/\s+/g, " ").trim();
  }

  return normalized;
}
