import { usePluginMessages } from "@savia/studio-shared/plugin-locale-react";
import { integrationMessages } from "./locales";
import { useEffect, useMemo, useState } from "react";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
import {
  loadRecords,
  csv,
  errorMessage,
  today,
  text,
  money,
} from "@savia/insurance-workbench/data";
import { downloadBlob } from "@savia/insurance-workbench/attachments";
import { manifest } from "./manifest";
import { requirement } from "./object";
import { summarize, customerRecords, type Row } from "./domain";
import "@savia/insurance-workbench/workbench.css";
const collections: Record<string, string> = {
  polizas: "Pólizas",
  insurance_receivables: "Cartera",
  insurance_renewals: "Renovaciones",
  insurance_opportunities: "Oportunidades",
  insurance_commissions: "Comisiones",
  insurance_service: "Servicio",
  insurance_claims: "Siniestros",
  insurance_documents: "Documentos",
  insurance_activities: "Actividades",
  insurance_communications: "Comunicaciones",
};
export function Screen({ savia }: { savia: PluginApi }) {
 const t = usePluginMessages(integrationMessages);
  const [data, setData] = useState<Record<string, Row[]>>({}),
    [customers, setCustomers] = useState<Row[]>([]),
    [errors, setErrors] = useState<string[]>([]),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [customer, setCustomer] = useState(""),
    [cutoff, setCutoff] = useState(today),
    [section, setSection] = useState("summary");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrors([]);
    setData({});
    (async () => {
      const definitions = await savia.collections.list();
      const installed = new Set(definitions.map((d) => d.name));
      const names = Object.keys(collections).filter((name) =>
        installed.has(name),
      );
      const responses = await Promise.allSettled(
        names.map((name) => loadRecords(savia, name)),
      );
      const next: Record<string, Row[]> = {};
      const warnings: string[] = [];
      responses.forEach((r, i) => {
        if (r.status === "fulfilled") next[names[i]] = r.value;
        else
          warnings.push(`${collections[names[i]]}: ${errorMessage(r.reason)}`);
      });
      let clients: Row[] = [];
      if (installed.has("clientes"))
        try {
          clients = await loadRecords(savia, "clientes");
        } catch (cause) {
          warnings.push(`Clientes: ${errorMessage(cause)}`);
        }
      if (active) {
        setData(next);
        setCustomers(clients);
        setErrors(warnings);
      }
    })()
      .catch((cause) => {
        if (active) setErrors([errorMessage(cause)]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [savia, revision]);
  const selected = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(data).map(([name, rows]) => [
          name,
          customer ? customerRecords(rows, customer) : rows,
        ]),
      ),
    [data, customer],
  );
  const totals = useMemo(() => summarize(selected, cutoff), [selected, cutoff]);
  function exportReport() {
    const rows: unknown[][] = [
      ["Colección", "ID", "Referencia", "Estado", "Cliente", "Fecha de corte"],
    ];
    for (const [name, records] of Object.entries(selected))
      for (const row of records)
        rows.push([
          collections[name],
          row.id,
          row.name ?? row.title,
          row.stage ?? row.estado,
          row.customer_id ?? row.cliente ?? "",
          cutoff,
        ]);
    downloadBlob(
      new Blob([csv(rows)], { type: "text/csv;charset=utf-8" }),
      `reporte-${cutoff}.csv`,
    );
  }
  return (
    <main className="iw-workbench">
      <header className="iw-heading">
        <div>
          <h1>{manifest.label}</h1>
          <p>
            {t("Indicadores de los registros disponibles y vínculos nativos del cliente.")}</p>
        </div>
        <button disabled={loading} onClick={() => setRevision((v) => v + 1)}>
          {t("Actualizar")}</button>
      </header>
      <div className="iw-tools">
        <label>
          {t("Fecha de corte")}<input
            type="date"
            value={cutoff}
            required
            onChange={(e) => {
              if (e.target.value) setCutoff(e.target.value);
            }}
          />
        </label>
        <label>
          {t("Cliente")}<select
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
          >
            <option value="">{t("Todos los clientes autorizados")}</option>
            {customers.map((row) => (
              <option key={row.id} value={row.id}>
                {text(row.name) || text(row.nombre) || row.id}
              </option>
            ))}
          </select>
        </label>
        <button disabled={loading || !!errors.length} onClick={exportReport}>
          {t("Exportar registros")}</button>
      </div>
      {loading ? (
        <p role="status">{t("Cargando colecciones…")}</p>
      ) : (
        <>
          {!!errors.length && (
            <div role="alert">
              <p>
                {t("Informe incompleto. Resuelve estos errores antes de exportar:")}</p>
              <ul>
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          <nav className="iw-filters" aria-label={t("Vista del informe")}>
            <button
              aria-pressed={section === "summary"}
              onClick={() => setSection("summary")}
            >
              {t("Indicadores")}</button>
            <button
              aria-pressed={section === "customer"}
              onClick={() => setSection("customer")}
            >
              {t("Expediente 360")}</button>
          </nav>
          {section === "summary" ? (
            <>
              <dl className="iw-metrics">
                <div>
                  <dt>{t("Saldo registrado")}</dt>
                  <dd>
                    {data.insurance_receivables
                      ? money(totals.receivableCents / 100)
                      : t("Sin colección")}
                  </dd>
                  <small>
                    {totals.invalidAmounts
                      ? t("%{value} valores inválidos excluidos", {value: totals.invalidAmounts})
                      : t("Cartera menos abonos registrados")}
                  </small>
                </div>
                <div>
                  <dt>{t("Retención resuelta")}</dt>
                  <dd>
                    {totals.retention === null
                      ? t("Sin cierres")
                      : `${(totals.retention * 100).toFixed(1)} %`}
                  </dd>
                  <small>
                    {totals.renewed} {t("renovadas ·")}{totals.lost} {t("perdidas")}</small>
                </div>
                <div>
                  <dt>{t("Oportunidades ganadas")}</dt>
                  <dd>
                    {data.insurance_opportunities
                      ? totals.won
                      : t("Sin colección")}
                  </dd>
                  <small>{t("Según etapa actual")}</small>
                </div>
                <div>
                  <dt>{t("Compromisos atrasados")}</dt>
                  <dd>{totals.overdue}</dd>
                  <small>{t("Registros abiertos con fecha vencida")}</small>
                </div>
              </dl>
              <h2>{t("Cobertura del informe")}</h2>
              <p>
                {t("Los indicadores describen el estado actual al consultar; la fecha de corte calcula vencimientos, no reconstruye saldos históricos.")}</p>
              <ul>
                {Object.entries(data).map(([name, rows]) => (
                  <li key={name}>
                    {collections[name]}: {rows.length} {t("registros autorizados")}</li>
                ))}
              </ul>
            </>
          ) : !customer ? (
            <p>
              {t("Selecciona un cliente para consultar sus registros relacionados. Los vínculos se resuelven por identificador, no por coincidencias de nombre.")}</p>
          ) : (
            Object.entries(selected).map(([name, rows]) => (
              <section key={name}>
                <h2>
                  {collections[name]} · {rows.length}
                </h2>
                {!rows.length ? (
                  <p>{t("Sin registros vinculados disponibles.")}</p>
                ) : (
                  <div className="iw-table-scroll" tabIndex={0}>
                    <table>
                      <caption>
                        {collections[name]} {t("del cliente seleccionado")}</caption>
                      <thead>
                        <tr>
                          <th>{t("Referencia")}</th>
                          <th>{t("Estado")}</th>
                          <th>{t("Responsable")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.id}>
                            <td data-label="Referencia">
                              {text(row.name) || text(row.title) || row.id}
                            </td>
                            <td data-label="Estado">
                              {text(row.stage) ||
                                text(row.estado) ||
                                t("Sin estado")}
                            </td>
                            <td data-label="Responsable">
                              {text(row.owner) || t("Sin asignar")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ))
          )}
        </>
      )}
    </main>
  );
}
export const screens = [
  {
    id: `${manifest.id}.overview`,
    extensionId: manifest.id,
    object: requirement.object.name,
    view: "records",
    Screen,
  },
];
