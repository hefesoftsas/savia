import { useCallback, useState } from "react";
import { Cookie, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  getCookieConsent,
  setCookieConsent,
  type CookieConsentPreferences,
  type OptionalCookieCategory,
} from "./cookie-consent-storage";

/**
 * Mandatory cookie-consent banner: it stays visible until the user makes an
 * explicit choice (accept, reject, or save preferences), so it is truly shown
 * once per user — never as a dismissible nag.
 */
export function CookieConsentBanner() {
  const translate = useTranslate();
  const [decision, setDecision] = useState<CookieConsentPreferences | null>(
    getCookieConsent,
  );
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [optional, setOptional] = useState<
    Record<OptionalCookieCategory, boolean>
  >(decision?.optional ?? { analytics: false, marketing: false });

  const record = useCallback(
    (choices: Record<OptionalCookieCategory, boolean>) => {
      setCookieConsent(choices);
      setDecision(getCookieConsent());
      setPreferencesOpen(false);
    },
    [],
  );

  if (decision) {
    return null;
  }

  const title = translate("savia.consent.title", {
    _: "Usamos cookies",
  });
  const message = translate("savia.consent.message", {
    _: "Usamos cookies esenciales para que la plataforma funcione y, si lo autorizas, cookies analíticas y de marketing para mejorar tu experiencia.",
  });
  const acceptLabel = translate("savia.consent.acceptAll", {
    _: "Aceptar todas",
  });
  const rejectLabel = translate("savia.consent.rejectNonEssential", {
    _: "Solo esenciales",
  });
  const preferencesLabel = translate("savia.consent.preferences", {
    _: "Preferencias",
  });

  return (
    <>
      <div
        role="region"
        aria-label={title}
        className="fixed inset-x-3 bottom-3 z-50 sm:inset-x-6 lg:inset-x-auto lg:left-1/2 lg:w-[38rem] lg:-translate-x-1/2"
      >
        <div className="rounded-2xl border border-border/70 bg-popover/95 p-4 shadow-xl shadow-black/10 backdrop-blur-md">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Cookie className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {message}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPreferencesOpen(true)}
            >
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              {preferencesLabel}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => record({ analytics: false, marketing: false })}
            >
              <ShieldCheck className="size-4" aria-hidden="true" />
              {rejectLabel}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => record({ analytics: true, marketing: true })}
            >
              {acceptLabel}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={preferencesOpen} onOpenChange={setPreferencesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{preferencesLabel}</DialogTitle>
            <DialogDescription>
              {translate("savia.consent.preferencesHint", {
                _: "Elige qué cookies no esenciales permites. Puedes cambiarlo más tarde desde Ajustes.",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">
                  {translate("savia.consent.categoryEssential", {
                    _: "Cookies esenciales",
                  })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {translate("savia.consent.categoryEssentialHint", {
                    _: "Necesarias para iniciar sesión y navegar. Siempre activas.",
                  })}
                </p>
              </div>
              <Switch checked disabled aria-readonly="true" />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label
                  htmlFor="cookie-consent-analytics"
                  className="text-sm font-medium"
                >
                  {translate("savia.consent.categoryAnalytics", {
                    _: "Cookies analíticas",
                  })}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {translate("savia.consent.categoryAnalyticsHint", {
                    _: "Nos ayudan a entender cómo se usa la plataforma.",
                  })}
                </p>
              </div>
              <Switch
                id="cookie-consent-analytics"
                checked={optional.analytics}
                onCheckedChange={(checked) =>
                  setOptional((current) => ({
                    ...current,
                    analytics: checked === true,
                  }))
                }
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label
                  htmlFor="cookie-consent-marketing"
                  className="text-sm font-medium"
                >
                  {translate("savia.consent.categoryMarketing", {
                    _: "Cookies de marketing",
                  })}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {translate("savia.consent.categoryMarketingHint", {
                    _: "Se usan para campañas y contenido personalizado.",
                  })}
                </p>
              </div>
              <Switch
                id="cookie-consent-marketing"
                checked={optional.marketing}
                onCheckedChange={(checked) =>
                  setOptional((current) => ({
                    ...current,
                    marketing: checked === true,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPreferencesOpen(false)}
            >
              {translate("savia.consent.cancel", { _: "Cancelar" })}
            </Button>
            <Button type="button" onClick={() => record(optional)}>
              {translate("savia.consent.save", { _: "Guardar preferencias" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
