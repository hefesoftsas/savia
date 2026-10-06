import { WhatsappChannelSettings } from "./whatsapp-channel-settings";
import { useEffect, useState } from "react";
import type { AppServices } from "@/app-services";
import type { WhatsappAssistantConfiguration } from "@/api/whatsapp-client";
import { Button } from "@/components/ui/button";
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
  }, [services, tenantId]);

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
    <>
      <IntegrationGroup title="Asistente de WhatsApp">
        <li className="space-y-4 px-5 py-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando asistente…</p>
          ) : configuration ? (
            <>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Asistente</span>
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
              </label>
              {configuration.employees.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Crea un empleado virtual en este tenant para asignarlo a
                  WhatsApp.
                </p>
              ) : null}
              <label className="block text-sm">
                <span className="mb-1 block font-medium">
                  Contactos de prueba
                </span>
                <textarea
                  className="min-h-20 w-full rounded-md border bg-background px-3 py-2"
                  value={contacts}
                  onChange={(event) => setContacts(event.target.value)}
                  placeholder="+57 300 1234567"
                  disabled={busy}
                  maxLength={1000}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Solo responderá a estos números. Incluye el código de país y
                escribe un contacto por línea. Cada contacto conserva su propia
                conversación.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                  disabled={
                    busy ||
                    (!enabled && (!connected || !configuration.webhookReady))
                  }
                />
                Responder con IA
              </label>
              {!configuration.webhookReady ? (
                <p className="text-sm text-muted-foreground">
                  Recepción de WhatsApp pendiente de configurar.
                </p>
              ) : null}
              <Button
                size="sm"
                onClick={() => void save()}
                disabled={busy || !employeeId}
              >
                {busy ? "Guardando…" : "Guardar asistente"}
              </Button>
            </>
          ) : null}
          {feedback ? (
            <p role="status" className="text-sm">
              {feedback}
            </p>
          ) : null}
        </li>
      </IntegrationGroup>
      {typeof services.whatsapp.getChannel === "function" ? (
        <WhatsappChannelSettings
          whatsapp={services.whatsapp}
          tenantId={tenantId}
        />
      ) : null}
    </>
  );
}
