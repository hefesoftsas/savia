import { useSyncExternalStore } from "react";

// Transient UI feedback only; authentication remains owned by the auth provider.
let pending = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
export const getLogoutPending = () => pending > 0;

export function beginLogout(): () => void {
  pending += 1;
  notify();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    pending -= 1;
    notify();
  };
}

export function useLogoutPending(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getLogoutPending,
    () => false,
  );
}
