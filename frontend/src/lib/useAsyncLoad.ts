import { useCallback, useEffect, useState, type DependencyList } from "react";

import { errorMessage } from "./errors";

type AsyncLoadOptions = {
  /** Si es true no se carga y `data` queda en `undefined` (p. ej. sin atleta activo). */
  skip?: boolean;
  /** Si es false, un error conserva el dato anterior en vez de limpiarlo. Default: true. */
  resetOnError?: boolean;
};

/**
 * Carga asíncrona con cancelación: se relanza al cambiar `deps` (o con `reload`) y descarta
 * la respuesta si el efecto se cancela antes de que llegue. `fn` se lee solo al relanzar,
 * así que `deps` debe incluir todo lo que `fn` usa.
 */
export function useAsyncLoad<T>(fn: () => Promise<T>, deps: DependencyList, options: AsyncLoadOptions = {}) {
  const { skip = false, resetOnError = true } = options;
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (skip) {
        setData(undefined);
        setLoading(false);
        setError("");
        return;
      }
      setLoading(true);
      setError("");
      try {
        const result = await fn();
        if (!cancelled) setData(result);
      } catch (cause: unknown) {
        if (cancelled) return;
        if (resetOnError) setData(undefined);
        setError(errorMessage(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, skip, resetOnError, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);

  return { data, loading, error, reload };
}
