import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { settingsMessages } from "@/i18n/locales/settings";
import { useEffect, useMemo, useState, type FormEvent } from "react";
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
type ConfigurationTab = "global" | "agency";

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function agencyName(
  agencyId: number,
  agencies: Array<{ id: number; name: string }>,
  t: ReturnType<typeof useMessages<typeof settingsMessages>>,
): string {
  return (
    agencies.find((agency) => agency.id === agencyId)?.name ??
    t("Organización #%{id}", { id: agencyId })
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
 * STORY: un administrador identifica el estado, reemplaza una clave y administra excepciones por agencia.
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
  const [agencies, setAgencies] = useState<Array<{ id: number; name: string }>>(
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
  const [confirmGlobalKeyClear, setConfirmGlobalKeyClear] = useState(false);
  const [selectedAgencyId, setSelectedAgencyId] = useState<
    number | undefined
  >();
  const [agencyKey, setAgencyKey] = useState("");
  const [clearAgencyKey, setClearAgencyKey] = useState(false);
  const [agencyModel, setAgencyModel] = useState("");
  const [savingAgency, setSavingAgency] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<ConfigurationTab>("global");

  const selectedOverride = useMemo(
    () =>
      summary?.agencies.find(
        (setting) => setting.agencyId === selectedAgencyId,
      ) ?? null,
    [selectedAgencyId, summary?.agencies],
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    setAccessDenied(false);
    try {
      const [nextSummary, activeAgency] = await Promise.all([
        client.summary(),
        client.activeAgency(),
      ]);
      setSummary(nextSummary);
      setAgencies(activeAgency.agencies);
      setGlobalModel(nextSummary.global?.model ?? "");
      if (selectedAgencyId === undefined && nextSummary.agencies[0]?.agencyId) {
        setSelectedAgencyId(nextSummary.agencies[0].agencyId);
        setAgencyModel(nextSummary.agencies[0].model ?? "");
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

  const selectAgency = (agencyId: number) => {
    const override = summary?.agencies.find(
      (setting) => setting.agencyId === agencyId,
    );
    setSelectedAgencyId(agencyId);
    setAgencyModel(override?.model ?? "");
    setAgencyKey("");
    setClearAgencyKey(false);
    setNotice(null);
    setActiveTab("agency");
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

  const saveAgency = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedAgencyId) return;
    setSavingAgency(true);
    setError(null);
    setNotice(null);
    try {
      const next = await client.saveAgencyOverride(selectedAgencyId, {
        ...(clearAgencyKey
          ? { clearApiKey: true }
          : agencyKey.trim()
            ? { apiKey: agencyKey.trim() }
            : {}),
        model: agencyModel.trim() || null,
      });
      setSummary(next);
      setAgencyKey("");
      setClearAgencyKey(false);
      setNotice(
        t("Configuración de %{agency} guardada.", {
          agency: agencyName(selectedAgencyId, agencies, t),
        }),
      );
    } catch (exception) {
      setError(
        failureMessage(exception, t("No fue posible guardar el override.")),
      );
    } finally {
      setSavingAgency(false);
    }
  };

  const clearOverride = async () => {
    if (!pendingDeletion) return;
    setDeleting(true);
    setError(null);
    try {
      await client.clearAgencyOverride(pendingDeletion);
      const next = await client.summary();
      setSummary(next);
      setAgencyKey("");
      setClearAgencyKey(false);
      setAgencyModel("");
      setNotice(
        t("%{agency} vuelve a heredar la configuración global.", {
          agency: agencyName(pendingDeletion, agencies, t),
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

  const showAgencyConfiguration = !embedded && !globalOnly;
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
        <Button type="submit" disabled={savingGlobal}>
          {savingGlobal ? <LoaderCircle className="animate-spin" /> : null}
          {t("Guardar")}
        </Button>
        {isCustomGlobalKeyConfigured ? (
          <Button
            type="button"
            variant="outline"
            disabled={savingGlobal}
            onClick={() => setConfirmGlobalKeyClear(true)}
          >
            {t("Eliminar clave")}
          </Button>
        ) : null}
      </div>
    </form>
  );

  const panel = (
    <>
      {embedded && globalOnly ? (
        <CredentialEntry
          title="OpenRouter"
          description={t(
            "Asistente de IA: clave y modelo predeterminado del espacio.",
          )}
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
      ) : (
        <Tabs
          className="gap-4"
          onValueChange={(value) => setActiveTab(value as ConfigurationTab)}
          value={activeTab}
        >
          <TabsList>
            <TabsTrigger value="global">{t("Global")}</TabsTrigger>
            {showAgencyConfiguration ? (
              <TabsTrigger value="agency">
                {t("Por organización")}
                {(summary?.agencies.length ?? 0) > 0 ? (
                  <Badge className="ml-1.5" variant="outline">
                    {summary?.agencies.length}
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
          </TabsContent>

          {showAgencyConfiguration ? (
            <TabsContent value="agency">
              {summary?.agencies.length ? (
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
                      {summary.agencies.map((setting) => {
                        const agencyId = setting.agencyId!;
                        return (
                          <TableRow key={agencyId}>
                            <TableCell className="font-medium">
                              {agencyName(agencyId, agencies, t)}
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
                                  onClick={() => selectAgency(agencyId)}
                                >
                                  {t("Editar")}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setActiveTab("agency");
                                    setPendingDeletion(agencyId);
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
                onSubmit={saveAgency}
              >
                <div className="grid gap-2">
                  <Label htmlFor="assistant-agency">{t("Organización")}</Label>
                  <select
                    id="assistant-agency"
                    className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px]"
                    value={selectedAgencyId ?? ""}
                    onChange={(event) =>
                      selectAgency(Number(event.target.value))
                    }
                  >
                    <option value="" disabled>
                      {t("Selecciona una organización")}
                    </option>
                    {agencies.map((agency) => (
                      <option key={agency.id} value={agency.id}>
                        {agency.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="assistant-agency-key">
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
                    id="assistant-agency-key"
                    type="password"
                    autoComplete="new-password"
                    value={agencyKey}
                    onChange={(event) => setAgencyKey(event.target.value)}
                    placeholder={
                      selectedOverride?.keyState === "configured"
                        ? t("•••••••••••••••• (dejar en blanco para conservar)")
                        : t("Hereda global")
                    }
                    disabled={!selectedAgencyId || clearAgencyKey}
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
                      htmlFor="assistant-agency-inherit-key"
                    >
                      <input
                        id="assistant-agency-inherit-key"
                        type="checkbox"
                        checked={clearAgencyKey}
                        onChange={(event) => {
                          setClearAgencyKey(event.target.checked);
                          if (event.target.checked) setAgencyKey("");
                        }}
                      />
                      {t("Heredar clave global")}
                    </label>
                  ) : null}
                </div>
                <ModelInput
                  id="assistant-agency-model"
                  label={t("Modelo de organización")}
                  value={agencyModel}
                  onChange={setAgencyModel}
                  models={models}
                  fallbackModel={
                    summary?.global?.model || summary?.deployment?.model
                  }
                  fallbackLabel={
                    summary?.global?.model
                      ? t("Hereda de global")
                      : t("Modelo predeterminado")
                  }
                  disabled={!selectedAgencyId}
                />
                <div>
                  <Button
                    type="submit"
                    disabled={!selectedAgencyId || savingAgency}
                  >
                    {savingAgency ? (
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
                ? t("%{agency} vuelve a heredar la configuración global.", {
                    agency: agencyName(pendingDeletion, agencies, t),
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
