export function isUniqueConstraint(error: unknown): boolean {
  let current = error;
  while (current instanceof Error) {
    if (/unique constraint/i.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}

export function isForeignKeyConstraint(error: unknown): boolean {
  let current = error;
  while (current instanceof Error) {
    if (/foreign key constraint/i.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}
