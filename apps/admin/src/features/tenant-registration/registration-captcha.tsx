import { useEffect, useRef } from "react";
import { useAppLocale } from "@/i18n/core";
import { loadCaptcha } from "../public-forms/public-form-submission";
import { mountAltcha } from "../public-forms/altcha-widget";

export function RegistrationCaptcha({
  provider,
  tenantId,
  siteKey,
  onToken,
  onError,
}: {
  provider: "turnstile" | "altcha";
  tenantId: number;
  siteKey?: string;
  onToken: (value: string) => void;
  onError: () => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    locale = useAppLocale();
  useEffect(() => {
    let active = true;
    let widget: { remove(): void } | undefined;
    const verified = (value: string) => {
      if (active) onToken(value);
    };
    const failed = () => {
      if (active) {
        onToken("");
        onError();
      }
    };
    async function mount() {
      if (!container.current) return;
      if (provider === "altcha") {
        const instance = await mountAltcha(
          container.current,
          "/v1/public/registration/challenge",
          verified,
          (state) => {
            if (!active) return;
            if (state !== "verified") onToken("");
            if (state === "error") failed();
          },
          locale,
        );
        if (active) widget = instance;
        else instance.remove();
      } else {
        const api = await loadCaptcha();
        if (!active || !container.current) return;
        const id = api.render(container.current, {
          sitekey: siteKey,
          action: "tenant_signup",
          cData: String(tenantId),
          language: locale,
          size: "flexible",
          callback: verified,
          "expired-callback": () => verified(""),
          "error-callback": failed,
        });
        widget = { remove: () => api.remove(id) };
      }
    }
    void mount().catch(failed);
    return () => {
      active = false;
      widget?.remove();
    };
  }, [provider, tenantId, siteKey, locale, onToken, onError]);
  return (
    <div
      ref={container}
      className="min-h-16 max-w-full overflow-hidden"
      aria-label="CAPTCHA"
    />
  );
}
