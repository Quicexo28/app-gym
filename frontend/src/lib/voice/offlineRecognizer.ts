import { createModel, type KaldiRecognizer, type Model } from "vosk-browser";

import type {
  OfflineRecognizerCallbacks,
  OfflineRecognizerFinalTranscript,
  OfflineRecognizerState,
} from "./types";

type OfflineRecognizerOptions = {
  modelUrl: string;
  sampleRate?: number;
  callbacks?: OfflineRecognizerCallbacks;
};

type AudioWindowShape = {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

const DEFAULT_SAMPLE_RATE = 16_000;
const PROCESSOR_BUFFER_SIZE = 4_096;

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function getAudioContextCtor(): typeof AudioContext | null {
  const browserWindow = window as unknown as AudioWindowShape;
  return browserWindow.AudioContext ?? browserWindow.webkitAudioContext ?? null;
}

export function browserSupportsOfflineRecognizer(): boolean {
  if (typeof window === "undefined") return false;
  if (!("mediaDevices" in navigator) || typeof navigator.mediaDevices?.getUserMedia !== "function") return false;
  return getAudioContextCtor() !== null;
}

export class OfflineVoskRecognizer {
  private readonly modelUrl: string;

  private readonly sampleRate: number;

  private readonly callbacks: OfflineRecognizerCallbacks;

  private state: OfflineRecognizerState = "inactive";

  private model: Model | null = null;

  private recognizer: KaldiRecognizer | null = null;

  private mediaStream: MediaStream | null = null;

  private audioContext: AudioContext | null = null;

  private mediaSource: MediaStreamAudioSourceNode | null = null;

  private processorNode: ScriptProcessorNode | null = null;

  private silenceNode: GainNode | null = null;

  private initializationPromise: Promise<void> | null = null;

  constructor(options: OfflineRecognizerOptions) {
    this.modelUrl = options.modelUrl;
    this.sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
    this.callbacks = options.callbacks ?? {};
  }

  getState(): OfflineRecognizerState {
    return this.state;
  }

  private setState(nextState: OfflineRecognizerState): void {
    if (this.state === nextState) return;
    this.state = nextState;
    this.callbacks.onStateChange?.(nextState);
  }

  private setError(message: string): void {
    this.callbacks.onError?.(message);
    this.setState("error");
  }

  private async ensureModel(): Promise<void> {
    if (this.model) return;
    this.model = await createModel(this.modelUrl);
  }

  private handleFinalResult(payload: unknown): void {
    const result = payload as { result?: { text?: string; result?: Array<{ conf?: number }> } };
    const text = String(result?.result?.text ?? "").trim();
    if (!text) {
      this.setState("armed");
      return;
    }

    const confidenceScores = Array.isArray(result?.result?.result)
      ? result.result.result
          .map((entry) => Number(entry?.conf))
          .filter((value) => Number.isFinite(value))
      : [];
    const rawConfidence =
      confidenceScores.length > 0
        ? confidenceScores.reduce((acc, current) => acc + current, 0) / confidenceScores.length
        : 0.5;
    const transcript: OfflineRecognizerFinalTranscript = {
      text,
      confidence: clampConfidence(rawConfidence),
    };
    this.callbacks.onFinalTranscript?.(transcript);
    this.setState("armed");
  }

  private handlePartialResult(payload: unknown): void {
    const result = payload as { result?: { partial?: string } };
    const partial = String(result?.result?.partial ?? "").trim();
    this.callbacks.onPartialTranscript?.(partial);
    this.setState(partial ? "listening" : "armed");
  }

  private async setupAudioPipeline(): Promise<void> {
    if (!browserSupportsOfflineRecognizer()) {
      throw new Error("Este navegador no soporta captura de voz offline en web.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
        sampleRate: this.sampleRate,
      },
    });

    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("AudioContext no disponible en este navegador.");
    }

    const context = new AudioContextCtor({ sampleRate: this.sampleRate });
    if (context.state === "suspended") {
      await context.resume();
    }

    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
    const silence = context.createGain();
    silence.gain.value = 0;

    processor.onaudioprocess = (event) => {
      try {
        this.recognizer?.acceptWaveform(event.inputBuffer);
      } catch (cause) {
        const message = String((cause as { message?: string })?.message || cause);
        this.setError(`Fallo procesando audio: ${message}`);
      }
    };

    source.connect(processor);
    processor.connect(silence);
    silence.connect(context.destination);

    this.mediaStream = stream;
    this.audioContext = context;
    this.mediaSource = source;
    this.processorNode = processor;
    this.silenceNode = silence;
  }

  private createRecognizer(): void {
    if (!this.model) {
      throw new Error("Modelo de voz no inicializado.");
    }
    const recognizer = new this.model.KaldiRecognizer(this.sampleRate);
    recognizer.setWords(true);
    recognizer.on("result", (message) => this.handleFinalResult(message));
    recognizer.on("partialresult", (message) => this.handlePartialResult(message));
    recognizer.on("error", (message) => {
      const payload = message as { error?: string };
      this.setError(String(payload?.error || "Error desconocido en el reconocedor."));
    });
    this.recognizer = recognizer;
  }

  async arm(): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }
    if (this.state === "armed" || this.state === "listening") return;

    this.initializationPromise = (async () => {
      this.setState("loading");
      try {
        await this.ensureModel();
        this.createRecognizer();
        await this.setupAudioPipeline();
        this.callbacks.onPartialTranscript?.("");
        this.setState("armed");
      } catch (cause) {
        const message = String((cause as { message?: string })?.message || cause);
        this.setError(message);
        throw cause;
      } finally {
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  async disarm(): Promise<void> {
    if (this.initializationPromise) {
      try {
        await this.initializationPromise;
      } catch {
        // El error ya se publico en setError.
      }
    }

    this.callbacks.onPartialTranscript?.("");

    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.mediaSource) {
      this.mediaSource.disconnect();
      this.mediaSource = null;
    }
    if (this.silenceNode) {
      this.silenceNode.disconnect();
      this.silenceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
    if (this.recognizer) {
      try {
        this.recognizer.retrieveFinalResult();
      } catch {
        // No bloquea el cierre.
      }
      this.recognizer.remove();
      this.recognizer = null;
    }
    this.setState("inactive");
  }

  async dispose(): Promise<void> {
    await this.disarm();
    if (this.model) {
      this.model.terminate();
      this.model = null;
    }
  }
}
