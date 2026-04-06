import { memo, type CSSProperties } from "react";

type HoloVoiceOrbMode = "docked_idle" | "focus_listening" | "error" | "muted";
type VoiceStatus = "inactive" | "loading" | "armed" | "listening" | "error";

type HoloVoiceAssistantOverlayProps = {
  mode: HoloVoiceOrbMode;
  status: VoiceStatus;
  wakeLabel: string;
  transcript: string;
  response: string;
  error: string;
};

type OrbitArc = {
  id: string;
  startDeg: number;
  spanDeg: number;
  opacity: number;
};

type OrbitBody = {
  id: string;
  radiusPx: number;
  sizePx: number;
  intensity: number;
  phaseSec: number;
  direction: "normal" | "reverse";
  periodSec: number;
};

type OrbitPlane = {
  id: string;
  sizePct: number;
  tiltXDeg: number;
  tiltYDeg: number;
  spinSec: number;
  ringOpacity: number;
  ringThicknessPx: number;
  reverse: boolean;
  arcs: OrbitArc[];
  bodies: OrbitBody[];
};

type StarParticle = {
  id: string;
  leftPct: number;
  topPct: number;
  sizePx: number;
  opacity: number;
  delaySec: number;
  durationSec: number;
};

function cssVars(values: Record<string, string | number>): CSSProperties {
  return values as CSSProperties;
}

function orbitalPeriodFromRadius(radiusPx: number, factor = 1): number {
  // Kepler-like scaling: period ~ r^(3/2). Tuned for compact UI timing.
  const period = Math.pow(Math.max(18, radiusPx) / 11, 1.5) * factor;
  return Number(period.toFixed(2));
}

function statusSignalPct(status: VoiceStatus): number {
  if (status === "listening") return 95;
  if (status === "armed") return 82;
  if (status === "loading") return 48;
  if (status === "error") return 6;
  return 16;
}

function statusText(status: VoiceStatus, mode: HoloVoiceOrbMode): string {
  if (mode === "muted") return "Silenciado";
  if (mode === "error" || status === "error") return "Error";
  if (status === "listening") return "Escuchando";
  if (status === "armed") return "Armado";
  if (status === "loading") return "Cargando";
  return "En espera";
}

