/** Texto legible de un error capturado en un `catch` (usa `message` si existe). */
export function errorMessage(cause: unknown): string {
  return String((cause as { message?: string } | null | undefined)?.message || cause);
}
