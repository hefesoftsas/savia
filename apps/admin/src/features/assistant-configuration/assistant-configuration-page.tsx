import {
  useRealtimeRefresh,
  RemoteChangesNotice,
} from "@/realtime/use-realtime-refresh";
import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { settingsMessages } from "@/i18n/locales/settings";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  Check,
  CircleAlert,
  CircleDashed,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Bot,
} from "lucide-react";
import type { AppServices } from "@/app-services";
import { ApiClientError } from "@/api/api-client";
import type {
  AssistantConfigurationKeyState,
  AssistantConfigurationSetting,
  AssistantConfigurationSummary,
  AssistantModel,
} from "@/api/assistant-configuration-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CredentialEntry,
  CredentialStatusBadge,
  formatConfiguredDate,
} from "@/features/service-credentials/credential-registry";
import { ModelCapabilityBadges } from "./model-capability-badges";
import { SettingsPanelSkeleton } from "@/components/admin/page-skeletons";

type ConfigurationServices = Pick<AppServices, "assistantConfiguration">;
type ConfigurationTab = "global" | "tenant";

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function tenantName(
  tenantId: number,
  tenants: Array<{ id: number; name: string }>,
  t: ReturnType<typeof useMessages<typeof settingsMessages>>,
): string {
  return (
    tenants.find((tenant) => tenant.id === tenantId)?.name ??
    t("Tenant #%{id}", { id: tenantId })
  );
}

function keyState(
  state: AssistantConfigurationKeyState | undefined,
): keyof typeof settingsMessages {
  switch (state) {
    case "configured":
      return "Configurada";
    case "inherited":
      return "Heredada de global";
    default:
      return "Sin clave";
  }
}

/**
 * THESIS: configuración segura y operativa, no un panel técnico opaco.
 * OWN-WORLD: hereda el panel Savia con una superficie clara, bordes precisos y acento primario.
 * STORY: un administrador identifica el estado, reemplaza una clave y administra excepciones por tenant.
 * FIRST VIEWPORT: título de propósito, estado global y acción de guardar antes de la tabla de excepciones.
 * FORM: campos nativos, tablas de lectura rápida y confirmación solo para volver a heredar.
 */
