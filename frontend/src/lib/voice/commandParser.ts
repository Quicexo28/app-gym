import type { ParsedVoiceCommand, VoiceCommandIntent, VoiceParseResult } from "./types";
import { normalizeVoiceTranscript } from "./wakePhrase";

type IntentKeywords = Record<VoiceCommandIntent, string[]>;

export type VoiceParserOptions = {
  extraKeywords?: Partial<Record<VoiceCommandIntent, string[]>>;
  allowImplicitLoad?: boolean;
};

export type ParsedVoiceCommandBatch = {
  commands: ParsedVoiceCommand[];
  parserConfidence: number;
  valueText: string | null;
};

export type VoiceCommandBatchParseResult =
  | {
      status: "matched";
      normalizedText: string;
      batch: ParsedVoiceCommandBatch;
    }
  | {
      status: "no_match";
      normalizedText: string;
      reason: string;
    };

export type ParsedVoiceSetTuple = {
  load: number;
  reps: number;
  effort: number;
  complete: boolean;
  parserConfidence: number;
  valueText: string;
};

export type VoiceSetTupleParseResult =
  | {
      status: "matched";
      normalizedText: string;
      tuple: ParsedVoiceSetTuple;
    }
  | {
      status: "no_match";
      normalizedText: string;
      reason: string;
    };

const BASE_INTENT_KEYWORDS: IntentKeywords = {
  set_load: ["peso", "carga", "kilo", "kilos", "kilogramo", "kilogramos", "kg", "libra", "libras", "lb"],
  set_reps: ["rep", "reps", "repeticion", "repeticiones"],
  set_set_effort: ["rpe", "rir", "esfuerzo", "intensidad", "arroba"],
  set_set_completed: [
    "completa",
    "completar",
    "completado",
    "completada",
    "listo",
    "terminado",
    "terminada",
    "marcar serie",
    "completar sugerencias",
    "llenar sugerencias",
    "aplicar sugerencias",
  ],
};

const UNIT_WORDS: Record<string, number> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
};

const FIXED_NUMBER_WORDS: Record<string, number> = {
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veinti: 20,
  veintiun: 21,
  veintiuno: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
};

const TENS_WORDS: Record<string, number> = {
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
};

const HUNDREDS_WORDS: Record<string, number> = {
  cien: 100,
  ciento: 100,
  doscientos: 200,
  trescientos: 300,
  cuatrocientos: 400,
  quinientos: 500,
  seiscientos: 600,
  setecientos: 700,
  ochocientos: 800,
  novecientos: 900,
};

const AUTO_CORRECT_FIXED_TOKENS = [
  "peso",
  "carga",
  "kilo",
  "kilos",
  "kilogramo",
  "kilogramos",
  "kg",
  "libra",
  "libras",
  "lb",
  "rep",
  "reps",
  "repeticion",
  "repeticiones",
  "rpe",
  "rir",
  "esfuerzo",
  "intensidad",
  "arroba",
  "completa",
  "completado",
  "completada",
  "listo",
  "terminado",
  "terminada",
  "marcar",
  "serie",
  "por",
  "x",
  "diez",
] as const;

const TOKEN_NORMALIZATION_ALIASES: Record<string, string> = {
  kilogramos: "kilos",
  kilogramo: "kilo",
  kilograms: "kilos",
  dias: "diez",
  diaz: "diez",
  dies: "diez",
  diex: "diez",
  diezz: "diez",
};

type IntentDetection = {
  intent: VoiceCommandIntent;
  index: number;
};

type SpokenNumberParse = {
  value: number;
  nextIndex: number;
};

function mergeIntentKeywords(options?: VoiceParserOptions): IntentKeywords {
  const out: IntentKeywords = {
    set_load: [...BASE_INTENT_KEYWORDS.set_load],
    set_reps: [...BASE_INTENT_KEYWORDS.set_reps],
    set_set_effort: [...BASE_INTENT_KEYWORDS.set_set_effort],
    set_set_completed: [...BASE_INTENT_KEYWORDS.set_set_completed],
  };
  if (!options?.extraKeywords) return out;

  for (const intent of Object.keys(out) as VoiceCommandIntent[]) {
    const extra = options.extraKeywords[intent];
    if (!Array.isArray(extra) || extra.length === 0) continue;

    const seen = new Set(out[intent]);
    for (const rawKeyword of extra) {
      const normalizedKeyword = normalizeVoiceTranscript(rawKeyword);
      if (!normalizedKeyword || seen.has(normalizedKeyword)) continue;
      out[intent].push(normalizedKeyword);
      seen.add(normalizedKeyword);
    }
  }

  return out;
}

