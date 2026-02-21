import type { ParsedVoiceCommand, VoiceCommandIntent, VoiceParseResult } from "./types";
import { normalizeVoiceTranscript } from "./wakePhrase";

const INTENT_KEYWORDS: Record<VoiceCommandIntent, string[]> = {
  set_load: ["peso", "carga", "kilo", "kilos", "kg", "libra", "libras", "lb"],
  set_reps: ["rep", "reps", "repeticion", "repeticiones"],
  set_set_effort: ["rpe", "rir", "esfuerzo", "intensidad"],
  set_set_completed: ["completa", "completado", "completada", "listo", "terminado", "terminada", "marcar serie"],
};

type IntentDetection = {
  intent: VoiceCommandIntent;
  index: number;
};

function keywordToRegex(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (keyword.includes(" ")) {
    return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, "i");
  }
  return new RegExp(`\\b${escaped}\\b`, "i");
}

function detectIntentCandidates(normalizedText: string): IntentDetection[] {
  const out: IntentDetection[] = [];
  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS) as Array<[VoiceCommandIntent, string[]]>) {
    let bestIndex = Number.POSITIVE_INFINITY;
    for (const keyword of keywords) {
      const regex = keywordToRegex(keyword);
      const match = normalizedText.match(regex);
      if (match === null || typeof match.index !== "number") continue;
      bestIndex = Math.min(bestIndex, match.index);
    }
    if (bestIndex !== Number.POSITIVE_INFINITY) {
      out.push({ intent, index: bestIndex });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

function extractFirstNumber(text: string): number | null {
  const match = text.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const value = Number(match[0].replace(",", "."));
  if (!Number.isFinite(value)) return null;
  return value;
}

function formatNumericValue(value: number, forceInteger: boolean): string {
  if (forceInteger) return String(Math.round(value));
  return String(Number(value.toFixed(2)));
}

function matchedResult(normalizedText: string, command: ParsedVoiceCommand): VoiceParseResult {
  return {
    status: "matched",
    normalizedText,
    command,
  };
}

export function parseVoiceCommand(rawTranscript: string): VoiceParseResult {
  const normalizedText = normalizeVoiceTranscript(rawTranscript);
  if (!normalizedText) {
    return {
      status: "no_match",
      normalizedText: "",
      reason: "No se detecto texto util en el comando.",
    };
  }

  const candidates = detectIntentCandidates(normalizedText);
  if (candidates.length === 0) {
    return {
      status: "no_match",
      normalizedText,
      reason: "No se detecto ninguna accion de set soportada.",
    };
  }
  if (candidates.length > 1) {
    return {
      status: "no_match",
      normalizedText,
      reason: "Comando ambiguo: detecte mas de una accion en la misma frase.",
    };
  }

  const [{ intent }] = candidates;
  if (intent === "set_set_completed") {
    return matchedResult(normalizedText, {
      intent,
      value: true,
      valueText: "true",
      parserConfidence: 0.9,
    });
  }

  const numberValue = extractFirstNumber(normalizedText);
  if (numberValue === null) {
    return {
      status: "no_match",
      normalizedText,
      reason: "Falta un valor numerico para aplicar el comando.",
    };
  }
  if (numberValue < 0) {
    return {
      status: "no_match",
      normalizedText,
      reason: "El valor numerico no puede ser negativo.",
    };
  }

  if (intent === "set_reps") {
    const repsValue = Math.round(numberValue);
    if (repsValue <= 0) {
      return {
        status: "no_match",
        normalizedText,
        reason: "Las repeticiones deben ser mayores a cero.",
      };
    }
    return matchedResult(normalizedText, {
      intent,
      value: repsValue,
      valueText: formatNumericValue(repsValue, true),
      parserConfidence: 0.9,
    });
  }

  if (intent === "set_load") {
    return matchedResult(normalizedText, {
      intent,
      value: Number(numberValue.toFixed(2)),
      valueText: formatNumericValue(numberValue, false),
      parserConfidence: 0.88,
    });
  }

  return matchedResult(normalizedText, {
    intent,
    value: Number(numberValue.toFixed(2)),
    valueText: formatNumericValue(numberValue, false),
    parserConfidence: 0.86,
  });
}

