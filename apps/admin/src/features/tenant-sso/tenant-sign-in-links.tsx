import { useId } from "react";
import { Link } from "react-router-dom";
import { KeyRound, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/core";
import { tenantSignInMessages } from "./tenant-sign-in-messages";

export function TenantSignInSettingsLink({ tenantId }: { tenantId: number }) {
  const t = useMessages(tenantSignInMessages);
  return (
    <Button variant="outline" asChild>
      <Link to={`/service-credentials?tenantId=${tenantId}&tab=sso`}>
        <KeyRound className="size-4" aria-hidden="true" />
        {t("Sign-in settings")}
      </Link>
    </Button>
  );
}

export function TenantSignInLinks({ tenantId }: { tenantId: number }) {
  const t = useMessages(tenantSignInMessages);
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="grid min-w-0 gap-3 pb-4">
      <div className="space-y-1">
        <h2 id={headingId} className="text-base font-semibold">
          {t("Sign-in methods")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(
            "Manage SAML SSO and Google / Microsoft sign-in for this tenant. Members use the tenant's Savia URL to sign in.",
          )}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild>
          <Link to={`/service-credentials?tenantId=${tenantId}&tab=sso`}>
            {t("Configure SSO")}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to={`/service-credentials?tenantId=${tenantId}&tab=social`}>
            {t("Configure Google / Microsoft")}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
