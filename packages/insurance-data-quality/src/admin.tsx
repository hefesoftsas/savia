import { usePluginMessages } from "@savia/studio-shared/plugin-locale-react";
import { integrationMessages } from "./locales";
import { useEffect, useState } from "react";
import type {
  PluginApi,
  PluginCollectionDefinition,
} from "@savia/studio-shared/plugin-api";
import {
  loadRecords,
  errorMessage,
  type WorkRecord,
} from "@savia/insurance-workbench/data";
import { manifest } from "./manifest";
import { requirement } from "./object";
import {
  parseCsv,
  planImport,
  duplicateGroups,
  type ImportRow,
} from "./domain";
import "@savia/insurance-workbench/workbench.css";
export function Screen({ savia }: { savia: PluginApi }) {
 const t = usePluginMessages(integrationMessages);
  const [objects, setObjects] = useState<PluginCollectionDefinition[]>([]),
    [object, setObject] = useState(""),
    [key, setKey] = useState(""),
    [source, setSource] = useState(""),
    [rows, setRows] = useState<ImportRow[]>([]),
    [duplicates, setDuplicates] = useState<string[][]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [history, setHistory] = useState<WorkRecord[]>([]);
  const definition = objects.find((d) => d.name === object);
  useEffect(() => {
    let active = true;
    savia.collections
      .list()
      .then((value) => {
        if (active)
          setObjects(
            value.filter((item) => item.name !== requirement.object.name),
          );
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    loadRecords(savia, requirement.object.name)
      .then((value) => {
        if (active) setHistory(value);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [savia]);
  function invalidate() {
    setReady(false);
    setRows([]);
    setDuplicates([]);
    setNotice("");
  }
  async function preview() {
    if (!definition) return;
    setBusy(true);
    setError("");
    setReady(false);
    try {
      const existing = await loadRecords(savia, object);
      setDuplicates(duplicateGroups(existing, key));
      setRows(
        planImport(parseCsv(source), definition.config.fields, existing, key),
      );
      setReady(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function execute() {
    if (!ready || busy || rows.some((r) => r.status === "invalid")) return;
    setBusy(true);
    setError("");
    setReady(false);
    let created = 0,
      failed = 0;
    try {
      const log = await savia.collections
        .collection<WorkRecord>(requirement.object.name)
        .create({
          name: `Importación ${definition?.label ?? object}`,
          stage: "draft",
          details: JSON.stringify({
            object,
            key,
            requested: rows.filter((r) => r.status === "ready").length,
          }),
        });
      const results = [...rows];
      for (let i = 0; i < results.length; i++) {
        if (results[i].status !== "ready") continue;
        try {
          await savia.collections.collection(object).create(results[i].data);
          created++;
        } catch (cause) {
          failed++;
          results[i] = {
            ...results[i],
            status: "invalid",
            error: errorMessage(cause),
          };
        }
      }
      setRows(results);
      await savia.collections.collection(requirement.object.name).update(
        log.id,
        {
          stage: failed ? "failed" : "completed",
          details: JSON.stringify({ object, key, created, failed }),
        },
        { version: log._version },
      );
      setNotice(
        `${created} registros creados. ${failed} errores. Vuelve a validar antes de reintentar; las claves existentes se omiten.`,
      );
      setHistory(await loadRecords(savia, requirement.object.name));
    } catch (cause) {
      setError(
        `${errorMessage(cause)} Se crearon ${created} registros; revisa el destino y vuelve a validar antes de reintentar.`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="iw-workbench">
      <header className="iw-heading">
        <div>
          <h1>{manifest.label}</h1>
          <p>
            {t("Revisa el archivo antes de importar. Los registros existentes no se sobrescriben ni se fusionan automáticamente.")}</p>
        </div>
      </header>
      {error && (
        <p role="alert" className="iw-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <fieldset disabled={busy} className="iw-tool-fields">
        <label>
          {t("Colección de destino")}<select
            value={object}
            onChange={(e) => {
              setObject(e.target.value);
              setKey("");
              invalidate();
            }}
          >
            <option value="">{t("Selecciona una colección")}</option>
            {objects.map((item) => (
              <option key={item.name} value={item.name}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Campo único de identificación")}<select
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              invalidate();
            }}
          >
            <option value="">{t("Selecciona un campo único")}</option>
            {Object.entries(definition?.config.fields ?? {})
              .filter(
                ([, field]) =>
                  field.config?.unique &&
                  ["Textbox", "Number", "Dropdown"].includes(field.type),
              )
              .map(([name, field]) => (
                <option key={name} value={name}>
                  {field.label ?? name} ({name})
                </option>
              ))}
          </select>
        </label>
        {definition &&
          !Object.values(definition.config.fields).some(
            (f) => f.config?.unique,
          ) && (
            <p>
              {t("Define un campo único en el diseñador para importar con protección contra duplicados.")}</p>
          )}
        <label>
          {t("Archivo CSV")}<input
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              invalidate();
              if (!file) return;
              if (file.size > 2_000_000) {
                setError("El archivo supera 2 MB.");
                return;
              }
              try {
                setSource(await file.text());
              } catch {
                setError("No se pudo leer el archivo.");
              }
            }}
          />
        </label>
        <label>
          {t("Contenido CSV")}<textarea
            rows={7}
            value={source}
            maxLength={2_000_000}
            onChange={(e) => {
              setSource(e.target.value);
              invalidate();
            }}
            placeholder={t("nombre,email&#10;Cliente,cliente@ejemplo.com")}
          />
        </label>
        <p>
          {t("Usa nombres de campo como encabezados. Máximo 1.000 filas; fechas AAAA-MM-DD y punto decimal. Se permiten texto, números, fechas y listas simples.")}</p>
        <button disabled={!object || !key || !source} onClick={preview}>
          {t("Validar y detectar duplicados")}</button>
      </fieldset>
      {busy && <p role="status">{t("Procesando lote…")}</p>}
      {!!duplicates.length && (
        <section>
          <h2>{t("Duplicados existentes")}</h2>
          <p>
            {t("Revisa estos identificadores en la colección antes de decidir qué registro conservar.")}</p>
          <ul>
            {duplicates.map((group, i) => (
              <li key={i}>{group.join(" · ")}</li>
            ))}
          </ul>
        </section>
      )}
      {!!rows.length && (
        <section>
          <h2>{t("Vista previa ·")}{rows.length} {t("filas")}</h2>
          <p>
            {rows.filter((r) => r.status === "ready").length} {t("nuevas ·")}{" "}
            {rows.filter((r) => r.status === "exists").length} {t("existentes ·")}{" "}
            {rows.filter((r) => r.status === "invalid").length} {t("con errores")}</p>
          <div className="iw-table-scroll" tabIndex={0}>
            <table>
              <caption>{t("Revisión del lote")}</caption>
              <thead>
                <tr>
                  <th>{t("Fila")}</th>
                  <th>{t("Clave")}</th>
                  <th>{t("Resultado")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((row) => (
                  <tr key={row.line}>
                    <td data-label="Fila">{row.line}</td>
                    <td data-label="Clave">{String(row.data[key] ?? "")}</td>
                    <td data-label="Resultado">
                      {row.error ??
                        {
                          ready: "Lista para importar",
                          exists: "Se omite: ya existe",
                          invalid: "Revisar",
                        }[row.status]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 100 && (
            <p>
              {t("Se muestran las primeras 100 filas; la validación incluye todo el lote.")}</p>
          )}
          <button
            className="iw-primary"
            disabled={
              busy ||
              !ready ||
              rows.some((r) => r.status === "invalid") ||
              !rows.some((r) => r.status === "ready")
            }
            onClick={execute}
          >
            {t("Importar filas nuevas")}</button>
        </section>
      )}
      <section>
        <h2>{t("Historial de importaciones")}</h2>
        {!history.length ? (
          <p>{t("No hay lotes registrados.")}</p>
        ) : (
          <ul>
            {history
              .slice(-20)
              .reverse()
              .map((row) => (
                <li key={row.id}>
                  {String(row.name)} · {String(row.stage)} ·{" "}
                  {String(row.details ?? "")}
                </li>
              ))}
          </ul>
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