const SOLAR_PLANES: OrbitPlane[] = [
  {
    id: "alpha",
    sizePct: 56,
    tiltXDeg: 76,
    tiltYDeg: 12,
    spinSec: 11.6,
    ringOpacity: 0.62,
    ringThicknessPx: 2.2,
    reverse: false,
    arcs: [
      { id: "alpha-a", startDeg: 16, spanDeg: 70, opacity: 0.72 },
      { id: "alpha-b", startDeg: 206, spanDeg: 48, opacity: 0.58 },
    ],
    bodies: [
      {
        id: "alpha-p1",
        radiusPx: 22,
        sizePx: 7,
        intensity: 0.98,
        phaseSec: -0.8,
        direction: "normal",
        periodSec: orbitalPeriodFromRadius(22, 0.9),
      },
      {
        id: "alpha-p2",
        radiusPx: 30,
        sizePx: 5,
        intensity: 0.7,
        phaseSec: -2.1,
        direction: "reverse",
        periodSec: orbitalPeriodFromRadius(30, 0.84),
      },
    ],
  },
  {
    id: "beta",
    sizePct: 70,
    tiltXDeg: -62,
    tiltYDeg: 22,
    spinSec: 14.8,
    ringOpacity: 0.55,
    ringThicknessPx: 2,
    reverse: true,
    arcs: [
      { id: "beta-a", startDeg: 54, spanDeg: 54, opacity: 0.64 },
      { id: "beta-b", startDeg: 244, spanDeg: 62, opacity: 0.52 },
    ],
    bodies: [
      {
        id: "beta-p1",
        radiusPx: 34,
        sizePx: 6,
        intensity: 0.82,
        phaseSec: -1.6,
        direction: "normal",
        periodSec: orbitalPeriodFromRadius(34, 0.96),
      },
    ],
  },
  {
    id: "gamma",
    sizePct: 82,
    tiltXDeg: 86,
    tiltYDeg: -8,
    spinSec: 16.4,
    ringOpacity: 0.48,
    ringThicknessPx: 1.8,
    reverse: false,
    arcs: [
      { id: "gamma-a", startDeg: 128, spanDeg: 64, opacity: 0.6 },
      { id: "gamma-b", startDeg: 308, spanDeg: 38, opacity: 0.48 },
    ],
    bodies: [
      {
        id: "gamma-p1",
        radiusPx: 42,
        sizePx: 5,
        intensity: 0.68,
        phaseSec: -3,
        direction: "reverse",
        periodSec: orbitalPeriodFromRadius(42, 1),
      },
      {
        id: "gamma-p2",
        radiusPx: 48,
        sizePx: 4,
        intensity: 0.55,
        phaseSec: -0.3,
        direction: "normal",
        periodSec: orbitalPeriodFromRadius(48, 0.92),
      },
    ],
  },
  {
    id: "delta",
    sizePct: 96,
    tiltXDeg: 56,
    tiltYDeg: -24,
    spinSec: 18.1,
    ringOpacity: 0.42,
    ringThicknessPx: 1.7,
    reverse: true,
    arcs: [
      { id: "delta-a", startDeg: 24, spanDeg: 46, opacity: 0.54 },
      { id: "delta-b", startDeg: 172, spanDeg: 72, opacity: 0.5 },
    ],
    bodies: [
      {
        id: "delta-p1",
        radiusPx: 56,
        sizePx: 5,
        intensity: 0.6,
        phaseSec: -1.2,
        direction: "normal",
        periodSec: orbitalPeriodFromRadius(56, 1.08),
      },
    ],
  },
  {
    id: "epsilon",
    sizePct: 112,
    tiltXDeg: -74,
    tiltYDeg: 34,
    spinSec: 19.6,
    ringOpacity: 0.34,
    ringThicknessPx: 1.5,
    reverse: false,
    arcs: [
      { id: "epsilon-a", startDeg: 86, spanDeg: 58, opacity: 0.48 },
      { id: "epsilon-b", startDeg: 264, spanDeg: 44, opacity: 0.42 },
    ],
    bodies: [
      {
        id: "epsilon-p1",
        radiusPx: 66,
        sizePx: 4,
        intensity: 0.52,
        phaseSec: -2.2,
        direction: "reverse",
        periodSec: orbitalPeriodFromRadius(66, 1.14),
      },
      {
        id: "epsilon-p2",
        radiusPx: 74,
        sizePx: 3,
        intensity: 0.46,
        phaseSec: -3.8,
        direction: "normal",
        periodSec: orbitalPeriodFromRadius(74, 1.18),
      },
    ],
  },
  {
    id: "zeta",
    sizePct: 128,
    tiltXDeg: 34,
    tiltYDeg: -46,
    spinSec: 22.2,
    ringOpacity: 0.28,
    ringThicknessPx: 1.3,
    reverse: true,
    arcs: [
      { id: "zeta-a", startDeg: 138, spanDeg: 62, opacity: 0.44 },
      { id: "zeta-b", startDeg: 314, spanDeg: 32, opacity: 0.36 },
    ],
    bodies: [
      {
        id: "zeta-p1",
        radiusPx: 82,
        sizePx: 3,
        intensity: 0.42,
        phaseSec: -0.6,
        direction: "normal",
        periodSec: orbitalPeriodFromRadius(82, 1.24),
      },
    ],
  },
  {
    id: "eta",
    sizePct: 144,
    tiltXDeg: 48,
    tiltYDeg: 52,
    spinSec: 24.8,
    ringOpacity: 0.22,
    ringThicknessPx: 1.1,
    reverse: false,
    arcs: [
      { id: "eta-a", startDeg: 62, spanDeg: 34, opacity: 0.36 },
      { id: "eta-b", startDeg: 212, spanDeg: 58, opacity: 0.32 },
    ],
    bodies: [
      {
        id: "eta-p1",
        radiusPx: 92,
        sizePx: 2,
        intensity: 0.34,
        phaseSec: -1.4,
        direction: "reverse",
        periodSec: orbitalPeriodFromRadius(92, 1.3),
      },
    ],
  },
];

const CORE_SEGMENTS = Array.from({ length: 16 }, (_, index) => index);

function buildStarParticles(): StarParticle[] {
  return Array.from({ length: 26 }, (_, index) => {
    const angle = (index / 26) * Math.PI * 2;
    const radius = 30 + (index % 7) * 7.2;
    const x = 50 + Math.cos(angle * 1.7 + index * 0.3) * radius * 0.46;
    const y = 50 + Math.sin(angle * 1.4 + index * 0.22) * radius * 0.44;
    return {
      id: `star-${index}`,
      leftPct: Math.max(4, Math.min(96, x)),
      topPct: Math.max(4, Math.min(96, y)),
      sizePx: 0.8 + (index % 4) * 0.6,
      opacity: 0.14 + (index % 5) * 0.12,
      delaySec: (index % 9) * 0.26,
      durationSec: 4.8 + (index % 6) * 1.1,
    };
  });
}

const STAR_PARTICLES = buildStarParticles();

