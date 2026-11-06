import Hubspot from "@thesvg/react/hubspot";
import Pipedrive from "@thesvg/react/pipedrive";
import Salesforce from "@thesvg/react/salesforce";
import Zoho from "@thesvg/react/zoho";
import type { ComponentType, SVGProps } from "react";

export type StudioCrmProvider = "hubspot" | "salesforce" | "zoho" | "pipedrive";

const labels: Record<StudioCrmProvider, string> = {
  hubspot: "HubSpot",
  salesforce: "Salesforce",
  zoho: "Zoho CRM",
  pipedrive: "Pipedrive",
};

const icons: Record<
  StudioCrmProvider,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  hubspot: Hubspot,
  salesforce: Salesforce,
  zoho: Zoho,
  pipedrive: Pipedrive,
};

export function crmProviderLabel(provider: string): string {
  return isStudioCrmProvider(provider)
    ? labels[provider]
    : provider || "HubSpot";
}

export function CrmProviderIcon({
  provider,
  className,
}: {
  provider: StudioCrmProvider;
  className?: string;
}) {
  const Icon = icons[provider];
  return <Icon className={className} aria-hidden="true" />;
}

export function isStudioCrmProvider(value: string): value is StudioCrmProvider {
  return Object.hasOwn(labels, value);
}

export function isHubspotArchive(sourceId?: string, kind?: string): boolean {
  return kind === "crm" && sourceId === "hubspot";
}
