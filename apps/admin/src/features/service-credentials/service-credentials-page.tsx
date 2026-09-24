import { KeyRound } from "lucide-react";
import { useTranslate } from "ra-core";
import type { AppServices } from "@/app-services";
import { AssistantConfigurationPanel } from "@/features/assistant-configuration/assistant-configuration-page";
import { StudioDomainCredentialsSection } from "./studio-domain-credentials-section";
import { CredentialsHelpTooltip } from "./credential-registry";
import "./service-credentials.css";

export function ServiceCredentialsPage({
  services,
}: {
  services: AppServices;
}) {
  const translate = useTranslate();
  return (
    <main className="mx-auto w-full max-w-6xl pb-12">
      <header className="py-6">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <KeyRound className="size-4" aria-hidden="true" />{" "}
          {translate("savia.serviceCredentials.category", {
            _: "Administración",
          })}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            {translate("savia.serviceCredentials.title", {
              _: "Claves y servicios",
            })}
          </h1>
          <CredentialsHelpTooltip
            description={translate("savia.serviceCredentials.description", {
              _: "Administra las credenciales del espacio. Se cifran en el servidor y no se devuelven al navegador.",
            })}
          />
        </div>
      </header>

      <StudioDomainCredentialsSection
        services={services}
        globalCredentials={
          <AssistantConfigurationPanel
            services={services}
            embedded
            globalOnly
          />
        }
      />
    </main>
  );
}
