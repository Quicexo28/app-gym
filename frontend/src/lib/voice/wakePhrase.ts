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

type WakeCandidateMatch = {
  phrase: string;
  start: number;
  end: number;
  distance: number;
};

function normalizeWakeCandidates(wakePhrases: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawWakePhrase of wakePhrases) {
    const normalizedWake = normalizeVoiceTranscript(rawWakePhrase);
    if (!normalizedWake || seen.has(normalizedWake)) continue;
    seen.add(normalizedWake);
    out.push(normalizedWake);
  }
  return out;
}

function maxWakeDistance(phrase: string): number {
  if (phrase.length <= 5) return 1;
  if (phrase.length <= 10) return 2;
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

type TokenSpan = {
  token: string;
  start: number;
  end: number;
};

function tokenSpans(text: string): TokenSpan[] {
  const out: TokenSpan[] = [];
  const regex = /\S+/g;
  for (const match of text.matchAll(regex)) {
    const token = String(match[0] || "");
    const start = typeof match.index === "number" ? match.index : -1;
    if (!token || start < 0) continue;
    out.push({ token, start, end: start + token.length });
  }
  return out;
}

function findExactWakeMatch(normalizedText: string, wakePhrases: readonly string[]): WakeCandidateMatch | null {
  let best: WakeCandidateMatch | null = null;
  for (const phrase of wakePhrases) {
    const regex = wakeRegex(phrase);
    const match = normalizedText.match(regex);
    const start = typeof match?.index === "number" ? match.index : -1;
    if (start < 0) continue;
    const matchedText = String(match?.[0] || phrase);
    const candidate: WakeCandidateMatch = {
      phrase,
      start,
      end: start + matchedText.length,
      distance: 0,
    };
    if (!best || candidate.start < best.start || (candidate.start === best.start && candidate.phrase.length > best.phrase.length)) {
      best = candidate;
    }
  }
  return best;
}

function findFuzzyWakeMatch(normalizedText: string, wakePhrases: readonly string[]): WakeCandidateMatch | null {
  const spans = tokenSpans(normalizedText);
  if (spans.length === 0) return null;

  let best: WakeCandidateMatch | null = null;
  for (const phrase of wakePhrases) {
    const phraseTokens = phrase.split(/\s+/).filter(Boolean);
    if (phraseTokens.length === 0 || phraseTokens.length > spans.length) continue;

    for (let index = 0; index <= spans.length - phraseTokens.length; index += 1) {
      const chunk = spans.slice(index, index + phraseTokens.length);
      const chunkText = chunk.map((item) => item.token).join(" ");
      const maxDistance = maxWakeDistance(phrase);
      const distance = levenshteinDistance(chunkText, phrase, maxDistance);
      if (distance > maxDistance) continue;

      const candidate: WakeCandidateMatch = {
        phrase,
        start: chunk[0].start,
        end: chunk[chunk.length - 1].end,
        distance,
      };

      if (!best) {
        best = candidate;
        continue;
      }
      if (candidate.distance < best.distance) {
        best = candidate;
        continue;
      }
      if (candidate.distance === best.distance && candidate.start < best.start) {
        best = candidate;
      }
    }
  }

  return best;
}

function findBestWakeMatch(normalizedText: string, wakePhrases: readonly string[]): WakeCandidateMatch | null {
  const exact = findExactWakeMatch(normalizedText, wakePhrases);
  if (exact) return exact;
  return findFuzzyWakeMatch(normalizedText, wakePhrases);
}

export function extractWakePhraseFromCandidates(rawText: string, wakePhrases: readonly string[]): WakePhraseMatch {
  const normalizedText = normalizeVoiceTranscript(rawText);
  if (!normalizedText) {
    return {
      detected: false,
      normalizedText: "",
      normalizedCommandText: "",
      detectedWakePhrase: null,
    };
  }

  const normalizedWakePhrases = normalizeWakeCandidates(wakePhrases);
  const bestMatch = findBestWakeMatch(normalizedText, normalizedWakePhrases);
  if (!bestMatch) {
    return {
      detected: false,
      normalizedText,
      normalizedCommandText: "",
      detectedWakePhrase: null,
    };
  }

  const normalizedCommandText = `${normalizedText.slice(0, bestMatch.start)} ${normalizedText.slice(bestMatch.end)}`
    .replace(/\s+/g, " ")
    .trim();
  return {
    detected: true,
    normalizedText,
    normalizedCommandText,
    detectedWakePhrase: bestMatch.phrase,
  };
}

export function extractWakePhrase(rawText: string, wakePhrase: string): WakePhraseMatch {
  return extractWakePhraseFromCandidates(rawText, [wakePhrase]);
}
