import { useEffect, useMemo, useState } from "react";

import { getMyProfile, updateMyProfile, type ProfileResponse } from "../api";

function toMultiline(values: string[]): string {
  return values.join("\n");
}

function fromMultiline(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function Profile() {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [achievementsText, setAchievementsText] = useState("");
  const [medalsText, setMedalsText] = useState("");
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
        setAchievementsText(toMultiline(res.profile.achievements || []));
        setMedalsText(toMultiline(res.profile.medals || []));
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
        achievements: fromMultiline(achievementsText),
        medals: fromMultiline(medalsText),
      });
      setData(res);
      setUsername(res.profile.username || "");
      setBio(res.profile.bio || "");
      setAchievementsText(toMultiline(res.profile.achievements || []));
      setMedalsText(toMultiline(res.profile.medals || []));
      setInfo("Perfil actualizado.");
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setBusy(false);
    }
  }

  const suggestedMedals = useMemo(() => {
    const stats = data?.training_stats;
    if (!stats) return [];
    const badges: string[] = [];
    if (stats.sessions_total >= 1) badges.push("Primer Entreno");
    if (stats.sessions_total >= 10) badges.push("Constancia 10");
    if (stats.sessions_total >= 30) badges.push("Disciplina 30");
    if (stats.runs_total >= 5) badges.push("Analista 5");
    if (stats.runs_total >= 20) badges.push("Analista 20");
    return badges;
  }, [data?.training_stats]);

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Perfil</h1>
        <p>Configura tu identidad publica y muestra logros, medallas y resumen de entrenos.</p>
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
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Showcase</h3>
              <p>Define los logros y medallas que quieres mostrar.</p>
            </div>

            <div className="splitGrid" style={{ marginTop: 12 }}>
              <div>
                <label className="smallLabel">Logros (uno por linea)</label>
                <textarea
                  className="input compactTextarea"
                  value={achievementsText}
                  onChange={(e) => setAchievementsText(e.target.value)}
                  placeholder={"10 semanas seguidas\nPR sentadilla 140kg"}
                />
              </div>
              <div>
                <label className="smallLabel">Medallas (una por linea)</label>
                <textarea
                  className="input compactTextarea"
                  value={medalsText}
                  onChange={(e) => setMedalsText(e.target.value)}
                  placeholder={"Constancia\nVolumen elite"}
                />
              </div>
            </div>

            <div className="quickActions" style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={saveProfile} disabled={busy}>
                {busy ? "Guardando..." : "Guardar perfil"}
              </button>
            </div>
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Resumen de entrenos</h3>
              <p>Indicadores rapidos de actividad para exponer en tu perfil.</p>
            </div>
            <div className="chipRow" style={{ marginTop: 10 }}>
              <span className="chip">Sesiones totales: {data?.training_stats.sessions_total ?? 0}</span>
              <span className="chip">Runs totales: {data?.training_stats.runs_total ?? 0}</span>
              <span className="chip">
                Ultima sesion: {data?.training_stats.last_session_at ? new Date(data.training_stats.last_session_at).toLocaleDateString() : "-"}
              </span>
              <span className="chip">
                Ultimo run: {data?.training_stats.last_run_at ? new Date(data.training_stats.last_run_at).toLocaleDateString() : "-"}
              </span>
            </div>
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Vista publica del perfil</h3>
              <p>Preview de logros y medallas visibles.</p>
            </div>

            <div className="splitGrid" style={{ marginTop: 12 }}>
              <article className="surfaceButton">
                <strong>{username.trim() || "Sin nombre de usuario"}</strong>
                <span className="small">{bio.trim() || "Sin bio configurada."}</span>
              </article>

              <article className="surfaceButton">
                <strong>Logros</strong>
                <div className="chipRow">
                  {fromMultiline(achievementsText).length === 0 ? <span className="chip">Sin logros</span> : null}
                  {fromMultiline(achievementsText).map((achievement) => (
                    <span key={achievement} className="chip">
                      {achievement}
                    </span>
                  ))}
                </div>
              </article>

              <article className="surfaceButton">
                <strong>Medallas</strong>
                <div className="chipRow">
                  {fromMultiline(medalsText).length === 0 ? <span className="chip">Sin medallas</span> : null}
                  {fromMultiline(medalsText).map((medal) => (
                    <span key={medal} className="chip">
                      {medal}
                    </span>
                  ))}
                </div>
              </article>

              <article className="surfaceButton">
                <strong>Medallas sugeridas por actividad</strong>
                <div className="chipRow">
                  {suggestedMedals.length === 0 ? <span className="chip">Aun sin sugerencias</span> : null}
                  {suggestedMedals.map((badge) => (
                    <span key={badge} className="chip">
                      {badge}
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