function maxAutoCorrectDistance(token: string): number {
  if (token.length <= 4) return 1;
  if (token.length <= 7) return 2;
  return 3;
}

function levenshteinDistance(a: string, b: string, maxDistance: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const curr = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    for (let j = 0; j <= b.length; j += 1) {
      prev[j] = curr[j];
    }
  }

  return prev[b.length];
}

function autoCorrectVocabulary(options?: VoiceParserOptions): string[] {
  const unique = new Set<string>(AUTO_CORRECT_FIXED_TOKENS);
  const intentKeywords = mergeIntentKeywords(options);
  for (const keywords of Object.values(intentKeywords)) {
    for (const keyword of keywords) {
      const tokens = normalizeVoiceTranscript(keyword).split(/\s+/).filter(Boolean);
      for (const token of tokens) {
        unique.add(token);
      }
    }
  }
  return [...unique];
}

function autoCorrectToken(token: string, vocabulary: readonly string[]): string {
  if (!token || asNumericToken(token) !== null) return token;
  if (token.length < 4) return token;
  if (vocabulary.includes(token)) return token;

  const maxDistance = maxAutoCorrectDistance(token);
  let best = token;
  let bestDistance = Number.POSITIVE_INFINITY;
  let tie = false;

  for (const candidate of vocabulary) {
    if (candidate === token) return token;
    if (Math.abs(candidate.length - token.length) > maxDistance) continue;
    const distance = levenshteinDistance(token, candidate, maxDistance);
    if (distance > maxDistance) continue;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      tie = false;
      continue;
    }
    if (distance === bestDistance) {
      tie = true;
    }
  }

  if (bestDistance === Number.POSITIVE_INFINITY || tie) return token;
  return best;
}

function normalizeCommandConnectors(text: string): string {
  const normalizedAliases = text
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => TOKEN_NORMALIZATION_ALIASES[token] || token)
    .join(" ");

  return normalizedAliases
    .replace(/\ba\s*roba\b/g, "arroba")
    .replace(/\barro\s*ba\b/g, "arroba")
    .replace(/\br\s*p\s*e\b/g, "rpe")
    .replace(/\br\s*i\s*r\b/g, "rir")
    .replace(/\s+/g, " ")
    .trim();
}

function autoCorrectCommandText(normalizedText: string, options?: VoiceParserOptions): string {
  if (!normalizedText) return "";
  const vocabulary = autoCorrectVocabulary(options);
  const correctedTokens = normalizedText
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => autoCorrectToken(token, vocabulary));
  return normalizeCommandConnectors(correctedTokens.join(" "));
}

function keywordToRegex(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (keyword.includes(" ")) {
    return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, "i");
  }
  return new RegExp(`\\b${escaped}\\b`, "i");
}

