/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  ApiError,
  createCustomExercise,
  createGlobalExercise,
  deleteCustomExercise,
  deleteGlobalExercise,
  exportGlobalExercises,
  getExerciseCatalog,
  importGlobalExercises,
  type ExerciseCatalogApiItem,
  type GlobalExerciseExportPayload,
} from "../api";
import { toExerciseCatalogEntries, type ExerciseCatalogEntry } from "../lib/exerciseCatalog";
import { loadExerciseCatalog, saveExerciseCatalog, uid, type ExerciseCatalogItem } from "../lib/storage";
import { useAuth } from "./auth";

type ExerciseCreateInput = {
  group: string;
  family: string;
  variation?: string;
  subvariation?: string;
  aliases?: string[];
};

type ExerciseImportInput = {
  mode: "merge" | "replace";
  items: ExerciseCatalogItem[];
};

type ExerciseImportResult = {
  total: number;
  imported: number;
  updated: number;
  skipped: number;
};

type ExerciseCatalogContextValue = {
  ready: boolean;
  loading: boolean;
  syncError: string;
  items: ExerciseCatalogItem[];
  entries: ExerciseCatalogEntry[];
  refresh: () => Promise<void>;
  addCustom: (payload: ExerciseCreateInput) => Promise<void>;
  addGlobal: (payload: ExerciseCreateInput) => Promise<void>;
  removeItem: (item: ExerciseCatalogItem) => Promise<void>;
  importGlobalCatalog: (payload: ExerciseImportInput) => Promise<ExerciseImportResult>;
  exportGlobalCatalog: () => Promise<GlobalExerciseExportPayload>;
};

const ExerciseCatalogContext = createContext<ExerciseCatalogContextValue | null>(null);

function mapApiItem(item: ExerciseCatalogApiItem): ExerciseCatalogItem {
  return {
    id: item.id,
    group: item.group,
    family: item.family,
    variation: item.variation || undefined,
    subvariation: item.subvariation || undefined,
    aliases: item.aliases,
    scope: item.scope,
    owner_user_id: item.owner_user_id || null,
    created_at_utc: item.created_at_utc,
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "No se pudo sincronizar el catalogo.";
}

async function migrateLocalCatalogToCustom(items: ExerciseCatalogItem[]): Promise<void> {
  for (const item of items) {
    try {
      await createCustomExercise({
        group: item.group,
        family: item.family,
        variation: item.variation,
        subvariation: item.subvariation,
        aliases: item.aliases,
      });
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 409) continue;
      throw error;
    }
  }
}

export function ExerciseCatalogProvider({ children }: { children: ReactNode }) {
  const { ready: authReady, isAuthenticated, isAdmin } = useAuth();
  const [items, setItems] = useState<ExerciseCatalogItem[]>(() => loadExerciseCatalog());
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [syncError, setSyncError] = useState("");

  useEffect(() => {
    saveExerciseCatalog(items);
  }, [items]);

  const refresh = useCallback(async () => {
    if (!authReady) return;
    if (!isAuthenticated) {
      setItems(loadExerciseCatalog());
      setReady(true);
      setSyncError("");
      return;
    }

    setLoading(true);
    try {
      const rows = await getExerciseCatalog();
      if (rows.length === 0) {
        const local = loadExerciseCatalog();
        if (local.length > 0) {
          await migrateLocalCatalogToCustom(local);
        }
      }

      const effectiveRows = await getExerciseCatalog();
      setItems(effectiveRows.map(mapApiItem));
      setSyncError("");
    } catch (error: unknown) {
      setSyncError(toErrorMessage(error));
      setItems(loadExerciseCatalog());
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, [authReady, isAuthenticated]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addCustom = useCallback(
    async (payload: ExerciseCreateInput) => {
      if (!isAuthenticated) {
        const next: ExerciseCatalogItem[] = [
          ...items,
          {
            id: uid("ex"),
            group: payload.group,
            family: payload.family,
            variation: payload.variation,
            subvariation: payload.subvariation,
            aliases: payload.aliases,
            scope: "custom",
            owner_user_id: null,
            created_at_utc: new Date().toISOString(),
          },
        ];
        setItems(next);
        return;
      }
      await createCustomExercise(payload);
      await refresh();
    },
    [isAuthenticated, items, refresh],
  );

  const addGlobal = useCallback(
    async (payload: ExerciseCreateInput) => {
      if (!isAdmin) {
        throw new Error("Solo admin puede crear ejercicios globales.");
      }
      await createGlobalExercise(payload);
      await refresh();
    },
    [isAdmin, refresh],
  );

  const removeItem = useCallback(
    async (item: ExerciseCatalogItem) => {
      if (item.scope === "global") {
        await deleteGlobalExercise(item.id);
      } else {
        await deleteCustomExercise(item.id);
      }
      await refresh();
    },
    [refresh],
  );

  const importGlobalCatalog = useCallback(
    async (payload: ExerciseImportInput): Promise<ExerciseImportResult> => {
      if (!isAdmin) {
        throw new Error("Solo admin puede importar catalogo global.");
      }

      const requestItems = payload.items.map((item) => ({
        group: item.group,
        family: item.family,
        variation: item.variation,
        subvariation: item.subvariation,
        aliases: item.aliases,
      }));

      const result = await importGlobalExercises({
        mode: payload.mode,
        items: requestItems,
      });
      await refresh();
      return result;
    },
    [isAdmin, refresh],
  );

  const exportGlobalCatalog = useCallback(async (): Promise<GlobalExerciseExportPayload> => {
    if (!isAdmin) {
      throw new Error("Solo admin puede exportar catalogo global.");
    }
    return exportGlobalExercises();
  }, [isAdmin]);

  const entries = useMemo(() => toExerciseCatalogEntries(items), [items]);

  const value = useMemo<ExerciseCatalogContextValue>(
    () => ({
      ready,
      loading,
      syncError,
      items,
      entries,
      refresh,
      addCustom,
      addGlobal,
      removeItem,
      importGlobalCatalog,
      exportGlobalCatalog,
    }),
    [addCustom, addGlobal, entries, exportGlobalCatalog, importGlobalCatalog, items, loading, ready, refresh, removeItem, syncError],
  );

  return <ExerciseCatalogContext.Provider value={value}>{children}</ExerciseCatalogContext.Provider>;
}

export function useExerciseCatalog(): ExerciseCatalogContextValue {
  const ctx = useContext(ExerciseCatalogContext);
  if (!ctx) {
    throw new Error("useExerciseCatalog must be used inside ExerciseCatalogProvider");
  }
  return ctx;
}
