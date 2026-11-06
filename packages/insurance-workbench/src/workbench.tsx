import { Workbench as GenericWorkbench } from "@savia/plugin-ui/workbench";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
import type { WorkbenchConfig } from "./types";
import { messages } from "./messages";
import { useMemo } from "react";

/** Insurance-facing compatibility wrapper around the extracted generic UI. */
export function Workbench(props: {
  savia: PluginApi;
  config: WorkbenchConfig;
}) {
  const config = useMemo<WorkbenchConfig>(
    () => ({
      ...props.config,
      messages: { ...messages, ...props.config.messages },
      searchableFields: props.config.searchableFields ?? [
        "name",
        "customer",
        "policy_reference",
        "insurer",
        "owner",
      ],
      ui: {
        contextLabel: "Seguros / Operación diaria",
        searchPlaceholder: "Buscar cliente, póliza o responsable…",
        paymentCurrency: "COP",
        paymentAmountLabel: "Valor del abono (COP)",
        timeZone: "America/Bogota",
        ...props.config.ui,
      },
    }),
    [props.config],
  );
  return <GenericWorkbench {...props} config={config} />;
}
