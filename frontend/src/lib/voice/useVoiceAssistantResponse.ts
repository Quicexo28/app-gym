import { useCallback, useEffect, useState } from "react";

export function useVoiceAssistantResponse(defaultDurationMs = 2400) {
  const [voiceAssistantResponse, setVoiceAssistantResponse] = useState<string>("");
  const [voiceAssistantResponseUntilMs, setVoiceAssistantResponseUntilMs] = useState<number | null>(null);

  const clearVoiceAssistantResponse = useCallback(() => {
    setVoiceAssistantResponse("");
    setVoiceAssistantResponseUntilMs(null);
  }, []);

  const emitVoiceAssistantResponse = useCallback(
    (message: string, durationMs = defaultDurationMs) => {
      if (!message.trim()) return;
      setVoiceAssistantResponse(message.trim());
      setVoiceAssistantResponseUntilMs(Date.now() + Math.max(800, durationMs));
    },
    [defaultDurationMs],
  );

  useEffect(() => {
    if (voiceAssistantResponseUntilMs === null) return;
    const delayMs = Math.max(0, voiceAssistantResponseUntilMs - Date.now());
    const timeoutId = window.setTimeout(() => {
      clearVoiceAssistantResponse();
    }, delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [clearVoiceAssistantResponse, voiceAssistantResponseUntilMs]);

  return {
    voiceAssistantResponse,
    emitVoiceAssistantResponse,
    clearVoiceAssistantResponse,
  };
}
