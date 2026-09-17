import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  MUSCLE_GROUPS,
  createCoachAthlete,
  getAthleteHub,
  removeCoachAthlete,
  muscleGroupLabel,
  type HubSubject,
} from "../api";
import KebabMenu from "../components/KebabMenu";
import { useAthleteAccess } from "../state/athlete";
import { useViewScopes } from "../state/viewScopes";
import { APP_LOCALE } from "../lib/locale";

/** "12 sesiones · última: 16/09/2026" */
function athleteSummaryLine(subject: HubSubject): string {
  const sessions = `${subject.sessions_total} ${subject.sessions_total === 1 ? "sesión" : "sesiones"}`;
  if (!subject.last_session_at) return `${sessions} · sin sesiones aún`;
  return `${sessions} · última: ${new Date(subject.last_session_at).toLocaleDateString(APP_LOCALE)}`;
}

export default function UsersHub() {
  const { coachView } = useViewScopes();
  const { setAthleteId } = useAthleteAccess();
  const nav = useNavigate();

  const [subjects, setSubjects] = useState<HubSubject[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGroups, setNewGroups] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  function refresh() {
    setLoading(true);
    setError("");
    getAthleteHub({ q: query.trim() || undefined })
      .then((res) => {
        setSubjects(res.subjects.filter((subject) => subject.kind === "assigned"));
      })
      .catch((cause: unknown) => {
        setError(String((cause as { message?: string })?.message || cause));
        setSubjects([]);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!coachView) return;
    const timeoutId = window.setTimeout(refresh, 250);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachView, query]);

  function toggleNewGroup(group: string) {
    setNewGroups((prev) => (prev.includes(group) ? prev.filter((item) => item !== group) : [...prev, group]));
  }

  async function submitNewAthlete() {
    const displayName = newName.trim();
    if (!displayName) {
      setError("El nombre del atleta es obligatorio.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      await createCoachAthlete({ display_name: displayName, priority_muscle_groups: newGroups });
      setNewName("");
      setNewGroups([]);
      setShowAddForm(false);
      refresh();
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setCreating(false);
    }
  }

  async function removeAthlete(subject: HubSubject) {
    if (!window.confirm(`¿Quitar a ${subject.display_name || subject.label} de tu cartera?`)) return;
    try {
      await removeCoachAthlete(subject.id);
      refresh();
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    }
  }

  function openAthlete(subject: HubSubject) {
    setAthleteId(subject.id);
    nav(`/users/${encodeURIComponent(subject.id)}`);
  }

  if (!coachView) {
    return (
      <div className="container stack">
        <header className="titleBlock">
          <h1>Usuarios</h1>
          <p>Enciende la vista coach (interruptor de la barra superior) para ver tu cartera.</p>
        </header>
        <section className="surface">
          <div className="emptyState">Vista coach apagada.</div>
        </section>
      </div>
    );
  }

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Usuarios</h1>
      </header>

      {error ? <section className="message error">{error}</section> : null}

      <section className="surface">
        {showAddForm ? (
          <div className="stack">
            <div className="sectionHead">
              <h3>Nuevo atleta</h3>
            </div>
            <div>
              <label className="smallLabel">Nombre</label>
              <input
                className="input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nombre del atleta"
              />
            </div>
            <div>
              <label className="smallLabel">Músculos prioritarios (opcional)</label>
              <div className="chipRow" style={{ marginTop: 6 }}>
                {MUSCLE_GROUPS.map((group) => (
                  <button
                    key={group}
                    type="button"
                    className={`chip chipToggle ${newGroups.includes(group) ? "active" : ""}`.trim()}
                    onClick={() => toggleNewGroup(group)}
                  >
                    {muscleGroupLabel(group)}
                  </button>
                ))}
              </div>
            </div>
            <div className="quickActions">
              <button type="button" className="btn primary" onClick={() => void submitNewAthlete()} disabled={creating}>
                {creating ? "Creando..." : "Crear atleta"}
              </button>
              <button type="button" className="btn ghost" onClick={() => setShowAddForm(false)}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* El buscador solo aparece cuando hay cartera que filtrar. */}
            {subjects.length > 0 || query ? (
              <input
                className="input"
                placeholder="Buscar atleta..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ marginBottom: 12 }}
              />
            ) : null}

            {loading ? (
              <div className="emptyState">Cargando...</div>
            ) : subjects.length === 0 ? (
              <div className="emptyState">
                {query ? "Ningún atleta coincide con la búsqueda." : "Aún no tienes atletas en tu cartera."}
              </div>
            ) : (
              <div className="rowList">
                {subjects.map((subject) => (
                  <div key={subject.id} className="rowItem">
                    <button type="button" className="rowMain" onClick={() => openAthlete(subject)}>
                      <strong>{subject.display_name || subject.label}</strong>
                      <span className="small">{athleteSummaryLine(subject)}</span>
                    </button>
                    {subject.is_active_now ? <span className="chip activeNowChip">Entrenando</span> : null}
                    {subject.unread_reports_count > 0 ? (
                      <span className="chip notifyChip">{subject.unread_reports_count}</span>
                    ) : null}
                    <KebabMenu
                      ariaLabel={`Opciones de ${subject.display_name || subject.label}`}
                      actions={[
                        { label: "Abrir", onSelect: () => openAthlete(subject) },
                        { label: "Quitar de la cartera", destructive: true, onSelect: () => void removeAthlete(subject) },
                      ]}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="rowListActions">
              <button type="button" className="linkBtn" onClick={() => setShowAddForm(true)}>
                + Nuevo atleta
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
