export type ChartBar = {
  label: string;
  value: number;
  valueLabel?: string;
};

const PLACEHOLDER_BAR_VALUES = [42, 68, 30, 85, 54, 71, 38];
const PLACEHOLDER_LINE_VALUES = [24, 52, 34, 68, 46, 78, 58, 88, 50];
const PLACEHOLDER_RADAR_RINGS = ["50,6 87,27 87,73 50,94 13,73 13,27", "50,24 71,36 71,64 50,76 29,64 29,36"];
const PLACEHOLDER_RADAR_AREA = "50,30 66,40 63,66 50,70 34,60 32,38";

/** Gráfica falsa, estatica y en tonos grises: marca donde ira una gráfica real mientras no hay datos. */
export function ChartPlaceholder({
  variant = "line",
  height = 56,
  caption = "Aún no hay datos para esta gráfica",
}: {
  variant?: "line" | "bars" | "radar";
  height?: number;
  caption?: string | null;
}) {
  return (
    <div className="chartPlaceholder" role="img" aria-label={caption ?? "Gráfica sin datos"}>
      {variant === "bars" ? (
        <div className="chartPlaceholderBars" style={{ height }} aria-hidden="true">
          {PLACEHOLDER_BAR_VALUES.map((value, idx) => (
            <div key={idx} className="chartPlaceholderBar" style={{ height: `${value}%` }} />
          ))}
        </div>
      ) : variant === "radar" ? (
        <svg className="chartPlaceholderRadar" style={{ height }} viewBox="0 0 100 100" aria-hidden="true">
          {PLACEHOLDER_RADAR_RINGS.map((points, idx) => (
            <polygon key={idx} className="chartPlaceholderRadarRing" points={points} />
          ))}
          <polygon className="chartPlaceholderRadarArea" points={PLACEHOLDER_RADAR_AREA} />
        </svg>
      ) : (
        <svg className="chartPlaceholderLine" style={{ height }} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
          <polyline
            points={PLACEHOLDER_LINE_VALUES.map(
              (value, idx) => `${(idx / (PLACEHOLDER_LINE_VALUES.length - 1)) * 100},${40 - (value / 100) * 40}`,
            ).join(" ")}
          />
        </svg>
      )}
      {caption ? <span className="chartPlaceholderCaption small">{caption}</span> : null}
    </div>
  );
}

export function BarChart({ bars }: { bars: ChartBar[] }) {
  if (bars.length === 0) {
    return <ChartPlaceholder variant="bars" height={90} />;
  }

  const max = bars.reduce((acc, bar) => Math.max(acc, bar.value), 0);

  return (
    <div className="barChart">
      {bars.map((bar, idx) => (
        <div key={`${bar.label}-${idx}`} className="barRow">
          <span className="barLabel small">{bar.label}</span>
          <div className="barTrack">
            <div
              className="barFill"
              style={{ width: `${max > 0 ? Math.max(3, (bar.value / max) * 100) : 0}%` }}
            />
          </div>
          <span className="barValue small">{bar.value > 0 ? bar.valueLabel ?? String(bar.value) : "-"}</span>
        </div>
      ))}
    </div>
  );
}

/** Línea de tendencia sin ejes: solo la forma de la curva. */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <ChartPlaceholder variant="line" height={56} caption={null} />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, idx) => {
      const x = (idx / (values.length - 1)) * 100;
      const y = 100 - ((value - min) / span) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg className="sparkline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}

/** Sparkline con puntos marcados y etiquetas de inicio/fin, para pantallas de detalle. */
export function ProgressChart({
  values,
  startLabel,
  endLabel,
}: {
  values: number[];
  startLabel?: string;
  endLabel?: string;
}) {
  if (values.length < 2) {
    return (
      <div className="progressChartWrap">
        <ChartPlaceholder variant="line" height={140} caption="Aún no hay suficientes registros para esta gráfica" />
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = values.map((value, idx) => {
    const x = (idx / (values.length - 1)) * 100;
    const y = 100 - ((value - min) / span) * 100;
    return { x, y };
  });
  const points = coords.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");

  return (
    <div className="progressChartWrap">
      <svg className="sparkline progressChart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Gráfica de progreso">
        <polyline points={points} />
        {coords.map((point, idx) => (
          <circle key={idx} className="progressChartDot" cx={point.x} cy={point.y} r={1.6} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {startLabel || endLabel ? (
        <div className="progressChartCaption small">
          <span>{startLabel || ""}</span>
          <span>{endLabel || ""}</span>
        </div>
      ) : null}
    </div>
  );
}
