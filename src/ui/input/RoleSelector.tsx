import type { OligoRole } from '../../core/oligo-input';

const ROLE_LABELS: Readonly<Record<OligoRole, string>> = {
  forward: 'Forward primer',
  reverse: 'Reverse primer',
  probe: 'Probe',
};

interface RoleSelectorProps {
  oligoId: string;
  name: string;
  role: OligoRole | undefined;
  onChange: (oligoId: string, role: OligoRole) => void;
}

/**
 * A single oligo's role picker. `role` is undefined when no guess was made
 * and the user has not chosen one yet -- the select then shows a placeholder
 * option with no valid role selected.
 */
export function RoleSelector({ oligoId, name, role, onChange }: RoleSelectorProps) {
  const selectId = `role-select-${oligoId}`;

  return (
    <>
      <label htmlFor={selectId}>{`Role for ${name}`}</label>
      <select
        id={selectId}
        value={role ?? ''}
        onChange={(e) => onChange(oligoId, e.target.value as OligoRole)}
      >
        <option value="" disabled>
          Select a role&hellip;
        </option>
        {(Object.keys(ROLE_LABELS) as OligoRole[]).map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
    </>
  );
}
