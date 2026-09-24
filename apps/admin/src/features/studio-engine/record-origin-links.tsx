import React from "react";
import Hubspot from "@thesvg/react/hubspot";

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
      if (!link || link.provider !== "hubspot" || typeof link.url !== "string")
        return false;
      try {
        const url = new URL(link.url);
        return (
          url.protocol === "https:" &&
          url.hostname === "app.hubspot.com" &&
          !url.port &&
          !url.username &&
          !url.password &&
          /^\/contacts\/\d+\/record\/0-(?:1|2|3|5|7|8|14|27|46|47|48|49)\/\d+$/.test(url.pathname)
        );
      } catch {
        return false;
      }
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
          <Hubspot className="size-4 shrink-0" aria-hidden="true" />
        </a>
      ))}
    </span>
  );
}