function detectIntentCandidates(normalizedText: string, intentKeywords: IntentKeywords): IntentDetection[] {
  const out: IntentDetection[] = [];
  for (const [intent, keywords] of Object.entries(intentKeywords) as Array<[VoiceCommandIntent, string[]]>) {
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

function asNumericToken(token: string): number | null {
  if (!token) return null;
  if (!/^-?\d+(?:[.,]\d+)?$/.test(token)) return null;
  const value = Number(token.replace(",", "."));
  if (!Number.isFinite(value)) return null;
  return value;
}

function parseSpokenNumberAt(tokens: string[], startIndex: number): SpokenNumberParse | null {
  let index = startIndex;
  let total = 0;
  let current = 0;
  let consumed = false;
  let consumedNumericUnit = false;

  while (index < tokens.length) {
    const token = tokens[index];
    if (!token || asNumericToken(token) !== null) break;

    if (token === "y") {
      index += 1;
      continue;
    }

    if (token === "mil") {
      const factor = current === 0 ? 1 : current;
      total += factor * 1_000;
      current = 0;
      consumed = true;
      consumedNumericUnit = false;
      index += 1;
      continue;
    }

    if (token === "dieci") {
      const nextUnit = UNIT_WORDS[tokens[index + 1] || ""];
      if (typeof nextUnit === "number") {
        current += 10 + nextUnit;
        consumed = true;
        consumedNumericUnit = true;
        index += 2;
        continue;
      }
    }

    if (token === "veinti") {
      const nextUnit = UNIT_WORDS[tokens[index + 1] || ""];
      if (typeof nextUnit === "number") {
        current += 20 + nextUnit;
        consumed = true;
        consumedNumericUnit = true;
        index += 2;
        continue;
      }
      current += 20;
      consumed = true;
      consumedNumericUnit = true;
      index += 1;
      continue;
    }

    const hundred = HUNDREDS_WORDS[token];
    if (typeof hundred === "number") {
      current += hundred;
      consumed = true;
      consumedNumericUnit = false;
      index += 1;
      continue;
    }

    const fixed = FIXED_NUMBER_WORDS[token];
    if (typeof fixed === "number") {
      current += fixed;
      consumed = true;
      consumedNumericUnit = true;
      index += 1;
      continue;
    }

    const tens = TENS_WORDS[token];
    if (typeof tens === "number") {
      current += tens;
      consumed = true;
      consumedNumericUnit = false;
      index += 1;
      continue;
    }

    const unit = UNIT_WORDS[token];
    if (typeof unit === "number") {
      if (consumedNumericUnit) break;
      current += unit;
      consumed = true;
      consumedNumericUnit = true;
      index += 1;
      continue;
    }

    break;
  }

  if (!consumed) return null;
  return {
    value: total + current,
    nextIndex: index,
  };
}

function formatNumericValue(value: number, forceInteger: boolean): string {
  if (forceInteger) return String(Math.round(value));
  return String(Number(value.toFixed(2)));
}

function normalizeNumbersInTranscript(normalizedText: string): string {
  if (!normalizedText) return "";
  const tokens = normalizedText.split(/\s+/).filter(Boolean);
  const out: string[] = [];

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    const numericToken = asNumericToken(token);
    if (numericToken !== null) {
      out.push(formatNumericValue(numericToken, false));
      index += 1;
      continue;
    }

    const spoken = parseSpokenNumberAt(tokens, index);
    if (!spoken) {
      out.push(token);
      index += 1;
      continue;
    }

    out.push(formatNumericValue(spoken.value, true));
    index = spoken.nextIndex;
  }

  return out.join(" ").trim();
}

type NumberSpan = {
  value: number;
  start: number;
  end: number;
};

const TUPLE_LOAD_UNIT_TOKENS = new Set(["kg", "kilo", "kilos", "kilogramo", "kilogramos", "lb", "libra", "libras"]);
const TUPLE_REPS_CONNECTOR_TOKENS = new Set(["por", "x", "a"]);
const TUPLE_REPS_UNIT_TOKENS = new Set(["rep", "reps", "repeticion", "repeticiones"]);
const TUPLE_EFFORT_MARKER_TOKENS = new Set(["arroba", "rpe", "rir"]);
const TUPLE_FILLER_TOKENS = new Set(["de", "a", "al"]);

function extractNumberSpans(text: string): NumberSpan[] {
  const regex = /-?\d+(?:[.,]\d+)?/g;
  const spans: NumberSpan[] = [];
  for (const match of text.matchAll(regex)) {
    const raw = String(match[0] || "");
    const start = typeof match.index === "number" ? match.index : -1;
    if (start < 0) continue;
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value)) continue;
    spans.push({
      value,
      start,
      end: start + raw.length,
    });
  }
  return spans;
}

function extractAllNumbers(text: string): number[] {
  return extractNumberSpans(text).map((span) => span.value);
}

