import { usePluginMessages } from "@savia/crm-shared/plugin-locale-react";
import { integrationMessages } from "./locales";
import { useState } from "react";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import {
  money,
  text,
  errorMessage,
  csv,
} from "@savia/insurance-workbench/data";
import { manifest } from "./manifest";
import { requirement } from "./object";
import {
  parseStatement,
  importStatement,
  allocate,
  remaining,
  type Transaction,
} from "./domain";
import { useFinance } from "./use-finance";
import { decimal, download } from "./support";
import "@savia/insurance-workbench/workbench.css";
export function Screen({ savia }: { savia: PluginApi }) {
 const t = usePluginMessages(integrationMessages);
  const f = useFinance(savia);
  const [account, setAccount] = useState(""),
    [input, setInput] = useState(""),
    [preview, setPreview] = useState<Transaction[]>([]),
    [previewError, setPreviewError] = useState(""),
    [transaction, setTransaction] = useState(""),
    [obligation, setObligation] = useState(""),
    [amount, setAmount] = useState("");
  function previewImport() {
    try {
      const rows = parseStatement(input, account);
      importStatement(f.state, rows);
      setPreview(rows);
      setPreviewError("");
    } catch (e) {
      setPreview([]);
      setPreviewError(errorMessage(e));
    }
  }
  const current = f.state.transactions.find((t) => t.id === transaction);
  const candidates = [...f.records].sort(
    (a, b) =>
      Number(text(b.policy_reference) === current?.reference) -
      Number(text(a.policy_reference) === current?.reference),
  );
  return (
    <main className="iw-finance">
      <header>
        <div>
          <h1>{manifest.label}</h1>
          <p>
            {t("Importa recaudos, revisa coincidencias y asigna importes parciales. Cada diferencia conserva su trazabilidad.")}</p>
        </div>
        <button disabled={f.busy} onClick={() => void f.refresh()}>
          {t("Actualizar datos")}</button>
      </header>
      <small>
        {t("Acceso de administración. Las asignaciones se guardan en un registro conjunto con control de versión; no modifican el saldo de origen ni ejecutan pagos bancarios.")}</small>
      {f.error && <p role="alert">{f.error}</p>}
      {f.notice && <p role="status">{f.notice}</p>}
      {f.busy && <p role="status">{t("Procesando…")}</p>}
      <section>
        <h2>{t("Importar extracto")}</h2>
        <p>
          {t("CSV de recaudos positivos: id,date,reference,amount. Fecha AAAA-MM-DD, punto decimal y un identificador bancario estable por movimiento. Máximo 200 movimientos acumulados.")}</p>
        <div className="iw-controls">
          <label>
            {t("Cuenta bancaria")}<input
              value={account}
              onChange={(e) => {
                setAccount(e.target.value);
                setPreview([]);
              }}
              maxLength={80}
            />
          </label>
          <label>
            {t("Archivo CSV")}<input
              type="file"
              accept=".csv,text/csv"
              disabled={f.busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void f.act(async () => {
                    if (file.size > 100000)
                      throw new Error("El archivo supera 100 KB.");
                    setInput(await file.text());
                    setPreview([]);
                  });
              }}
            />
          </label>
        </div>
        <label>
          {t("Contenido del extracto")}<textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setPreview([]);
            }}
          />
        </label>
        <button disabled={f.busy || !f.ready} onClick={previewImport}>
          {t("Validar y previsualizar")}</button>
        {previewError && <p role="alert">{previewError}</p>}
        {preview.length > 0 && (
          <>
            <div className="iw-table">
              <table>
                <thead>
                  <tr>
                    <th>{t("Movimiento")}</th>
                    <th>{t("Fecha")}</th>
                    <th>{t("Referencia")}</th>
                    <th>{t("Recaudo")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((t) => (
                    <tr key={t.id}>
                      <td>{t.id}</td>
                      <td>{t.date}</td>
                      <td>{t.reference}</td>
                      <td>{money(decimal(t.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="iw-primary"
              disabled={f.busy}
              onClick={() =>
                void f.act(async () => {
                  await f.save(importStatement(f.state, preview));
                  setPreview([]);
                  setInput("");
                })
              }
            >
              {t("Confirmar")}{preview.length} {t("movimientos")}</button>
          </>
        )}
      </section>
      <section>
        <h2>{t("Asignar recaudo")}</h2>
        <div className="iw-controls">
          <label>
            {t("Movimiento")}<select
              value={transaction}
              onChange={(e) => setTransaction(e.target.value)}
            >
              <option value="">{t("Selecciona un movimiento")}</option>
              {f.state.transactions
                .filter((t) => remaining(f.state, t.id) > 0)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.reference} · {t.id} ·{" "}
                    {money(decimal(remaining(f.state, t.id)))}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t("Obligación")}<select
              value={obligation}
              onChange={(e) => setObligation(e.target.value)}
            >
              <option value="">{t("Selecciona una obligación")}</option>
              {candidates.map((r) => (
                <option key={r.id} value={r.id}>
                  {text(r.name) || r.id} · {text(r.policy_reference)}
                  {text(r.policy_reference) === current?.reference
                    ? t("· Coincide referencia")
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Importe (COP)")}<input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <button
            disabled={
              f.busy || !f.ready || !transaction || !obligation || !amount
            }
            onClick={() =>
              void f.act(async () => {
                const fresh = await savia.collections
                  .collection<Record<string, unknown>>("insurance_receivables")
                  .get(obligation);
                await f.save(allocate(f.state, transaction, fresh, amount));
                setAmount("");
              })
            }
          >
            {t("Guardar asignación")}</button>
        </div>
        <p>
          {t("Las coincidencias de referencia son sugerencias. El límite usa el saldo de origen actual menos todas las asignaciones locales.")}</p>
      </section>
      <section>
        <h2>{t("Movimientos y diferencias")}</h2>
        {!f.state.transactions.length ? (
          <p>{t("Aún no hay movimientos. Importa un extracto para comenzar.")}</p>
        ) : (
          <>
            <button
              onClick={() =>
                download("conciliacion.csv", [
                  ["transaction", "date", "reference", "amount", "unallocated"],
                  ...f.state.transactions.map((t) => [
                    t.id,
                    t.date,
                    t.reference,
                    decimal(t.amount),
                    decimal(remaining(f.state, t.id)),
                  ]),
                ])
              }
            >
              {t("Exportar conciliación")}</button>
            <div className="iw-table">
              <table>
                <thead>
                  <tr>
                    <th>{t("Movimiento")}</th>
                    <th>{t("Referencia")}</th>
                    <th>{t("Recaudo")}</th>
                    <th>{t("Sin asignar")}</th>
                    <th>{t("Asignaciones")}</th>
                  </tr>
                </thead>
                <tbody>
                  {f.state.transactions.map((t) => (
                    <tr key={t.id}>
                      <td>{t.id}</td>
                      <td>{t.reference}</td>
                      <td>{money(decimal(t.amount))}</td>
                      <td>{money(decimal(remaining(f.state, t.id)))}</td>
                      <td>
                        {f.state.allocations
                          .filter((a) => a.transaction === t.id)
                          .map((a, i) => (
                            <div key={i}>
                              {a.obligation}: {money(decimal(a.amount))}
                            </div>
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
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
