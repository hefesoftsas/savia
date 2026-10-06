import { useEffect, useState } from "react";
import type {
  WhatsappClient,
  WhatsappChannelConfiguration,
  WhatsappChannelState,
} from "@/api/whatsapp-client";
import { Button } from "@/components/ui/button";
import { IntegrationGroup } from "@/features/personal-integrations/integration-ui";

const empty: WhatsappChannelConfiguration = {
  routingEnabled: false,
  tasks: [],
  staff: [],
  internalCapabilities: ["*"],
  externalCapabilities: ["insurance"],
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
          setConfig(value.configuration ?? { ...empty, tasks: [], staff: [] });
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
        "No se pudo guardar. Revisa las tareas, los números y las cuentas vinculadas. Si hay un mensaje en curso, espera a que termine.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <IntegrationGroup title="Menú de tareas de WhatsApp">
      <li className="space-y-4 px-5 py-4">
        <p className="text-sm text-muted-foreground">
          El contacto elige qué desea hacer. Escribe menú o inicio para cambiar
          de tarea en cualquier momento.
        </p>
        {state ? (
          <fieldset disabled={busy} className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.routingEnabled}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, routingEnabled: e.target.checked }))
                }
              />
              Activar menú de tareas
            </label>
            {config.tasks.map((t, index) => (
              <div key={t.id} className="space-y-2 rounded-md border p-3">
                <label className="block text-sm">
                  Empleado virtual
                  <select
                    aria-label={`Empleado de tarea ${index + 1}`}
                    className="block w-full rounded border bg-background p-2"
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
                  Tarea que verá el contacto
                  <input
                    className="block w-full rounded border bg-background p-2"
                    maxLength={24}
                    placeholder="Consultar seguros"
                    value={t.title}
                    onChange={(e) => task(index, { title: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  Descripción
                  <input
                    className="block w-full rounded border bg-background p-2"
                    maxLength={72}
                    value={t.description}
                    onChange={(e) =>
                      task(index, { description: e.target.value })
                    }
                  />
                </label>
                <label className="block text-sm">
                  Disponible para
                  <select
                    className="block w-full rounded border bg-background p-2"
                    value={t.audiences.length === 2 ? "both" : t.audiences[0]}
                    onChange={(e) =>
                      task(index, {
                        audiences:
                          e.target.value === "both"
                            ? ["internal", "external"]
                            : [e.target.value as "internal" | "external"],
                      })
                    }
                  >
                    <option value="both">Personal y contactos externos</option>
                    <option value="internal">Solo personal interno</option>
                    <option value="external">Solo contactos externos</option>
                  </select>
                </label>
                <Button
                  type="button"
                  variant="outline"
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
            ))}
            <Button
              type="button"
              variant="outline"
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
            <h3 className="font-medium">Números del personal interno</h3>
            <p className="text-sm text-muted-foreground">
              Este registro identifica al personal. Los contactos de prueba del
              asistente controlan quién puede conversar. Vincula una cuenta de
              Savia para usar sus permisos.
            </p>
            {config.staff.map((s, index) => (
              <div key={index} className="space-y-2 rounded-md border p-3">
                <label className="block text-sm">
                  Nombre
                  <input
                    className="block w-full rounded border bg-background p-2"
                    maxLength={120}
                    value={s.label}
                    onChange={(e) => staff(index, { label: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  Número con código de país
                  <input
                    className="block w-full rounded border bg-background p-2"
                    value={s.phone}
                    onChange={(e) => staff(index, { phone: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  Cuenta de Savia
                  <select
                    className="block w-full rounded border bg-background p-2"
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
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={s.active}
                    onChange={(e) => staff(index, { active: e.target.checked })}
                  />
                  Registro activo
                </label>
                <Button
                  type="button"
                  variant="outline"
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
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setConfig((c) => ({
                  ...c,
                  staff: [
                    ...c.staff,
                    { phone: "", label: "", active: true, principalId: null },
                  ],
                }))
              }
            >
              Añadir personal
            </Button>
            <Button type="button" onClick={() => void save()}>
              {busy ? "Guardando…" : "Guardar menú y personal"}
            </Button>
          </fieldset>
        ) : !feedback ? (
          <p className="text-sm">Cargando menú…</p>
        ) : null}
        {feedback ? (
          <p role="status" className="text-sm">
            {feedback}
          </p>
        ) : null}
      </li>
    </IntegrationGroup>
  );
}
