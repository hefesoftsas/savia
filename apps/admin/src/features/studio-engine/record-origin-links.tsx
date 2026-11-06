import React from "react";
import {
  CrmProviderIcon,
  isStudioCrmProvider,
  type StudioCrmProvider,
} from "./crm-provider";

function safeOrigin(provider: string, value: string): URL | null {
  if (!isStudioCrmProvider(provider)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password)
      return null;
    const allowed = {
      hubspot:
        url.hostname === "app.hubspot.com" &&
        /^\/contacts\/\d+\/record\/0-(?:1|2|3|5|7|8|14|27|46|47|48|49)\/\d+$/.test(
          url.pathname,
        ),
      salesforce:
        /^[a-z0-9-]+(?:\.sandbox)?\.lightning\.force\.com$/.test(
          url.hostname,
        ) &&
        /^\/lightning\/r\/(?:Contact|Account|Opportunity)\/[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?\/view$/.test(
          url.pathname,
        ),
      zoho:
        /^crm\.zoho\.(?:com|eu|in|jp|com\.au|com\.cn|sa|ca)$/.test(
          url.hostname,
        ) &&
        /^\/crm\/org\d+\/tab\/(?:Contacts|Accounts|Deals)\/\d+$/.test(
          url.pathname,
        ),
      pipedrive:
        /^(?:[a-z0-9-]+\.)?pipedrive\.com$/.test(url.hostname) &&
        /^\/(?:person|organization|deal)\/\d+$/.test(url.pathname),
    } satisfies Record<StudioCrmProvider, boolean>;
    return allowed[provider] ? url : null;
  } catch {
    return null;
  }
}

export function RecordOriginLinks({
  record,
  iconOnly = false,
}: {
  record: Record<string, unknown>;
  iconOnly?: boolean;
}) {
  if (!Array.isArray(record._crmLinks)) return null;
  const links = record._crmLinks.filter(
    (link): link is { provider: string; label: string; url: string } => {
      return Boolean(
        link &&
        typeof link.url === "string" &&
        safeOrigin(link.provider, link.url),
      );
    },
  );
  if (!links.length) return null;
  return (
    <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-3">
      {links.map((link) => (
        <a
          key={link.url}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          title={link.label}
          aria-label={link.label}
          className="inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden rounded-sm text-primary transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={(event) => event.stopPropagation()}
        >
          {!iconOnly && <span className="min-w-0 truncate">{link.label}</span>}
          {isStudioCrmProvider(link.provider) ? (
            <CrmProviderIcon
              provider={link.provider}
              className="size-4 shrink-0"
            />
          ) : null}
        </a>
      ))}
    </span>
  );
}
