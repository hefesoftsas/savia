import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import {
  brandingForeground,
  parseTenantBranding,
  type TenantBranding,
} from "@savia/tenant-host/branding";

type BrandingContext = {
  branding: TenantBranding | null;
  refetch: (options?: { reload?: boolean }) => Promise<void>;
};
const Context = createContext<BrandingContext>({
  branding: null,
  refetch: async () => undefined,
});
/** Public host identity only. No session dependency or persistent browser storage. */
export function TenantBrandingProvider({
  children,
  hostname = window.location.hostname,
}: PropsWithChildren<{ hostname?: string }>) {
  const [snapshot, setSnapshot] = useState<{
    hostname: string;
    branding: TenantBranding | null;
  }>();
  const request = useRef<AbortController | null>(null);
  const branding = snapshot?.hostname === hostname ? snapshot.branding : null;
  const refetch = useCallback(
    async (options?: { reload?: boolean }) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      try {
        const response = await fetch(
          new URL("/api/public/tenant-branding", window.location.origin).href,
          {
            credentials: "omit",
            cache: options?.reload ? "reload" : "default",
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error("Branding unavailable");
        const body = (await response.json()) as { data?: unknown };
        const value = parseTenantBranding(body?.data);
        if (!controller.signal.aborted)
          setSnapshot({ hostname, branding: value });
      } catch {
        if (!controller.signal.aborted)
          setSnapshot({ hostname, branding: null });
      }
    },
    [hostname],
  );
  useEffect(() => {
    void refetch();
    return () => request.current?.abort();
  }, [refetch]);
  useEffect(() => {
    if (!branding) return;
    const style = document.createElement("style");
    const foreground = brandingForeground(branding.primaryColor);
    const values: Record<string, string> = {
      "--primary": branding.primaryColor,
      "--primary-foreground": foreground,
      "--ring": branding.primaryColor,
      "--sidebar-primary": branding.primaryColor,
      "--sidebar-primary-foreground": foreground,
      "--sidebar-ring": branding.primaryColor,
      "--accent": branding.accentColor,
      "--accent-foreground": brandingForeground(branding.accentColor),
    };
    // Corporate colors are a fallback. The personal palette owns these tokens
    // whenever ThemeProvider (or the initial appearance bootstrap) selects one.
    // A selector handles initial load, palette changes and branding refetches
    // without competing inline styles or browser-specific detection.
    style.textContent = `:root:not([data-color-theme]) {${Object.entries(values)
      .map(([name, value]) => `${name}: ${value};`)
      .join("\n")}}`;
    document.head.append(style);
    return () => style.remove();
  }, [branding]);
  return (
    <Context.Provider value={{ branding, refetch }}>
      {children}
    </Context.Provider>
  );
}
export function useTenantBranding() {
  return useContext(Context);
}
