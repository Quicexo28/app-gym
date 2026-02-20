import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { getMyProfile, updateMyProfile, type ProfileResponse } from "../api";

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

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Perfil</h1>
        <p>Identidad publica y datos de cuenta.</p>
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
              <h3>Actividad</h3>
              <p>Resumen de tu cuenta y acceso rapido al panel de logros.</p>
            </div>
            <div className="chipRow" style={{ marginTop: 10 }}>
              <span className="chip">Sesiones: {data?.training_stats.sessions_total ?? 0}</span>
              <span className="chip">Runs: {data?.training_stats.runs_total ?? 0}</span>
              <span className="chip">Ultima sesion: {data?.training_stats.last_session_at ? "registrada" : "-"}</span>
              <span className="chip">Ultimo run: {data?.training_stats.last_run_at ? "registrado" : "-"}</span>
            </div>
            <div className="quickActions" style={{ marginTop: 12 }}>
              <Link to="/achievements" className="btn primary">
                Abrir logros y medallas
              </Link>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
