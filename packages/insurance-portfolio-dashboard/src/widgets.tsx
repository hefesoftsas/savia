import { useCallback, useEffect, useMemo, useState } from "react";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
import type { MyDayWidget } from "@savia/studio-shared/my-day-widgets";
import { usePluginLocale } from "@savia/studio-shared/plugin-locale-react";
import {
  localizeExternalError,
  pluginIntlLocale,
} from "@savia/studio-shared/plugin-localization";
import { useInsuranceMessages } from "./localization";
import { insurancePortfolioExtensionManifest } from "./manifest";
import type { InsurancePortfolioSummary } from "./summary";

export type InsurancePortfolioWidgetProps = {
  savia: PluginApi;
  widget: MyDayWidget;
};

type Policy = {
  id: string;
  name?: string;
  estado?: string;
};

const perPageFallback = 3;

export function InsurancePortfolioSummaryWidget({
  savia,
  widget,
}: InsurancePortfolioWidgetProps) {
  const t = useInsuranceMessages();
  const locale = usePluginLocale();
  const currency = new Intl.NumberFormat(pluginIntlLocale(locale), {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });
  const number = new Intl.NumberFormat(pluginIntlLocale(locale));

  const [summary, setSummary] = useState<InsurancePortfolioSummary | null>(
    null,
  );
  const [records, setRecords] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const errorInfo = error ? localizeExternalError(error, locale) : null;

  const polizas = useMemo(
    () => savia.collections.collection<Policy>("polizas"),
    [savia],
  );
  const limit =
    "config" in widget
      ? (widget.config?.limit ?? perPageFallback)
      : perPageFallback;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryResult, recordsResult] = await Promise.all([
        savia.services.get<InsurancePortfolioSummary>("summary"),
        polizas.list({ page: 1, perPage: limit }),
      ]);
      setSummary(summaryResult);
      setRecords(recordsResult.data);
    } catch (reason) {
      setError(reason);
    } finally {
      setLoading(false);
    }
  }, [limit, polizas, savia]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading) {
    return <p role="status">{t("Cargando pólizas…")}</p>;
  }

  if (errorInfo || !summary) {
    return (
      <div role="alert">
        <strong>{t("No pudimos actualizar la cartera.")}</strong>
        {errorInfo ? <span> {errorInfo.message}</span> : null}
      </div>
    );
  }

  const metrics: Array<[string, string]> = [
    [t("Pólizas"), number.format(summary.total)],
    [t("Vigentes"), number.format(summary.active)],
    [t("Por vencer"), number.format(summary.expiring)],
    [
      t("Prima total"),
      summary.premiumTotal === null
        ? "—"
        : currency.format(summary.premiumTotal),
    ],
  ];

  return (
    <div>
      <dl
        aria-label={t("Resumen de cartera")}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "0.75rem",
          margin: "0 0 0.75rem",
        }}
      >
        {metrics.map(([label, value]) => (
          <div key={label}>
            <dd style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>
              {value}
            </dd>
            <dt style={{ fontSize: "0.75rem", opacity: 0.7 }}>{label}</dt>
          </div>
        ))}
      </dl>
      {records.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.875rem" }}>
          {records.map((record) => (
            <li key={record.id}>
              {record.name || "Sin nombre"}
              {record.estado ? ` · ${record.estado}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export const insurancePortfolioWidgets = [
  {
    id: "summary",
    extensionId: insurancePortfolioExtensionManifest.id,
    collection: "polizas",
    title: {
      es: "Resumen de cartera",
      en: "Portfolio summary",
      pt: "Resumo da carteira",
    },
    Widget: InsurancePortfolioSummaryWidget,
  },
];
