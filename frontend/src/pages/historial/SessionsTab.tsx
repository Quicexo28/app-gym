import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  getSessionHistory,
  updateSession,
  type HistoryExercise,
  type SessionHistoryItem,
} from "../../api";
import ConfirmDialog from "../../components/ConfirmDialog";
import HistoryCalendar from "../../components/HistoryCalendar";
import { deleteSessions } from "../../lib/historyActions";
import { useHistoryDelete } from "../../lib/useHistoryDelete";
import { dayKey, formatDayLong, isoToDayKey, parseDayKey, relativeDayLabel } from "../../lib/dates";
import { monthOf, sameMonth, shiftMonth, type MonthView } from "../../lib/historyMonth";
import { formatWeight, fromKg, toKg } from "../../lib/units";
import { useAthleteId } from "../../state/athlete";
import { usePreferences, type WeightUnit } from "../../state/preferences";
import { errorMessage } from "../../lib/errors";


function timeLabel(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function sessionTitle(item: SessionHistoryItem): string {
  return item.routine_name || "Sesión libre";
}

function effortTone(rpe: number | null): string {
  if (rpe === null) return "tone-none";
  if (rpe >= 9) return "tone-hard";
  if (rpe >= 7.5) return "tone-mid";
  return "tone-easy";
}

function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

type EditDraft = {
  duration: string;
  rpe: string;
  note: string;
  exercises: HistoryExercise[];
};

function draftFrom(item: SessionHistoryItem): EditDraft {
  return {
    duration: String(Math.round(item.duration_min)),
    rpe: item.rpe === null ? "" : String(item.rpe),
    note: item.note || "",
    exercises: item.exercises.map((ex) => ({ ...ex, sets: ex.sets.map((set) => ({ ...set })) })),
  };
}

function SessionEditor({
  item,
  unit,
  onSaved,
  onCancel,
}: {
  item: SessionHistoryItem;
  unit: WeightUnit;
  onSaved: (updated: SessionHistoryItem) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<EditDraft>(() => draftFrom(item));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function patchSet(exIndex: number, setIndex: number, field: "reps" | "load", raw: string) {
    setDraft((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) =>
        i !== exIndex
          ? ex
          : {
              ...ex,
              sets: ex.sets.map((set, j) => {
                if (j !== setIndex) return set;
                const value = Number(raw);
                if (field === "reps") return { ...set, reps: Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0 };
                return { ...set, load_kg: Number.isFinite(value) ? toKg(Math.max(0, value), unit) : 0 };
              }),
            },
      ),
    }));
  }

  function removeSet(exIndex: number, setIndex: number) {
    setDraft((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) =>
        i === exIndex ? { ...ex, sets: ex.sets.filter((_, j) => j !== setIndex) } : ex,
      ),
    }));
  }

  async function save() {
    const duration = Number(draft.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      setError("La duración debe ser mayor que 0.");
      return;
    }
    const rpe = draft.rpe.trim() === "" ? null : Number(draft.rpe);
    if (rpe !== null && (!Number.isFinite(rpe) || rpe < 0 || rpe > 10)) {
      setError("El esfuerzo va de 0 a 10.");
      return;
    }
    const exercises = draft.exercises.filter((ex) => ex.sets.length > 0);
    if (exercises.length === 0) {
      setError("Deja al menos una serie. Para quitar todo, elimina la sesión.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await updateSession(item.id, { duration_min: duration, rpe, note: draft.note, exercises });
      onSaved(updated);
    } catch (cause: unknown) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }

  return (
    <div className="histEditor">
      {error ? <div className="message error">{error}</div> : null}
      <div className="histEditGrid">
        <label className="field">
          <span className="smallLabel">Duración (min)</span>
          <input
            className="input"
            inputMode="numeric"
            value={draft.duration}
            onChange={(e) => setDraft({ ...draft, duration: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="smallLabel">Esfuerzo (0-10)</span>
          <input
            className="input"
            inputMode="decimal"
            value={draft.rpe}
            onChange={(e) => setDraft({ ...draft, rpe: e.target.value })}
          />
        </label>
      </div>
      <label className="field">
        <span className="smallLabel">Nota</span>
        <textarea
          className="input histNoteInput"
          rows={2}
          value={draft.note}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
        />
      </label>
      {draft.exercises.map((ex, exIndex) => (
        <div key={`${ex.name}-${exIndex}`} className="histEditExercise">
          <strong>{ex.name}</strong>
          {ex.sets.length === 0 ? <span className="small">Sin series: se quita al guardar.</span> : null}
          {ex.sets.map((set, setIndex) => (
            <div key={setIndex} className="histSetRow">
              <span className="histSetNum">{setIndex + 1}</span>
              <input
                className="input"
                aria-label={`Repeticiones de la serie ${setIndex + 1} de ${ex.name}`}
                inputMode="numeric"
                value={String(set.reps)}
                onChange={(e) => patchSet(exIndex, setIndex, "reps", e.target.value)}
              />
              <span className="small">reps</span>
              <input
                className="input"
                aria-label={`Carga de la serie ${setIndex + 1} de ${ex.name}`}
                inputMode="decimal"
                value={String(Number(fromKg(set.load_kg, unit).toFixed(1)))}
                onChange={(e) => patchSet(exIndex, setIndex, "load", e.target.value)}
              />
              <span className="small">{unit}</span>
              <button
                type="button"
                className="histSetRemove"
                aria-label={`Quitar serie ${setIndex + 1} de ${ex.name}`}
                onClick={() => removeSet(exIndex, setIndex)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ))}
      <div className="histActions">
        <button type="button" className="histBtn solid" disabled={busy} onClick={() => void save()}>
          {busy ? "Guardando..." : "Guardar cambios"}
        </button>
        <button type="button" className="histBtn neutral" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

type DayGroup = { key: string; sessions: SessionHistoryItem[] };

export default function SessionsTab() {
  const [athleteId] = useAthleteId();
  const { prefs } = usePreferences();
  const unit = prefs.weightUnit;
  const todayKey = dayKey(new Date());

  const [items, setItems] = useState<SessionHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [viewOverride, setViewOverride] = useState<MonthView | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const del = useHistoryDelete();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!athleteId) {
        setItems([]);
        return;
      }
      if (reloadKey === 0) setLoading(true);
      setError("");
      try {
        const rows = await getSessionHistory(athleteId);
        if (!cancelled) setItems(rows);
      } catch (cause: unknown) {
        if (!cancelled) setError(errorMessage(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [athleteId, reloadKey]);

  // Sin mes elegido, se abre el mes de la sesión más reciente (o el actual si no hay).
  const view = useMemo<MonthView>(() => {
    if (viewOverride) return viewOverride;
    return monthOf(items.length ? new Date(items[0].start_time) : new Date());
  }, [viewOverride, items]);

  const marked = useMemo(() => {
    const out: Record<string, number> = {};
    for (const item of items) {
      const key = isoToDayKey(item.start_time);
      out[key] = (out[key] || 0) + 1;
    }
    return out;
  }, [items]);

  const groups = useMemo<DayGroup[]>(() => {
    const byDay = new Map<string, SessionHistoryItem[]>();
    for (const item of items) {
      const key = isoToDayKey(item.start_time);
      if (!sameMonth(monthOf(parseDayKey(key)), view)) continue;
      byDay.set(key, [...(byDay.get(key) || []), item]);
    }
    return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, sessions]) => ({ key, sessions }));
  }, [items, view]);

  const stats = useMemo(() => {
    const all = groups.flatMap((g) => g.sessions);
    const rated = all.filter((s) => s.rpe !== null);
    return {
      sessions: all.length,
      days: groups.length,
      minutes: all.reduce((acc, s) => acc + s.duration_min, 0),
      volume: all.reduce((acc, s) => acc + (s.volume_load_kg || 0), 0),
      avgRpe: rated.length ? rated.reduce((acc, s) => acc + (s.rpe || 0), 0) / rated.length : null,
    };
  }, [groups]);

  function changeMonth(delta: number) {
    setViewOverride(shiftMonth(view, delta));
    setSelectedDay(null);
  }

  function selectDay(key: string) {
    const next = selectedDay === key ? null : key;
    setSelectedDay(next);
    if (next) document.getElementById(`histday-${next}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function reload() {
    setOpenId(null);
    setEditingId(null);
    setReloadKey((k) => k + 1);
  }

  function askDeleteDay(group: DayGroup) {
    const n = group.sessions.length;
    del.requestDelete({
      busyKey: `day:${group.key}`,
      title: "Eliminar día completo",
      message: `Se borrarán ${n === 1 ? "1 sesión" : `${n} sesiones`} del ${formatDayLong(parseDayKey(group.key))}.`,
      confirmLabel: "Eliminar día",
      undoMessage: n === 1 ? "Sesión eliminada." : `${n} sesiones eliminadas.`,
      run: () => deleteSessions(group.sessions),
      onChanged: reload,
    });
  }

  function askDelete(item: SessionHistoryItem) {
    del.requestDelete({
      busyKey: `session:${item.id}`,
      title: "Eliminar sesión",
      message: `"${sessionTitle(item)}" del ${formatDayLong(new Date(item.start_time))} se borrará.`,
      confirmLabel: "Eliminar",
      undoMessage: "Sesión eliminada.",
      run: () => deleteSessions([item]),
      onChanged: reload,
    });
  }

  return (
    <div className="stack">
      <ConfirmDialog request={del.confirm} onClose={del.closeConfirm} />
      {error || del.error ? <section className="message error">{error || del.error}</section> : null}

      {loading ? (
        <section className="surface">
          <div className="emptyState">Cargando sesiones...</div>
        </section>
      ) : items.length === 0 ? (
        <section className="surface">
          <div className="emptyState">
            Aún no hay sesiones. <Link to="/session/new">Registra la primera.</Link>
          </div>
        </section>
      ) : (
        <>
          <section className="surface">
            <HistoryCalendar
              view={view}
              marked={marked}
              selected={selectedDay}
              todayKey={todayKey}
              onSelect={selectDay}
              onShiftMonth={changeMonth}
              markLabel={(n) => (n === 1 ? "1 sesión" : `${n} sesiones`)}
            />
          </section>

          <section className="histStats" aria-label="Resumen del mes">
            <article className="histStat">
              <strong>{stats.sessions}</strong>
              <span>sesiones</span>
            </article>
            <article className="histStat">
              <strong>{stats.days}</strong>
              <span>días</span>
            </article>
            <article className="histStat">
              <strong>{minutesLabel(stats.minutes)}</strong>
              <span>tiempo</span>
            </article>
            <article className="histStat">
              <strong>{stats.avgRpe === null ? "–" : stats.avgRpe.toFixed(1)}</strong>
              <span>esfuerzo medio</span>
            </article>
          </section>

          {groups.length === 0 ? (
            <section className="surface">
              <div className="emptyState">Sin sesiones este mes.</div>
            </section>
          ) : (
            groups.map((group) => {
              const date = parseDayKey(group.key);
              const rel = relativeDayLabel(group.key, todayKey);
              const dayMinutes = group.sessions.reduce((acc, s) => acc + s.duration_min, 0);
              const dayVolume = group.sessions.reduce((acc, s) => acc + (s.volume_load_kg || 0), 0);
              return (
                <section
                  key={group.key}
                  id={`histday-${group.key}`}
                  className={`surface histDay ${selectedDay === group.key ? "selected" : ""}`}
                >
                  <header className="histDayHead">
                    <div className="histDateBadge" aria-hidden="true">
                      <strong>{date.getDate()}</strong>
                      <span>{["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][date.getDay()]}</span>
                    </div>
                    <div className="histDayInfo">
                      <h3>{rel || formatDayLong(date)}</h3>
                      <span className="small">
                        {`${group.sessions.length === 1 ? "1 sesión" : `${group.sessions.length} sesiones`} · ${minutesLabel(dayMinutes)}${
                          dayVolume ? ` · ${formatWeight(dayVolume, unit)}` : ""
                        }`}
                      </span>
                    </div>
                  </header>

                  {group.sessions.map((item) => {
                    const open = openId === item.id;
                    const editing = editingId === item.id;
                    return (
                      <article key={item.id} className={`histSession ${effortTone(item.rpe)}`}>
                        <button
                          type="button"
                          className="histSessionBtn"
                          aria-expanded={open}
                          onClick={() => setOpenId(open ? null : item.id)}
                        >
                          <span className="histSessionTop">
                            <strong>{sessionTitle(item)}</strong>
                            <span className="small">{timeLabel(item.start_time)}</span>
                          </span>
                          <span className="histChips">
                            <span className="histChip">{minutesLabel(item.duration_min)}</span>
                            <span className="histChip">{`${item.sets_total ?? 0} series`}</span>
                            {item.volume_load_kg ? (
                              <span className="histChip">{formatWeight(item.volume_load_kg, unit)}</span>
                            ) : null}
                            {item.rpe !== null ? <span className="histChip accent">{`esfuerzo ${item.rpe}`}</span> : null}
                          </span>
                        </button>

                        {open && !editing ? (
                          <div className="histDetail">
                            {item.note ? <p className="histNote">{item.note}</p> : null}
                            {item.exercises.map((ex, i) => (
                              <div key={`${ex.name}-${i}`} className="histExercise">
                                <strong>{ex.name}</strong>
                                <div className="histSetChips">
                                  {ex.sets.map((set, j) => (
                                    <span key={j} className="histChip">
                                      {`${set.reps} × ${formatWeight(set.load_kg, unit)}`}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ))}
                            <div className="histActions">
                              <button type="button" className="histBtn edit" onClick={() => setEditingId(item.id)}>
                                Editar
                              </button>
                              <button
                                type="button"
                                className="histBtn danger"
                                disabled={del.busyKey === `session:${item.id}`}
                                onClick={() => askDelete(item)}
                              >
                                {del.busyKey === `session:${item.id}` ? "Eliminando..." : "Eliminar"}
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {open && editing ? (
                          <SessionEditor
                            item={item}
                            unit={unit}
                            onCancel={() => setEditingId(null)}
                            onSaved={(updated) => {
                              setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
                              setEditingId(null);
                            }}
                          />
                        ) : null}
                      </article>
                    );
                  })}
                  <button
                    type="button"
                    className="histBtn dangerSoft histDayDelete"
                    disabled={del.busyKey === `day:${group.key}`}
                    onClick={() => askDeleteDay(group)}
                  >
                    {del.busyKey === `day:${group.key}` ? "Eliminando día..." : "Eliminar día completo"}
                  </button>
                </section>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
