import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { z } from "zod";
import { useMessages } from "@/i18n/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registrationMessages } from "./registration-messages";
import { RegistrationCaptcha } from "./registration-captcha";
const configuration = z.object({
  tenantId: z.number().int().positive(),
  tenantName: z.string(),
  logoUrl: z.string().nullable().optional(),
  loginUrl: z.string(),
  captchaProvider: z.enum(["turnstile", "altcha"]),
  siteKey: z.string().optional(),
});
type Configuration = z.infer<typeof configuration>;
type Submission = {
  name: string;
  email: string;
  password: string;
  passwordConfirmation: string;
  captchaToken: string;
  requestId: string;
};
/** Anonymous registration never imports the authenticated shell or stores account proofs. */
export function RegistrationPage() {
  const t = useMessages(registrationMessages);
  const [config, setConfig] = useState<Configuration | null>(null),
    [loading, setLoading] = useState(true),
    [unavailable, setUnavailable] = useState(false),
    [captcha, setCaptcha] = useState(""),
    [error, setError] = useState<string>(""),
    [pending, setPending] = useState(false),
    [accepted, setAccepted] = useState(false),
    [widgetVersion, setWidgetVersion] = useState(0),
    [uncertain, setUncertain] = useState(false);
  const submitted = useRef<Submission | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/v1/public/registration", {
      credentials: "omit",
      signal: abort.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const result = configuration.parse(await res.json());
        if (!abort.signal.aborted) setConfig(result);
      })
      .catch(() => {
        if (!abort.signal.aborted) setUnavailable(true);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, []);
  const captchaError = useCallback(
    () =>
      setError(
        t("Verification could not load. Check your connection and reload."),
      ),
    [t],
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    if (!submitted.current) {
      const data = new FormData(event.currentTarget),
        password = String(data.get("password") ?? ""),
        confirmation = String(data.get("passwordConfirmation") ?? "");
      if (password !== confirmation) {
        setError(t("Passwords do not match."));
        return;
      }
      if (password.length < 12) {
        setError(t("Use at least 12 characters."));
        return;
      }
      if (!captcha) {
        setError(t("Complete verification to continue."));
        return;
      }
      submitted.current = {
        name: String(data.get("name") ?? "").trim(),
        email: String(data.get("email") ?? "").trim(),
        password,
        passwordConfirmation: confirmation,
        captchaToken: captcha,
        requestId: crypto.randomUUID(),
      };
    }
    setPending(true);
    try {
      const res = await fetch("/v1/public/registration", {
        method: "POST",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submitted.current),
      });
      if (res.ok) {
        submitted.current = null;
        setCaptcha("");
        setAccepted(true);
        setUncertain(false);
        return;
      }
      if (res.status === 503 || res.status >= 500) {
        setUncertain(true);
        setError(
          t("We could not confirm your request. Retry with the same details."),
        );
        return;
      }
      submitted.current = null;
      setUncertain(false);
      setCaptcha("");
      setWidgetVersion((v) => v + 1);
      setError(
        t(
          res.status === 429
            ? "Wait before trying again."
            : "Check the fields and complete verification again.",
        ),
      );
    } catch {
      setUncertain(true);
      setError(
        t("We could not confirm your request. Retry with the same details."),
      );
    } finally {
      setPending(false);
    }
  }
  const loginUrl =
    config?.loginUrl.startsWith("/") && !config.loginUrl.startsWith("//")
      ? config.loginUrl
      : "/api/auth/login";
  return (
    <main className="min-h-dvh bg-background px-5 py-10 text-foreground sm:px-8 sm:py-16">
      <section className="mx-auto max-w-lg" aria-busy={loading || pending}>
        {loading ? (
          <p role="status">{t("Loading…")}</p>
        ) : unavailable ? (
          <>
            <h1 className="text-2xl font-semibold">
              {t("Create your account")}
            </h1>
            <p role="alert" className="mt-4 text-sm">
              {t(
                "Registration is unavailable. Ask your administrator for access.",
              )}
            </p>
          </>
        ) : (
          config && (
            <>
              {config.logoUrl &&
                ((config.logoUrl.startsWith("/") &&
                  !config.logoUrl.startsWith("//")) ||
                  config.logoUrl.startsWith("https://")) && (
                  <img
                    src={config.logoUrl}
                    alt={config.tenantName}
                    className="mb-5 h-10 max-w-48 object-contain"
                  />
                )}
              <p className="mb-3 text-sm font-medium text-muted-foreground">
                {config.tenantName}
              </p>
              <h1 className="text-3xl font-semibold tracking-tight">
                {t(accepted ? "Check your email" : "Create your account")}
              </h1>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                {t(
                  accepted
                    ? "If this address can register, you will receive a verification email. Then return to sign in."
                    : "Join your team after verifying your email.",
                )}
              </p>
              {!accepted && (
                <form onSubmit={submit} className="mt-8 space-y-5">
                  <fieldset
                    disabled={pending || uncertain}
                    className="space-y-5 disabled:opacity-70"
                  >
                    <div className="space-y-2">
                      <Label htmlFor="registration-name">{t("Name")}</Label>
                      <Input
                        id="registration-name"
                        name="name"
                        autoComplete="name"
                        required
                        maxLength={100}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="registration-email">{t("Email")}</Label>
                      <Input
                        id="registration-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        maxLength={254}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="registration-password">
                        {t("Password")}
                      </Label>
                      <Input
                        id="registration-password"
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        maxLength={128}
                        aria-describedby="registration-password-hint"
                      />
                      <p
                        id="registration-password-hint"
                        className="text-sm text-muted-foreground"
                      >
                        {t("Use at least 12 characters.")}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="registration-confirmation">
                        {t("Confirm password")}
                      </Label>
                      <Input
                        id="registration-confirmation"
                        name="passwordConfirmation"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        maxLength={128}
                      />
                    </div>
                  </fieldset>
                  {!uncertain && (
                    <RegistrationCaptcha
                      key={widgetVersion}
                      provider={config.captchaProvider}
                      tenantId={config.tenantId}
                      siteKey={config.siteKey}
                      onToken={setCaptcha}
                      onError={captchaError}
                    />
                  )}
                  {error && (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  )}
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={pending || (!captcha && !uncertain)}
                  >
                    {t(pending ? "Creating account…" : "Create account")}
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    {t("Initial access: Viewer")}
                  </p>
                </form>
              )}
            </>
          )
        )}
        {!loading && (
          <a
            href={loginUrl}
            className="mt-8 inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            {t("Back to sign in")}
          </a>
        )}
      </section>
    </main>
  );
}
