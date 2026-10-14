import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/core";
import { backgroundRefreshMessages } from "@/i18n/locales/background-refresh";

export function TenantScopeBoundary({
  status,
  retry,
  children,
}: {
  status?: "platform" | "loading" | "resolved" | "error" | "unavailable";
  retry?: () => void;
  children: ReactNode;
}) {
  const t = useMessages(backgroundRefreshMessages);
  if (!status || status === "platform" || status === "resolved")
    return children;
  if (status === "loading")
    return (
      <p role="status" className="p-6">
        {t("Loading workspace")}
      </p>
    );
  return (
    <section role="alert" className="grid justify-items-start gap-3 p-6">
      <p>{t("Workspace could not be resolved")}</p>
      {retry ? (
        <Button variant="outline" onClick={retry}>
          {t("Retry")}
        </Button>
      ) : null}
    </section>
  );
}
