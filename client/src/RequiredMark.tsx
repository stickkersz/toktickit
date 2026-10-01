// Lab 2 ui-spec: required fields show a red asterisk. The "*" stays in the label text, so the
// field's accessible name still ends in "*" and existing label lookups keep working.
export function RequiredMark() {
  return <span className="zg-required">*</span>;
}

export function withRequiredMark(label: string) {
  if (!label.endsWith(" *")) return label;
  return (
    <>
      {label.slice(0, -2)} <RequiredMark />
    </>
  );
}
