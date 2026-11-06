import { useRealtimeRefresh } from "@/realtime/use-realtime-refresh";
import { matchTenantApiBasePath } from "@/features/studio/studio-navigation";
import { Component, useEffect, useMemo, useState } from "react";
import type { ApiClient } from "@/api/api-client";
import { useAppLocale, useMessages } from "@/i18n/core";
import type { MyDayWidget } from "@savia/studio-shared/my-day-widgets";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  isPluginWidgetEnabled,
  listWidgetExtensions,
  parsePluginKind,
  pluginApiFor,
  pluginContributionFor,
  storeWidgetDeclarationFor,
  storeWidgetFor,
  type ExtensionInstallation,
} from "./plugins";
import { CustomPluginFrame } from "../studio-engine/custom-plugin-frame";
import { widgetMessages } from "./widget-messages";

function PluginWidgetSkeleton() {
  const t = useMessages(widgetMessages);
  return (
    <div role="status" aria-label={t("Loading widget…")} className="space-y-2">
      <span className="sr-only">{t("Loading widget…")}</span>
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

class WidgetErrorBoundary extends Component<
  {
    children: React.ReactNode;
    title: string;
    translate: ReturnType<typeof useMessages<typeof widgetMessages>>;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {this.props.translate("This widget could not be displayed.")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => this.setState({ failed: false })}
            aria-label={this.props.translate("Retry widget %{title}", {
              title: this.props.title,
            })}
          >
            {this.props.translate("Retry")}
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function PluginWidgetBody({
  apiClient,
  widget,
}: {
  apiClient: ApiClient | undefined;
  widget: Extract<MyDayWidget, { apiBasePath: string; collection: string }>;
}) {
  const locale = useAppLocale();
  const t = useMessages(widgetMessages);
  const [extensions, setExtensions] = useState<
    ExtensionInstallation[] | undefined
  >(undefined);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const tenantId = matchTenantApiBasePath(widget.apiBasePath);
  useRealtimeRefresh({
    topics: ["studio"],
    tenantId: Number(tenantId),
    enabled: tenantId !== undefined,
    refresh: () => setRevision((value) => value + 1),
  });

  const ref = useMemo(() => parsePluginKind(widget.kind), [widget.kind]);
  const contribution = ref ? pluginContributionFor(ref) : undefined;
  // Lo subido al store prevalece sobre lo compilado (sombra por tenant).
  const storeWidget = ref ? storeWidgetFor(ref, extensions) : undefined;
  const storeDeclared = ref
    ? storeWidgetDeclarationFor(ref, extensions)
    : undefined;

  useEffect(() => {
    if (!apiClient || !ref) return;
    let active = true;
    setFailed(false);
    void listWidgetExtensions(apiClient, widget.apiBasePath).then(
      (result) => {
        if (active) setExtensions(result);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [apiClient, ref, widget.apiBasePath, revision]);

  const savia = useMemo(
    () =>
      apiClient && ref
        ? pluginApiFor(ref.extensionId, apiClient, widget.apiBasePath)
        : undefined,
    [apiClient, ref, widget.apiBasePath],
  );

  if (!apiClient) return <PluginWidgetSkeleton />;
  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("Could not verify this widget extension. Try refreshing.")}
      </p>
    );
  }
  if (storeWidget) {
    return (
      <CustomPluginFrame
        pluginId={storeWidget.extensionId}
        installationVersion={
          extensions?.find(
            (entry) => entry.manifest.id === storeWidget.extensionId,
          )?.installed?.version
        }
        title={storeWidget.title[locale] ?? storeWidget.title.es}
        src={`${widget.apiBasePath}/api/plugin-store/${encodeURIComponent(storeWidget.extensionId)}/widget?widget=${encodeURIComponent(storeWidget.id)}&collection=${encodeURIComponent(storeWidget.collection)}`}
        heightClassName="h-[320px]"
      />
    );
  }
  if (storeDeclared) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("Enable the %{extension} extension to see this widget.", {
          extension: storeDeclared.title[locale] ?? storeDeclared.title.es,
        })}
      </p>
    );
  }
  if (!ref || !contribution) {
    if (extensions === undefined) return <PluginWidgetSkeleton />;
    return (
      <p className="text-sm text-muted-foreground">
        {t(
          "This widget type will be available soon. In the meantime, open the full collection.",
        )}
      </p>
    );
  }
  if (extensions === undefined || !savia) return <PluginWidgetSkeleton />;
  const enabled = isPluginWidgetEnabled(contribution, extensions);
  if (!enabled) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("Enable the %{extension} extension to see this widget.", {
          extension: contribution.title[locale] ?? contribution.title.es,
        })}
      </p>
    );
  }

  const Widget = contribution.Widget;
  return (
    <WidgetErrorBoundary
      title={contribution.title[locale] ?? contribution.title.es}
      translate={t}
    >
      <Widget savia={savia} widget={widget} />
    </WidgetErrorBoundary>
  );
}
