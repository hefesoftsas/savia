import { cn } from "@/lib/utils";

export type PwaSpinnerSize = "xs" | "sm" | "md" | "lg" | "xl";

const sizeClass: Record<PwaSpinnerSize, string | undefined> = {
  xs: "savia-ring-xs",
  sm: "savia-ring-sm",
  md: undefined,
  lg: "savia-ring-lg",
  xl: "savia-ring-xl",
};

/**
 * Branded PWA ring spinner (visual only).
 *
 * Pair it with visible text inside a `role="status"` container so
 * assistive technology announces the loading state.
 */
export function PwaSpinner({
  size = "md",
  className,
}: {
  size?: PwaSpinnerSize;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-testid="pwa-spinner"
      className={cn("savia-ring", sizeClass[size], className)}
    />
  );
}

export const PWA_SPLASH_MESSAGE = "Cargando Savia…";

/**
 * Full-screen branded boot splash for PWA cold start and lazy
 * bootstrap fallbacks. Mirrors the static splash inlined in
 * `index.html` so first paint and React takeover look identical.
 */
export function PwaSplash({
  message = PWA_SPLASH_MESSAGE,
}: {
  message?: string;
}) {
  return (
    <main
      role="status"
      aria-label={message}
      className="flex min-h-svh flex-col items-center justify-center gap-5 bg-background px-6"
    >
      <span className="relative flex size-24 items-center justify-center">
        <PwaSpinner size="xl" className="absolute inset-0" />
        <img
          src="/savia-icon-192-v2.png"
          alt=""
          width={64}
          height={64}
          className="size-16 rounded-2xl"
        />
      </span>
      <p className="text-sm text-muted-foreground">{message}</p>
    </main>
  );
}
