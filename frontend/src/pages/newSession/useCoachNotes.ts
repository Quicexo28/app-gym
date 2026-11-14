import { useEffect, useState } from "react";

import { listCoachNotes, markCoachNoteRead } from "../../api";
import type { CoachNote } from "../../api";

/**
 * Indicaciones del entrenador por ejercicio de la rutina activa. Se cargan una vez
 * al elegir rutina, no por serie. Marca como leídas las que se abren.
 */
export function useCoachNotes(athleteId: string, routineId: string) {
  const [coachNotesByExercise, setCoachNotesByExercise] = useState<Record<string, CoachNote[]>>({});
  const [expandedNoteExercise, setExpandedNoteExercise] = useState<number | null>(null);

  useEffect(() => {
    if (!athleteId || !routineId) {
      setCoachNotesByExercise({});
      return;
    }
    let cancelled = false;
    listCoachNotes({ athlete_id: athleteId, routine_id: routineId })
      .then((notes) => {
        if (cancelled) return;
        const grouped: Record<string, CoachNote[]> = {};
        for (const note of notes) {
          const key = note.exercise_name_normalized || "";
          (grouped[key] ||= []).push(note);
        }
        setCoachNotesByExercise(grouped);
      })
      .catch(() => {
        if (!cancelled) setCoachNotesByExercise({});
      });
    return () => {
      cancelled = true;
    };
  }, [athleteId, routineId]);

  function toggleExerciseNote(exIdx: number, notes: CoachNote[]) {
    setExpandedNoteExercise((prev) => (prev === exIdx ? null : exIdx));
    const unread = notes.filter((note) => !note.read_at_utc);
    if (unread.length === 0) return;
    const nowIso = new Date().toISOString();
    setCoachNotesByExercise((prev) => {
      const next = { ...prev };
      for (const note of unread) {
        const key = note.exercise_name_normalized || "";
        next[key] = (next[key] || []).map((item) => (item.id === note.id ? { ...item, read_at_utc: nowIso } : item));
      }
      return next;
    });
    for (const note of unread) {
      void markCoachNoteRead(note.id).catch(() => {});
    }
  }

  return { coachNotesByExercise, expandedNoteExercise, setExpandedNoteExercise, toggleExerciseNote };
}
