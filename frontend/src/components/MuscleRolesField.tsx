import { BODY_SLUGS, BODY_SLUG_LABELS, toBodySlug, type BodySlug } from "../lib/bodyMap";
import { MAX_EXTRA_MUSCLES, type MuscleRole, type MuscleRoles } from "../lib/muscleRoles";

const OPTIONS: Array<{ value: MuscleRole | null; label: string }> = [
  { value: null, label: "No" },
  { value: "secondary", label: "Secundario" },
  { value: "main", label: "Principal" },
];

/**
 * Elige que otros musculos trabaja el ejercicio, ademas del grupo indicado.
 * Principal = pesa igual que el grupo; secundario = pesa la mitad.
 */
export default function MuscleRolesField({
  primaryGroup,
  roles,
  onChange,
}: {
  primaryGroup: string;
  roles: MuscleRoles;
  onChange: (roles: MuscleRoles) => void;
}) {
  const primary = toBodySlug(primaryGroup);
  const used = BODY_SLUGS.filter((slug) => slug !== primary && roles[slug]).length;
  const full = used >= MAX_EXTRA_MUSCLES;

  function setRole(slug: BodySlug, role: MuscleRole | null) {
    const next = { ...roles };
    if (role) next[slug] = role;
    else delete next[slug];
    onChange(next);
  }

  return (
    <fieldset className="muscleRolesField">
      <legend className="smallLabel">Otros músculos que trabaja (opcional)</legend>
      <p className="small">
        {primary
          ? `${BODY_SLUG_LABELS[primary]} ya es el grupo principal del ejercicio. `
          : ""}
        {`Principal cuenta igual que el grupo. Secundario cuenta la mitad. Máximo ${MAX_EXTRA_MUSCLES}.`}
      </p>
      <ul className="muscleRolesList">
        {BODY_SLUGS.filter((slug) => slug !== primary).map((slug) => (
          <li key={slug} className="muscleRolesRow">
            <span className="muscleRolesName">{BODY_SLUG_LABELS[slug]}</span>
            <div className="chipRow" role="group" aria-label={`Papel de ${BODY_SLUG_LABELS[slug]}`}>
              {OPTIONS.map((option) => {
                const active = (roles[slug] ?? null) === option.value;
                return (
                  <button
                    key={option.label}
                    type="button"
                    className={`chipButton ${active ? "activeChipButton" : ""}`}
                    aria-pressed={active}
                    disabled={full && !roles[slug] && option.value !== null}
                    onClick={() => setRole(slug, option.value)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
