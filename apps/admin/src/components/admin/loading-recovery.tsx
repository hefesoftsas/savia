import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { defaultAppLocale, isAppLocale } from "@/i18n/app-locale";
import { translateMessage } from "@/i18n/core";
import { loadingMessages } from "@/i18n/locales/loading";

export const LOADING_RECOVERY_DELAY_MS = 15_000;

function getRecoveryCopy() {
  const language =
    typeof document === "undefined"
      ? "es"
      : document.documentElement.lang.split("-")[0].toLowerCase();
  const locale = isAppLocale(language) ? language : defaultAppLocale;
  return {
    message: translateMessage(loadingMessages, "loadingLong", locale),
    help: translateMessage(loadingMessages, "loadingHelp", locale),
    retry: translateMessage(loadingMessages, "retry", locale),
    signIn: translateMessage(loadingMessages, "signInAgain", locale),
  };
}

export function useLoadingTimeout(resetKey?: string): boolean {
  const [timedOutForKey, setTimedOutForKey] = useState<string>();

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setTimedOutForKey(resetKey ?? ""),
      LOADING_RECOVERY_DELAY_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [resetKey]);

  return timedOutForKey === (resetKey ?? "");
}

export function LoadingRecovery({
  signInHref,
  className,
}: {
  signInHref?: string;
  className?: string;
}) {
  const copy = getRecoveryCopy();

  return (
    <section
      role="alert"
      className={[
        "mx-auto flex w-full max-w-md flex-col items-center gap-3 rounded-xl border bg-card p-6 text-center text-card-foreground shadow-sm",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="font-medium">{copy.message}</p>
      <p className="text-sm text-muted-foreground">{copy.help}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button
          type="button"
          className="min-h-11"
          onClick={() => window.location.reload()}
        >
          {copy.retry}
        </Button>
        {signInHref ? (
          <Button asChild variant="outline" className="min-h-11">
            <a href={signInHref}>{copy.signIn}</a>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
