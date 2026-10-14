import { useEffect, useState } from "react";
import type {
  WhatsappClient,
  WhatsappChannelConfiguration,
  WhatsappChannelState,
} from "@/api/whatsapp-client";
import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { IntegrationGroup } from "@/features/personal-integrations/integration-ui";

const empty: WhatsappChannelConfiguration = {
  routingEnabled: false,
  tasks: [],
  staff: [],
  internalCapabilities: ["*"],
  externalCapabilities: ["insurance"],
  humanSupportContact: "",
};
export function WhatsappChannelSettings({
  whatsapp,
  tenantId,
}: {
  whatsapp: Pick<WhatsappClient, "getChannel" | "updateChannel">;
  tenantId: number;
}) {
  const [state, setState] = useState<WhatsappChannelState | null>(null);
  const [config, setConfig] = useState<WhatsappChannelConfiguration>(empty);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void whatsapp
      .getChannel(tenantId)
      .then((value) => {
        if (current) {
          setState(value);
          setConfig({
            ...empty,
            ...value.configuration,
            tasks: value.configuration?.tasks ?? [],
            staff: value.configuration?.staff ?? [],
            humanSupportContact: value.configuration?.humanSupportContact ?? "",
          });
        }
      })
      .catch(() => {
        if (current) setFeedback("No se pudo cargar el menú de WhatsApp.");
      });
    return () => {
      current = false;
    };
  }, [whatsapp, tenantId]);
  const task = (
    index: number,
    patch: Partial<WhatsappChannelConfiguration["tasks"][number]>,
  ) =>
    setConfig((c) => ({
      ...c,
      tasks: c.tasks.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    }));
  const staff = (
    index: number,
    patch: Partial<WhatsappChannelConfiguration["staff"][number]>,
  ) =>
    setConfig((c) => ({
      ...c,
      staff: c.staff.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    }));
  async function save() {
    setBusy(true);
    setFeedback(null);
    try {
      const saved = await whatsapp.updateChannel(tenantId, config);
      setConfig(saved);
      setFeedback("Menú y personal guardados.");
    } catch {
      setFeedback(
        "No se pudo guardar. Revisa las tareas, los números, las cuentas vinculadas y el contacto de atención humana (teléfono o enlace HTTPS). Si hay un mensaje en curso, espera a que termine.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <IntegrationGroup
      title="Menú de tareas de WhatsApp"
      help="El contacto elige qué desea hacer. Puede escribir menú o inicio para cambiar de tarea en cualquier momento."
    >
      <li className="space-y-6 px-5 py-5 sm:px-6">
        {state ? (
          <fieldset disabled={busy} className="space-y-6">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Comportamiento</h3>
              <div className="flex items-center gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  id="whatsapp-routing-enabled"
                  aria-label="Activar menú de tareas"
                  className="size-4 shrink-0"
                  checked={config.routingEnabled}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      routingEnabled: e.target.checked,
                    }))
                  }
                />
                <span>
                  <span className="flex items-center gap-1 font-medium">
                    <label htmlFor="whatsapp-routing-enabled">
                      Activar menú de tareas
                    </label>
                    <HelpTooltip label="Ayuda sobre el menú de tareas">
                      Muestra las tareas disponibles al iniciar la conversación.
                    </HelpTooltip>
                  </span>
                </span>
              </div>
              <div className="block text-sm">
                <div className="mb-1.5 flex items-center gap-1 font-medium">
                  <label htmlFor="whatsapp-human-support-contact">
                    Contacto de atención humana (opcional)
                  </label>
                  <HelpTooltip label="Ayuda sobre el contacto de atención humana">
                    Indica un teléfono o enlace HTTPS. Se muestra cuando el
                    asistente no puede continuar y no inicia una transferencia
                    automática.
                  </HelpTooltip>
                </div>
                <input
                  id="whatsapp-human-support-contact"
                  className="block w-full max-w-xl rounded-md border bg-background p-2"
                  maxLength={240}
                  placeholder="+57 300 1234567 o https://…"
                  value={config.humanSupportContact ?? ""}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      humanSupportContact: e.target.value,
                    }))
                  }
                />
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  Tareas del menú ({config.tasks.length})
                </h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setConfig((c) => ({
                      ...c,
                      tasks: [
                        ...c.tasks,
                        {
                          id: crypto.randomUUID(),
                          employeeId: "",
                          title: "",
                          description: "",
                          order: c.tasks.length,
                          audiences: ["internal", "external"],
                        },
                      ],
                    }))
                  }
                >
                  Añadir tarea
                </Button>
              </div>
              {config.tasks.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                  Sin tareas. Añade la primera para mostrar el menú al contacto.
                </p>
              ) : null}
              {config.tasks.map((t, index) => (
                <div
                  key={t.id}
                  className="space-y-3 rounded-xl border bg-muted/20 p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Tarea {index + 1}</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setConfig((c) => ({
                          ...c,
                          tasks: c.tasks.filter((x) => x.id !== t.id),
                        }))
                      }
                    >
                      Quitar tarea
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium">
                        Empleado virtual
                      </span>
                      <select
                        aria-label={`Empleado de tarea ${index + 1}`}
                        className="block w-full rounded-md border bg-background p-2"
                        value={t.employeeId}
                        onChange={(e) =>
                          task(index, { employeeId: e.target.value })
                        }
                      >
                        <option value="">Selecciona un empleado</option>
                        {state.employees.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium">
                        Disponible para
                      </span>
                      <select
                        className="block w-full rounded-md border bg-background p-2"
                        value={
                          t.audiences.length === 2 ? "both" : t.audiences[0]
                        }
                        onChange={(e) =>
                          task(index, {
                            audiences:
                              e.target.value === "both"
                                ? ["internal", "external"]
                                : [e.target.value as "internal" | "external"],
                          })
                        }
                      >
                        <option value="both">
                          Personal y contactos externos
                        </option>
                        <option value="internal">Solo personal interno</option>
                        <option value="external">
                          Solo contactos externos
                        </option>
                      </select>
                    </label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium">
                        Tarea que verá el contacto
                      </span>
                      <input
                        className="block w-full rounded-md border bg-background p-2"
                        maxLength={24}
                        placeholder="Consultar seguros"
                        value={t.title}
                        onChange={(e) => task(index, { title: e.target.value })}
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium">
                        Descripción
                      </span>
                      <input
                        className="block w-full rounded-md border bg-background p-2"
                        maxLength={72}
                        placeholder="Qué resuelve esta tarea"
                        value={t.description}
                        onChange={(e) =>
                          task(index, { description: e.target.value })
                        }
                      />
                    </label>
                  </div>
                </div>
              ))}
            </section>

            <section className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-center gap-1">
                  <h3 className="text-sm font-semibold">
                    Números del personal interno ({config.staff.length})
                  </h3>
                  <HelpTooltip label="Ayuda sobre números del personal">
                    Este registro identifica al personal. Los contactos de
                    prueba del asistente controlan quién puede conversar.
                    Vincula una cuenta de Savia para usar sus permisos.
                  </HelpTooltip>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setConfig((c) => ({
                      ...c,
                      staff: [
                        ...c.staff,
                        {
                          phone: "",
                          label: "",
                          active: true,
                          principalId: null,
                        },
                      ],
                    }))
                  }
                >
                  Añadir personal
                </Button>
              </div>
              {config.staff.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                  Sin personal registrado. Añade los números internos que podrán
                  usar el menú.
                </p>
              ) : null}
              {config.staff.map((s, index) => (
                <div
                  key={index}
                  className="space-y-3 rounded-xl border bg-muted/20 p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {s.label || `Miembro ${index + 1}`}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setConfig((c) => ({
                          ...c,
                          staff: c.staff.filter((_, i) => i !== index),
                        }))
                      }
                    >
                      Quitar número
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium">Nombre</span>
                      <input
                        className="block w-full rounded-md border bg-background p-2"
                        maxLength={120}
                        placeholder="Nombre del miembro"
                        value={s.label}
                        onChange={(e) =>
                          staff(index, { label: e.target.value })
                        }
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium">
                        Número con código de país
                      </span>
                      <input
                        className="block w-full rounded-md border bg-background p-2"
                        placeholder="+57 300 1234567"
                        value={s.phone}
                        onChange={(e) =>
                          staff(index, { phone: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium">
                        Cuenta de Savia
                      </span>
                      <select
                        className="block w-full rounded-md border bg-background p-2"
                        value={s.principalId ?? ""}
                        onChange={(e) =>
                          staff(index, { principalId: e.target.value || null })
                        }
                      >
                        <option value="">Sin cuenta vinculada</option>
                        {state.members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 self-end pb-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={s.active}
                        onChange={(e) =>
                          staff(index, { active: e.target.checked })
                        }
                      />
                      Registro activo
                    </label>
                  </div>
                </div>
              ))}
            </section>

            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <Button type="button" onClick={() => void save()}>
                {busy ? "Guardando…" : "Guardar menú y personal"}
              </Button>
              {feedback ? (
                <p role="status" className="text-sm text-muted-foreground">
                  {feedback}
                </p>
              ) : null}
            </div>
          </fieldset>
        ) : !feedback ? (
          <p className="text-sm">Cargando menú…</p>
        ) : null}
        {!state && feedback ? (
          <p role="status" className="text-sm">
            {feedback}
          </p>
        ) : null}
      </li>
    </IntegrationGroup>
  );
}