function extractFirstNumber(text: string): number | null {
  const values = extractAllNumbers(text);
  if (values.length === 0) return null;
  return values[0];
}

function extractCompactTupleByTokens(
  normalizedText: string,
): {
  load: number;
  reps: number;
  effort: number;
} | null {
  const tokens = normalizedText.split(/\s+/).filter(Boolean);
  if (tokens.length < 5) return null;

  for (let index = 0; index < tokens.length; index += 1) {
    const loadValue = asNumericToken(tokens[index]);
    if (loadValue === null) continue;

    let cursor = index + 1;
    if (cursor < tokens.length && TUPLE_LOAD_UNIT_TOKENS.has(tokens[cursor])) {
      cursor += 1;
    }
    if (cursor >= tokens.length || !TUPLE_REPS_CONNECTOR_TOKENS.has(tokens[cursor])) {
      continue;
    }
    cursor += 1;

    const repsValue = cursor < tokens.length ? asNumericToken(tokens[cursor]) : null;
    if (repsValue === null) continue;
    cursor += 1;

    if (cursor < tokens.length && TUPLE_REPS_UNIT_TOKENS.has(tokens[cursor])) {
      cursor += 1;
    }
    while (cursor < tokens.length && TUPLE_FILLER_TOKENS.has(tokens[cursor])) {
      cursor += 1;
    }
    if (cursor >= tokens.length || !TUPLE_EFFORT_MARKER_TOKENS.has(tokens[cursor])) {
      continue;
    }
    cursor += 1;

    while (cursor < tokens.length && TUPLE_FILLER_TOKENS.has(tokens[cursor])) {
      cursor += 1;
    }
    const effortValue = cursor < tokens.length ? asNumericToken(tokens[cursor]) : null;
    if (effortValue === null) continue;

    return {
      load: loadValue,
      reps: repsValue,
      effort: effortValue,
    };
  }

  return null;
}

function extractCompactLoadReps(
  normalizedText: string,
): {
  load: number;
  reps: number;
} | null {
  if (!normalizedText) return null;
  if (/(?:^|\s)(?:arroba|rpe|rir)(?:\s|$)/.test(normalizedText)) return null;

  const compactMatch = normalizedText.match(
    /(-?\d+(?:[.,]\d+)?)\s*(?:kg|kilo|kilos|kilogramo|kilogramos|lb|libra|libras)?\s*(?:a|por|x)\s*(-?\d+(?:[.,]\d+)?)(?:\s*(?:reps?|repeticiones?))?/,
  );
  if (!compactMatch) return null;

  const load = Number(String(compactMatch[1] || "").replace(",", "."));
  const reps = Number(String(compactMatch[2] || "").replace(",", "."));
  if (!Number.isFinite(load) || !Number.isFinite(reps)) return null;
  if (load < 0 || reps <= 0) return null;
  return { load, reps };
}

function matchedResult(normalizedText: string, command: ParsedVoiceCommand): VoiceParseResult {
  return {
    status: "matched",
    normalizedText,
    command,
  };
}

export function normalizeVoiceCommandText(rawTranscript: string, options?: VoiceParserOptions): string {
  const normalized = normalizeNumbersInTranscript(normalizeVoiceTranscript(rawTranscript));
  return autoCorrectCommandText(normalized, options);
}

function parseCommandForIntent(intent: VoiceCommandIntent, numberValue: number | null): ParsedVoiceCommand | null {
  if (intent === "set_set_completed") {
    return {
      intent,
      value: true,
      valueText: "true",
      parserConfidence: 0.9,
    };
  }

  if (numberValue === null || !Number.isFinite(numberValue) || numberValue < 0) {
    return null;
  }

  if (intent === "set_reps") {
    const repsValue = Math.round(numberValue);
    if (repsValue <= 0) return null;
    return {
      intent,
      value: repsValue,
      valueText: formatNumericValue(repsValue, true),
      parserConfidence: 0.9,
    };
  }

  if (intent === "set_load") {
    return {
      intent,
      value: Number(numberValue.toFixed(2)),
      valueText: formatNumericValue(numberValue, false),
      parserConfidence: 0.88,
    };
  }

  return {
    intent,
    value: Number(numberValue.toFixed(2)),
    valueText: formatNumericValue(numberValue, false),
    parserConfidence: 0.86,
  };
}

