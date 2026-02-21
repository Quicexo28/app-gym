export type VoiceCommandIntent = "set_reps" | "set_load" | "set_set_effort" | "set_set_completed";

export type ParsedVoiceCommand = {
  intent: VoiceCommandIntent;
  value: number | boolean | null;
  valueText: string | null;
  parserConfidence: number;
};

export type VoiceParseResult =
  | {
      status: "matched";
      normalizedText: string;
      command: ParsedVoiceCommand;
    }
  | {
      status: "no_match";
      normalizedText: string;
      reason: string;
    };

export type WakePhraseMatch = {
  detected: boolean;
  normalizedText: string;
  normalizedCommandText: string;
};

export type VoiceSetTarget = {
  exerciseIndex: number;
  setIndex: number;
  exerciseName: string;
};

export type OfflineRecognizerState = "inactive" | "loading" | "armed" | "listening" | "error";

export type OfflineRecognizerFinalTranscript = {
  text: string;
  confidence: number;
};

export type OfflineRecognizerCallbacks = {
  onStateChange?: (state: OfflineRecognizerState) => void;
  onFinalTranscript?: (result: OfflineRecognizerFinalTranscript) => void;
  onPartialTranscript?: (partial: string) => void;
  onError?: (message: string) => void;
};

