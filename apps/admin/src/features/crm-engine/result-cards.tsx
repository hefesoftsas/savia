import { ExternalErrorNotice } from "./external-error-notice";
import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { ResultReactSurface } from "./result-react-surface";
import { ResultHtmlSurface } from "./result-html-surface";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ResultColumn } from "@savia/crm-shared/request-page";
import "./result-cards.css";

export type ResultCardRow = {
  id: string;
  title: string;
  status: string;
  date: string;
  simulation: boolean;
  values: string[];
  errors: string[];
  response: unknown;
  onLoad: () => void;
};

/** Presentation only: columns and values come from the screen's persisted metadata. */
export function ResultCards({
  rows,
  columns,
  comparison,
  disabled,
  customHtml,
  customReact,
}: {
  rows: ResultCardRow[];
  columns: ResultColumn[];
  comparison: boolean;
  disabled?: boolean;
  customHtml?: string;
  customReact?: string;
}) {
  const t = useMessages(automationMessages);
  const locale = useAppLocale();

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const visible = rows.filter((row) =>
    [row.title, row.status, ...row.values]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const compared = visible.filter((row) => selected.includes(row.id));
  const priceIndex = columns.findIndex((column) => column.format === "money");
  if (customReact !== undefined)
    return (
      <ResultReactSurface
        source={customReact}
        rows={rows}
        columns={columns}
        disabled={disabled}
      />
    );
  if (customHtml !== undefined)
    return (
      <ResultHtmlSurface
        html={customHtml}
        rows={rows}
        columns={columns}
        disabled={disabled}
      />
    );
  return (
    <div className="result-presentation">
      <header className="result-presentation-toolbar">
        <div>
          <h3>{t("Explorar resultados")}</h3>
          <p>
            {visible.length} {t("resultados ·")}{" "}
            {rows.filter((row) => row.simulation).length} {t("de simulación")}
          </p>
        </div>
        <label>
          {t("Buscar resultados")}
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Operación, estado o valor…")}
          />
        </label>
      </header>
      {comparison && (
        <p className="text-sm text-muted-foreground">
          {t(
            "Selecciona hasta cuatro resultados para compararlos lado a lado.",
          )}
        </p>
      )}
      {!visible.length && (
        <p role="status">
          {t("No hay resultados que coincidan con la búsqueda.")}
        </p>
      )}
      <div className="result-presentation-grid">
        {visible.map((row) => (
          <article key={row.id} className="result-presentation-card">
            <header>
              <span className="text-sm text-muted-foreground">
                {row.simulation ? t("Simulación") : t("Ejecución real")} ·{" "}
                {row.status}
              </span>
              <h4>{row.title}</h4>
              <time dateTime={row.date}>
                {new Date(row.date).toLocaleString(intlLocale(locale))}
              </time>
            </header>

            {priceIndex >= 0 && (
              <div className="result-presentation-price">
                <span>{columns[priceIndex].label}</span>
                <strong>{row.values[priceIndex]}</strong>
              </div>
            )}
            <dl>
              {columns.map((column, index) =>
                index === priceIndex ? null : (
                  <div key={index}>
                    <dt>{column.label}</dt>
                    <dd>{row.values[index]}</dd>
                  </div>
                ),
              )}
            </dl>
            {row.errors.map((error, index) => (
              <ExternalErrorNotice error={error} key={index} />
            ))}
            <footer>
              {comparison && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(row.id)}
                    disabled={
                      !selected.includes(row.id) && compared.length >= 4
                    }
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [
                              ...current.filter((id) =>
                                visible.some((item) => item.id === id),
                              ),
                              row.id,
                            ]
                          : current.filter((id) => id !== row.id),
                      )
                    }
                  />
                  {t("Comparar")} {row.title}
                </label>
              )}
              <Button
                variant="outline"
                disabled={disabled}
                onClick={row.onLoad}
              >
                {t("Cargar datos")}
              </Button>
              <details>
                <summary>{t("Ver respuesta")}</summary>
                <pre>{JSON.stringify(row.response, null, 2)}</pre>
              </details>
            </footer>
          </article>
        ))}
      </div>
      {comparison && (
        <section
          className="result-presentation-comparison"
          aria-label={t("Comparación de resultados")}
        >
          <h3>{t("Comparación de resultados")}</h3>
          {compared.length < 2 ? (
            <p className="text-muted-foreground text-sm">
              {t(
                "Selecciona al menos dos resultados para ver sus diferencias.",
              )}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t("Detalle")}</th>
                    {compared.map((row) => (
                      <th scope="col" key={row.id}>
                        {row.title}
                        {row.simulation && (
                          <small className="block">{t("Simulación")}</small>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {columns.map((column, index) => (
                    <tr key={index}>
                      <th scope="row">{column.label}</th>
                      {compared.map((row) => (
                        <td key={row.id}>{row.values[index]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