function extractIntentValueFromZone(
  intent: VoiceCommandIntent,
  candidateIndex: number,
  zoneStart: number,
  zoneEnd: number,
  spans: NumberSpan[],
): number | null {
  if (intent === "set_set_completed") return null;
  const zoneSpans = spans.filter((span) => span.start >= zoneStart && span.end <= zoneEnd);
  if (zoneSpans.length === 0) return null;

  let best = zoneSpans[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const span of zoneSpans) {
    const center = span.start + (span.end - span.start) / 2;
    const distance = Math.abs(center - candidateIndex);
    if (distance < bestDistance) {
      best = span;
      bestDistance = distance;
    }
  }
  return best.value;
}

function formatBatchValueText(commands: ParsedVoiceCommand[]): string | null {
  const parts: string[] = [];
  for (const command of commands) {
    if (command.intent === "set_load") parts.push(`carga ${command.valueText}`);
    if (command.intent === "set_reps") parts.push(`reps ${command.valueText}`);
    if (command.intent === "set_set_effort") parts.push(`esfuerzo ${command.valueText}`);
    if (command.intent === "set_set_completed") parts.push("completar");
  }
  if (parts.length === 0) return null;
  return parts.join(" | ");
}

function averageConfidence(commands: ParsedVoiceCommand[]): number {
  if (commands.length === 0) return 0;
  const sum = commands.reduce((acc, item) => acc + item.parserConfidence, 0);
  return Number((sum / commands.length).toFixed(3));
}

export function parseVoiceCommandBatch(rawTranscript: string, options?: VoiceParserOptions): VoiceCommandBatchParseResult {
  const normalizedText = normalizeVoiceCommandText(rawTranscript, options);
  if (!normalizedText) {
    return {
      status: "no_match",
      normalizedText: "",
      reason: "No se detecto texto util en el comando.",
    };
  }

  const candidates = detectIntentCandidates(normalizedText, mergeIntentKeywords(options));
  if (candidates.length < 2) {
    const compactLoadReps = extractCompactLoadReps(normalizedText);
    if (compactLoadReps) {
      const commands: ParsedVoiceCommand[] = [
        {
          intent: "set_load",
          value: Number(compactLoadReps.load.toFixed(2)),
          valueText: formatNumericValue(compactLoadReps.load, false),
          parserConfidence: 0.93,
        },
        {
          intent: "set_reps",
          value: Math.round(compactLoadReps.reps),
          valueText: formatNumericValue(compactLoadReps.reps, true),
          parserConfidence: 0.93,
        },
      ];
      return {
        status: "matched",
        normalizedText,
        batch: {
          commands,
          parserConfidence: averageConfidence(commands),
          valueText: formatBatchValueText(commands),
        },
      };
    }

    return {
      status: "no_match",
      normalizedText,
      reason: "No detecte multiples acciones en la misma frase.",
    };
  }

  const spans = extractNumberSpans(normalizedText);
  const commands: ParsedVoiceCommand[] = [];
  const intentSet = new Set<VoiceCommandIntent>();

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (intentSet.has(candidate.intent)) continue;

    const previous = candidates[index - 1];
    const next = candidates[index + 1];
    const zoneStart = previous ? previous.index : 0;
    const zoneEnd = next ? next.index : normalizedText.length;
    const value = extractIntentValueFromZone(candidate.intent, candidate.index, zoneStart, zoneEnd, spans);
    const command = parseCommandForIntent(candidate.intent, value);
    if (!command) {
      return {
        status: "no_match",
        normalizedText,
        reason: `No pude extraer valor para ${candidate.intent} en comando multiple.`,
      };
    }
    commands.push(command);
    intentSet.add(candidate.intent);
  }

  if (commands.length < 2) {
    return {
      status: "no_match",
      normalizedText,
      reason: "No detecte suficientes acciones validas para comando multiple.",
    };
  }

  return {
    status: "matched",
    normalizedText,
    batch: {
      commands,
      parserConfidence: averageConfidence(commands),
      valueText: formatBatchValueText(commands),
    },
  };
}

