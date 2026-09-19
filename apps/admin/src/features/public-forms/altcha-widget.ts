/** Loaded only by explicitly configured self-hosted forms; all assets are bundled locally. */
export async function mountAltcha(
  container: HTMLElement,
  challenge: string,
  onVerified: (payload: string) => void,
  onState: (state: string) => void,
) {
  if (!customElements.get("altcha-widget")) await import("altcha/i18n");
  const element = document.createElement("altcha-widget") as HTMLElement & {
    reset(): void;
  };
  element.setAttribute("challenge", challenge);
  element.setAttribute("language", "es");
  element.setAttribute(
    "configuration",
    JSON.stringify({
      humanInteractionSignature: false,
      // The public endpoint is anonymous, including when served on a separate origin.
      credentials: "omit",
    }),
  );
  const verified = (event: Event) => {
    const payload = (event as CustomEvent<{ payload?: unknown }>).detail
      ?.payload;
    if (typeof payload === "string" && payload) onVerified(payload);
  };
  const changed = (event: Event) => {
    const state = (event as CustomEvent<{ state?: unknown }>).detail?.state;
    if (typeof state === "string") onState(state);
  };
  element.addEventListener("verified", verified);
  element.addEventListener("statechange", changed);
  container.append(element);
  return {
    reset: () => element.reset(),
    remove: () => {
      element.removeEventListener("verified", verified);
      element.removeEventListener("statechange", changed);
      element.remove();
    },
  };
}
