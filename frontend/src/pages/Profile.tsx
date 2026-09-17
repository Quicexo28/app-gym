import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  createProgressComment,
  createProgressShare,
  deleteProgressShare,
  getMyProfile,
  joinCoachByCode,
  leaveCoach,
  listProgressShares,
  updateMyProfile,
  type ProfileGender,
  type ProfileResponse,
  type ProgressShareItem,
} from "../api";
import DatePicker from "../components/DatePicker";
import Select from "../components/Select";
import { useAthleteAccess } from "../state/athlete";
import { useAuth } from "../state/auth";
import { APP_LOCALE } from "../lib/locale";

const GENDER_OPTIONS: { value: ProfileGender; label: string }[] = [
  { value: "male", label: "Hombre" },
  { value: "female", label: "Mujer" },
  { value: "other", label: "Otro" },
  { value: "unspecified", label: "Prefiero no decir" },
];

const MIN_HEIGHT_CM = 80;
const MAX_HEIGHT_CM = 260;

function formatDelta(delta: number | null | undefined, unit: string): string {
  if (typeof delta !== "number" || Math.abs(delta) < 1e-9) return "";
  const sign = delta > 0 ? "+" : "";
  return ` (${sign}${delta.toFixed(1)} ${unit})`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString(APP_LOCALE);
}

function shareText(item: ProgressShareItem): string {
  const lines = [`Progreso ${formatDate(item.created_at_utc)}`];
  for (const metric of item.metrics) {
    lines.push(`${metric.label}: ${metric.value} ${metric.unit}${formatDelta(metric.delta, metric.unit)}`);
  }
  lines.push(`Sesiones últimos 30 días: ${item.sessions_recent} | total: ${item.sessions_total}`);
  if (item.note) lines.push(`Nota: ${item.note}`);
  return lines.join("\n");
}

