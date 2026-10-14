import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { getStudioRuntime } from "@/features/studio-engine/runtime";

/** Compatibility entry for saved Studio links; authoring belongs to Flows. */
export function StudioFlowsEntry() {
  const t = useMessages(automationMessages);
  const tenant = getStudioRuntime().tenantId;
  const href =
    tenant === undefined ? "/savia-flows" : `/savia-flows?tenantId=${tenant}`;
  return (
    <section className="space-y-3 rounded-lg border bg-card p-6 text-card-foreground">
      <h2 className="text-lg font-semibold">Savia Flows</h2>
      <p className="max-w-xl text-sm text-muted-foreground">
        {t("Workflows are managed in Savia Flows.")}
      </p>
      <Button asChild>
        <a href={href}>
          {t("Open Savia Flows")}
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </a>
      </Button>
    </section>
  );
}
