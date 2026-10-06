import { useState } from "react";
import { Bot, Check, Copy, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMessages } from "@/i18n/core";
import { personalIntegrationsMessages } from "@/i18n/locales/integrations";
import { IntegrationGroup } from "./integration-ui";

export function resolveMcpUrl(explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim().replace(/\/$/, "");
  const base =
    (import.meta.env.VITE_SAVIA_API_URL as string | undefined) ??
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${base.replace(/\/$/, "")}/mcp`;
}

export function AiAssistantsConnect({ mcpUrl }: { mcpUrl?: string }) {
  const t = useMessages(personalIntegrationsMessages);
  const url = resolveMcpUrl(mcpUrl);
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const chatGptSteps = [
    t(
      "Activa el modo Desarrollador en Ajustes → Seguridad e inicio de sesión → Seguridad avanzada.",
    ),
    t(
      "Abre Plugins, pulsa Crear app (+) e introduce el nombre de Savia y la URL de conexión.",
    ),
    t(
      "Elige OAuth, acepta el aviso de servidor personalizado y deja seleccionado el Registro dinámico de cliente (DCR).",
    ),
    t(
      "Pulsa Iniciar sesión con Savia, completa el login y aprueba solo los permisos necesarios.",
    ),
    t(
      "Pulsa Actualizar en el conector y verifica que aparecen acciones como listar colecciones.",
    ),
  ];

  const claudeSteps = [
    t(
      "Abre los ajustes de conectores de Claude y elige Añadir conector personalizado.",
    ),
    t("Pega la misma URL de conexión y elige OAuth."),
    t(
      "Completa el registro dinámico (DCR), inicia sesión en Savia y aprueba los permisos.",
    ),
    t(
      "Vuelve a Claude y pide descubrir datos, por ejemplo: Lista las colecciones a las que tengo acceso.",
    ),
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">{t("ChatGPT y Claude")}</h2>
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          {t(
            "Conecta Savia con ChatGPT y Claude para consultar tus colecciones y pedir tareas a tus empleados virtuales desde esos asistentes.",
          )}
        </p>
      </div>

      <IntegrationGroup
        title={t("URL de conexión (MCP)")}
        headingId="ai-assistants-mcp-url"
      >
        <li className="space-y-3 px-5 py-4">
          <p className="text-sm leading-6 text-muted-foreground">
            {t(
              "Copia esta URL en el conector personalizado de ChatGPT o Claude. Siempre termina en /mcp y usa OAuth, sin pegar secretos internos.",
            )}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              readOnly
              value={url}
              aria-label={t("URL de conexión (MCP)")}
              onFocus={(event) => event.currentTarget.select()}
              className="font-mono"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => void copyUrl()}
              title={t("Copiar URL")}
              className="shrink-0"
            >
              {copied ? (
                <Check aria-hidden="true" className="size-4" />
              ) : (
                <Copy aria-hidden="true" className="size-4" />
              )}
              {copied ? t("URL copiada") : t("Copiar URL")}
            </Button>
          </div>
          {copied ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t("URL copiada")}
            </p>
          ) : null}
        </li>
      </IntegrationGroup>

      <IntegrationGroup
        title={t("¿Qué necesitas antes de empezar?")}
        headingId="ai-assistants-requirements"
      >
        <li className="px-5 py-4">
          <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
            <li>
              {t(
                "Acceso a ChatGPT con modo Desarrollador o a Claude con conectores personalizados habilitados.",
              )}
            </li>
            <li>
              {t(
                "Tu usuario de Savia con acceso a la organización que quieres consultar.",
              )}
            </li>
            <li>
              {t(
                "Conexión HTTPS al entorno desplegado. Los clientes en la nube no pueden alcanzar localhost.",
              )}
            </li>
          </ul>
        </li>
      </IntegrationGroup>

      <div className="grid gap-4 md:grid-cols-2">
        <IntegrationGroup
          title={t("Cómo conectar ChatGPT")}
          headingId="ai-assistants-chatgpt"
        >
          <li className="space-y-3 px-5 py-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Sparkles aria-hidden="true" className="size-4" />
              ChatGPT
            </p>
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-6">
              {chatGptSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </li>
        </IntegrationGroup>

        <IntegrationGroup
          title={t("Cómo conectar Claude")}
          headingId="ai-assistants-claude"
        >
          <li className="space-y-3 px-5 py-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Bot aria-hidden="true" className="size-4" />
              Claude
            </p>
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-6">
              {claudeSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </li>
        </IntegrationGroup>
      </div>

      <IntegrationGroup
        title={t("Permisos que aprobarás")}
        headingId="ai-assistants-scopes"
      >
        <li className="px-5 py-4">
          <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
            <li>{t("Lectura para descubrir y leer colecciones y empleados.")}</li>
            <li>
              {t(
                "Escritura para mutaciones autorizadas y confirmación de acciones pendientes.",
              )}
            </li>
            <li>{t("Acceso sin conexión para renovar tokens (offline_access).")}</li>
          </ul>
        </li>
      </IntegrationGroup>

      <IntegrationGroup title={t("Si algo falla")} headingId="ai-assistants-help">
        <li className="px-5 py-4">
          <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
            <li>
              {t(
                "Si no ves acciones tras conectar, usa Actualizar en el conector y revisa que la URL termine en /mcp.",
              )}
            </li>
            <li>
              {t(
                "Usa siempre el callback exacto que muestra tu cliente. No reutilices callbacks de otra cuenta.",
              )}
            </li>
            <li>
              {t(
                "Localhost o IPs privadas no funcionan con clientes en la nube: usa el entorno desplegado HTTPS.",
              )}
            </li>
          </ul>
        </li>
      </IntegrationGroup>

      <IntegrationGroup
        title={t("Qué puedes hacer después")}
        headingId="ai-assistants-next"
      >
        <li className="px-5 py-4">
          <p className="text-sm leading-6">
            {t(
              "Pide listar colecciones antes de usar un identificador y menciona a un empleado para una tarea.",
            )}
          </p>
        </li>
      </IntegrationGroup>
    </div>
  );
}
