import { useEffect, useMemo, useState } from "react";

import {
  BODY_SLUGS,
  BODY_SLUG_LABELS,
  bodyOpacity,
  normalizeBodyValue,
  type BodySlug,
  type BodyValues,
  type BodyView,
} from "../lib/bodyMap";

type BodyManifest = {
  views: Partial<Record<BodyView, { w: number; h: number }>>;
  groups: Partial<Record<BodySlug, { views: BodyView[]; label?: string }>>;
};

const BASE = "/body";
const VIEW_LABELS: Record<BodyView, string> = { front: "Frente", back: "Espalda" };

/** Carga manifest + imagenes base/mascaras. Devuelve null si algo no existe (-> solo lista). */
function useBodyAssets(): { manifest: BodyManifest; maskOk: Set<string>; baseOk: Set<BodyView> } | null {
  const [assets, setAssets] = useState<{ manifest: BodyManifest; maskOk: Set<string>; baseOk: Set<BodyView> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const probe = (src: string) =>
      new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = src;
      });

    (async () => {
      try {
        const res = await fetch(`${BASE}/manifest.json`);
        if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) return;
        const manifest = (await res.json()) as BodyManifest;
        const views = (["front", "back"] as BodyView[]).filter((v) => manifest.views?.[v]);
        const baseChecks = await Promise.all(views.map(async (v) => [v, await probe(`${BASE}/${v}.png`)] as const));
        const baseOk = new Set(baseChecks.filter(([, ok]) => ok).map(([v]) => v));
        if (baseOk.size === 0) return;
        const maskKeys = BODY_SLUGS.flatMap((slug) =>
          (manifest.groups?.[slug]?.views ?? []).filter((v) => baseOk.has(v)).map((v) => `${slug}-${v}`),
        );
        const maskChecks = await Promise.all(
          maskKeys.map(async (key) => [key, await probe(`${BASE}/mask-${key}.png`)] as const),
        );
        const maskOk = new Set(maskChecks.filter(([, ok]) => ok).map(([key]) => key));
        if (!cancelled) setAssets({ manifest, maskOk, baseOk });
      } catch {
        // sin assets: se muestra solo la lista
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return assets;
}

/**
 * Mapa corporal: un solo color de acento, la opacidad indica el volumen relativo del grupo.
 * `values` son series (o cualquier magnitud comparable); `unit` se usa en la lista accesible.
 */
export default function BodyMap({ values, unit = "series" }: { values: BodyValues; unit?: string }) {
  const assets = useBodyAssets();
  const [view, setView] = useState<BodyView>("front");
  const [focus, setFocus] = useState<BodySlug | null>(null);

  const max = useMemo(() => Math.max(0, ...BODY_SLUGS.map((s) => values[s])), [values]);
  const ratio = (slug: BodySlug) => normalizeBodyValue(values[slug], max);
  const label = (slug: BodySlug) => assets?.manifest.groups?.[slug]?.label || BODY_SLUG_LABELS[slug];
  const rows = useMemo(
    () => [...BODY_SLUGS].sort((a, b) => values[b] - values[a] || BODY_SLUGS.indexOf(a) - BODY_SLUGS.indexOf(b)),
    [values],
  );

  const availableViews = assets ? (["front", "back"] as BodyView[]).filter((v) => assets.baseOk.has(v)) : [];
  const activeView = availableViews.includes(view) ? view : availableViews[0];
  const dims = activeView ? assets?.manifest.views[activeView] : undefined;
  const focusText = focus ? `${label(focus)}: ${values[focus]} ${unit}` : "";

  return (
    <div className="bodyMap">
      {assets && activeView && dims ? (
        <div className="bodyMapFigure">
          {availableViews.length > 1 ? (
            <div className="chipRow" role="group" aria-label="Vista del cuerpo">
              {availableViews.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`chipButton ${v === activeView ? "activeChipButton" : ""}`}
                  aria-pressed={v === activeView}
                  onClick={() => setView(v)}
                >
                  {VIEW_LABELS[v]}
                </button>
              ))}
            </div>
          ) : null}

          <div className="bodyMapStage" style={{ aspectRatio: `${dims.w} / ${dims.h}` }}>
            <img className="bodyMapBase" src={`${BASE}/${activeView}.png`} alt="" draggable={false} />
            {BODY_SLUGS.filter((slug) => assets.maskOk.has(`${slug}-${activeView}`)).map((slug) => (
              <div
                key={slug}
                className="bodyMapLayer"
                aria-hidden="true"
                style={{
                  opacity: focus && focus !== slug ? bodyOpacity(ratio(slug)) * 0.5 : bodyOpacity(ratio(slug)),
                  WebkitMaskImage: `url(${BASE}/mask-${slug}-${activeView}.png)`,
                  maskImage: `url(${BASE}/mask-${slug}-${activeView}.png)`,
                }}
              />
            ))}
          </div>
          <div className="small bodyMapFocus" aria-live="polite">
            {focusText || "Toca un grupo de la lista para resaltarlo."}
          </div>
        </div>
      ) : null}

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
              onMouseEnter={() => setFocus(slug)}
              onMouseLeave={() => setFocus(null)}
              onFocus={() => setFocus(slug)}
              onBlur={() => setFocus(null)}
              onClick={() => setFocus((prev) => (prev === slug ? null : slug))}
            >
              <span className="barLabel">{label(slug)}</span>
              <span className="barTrack">
                <span className="barFill" style={{ display: "block", width: `${ratio(slug) * 100}%`, opacity: bodyOpacity(ratio(slug)) }} />
              </span>
              <span className="barValue">{values[slug] > 0 ? `${values[slug]} ${unit}` : "sin datos"}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
