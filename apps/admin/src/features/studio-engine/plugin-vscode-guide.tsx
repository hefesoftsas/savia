import { Code2, Download, ExternalLink, ChevronDown } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/core";
import { vscodeExtensionDownloadPath } from "@/vscode-download";
import { pluginVscodeGuideMessages } from "./plugin-vscode-guide-messages";

/** Installation guidance stays alongside the catalog, without interrupting editing. */
export function PluginVscodeGuide({ tenantId }: { tenantId?: number }) {
  const t = useMessages(pluginVscodeGuideMessages);
  const location = useLocation();
  const expanded =
    new URLSearchParams(location.search).get("help") === "vscode";
  const hasWorkspace = Number.isSafeInteger(tenantId) && (tenantId ?? 0) > 0;
  return (
    <section
      id="vscode-guide"
      aria-labelledby="vscode-guide-title"
      className="savia-surface-card overflow-hidden"
    >
      <header className="flex flex-wrap items-start justify-between gap-4 px-6 py-5">
        <div className="min-w-0 max-w-2xl">
          <h2
            id="vscode-guide-title"
            className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground"
          >
            <Code2 aria-hidden="true" className="size-5 text-primary" />
            {t("title")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t("intro")}
          </p>
        </div>
        <div className="flex max-w-full flex-col items-start gap-2">
          <Button asChild>
            <a href={vscodeExtensionDownloadPath} download>
              <Download aria-hidden="true" />
              {t("download")}
            </a>
          </Button>
          <p className="max-w-xs text-xs leading-5 text-muted-foreground">
            {t("requirements")}
          </p>
        </div>
      </header>
      <details open={expanded || undefined} className="group border-t">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 text-sm font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px] [&::-webkit-details-marker]:hidden">
          {t("steps")}
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 group-open:rotate-180"
          />
        </summary>
        <div className="px-6 pb-6 text-sm leading-6">
          <ol className="max-w-3xl list-decimal space-y-6 ps-5 marker:font-semibold marker:text-primary">
            <li className="ps-2">
              <h3 className="font-semibold">{t("installTitle")}</h3>
              <p className="mt-1 text-muted-foreground">{t("install")}</p>
            </li>
            <li className="ps-2">
              <h3 className="font-semibold">{t("keyTitle")}</h3>
              <p className="mt-1 text-muted-foreground">{t("key")}</p>
              <p className="mt-2 flex flex-wrap gap-2">
                <code className="rounded bg-muted px-2 py-1">plugins:read</code>
                <code className="rounded bg-muted px-2 py-1">
                  plugins:publish
                </code>
              </p>
              <p className="mt-2 text-muted-foreground">{t("keyNote")}</p>
              <Button asChild variant="link" className="mt-1 h-auto px-0">
                <Link to="/account" target="_blank" rel="noopener noreferrer">
                  {t("account")}
                  <ExternalLink aria-hidden="true" />
                </Link>
              </Button>
            </li>
            <li className="ps-2">
              <h3 className="font-semibold">{t("connectTitle")}</h3>
              <p className="mt-1 text-muted-foreground">{t("connect")}</p>
              <dl className="mt-3 space-y-2 rounded-md bg-muted p-3">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <dt className="w-32 shrink-0 text-muted-foreground">
                    {t("server")}
                  </dt>
                  <dd className="min-w-0">
                    <code className="break-all">{window.location.origin}</code>
                  </dd>
                </div>
                {hasWorkspace ? (
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <dt className="w-32 shrink-0 text-muted-foreground">
                      {t("workspace")}
                    </dt>
                    <dd>
                      <code>{tenantId}</code>
                    </dd>
                  </div>
                ) : null}
              </dl>
              {!hasWorkspace && (
                <p className="mt-2 text-muted-foreground">
                  {t("selectWorkspace")}
                </p>
              )}
            </li>
            <li className="ps-2">
              <h3 className="font-semibold">{t("editTitle")}</h3>
              <p className="mt-1 text-muted-foreground">{t("edit")}</p>
              <p className="mt-2 text-muted-foreground">{t("sourceNote")}</p>
            </li>
            <li className="ps-2">
              <h3 className="font-semibold">{t("publishTitle")}</h3>
              <p className="mt-1 text-muted-foreground">{t("publish")}</p>
              <p className="mt-2 font-medium">{t("activation")}</p>
            </li>
          </ol>
          <div className="mt-7 max-w-3xl border-t pt-5">
            <h3 className="font-semibold">{t("recoveryTitle")}</h3>
            <p className="mt-2 text-muted-foreground">{t("history")}</p>
            <p className="mt-2 text-muted-foreground">{t("recovery")}</p>
          </div>
        </div>
      </details>
    </section>
  );
}
