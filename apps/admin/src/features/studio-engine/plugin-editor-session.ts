export type EditorSession = {
  nonce: string;
  projectId: string;
  parentOrigin: string;
};

export function resolvePluginEditorRuntimeUrl(
  configuredUrl: string | undefined,
  parentOrigin: string,
): URL | null {
  if (!configuredUrl) return null;
  try {
    const url = new URL(configuredUrl);
    const parent = new URL(parentOrigin);
    const cookieDomain = parent.hostname.endsWith(".savia-preview.hefesoft.com")
      ? "savia-preview.hefesoft.com"
      : parent.hostname.endsWith(".savia.hefesoft.com")
        ? "savia.hefesoft.com"
        : parent.hostname.endsWith(".savia.app.hefesoft.com")
          ? "savia.app.hefesoft.com"
          : parent.hostname;
    const local =
      ["localhost", "127.0.0.1"].includes(parent.hostname) &&
      ["localhost", "127.0.0.1"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.origin === parent.origin ||
      (!local &&
        (url.hostname === cookieDomain ||
          url.hostname.endsWith(`.${cookieDomain}`)))
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

export function acceptEditorEnvelope(
  event: { source: unknown; origin: string; data: unknown },
  source: unknown,
  origin: string,
  session: EditorSession,
): unknown | null {
  if (
    event.source !== source ||
    event.origin !== origin ||
    !event.data ||
    typeof event.data !== "object"
  )
    return null;
  const data = event.data as { session?: EditorSession; message?: unknown };
  if (
    data.session?.nonce !== session.nonce ||
    data.session?.projectId !== session.projectId ||
    data.session?.parentOrigin !== session.parentOrigin
  )
    return null;
  return data.message ?? null;
}

export function isIsolatedEditorRuntime(
  isolatedBuild: boolean,
  runtimeOrigin: string,
  parentOrigin: string,
): boolean {
  return (
    isolatedBuild &&
    resolvePluginEditorRuntimeUrl(runtimeOrigin, parentOrigin) !== null
  );
}
