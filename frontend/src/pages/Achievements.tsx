import { useEffect, useMemo, useState } from "react";

import { getMyProfile, type ProfileGamificationShowcaseItem, type ProfileResponse } from "../api";

function formatKg(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "-";
  return `${value} kg`;
}

function formatRatio(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "-";
  return `${value.toFixed(2)}x BW`;
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function ShowcaseCards({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: ProfileGamificationShowcaseItem[];
  emptyLabel: string;
}) {
  return (
    <section className="surface">
      <div className="sectionHead">
        <h3>{title}</h3>
      </div>
      {items.length === 0 ? (
        <div className="emptyState" style={{ marginTop: 12 }}>
          {emptyLabel}
        </div>
      ) : (
        <div className="gridCards" style={{ marginTop: 12 }}>
          {items.map((item, index) => (
            <article key={`${item.title}_${index}`} className="surfaceButton">
              {item.emblem_png ? (
                <img
                  src={item.emblem_png}
                  alt={item.title}
                  style={{ width: 56, height: 56, borderRadius: 12, objectFit: "cover", border: "1px solid var(--border)" }}
                />
              ) : null}
              <strong>{item.title}</strong>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default function Achievements() {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    getMyProfile()
      .then((res) => setData(res))
      .catch((cause: unknown) => setError(String((cause as { message?: string })?.message || cause)))
      .finally(() => setLoading(false));
  }, []);

  const achievements = useMemo(() => {
    const showcase = data?.gamification.showcase.achievements || [];
    if (showcase.length > 0) return showcase;
    return (data?.gamification.unlocked_achievements || []).map((title) => ({ title, emblem_png: null }));
  }, [data]);

  const medals = useMemo(() => {
    const showcase = data?.gamification.showcase.medals || [];
    if (showcase.length > 0) return showcase;
    return (data?.gamification.unlocked_medals || []).map((title) => ({ title, emblem_png: null }));
  }, [data]);

  const planning = data?.gamification.planning;
  const lifts = data?.gamification.basic_lifts_pr_kg;
  const relative = data?.gamification.relative_strength;
  const nextTargets = data?.gamification.next_targets || [];

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Logros y medallas</h1>
        <p>Panel dedicado de progresion, showcase y objetivos del sistema automatico.</p>
      </header>

      {error ? <section className="message error">{error}</section> : null}

      {loading ? (
        <section className="surface">
          <div className="emptyState">Cargando logros...</div>
        </section>
      ) : (
        <>
          <section className="surface">
            <div className="sectionHead">
              <h3>Resumen de progresion</h3>
              <p>Racha flexible + cumplimiento de planificacion.</p>
            </div>
            <div className="chipRow" style={{ marginTop: 10 }}>
              <span className="chip">Dias de plan completados: {planning?.completed_days_total ?? 0}</span>
              <span className="chip">Racha activa: {planning?.current_streak_days ?? 0} entrenos</span>
              <span className="chip">Mejor racha: {planning?.longest_streak_days ?? 0} entrenos</span>
              <span className="chip">Tolerancia: {planning?.streak_gap_tolerance_days ?? 7} dias</span>
              <span className="chip">Ultimo entreno: {formatDate(planning?.last_training_day)}</span>
            </div>
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Fuerza base y fuerza relativa</h3>
              <p>PR absolutos en kg y ratios con peso corporal en los 3 basicos.</p>
            </div>
            <div className="splitGrid" style={{ marginTop: 12 }}>
              <article className="surfaceButton">
                <strong>PR basicos (kg)</strong>
                <div className="chipRow">
                  <span className="chip">{`Sentadilla posterior libre: ${formatKg(lifts?.back_squat)}`}</span>
                  <span className="chip">{`Press banca plano: ${formatKg(lifts?.bench_press)}`}</span>
                  <span className="chip">{`Peso muerto convencional: ${formatKg(lifts?.deadlift)}`}</span>
                </div>
              </article>
              <article className="surfaceButton">
                <strong>Fuerza relativa</strong>
                <div className="chipRow">
                  <span className="chip">{`Peso corporal: ${formatKg(relative?.body_weight_kg)}`}</span>
                  <span className="chip">{`Sentadilla relativa: ${formatRatio(relative?.back_squat)}`}</span>
                  <span className="chip">{`Banca relativa: ${formatRatio(relative?.bench_press)}`}</span>
                  <span className="chip">{`Peso muerto relativo: ${formatRatio(relative?.deadlift)}`}</span>
                </div>
              </article>
            </div>
          </section>

          <ShowcaseCards title="Showcase de logros" items={achievements} emptyLabel="Aun sin logros desbloqueados." />
          <ShowcaseCards title="Showcase de medallas" items={medals} emptyLabel="Aun sin medallas desbloqueadas." />

          <section className="surface">
            <div className="sectionHead">
              <h3>Proximos objetivos</h3>
            </div>
            <div className="chipRow" style={{ marginTop: 10 }}>
              {nextTargets.length === 0 ? <span className="chip">No hay objetivos pendientes.</span> : null}
              {nextTargets.map((target) => (
                <span key={target} className="chip">
                  {target}
                </span>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
