/** Any / Yes / No — a plain checkbox cannot express "don't filter on this". */
export function TriState({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="field"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Any</option>
      <option value="true">Yes</option>
      <option value="false">No</option>
    </select>
  );
}
