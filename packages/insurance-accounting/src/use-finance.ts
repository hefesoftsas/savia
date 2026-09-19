import { useState, useEffect } from "react";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import {
  loadRecords,
  type WorkRecord,
  errorMessage,
} from "@savia/insurance-workbench/data";
import { defaults, stateSchema, type State } from "./domain";
import { saveState } from "./support";
export function useFinance(savia: PluginApi) {
  const [state, setState] = useState<State>(defaults),
    [version, setVersion] = useState<number | null>(null),
    [records, setRecords] = useState<WorkRecord[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const [stored, rows] = await Promise.all([
        savia.settings.get<State>(),
        loadRecords(savia, "insurance_receivables"),
      ]);
      setState(stateSchema.parse(stored.value));
      setVersion(stored.version);
      setRecords(rows);
    } catch (e) {
      setError(errorMessage(e));
      setVersion(null);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [savia]);
  async function act(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError(
        errorMessage(e) + " Actualiza los datos antes de intentar de nuevo.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save(next: State) {
    if (version === null) throw new Error("Carga los datos antes de guardar.");
    const saved = await saveState(savia, stateSchema.parse(next), version);
    setState(stateSchema.parse(saved.value));
    setVersion(saved.version);
    setNotice("Guardado en el servidor.");
  }
  return {
    state,
    records,
    busy,
    error,
    notice,
    ready: version !== null,
    refresh,
    act,
    save,
  };
}