function HoloVoiceAssistantOverlay({
  mode,
  status,
  wakeLabel,
  transcript,
  response,
  error,
}: HoloVoiceAssistantOverlayProps) {
  const isFocused = mode === "focus_listening";
  const isMuted = mode === "muted";
  const isError = mode === "error" || (status === "error" && mode !== "muted");
  const isListening = !isMuted && !isError && (status === "armed" || status === "listening");
  const displayTranscript = transcript.trim();
  const displayResponse = response.trim();

  return (
    <>
      <div
        className={[
          "holoVoiceOverlay",
          "desktopDockOnly",
          isFocused ? "holoVoiceOverlayFocused" : "holoVoiceOverlayDocked",
          isListening ? "holoVoiceListening" : "",
          isError ? "holoVoiceError" : "",
          isMuted ? "holoVoiceMuted" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-hidden="true"
      >
        <div className="holoSolarSystem">
          <div className="holoSolarDepthGlow" />
          <div className="holoSolarStarField">
            {STAR_PARTICLES.map((star) => (
              <span
                key={star.id}
                className="holoSolarStar"
                style={cssVars({
                  "--star-left": `${star.leftPct}%`,
                  "--star-top": `${star.topPct}%`,
                  "--star-size": `${star.sizePx}px`,
                  "--star-opacity": star.opacity.toFixed(3),
                  "--star-delay": `${star.delaySec}s`,
                  "--star-duration": `${star.durationSec}s`,
                })}
              />
            ))}
          </div>

          <div className="holoSolarCoreShell" />
          <div className="holoSolarCore" />
          <div className="holoSolarCoreDot" />

          <div className="holoSolarCoreSegments">
            {CORE_SEGMENTS.map((segment) => (
              <span
                key={segment}
                className="holoSolarCoreSegment"
                style={cssVars({ "--segment-index": segment })}
              />
            ))}
          </div>

          {SOLAR_PLANES.map((plane) => (
            <div
              key={plane.id}
              className={`holoSolarPlane${plane.reverse ? " isReverse" : ""}`}
              style={cssVars({
                "--plane-size": `${plane.sizePct}%`,
                "--plane-tilt-x": `${plane.tiltXDeg}deg`,
                "--plane-tilt-y": `${plane.tiltYDeg}deg`,
                "--plane-spin": `${plane.spinSec}s`,
                "--plane-opacity": plane.ringOpacity.toFixed(3),
                "--plane-thickness": `${plane.ringThicknessPx}px`,
              })}
            >
              <span className="holoSolarRingTrack" />
              {plane.arcs.map((arc) => (
                <span
                  key={arc.id}
                  className="holoSolarRingArc"
                  style={cssVars({
                    "--arc-start": `${arc.startDeg}deg`,
                    "--arc-span": `${arc.spanDeg}deg`,
                    "--arc-opacity": arc.opacity.toFixed(3),
                  })}
                />
              ))}

              {plane.bodies.map((body) => (
                <span
                  key={body.id}
                  className={`holoSolarBody${body.direction === "reverse" ? " isReverse" : ""}`}
                  style={cssVars({
                    "--body-radius": `${body.radiusPx}px`,
                    "--body-size": `${body.sizePx}px`,
                    "--body-intensity": body.intensity.toFixed(3),
                    "--body-period": `${body.periodSec}s`,
                    "--body-phase": `${body.phaseSec}s`,
                  })}
                >
                  <span className="holoSolarBodyDot" />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <aside
        className={[
          "holoVoiceHud",
          "desktopDockOnly",
          isFocused ? "holoVoiceHudFocused" : "holoVoiceHudDocked",
          isError ? "holoVoiceHudError" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="holoVoiceHudHead">
          <strong>Asistente de voz</strong>
          <span className="chip">{statusText(status, mode)}</span>
        </div>
        <div className="small">{`Wake: ${wakeLabel}`}</div>
        <div className="small">{`Senal: ${statusSignalPct(status)}%`}</div>
        <div className="small">Sistema: Orbital multi-eje estable</div>
        <div className="holoVoiceHudTranscript">
          {isError ? error || "Error de captura de voz." : displayTranscript || "Esperando wake y comando..."}
        </div>
      </aside>

      <div aria-live="polite" className="holoVoiceLiveRegion">
        {displayResponse}
      </div>
      {displayResponse ? (
        <div
          className={[
            "holoVoiceResponse",
            "desktopDockOnly",
            isFocused ? "holoVoiceResponseFocused" : "holoVoiceResponseDocked",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {displayResponse}
        </div>
      ) : null}
    </>
  );
}

export default memo(HoloVoiceAssistantOverlay);
