/**
 * Gráficas del modulo de dieta, compartidas entre `Home.tsx` y las pantallas
 * de `/diet`. `ProgressRing` y `MacroBar` vivian antes duplicadas en
 * `Home.tsx` con ceros hardcodeados; se movieron aquí tal cual, sin cambios
 * visuales, para que exista una única implementacion (doc `modulo-dieta.md`
 * #6.2).
 *
 * Este archivo solo exporta componentes (regla `react-refresh/only-export-
 * components`); la logica pura de estado de color vive en
 * `lib/nutrition/dietApi.ts` junto al resto de helpers compartidos.
 */

import { useId } from "react";

import { microBarStatus } from "../lib/nutrition/dietApi";
import { ChartPlaceholder } from "./Charts";

export function ProgressRing({ pct, center, caption }: { pct: number; center: string; caption: string }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const safePct = Math.max(0, Math.min(100, pct));

  return (
    <div className="ringWrap">
      <svg className="ring" viewBox="0 0 100 100" role="img" aria-label={`${caption}: ${Math.round(safePct)}%`}>
        <circle className="ringTrack" cx="50" cy="50" r={radius} />
        <circle
          className="ringFill"
          cx="50"
          cy="50"
          r={radius}
          strokeDasharray={`${(safePct / 100) * circumference} ${circumference}`}
        />
      </svg>
      <div className="ringCenter">
        <strong>{center}</strong>
        <span className="small">{caption}</span>
      </div>
    </div>
  );
}

/** "Proteína" -> "proteína": la clase CSS del macro no puede llevar tildes. */
function macroSlug(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function MacroBar({ label, value, target, unit }: { label: string; value: number; target: number; unit: string }) {
  // El redondeo vive aquí y no en cada pantalla: antes Home mostraba "66.51 g"
  // y el detalle "66 g" para el mismo dato.
  const shown = Math.round(value);
  const ratio = target > 0 ? value / target : 0;
  const pct = Math.max(0, Math.min(100, ratio * 100));
  const over = target > 0 && ratio > 1.05;
  return (
    <div className="macroRow">
      <div className="macroHead">
        <span className="small">{label}</span>
        <span className={`small ${over ? "macroOverValue" : ""}`.trim()}>
          {target > 0 ? `${shown} / ${Math.round(target)} ${unit}` : "—"}
        </span>
      </div>
      <div className="barTrack">
        <div className={`barFill macro-${macroSlug(label)} ${over ? "over" : ""}`.trim()} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export type DietTrendPoint = { label: string; value: number };

/**
 * Gráfica de tendencia del histórico de dieta (línea + área con degradado del
 * acento, línea de objetivo punteada si aplica). Un solo hue (magnitud), sin
 * doble eje: kcal en `y`, días en `x` (doc skill `dataviz` #1-4). Puntos
 * individuales solo se marcan cuando hay pocos (7 días); con series largas
 * (30/90 días) solo se destaca el último valor, para no saturar de marcas.
 */
export function DietTrendChart({
  points,
  target,
  unit,
  height = 168,
}: {
  points: DietTrendPoint[];
  target?: number | null;
  unit: string;
  height?: number;
}) {
  const gradientId = useId();

  if (points.length < 2) {
    return <ChartPlaceholder variant="line" height={height} caption="Aún no hay suficientes días registrados." />;
  }

  const values = points.map((point) => point.value);
  const domainValues = target !== null && target !== undefined ? [...values, target] : values;
  const domainMin = Math.min(...domainValues);
  const domainMax = Math.max(...domainValues);
  const span = domainMax - domainMin || 1;
  const pad = span * 0.12;
  const paddedMin = domainMin - pad;
  const paddedSpan = span + pad * 2 || 1;

  const x = (idx: number) => (idx / (values.length - 1)) * 100;
  const y = (value: number) => 100 - ((value - paddedMin) / paddedSpan) * 100;

  const coords = values.map((value, idx) => ({ x: x(idx), y: y(value) }));
  const linePoints = coords.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const areaPoints = `${x(0).toFixed(2)},100 ${linePoints} ${x(values.length - 1).toFixed(2)},100`;
  const targetY = target !== null && target !== undefined ? y(target) : null;
  const showAllDots = values.length <= 14;
  const lastPoint = points[points.length - 1];
  const lastCoord = coords[coords.length - 1];

  return (
    <div className="dietTrendChartWrap">
      <svg
        className="dietTrendChart"
        style={{ height }}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Tendencia: último valor ${Math.round(lastPoint.value)} ${unit}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="dietTrendGradientStart" />
            <stop offset="100%" className="dietTrendGradientEnd" />
          </linearGradient>
        </defs>

        <polygon className="dietTrendArea" points={areaPoints} fill={`url(#${gradientId})`} />

        {targetY !== null ? (
          <line className="dietTrendTargetLine" x1="0" y1={targetY} x2="100" y2={targetY} vectorEffect="non-scaling-stroke" />
        ) : null}

        <polyline className="dietTrendLine" points={linePoints} vectorEffect="non-scaling-stroke" />

        {showAllDots
          ? coords.map((point, idx) => <circle key={idx} className="dietTrendDot" cx={point.x} cy={point.y} r={1.6} vectorEffect="non-scaling-stroke" />)
          : null}
        <circle className="dietTrendDot dietTrendDotLast" cx={lastCoord.x} cy={lastCoord.y} r={2.2} vectorEffect="non-scaling-stroke" />
      </svg>

      <div className="dietTrendCaption small">
        <span>{points[0].label}</span>
        {target !== null && target !== undefined ? <span>{`Objetivo: ${Math.round(target)} ${unit}`}</span> : null}
        <span>{`${lastPoint.label}: ${Math.round(lastPoint.value)} ${unit}`}</span>
      </div>
    </div>
  );
}

export function MicroBar({
  label,
  value,
  target,
  unit,
  hasUpperLimit,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
  hasUpperLimit: boolean;
}) {
  const rawPct = target > 0 ? (value / target) * 100 : 0;
  const clampedPct = Math.max(0, Math.min(100, rawPct));
  const status = target > 0 ? microBarStatus(rawPct, hasUpperLimit) : "low";

  return (
    <div className="microRow">
      <div className="microHead">
        <span className="small">{label}</span>
        <span className="small">{target > 0 ? `${Math.round(value)} / ${Math.round(target)} ${unit}` : "—"}</span>
      </div>
      <div className="microTrack">
        <div className={`microFill ${status}`} style={{ width: `${clampedPct}%` }} />
      </div>
    </div>
  );
}
