import { renderExerciseTree } from "../../components/ExerciseTree";
import Select from "../../components/Select";
import type { CatalogNode } from "../../lib/exerciseTree";
import {
  ALL_EXERCISE_FILTER as ALL,
  ALL_EXERCISE_ZONE_FILTER,
  EXERCISE_ZONE_LOWER,
  EXERCISE_ZONE_UPPER,
  type ExerciseBodyZoneFilter,
  type ExerciseCatalogEntry,
} from "../../lib/exerciseCatalog";

type Props = {
  selectedZone: ExerciseBodyZoneFilter;
  selectedGroup: string;
  search: string;
  catalogCount: number;
  resultsCount: number;
  tree: CatalogNode[];
  expandAll: boolean;
  activeRootLabel: string | null;
  onZoneChange: (zone: ExerciseBodyZoneFilter) => void;
  onSearchChange: (value: string) => void;
  onClearFilters: () => void;
  onClose: () => void;
  onAdd: (entry: ExerciseCatalogEntry) => void;
  canAdd: (entry: ExerciseCatalogEntry) => boolean;
  isAdded: (entry: ExerciseCatalogEntry) => boolean;
  addedCount: number;
  onSelectGroup: (group: string) => void;
};

export default function ExercisePickerModal({
  selectedZone,
  selectedGroup,
  search,
  catalogCount,
  resultsCount,
  tree,
  expandAll,
  activeRootLabel,
  onZoneChange,
  onSearchChange,
  onClearFilters,
  onClose,
  onAdd,
  canAdd,
  isAdded,
  addedCount,
  onSelectGroup,
}: Props) {
  return (
    <div className="modalOverlay modalOverlaySheet" role="presentation" onClick={onClose}>
      <section
        className="modalCard modalCardSheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="routine-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sectionHead pickerHead">
          <div>
            <h3 id="routine-picker-title">Agregar ejercicio</h3>
            <p>{addedCount > 0 ? `En la rutina: ${addedCount}` : "Elige ejercicios finales del catálogo."}</p>
          </div>
          <button type="button" className="pickerClose" aria-label="Cerrar" onClick={onClose}>
            <svg className="iconGlyph" viewBox="0 0 24 24">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="splitGrid" style={{ marginTop: 10 }}>
          <div>
            <label className="smallLabel">Zona</label>
            <Select
              value={selectedZone}
              onChange={(v) => onZoneChange(v as ExerciseBodyZoneFilter)}
              options={[
                { value: ALL_EXERCISE_ZONE_FILTER, label: "Todas" },
                { value: EXERCISE_ZONE_UPPER, label: "Superior" },
                { value: EXERCISE_ZONE_LOWER, label: "Inferior" },
              ]}
            />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label className="smallLabel" htmlFor="routines-exercise-search">Buscar ejercicio</label>
          <input
            id="routines-exercise-search"
            className="input"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="ej: sentadilla posterior smith"
          />
        </div>

        <div className="chipRow" style={{ marginTop: 10, alignItems: "center" }}>
          <span className="chip">Catálogo total: {catalogCount}</span>
          <span className="chip">Resultados: {resultsCount}</span>
          <span className="chip">Zona: {selectedZone === ALL_EXERCISE_ZONE_FILTER ? "Todas" : selectedZone === EXERCISE_ZONE_LOWER ? "Inferior" : "Superior"}</span>
          <span className="chip">Grupo: {selectedGroup === ALL ? "Todos" : selectedGroup}</span>
        </div>

        <div className="quickActions" style={{ marginTop: 10 }}>
          <button type="button" className="btn" onClick={onClearFilters}>
            Limpiar filtros
          </button>
        </div>

        {resultsCount === 0 ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            Sin coincidencias para la combinación de filtros actual.
          </div>
        ) : (
          <div className="treeList" style={{ marginTop: 12 }}>
            {renderExerciseTree(tree, {
              expandAll,
              onSelectGroup,
              activeRootLabel,
              showScopeChip: true,
              filterItem: canAdd,
              renderActions: (entry) =>
                isAdded(entry) ? (
                  <span className="chip pickerAdded">✓ Agregado</span>
                ) : (
                  <button className="btn" onClick={() => onAdd(entry)}>
                    Agregar
                  </button>
                ),
            })}
          </div>
        )}
      </section>
    </div>
  );
}
