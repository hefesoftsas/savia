import { usePluginLocale } from "@savia/studio-shared/plugin-locale-react";
import { pluginIntlLocale, localizeExternalError } from "@savia/studio-shared/plugin-localization";
import { useInsuranceMessages } from "../localization";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { PluginApi } from "@savia/studio-shared/plugin-api";

export type InsurancePortfolioScreenProps = {
  savia: PluginApi;
};

type Policy = {
  id: string;
  _version?: number;
  name?: string;
  inicio?: string | null;
  fin?: string | null;
  prima?: number | null;
  estado?: string;
};

type PortfolioSummary = {
  total: number;
  active: number;
  expiring: number;
  premiumTotal: number | null;
};

type PolicyForm = {
  id?: string;
  _version?: number;
  name: string;
  inicio: string;
  fin: string;
  prima: string;
  estado: string;
};

type PolicyInput = {
  name: string;
  inicio: string | null | undefined;
  fin: string | null | undefined;
  prima: number | null | undefined;
  estado: string;
};

const blankForm = (): PolicyForm => ({
  name: "",
  inicio: "",
  fin: "",
  prima: "",
  estado: "Vigente",
});



function asDateInput(value?: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

function asForm(policy: Policy): PolicyForm {
  return {
    id: policy.id,
    _version: policy._version,
    name: policy.name ?? "",
    inicio: asDateInput(policy.inicio),
    fin: asDateInput(policy.fin),
    prima:
      policy.prima === undefined || policy.prima === null
        ? ""
        : String(policy.prima),
    estado: policy.estado || "Vigente",
  };
}

function policyPayload(
  form: PolicyForm,
  emptyValue: null | undefined,
): PolicyInput {
  return {
    name: form.name.trim(),
    inicio: form.inicio || emptyValue,
    fin: form.fin || emptyValue,
    prima: form.prima === "" ? emptyValue : Number(form.prima),
    estado: form.estado,
  };
}

const perPage = 25;

export function InsurancePortfolioPoliciesScreen({
  savia,
}: InsurancePortfolioScreenProps) {
  const t = useInsuranceMessages();
  const locale = usePluginLocale();
  const currency = new Intl.NumberFormat(pluginIntlLocale(locale), {style: "currency", currency: "COP", maximumFractionDigits: 0});
  const number = new Intl.NumberFormat(pluginIntlLocale(locale));
  const date = new Intl.DateTimeFormat(pluginIntlLocale(locale), {dateStyle: "medium"});

  const [records, setRecords] = useState<Policy[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [form, setForm] = useState<PolicyForm | null>(null);
  const [deleting, setDeleting] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const errorInfo = error ? localizeExternalError(error, locale) : null;
  const polizas = useMemo(
    () => savia.collections.collection<Policy, PolicyInput>("polizas"),
    [savia],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [recordsResult, summaryResult] = await Promise.all([
        polizas.list({ page, perPage }),
        savia.services.get<PortfolioSummary>("summary"),
      ]);
      const lastPage = Math.max(1, Math.ceil(recordsResult.total / perPage));
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }
      setRecords(recordsResult.data);
      setTotal(recordsResult.total);
      setSummary(summaryResult);
    } catch (reason) {
      setError(reason);
    } finally {
      setLoading(false);
    }
  }, [page, polizas, savia]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || !form.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      if (form.id) {
        await polizas.update(form.id, policyPayload(form, null), {
          version: form._version,
        });
      } else {
        await polizas.create(policyPayload(form, undefined));
      }
      setForm(null);
      if (page !== 1) setPage(1);
      else await reload();
    } catch (reason) {
      setError(reason);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setSaving(true);
    setError("");
    try {
      await polizas.remove(deleting.id, { version: deleting._version });
      setDeleting(null);
      await reload();
    } catch (reason) {
      setError(reason);
    } finally {
      setSaving(false);
    }
  }

  const metrics = summary
    ? [
        [t("Pólizas"), number.format(summary.total)],
        [t("Vigentes"), number.format(summary.active)],
        [t("Por vencer"), number.format(summary.expiring)],
        [
          t("Prima total"),
          summary.premiumTotal === null
            ? "—"
            : currency.format(summary.premiumTotal),
        ],
      ]
    : [];
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <section
      aria-label={t("Cartera de pólizas")}
      className="extension-policy-screen"
    >
      <header className="extension-policy-heading">
        <div>
          <p className="extension-policy-eyebrow">{t("Extensión de seguros")}</p>
          <h1>{t("Cartera de pólizas")}</h1>
          <p>
             {t("Una vista React propia del plugin para gestionar vigencias y primas.")} </p>
        </div>
        <div className="extension-policy-actions">
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading || saving}
          >
             {t("Actualizar")} </button>
          <button
            type="button"
            className="extension-policy-primary"
            onClick={() => setForm(blankForm())}
            disabled={saving}
          >
             {t("Nueva póliza")} </button>
        </div>
      </header>

      {errorInfo ? (
        <div role="alert" className="extension-policy-error">
          <strong>{t("No pudimos actualizar la cartera.")}</strong>
          <span>{errorInfo.message}</span>
          {errorInfo.detail ? <span>{errorInfo.detail}</span> : null}
        </div>
      ) : null}

      <dl className="extension-policy-metrics" aria-label={t("Resumen de cartera")}>
        {metrics.map(([label, value]) => (
          <div key={String(label)}>
            <dd>{loading ? "…" : value}</dd>
            <dt>{label}</dt>
          </div>
        ))}
      </dl>

      {form ? (
        <form
          className="extension-policy-form"
          onSubmit={(event) => void save(event)}
        >
          <h2>{form.id ? t("Editar póliza") : t("Nueva póliza")}</h2>
          <label>
             {t("Póliza")} <input
              name="name"
              required
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
          </label>
          <label>
             {t("Estado")} <select
              name="estado"
              value={form.estado}
              onChange={(event) =>
                setForm({ ...form, estado: event.target.value })
              }
            >
              <option value="Vigente">{t("Vigente")}</option>
              <option value="Vencida">{t("Vencida")}</option>
              <option value="Cancelada">{t("Cancelada")}</option>
            </select>
          </label>
          <label>
             {t("Inicio")} <input
              name="inicio"
              type="date"
              value={form.inicio}
              onChange={(event) =>
                setForm({ ...form, inicio: event.target.value })
              }
            />
          </label>
          <label>
             {t("Fin")} <input
              name="fin"
              type="date"
              value={form.fin}
              onChange={(event) =>
                setForm({ ...form, fin: event.target.value })
              }
            />
          </label>
          <label>
             {t("Prima")} <input
              name="prima"
              type="number"
              min="0"
              value={form.prima}
              onChange={(event) =>
                setForm({ ...form, prima: event.target.value })
              }
            />
          </label>
          <div className="extension-policy-form-actions">
            <button
              type="button"
              onClick={() => setForm(null)}
              disabled={saving}
            >
               {t("Cancelar")} </button>
            <button
              type="submit"
              className="extension-policy-primary"
              disabled={saving}
            >
              {saving ? t("Guardando…") : t("Guardar póliza")}
            </button>
          </div>
        </form>
      ) : null}

      {deleting ? (
        <section
          aria-label={t("Confirmar eliminación")}
          className="extension-policy-delete"
        >
          <strong>{t("¿Eliminar la póliza")} {deleting.name ?? "sin nombre"}?</strong>
          <span>{t("Esta acción elimina el registro de la cartera.")}</span>
          <div className="extension-policy-actions">
            <button
              type="button"
              onClick={() => setDeleting(null)}
              disabled={saving}
            >
               {t("Cancelar")} </button>
            <button
              type="button"
              className="extension-policy-danger"
              onClick={() => void remove()}
              disabled={saving}
            >
              {saving ? t("Eliminando…") : t("Confirmar eliminación")}
            </button>
          </div>
        </section>
      ) : null}

      <section className="extension-policy-table-card" aria-label={t("Pólizas")}>
        <div className="extension-policy-table-heading">
          <h2>{t("Pólizas")}</h2>
          <span>{loading ? t("Cargando…") : t("%{p0} registradas", {p0: total})}</span>
        </div>
        {loading ? (
          <p role="status">{t("Cargando pólizas…")}</p>
        ) : records.length === 0 ? (
          <p className="extension-policy-empty">
             {t("Aún no hay pólizas. Crea la primera desde esta vista custom.")} </p>
        ) : (
          <div className="extension-policy-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("Póliza")}</th>
                  <th>{t("Estado")}</th>
                  <th>{t("Vence")}</th>
                  <th>{t("Prima")}</th>
                  <th>
                    <span className="sr-only">{t("Acciones")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td>{record.name || "Sin nombre"}</td>
                    <td>
                      <span className="extension-policy-status">
                        {record.estado ? t(record.estado) : "—"}
                      </span>
                    </td>
                    <td>{asDateInput(record.fin) ? date.format(new Date(`${asDateInput(record.fin)}T12:00:00`)) : "—"}</td>
                    <td>
                      {record.prima === undefined || record.prima === null
                        ? "—"
                        : currency.format(record.prima)}
                    </td>
                    <td className="extension-policy-row-actions">
                      <button
                        type="button"
                        onClick={() => setForm(asForm(record))}
                        disabled={saving}
                      >
                         {t("Editar")} </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(record)}
                        disabled={saving}
                      >
                         {t("Eliminar")} </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > perPage ? (
          <div className="extension-policy-pagination" aria-label={t("Paginación")}>
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={loading || saving || page === 1}
            >
               {t("Anterior")} </button>
            <span>
               {t("Página")} {page}  {t("de")} {totalPages}
            </span>
            <button
              type="button"
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
              disabled={loading || saving || page === totalPages}
            >
               {t("Siguiente")} </button>
          </div>
        ) : null}
      </section>
    </section>
  );
}
