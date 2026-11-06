import { usePluginMessages } from "@savia/studio-shared/plugin-locale-react";
import { integrationMessages } from "./locales";
import { useState } from "react";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
import { money, text, errorMessage } from "@savia/insurance-workbench/data";
import { manifest } from "./manifest";
import { requirement } from "./object";
import { settle, addBatch, type Batch } from "./domain";
import { useFinance } from "./use-finance";
import { decimal, download } from "./support";
import "@savia/insurance-workbench/workbench.css";
export function Screen({ savia }: { savia: PluginApi }) {
 const t = usePluginMessages(integrationMessages);
  const f = useFinance(savia);
  const [selected, setSelected] = useState<string[]>([]),
    [rate, setRate] = useState(""),
    [adjustment, setAdjustment] = useState("0"),
    [preview, setPreview] = useState<Omit<Batch, "id" | "createdAt"> | null>(
      null,
    ),
    [problem, setProblem] = useState("");
  const used = new Set(
    f.state.batches.flatMap((b) => b.lines.map((l) => l.source)),
  );
  const available = f.records.filter((r) => !used.has(r.id));
  function calculate() {
    try {
      setPreview(
        settle(
          available.filter((r) => selected.includes(r.id)),
          rate,
          adjustment,
        ),
      );
      setProblem("");
    } catch (e) {
      setPreview(null);
      setProblem(errorMessage(e));
    }
  }
  function exportBatch(b: Batch) {
    download(`liquidacion-${b.id}.csv`, [
      ["batch", "commission", "owner", "share", "adjustment", "total"],
      ...b.lines.map((l) => [
        b.id,
        l.source,
        l.owner,
        decimal(l.amount),
        "",
        "",
      ]),
      [
        b.id,
        "Ajuste del lote",
        "",
        "",
        (b.adjustment < 0 ? "-" : "") + decimal(Math.abs(b.adjustment)),
        decimal(b.total),
      ],
    ]);
  }
  return (
    <main className="iw-finance">
      <header>
        <div>
          <h1>{manifest.label}</h1>
          <p>
            {t("Selecciona comisiones recaudadas, calcula la participación y conserva un estado de liquidación por lote.")}</p>
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
        {t("Acceso de administración. Base de cálculo: comisión recibida. Un origen puede liquidarse una sola vez; liquida cuando su recaudo esté completo. Los ajustes pertenecen al lote. No se ejecutan transferencias.")}</small>
      {f.error && <p role="alert">{f.error}</p>}
      {f.notice && <p role="status">{f.notice}</p>}
      {f.busy && <p role="status">{t("Procesando…")}</p>}
      <section>
        <h2>{t("Comisiones disponibles")}</h2>
        {!available.length ? (
          <p>
            {t("No hay comisiones pendientes de liquidar. Registra primero una comisión.")}</p>
        ) : (
          <div className="iw-table">
            <table>
              <thead>
                <tr>
                  <th>{t("Incluir")}</th>
                  <th>{t("Comisión")}</th>
                  <th>{t("Responsable")}</th>
                  <th>{t("Recibido")}</th>
                </tr>
              </thead>
              <tbody>
                {available.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        aria-label={t("Incluir %{value}", {value: text(r.name) || r.id})}
                        type="checkbox"
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
                    <td>{text(r.owner) || t("Sin responsable")}</td>
                    <td>{money(r.paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section>
        <h2>{t("Calcular liquidación")}</h2>
        <div className="iw-controls">
          <label>
            {t("Participación (%)")}<input
              inputMode="decimal"
              value={rate}
              onChange={(e) => {
                setRate(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          <label>
            {t("Ajuste del lote (COP)")}<input
              inputMode="decimal"
              value={adjustment}
              onChange={(e) => {
                setAdjustment(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          <button
            disabled={f.busy || !f.ready || !selected.length}
            onClick={calculate}
          >
            {t("Previsualizar liquidación")}</button>
        </div>
        {problem && <p role="alert">{problem}</p>}
        {preview && (
          <>
            <div className="iw-table">
              <table>
                <thead>
                  <tr>
                    <th>{t("Comisión")}</th>
                    <th>{t("Responsable")}</th>
                    <th>{t("Participación")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((l) => (
                    <tr key={l.source}>
                      <td>{l.source}</td>
                      <td>{l.owner}</td>
                      <td>{money(decimal(l.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              {t("Total del lote, incluido ajuste:")}{" "}
              <output>{money(decimal(preview.total))}</output>
            </p>
            <button
              className="iw-primary"
              disabled={f.busy}
              onClick={() =>
                void f.act(async () => {
                  const fresh = await Promise.all(
                    preview.lines.map((l) =>
                      savia.collections
                        .collection<Record<string, unknown>>(
                          "insurance_commissions",
                        )
                        .get(l.source),
                    ),
                  );
                  if (
                    fresh.some(
                      (r, i) => r._version !== preview.lines[i].sourceVersion,
                    )
                  )
                    throw new Error("Una comisión cambió desde el cálculo.");
                  await f.save(
                    addBatch(f.state, {
                      ...settle(fresh, rate, adjustment),
                      id: crypto.randomUUID(),
                      createdAt: new Date().toISOString(),
                    }),
                  );
                  setSelected([]);
                  setPreview(null);
                })
              }
            >
              {t("Confirmar liquidación")}</button>
          </>
        )}
      </section>
      <section>
        <h2>{t("Estados guardados")}</h2>
        {!f.state.batches.length ? (
          <p>{t("Aún no hay liquidaciones confirmadas.")}</p>
        ) : (
          <div className="iw-table">
            <table>
              <thead>
                <tr>
                  <th>{t("Fecha")}</th>
                  <th>{t("Comisiones")}</th>
                  <th>{t("Total")}</th>
                  <th>{t("Estado de cuenta")}</th>
                </tr>
              </thead>
              <tbody>
                {f.state.batches.map((b) => (
                  <tr key={b.id}>
                    <td>{b.createdAt.slice(0, 10)}</td>
                    <td>{b.lines.length}</td>
                    <td>{money(decimal(b.total))}</td>
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
