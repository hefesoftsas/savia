/** Public-safe persistence validation error; never embeds submitted data. */
export class DatabaseInputError extends Error {
  readonly code = "DATABASE_INPUT_ERROR";
  constructor() {
    super("The database cannot store this Unicode value.");
  }
}
export function databaseConflict(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    if (["40001", "40P01"].includes(String(Reflect.get(current, "code"))))
      return true;
    current = Reflect.get(current, "cause");
  }
  return false;
}
export function databaseInputFailure(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    if (Reflect.get(current, "code") === "DATABASE_INPUT_ERROR") return true;
    current = Reflect.get(current, "cause");
  }
  return false;
}
