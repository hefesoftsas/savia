import { RecordEditor as GenericRecordEditor } from "@savia/plugin-ui/editor";
import type { WorkbenchConfig } from "./types";
import type { ComponentProps } from "react";
import { messages } from "./messages";
import { useMemo } from "react";

type Props = ComponentProps<typeof GenericRecordEditor>;
export function RecordEditor(props: Props) {
  const config = useMemo<WorkbenchConfig>(
    () => ({
      ...props.config,
      messages: { ...messages, ...props.config.messages },
      ui: {
        paymentCurrency: "COP",
        paymentAmountLabel: "Valor del abono (COP)",
        timeZone: "America/Bogota",
        ...props.config.ui,
      },
    }),
    [props.config],
  );
  return <GenericRecordEditor {...props} config={config} />;
}
