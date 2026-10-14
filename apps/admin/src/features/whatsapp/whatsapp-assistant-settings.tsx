import { useEffect, useState } from "react";
import type { AppServices } from "@/app-services";
import type { WhatsappAssistantConfiguration } from "@/api/whatsapp-client";
import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { IntegrationGroup } from "@/features/personal-integrations/integration-ui";

export function WhatsappAssistantSettings({
  services,
  tenantId,
  connected,
}: {
  services: Pick<AppServices, "whatsapp">;
  tenantId: number;
  connected: boolean;
}) {
  const [configuration, setConfiguration] =
    useState<WhatsappAssistantConfiguration | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [contacts, setContacts] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    void services.whatsapp
      .getAssistant(tenantId)
      .then((value) => {
        if (!current) return;
        setConfiguration(value);
        setEmployeeId(value.settings?.employeeId ?? "");
        setEnabled(value.settings?.enabled ?? false);
        setContacts(
          value.settings?.allowedContacts
            .map((number) => `+${number}`)
            .join("\n") ?? "",
        );
      })
      .catch(() => {
        if (current)
          setFeedback(
            "La configuración del asistente requiere acceso administrador al tenant.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [services.whatsapp, tenantId]);

  async function save() {
    if (!employeeId || busy || !configuration) return;
    const allowedContacts = contacts
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (enabled && allowedContacts.length === 0) {
      setFeedback("Añade al menos un contacto de prueba.");
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await services.whatsapp.updateAssistant({
        agencyId: tenantId,
        employeeId,
        enabled,
        allowedContacts,
      });
      setFeedback(
        enabled
          ? "Asistente activado para los contactos de prueba."
          : "Las respuestas automáticas quedaron desactivadas.",
      );
    } catch {
      setFeedback(
        "No se pudo guardar. Revisa el asistente y los números con código de país.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <IntegrationGroup
      title="Asistente de WhatsApp"
      help="Elige qué empleado virtual responde. Cada contacto conserva su propia conversación."
    >
      <li className="space-y-5 px-5 py-5 sm:px-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando asistente…</p>
        ) : configuration ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Asistente</span>
                <select
                  className="h-9 w-full rounded-md border bg-background px-3"
                  value={employeeId}
                  onChange={(event) => setEmployeeId(event.target.value)}
                  disabled={busy}
                >
                  <option value="">Selecciona un empleado virtual</option>
                  {configuration.employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
                </select>
                {configuration.employees.length === 0 ? (
                  <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">
                    Crea un empleado virtual en este tenant para asignarlo a
                    WhatsApp.
                  </span>
                ) : null}
              </label>
              <div className="flex items-end">
                <label className="flex w-full items-center gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
                  <input
                    type="checkbox"
                    aria-label="Responder con IA"
                    className="size-4 shrink-0"
                    checked={enabled}
                    onChange={(event) => setEnabled(event.target.checked)}
                    disabled={
                      busy ||
                      (!enabled && (!connected || !configuration.webhookReady))
                    }
                  />
                  <span>
                    <span className="block font-medium">Responder con IA</span>
                    <span className="block text-xs text-muted-foreground">
                      Solo responde a los contactos de prueba.
                    </span>
                  </span>
                </label>
              </div>
            </div>
            <div className="block text-sm">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="whatsapp-test-contacts" className="font-medium">
                  Contactos de prueba
                </label>
                <HelpTooltip label="Ayuda: Contactos de prueba">
                  Incluye el código de país y escribe un contacto por línea.
                  Cada contacto conserva su propia conversación.
                </HelpTooltip>
              </div>
              <textarea
                id="whatsapp-test-contacts"
                aria-label="Contactos de prueba"
                className="min-h-20 w-full rounded-md border bg-background px-3 py-2"
                value={contacts}
                onChange={(event) => setContacts(event.target.value)}
                placeholder="+57 300 1234567"
                disabled={busy}
                maxLength={1000}
              />
            </div>
            {!configuration.webhookReady ? (
              <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                Recepción de WhatsApp pendiente de configurar.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                onClick={() => void save()}
                disabled={busy || !employeeId}
              >
                {busy ? "Guardando…" : "Guardar asistente"}
              </Button>
              {feedback ? (
                <p role="status" className="text-sm text-muted-foreground">
                  {feedback}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
        {!configuration && !loading && feedback ? (
          <p role="status" className="text-sm">
            {feedback}
          </p>
        ) : null}
      </li>
    </IntegrationGroup>
  );
}
