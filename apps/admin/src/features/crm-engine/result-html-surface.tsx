import { useEffect, useMemo, useRef, useState } from "react";
import type { ResultColumn } from "@savia/crm-shared/request-page";
import type { ResultCardRow } from "./result-cards";
import { renderFormHtmlTemplate } from "@savia/crm-shared/form-html";

export function resultSurfaceDocument(
  html: string,
  rows: ResultCardRow[],
  columns: ResultColumn[],
  disabled = false,
) {
  const data = JSON.stringify({
    rows: rows.map(({ onLoad, ...row }) => row),
    columns,
    disabled,
  }).replace(/</g, "\\u003c");
  // Preserve older item templates while allowing complete documents to own the layout.
  const markup = html.includes("{{values.")
    ? rows
        .map((row) =>
          renderFormHtmlTemplate(html, {
            values: {
              title: row.title,
              status: row.status,
              ...Object.fromEntries(
                row.values.map((value, i) => [String(i), value]),
              ),
              response: row.response,
            },
          }),
        )
        .join("\n")
    : html;
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><script>window.savia=${data};window.savia.load=(id)=>parent.postMessage({type:'savia-result-load',id},'*');addEventListener('DOMContentLoaded',()=>{new ResizeObserver(()=>parent.postMessage({type:'savia-result-height',height:document.documentElement.scrollHeight},'*')).observe(document.body)});</script>${markup}`;
}

export function ResultHtmlSurface({
  html,
  rows,
  columns,
  disabled,
}: {
  html: string;
  rows: ResultCardRow[];
  columns: ResultColumn[];
  disabled?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(600);
  const srcDoc = useMemo(
    () => resultSurfaceDocument(html, rows, columns, disabled),
    [html, rows, columns, disabled],
  );
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow) return;
      if (
        event.data?.type === "savia-result-height" &&
        Number.isFinite(event.data.height)
      )
        setHeight(Math.max(200, Math.min(12000, event.data.height)));
      if (event.data?.type === "savia-result-load" && !disabled)
        rows.find((row) => row.id === event.data.id)?.onLoad();
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [rows, disabled]);
  return (
    <iframe
      ref={frame}
      title="Resultados personalizados"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      style={{ width: "100%", height, border: 0, display: "block" }}
    />
  );
}