export function AssistantConfigurationPanel({
  services,
  embedded = false,
  globalOnly = false,
}: {
  services: ConfigurationServices;
  embedded?: boolean;
  globalOnly?: boolean;
}) {
  const t = useMessages(settingsMessages);
  const locale = intlLocale(useAppLocale());
  const client = services.assistantConfiguration;
  const [summary, setSummary] = useState<AssistantConfigurationSummary | null>(
    null,
  );
  const [tenants, setTenants] = useState<Array<{ id: number; name: string }>>(
    [],
  );
  const [models, setModels] = useState<AssistantModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [globalKey, setGlobalKey] = useState("");
  const [showGlobalKey, setShowGlobalKey] = useState(false);
  const [globalModel, setGlobalModel] = useState("");
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [transcriptionModel, setTranscriptionModel] = useState("");
  const [summaryModel, setSummaryModel] = useState("");
  const [savingMeetingModels, setSavingMeetingModels] = useState(false);
  const [meetingModelError, setMeetingModelError] = useState<string | null>(
    null,
  );
  const [meetingModelNotice, setMeetingModelNotice] = useState(false);
  const [confirmGlobalKeyClear, setConfirmGlobalKeyClear] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<
    number | undefined
  >();
  const [tenantKey, setTenantKey] = useState("");
  const [clearTenantKey, setClearTenantKey] = useState(false);
  const [tenantModel, setTenantModel] = useState("");
  const [savingTenant, setSavingTenant] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<ConfigurationTab>("global");

  const selectedOverride = useMemo(
    () =>
      summary?.tenants.find(
        (setting) => setting.tenantId === selectedTenantId,
      ) ?? null,
    [selectedTenantId, summary?.tenants],
  );

  const draftSnapshot = useRef("");
  draftSnapshot.current = JSON.stringify([
    globalKey,
    globalModel,
    transcriptionModel,
    summaryModel,
    tenantKey,
    tenantModel,
    clearTenantKey,
    selectedTenantId,
  ]);
  const load = async () => {
    const snapshot = draftSnapshot.current;
    setLoading(true);
    setError(null);
    setAccessDenied(false);
    try {
      const [nextSummary, activeTenant] = await Promise.all([
        client.summary(),
        globalOnly ? Promise.resolve({ tenants: [] }) : client.activeTenant(),
      ]);
      if (draftSnapshot.current !== snapshot) return;
      setSummary(nextSummary);
      setTenants(activeTenant.tenants);
      setGlobalModel(nextSummary.global?.model ?? "");
      setTranscriptionModel(nextSummary.global?.transcriptionModel ?? "");
      setSummaryModel(nextSummary.global?.summaryModel ?? "");
      if (selectedTenantId !== undefined) {
        setTenantModel(
          nextSummary.tenants.find(
            (setting) => setting.tenantId === selectedTenantId,
          )?.model ?? "",
        );
      }
      const soleAccessibleTenant =
        activeTenant.tenants.length === 1 ? activeTenant.tenants[0] : undefined;
      if (selectedTenantId === undefined && soleAccessibleTenant) {
        const setting = nextSummary.tenants.find(
          (entry) => entry.tenantId === soleAccessibleTenant.id,
        );
        setSelectedTenantId(soleAccessibleTenant.id);
        setTenantModel(setting?.model ?? "");
      } else if (
        selectedTenantId === undefined &&
        nextSummary.tenants[0]?.tenantId !== undefined
      ) {
        setSelectedTenantId(nextSummary.tenants[0].tenantId);
        setTenantModel(nextSummary.tenants[0].model ?? "");
      }
    } catch (exception) {
      if (exception instanceof ApiClientError && exception.status === 403) {
        setAccessDenied(true);
      } else {
        setError(
          failureMessage(
            exception,
            t("No fue posible cargar la configuración."),
          ),
        );
      }
    } finally {
      setLoading(false);
    }
    try {
      setModels(await client.models());
      setCatalogError(null);
    } catch {
      setCatalogError("No se pudo cargar el catálogo de modelos.");
    }
  };

  useEffect(() => {
    void load();
  }, [client]);

  const draftDirty = Boolean(
    globalKey ||
    tenantKey ||
    clearTenantKey ||
    transcriptionModel !== (summary?.global?.transcriptionModel ?? "") ||
    summaryModel !== (summary?.global?.summaryModel ?? "") ||
    globalModel !== (summary?.global?.model ?? "") ||
    tenantModel !== (selectedOverride?.model ?? ""),
  );
  const remoteGlobal = useRealtimeRefresh({
    topics: ["settings"],
    tenantId: 0,
    blocked: draftDirty || savingGlobal || savingTenant || savingMeetingModels,
    refresh: load,
  });
  const remoteTenant = useRealtimeRefresh({
    topics: ["settings"],
    tenantId: selectedTenantId,
    enabled: selectedTenantId !== undefined && selectedTenantId !== 0,
    blocked: draftDirty || savingGlobal || savingTenant || savingMeetingModels,
    refresh: load,
  });

  const selectTenant = (tenantId: number) => {
    const override = summary?.tenants.find(
      (setting) => setting.tenantId === tenantId,
    );
    setSelectedTenantId(tenantId);
    setTenantModel(override?.model ?? "");
    setTenantKey("");
    setClearTenantKey(false);
    setNotice(null);
    setActiveTab("tenant");
  };

  const saveGlobal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isCustomGlobalKeyConfigured && !globalKey.trim()) {
      setError("Debes ingresar una clave de OpenRouter antes de guardar.");
      return;
    }
    setSavingGlobal(true);
    setError(null);
    setNotice(null);
    try {
      const next = await client.saveGlobal({
        ...(globalKey.trim() ? { apiKey: globalKey.trim() } : {}),
        model: globalModel.trim() || null,
      });
      setSummary(next);
      setGlobalKey("");
      setNotice("Configuración global guardada.");
      try {
        setModels(await client.models());
        setCatalogError(null);
      } catch {}
    } catch (exception) {
      setError(
        failureMessage(
          exception,
          t("No fue posible guardar la configuración global."),
        ),
      );
    } finally {
      setSavingGlobal(false);
    }
  };

  const saveMeetingModels = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!summary) return;
    setSavingMeetingModels(true);
    setMeetingModelError(null);
    setMeetingModelNotice(false);
    try {
      const next = await client.saveGlobal({
        transcriptionModel: transcriptionModel.trim() || null,
        summaryModel: summaryModel.trim() || null,
      });
      setSummary(next);
      setTranscriptionModel(next.global?.transcriptionModel ?? "");
      setSummaryModel(next.global?.summaryModel ?? "");
      setMeetingModelNotice(true);
    } catch (exception) {
      setMeetingModelError(
        failureMessage(exception, t("Could not save meeting models.")),
      );
    } finally {
      setSavingMeetingModels(false);
    }
  };

  const clearGlobalKey = async () => {
    setSavingGlobal(true);
    setError(null);
    setNotice(null);
    try {
      const next = await client.saveGlobal({
        clearApiKey: true,
        model: globalModel.trim() || null,
      });
      setSummary(next);
      setGlobalKey("");
      setConfirmGlobalKeyClear(false);
      setNotice("Clave global eliminada.");
    } catch (exception) {
      setError(
        failureMessage(
          exception,
          t("No fue posible eliminar la clave global."),
        ),
      );
    } finally {
      setSavingGlobal(false);
    }
  };

  const saveTenant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedTenantId === undefined) return;
    setSavingTenant(true);
    setError(null);
    setNotice(null);
    try {
      const next = await client.saveTenantOverride(selectedTenantId, {
        ...(clearTenantKey
          ? { clearApiKey: true }
          : tenantKey.trim()
            ? { apiKey: tenantKey.trim() }
            : {}),
        model: tenantModel.trim() || null,
      });
      setSummary(next);
      setTenantKey("");
      setClearTenantKey(false);
      setNotice(
        t("Configuración de %{tenant} guardada.", {
          tenant: tenantName(selectedTenantId, tenants, t),
        }),
      );
    } catch (exception) {
      setError(
        failureMessage(exception, t("No fue posible guardar el override.")),
      );
    } finally {
      setSavingTenant(false);
    }
  };

  const clearOverride = async () => {
    if (!pendingDeletion) return;
    setDeleting(true);
    setError(null);
    try {
      await client.clearTenantOverride(pendingDeletion);
      const next = await client.summary();
      setSummary(next);
      setTenantKey("");
      setClearTenantKey(false);
      setTenantModel("");
      setNotice(
        t("%{tenant} vuelve a heredar la configuración global.", {
          tenant: tenantName(pendingDeletion, tenants, t),
        }),
      );
      setPendingDeletion(null);
    } catch (exception) {
      setError(
        failureMessage(exception, t("No fue posible borrar el override.")),
      );
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    if (embedded) {
      return <SettingsPanelSkeleton className="py-2" />;
    }
    return (
      <main className="mx-auto w-full max-w-6xl py-6">
        <SettingsPanelSkeleton />
      </main>
    );
  }

  if (accessDenied) {
    const denied = (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertDescription>
          {t(
            "Solo administradores de plataforma pueden acceder a esta configuración.",
          )}
        </AlertDescription>
      </Alert>
    );
    if (embedded) return denied;
    return <main className="mx-auto w-full max-w-3xl py-10">{denied}</main>;
  }

  const showTenantConfiguration = !embedded && !globalOnly;
  const globalKeyState = summary?.global?.keyState ?? "not_configured";
  const isCustomGlobalKeyConfigured =
    summary?.global?.keyState === "configured";

  const globalForm = (
    <form className="grid max-w-3xl gap-4" onSubmit={saveGlobal}>
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="assistant-global-key">{t("Clave OpenRouter")}</Label>
          {isCustomGlobalKeyConfigured && summary?.global?.updatedAt ? (
            <span className="text-xs text-muted-foreground">
              {t("Configurada el")}{" "}
              {formatConfiguredDate(summary.global.updatedAt, locale)}
            </span>
          ) : null}
        </div>
        <div className="relative">
          <Input
            id="assistant-global-key"
            type={showGlobalKey ? "text" : "password"}
            autoComplete="new-password"
            value={globalKey}
            onChange={(event) => setGlobalKey(event.target.value)}
            className="pr-10"
            placeholder={
              isCustomGlobalKeyConfigured
                ? t("•••••••••••••••• (dejar en blanco para conservar)")
                : t("Ingresa tu clave de OpenRouter (sk-or-v1-...)")
            }
          />
          <button
            type="button"
            onClick={() => setShowGlobalKey(!showGlobalKey)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={showGlobalKey ? t("Ocultar clave") : t("Mostrar clave")}
          >
            {showGlobalKey ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
        {isCustomGlobalKeyConfigured ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-950 dark:text-emerald-200">
            <span className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              {t("Clave personalizada guardada y cifrada")}
            </span>
            {summary?.global?.updatedAt ? (
              <span className="text-emerald-700 dark:text-emerald-400">
                {t("• Configurada el")}{" "}
                {formatConfiguredDate(summary.global.updatedAt, locale)}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            <CircleAlert className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>{t("Clave obligatoria requerida:")}</strong>{" "}
              {t(
                "Debes ingresar tu clave de OpenRouter para habilitar el asistente de IA.",
              )}
            </span>
          </div>
        )}
      </div>
      <ModelInput
        id="assistant-global-model"
        label={t("Modelo global")}
        value={globalModel}
        onChange={setGlobalModel}
        models={models}
        fallbackModel={
          summary?.deployment?.model || "deepseek/deepseek-v4-flash"
        }
        fallbackLabel={t("Modelo predeterminado")}
      />
      {catalogError ? (
        <p className="text-sm text-muted-foreground">
          {Object.hasOwn(settingsMessages, catalogError)
            ? t(catalogError as keyof typeof settingsMessages)
            : catalogError}
        </p>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>
            {Object.hasOwn(settingsMessages, error)
              ? t(error as keyof typeof settingsMessages)
              : error}
          </AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <p
          className="flex items-center gap-2 text-sm text-primary"
          role="status"
        >
          <CheckCircle2 className="size-4" />{" "}
          {Object.hasOwn(settingsMessages, notice)
            ? t(notice as keyof typeof settingsMessages)
            : notice}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={savingGlobal || savingMeetingModels}>
          {savingGlobal ? <LoaderCircle className="animate-spin" /> : null}
          {t("Guardar")}
        </Button>
        {isCustomGlobalKeyConfigured ? (
          <Button
            type="button"
            variant="outline"
            disabled={savingGlobal || savingMeetingModels}
            onClick={() => setConfirmGlobalKeyClear(true)}
          >
            {t("Eliminar clave")}
          </Button>
        ) : null}
      </div>
    </form>
  );

  const meetingModelsForm = (
    <form className="grid max-w-3xl gap-4" onSubmit={saveMeetingModels}>
      <p className="text-sm text-muted-foreground">
        {t(
          "Uses the configured OpenRouter key. Leave a model blank to use its default.",
        )}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor="meeting-transcription-model">
            {t("Transcription model")}
          </Label>
          <Input
            id="meeting-transcription-model"
            value={transcriptionModel}
            onChange={(event) => {
              setTranscriptionModel(event.target.value);
              setMeetingModelNotice(false);
            }}
            placeholder={
              summary?.deployment?.transcriptionModel ??
              "openai/whisper-large-v3"
            }
            aria-describedby="meeting-transcription-help"
            disabled={savingMeetingModels}
            maxLength={160}
            pattern="[a-zA-Z0-9][a-zA-Z0-9._-]*/[a-zA-Z0-9][a-zA-Z0-9._:-]*"
          />
          <p
            id="meeting-transcription-help"
            className="text-xs text-muted-foreground"
          >
            {t(
              "Use a model compatible with OpenRouter audio transcription (provider/model).",
            )}
          </p>
        </div>
        <div className="grid min-w-0 gap-2">
          <Label htmlFor="meeting-summary-model">{t("Summary model")}</Label>
          <Input
            id="meeting-summary-model"
            value={summaryModel}
            onChange={(event) => {
              setSummaryModel(event.target.value);
              setMeetingModelNotice(false);
            }}
            placeholder={
              summary?.global?.model ??
              summary?.deployment?.summaryModel ??
              summary?.deployment?.model ??
              "deepseek/deepseek-v4-flash"
            }
            aria-describedby="meeting-summary-help"
            disabled={savingMeetingModels}
            maxLength={160}
            pattern="[a-zA-Z0-9][a-zA-Z0-9._-]*/[a-zA-Z0-9][a-zA-Z0-9._:-]*"
          />
          <p
            id="meeting-summary-help"
            className="text-xs text-muted-foreground"
          >
            {t(
              "Use a text model for meeting notes. Default: the effective assistant model.",
            )}
          </p>
        </div>
      </div>
      {meetingModelError ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{meetingModelError}</AlertDescription>
        </Alert>
      ) : null}
      {meetingModelNotice ? (
        <p className="text-sm text-primary" role="status">
          {t("Meeting models saved.")}
        </p>
      ) : null}
      <div>
        <Button
          type="submit"
          disabled={savingMeetingModels || savingGlobal || summary === null}
        >
          {savingMeetingModels ? (
            <LoaderCircle className="animate-spin" />
          ) : null}
          {t("Save models")}
        </Button>
      </div>
    </form>
  );

  const panel = (
    <>
      <RemoteChangesNotice
        changed={remoteGlobal.changed || remoteTenant.changed}
        reload={async () => {
          setGlobalKey("");
          setTenantKey("");
          setClearTenantKey(false);
          await remoteGlobal.reload();
          await remoteTenant.reload();
        }}
      />
      {embedded && globalOnly ? (
        <>
          <CredentialEntry
            title="OpenRouter"
            description={t(
              "AI assistant: platform-wide default key and model.",
            )}
            descriptionAsTooltip
            requirement="required"
            status={
              <CredentialStatusBadge
                configured={globalKeyState === "configured"}
                label={t(keyState(globalKeyState))}
              />
            }
          >
            {globalForm}
          </CredentialEntry>
          <CredentialEntry
            title={t("Meeting recordings")}
            description={t(
              "OpenRouter models for transcription and meeting summaries.",
            )}
            requirement="optional"
          >
            {meetingModelsForm}
          </CredentialEntry>
        </>
      ) : (
        <Tabs
          className="gap-4"
          onValueChange={(value) => setActiveTab(value as ConfigurationTab)}
          value={activeTab}
        >
          <TabsList>
            <TabsTrigger value="global">{t("Global")}</TabsTrigger>
            {showTenantConfiguration ? (
              <TabsTrigger value="tenant">
                {t("Por organización")}
                {(summary?.tenants.length ?? 0) > 0 ? (
                  <Badge className="ml-1.5" variant="outline">
                    {summary?.tenants.length}
                  </Badge>
                ) : null}
              </TabsTrigger>
            ) : null}
          </TabsList>

          <TabsContent value="global">
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
                <div>
                  <CardTitle>{t("Global")}</CardTitle>
                  {isCustomGlobalKeyConfigured && summary?.global?.updatedAt ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("Configurada el")}{" "}
                      {formatConfiguredDate(summary.global.updatedAt, locale)}
                    </p>
                  ) : null}
                </div>
                <Badge
                  variant={
                    globalKeyState === "configured"
                      ? "default"
                      : globalKeyState === "deployment_fallback"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {t(keyState(globalKeyState))}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">{globalForm}</CardContent>
            </Card>
            <section
              className="mt-6 space-y-4"
              aria-labelledby="meeting-models-heading"
            >
              <h2 id="meeting-models-heading" className="text-lg font-semibold">
                {t("Meeting recordings")}
              </h2>
              {meetingModelsForm}
            </section>
          </TabsContent>

          {showTenantConfiguration ? (
            <TabsContent value="tenant">
              {summary?.tenants.length ? (
                <div className="overflow-hidden rounded-xl border bg-card">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead>{t("Organización")}</TableHead>
                        <TableHead>{t("Clave")}</TableHead>
                        <TableHead>{t("Modelo")}</TableHead>
                        <TableHead className="text-right">
                          {t("Acciones")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.tenants.map((setting) => {
                        const tenantId = setting.tenantId!;
                        return (
                          <TableRow key={tenantId}>
                            <TableCell className="font-medium">
                              {tenantName(tenantId, tenants, t)}
                            </TableCell>
                            <TableCell>
                              <div>
                                <span>{t(keyState(setting.keyState))}</span>
                                {setting.keyState === "configured" &&
                                setting.updatedAt ? (
                                  <p className="text-[11px] text-muted-foreground">
                                    {t("Configurada el")}{" "}
                                    {formatConfiguredDate(
                                      setting.updatedAt,
                                      locale,
                                    )}
                                  </p>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell className="max-w-56 truncate text-muted-foreground">
                              {setting.model ?? t("Hereda global")}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => selectTenant(tenantId)}
                                >
                                  {t("Editar")}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setActiveTab("tenant");
                                    setPendingDeletion(tenantId);
                                  }}
                                >
                                  {t("Volver a heredar")}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("Sin overrides.")}
                </p>
              )}

              <form
                className="mt-5 grid max-w-3xl gap-4 rounded-xl border bg-card p-5 sm:p-6"
                onSubmit={saveTenant}
              >
                {tenants.length !== 1 ? (
                  <div className="grid gap-2">
                    <Label htmlFor="assistant-tenant">{t("Tenant")}</Label>
                    <select
                      id="assistant-tenant"
                      className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px]"
                      value={selectedTenantId ?? ""}
                      onChange={(event) =>
                        selectTenant(Number(event.target.value))
                      }
                    >
                      <option value="" disabled>
                        {t("Selecciona una organización")}
                      </option>
                      {tenants.map((tenant) => (
                        <option key={tenant.id} value={tenant.id}>
                          {tenant.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="assistant-tenant-key">
                      {t("Clave de organización")}
                    </Label>
                    {selectedOverride?.keyState === "configured" &&
                    selectedOverride.updatedAt ? (
                      <span className="text-xs text-muted-foreground">
                        {t("Configurada el")}{" "}
                        {formatConfiguredDate(
                          selectedOverride.updatedAt,
                          locale,
                        )}
                      </span>
                    ) : null}
                  </div>
                  <Input
                    id="assistant-tenant-key"
                    type="password"
                    autoComplete="new-password"
                    value={tenantKey}
                    onChange={(event) => setTenantKey(event.target.value)}
                    placeholder={
                      selectedOverride?.keyState === "configured"
                        ? t("•••••••••••••••• (dejar en blanco para conservar)")
                        : t("Hereda global")
                    }
                    disabled={selectedTenantId === undefined || clearTenantKey}
                  />
                  {selectedOverride?.keyState === "configured" ? (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-950 dark:text-emerald-200">
                      <span className="flex items-center gap-1.5 font-medium">
                        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        {t("Clave de organización guardada y cifrada")}
                      </span>
                      {selectedOverride.updatedAt ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          {t("• Configurada el")}{" "}
                          {formatConfiguredDate(
                            selectedOverride.updatedAt,
                            locale,
                          )}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {selectedOverride?.keyState === "configured" ? (
                    <label
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                      htmlFor="assistant-tenant-inherit-key"
                    >
                      <input
                        id="assistant-tenant-inherit-key"
                        type="checkbox"
                        checked={clearTenantKey}
                        onChange={(event) => {
                          setClearTenantKey(event.target.checked);
                          if (event.target.checked) setTenantKey("");
                        }}
                      />
                      {t("Heredar clave global")}
                    </label>
                  ) : null}
                </div>
                <ModelInput
                  id="assistant-tenant-model"
                  label={t("Modelo del tenant")}
                  value={tenantModel}
                  onChange={setTenantModel}
                  models={models}
                  fallbackModel={
                    summary?.global?.model || summary?.deployment?.model
                  }
                  fallbackLabel={
                    summary?.global?.model
                      ? t("Hereda de global")
                      : t("Modelo predeterminado")
                  }
                  disabled={selectedTenantId === undefined}
                />
                <div>
                  <Button
                    type="submit"
                    disabled={selectedTenantId === undefined || savingTenant}
                  >
                    {savingTenant ? (
                      <LoaderCircle className="animate-spin" />
                    ) : null}
                    {t("Guardar")}
                  </Button>
                </div>
              </form>
            </TabsContent>
          ) : null}
        </Tabs>
      )}

      <Dialog
        open={pendingDeletion !== null}
        onOpenChange={(open) => !open && setPendingDeletion(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Volver a heredar")}</DialogTitle>
            <DialogDescription>
              {pendingDeletion
                ? t("%{tenant} vuelve a heredar la configuración global.", {
                    tenant: tenantName(pendingDeletion, tenants, t),
                  })
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingDeletion(null)}
              disabled={deleting}
            >
              {t("Cancelar")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void clearOverride()}
              disabled={deleting}
            >
              {deleting ? <LoaderCircle className="animate-spin" /> : null}
              {t("Confirmar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmGlobalKeyClear}
        onOpenChange={setConfirmGlobalKeyClear}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Eliminar clave global")}</DialogTitle>
            <DialogDescription>
              {t(
                "Se eliminará la clave global guardada. El asistente de IA requerirá que configures una nueva clave para poder operar.",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmGlobalKeyClear(false)}
              disabled={savingGlobal}
            >
              {t("Cancelar")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void clearGlobalKey()}
              disabled={savingGlobal}
            >
              {savingGlobal ? <LoaderCircle className="animate-spin" /> : null}
              {t("Confirmar eliminación")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  if (embedded) return panel;

  return (
    <main className="mx-auto w-full max-w-6xl pb-12">
      <header className="py-6">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Bot className="size-4" /> {t("Administración")}
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {t("Configuración de IA")}
        </h1>
      </header>
      {panel}
    </main>
  );
}

export function AssistantConfigurationPage({
  services,
}: {
  services: ConfigurationServices;
}) {
  return <AssistantConfigurationPanel services={services} />;
}

export function ModelInput({
  id,
  label,
  value,
  onChange,
  models,
  fallbackModel,
  fallbackLabel: configuredFallbackLabel,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  models: AssistantModel[];
  fallbackModel?: string;
  fallbackLabel?: string;
  disabled?: boolean;
}) {
  const t = useMessages(settingsMessages);
  const locale = intlLocale(useAppLocale());
  const fallbackLabel =
    configuredFallbackLabel ?? t("Predeterminado del servidor");
  const [open, setOpen] = useState(false);
  const [activeOptionIndex, setActiveOptionIndex] = useState(-1);
  const listId = `${id}-options`;
  const query = value.trim().toLocaleLowerCase();
  const options = models
    .filter((model) => {
      if (!query) return true;
      return `${model.id} ${model.name}`.toLocaleLowerCase().includes(query);
    })
    .slice(0, 40);
  const isCustom = Boolean(value.trim());
  const effectiveModelId = value.trim() || fallbackModel || "";
  const selected = models.find((model) => model.id === effectiveModelId);
  const choose = (model: AssistantModel) => {
    onChange(model.id);
    setActiveOptionIndex(-1);
    setOpen(false);
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Popover open={open && !disabled} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <Input
            id={id}
            role="combobox"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={
              activeOptionIndex >= 0
                ? `${listId}-${activeOptionIndex}`
                : undefined
            }
            aria-expanded={open && !disabled}
            value={value}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setOpen(false);
                setActiveOptionIndex(-1);
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
                setActiveOptionIndex((index) =>
                  Math.min(index + 1, options.length - 1),
                );
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveOptionIndex((index) => Math.max(index - 1, 0));
                return;
              }
              if (event.key === "Enter" && activeOptionIndex >= 0) {
                event.preventDefault();
                const option = options[activeOptionIndex];
                if (option) choose(option);
              }
            }}
            onChange={(event) => {
              onChange(event.target.value);
              setActiveOptionIndex(-1);
              setOpen(true);
            }}
            placeholder={
              fallbackModel
                ? `${fallbackLabel}: ${fallbackModel}`
                : t("Busca o escribe provider/model")
            }
            disabled={disabled}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-[min(32rem,calc(100vw-2rem))] p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="px-3 py-2 text-xs text-muted-foreground">
            {t(
              "Modelos compatibles con herramientas · precios estimados en USD por 1M tokens",
            )}
          </div>
          <div
            id={listId}
            role="listbox"
            className="max-h-72 overflow-y-auto p-1"
          >
            {options.length ? (
              options.map((model, index) => (
                <button
                  key={model.id}
                  id={`${listId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={selected?.id === model.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(model)}
                  className={`flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent ${
                    activeOptionIndex === index ? "bg-accent" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{model.name}</span>
                      {model.contextLength ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatContextLength(model.contextLength, locale)}{" "}
                          {t("contexto")}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-xs text-muted-foreground font-mono">
                        {model.id}
                      </span>
                      <ModelCapabilityBadges model={model} size="xs" />
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs leading-5 text-muted-foreground">
                    <div>
                      {t("Entrada")}{" "}
                      {formatPricePerMillion(
                        model.inputPricePerMillion,
                        locale,
                        t,
                      )}
                    </div>
                    <div>
                      {t("Salida")}{" "}
                      {formatPricePerMillion(
                        model.outputPricePerMillion,
                        locale,
                        t,
                      )}
                    </div>
                  </div>
                  {selected?.id === model.id ? (
                    <Check className="mt-1 size-4 text-primary" />
                  ) : null}
                </button>
              ))
            ) : (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t(
                  "No hay coincidencias. Puedes guardar el ID que escribiste.",
                )}
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {effectiveModelId ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/70 bg-muted/40 p-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <Cpu className="size-3.5 shrink-0 text-primary" />
              <span>
                {isCustom ? t("Modelo seleccionado") : fallbackLabel}:
              </span>
              <span className="font-semibold text-primary">
                {selected?.name ?? effectiveModelId}
              </span>
            </div>
            {selected?.contextLength ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {formatContextLength(selected.contextLength, locale)}{" "}
                {t("contexto")}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px]">{effectiveModelId}</span>
              <ModelCapabilityBadges model={selected} size="xs" />
            </div>
            {selected ? (
              <span>
                {t("Entrada")}{" "}
                {formatPricePerMillion(
                  selected.inputPricePerMillion,
                  locale,
                  t,
                )}{" "}
                · {t("Salida")}{" "}
                {formatPricePerMillion(
                  selected.outputPricePerMillion,
                  locale,
                  t,
                )}
              </span>
            ) : null}
          </div>
          {!isCustom && fallbackModel ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {t(
                "Este espacio está usando el modelo predeterminado. Si deseas usar otro, selecciónalo arriba y haz clic en Guardar.",
              )}
            </p>
          ) : isCustom && fallbackModel ? (
            <div className="mt-1 flex items-center justify-between border-t border-border/40 pt-1">
              <span className="text-[11px] text-muted-foreground">
                {t("Sobreescribe el modelo predeterminado (%{model})", {
                  model: fallbackModel,
                })}
              </span>
              <button
                type="button"
                className="text-[11px] font-medium text-primary hover:underline"
                onClick={() => onChange("")}
              >
                {t("Volver al predeterminado")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatPricePerMillion(
  price: number | null,
  locale: string,
  t: ReturnType<typeof useMessages<typeof settingsMessages>>,
): string {
  if (price === null) return t("No disponible");
  if (price === 0) return t("Gratis");
  const digits = price >= 10 ? 0 : price >= 1 ? 2 : 3;
  return `${new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(price)} / 1M`;
}

function formatContextLength(tokens: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(tokens);
}
