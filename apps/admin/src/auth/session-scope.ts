import { useSyncExternalStore } from "react";

let generation = 0;

export function getSessionGeneration(): number {
  return generation;
}

/** Only authenticated-owner replacement or logout changes the read scope. */
export function rotateSessionScope(
  reason: "logout" | "principal-change",
): void {
  generation += 1;
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent("savia:principal-changed", { detail: { reason } }),
    );
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("savia:principal-changed", listener);
  return () => window.removeEventListener("savia:principal-changed", listener);
}

export function useSessionGeneration(): number {
  return useSyncExternalStore(
    subscribe,
    getSessionGeneration,
    getSessionGeneration,
  );
}
