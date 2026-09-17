export function relationRecordLabel(record: Record<string, unknown>, displayField?: string) {
  const fullName = [record.firstname, record.lastname].filter(Boolean).join(" ");
  const value = (displayField ? record[displayField] : undefined) ?? record.display_name ?? record.displayName ?? record.name ?? record.title ?? record.subject ?? record.label ?? (fullName || undefined) ?? record.email ?? record.id;
  return String(value ?? "");
}
