import { ChartPlaceholder } from "../components/Charts";

const HISTORY_DAYS = 30;

export default function Steps() {
  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Pasos</h1>
      </header>

      <section className="surface">
        <div className="sectionHead homeHead">
          <h3>{HISTORY_DAYS} días</h3>
          <span className="mutedValue">—</span>
        </div>

        <div style={{ marginTop: 12 }}>
          <ChartPlaceholder variant="bars" height={120} caption="Aún no hay datos de pasos para esta gráfica" />
        </div>

        {/* Estado honesto: hoy no hay ninguna fuente de pasos conectada. La
            lectura vendra de Apple Salud / Google Fit (pendiente). */}
        <p className="small" style={{ marginTop: 10 }}>
          Los pasos se leerán de Apple Salud o Google Fit. La conexión todavía no está disponible.
        </p>
      </section>
    </div>
  );
}
