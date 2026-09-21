import { usePluginMessages } from "@savia/crm-shared/plugin-locale-react";
import { integrationMessages } from "./locales";
import { useState } from "react";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import { money, text, errorMessage } from "@savia/insurance-workbench/data";
import { manifest } from "./manifest";
import { requirement } from "./object";
import { journal, addBatch, type Entry, type Batch } from "./domain";
import { useFinance } from "./use-finance";
import { decimal, download } from "./support";
import "@savia/insurance-workbench/workbench.css";
export function Screen({ savia }: { savia: PluginApi }) {
 const t = usePluginMessages(integrationMessages);
  const f = useFinance(savia);
  const [selected, setSelected] = useState<string[]>([]),
    [debit, setDebit] = useState(""),
    [credit, setCredit] = useState(""),
    [preview, setPreview] = useState<Entry[] | null>(null),
    [versions, setVersions] = useState<Record<string, unknown>>({}),
    [problem, setProblem] = useState("");
  const used = new Set(
    f.state.batches.flatMap((b) => b.entries.map((e) => e.source)),
  );
  const available = f.records.filter((r) => !used.has(r.id));
  function calculate() {
    try {
      const sources = available.filter((r) => selected.includes(r.id));
      setPreview(journal(sources, debit, credit));
      setVersions(Object.fromEntries(sources.map((r) => [r.id, r._version])));
      setProblem("");
    } catch (e) {
      setPreview(null);
      setProblem(errorMessage(e));
    }
  }
  function exportBatch(b: Batch) {
    download(`comprobante-${b.id}.csv`, [
      ["batch", "source", "reference", "account", "debit", "credit"],
      ...b.entries.map((e) => [
        b.id,
        e.source,
        e.reference,
        e.account,
        decimal(e.debit),
        decimal(e.credit),
      ]),
    ]);
  }
  return (
    <main className="iw-finance">
      <header>
        <div>
          <h1>{manifest.label}</h1>
          <p>
            {t("Prepara lotes de obligaciones con débitos y créditos balanceados para revisión e importación contable.")}</p>
        </div>
        <button
          disabled={f.busy}
          onClick={() => {
            setPreview(null);
            void f.refresh();
          }}
        >
          {t("Actualizar datos")}</button>
      </header>
      <small>
        {t("Acceso de administración. Exportación contable de facturas por cobrar; no emite facturas fiscales ni transmite a un proveedor. Define las cuentas con tu responsable contable. Sin impuestos automáticos.")}</small>
      {f.error && <p role="alert">{f.error}</p>}
      {f.notice && <p role="status">{f.notice}</p>}
      {f.busy && <p role="status">{t("Procesando…")}</p>}
      <section>
        <h2>{t("Obligaciones sin exportar")}</h2>
        {!available.length ? (
          <p>{t("No hay obligaciones pendientes de exportar.")}</p>
        ) : (
          <div className="iw-table">
            <table>
              <thead>
                <tr>
                  <th>{t("Incluir")}</th>
                  <th>{t("Referencia")}</th>
                  <th>{t("Cliente")}</th>
                  <th>{t("Importe")}</th>
                </tr>
              </thead>
              <tbody>
                {available.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={t("Incluir %{value}", {value: text(r.name) || r.id})}
                        checked={selected.includes(r.id)}
                        onChange={(e) => {
                          setSelected(
                            e.target.checked
                              ? [...selected, r.id]
                              : selected.filter((id) => id !== r.id),
                          );
                          setPreview(null);
                        }}
                      />
                    </td>
                    <td>{text(r.name) || r.id}</td>
                    <td>{text(r.customer)}</td>
                    <td>{money(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section>
        <h2>{t("Preparar comprobante")}</h2>
        <div className="iw-controls">
          <label>
            {t("Cuenta débito · por cobrar")}<input
              value={debit}
              onChange={(e) => {
                setDebit(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          <label>
            {t("Cuenta crédito · contrapartida")}<input
              value={credit}
              onChange={(e) => {
                setCredit(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          <button
            disabled={f.busy || !f.ready || !selected.length}
            onClick={calculate}
          >
            {t("Previsualizar comprobante")}</button>
        </div>
        {problem && <p role="alert">{problem}</p>}
        {preview && (
          <>
            <div className="iw-table">
              <table>
                <thead>
                  <tr>
                    <th>{t("Referencia")}</th>
                    <th>{t("Cuenta")}</th>
                    <th>{t("Débito")}</th>
                    <th>{t("Crédito")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((e, i) => (
                    <tr key={i}>
                      <td>{e.reference}</td>
                      <td>{e.account}</td>
                      <td>{money(decimal(e.debit))}</td>
                      <td>{money(decimal(e.credit))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p role="status">
              {t("Comprobante balanceado ·")}{preview.length} {t("partidas")}</p>
            <button
              className="iw-primary"
              disabled={f.busy}
              onClick={() =>
                void f.act(async () => {
                  const fresh = await Promise.all(
                    [...new Set(preview.map((e) => e.source))].map((id) =>
                      savia.collections
                        .collection<Record<string, unknown>>(
                          "insurance_receivables",
                        )
                        .get(id),
                    ),
                  );
                  if (fresh.some((r) => r._version !== versions[String(r.id)]))
                    throw new Error("Una obligación cambió desde el cálculo.");
                  await f.save(
                    addBatch(f.state, {
                      id: crypto.randomUUID(),
                      createdAt: new Date().toISOString(),
                      entries: journal(fresh, debit, credit),
                    }),
                  );
                  setSelected([]);
                  setPreview(null);
                })
              }
            >
              {t("Guardar lote contable")}</button>
          </>
        )}
      </section>
      <section>
        <h2>{t("Lotes preparados")}</h2>
        {!f.state.batches.length ? (
          <p>{t("Aún no hay lotes guardados.")}</p>
        ) : (
          <div className="iw-table">
            <table>
              <thead>
                <tr>
                  <th>{t("Fecha")}</th>
                  <th>{t("Facturas")}</th>
                  <th>{t("Exportación")}</th>
                </tr>
              </thead>
              <tbody>
                {f.state.batches.map((b) => (
                  <tr key={b.id}>
                    <td>{b.createdAt.slice(0, 10)}</td>
                    <td>{new Set(b.entries.map((e) => e.source)).size}</td>
                    <td>
                      <button onClick={() => exportBatch(b)}>
                        {t("Exportar")}{b.id.slice(0, 8)}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
export const screens = [
  {
    id: `${manifest.id}.worklist`,
    extensionId: manifest.id,
    object: requirement.object.name,
    view: "records",
    Screen,
  },
];
