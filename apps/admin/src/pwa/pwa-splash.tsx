import {
  SAVIA_LOADING_MESSAGE,
  SAVIA_LOADING_LOGO,
  saviaLoadingCss,
} from "@savia/tenant-host/loading";
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

export const PWA_SPLASH_MESSAGE = SAVIA_LOADING_MESSAGE;

/**
 * Full-screen branded boot splash for PWA cold start and lazy
 * bootstrap fallbacks. Mirrors the static splash inlined in
 * `index.html` so first paint and React takeover look identical.
 *
 * It also doubles as the admin `loading` page during the auth check:
 * `loadingPrimary`/`loadingSecondary` are accepted for
 * `LoadingComponent` compatibility and intentionally ignored so the
 * boot sequence keeps a single continuous visual.
 */
export function PwaSplash({
  message = PWA_SPLASH_MESSAGE,
}: {
  message?: string;
  loadingPrimary?: string;
  loadingSecondary?: string;
}) {
  return (
    <main role="status" aria-label={message} className="savia-loading">
      <style>{saviaLoadingCss}</style>
      <span className="savia-loading-mark">
        <PwaSpinner size="xl" className="savia-ring-cover" />
        <img
          src={SAVIA_LOADING_LOGO}
          alt=""
          width={64}
          height={64}
          className="size-16 rounded-2xl"
        />
      </span>
      <p>{message}</p>
    </main>
  );
}