export default function Profile() {
  const { user } = useAuth();
  const { athleteId, activeSubject } = useAthleteAccess();
  const nav = useNavigate();

  const [data, setData] = useState<ProfileResponse | null>(null);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [bio, setBio] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const [shares, setShares] = useState<ProgressShareItem[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [shareNote, setShareNote] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [coachCode, setCoachCode] = useState("");

  const threadAthleteId = athleteId || data?.network.athlete_id || "";
  const isCoachOfThread = Boolean(data && threadAthleteId !== data.network.athlete_id);

  const applyProfile = useCallback((res: ProfileResponse) => {
    setData(res);
    setFullName(res.profile.display_name || "");
    setUsername(res.profile.username || "");
    setBirthDate(res.profile.birth_date || "");
    setGender(res.profile.gender || "");
    setHeightCm(res.profile.height_cm != null ? String(res.profile.height_cm) : "");
    setBio(res.profile.bio || "");
  }, []);

  const reloadProfile = useCallback(async () => {
    try {
      const res = await getMyProfile();
      applyProfile(res);
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    }
  }, [applyProfile]);

  useEffect(() => {
    setLoading(true);
    setError("");
    reloadProfile().finally(() => setLoading(false));
  }, [reloadProfile]);

  async function joinCoach() {
    const code = coachCode.trim();
    if (!code) {
      setError("Ingresa un código de invitación.");
      return;
    }
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await joinCoachByCode(code);
      setCoachCode("");
      setInfo("Te uniste a tu coach.");
      await reloadProfile();
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setBusy(false);
    }
  }

  async function leaveCoachAction() {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await leaveCoach();
      setInfo("Saliste de tu coach.");
      await reloadProfile();
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setBusy(false);
    }
  }

  const refreshShares = useCallback(async () => {
    if (!threadAthleteId) {
      setShares([]);
      return;
    }
    setSharesLoading(true);
    try {
      const res = await listProgressShares(threadAthleteId, 20);
      setShares(res.items || []);
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setSharesLoading(false);
    }
  }, [threadAthleteId]);

  useEffect(() => {
    void refreshShares();
  }, [refreshShares]);

  async function saveProfile() {
    const heightRaw = heightCm.trim().replace(",", ".");
    let height: number | null = null;
    if (heightRaw) {
      height = Number(heightRaw);
      if (!Number.isFinite(height) || height < MIN_HEIGHT_CM || height > MAX_HEIGHT_CM) {
        setInfo("");
        setError(`La altura debe estar entre ${MIN_HEIGHT_CM} y ${MAX_HEIGHT_CM} cm.`);
        return;
      }
    }

    setBusy(true);
    setError("");
    setInfo("");
    try {
      const res = await updateMyProfile({
        display_name: fullName.trim() || null,
        username: username.trim() || null,
        birth_date: birthDate || null,
        gender: (gender as ProfileGender) || null,
        height_cm: height,
        bio: bio.trim() || null,
      });
      applyProfile(res);
      setEditing(false);
      setInfo("Perfil actualizado.");
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setBusy(false);
    }
  }

  async function publishShare() {
    if (!threadAthleteId) return;
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await createProgressShare({ athlete_id: threadAthleteId, note: shareNote.trim() || null });
      setShareNote("");
      setInfo("Progreso compartido.");
      await refreshShares();
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(shareId: string) {
    const body = (replyDrafts[shareId] || "").trim();
    if (!body) return;
    setBusy(true);
    try {
      const updated = await createProgressComment(shareId, body);
      setReplyDrafts((prev) => ({ ...prev, [shareId]: "" }));
      setShares((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setBusy(false);
    }
  }

  async function removeShare(shareId: string) {
    setBusy(true);
    try {
      await deleteProgressShare(shareId);
      setShares((prev) => prev.filter((item) => item.id !== shareId));
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setBusy(false);
    }
  }

  async function shareOutside(item: ProgressShareItem) {
    const text = shareText(item);
    try {
      if (navigator.share) {
        await navigator.share({ title: "Mi progreso", text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setInfo("Resumen copiado al portapapeles.");
    } catch {
      // Cancelado por el usuario o sin permisos: no es un error de la app.
    }
  }

  const displayName = useMemo(() => {
    const named = (data?.profile.display_name || data?.profile.username || "").trim();
    if (named) return named;
    return (data?.email || "").split("@")[0] || "Mi perfil";
  }, [data]);

  if (loading) {
    return (
      <section className="surface">
        <div className="emptyState">Cargando perfil...</div>
      </section>
    );
  }

  return (
    <>
      {error ? <section className="message error">{error}</section> : null}
      {info ? <section className="message">{info}</section> : null}

      <section className="surface stack compactStack">
        <div className="profileHeader">
          <div className="profileIdentity">
            <strong className="profileName">{displayName}</strong>
            <span className="small">{data?.profile.bio || "Sin bio."}</span>
          </div>
          <button className="btn" onClick={() => setEditing((prev) => !prev)}>
            {editing ? "Cancelar" : "Editar"}
          </button>
        </div>

        {editing ? (
          <>
            <div>
              <label className="smallLabel">Nombre</label>
              <input
                className="input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="ej: Santiago Quiceno"
              />
            </div>
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
              <DatePicker
                label="Fecha de nacimiento"
                value={birthDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={setBirthDate}
              />
            </div>
            <div>
              <label className="smallLabel">Genero</label>
              <Select
                value={gender}
                onChange={setGender}
                options={[{ value: "", label: "Sin definir" }, ...GENDER_OPTIONS]}
              />
            </div>
            <div>
              <label className="smallLabel">Altura (cm)</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                min={MIN_HEIGHT_CM}
                max={MAX_HEIGHT_CM}
                step="0.1"
                value={heightCm}
                onChange={(e) => setHeightCm(e.target.value)}
                placeholder="ej: 178"
              />
            </div>
            <div>
              <label className="smallLabel">Bio</label>
              <textarea
                className="input compactTextarea"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tu enfoque de entrenamiento, especialidad o meta principal"
              />
            </div>
            <div className="quickActions">
              <button className="btn primary" onClick={saveProfile} disabled={busy}>
                {busy ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </>
        ) : (
          <div className="chipRow">
            <span className="chip">{data?.email || "-"}</span>
            <span className="chip">Rol: {data?.role || "-"}</span>
            <span className="chip">Plan: {data?.plan || "-"}</span>
            <span className="chip">Sesiones: {data?.training_stats.sessions_total ?? 0}</span>
            <span className="chip">{`Última: ${formatDate(data?.training_stats.last_session_at)}`}</span>
            {data?.profile.height_cm ? (
              <span className="chip">{`Altura: ${data.profile.height_cm} cm`}</span>
            ) : null}
          </div>
        )}
      </section>

      <section className="surface stack compactStack">
        <div className="sectionHead">
          <h3>Coach</h3>
          <p>Con quien intercambias progreso y feedback.</p>
        </div>

        {data && data.network.coaches.length > 0 ? (
          <>
            <div className="chipRow">
              {data.network.coaches.map((coach) => (
                <span key={coach.user_id} className="chip">{`Coach: ${coach.label}`}</span>
              ))}
            </div>
            <div className="quickActions">
              <button className="btn" onClick={leaveCoachAction} disabled={busy}>
                {busy ? "Saliendo..." : "Salir de este coach"}
              </button>
            </div>
          </>
        ) : (
          <div className="stack compactStack">
            <div className="small">Sin coach asignado todavía.</div>
            <div className="quickActions">
              <input
                className="input"
                value={coachCode}
                onChange={(e) => setCoachCode(e.target.value)}
                placeholder="Código de invitación (ej. K7QX-9MFP)"
              />
              <button className="btn primary" onClick={joinCoach} disabled={busy}>
                {busy ? "Uniendo..." : "Unirme"}
              </button>
            </div>
          </div>
        )}

        {data && data.network.athletes_total > 0 ? (
          <div className="quickActions">
            <span className="chip">{`Atletas asignados: ${data.network.athletes_total}`}</span>
            <button className="btn" onClick={() => nav("/users")}>
              Ver atletas
            </button>
          </div>
        ) : null}
      </section>

      <section className="surface stack compactStack">
        <div className="sectionHead">
          <h3>Compartir progreso</h3>
          <p>
            {isCoachOfThread
              ? `Publicas en el hilo de ${activeSubject?.label || "el atleta"}.`
              : "Envia un reporte con tus últimas medidas y entrenamientos a tu coach."}
          </p>
        </div>

        <textarea
          className="input compactTextarea"
          value={shareNote}
          onChange={(e) => setShareNote(e.target.value)}
          placeholder="Como te sentiste, dudas, ajustes que pides..."
        />

        <div className="quickActions">
          <button className="btn primary" onClick={publishShare} disabled={busy || !threadAthleteId}>
            {busy ? "Enviando..." : "Compartir progreso"}
          </button>
          <button className="btn" onClick={() => nav("/profile/progress")}>
            Ver medidas
          </button>
        </div>

        <div className="small">
          Solo se comparten medidas y datos de entrenamiento. Tus fotos de progreso quedan en tu dispositivo y nadie
          más las ve.
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Hilo de progreso</h3>
          <p>{activeSubject ? `Sujeto: ${activeSubject.label}` : "Reportes y respuestas."}</p>
        </div>

        {sharesLoading ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            Cargando hilo...
          </div>
        ) : shares.length === 0 ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            Aún no hay reportes compartidos.
          </div>
        ) : (
          <div className="stack compactStack" style={{ marginTop: 12 }}>
            {shares.map((item) => (
              <article key={item.id} className="listItem shareCard">
                <div className="listMain">
                  <strong>{`${item.author.label} | ${formatDate(item.created_at_utc)}`}</strong>
                  {item.note ? <span className="small">{item.note}</span> : null}
                </div>

                <div className="chipRow">
                  {item.metrics.map((metric) => (
                    <span key={metric.key} className="chip">
                      {`${metric.label}: ${metric.value} ${metric.unit}${formatDelta(metric.delta, metric.unit)}`}
                    </span>
                  ))}
                  <span className="chip">{`Sesiones 30d: ${item.sessions_recent}`}</span>
                </div>

                {item.comments.length > 0 ? (
                  <div className="shareThread">
                    {item.comments.map((comment) => (
                      <div key={comment.id} className="shareComment">
                        <strong className="small">{`${comment.author.label}${
                          comment.author.role === "coach" || comment.author.role === "admin" ? " (coach)" : ""
                        }`}</strong>
                        <span className="small">{comment.body}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="shareReplyRow">
                  <input
                    className="input"
                    value={replyDrafts[item.id] || ""}
                    onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    placeholder="Responder..."
                  />
                  <button className="btn" onClick={() => void sendReply(item.id)} disabled={busy}>
                    Enviar
                  </button>
                </div>

                <div className="quickActions">
                  <button className="btn" onClick={() => void shareOutside(item)}>
                    Compartir fuera
                  </button>
                  {user?.id === item.author.user_id ? (
                    <button className="btn" onClick={() => void removeShare(item.id)} disabled={busy}>
                      Borrar
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
