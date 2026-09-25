type PermissionsLike = {
  canManageIdentity?: boolean;
  memberships?: Array<{ role?: string }>;
};

type ServicesLike = {
  authSession?: {
    getPermissions?: () => Promise<PermissionsLike>;
  };
};

/**
 * Precarga módulos de Studio y Savia Request cuando el navegador está libre,
 * después de que la pantalla actual sea utilizable y solo si el usuario
 * tiene acceso. Reutiliza las mismas funciones de importación que las rutas.
 * No precarga documentación, editores pesados ni datos privados. Un fallo
 * no bloquea la navegación y la ruta reintenta la importación.
 */
export function preloadRouteModules(
  services: ServicesLike,
  loaders: {
    loadStudioPage: () => Promise<unknown>;
    loadSaviaRequestPage: () => Promise<unknown>;
  },
  schedule?: (callback: () => void) => void,
): void {
  const connection =
    typeof navigator !== "undefined"
      ? (
          navigator as Navigator & {
            connection?: { saveData?: boolean; effectiveType?: string };
          }
        ).connection
      : undefined;
  if (connection?.saveData) return;
  if (
    connection?.effectiveType &&
    ["slow-2g", "2g"].includes(connection.effectiveType)
  )
    return;
  const idle =
    schedule ??
    (typeof window !== "undefined" && "requestIdleCallback" in window
      ? (callback: () => void) =>
          (
            window as Window & {
              requestIdleCallback: (
                cb: () => void,
                opts?: { timeout: number },
              ) => number;
            }
          ).requestIdleCallback(callback, { timeout: 4000 })
      : (callback: () => void) => window.setTimeout(callback, 1500));
  idle(() => {
    try {
      const permissionsPromise = services?.authSession?.getPermissions?.();
      if (!permissionsPromise?.then) return;
      void permissionsPromise
        .then((permissions) => {
          const jobs: Array<() => Promise<unknown>> = [];
          if (permissions?.canManageIdentity) jobs.push(loaders.loadStudioPage);
          const memberships = permissions?.memberships ?? [];
          const managesTenant = memberships.some((membership) =>
            ["tenant_admin", "agency_admin"].includes(membership?.role ?? ""),
          );
          if (permissions?.canManageIdentity || managesTenant)
            jobs.push(loaders.loadSaviaRequestPage);
          for (const job of jobs) {
            try {
              void job().catch(() => undefined);
            } catch {
              // La precarga fallida nunca bloquea la navegación.
            }
          }
        })
        .catch(() => undefined);
    } catch {
      // Sin sesión (tests): no hay nada que precargar.
    }
  });
}
