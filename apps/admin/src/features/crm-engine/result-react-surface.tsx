import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import { useEffect, useState } from "react";
import { ResultHtmlSurface } from "./result-html-surface";
import type { ResultCardRow } from "./result-cards";
import type { ResultColumn } from "@savia/crm-shared/request-page";
export function ResultReactSurface({
  source,
  ...props
}: {
  source: string;
  rows: ResultCardRow[];
  columns: ResultColumn[];
  disabled?: boolean;
}) {
  const t = useMessages(recordsMessages);

  const [runtime, setRuntime] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    import("virtual:savia-react-runtime")
      .then((module) => {
        if (active) setRuntime(module.default);
      })
      .catch(() => {
        if (active)
          setError(
            "No se pudo cargar React. Recarga la página para reintentar.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  if (error) return <p role="alert">{error}</p>;
  if (!runtime) return <p role="status">{t("Preparando React…")}</p>;
  const html = `<body><script>window.saviaReactSource=${JSON.stringify(source).replace(/</g, "\\u003c")};</script><script>${runtime.replace(/<\/script/gi, "<\\/script")}</script></body>`;
  return <ResultHtmlSurface {...props} html={html} />;
}
