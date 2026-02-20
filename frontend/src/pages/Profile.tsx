import { useEffect, useState } from "react";

import { getMyProfile, updateMyProfile, type ProfileResponse } from "../api";

function formatKg(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "-";
  }
  return `${value} kg`;
}

export default function Profile() {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    getMyProfile()
      .then((res) => {
        setData(res);
        setUsername(res.profile.username || "");
        setBio(res.profile.bio || "");
      })
      .catch((cause: unknown) => setError(String((cause as { message?: string })?.message || cause)))
      .finally(() => setLoading(false));
  }, []);

  async function saveProfile() {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const res = await updateMyProfile({
        username: username.trim() || null,
        bio: bio.trim() || null,
      });
      setData(res);
      setUsername(res.profile.username || "");
      setBio(res.profile.bio || "");
      setInfo("Perfil actualizado.");
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setBusy(false);
    }
  }

  const autoAchievements = data?.gamification.unlocked_achievements || [];
  const autoMedals = data?.gamification.unlocked_medals || [];
  const nextTargets = data?.gamification.next_targets || [];
  const planningProgress = data?.gamification.planning;
  const liftsPrs = data?.gamification.basic_lifts_pr_kg;

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Perfil</h1>
        <p>Identidad publica, sistema de logros automaticos y showcase de progreso.</p>
      </header>

      {error ? <section className="message error">{error}</section> : null}
      {info ? <section className="message">{info}</section> : null}

      {loading ? (
        <section className="surface">
          <div className="emptyState">Cargando perfil...</div>
        </section>
      ) : (
        <>
          <section className="surface">
            <div className="sectionHead">
              <h3>Identidad</h3>
              <p>Nombre de usuario y bio para tu ficha de perfil.</p>
            </div>

            <div className="splitGrid" style={{ marginTop: 12 }}>
              <div>
                <label className="smallLabel">Nombre de usuario</label>
                <input
                  className="input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="ej: santi_qp"
                />
              </div>
              <div>
                <label className="smallLabel">Cuenta</label>
                <div className="chipRow">
                  <span className="chip">Email: {data?.email || "-"}</span>
                  <span className="chip">Rol: {data?.role || "-"}</span>
                  <span className="chip">Plan: {data?.plan || "-"}</span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label className="smallLabel">Bio</label>
              <textarea
                className="input compactTextarea"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tu enfoque de entrenamiento, especialidad o meta principal"
              />
            </div>

            <div className="quickActions" style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={saveProfile} disabled={busy}>
                {busy ? "Guardando..." : "Guardar perfil"}
              </button>
            </div>
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Sistema de logros automaticos</h3>
              <p>Basado en dias de planificacion cumplidos, rachas y PR en basicos.</p>
            </div>

            <div className="chipRow" style={{ marginTop: 10 }}>
              <span className="chip">Dias de plan completados: {planningProgress?.completed_days_total ?? 0}</span>
              <span className="chip">Racha actual: {planningProgress?.current_streak_days ?? 0} dias</span>
              <span className="chip">Mejor racha: {planningProgress?.longest_streak_days ?? 0} dias</span>
            </div>

            <div className="splitGrid" style={{ marginTop: 12 }}>
              <article className="surfaceButton">
                <strong>PR basicos (kg)</strong>
                <div className="chipRow">
                  <span className="chip">{`Sentadilla posterior libre: ${formatKg(liftsPrs?.back_squat)}`}</span>
                  <span className="chip">{`Press banca plano: ${formatKg(liftsPrs?.bench_press)}`}</span>
                  <span className="chip">{`Peso muerto convencional: ${formatKg(liftsPrs?.deadlift)}`}</span>
                </div>
              </article>

              <article className="surfaceButton">
                <strong>Logros desbloqueados</strong>
                <div className="chipRow">
                  {autoAchievements.length === 0 ? <span className="chip">Aun sin logros automaticos</span> : null}
                  {autoAchievements.map((achievement) => (
                    <span key={achievement} className="chip">
                      {achievement}
                    </span>
                  ))}
                </div>
              </article>

              <article className="surfaceButton">
                <strong>Medallas desbloqueadas</strong>
                <div className="chipRow">
                  {autoMedals.length === 0 ? <span className="chip">Aun sin medallas automaticas</span> : null}
                  {autoMedals.map((medal) => (
                    <span key={medal} className="chip">
                      {medal}
                    </span>
                  ))}
                </div>
              </article>

              <article className="surfaceButton">
                <strong>Proximos objetivos</strong>
                <div className="chipRow">
                  {nextTargets.length === 0 ? <span className="chip">No hay objetivos pendientes</span> : null}
                  {nextTargets.map((target) => (
                    <span key={target} className="chip">
                      {target}
                    </span>
                  ))}
                </div>
              </article>
            </div>
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Showcase de perfil</h3>
              <p>Vista publica con tus logros y medallas automaticas.</p>
            </div>

            <div className="splitGrid" style={{ marginTop: 12 }}>
              <article className="surfaceButton">
                <strong>{username.trim() || "Sin nombre de usuario"}</strong>
                <span className="small">{bio.trim() || "Sin bio configurada."}</span>
              </article>

              <article className="surfaceButton">
                <strong>Logros</strong>
                <div className="chipRow">
                  {autoAchievements.length === 0 ? <span className="chip">Sin logros</span> : null}
                  {autoAchievements.map((achievement) => (
                    <span key={achievement} className="chip">
                      {achievement}
                    </span>
                  ))}
                </div>
              </article>

              <article className="surfaceButton">
                <strong>Medallas</strong>
                <div className="chipRow">
                  {autoMedals.length === 0 ? <span className="chip">Sin medallas</span> : null}
                  {autoMedals.map((medal) => (
                    <span key={medal} className="chip">
                      {medal}
                    </span>
                  ))}
                </div>
              </article>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
