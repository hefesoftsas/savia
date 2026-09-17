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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
  const [employees, setEmployees] = useState<VirtualEmployee[]>([]);
  const [models, setModels] = useState<AssistantModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingEmployee, setEditingEmployee] = useState<VirtualEmployee | null>(
    null,
  );
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");

  // Form state
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [position, setPosition] = useState("");
  const [avatar, setAvatar] = useState("briefcase");
  const [greeting, setGreeting] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [allCollections, setAllCollections] = useState(true);
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [customCollectionInput, setCustomCollectionInput] = useState("");
  const [collectionSearch, setCollectionSearch] = useState("");
  const [availableCollections, setAvailableCollections] = useState<SystemCollection[]>([]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [model, setModel] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");

  // File upload state
  const [uploadingFile, setUploadingFile] = useState(false);
  const [currentFiles, setCurrentFiles] = useState<VirtualEmployeeFile[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!assistantConfigClient || typeof assistantConfigClient.models !== "function") return;
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
      toast.error(err.message || "Error al cargar empleados virtuales");
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

  function resetForm() {
    setName("");
    setHandle("");
    setPosition("");
    setAvatar("briefcase");
    setGreeting("");
    setSystemPrompt("");
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
    setAllCollections(isAll);
    setSelectedCollections(isAll ? [] : emp.allowedCollections);
    setCollectionSearch("");
    setModel(emp.model || "");
    setStatus(emp.status);

    setIsCreateOpen(true);

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
      toast.error("El nombre del empleado es obligatorio");
      setActiveTab("profile");
      return;
    }
    if (!handle.trim()) {
      toast.error("El handle (@mención) es obligatorio");
      setActiveTab("profile");
      return;
    }
    if (!systemPrompt.trim()) {
      toast.error("El rol / instrucciones del sistema son obligatorios");
      setActiveTab("prompt");
      return;
    }

    setSaving(true);
    try {
      const allowed = allCollections ? ["*"] : selectedCollections;

      if (editingEmployee) {
        await client.update(editingEmployee.id, {
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
        toast.success("Empleado virtual actualizado con éxito");
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
        toast.success("Empleado virtual creado con éxito");
      }

      setIsCreateOpen(false);
      await loadEmployees();
    } catch (err: any) {
      toast.error(err.message || "Error al guardar empleado virtual");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(emp: VirtualEmployee) {
    if (!confirm(`¿Eliminar al empleado virtual @${emp.handle} (${emp.name})?`)) {
      return;
    }

    try {
      await client.delete(emp.id);
      toast.success("Empleado virtual eliminado");
      await loadEmployees();
    } catch (err: any) {
      toast.error(err.message || "Error al eliminar empleado");
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !editingEmployee) return;

    setUploadingFile(true);
    try {
      const uploaded = await client.uploadFile(editingEmployee.id, file);
      setCurrentFiles((prev) => [uploaded, ...prev]);
      toast.success(`Archivo indexado en Cloudflare RAG (${uploaded.name})`);
      await loadEmployees();
    } catch (err: any) {
      toast.error(err.message || "Error al subir archivo");
    } finally {
      setUploadingFile(false);
      e.target.value = "";
    }
  }

  async function handleDeleteFile(fileId: string) {
    if (!editingEmployee) return;
    try {
      await client.deleteFile(editingEmployee.id, fileId);
      setCurrentFiles((prev) => prev.filter((f) => f.id !== fileId));
      toast.success("Archivo y vectores RAG eliminados");
      await loadEmployees();
    } catch (err: any) {
      toast.error(err.message || "Error al eliminar archivo");
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            Empleados Virtuales de IA
          </h2>
          <p className="text-sm text-muted-foreground">
            Digital colleagues que puedes invocar usando <code className="bg-muted px-1 py-0.5 rounded font-mono text-xs">@nombre</code> en el chat, con acceso scoped a colecciones y base de conocimiento Cloudflare RAG.
          </p>
        </div>
        <Button onClick={openCreate} className="shrink-0 gap-1.5">
          <Plus className="size-4" />
          Nuevo Empleado
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Buscar empleado por nombre o @handle..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Badge variant="outline" className="text-xs">
          {filteredEmployees.length} empleados
        </Badge>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-44 rounded-xl border bg-card/50 animate-pulse"
            />
          ))}
        </div>
      ) : filteredEmployees.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center rounded-xl border border-dashed bg-card/40">
          <Bot className="size-12 text-muted-foreground mb-3" />
          <h3 className="font-semibold text-lg">No hay empleados virtuales</h3>
          <p className="text-sm text-muted-foreground max-w-md mt-1 mb-4">
            Crea tu primer empleado virtual asignándole un rol, colecciones permitidas y documentos para potenciar tu equipo.
          </p>
          <Button onClick={openCreate} size="sm">
            <Plus className="size-4 mr-1.5" />
            Crear Empleado
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredEmployees.map((emp) => {
            const Icon = getEmployeeAvatarIcon(emp.avatar);
            const isAll = emp.allowedCollections.includes("*");

            return (
              <div
                key={emp.id}
                className="group relative flex flex-col justify-between rounded-xl border bg-card p-5 shadow-xs transition hover:border-primary/40 hover:shadow-md"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                        <Icon className="size-5" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm leading-tight text-foreground">
                          {emp.name}
                        </h4>
                        <span className="font-mono text-xs text-primary font-medium">
                          @{emp.handle}
                        </span>
                      </div>
                    </div>
                    <Badge
                      variant={emp.status === "active" ? "default" : "secondary"}
                      className="text-[10px] uppercase font-semibold tracking-wider"
                    >
                      {emp.status === "active" ? "Activo" : "Inactivo"}
                    </Badge>
                  </div>

                  {emp.position && (
                    <p className="text-xs text-muted-foreground font-medium mb-3 line-clamp-1">
                      {emp.position}
                    </p>
                  )}

                  <p className="text-xs text-muted-foreground line-clamp-2 mb-4 italic">
                    "{emp.greeting || emp.systemPrompt}"
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1 font-medium">
                      <Database className="size-3.5 text-muted-foreground" />
                      {isAll ? (
                        <Badge variant="outline" className="text-[10px] font-normal py-0">
                          Todas las colecciones
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] font-normal py-0">
                          {emp.allowedCollections.length} colecciones
                        </Badge>
                      )}
                    </span>

                    <span className="inline-flex items-center gap-1 font-medium">
                      <FileCode className="size-3.5 text-muted-foreground" />
                      <Badge variant="outline" className="text-[10px] font-normal py-0">
                        {emp.filesCount ?? 0} docs RAG
                      </Badge>
                    </span>
                  </div>

                  {emp.model ? (
                    <div className="flex flex-wrap items-center gap-1.5 pt-2 mt-2 border-t text-[11px] text-muted-foreground">
                      <Cpu className="size-3.5 text-primary shrink-0" />
                      <span className="font-mono text-[11px] font-medium text-foreground/80 truncate max-w-[130px]" title={emp.model}>
                        {emp.model}
                      </span>
                      <ModelCapabilityBadges
                        model={models.find((m) => m.id === emp.model)}
                        size="xs"
                      />
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center justify-end gap-1.5 mt-4 pt-3 border-t">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2.5 text-xs gap-1"
                    onClick={() => void openEdit(emp)}
                  >
                    <Pencil className="size-3.5" />
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => void handleDelete(emp)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Dialog: Crear / Editar Empleado Virtual */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingEmployee
                ? `Editar Empleado Virtual: @${editingEmployee.handle}`
                : "Nuevo Empleado Virtual de IA"}
            </DialogTitle>
            <DialogDescription>
              Configura el perfil, personalidad, colecciones accesibles y base de conocimiento Cloudflare RAG.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid grid-cols-5 w-full">
              <TabsTrigger value="profile">Perfil</TabsTrigger>
              <TabsTrigger value="prompt">Rol & Prompt</TabsTrigger>
              <TabsTrigger value="collections">Colecciones</TabsTrigger>
              <TabsTrigger value="rag">Base RAG</TabsTrigger>
              <TabsTrigger value="model">Modelo</TabsTrigger>
            </TabsList>

            {/* TAB 1: PERFIL */}
            <TabsContent value="profile" className="space-y-4 pt-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="emp-name">Nombre Visible</Label>
                  <Input
                    id="emp-name"
                    placeholder="Ej. Laura - Ventas"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="emp-handle">
                    Identificador para Mención (<code className="text-primary">@handle</code>)
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-muted-foreground font-mono">
                      @
                    </span>
                    <Input
                      id="emp-handle"
                      placeholder="ventas"
                      value={handle}
                      onChange={(e) => setHandle(e.target.value.replace(/[@\s]/g, ""))}
                      className="pl-7 font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="emp-pos">Cargo o Rol de Negocio</Label>
                <Input
                  id="emp-pos"
                  placeholder="Ej. Asesora Comercial y Especialista en Cotizaciones"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Avatar / Icono Representativo</Label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {Object.entries(AVATAR_ICONS).map(([key, IconComponent]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setAvatar(key)}
                      className={`flex size-10 items-center justify-center rounded-xl border transition ${
                        avatar === key
                          ? "border-primary bg-primary/15 text-primary shadow-xs ring-2 ring-primary/30"
                          : "border-border bg-card text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      <IconComponent className="size-5" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="emp-greeting">Mensaje de Saludo (Greeting)</Label>
                <Input
                  id="emp-greeting"
                  placeholder="Ej. ¡Hola! Soy Laura. ¿Qué oportunidad o cotización deseas revisar hoy?"
                  value={greeting}
                  onChange={(e) => setGreeting(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Estado del Empleado</Label>
                  <p className="text-xs text-muted-foreground">
                    Los empleados inactivos no pueden ser invocados con @ en el chat.
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
                    Instrucciones de Rol (System Prompt)
                  </Label>
                  <span className="text-xs text-muted-foreground">
                    Define identidad, límites y tono de respuesta
                  </span>
                </div>
                <Textarea
                  id="emp-prompt"
                  rows={9}
                  placeholder={`Eres Laura, especialista en ventas y cotizaciones en Savia.\n\nTus objetivos:\n1. Asesorar al usuario sobre oportunidades de cotización y pólizas.\n2. Identificar productos adecuados según las necesidades del cliente.\n3. Mantener un tono ejecutivo, cordial y enfocado en el cierre comercial.\n\nRestricciones:\n- No inventes precios ni pólizas fuera del catálogo.\n- Para confirmar emisiones solicita siempre aprobación expresa.`}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  className="font-mono text-xs leading-relaxed"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Tip estilo NocoBase: Delimita claramente el ámbito del empleado para que no responda sobre áreas ajenas a su especialidad.
              </p>
            </TabsContent>

            {/* TAB 3: COLECCIONES CRM */}
            <TabsContent value="collections" className="space-y-4 pt-3">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5 pr-4">
                  <Label className="text-sm font-medium">
                    Acceso a Todas las Colecciones CRM
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Si está activo, el empleado puede consultar cualquier colección del CRM sin restricciones.
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
                        Colecciones Permitidas (Acceso Scoped)
                      </Label>
                      <Badge variant="outline" className="text-xs font-mono">
                        {selectedCollections.length} seleccionada{selectedCollections.length === 1 ? "" : "s"}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs px-2"
                        onClick={selectAllCollections}
                        disabled={filteredCollections.length === 0}
                      >
                        Seleccionar visibles
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs px-2 text-muted-foreground hover:text-destructive"
                        onClick={clearSelectedCollections}
                        disabled={selectedCollections.length === 0}
                      >
                        Limpiar selección
                      </Button>
                    </div>
                  </div>

                  {/* Buscador de colecciones */}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar por nombre o identificador (ej. Empresas, Contactos, cotizaciones)..."
                      value={collectionSearch}
                      onChange={(e) => setCollectionSearch(e.target.value)}
                      className="pl-9 text-xs h-9"
                    />
                  </div>

                  {/* Listado de colecciones disponibles */}
                  {loadingCollections ? (
                    <div className="flex items-center justify-center py-8 text-xs text-muted-foreground gap-2">
                      <Loader2 className="size-4 animate-spin text-primary" />
                      <span>Cargando colecciones del sistema...</span>
                    </div>
                  ) : filteredCollections.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground bg-muted/10">
                      {collectionSearch.trim() ? (
                        <p>No se encontraron colecciones que coincidan con &quot;{collectionSearch}&quot;.</p>
                      ) : (
                        <p>No hay colecciones disponibles en este dominio. Puedes añadir una abajo.</p>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-[260px] overflow-y-auto p-1 rounded-md border bg-background/50">
                      {filteredCollections.map((col) => {
                        const checked = selectedCollections.includes(col.name);
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
                                <div className="text-[10px] text-muted-foreground/80 truncate mt-0.5" title={col.description}>
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
                      Añadir colección personalizada:
                    </Label>
                    <div className="flex gap-2 mt-1">
                      <Input
                        placeholder="nombre_coleccion"
                        value={customCollectionInput}
                        onChange={(e) => setCustomCollectionInput(e.target.value)}
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
                        Añadir
                      </Button>
                    </div>
                  </div>

                  {/* Resumen de colecciones seleccionadas */}
                  {selectedCollections.length > 0 && (
                    <div className="pt-2">
                      <Label className="text-xs text-muted-foreground mb-1.5 block">
                        Colecciones seleccionadas ({selectedCollections.length}):
                      </Label>
                      <div className="flex flex-wrap gap-1.5 max-h-[100px] overflow-y-auto">
                        {selectedCollections.map((colName) => {
                          const item = allKnownCollections.find((c) => c.name === colName);
                          return (
                            <Badge
                              key={colName}
                              variant="secondary"
                              className="text-xs gap-1.5 py-1 px-2 border"
                            >
                              <span className="font-medium text-[11px]">{item?.label || colName}</span>
                              <span className="font-mono text-[10px] text-muted-foreground">({colName})</span>
                              <button
                                type="button"
                                onClick={() => toggleCollection(colName)}
                                className="ml-1 hover:text-destructive text-muted-foreground transition"
                                title="Quitar"
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

            {/* TAB 4: BASE DE CONOCIMIENTO (CLOUDFLARE RAG) */}
            <TabsContent value="rag" className="space-y-4 pt-3">
              <div>
                <Label className="text-sm font-medium">
                  Documentos de Referencia (Cloudflare RAG)
                </Label>
                <p className="text-xs text-muted-foreground mb-3">
                  Sube manuales, políticas de suscripción, tarifas o catálogos (PDF, MD, TXT, CSV, JSON). El motor RAG de Cloudflare (Workers AI + Vectorize) generará embeddings vectoriales para recuperar contexto relevante al consultar a este empleado.
                </p>
              </div>

              {!editingEmployee ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground bg-muted/20">
                  <p>Guarda el empleado primero para habilitar la carga de documentos RAG.</p>
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
                        {uploadingFile ? "Indexando RAG..." : "Subir Documento"}
                      </Button>
                    </label>
                    <span className="text-xs text-muted-foreground">
                      Formatos: PDF, Markdown, Texto, CSV, JSON (hasta 10 MB)
                    </span>
                  </div>

                  {currentFiles.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      No hay documentos cargados para este empleado virtual.
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
                              <p className="font-medium truncate">{file.name}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {(file.sizeBytes / 1024).toFixed(1)} KB •{" "}
                                {new Date(file.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {file.ragStatus === "indexed" && (
                              <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20">
                                <CheckCircle2 className="size-3 mr-1" />
                                Indexado RAG
                              </Badge>
                            )}
                            {file.ragStatus === "pending" && (
                              <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 bg-amber-50">
                                <Clock className="size-3 mr-1" />
                                Procesando
                              </Badge>
                            )}
                            {file.ragStatus === "failed" && (
                              <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">
                                <AlertCircle className="size-3 mr-1" />
                                Error
                              </Badge>
                            )}

                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="size-7 p-0 text-destructive hover:bg-destructive/10"
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

            {/* TAB 5: MODELO LLM */}
            <TabsContent value="model" className="space-y-4 pt-3">
              <ModelInput
                id="emp-model"
                label="Modelo LLM Específico (Opcional)"
                value={model}
                onChange={setModel}
                models={models}
                fallbackModel=""
                fallbackLabel="Hereda de la agencia o global"
              />
              <p className="text-xs text-muted-foreground">
                Si especificas un modelo aquí, este empleado utilizará este modelo cuando sea invocado mediante <code className="font-mono text-primary">@{handle || "nombre"}</code> en el chat. Sus capacidades (visión, archivos, voz, etc.) se activarán automáticamente.
              </p>
            </TabsContent>
          </Tabs>

          <DialogFooter className="pt-4 border-t gap-2">
            <Button
              variant="outline"
              onClick={() => setIsCreateOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Guardando..." : editingEmployee ? "Guardar Cambios" : "Crear Empleado"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
