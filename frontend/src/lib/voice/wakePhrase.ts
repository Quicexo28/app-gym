import type { WakePhraseMatch } from "./types";

function removeDiacritics(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeVoiceTranscript(rawText: string): string {
  const lowered = removeDiacritics(rawText.toLowerCase());
  return lowered
    .replace(/[^a-z0-9.,\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wakeRegex(wakePhrase: string): RegExp {
  const escaped = wakePhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i");
}

export function extractWakePhrase(rawText: string, wakePhrase: string): WakePhraseMatch {
  const normalizedText = normalizeVoiceTranscript(rawText);
  if (!normalizedText) {
    return {
      detected: false,
      normalizedText: "",
      normalizedCommandText: "",
    };
  }

  const regex = wakeRegex(normalizeVoiceTranscript(wakePhrase));
  const detected = regex.test(normalizedText);
  if (!detected) {
    return {
      detected: false,
      normalizedText,
      normalizedCommandText: "",
    };
  }

  const normalizedCommandText = normalizedText.replace(regex, " ").replace(/\s+/g, " ").trim();
  return {
    detected: true,
    normalizedText,
    normalizedCommandText,
  };
}

