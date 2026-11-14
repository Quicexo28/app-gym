import { lazy, Suspense, useMemo, useState } from "react";

import {
  BODY_SLUGS,
  BODY_SLUG_LABELS,
  bodyOpacity,
  normalizeBodyValue,
  type BodySlug,
  type BodyValues,
  type BodyView,
} from "../lib/bodyMap";

// three.js pesa bastante: se baja solo cuando se abre un mapa corporal.
const BodyModel3D = lazy(() => import("./BodyModel3D"));

const VIEWS: BodyView[] = ["front", "back"];
const VIEW_LABELS: Record<BodyView, string> = { front: "Frente", back: "Espalda" };

/**
 * Mapa corporal: un solo color de acento, la opacidad indica el volumen relativo del grupo.
 * `values` son series (o cualquier magnitud comparable); `unit` se usa en la lista accesible.
 * La figura es el modelo 3D; si el dispositivo no tiene WebGL se muestra solo la lista.
 */
export default function BodyMap({
  values,
  unit = "series",
  formatValue,
  selected,
  onSelect,
}: {
  values: BodyValues;
  unit?: string;
  /** Texto del valor de cada fila; por defecto `valor unidad`. */
  formatValue?: (value: number) => string;
  /** Grupo elegido (controlado por quien llama). Con `onSelect`, tocar el cuerpo o la lista lo cambia. */
  selected?: BodySlug | null;
  onSelect?: (slug: BodySlug | null) => void;
}) {
  const [view, setView] = useState<BodyView>("front");
  const [hover, setHover] = useState<BodySlug | null>(null);
  const focus = hover ?? selected ?? null;
  const [modelFailed, setModelFailed] = useState(false);

  const max = useMemo(() => Math.max(0, ...BODY_SLUGS.map((s) => values[s])), [values]);
  const ratio = (slug: BodySlug) => normalizeBodyValue(values[slug], max);
  const ratios = useMemo(
    () => Object.fromEntries(BODY_SLUGS.map((s) => [s, normalizeBodyValue(values[s], max)])) as Record<BodySlug, number>,
    [values, max],
  );
  const rows = useMemo(
    () => [...BODY_SLUGS].sort((a, b) => values[b] - values[a] || BODY_SLUGS.indexOf(a) - BODY_SLUGS.indexOf(b)),
    [values],
  );
  const valueText = (value: number) => (formatValue ? formatValue(value) : `${value} ${unit}`);
  const focusText = focus ? `${BODY_SLUG_LABELS[focus]}: ${valueText(values[focus])}` : "";

  return (
    <div className="bodyMap">
      {modelFailed ? null : (
        <div className="bodyMapFigure">
          <div className="chipRow" role="group" aria-label="Vista del cuerpo">
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                className={`chipButton ${v === view ? "activeChipButton" : ""}`}
                aria-pressed={v === view}
                onClick={() => setView(v)}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
          <div className="bodyMapStage">
            <Suspense fallback={<div className="small bodyMapLoading">Cargando modelo…</div>}>
              <BodyModel3D ratios={ratios} view={view} focus={focus} onSelect={onSelect ? (s) => onSelect(s === selected ? null : s) : undefined} onUnavailable={() => setModelFailed(true)} />
            </Suspense>
          </div>
          <div className="small bodyMapFocus" aria-live="polite">
            {focusText || (onSelect ? "Toca un músculo del cuerpo o de la lista para ver su detalle. Arrastra para girarlo." : "Toca un grupo de la lista para resaltarlo. Arrastra el cuerpo para girarlo.")}
          </div>
        </div>
      )}

      <div className="bodyMapScale" aria-hidden="true">
        <span className="small">Menos</span>
        <span className="bodyMapScaleBar" />
        <span className="small">Más</span>
      </div>

      <ul className="bodyMapList" aria-label={`Volumen por grupo muscular (${unit})`}>
        {rows.map((slug) => (
          <li key={slug}>
            <button
              type="button"
              className="bodyMapRow barRow"
              onMouseEnter={() => setHover(slug)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(slug)}
              onBlur={() => setHover(null)}
              onClick={() => (onSelect ? onSelect(selected === slug ? null : slug) : setHover((prev) => (prev === slug ? null : slug)))}
            >
              <span className="barLabel">{BODY_SLUG_LABELS[slug]}</span>
              <span className="barTrack">
                <span className="barFill" style={{ display: "block", width: `${ratio(slug) * 100}%`, opacity: bodyOpacity(ratio(slug)) }} />
              </span>
              <span className="barValue">{values[slug] > 0 ? valueText(values[slug]) : "sin datos"}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
