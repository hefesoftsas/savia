import {
  useRealtimeRefresh,
  RemoteChangesNotice,
} from "@/realtime/use-realtime-refresh";
import { useState, useEffect, useMemo, type ElementType } from "react";
import { toast } from "sonner";
import {
  Briefcase,
  Headset,
  Shield,
  BarChart3,
  Sparkles,
  Bot,
  FileText,
  Calculator,
  UserCheck,
  Plus,
  Pencil,
  Trash2,
  Upload,
  Database,
  FileCode,
  CheckCircle2,
  AlertCircle,
  Clock,
  Search,
  Cpu,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type {
  VirtualEmployee,
  VirtualEmployeeFile,
  CreateVirtualEmployeeInput,
  VirtualEmployeesClient,
  SystemCollection,
} from "@/api/virtual-employees-client";
import type {
  AssistantConfigurationClient,
  AssistantModel,
} from "@/api/assistant-configuration-client";
import { ModelInput } from "@/features/assistant-configuration/assistant-configuration-page";
import { ModelCapabilityBadges } from "@/features/assistant-configuration/model-capability-badges";
import { useMessages } from "@/i18n/core";
import { personalIntegrationsMessages } from "@/i18n/locales/integrations";
import { IntegrationHelpTooltip } from "./integration-ui";
import { createTranslationEmployeeTemplate } from "./translation-employee-template";

type EmployeeAccessMode = "text" | "workspace";

const AVATAR_ICONS: Record<string, ElementType> = {
  briefcase: Briefcase,
  headset: Headset,
  shield: Shield,
  "bar-chart-3": BarChart3,
  sparkles: Sparkles,
  bot: Bot,
  "file-text": FileText,
  calculator: Calculator,
  "user-check": UserCheck,
};

export function getEmployeeAvatarIcon(iconName?: string | null): ElementType {
  if (!iconName) return Bot;
  return AVATAR_ICONS[iconName.toLowerCase()] ?? Bot;
}

export function VirtualEmployeesManagement({
  client,
  assistantConfigClient,
}: {
  client: VirtualEmployeesClient;
  assistantConfigClient?: AssistantConfigurationClient;
}) {
  const t = useMessages(personalIntegrationsMessages);
  const [realtimeTenant, setRealtimeTenant] = useState<number>();
  useEffect(() => {
    let active = true;
    void assistantConfigClient
      ?.activeTenant?.()
      .then((state) => {
        if (active) setRealtimeTenant(state.activeTenantId ?? 0);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [assistantConfigClient]);
  const [employees, setEmployees] = useState<VirtualEmployee[]>([]);
  const [models, setModels] = useState<AssistantModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingEmployee, setEditingEmployee] =
    useState<VirtualEmployee | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");

  // Form state
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [position, setPosition] = useState("");
  const [avatar, setAvatar] = useState("briefcase");
  const [greeting, setGreeting] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [accessMode, setAccessMode] = useState<EmployeeAccessMode>("workspace");
  const [allCollections, setAllCollections] = useState(true);
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [customCollectionInput, setCustomCollectionInput] = useState("");
  const [collectionSearch, setCollectionSearch] = useState("");
  const [availableCollections, setAvailableCollections] = useState<
    SystemCollection[]
  >([]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [model, setModel] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");

  // File upload state
  const [uploadingFile, setUploadingFile] = useState(false);
  const [currentFiles, setCurrentFiles] = useState<VirtualEmployeeFile[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (
      !assistantConfigClient ||
      typeof assistantConfigClient.models !== "function"
    )
      return;
    let active = true;
    assistantConfigClient
      .models()
      .then((data) => {
        if (active) setModels(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [assistantConfigClient]);

  async function loadEmployees() {
    setLoading(true);
    try {
      if (!client || typeof client.list !== "function") {
        setEmployees([]);
        return;
      }
      const data = await client.list();
      setEmployees(data);
    } catch (err: any) {
      toast.error(err.message || t("Error al cargar empleados virtuales"));
    } finally {
      setLoading(false);
    }
  }

  async function loadCollections() {
    if (!client || typeof client.listCollections !== "function") return;
    setLoadingCollections(true);
    try {
      const data = await client.listCollections();
      setAvailableCollections(data);
    } catch {
      setAvailableCollections([]);
    } finally {
      setLoadingCollections(false);
    }
  }

  useEffect(() => {
    void loadEmployees();
    void loadCollections();
  }, [client]);

  const remote = useRealtimeRefresh({
    topics: ["settings"],
    tenantId: realtimeTenant,
    enabled: realtimeTenant !== undefined,
    blocked: isCreateOpen || Boolean(editingEmployee),
    refresh: async () => {
      resetForm();
      setIsCreateOpen(false);
      setEditingEmployee(null);
      await loadEmployees();
      await loadCollections();
    },
  });

  function resetForm() {
    setName("");
    setHandle("");
    setPosition("");
    setAvatar("briefcase");
    setGreeting("");
    setSystemPrompt("");
    setAccessMode("workspace");
    setAllCollections(true);
    setSelectedCollections([]);
    setCustomCollectionInput("");
    setCollectionSearch("");
    setModel("");
    setStatus("active");
    setCurrentFiles([]);
    setActiveTab("profile");
  }

  function openCreate() {
    resetForm();
    setEditingEmployee(null);
    setIsCreateOpen(true);
  }

  async function openEdit(emp: VirtualEmployee) {
    resetForm();
    setEditingEmployee(emp);
    setName(emp.name);
    setHandle(emp.handle);
    setPosition(emp.position || "");
    setAvatar(emp.avatar || "briefcase");
    setGreeting(emp.greeting || "");
    setSystemPrompt(emp.systemPrompt);
    const isAll = emp.allowedCollections.includes("*");
    setAccessMode(emp.allowedCollections.length === 0 ? "text" : "workspace");
    setAllCollections(isAll);
    setSelectedCollections(isAll ? [] : emp.allowedCollections);
    setCollectionSearch("");
    setModel(emp.model || "");
    setStatus(emp.status);

    setIsCreateOpen(true);

    if (emp.allowedCollections.length === 0) {
      setCurrentFiles([]);
      return;
    }

    // Fetch full files
    try {
      const full = await client.get(emp.id);
      setCurrentFiles(full.files || []);
    } catch {
      setCurrentFiles([]);
    }
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error(t("El nombre del empleado es obligatorio"));
      setActiveTab("profile");
      return;
    }
    if (!handle.trim()) {
      toast.error(t("El handle (@mención) es obligatorio"));
      setActiveTab("profile");
      return;
    }
    if (!systemPrompt.trim()) {
      toast.error(t("El rol / instrucciones del sistema son obligatorios"));
      setActiveTab("prompt");
      return;
    }
    if (
      accessMode === "workspace" &&
      !allCollections &&
      selectedCollections.length === 0
    ) {
      toast.error(
        t(
          "Elige al menos una colección o activa el acceso a todas las colecciones para usar Workspace tools.",
        ),
      );
      setActiveTab("collections");
      return;
    }

    setSaving(true);
    try {
      const allowed =
        accessMode === "text"
          ? []
          : allCollections
            ? ["*"]
            : selectedCollections;

      if (editingEmployee) {
        await client.update(editingEmployee.id, {
          name,
          handle,
          position: position || null,
          avatar,
          greeting: greeting || null,
          systemPrompt,
          allowedCollections: allowed,
          ...((model.trim() || null) !== (editingEmployee.model?.trim() || null)
            ? { model: model.trim() || null }
            : {}),
          status,
        });
        toast.success(t("Empleado virtual actualizado con éxito"));
      } else {
        await client.create({
          name,
          handle,
          position: position || null,
          avatar,
          greeting: greeting || null,
          systemPrompt,
          allowedCollections: allowed,
          model: model.trim() || null,
          status,
        });
        toast.success(t("Empleado virtual creado con éxito"));
      }

      setIsCreateOpen(false);
      await loadEmployees();
    } catch (err: any) {
      toast.error(err.message || t("Error al guardar empleado virtual"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(emp: VirtualEmployee) {
    if (
      !confirm(
        t("¿Eliminar al empleado virtual @%{handle} (%{name})?", {
          handle: emp.handle,
          name: emp.name,
        }),
      )
    ) {
      return;
    }

    try {
      await client.delete(emp.id);
      toast.success(t("Empleado virtual eliminado"));
      await loadEmployees();
    } catch (err: any) {
      toast.error(err.message || t("Error al eliminar empleado"));
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !editingEmployee || accessMode !== "workspace") return;

    setUploadingFile(true);
    try {
      const uploaded = await client.uploadFile(editingEmployee.id, file);
      setCurrentFiles((prev) => [uploaded, ...prev]);
      toast.success(
        t("Archivo indexado en Cloudflare RAG (%{name})", {
          name: uploaded.name,
        }),
      );
      await loadEmployees();
    } catch (err: any) {
      toast.error(err.message || t("Error al subir archivo"));
    } finally {
      setUploadingFile(false);
      e.target.value = "";
    }
  }

  async function handleDeleteFile(fileId: string) {
    if (!editingEmployee || accessMode !== "workspace") return;
    try {
      await client.deleteFile(editingEmployee.id, fileId);
      setCurrentFiles((prev) => prev.filter((f) => f.id !== fileId));
      toast.success(t("Archivo y vectores RAG eliminados"));
      await loadEmployees();
    } catch (err: any) {
      toast.error(err.message || t("Error al eliminar archivo"));
    }
  }

  function toggleCollection(col: string) {
    setSelectedCollections((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
    );
  }

  function addCustomCollection() {
    const trimmed = customCollectionInput.trim().toLowerCase();
    if (trimmed && !selectedCollections.includes(trimmed)) {
      setSelectedCollections((prev) => [...prev, trimmed]);
      setCustomCollectionInput("");
    }
  }

  const allKnownCollections = useMemo(() => {
    const list = [...availableCollections];
    for (const sel of selectedCollections) {
      if (sel !== "*" && !list.some((c) => c.name === sel)) {
        list.push({
          name: sel,
          label: sel,
        });
      }
    }
    return list;
  }, [availableCollections, selectedCollections]);

  const filteredCollections = useMemo(() => {
    const q = collectionSearch.toLowerCase().trim();
    if (!q) return allKnownCollections;
    return allKnownCollections.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.label.toLowerCase().includes(q) ||
        (c.description && c.description.toLowerCase().includes(q)),
    );
  }, [allKnownCollections, collectionSearch]);

  function selectAllCollections() {
    const names = filteredCollections.map((c) => c.name);
    setSelectedCollections((prev) => Array.from(new Set([...prev, ...names])));
  }

  function clearSelectedCollections() {
    setSelectedCollections([]);
  }

  function changeAccessMode(nextMode: EmployeeAccessMode) {
    if (nextMode === "text") {
      setActiveTab("profile");
    } else if (accessMode === "text") {
      // Entering workspace mode starts scoped with no data grants. All access
      // remains an explicit choice within the workspace controls.
      setAllCollections(false);
      setSelectedCollections([]);
    }
    setAccessMode(nextMode);
  }

  function openTranslatorTemplate() {
    const template = createTranslationEmployeeTemplate();
    resetForm();
    setEditingEmployee(null);
    setName(template.name);
    setHandle(template.handle);
    setPosition(template.position ?? "");
    setAvatar(template.avatar ?? "bot");
    setGreeting(template.greeting ?? "");
    setSystemPrompt(template.systemPrompt);
    setAccessMode("text");
    setAllCollections(false);
    setSelectedCollections([]);
    setModel(template.model ?? "");
    setStatus(template.status ?? "active");
    setIsCreateOpen(true);
  }

  const filteredEmployees = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.handle.toLowerCase().includes(q) ||
        (e.position && e.position.toLowerCase().includes(q)),
    );
  }, [employees, search]);

  return (
    <div className="space-y-6">
      <RemoteChangesNotice {...remote} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
        <div>
          <div className="flex items-center gap-1.5">
            <h2 className="text-xl font-bold tracking-tight">
              {t("Empleados Virtuales de IA")}
            </h2>
            <IntegrationHelpTooltip
              label={t("Ayuda sobre %{v1}", {
                v1: t("Empleados Virtuales de IA").toLowerCase(),
              })}
            >
              {t("Digital colleagues que puedes invocar usando")}{" "}
              <code className="bg-muted px-1 py-0.5 rounded font-mono text-xs">
                @nombre
              </code>{" "}
              {t(
                "en el chat, con acceso scoped a colecciones y base de conocimiento Cloudflare RAG.",
              )}
            </IntegrationHelpTooltip>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={openTranslatorTemplate}
            className="shrink-0 gap-1.5"
          >
            {t("Plantilla: Traductor español → inglés")}
          </Button>
          <Button onClick={openCreate} className="shrink-0 gap-1.5">
            <Plus className="size-4" />
            {t("Nuevo Empleado")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-52 flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder={t("Buscar empleado por nombre o @handle...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Badge variant="outline" className="text-xs">
          {t("%{count} empleados", { count: filteredEmployees.length })}
        </Badge>
      </div>

      {loading ? (
        <div className="overflow-hidden rounded-xl border bg-card divide-y">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 p-4 animate-pulse">
              <div className="size-11 shrink-0 rounded-xl bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-40 rounded bg-muted" />
                <div className="h-3 w-64 max-w-full rounded bg-muted/70" />
              </div>
              <div className="hidden sm:block h-8 w-20 rounded-md bg-muted" />
            </div>
          ))}
        </div>
      ) : filteredEmployees.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center rounded-xl border border-dashed bg-card/40">
          <Bot className="size-12 text-muted-foreground mb-3" />
          <h3 className="font-semibold text-lg">
            {t("No hay empleados virtuales")}
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mt-1 mb-4">
            {t(
              "Crea tu primer empleado virtual asignándole un rol, colecciones permitidas y documentos para potenciar tu equipo.",
            )}
          </p>
          <Button onClick={openCreate} size="sm">
            <Plus className="size-4 mr-1.5" />
            {t("Crear Empleado")}
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <ul className="divide-y">
            {filteredEmployees.map((emp) => {
              const Icon = getEmployeeAvatarIcon(emp.avatar);
              const isTextOnly = emp.allowedCollections.length === 0;
              const isAll = emp.allowedCollections.includes("*");

              return (
                <li
                  key={emp.id}
                  onClick={() => void openEdit(emp)}
                  className="group flex cursor-pointer items-center gap-3 p-4 transition-colors hover:bg-muted/40 sm:gap-4 sm:px-5"
                >
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {emp.name}
                      </span>
                      <span className="truncate font-mono text-xs font-medium text-primary">
                        @{emp.handle}
                      </span>
                      <Badge
                        variant={
                          emp.status === "active" ? "default" : "secondary"
                        }
                        className="text-[10px] font-semibold uppercase tracking-wider"
                      >
                        {emp.status === "active" ? t("Activo") : t("Inactivo")}
                      </Badge>
                    </div>

                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {emp.position ? (
                        <>
                          <span className="font-medium">{emp.position}</span>
                          <span aria-hidden="true"> · </span>
                        </>
                      ) : null}
                      <span className="italic">
                        "{emp.greeting || emp.systemPrompt}"
                      </span>
                    </p>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Database className="size-3.5" aria-hidden="true" />
                        <span className="font-medium">
                          {isTextOnly
                            ? t("Solo texto")
                            : isAll
                              ? t("Todas las colecciones")
                              : t("%{count} colecciones", {
                                  count: emp.allowedCollections.length,
                                })}
                        </span>
                      </span>
                      {!isTextOnly ? (
                        <span className="inline-flex items-center gap-1.5">
                          <FileCode className="size-3.5" aria-hidden="true" />
                          <span className="font-medium">
                            {t("%{count} docs RAG", {
                              count: emp.filesCount ?? 0,
                            })}
                          </span>
                        </span>
                      ) : null}
                      {emp.model ? (
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <Cpu
                            className="size-3.5 shrink-0 text-primary"
                            aria-hidden="true"
                          />
                          <span
                            className="max-w-[180px] truncate font-mono text-[11px] font-medium text-foreground/80 lg:max-w-[240px]"
                            title={emp.model}
                          >
                            {emp.model}
                          </span>
                          <ModelCapabilityBadges
                            model={models.find((m) => m.id === emp.model)}
                            size="xs"
                          />
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div
                    className="flex shrink-0 items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 px-2.5 text-xs max-sm:size-11 max-sm:p-0"
                      onClick={() => void openEdit(emp)}
                    >
                      <Pencil className="size-3.5" />
                      <span className="sr-only sm:not-sr-only">
                        {t("Editar")}
                      </span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive max-sm:size-11 max-sm:p-0"
                      aria-label={`${t("Quitar")} ${emp.name}`}
                      onClick={() => void handleDelete(emp)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                    <ChevronRight
                      className="hidden size-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground sm:block"
                      aria-hidden="true"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Side drawer: Crear / Editar Empleado Virtual */}
      <Sheet open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <SheetContent
          side="right"
          className="flex h-full w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        >
          <SheetHeader className="shrink-0 border-b bg-card px-5 py-4 pr-12 text-left">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                {(() => {
                  const DrawerIcon = getEmployeeAvatarIcon(avatar);
                  return <DrawerIcon className="size-5" />;
                })()}
              </div>
              <div className="min-w-0">
                <SheetTitle className="truncate leading-snug">
                  {editingEmployee
                    ? t("Editar Empleado Virtual: @%{handle}", {
                        handle: editingEmployee.handle,
                      })
                    : t("Nuevo Empleado Virtual de IA")}
                </SheetTitle>
                <SheetDescription className="mt-0.5 line-clamp-2 text-xs">
                  {t(
                    "Elige si el empleado usará solo el texto que recibe o también las herramientas y los datos de trabajo que autorices.",
                  )}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                {t("Modo del empleado")}
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["text", "Solo texto"],
                    ["workspace", "Workspace tools"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={accessMode === mode}
                    onClick={() => changeAccessMode(mode)}
                    className={`min-h-11 rounded-md border px-3 py-2 text-sm font-medium transition ${
                      accessMode === mode
                        ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/40"
                        : "border-border bg-card text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {accessMode === "text"
                  ? t(
                      "Solo se procesa el texto y las instrucciones proporcionadas. No se usan colecciones, documentos ni herramientas del espacio de trabajo.",
                    )
                  : t(
                      "El empleado puede usar las colecciones y los documentos que autorices en las pestañas de acceso del espacio de trabajo.",
                    )}
              </p>
            </fieldset>

            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
            >
              <TabsList
                className={`grid w-full gap-1 group-data-[orientation=horizontal]/tabs:h-auto ${
                  accessMode === "text"
                    ? "grid-cols-3"
                    : "grid-cols-2 sm:grid-cols-5"
                }`}
              >
                <TabsTrigger
                  className="h-auto min-h-11 min-w-0 whitespace-normal text-center leading-snug"
                  value="profile"
                >
                  {t("Perfil")}
                </TabsTrigger>
                <TabsTrigger
                  className="h-auto min-h-11 min-w-0 whitespace-normal text-center leading-snug"
                  value="prompt"
                >
                  {t("Rol & Prompt")}
                </TabsTrigger>
                {accessMode === "workspace" && (
                  <>
                    <TabsTrigger
                      className="h-auto min-h-11 min-w-0 whitespace-normal text-center leading-snug"
                      value="collections"
                    >
                      {t("Colecciones")}
                    </TabsTrigger>
                    <TabsTrigger
                      className="h-auto min-h-11 min-w-0 whitespace-normal text-center leading-snug"
                      value="rag"
                    >
                      {t("Base RAG")}
                    </TabsTrigger>
                  </>
                )}
                <TabsTrigger
                  className={`h-auto min-h-11 min-w-0 whitespace-normal text-center leading-snug ${accessMode === "workspace" ? "col-span-2 sm:col-span-1" : ""}`}
                  value="model"
                >
                  {t("Modelo")}
                </TabsTrigger>
              </TabsList>

              {/* TAB 1: PERFIL */}
              <TabsContent value="profile" className="space-y-4 pt-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="emp-name">{t("Nombre Visible")}</Label>
                    <Input
                      id="emp-name"
                      placeholder={t("Ej. Laura - Ventas")}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="emp-handle">
                      {t("Identificador para Mención (@handle)")}
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-muted-foreground font-mono">
                        @
                      </span>
                      <Input
                        id="emp-handle"
                        placeholder={t("ventas")}
                        value={handle}
                        onChange={(e) =>
                          setHandle(e.target.value.replace(/[@\s]/g, ""))
                        }
                        className="pl-7 font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="emp-pos">{t("Cargo o Rol de Negocio")}</Label>
                  <Input
                    id="emp-pos"
                    placeholder={t(
                      "Ej. Asesora Comercial y Especialista en Cotizaciones",
                    )}
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>{t("Avatar / Icono Representativo")}</Label>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {Object.entries(AVATAR_ICONS).map(
                      ([key, IconComponent]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setAvatar(key)}
                          aria-label={key}
                          aria-pressed={avatar === key}
                          className={`flex size-11 items-center justify-center rounded-xl border transition ${
                            avatar === key
                              ? "border-primary bg-primary/15 text-primary shadow-xs ring-2 ring-primary/30"
                              : "border-border bg-card text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          <IconComponent className="size-5" />
                        </button>
                      ),
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="emp-greeting">
                    {t("Mensaje de Saludo (Greeting)")}
                  </Label>
                  <Input
                    id="emp-greeting"
                    placeholder={t(
                      "Ej. ¡Hola! Soy Laura. ¿Qué oportunidad o cotización deseas revisar hoy?",
                    )}
                    value={greeting}
                    onChange={(e) => setGreeting(e.target.value)}
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">
                      {t("Estado del Empleado")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t(
                        "Los empleados inactivos no pueden ser invocados con @ en el chat.",
                      )}
                    </p>
                  </div>
                  <Switch
                    checked={status === "active"}
                    onCheckedChange={(checked) =>
                      setStatus(checked ? "active" : "inactive")
                    }
                  />
                </div>
              </TabsContent>

              {/* TAB 2: ROL & PROMPT */}
              <TabsContent value="prompt" className="space-y-3 pt-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="emp-prompt" className="text-sm font-medium">
                      {t("Instrucciones de Rol (System Prompt)")}
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      {t("Define identidad, límites y tono de respuesta")}
                    </span>
                  </div>
                  <Textarea
                    id="emp-prompt"
                    rows={9}
                    placeholder={t("Ejemplo de prompt de ventas")}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    className="font-mono text-xs leading-relaxed"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "Tip: delimita claramente el ámbito del empleado para que no responda sobre áreas ajenas a su especialidad.",
                  )}
                </p>
              </TabsContent>

              {/* TAB 3: COLECCIONES CRM */}
              {accessMode === "workspace" && (
                <TabsContent value="collections" className="space-y-4 pt-3">
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5 pr-4">
                      <Label className="text-sm font-medium">
                        {t("Acceso a Todas las Colecciones de Studio")}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {t(
                          "Si está activo, el empleado puede consultar cualquier colección de Studio sin restricciones.",
                        )}
                      </p>
                    </div>
                    <Switch
                      checked={allCollections}
                      onCheckedChange={(checked) => setAllCollections(checked)}
                    />
                  </div>

                  {!allCollections && (
                    <div className="space-y-3 pt-2">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Label className="text-sm font-medium">
                            {t("Colecciones Permitidas (Acceso Scoped)")}
                          </Label>
                          <Badge
                            variant="outline"
                            className="text-xs font-mono"
                          >
                            {t("%{count} seleccionadas", {
                              count: selectedCollections.length,
                            })}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs px-2 max-sm:h-11"
                            onClick={selectAllCollections}
                            disabled={filteredCollections.length === 0}
                          >
                            {t("Seleccionar visibles")}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs px-2 text-muted-foreground hover:text-destructive max-sm:h-11"
                            onClick={clearSelectedCollections}
                            disabled={selectedCollections.length === 0}
                          >
                            {t("Limpiar selección")}
                          </Button>
                        </div>
                      </div>

                      {/* Buscador de colecciones */}
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                        <Input
                          placeholder={t(
                            "Buscar por nombre o identificador (ej. Empresas, Contactos, cotizaciones)...",
                          )}
                          value={collectionSearch}
                          onChange={(e) => setCollectionSearch(e.target.value)}
                          className="pl-9 text-xs h-9"
                        />
                      </div>

                      {/* Listado de colecciones disponibles */}
                      {loadingCollections ? (
                        <div className="flex items-center justify-center py-8 text-xs text-muted-foreground gap-2">
                          <Loader2 className="size-4 animate-spin text-primary" />
                          <span>
                            {t("Cargando colecciones del sistema...")}
                          </span>
                        </div>
                      ) : filteredCollections.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground bg-muted/10">
                          {collectionSearch.trim() ? (
                            <p>
                              {t(
                                'No se encontraron colecciones que coincidan con "%{query}".',
                                { query: collectionSearch },
                              )}
                            </p>
                          ) : (
                            <p>
                              {t(
                                "No hay colecciones disponibles en este tenant. Puedes añadir una abajo.",
                              )}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[260px] overflow-y-auto p-1 rounded-md border bg-background/50">
                          {filteredCollections.map((col) => {
                            const checked = selectedCollections.includes(
                              col.name,
                            );
                            return (
                              <button
                                key={col.name}
                                type="button"
                                onClick={() => toggleCollection(col.name)}
                                className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-left transition ${
                                  checked
                                    ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/40 shadow-xs"
                                    : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-muted/40"
                                }`}
                              >
                                <div className="pt-0.5 shrink-0">
                                  {checked ? (
                                    <CheckCircle2 className="size-4 text-primary" />
                                  ) : (
                                    <Database className="size-4 text-muted-foreground/60" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-semibold text-foreground truncate">
                                    {col.label}
                                  </div>
                                  <div className="font-mono text-[10px] text-muted-foreground truncate">
                                    {col.name}
                                  </div>
                                  {col.description && (
                                    <div
                                      className="text-[10px] text-muted-foreground/80 truncate mt-0.5"
                                      title={col.description}
                                    >
                                      {col.description}
                                    </div>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Añadir colección personalizada */}
                      <div className="pt-2">
                        <Label className="text-xs text-muted-foreground">
                          {t("Añadir colección personalizada:")}
                        </Label>
                        <div className="flex gap-2 mt-1">
                          <Input
                            placeholder={t("nombre_coleccion")}
                            value={customCollectionInput}
                            onChange={(e) =>
                              setCustomCollectionInput(e.target.value)
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                addCustomCollection();
                              }
                            }}
                            className="font-mono text-xs h-8"
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={addCustomCollection}
                          >
                            {t("Añadir")}
                          </Button>
                        </div>
                      </div>

                      {/* Resumen de colecciones seleccionadas */}
                      {selectedCollections.length > 0 && (
                        <div className="pt-2">
                          <Label className="text-xs text-muted-foreground mb-1.5 block">
                            {t("Colecciones seleccionadas (%{count}):", {
                              count: selectedCollections.length,
                            })}
                          </Label>
                          <div className="flex flex-wrap gap-1.5 max-h-[100px] overflow-y-auto">
                            {selectedCollections.map((colName) => {
                              const item = allKnownCollections.find(
                                (c) => c.name === colName,
                              );
                              return (
                                <Badge
                                  key={colName}
                                  variant="secondary"
                                  className="text-xs gap-1.5 py-1 px-2 border"
                                >
                                  <span className="font-medium text-[11px]">
                                    {item?.label || colName}
                                  </span>
                                  <span className="font-mono text-[10px] text-muted-foreground">
                                    ({colName})
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => toggleCollection(colName)}
                                    className="ml-1 hover:text-destructive text-muted-foreground transition max-sm:ml-0 max-sm:flex max-sm:size-11 max-sm:shrink-0 max-sm:items-center max-sm:justify-center"
                                    title={t("Quitar")}
                                    aria-label={`${t("Quitar")} ${colName}`}
                                  >
                                    ×
                                  </button>
                                </Badge>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </TabsContent>
              )}

              {/* TAB 4: BASE DE CONOCIMIENTO (CLOUDFLARE RAG) */}
              {accessMode === "workspace" && (
                <TabsContent value="rag" className="space-y-4 pt-3">
                  <div>
                    <Label className="text-sm font-medium">
                      {t("Documentos de Referencia (Cloudflare RAG)")}
                    </Label>
                    <p className="text-xs text-muted-foreground mb-3">
                      {t(
                        "Sube manuales, políticas, tarifas o catálogos (PDF, MD, TXT, CSV, JSON). El motor RAG de Cloudflare generará embeddings para recuperar contexto relevante.",
                      )}
                    </p>
                  </div>

                  {!editingEmployee ? (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground bg-muted/20">
                      <p>
                        {t(
                          "Guarda el empleado primero para habilitar la carga de documentos RAG.",
                        )}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <label className="cursor-pointer">
                          <input
                            type="file"
                            className="hidden"
                            accept=".pdf,.txt,.md,.markdown,.csv,.json"
                            onChange={(e) => void handleFileUpload(e)}
                            disabled={uploadingFile}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5 pointer-events-none"
                            disabled={uploadingFile}
                          >
                            <Upload className="size-4" />
                            {uploadingFile
                              ? t("Indexando RAG...")
                              : t("Subir Documento")}
                          </Button>
                        </label>
                        <span className="text-xs text-muted-foreground">
                          {t(
                            "Formatos: PDF, Markdown, Texto, CSV, JSON (hasta 10 MB)",
                          )}
                        </span>
                      </div>

                      {currentFiles.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">
                          {t(
                            "No hay documentos cargados para este empleado virtual.",
                          )}
                        </p>
                      ) : (
                        <div className="rounded-lg border divide-y">
                          {currentFiles.map((file) => (
                            <div
                              key={file.id}
                              className="flex items-center justify-between p-3 text-xs"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <FileText className="size-4 text-primary shrink-0" />
                                <div className="min-w-0">
                                  <p className="font-medium truncate">
                                    {file.name}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {(file.sizeBytes / 1024).toFixed(1)} KB •{" "}
                                    {new Date(
                                      file.createdAt,
                                    ).toLocaleDateString()}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {file.ragStatus === "indexed" && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20"
                                  >
                                    <CheckCircle2 className="size-3 mr-1" />
                                    {t("Indexado RAG")}
                                  </Badge>
                                )}
                                {file.ragStatus === "pending" && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] text-amber-600 border-amber-300 bg-amber-50"
                                  >
                                    <Clock className="size-3 mr-1" />
                                    {t("Procesando")}
                                  </Badge>
                                )}
                                {file.ragStatus === "failed" && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] text-destructive border-destructive/30"
                                  >
                                    <AlertCircle className="size-3 mr-1" />
                                    {t("Error")}
                                  </Badge>
                                )}

                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="size-7 p-0 text-destructive hover:bg-destructive/10 max-sm:size-11"
                                  aria-label={`${t("Quitar")} ${file.name}`}
                                  onClick={() => void handleDeleteFile(file.id)}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </TabsContent>
              )}

              {/* TAB 5: MODELO LLM */}
              <TabsContent value="model" className="space-y-4 pt-3">
                <ModelInput
                  id="emp-model"
                  label={t("Modelo LLM Específico (Opcional)")}
                  value={model}
                  onChange={setModel}
                  models={models}
                  fallbackModel=""
                  fallbackLabel={t("Hereda de la organización o global")}
                />
                <p className="text-xs text-muted-foreground">
                  {t(
                    "Si especificas un modelo aquí, este empleado utilizará este modelo cuando sea invocado en el chat. Sus capacidades se activarán automáticamente.",
                  )}
                </p>
              </TabsContent>
            </Tabs>
          </div>

          <SheetFooter className="shrink-0 flex-row items-center justify-end gap-2 border-t bg-card px-5 py-4 sm:justify-end [&>button]:min-h-11">
            <Button
              variant="outline"
              onClick={() => setIsCreateOpen(false)}
              disabled={saving}
            >
              {t("Cancelar")}
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving
                ? t("Guardando...")
                : editingEmployee
                  ? t("Guardar Cambios")
                  : t("Crear Empleado")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