export function parseVoiceSetTuple(rawTranscript: string): VoiceSetTupleParseResult {
  const normalizedText = normalizeVoiceCommandText(rawTranscript);
  if (!normalizedText) {
    return {
      status: "no_match",
      normalizedText: "",
      reason: "No se detecto texto util en el comando.",
    };
  }

  const tupleMatch = normalizedText.match(
    /(-?\d+(?:[.,]\d+)?)\s*(?:kg|kilo|kilos|kilogramo|kilogramos|lb|libra|libras)?\s*(?:por|x|a)\s*(-?\d+(?:[.,]\d+)?)\s*(?:reps?|repeticiones?)?\s*(?:arroba|rpe|rir|@)\s*(-?\d+(?:[.,]\d+)?)/,
  );
  const tokenTuple = tupleMatch
    ? null
    : extractCompactTupleByTokens(normalizedText);
  if (!tupleMatch && !tokenTuple) {
    return {
      status: "no_match",
      normalizedText,
      reason: "No detecte formato compacto de set (carga por reps arroba esfuerzo).",
    };
  }

  const load = tupleMatch ? Number(tupleMatch[1].replace(",", ".")) : Number(tokenTuple?.load);
  const reps = tupleMatch ? Number(tupleMatch[2].replace(",", ".")) : Number(tokenTuple?.reps);
  const effort = tupleMatch ? Number(tupleMatch[3].replace(",", ".")) : Number(tokenTuple?.effort);
  const complete = /(?:^|\s)(?:completa(?:r|do|da)?|listo|terminad[oa]|marcar serie)(?:\s|$)/i.test(normalizedText);
  if (!Number.isFinite(load) || !Number.isFinite(reps) || !Number.isFinite(effort)) {
    return {
      status: "no_match",
      normalizedText,
      reason: "No pude convertir los valores numericos del comando compacto.",
    };
  }
  if (load < 0 || reps <= 0 || effort < 0) {
    return {
      status: "no_match",
      normalizedText,
      reason: "Valores invalidos en comando compacto: carga>=0, reps>0, esfuerzo>=0.",
    };
  }

  const tuple: ParsedVoiceSetTuple = {
    load: Number(load.toFixed(2)),
    reps: Math.round(reps),
    effort: Number(effort.toFixed(2)),
    complete,
    parserConfidence: complete ? 0.96 : 0.95,
    valueText: `${formatNumericValue(load, false)}x${formatNumericValue(reps, true)}@${formatNumericValue(effort, false)}${
      complete ? " | completar" : ""
    }`,
  };
  return {
    status: "matched",
    normalizedText,
    tuple,
  };
}

export function parseVoiceCommand(rawTranscript: string, options?: VoiceParserOptions): VoiceParseResult {
  const normalizedText = normalizeVoiceCommandText(rawTranscript, options);
  if (!normalizedText) {
    return {
      status: "no_match",
      normalizedText: "",
      reason: "No se detecto texto util en el comando.",
    };
  }

  const candidates = detectIntentCandidates(normalizedText, mergeIntentKeywords(options));
  if (candidates.length === 0) {
    const allNumbers = extractAllNumbers(normalizedText);
    if ((options?.allowImplicitLoad ?? true) && allNumbers.length === 1 && allNumbers[0] >= 0) {
      return matchedResult(normalizedText, {
        intent: "set_load",
        value: Number(allNumbers[0].toFixed(2)),
        valueText: formatNumericValue(allNumbers[0], false),
        parserConfidence: 0.62,
      });
    }
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
  const numberValue = extractFirstNumber(normalizedText);
  const parsedCommand = parseCommandForIntent(intent, numberValue);
  if (!parsedCommand) {
    if (intent === "set_set_completed") {
      return {
        status: "no_match",
        normalizedText,
        reason: "No pude aplicar el comando de completar set.",
      };
    }
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
    return {
      status: "no_match",
      normalizedText,
      reason: "No pude validar el valor numerico para el comando detectado.",
    };
  }
  return matchedResult(normalizedText, parsedCommand);
}
