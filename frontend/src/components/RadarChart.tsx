import { BODY_SLUGS, BODY_SLUG_LABELS, normalizeBodyValue, type BodySlug, type BodyValues } from "../lib/bodyMap";

const SIZE = 320;
const CENTER = SIZE / 2;
const RADIUS = 100;
const LABEL_RADIUS = RADIUS + 22;
const RINGS = [0.25, 0.5, 0.75, 1];

function point(index: number, ratio: number, radius = RADIUS): [number, number] {
  const angle = (index / BODY_SLUGS.length) * 2 * Math.PI - Math.PI / 2;
  return [CENTER + Math.cos(angle) * radius * ratio, CENTER + Math.sin(angle) * radius * ratio];
}

/** Grafico de araña: un eje por grupo muscular, el radio es el valor relativo al grupo mas trabajado. */
export default function RadarChart({
  values,
  selected,
  onSelect,
  unit = "series",
}: {
  values: BodyValues;
  selected?: BodySlug | null;
  onSelect?: (slug: BodySlug) => void;
  unit?: string;
}) {
  const max = Math.max(0, ...BODY_SLUGS.map((s) => values[s]));
  const ratios = BODY_SLUGS.map((s) => normalizeBodyValue(values[s], max));
  const polygon = ratios.map((r, i) => point(i, r).join(",")).join(" ");
  const summary = BODY_SLUGS.map((s) => `${BODY_SLUG_LABELS[s]}: ${values[s]} ${unit}`).join(", ");

  return (
    <svg className="radarChart" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`Gráfico de araña por grupo muscular. ${summary}`}>
      {RINGS.map((ring) => (
        <polygon
          key={ring}
          className="radarRing"
          points={BODY_SLUGS.map((_, i) => point(i, ring).join(",")).join(" ")}
        />
      ))}
      {BODY_SLUGS.map((slug, i) => {
        const [x, y] = point(i, 1);
        return <line key={slug} className="radarAxis" x1={CENTER} y1={CENTER} x2={x} y2={y} />;
      })}
      {max > 0 ? <polygon className="radarArea" points={polygon} /> : null}
      {BODY_SLUGS.map((slug, i) => {
        const [x, y] = point(i, ratios[i]);
        const [lx, ly] = point(i, 1, LABEL_RADIUS);
        const anchor = lx < CENTER - 8 ? "end" : lx > CENTER + 8 ? "start" : "middle";
        const active = selected === slug;
        return (
          <g
            key={slug}
            className={`radarNode ${active ? "radarNodeActive" : ""}`}
            onClick={onSelect ? () => onSelect(slug) : undefined}
            style={onSelect ? { cursor: "pointer" } : undefined}
          >
            <circle className="radarDot" cx={x} cy={y} r={active ? 5 : 3} />
            <text className="radarLabel" x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle">
              {BODY_SLUG_LABELS[slug]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
