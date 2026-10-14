/**
 * Where to send someone back to after they link an account.
 *
 * This is transient view state. The local edition disables external OAuth;
 * a future authorized integration must keep redirect state on the backend.
 */
let pendingReturn: string | null = null;

export function rememberOAuthReturn(path: string): void {
  pendingReturn = path;
}

/** Reads and clears the stored path — a return is only ever taken once. */
export function takeOAuthReturn(): string | null {
  const path = pendingReturn;
  pendingReturn = null;
  return path;
}
