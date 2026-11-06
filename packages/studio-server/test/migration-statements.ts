const statementBreakpoint = "--> statement-breakpoint";
const legacySeparator = /;(?!(?:\s*END\b))/i;

export function migrationStatements(source: string): string[] {
  const statements = source.includes(statementBreakpoint)
    ? source.split(statementBreakpoint)
    : source.split(legacySeparator);
  return statements.map((statement) => statement.trim()).filter(Boolean);
}
