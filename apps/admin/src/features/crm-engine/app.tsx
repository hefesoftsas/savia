import { saveRelatedRecords } from "./save-related-records";
import { reconcileLocalQueries } from "./local-query-sync";
import { RecordOriginLinks } from "./record-origin-links";
import {
  collectionCapabilities,
  supportsLocalRecordTools,
} from "./collection-capabilities";
import React, {
  Fragment,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
} from "react";

import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CoreAdminContext,
  ListBase,
  useListContext,
  memoryStore,
} from "ra-core";
import { DataTable } from "@/components/admin/data-table";
import { ListPagination } from "@/components/admin/list-pagination";
import { ScreenListSkeleton } from "@/components/admin/page-skeletons";
import { i18nProvider } from "@/lib/i18nProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster, toast } from "sonner";
import {
  ArrowUpRight,
  ArrowLeft,
  Plus,
  Search,
  SlidersHorizontal,
  Table2,
  Columns3,
  Building2,
  Users,
  Target,
  CheckSquare,
  Activity,
  Boxes,
  Plug,
  History,
  KeyRound,
  Leaf,
  ChevronDown,
  ChevronRight,
  ArrowDownToLine,
  Save,
  Trash2,
  PanelLeftClose,
  Menu,
  Database,
  GripVertical,
  CalendarDays,
  Check,
  Code2,
  X,
  FileSpreadsheet,
} from "lucide-react";
import { CollectionImportWizard } from "./collection-import-wizard";
import { api, dataProvider } from "./api";
import {
  attachTemporaryR2Attachments,
  deleteTemporaryR2Attachments,
  uploadTemporaryR2Attachment,
} from "./r2-attachment-upload";
import { getCrmRuntime } from "./runtime";
import { useListObjects, getListObjectsQueryKey } from "./generated/crm";
import {
  fieldEntries,
  makeConfig,
  recordSurface,
  isDrawerSurface,
  stageOptions,
  type CrmObject,
  type CrmRecord,
} from "@savia/crm-shared/metadata";
import {
  getMenuBlocks,
  reconcileMenuLayout,
  type ScreenMenuLayout,
} from "@savia/crm-shared/screen-menu-layout";
import { exampleOpenApi } from "@savia/crm-shared/seed";
import { inspectDocument } from "@savia/crm-shared/openapi";
import "./style.css";
import { sortScreens, withScreen } from "./screen-metadata";
import {
  ScreenManager,
  ScreenAdministration,
  ScreenMenuReorder,
} from "./lazy-studio-panels";
import {
  extensionApiFor,
  extensionScreenDefaultHidden,
  extensionScreenFor,
  isExtensionScreenEnabled,
} from "./extension-screens";
import { StudioHelpTooltip } from "./studio-help-tooltip";
import "./screen-manager.css";
const DynamicForm = lazy(() => import("./collection-record-form"));
const RequestPage = lazy(() => import("./request-page"));
const RequestPageGenerator = lazy(() => import("./request-page-generator"));
const Records = lazy(() => import("./records"));
const CollectionSourcesPanel = lazy(() => import("./collection-sources-panel"));
const Integrations = lazy(() => import("./integrations"));
const ServiceCredentials = lazy(() => import("./service-credentials"));
const Operations = lazy(() => import("./operations"));
const CollectionRelations = lazy(() => import("./collection-relations"));
const RecordDetail = lazy(() => import("./record-detail"));
const Designer = lazy(() => import("./designer"));

const icons: Record<string, typeof Boxes> = {
  account: Building2,
  contact: Users,
  opportunity: Target,
  task: CheckSquare,
  activity: Activity,
};
const money = (value: unknown) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
const compact = (value: number) =>
  new Intl.NumberFormat("es-CO", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
const initials = (value: unknown) =>
  String(value ?? "")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
const Loading = () => (
  <div
    className="w-full space-y-4 py-4"
    role="status"
    aria-label="Cargando espacio de trabajo…"
  >
    <span className="sr-only">Cargando espacio de trabajo…</span>
    <ScreenListSkeleton count={4} />
  </div>
);
function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
  conversational = false,
  page = false,
  drawer = false,
  drawerLong = false,
  dialogClassName = "",
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  conversational?: boolean;
  page?: boolean;
  drawer?: boolean;
  drawerLong?: boolean;
  dialogClassName?: string;
}) {
  if (page)
    return (
      <section
        className={
          "record-page " + (conversational ? "record-page-conversation" : "")
        }
      >
        <Button variant="ghost" onClick={onClose}>
          <ArrowLeft size={16} />
          Volver a {title.split(" · ").slice(1).join(" · ") || "la lista"}
        </Button>
        <header className="record-page-heading">
          <h1>{title}</h1>
          <p>
            {conversational
              ? "Vamos paso a paso. Podrás revisar tus respuestas antes de guardar."
              : description}
          </p>
        </header>
        <Suspense fallback={<Loading />}>{children}</Suspense>
      </section>
    );
  const copy = conversational
    ? "Vamos paso a paso. Podrás revisar tus respuestas antes de guardar."
    : description;
  if (drawer)
    return (
      <Drawer
        open
        direction="right"
        onOpenChange={(open) => !open && onClose()}
      >
        <DrawerContent
          className={
            drawerLong
              ? "record-drawer record-drawer-long data-[vaul-drawer-direction=right]:w-[min(48rem,92vw)] data-[vaul-drawer-direction=right]:sm:max-w-3xl"
              : "record-drawer record-drawer-short data-[vaul-drawer-direction=right]:w-[min(24rem,92vw)] data-[vaul-drawer-direction=right]:sm:max-w-md"
          }
        >
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{copy}</DrawerDescription>
          </DrawerHeader>
          <div className="record-drawer-body">
            <Suspense fallback={<Loading />}>{children}</Suspense>
          </div>
        </DrawerContent>
      </Drawer>
    );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={
          "savia-crm-record-dialog " +
          dialogClassName +
          " " +
          (conversational
            ? "record-dialog conversation-dialog"
            : wide
              ? "wide-dialog"
              : "record-dialog")
        }
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{copy}</DialogDescription>
        </DialogHeader>
        <Suspense fallback={<Loading />}>{children}</Suspense>
      </DialogContent>
    </Dialog>
  );
}
function updateLocation(params: URLSearchParams, replace = false) {
  const runtime = getCrmRuntime();
  if (runtime.navigate) {
    runtime.navigate(params.toString(), replace);
    return;
  }
  window.history[replace ? "replaceState" : "pushState"](
    null,
    "",
    "?" + params,
  );
}
function screenManagementTab(params: URLSearchParams): "menu" | "screens" {
  const tab = params.get("tab");
  return tab === "screens" || tab === "table" ? "screens" : "menu";
}
function App({
  embedded = false,
  search,
}: {
  embedded?: boolean;
  search?: string;
}) {
  const activeQueryClient = useQueryClient();
  const [ready, setReady] = useState(false),
    [bootError, setBootError] = useState("");
  useEffect(() => {
    let active = true;
    const runtime = getCrmRuntime();
    const bootstrap = async (path: string) => {
      if (!runtime.transport) return api(path, "POST");
      const response = await runtime.transport("/api" + path, {
        method: "POST",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "No se pudo preparar el dominio.");
      }
    };
    void bootstrap("/bootstrap")
      .then(() =>
        active && embedded && runtime.businessSetupEnabled !== false
          ? bootstrap("/business/setup")
          : undefined,
      )
      .then(() => {
        if (active) setReady(true);
      })
      .catch((e) => {
        if (active) setBootError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const objectsQuery = useListObjects({
    query: { enabled: ready, staleTime: 5 * 60_000 },
  });
  const objectsResponse = objectsQuery.data as unknown as {
    data?: CrmObject[];
    menuLayout?: ScreenMenuLayout | null;
  };
  const objects = objectsResponse?.data ?? [];
  const menuLayout = objectsResponse?.menuLayout ?? null;
  const [location, setLocation] = useState(
    () => new URLSearchParams(search ?? window.location.search),
  );
  const selected =
      location.get("object") ?? (embedded ? "clientes" : "opportunity"),
    view = location.get("view") ?? "records";
  const [mobile, setMobile] = useState(false),
    [newObjectState, setNewObject] = useState(false),
    [editingState, setEditing] = useState<CrmRecord | "new" | null>(null);
  const screensTab = screenManagementTab(location);
  useEffect(() => {
    if (search == null) return;
    const params = new URLSearchParams(search);
    setLocation(params);
    const nextView = params.get("view");
    if (nextView === "screens" || nextView === "remove-screen")
      setEditing(null);
  }, [search]);
  const isObjectHidden = (o: CrmObject) => {
    if (o.config.studio?.screen?.hidden !== undefined) {
      return Boolean(o.config.studio?.screen?.hidden);
    }
    return extensionScreenDefaultHidden(o.name);
  };
  const visibleObjects = sortScreens(objects.filter((o) => !isObjectHidden(o)));
  const resolvedMenuLayout = useMemo(
    () =>
      reconcileMenuLayout(
        menuLayout,
        visibleObjects.map((object) => object.name),
      ),
    [menuLayout, visibleObjects],
  );
  const menuBlocks = useMemo(() => {
    const byName = new Map(
      visibleObjects.map((object) => [object.name, object]),
    );
    return getMenuBlocks(resolvedMenuLayout)
      .map((block) => ({
        ...block,
        objects: block.screens
          .map((name) => byName.get(name))
          .filter((object): object is CrmObject => Boolean(object)),
      }))
      .filter((block) => block.objects.length > 0);
  }, [resolvedMenuLayout, visibleObjects]);
  const newObject =
    view === "new-object" || view === "import-spreadsheet" || newObjectState;
  const removeScreen =
    view === "remove-screen"
      ? objects.find((item) => item.name === selected)
      : undefined;
  const [writeKey, setWriteKey] = useState(() => crypto.randomUUID());
  const recordId = location.get("record");
  const object =
    objects.find((o) => o.name === selected) ?? visibleObjects[0] ?? objects[0];
  const resolvedObjectName = object?.name ?? selected;
  const contribution = extensionScreenFor(resolvedObjectName, view);
  const extensionsQuery = useQuery({
    queryKey: [
      "extension-client-screens",
      getCrmRuntime().domainId,
      contribution?.extensionId,
    ],
    queryFn: () =>
      api<{
        data: Array<{
          manifest: { id: string };
          builtIn: boolean;
          installed: { enabled: boolean } | null;
        }>;
      }>("/extensions"),
    enabled: ready && Boolean(contribution),
    staleTime: 60_000,
  });
  const ExtensionScreen = isExtensionScreenEnabled(
    contribution,
    extensionsQuery.data?.data,
  )
    ? contribution.Screen
    : null;
  const extensionApi = useMemo(
    () => (contribution ? extensionApiFor(contribution, api) : null),
    [contribution?.extensionId],
  );
  useEffect(() => {
    if (!ready || !object || selected === object.name) return;
    const normalized = new URLSearchParams(location);
    normalized.set("object", object.name);
    updateLocation(normalized, true);
    setLocation(normalized);
  }, [location, object, ready, selected]);
  const detailQuery = useQuery({
    queryKey: ["open-record", resolvedObjectName, recordId],
    queryFn: () => api(`/records/${resolvedObjectName}/${recordId}`),
    enabled:
      ready &&
      !!recordId &&
      !!object &&
      collectionCapabilities(object).read &&
      (view === "records" || view === "edit"),
  });
  const editing =
    view === "create"
      ? "new"
      : view === "edit"
        ? (detailQuery.data?.data ?? editingState)
        : editingState;
  const openRecord = (record: CrmRecord) => {
    const params = new URLSearchParams({
      object: resolvedObjectName,
      view: "records",
      record: record.id,
    });
    updateLocation(params);
    setLocation(params);
  };
  const closeRecord = () => {
    const params = new URLSearchParams({ object: selected, view: "records" });
    updateLocation(params);
    setLocation(params);
  };
  const navigate = (
    name: string,
    next = "records",
    extra?: Record<string, string>,
  ) => {
    const params = new URLSearchParams({ object: name, view: next, ...extra });
    updateLocation(params);
    setLocation(params);
    setMobile(false);
    setEditing(null);
  };
  const selectScreensTab = (tab: "menu" | "screens") => {
    const params = new URLSearchParams(location);
    params.set("tab", tab);
    updateLocation(params);
    setLocation(params);
  };
  const editRecord = (record: CrmRecord | "new") => {
    if (
      !object ||
      !(record === "new"
        ? collectionCapabilities(object).create
        : collectionCapabilities(object).update)
    )
      return;
    setWriteKey(crypto.randomUUID());
    const surface = recordSurface(object, record === "new" ? "create" : "edit");
    if (surface === "page") {
      if (record === "new") navigate(object.name, "create");
      else {
        const params = new URLSearchParams({
          object: object.name,
          view: "edit",
          record: record.id,
        });
        updateLocation(params);
        setLocation(params);
        setMobile(false);
        setEditing(record);
      }
      return;
    }
    setEditing(record);
  };
  useEffect(() => {
    if (embedded) return;
    const pop = () => {
      setLocation(new URLSearchParams(window.location.search));
      setEditing(null);
      setWriteKey(crypto.randomUUID());
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [embedded]);
  useEffect(() => {
    if (
      view === "designer" &&
      visibleObjects.length &&
      !visibleObjects.some((o) => o.name === selected)
    ) {
      const params = new URLSearchParams({
        object: visibleObjects[0].name,
        view: "designer",
      });
      updateLocation(params, true);
      setLocation(params);
      setEditing(null);
    }
  }, [view, selected, objects]);
  useEffect(() => {
    if (!ready || objectsQuery.isPending) return;
    window.postMessage(
      {
        type: "savia-crm-navigation",
        domainId: getCrmRuntime().domainId,
        objects: objects.map((item) => {
          const hidden = isObjectHidden(item);
          return {
            name: item.name,
            label: item.label,
            count: item.config.studio?.requestPage ? undefined : item.count,
            hidden,
            config: {
              studio: {
                screen: {
                  hidden,
                  section: item.config.studio?.screen?.section,
                  icon: item.config.studio?.screen?.icon,
                },
              },
            },
          };
        }),
      },
      window.location.origin,
    );
  }, [objects, objectsQuery.isPending, ready]);
  const refresh = () => activeQueryClient.invalidateQueries();
  const updateScreenVisibility = async (target: CrmObject, hidden: boolean) => {
    try {
      const list = await api<{ data: CrmObject[] }>("/objects");
      const latest =
        list.data.find((item) => item.name === target.name) ?? target;
      const result = await api<{ data: CrmObject }>(
        `/objects/${target.name}/screen`,
        "PATCH",
        {
          hidden,
          version: latest.version ?? 1,
        },
      );
      activeQueryClient.setQueryData(
        getListObjectsQueryKey(),
        (previous: { data: CrmObject[] } | undefined) =>
          previous
            ? {
                ...previous,
                data: previous.data.map((item) =>
                  item.name === result.data.name ? result.data : item,
                ),
              }
            : previous,
      );
      await refresh();
      toast.success(
        hidden ? "Pantalla eliminada del menú" : "Pantalla recuperada",
      );
    } catch (error) {
      toast.error((error as Error).message);
      throw error;
    }
  };
  const saveMenuLayout = async (layout: ScreenMenuLayout) => {
    try {
      await api("/objects/reorder", "PUT", { layout });
      await refresh();
      toast.success("Menú de pantallas actualizado");
    } catch (error) {
      toast.error((error as Error).message);
      throw error;
    }
  };
  const deleteScreenPermanently = async (
    target: CrmObject,
    options: { deleteRecords?: boolean } = {},
  ) => {
    try {
      await api(`/objects/${target.name}`, "DELETE", {
        deleteRecords: Boolean(options.deleteRecords),
      });
      activeQueryClient.setQueryData(
        getListObjectsQueryKey(),
        (previous: { data: CrmObject[] } | undefined) =>
          previous
            ? {
                ...previous,
                data: previous.data.filter((item) => item.name !== target.name),
              }
            : previous,
      );
      await refresh();
      const deletedRecords = Boolean(
        options.deleteRecords && (target.count ?? 0) > 0,
      );
      toast.success(
        deletedRecords
          ? `Pantalla «${target.label}» y sus registros eliminados`
          : `Pantalla «${target.label}» eliminada permanentemente`,
      );
      if (selected === target.name) {
        const remaining = objects.filter((item) => item.name !== target.name);
        const nextVisible = sortScreens(
          remaining.filter((item) => !item.config.studio?.screen?.hidden),
        )[0];
        navigate(nextVisible?.name ?? remaining[0]?.name ?? selected, "admin");
      }
    } catch (error) {
      toast.error((error as Error).message);
      throw error;
    }
  };
  useEffect(() => {
    if (!embedded) return;
    const refreshObjects = () => {
      void activeQueryClient.invalidateQueries();
    };
    window.addEventListener("savia-crm-objects-changed", refreshObjects);
    return () =>
      window.removeEventListener("savia-crm-objects-changed", refreshObjects);
  }, [activeQueryClient, embedded]);
  useEffect(() => {
    if (!object || view !== "designer") return;
    const capabilities = collectionCapabilities(object);
    if (!capabilities.schema && !capabilities.customFields)
      navigate(object.name, "records", { configure: "form" });
  }, [object, view]);
  if (view === "request-page-generator" && ready)
    return (
      <main className="page-content">
        <Suspense fallback={<Loading />}>
          <RequestPageGenerator
            onCreated={async (created) => {
              await refresh();
              navigate(created.name, "records");
            }}
          />
        </Suspense>
      </main>
    );
  if (bootError)
    return (
      <div className="fatal">
        <Leaf />
        <h1>No pudimos conectar con el CRM</h1>
        <p>{bootError}</p>
        <Button onClick={() => window.location.reload()}>Reintentar</Button>
      </div>
    );
  if (!object)
    return objectsQuery.error ? (
      <div role="alert">{(objectsQuery.error as Error).message}</div>
    ) : !ready || objectsQuery.isPending ? (
      <Loading />
    ) : (
      <main className="page-content">
        {view === "collection-sources" ? (
          <>
            <Suspense fallback={<Loading />}>
              <CollectionSourcesPanel
                onBound={async (bound) => {
                  await refresh();
                  navigate(bound.name, "admin-screen");
                }}
              />
            </Suspense>
          </>
        ) : (
          <Suspense fallback={<Loading />}>
            <ScreenAdministration
              objects={[]}
              selected={selected}
              detail={false}
              domainTools={Boolean(
                getCrmRuntime().apiBasePath?.startsWith("/v1/data-domains/"),
              )}
              onNavigate={navigate}
              onVisibilityChange={updateScreenVisibility}
              menuLayout={resolvedMenuLayout}
              onMenuLayoutChange={saveMenuLayout}
              onDeletePermanent={deleteScreenPermanently}
              onSolutionsChanged={refresh}
            />
          </Suspense>
        )}
        {newObject && (
          <NewObject
            initialMode={
              view === "import-spreadsheet" ? "spreadsheet" : "blank"
            }
            onClose={() => {
              setNewObject(false);
              navigate(selected, "admin");
            }}
            onCreated={async (name) => {
              await refresh();
              setNewObject(false);
              navigate(name, "admin-screen");
            }}
          />
        )}
      </main>
    );
  const capabilities = collectionCapabilities(object);
  const closeEditor = () => {
    setEditing(null);
    if (view === "create" || view === "edit") navigate(object.name);
  };
  const editorSurface = recordSurface(
    object,
    editing === "new" || view === "create" ? "create" : "edit",
  );
  const recordEditor =
    editing &&
    (editing === "new" ? capabilities.create : capabilities.update) ? (
      <Modal
        page={editorSurface === "page"}
        drawer={isDrawerSurface(editorSurface)}
        drawerLong={editorSurface === "drawer-long"}
        conversational={
          !!object.config.studio?.wizard?.enabled &&
          object.config.studio.wizard.presentation !== "steps"
        }
        title={
          editing === "new"
            ? `Nuevo registro · ${object.label}`
            : String(editing.name ?? "Editar registro")
        }
        description={
          editing === "new"
            ? "Completa los datos. Los campos con * son obligatorios."
            : "Edita los datos y guarda tus cambios."
        }
        onClose={closeEditor}
      >
        {editing !== "new" && <RecordOriginLinks record={editing} />}
        <DynamicForm
          object={object}
          values={editing === "new" ? {} : editing}
          onCancel={editorSurface === "page" ? undefined : closeEditor}
          onSave={async (data, previous, relations, saveOptions) => {
            if (object.config.studio?.collection)
              data = Object.fromEntries(
                Object.entries(data).filter(
                  ([key]) => !object.config.fields[key]?.readOnly,
                ),
              );
            const target =
              previous ?? (editing === "new" ? undefined : editing);
            const creating = !target;
            if (relations)
              return saveRelatedRecords(
                object.name,
                data,
                target,
                relations,
                saveOptions?.idempotencyKey ?? writeKey,
              );
            const result = await api<{ data: CrmRecord }>(
              `/records/${object.name}${creating ? "" : "/" + target.id}`,
              creating ? "POST" : "PATCH",
              creating ? data : { ...data, _version: target._version },
              creating ? { headers: { "Idempotency-Key": writeKey } } : {},
            );
            return result.data;
          }}
          onDiscardTemporaryAttachments={deleteTemporaryR2Attachments}
          onPersistTemporaryAttachments={(record, attachments) =>
            attachTemporaryR2Attachments(record.id, attachments)
          }
          onUploadTemporaryAttachment={(field, file) =>
            uploadTemporaryR2Attachment(object.name, field, file)
          }
          onSaved={(saved) => {
            toast.success(
              saved && saved._localPending
                ? "Guardado en este dispositivo · sincronización pendiente"
                : editing === "new"
                  ? "Registro creado"
                  : "Cambios guardados",
            );
            closeEditor();
            refresh();
            if (
              getCrmRuntime().domainId === "platform" &&
              object.name === "agencias"
            )
              window.dispatchEvent(new Event("savia-crm-domains-changed"));
          }}
        />
        {editing !== "new" && (
          <DeleteRecord
            object={object}
            record={editing}
            onDeleted={() => {
              closeEditor();
              closeRecord();
              refresh();
            }}
          />
        )}
      </Modal>
    ) : null;
  return (
    <div className="app-shell">
      {!embedded ? (
        <aside className={"sidebar " + (mobile ? "is-open" : "")}>
          <a className="brand" href="?object=opportunity">
            <span className="brand-symbol">
              <Leaf size={25} />
            </span>
            <span>
              savia<span className="brand-dot">.</span>
            </span>
            <span className="studio-label">CRM Studio</span>
          </a>
          <div className="workspace-switch">
            <span className="workspace-icon">S</span>
            <div>
              <strong>Espacio de Savia</strong>
              <span>Demostración local</span>
            </div>
            <span className="workspace-status" />
          </div>
          <p className="nav-caption">Tu negocio</p>
          <nav aria-label="Módulos del CRM">
            {menuBlocks.map((block) => (
              <Fragment key={block.kind === "section" ? block.id : "ungrouped"}>
                {block.kind === "section" ? (
                  <p className="nav-section-caption">{block.label}</p>
                ) : null}
                {block.objects.map((o) => {
                  const Icon = icons[o.name] ?? Boxes;
                  return (
                    <div className="nav-screen" key={o.name}>
                      <button
                        className={
                          "nav-item " +
                          (selected === o.name &&
                          (view === "records" ||
                            view === "create" ||
                            view === "edit")
                            ? "active"
                            : "")
                        }
                        onClick={() => navigate(o.name)}
                      >
                        <Icon size={18} />
                        <span>{o.label}</span>
                        <span className="nav-count">{o.count ?? 0}</span>
                      </button>
                      <button
                        className="nav-screen-delete"
                        aria-label={`Eliminar pantalla ${o.label}`}
                        title={`Eliminar pantalla ${o.label}`}
                        onClick={() => navigate(o.name, "remove-screen")}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </nav>
          <button
            className="nav-item"
            onClick={() => navigate(selected, "admin")}
          >
            <SlidersHorizontal size={18} /> Administrar
          </button>
          <button
            className={
              "nav-item " + (view === "service-credentials" ? "active" : "")
            }
            onClick={() => navigate(selected, "service-credentials")}
          >
            <KeyRound size={18} /> Claves y servicios
          </button>
          <div className="sidebar-bottom">
            <div className="storage-note">
              <Database size={15} />
              <span>Datos persistidos en D1</span>
              <span className="live-dot" />
            </div>
            <div className="profile">
              <span className="avatar">SV</span>
              <div>
                <strong>Equipo Savia</strong>
                <span>Sesión de demostración</span>
              </div>
              <PanelLeftClose size={17} />
            </div>
          </div>
        </aside>
      ) : null}
      {!embedded && mobile ? (
        <button
          className="sidebar-backdrop"
          aria-label="Cerrar menú"
          onClick={() => setMobile(false)}
        />
      ) : null}
      <main className="main">
        {!embedded ? (
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="mobile-menu"
                aria-label="Abrir menú"
                onClick={() => setMobile(true)}
              >
                <Menu size={20} />
              </button>
              <span>Espacio de Savia</span>
              <ChevronRight size={14} />
              <strong>
                {view === "records" || view === "create" || view === "edit"
                  ? object.label
                  : view === "collection-sources"
                    ? "Fuentes y colecciones"
                    : view === "designer"
                      ? "Diseñador"
                      : view === "integrations"
                        ? "Integraciones"
                        : view === "service-credentials"
                          ? "Claves y servicios"
                          : view === "operations"
                            ? "Operaciones"
                            : view === "screens" || view === "remove-screen"
                              ? "Pantallas"
                              : view.startsWith("admin")
                                ? "Administración"
                                : "Historial"}
              </strong>
            </div>
            <span className="demo-label">
              <span className="live-dot" /> Entorno de prueba
            </span>
          </header>
        ) : null}
        <div className="page-content">
          {view.startsWith("admin") || view === "new-object" ? (
            <Suspense fallback={<Loading />}>
              <ScreenAdministration
                key={`${view}:${selected}`}
                objects={objects}
                selected={selected}
                detail={view === "admin-screen"}
                domainTools={Boolean(
                  getCrmRuntime().apiBasePath?.startsWith("/v1/data-domains/"),
                )}
                onNavigate={navigate}
                onVisibilityChange={updateScreenVisibility}
                menuLayout={resolvedMenuLayout}
                onMenuLayoutChange={saveMenuLayout}
                onDeletePermanent={deleteScreenPermanently}
                onSolutionsChanged={refresh}
              />
            </Suspense>
          ) : ExtensionScreen ? (
            <ExtensionScreen savia={extensionApi!} />
          ) : view === "create" || view === "edit" ? (
            (recordEditor ?? <Loading />)
          ) : view === "screens" ||
            view === "remove-screen" ||
            view === "screen-settings" ? (
            <div className="screens-page">
              <div className="page-heading">
                <div>
                  <p className="eyebrow">Tu negocio</p>
                  <div className="page-heading-title-row">
                    <h1>
                      {removeScreen
                        ? `Eliminar pantalla · ${removeScreen.label}`
                        : view === "screen-settings"
                          ? "Presentación"
                          : "Gestionar pantallas"}
                    </h1>
                    {view !== "screen-settings" ? (
                      <StudioHelpTooltip label="Ayuda sobre gestionar pantallas">
                        Reordena el menú de Tu negocio, crea secciones, activa u
                        oculta pantallas y configura cómo se abren sus
                        formularios.
                      </StudioHelpTooltip>
                    ) : null}
                  </div>
                </div>
                {view === "screen-settings" ? (
                  <select
                    aria-label="Pantalla a configurar"
                    className="select-input screen-presentation-picker"
                    disabled={!objects.length}
                    value={selected}
                    onChange={(event) =>
                      navigate(event.target.value, "screen-settings")
                    }
                  >
                    {sortScreens(objects).map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.label}
                        {item.config.studio?.screen?.hidden ? " · Oculta" : ""}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              {view === "screens" ? (
                <Tabs
                  value={screensTab}
                  onValueChange={(val) =>
                    selectScreensTab(val as "menu" | "screens")
                  }
                  className="w-full space-y-4"
                >
                  <TabsList className="bg-muted/70 p-1 rounded-xl h-10">
                    <TabsTrigger
                      value="menu"
                      className="gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs transition-all"
                    >
                      <GripVertical className="size-3.5" aria-hidden="true" />
                      Orden del menú
                    </TabsTrigger>
                    <TabsTrigger
                      value="screens"
                      className="gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs transition-all"
                    >
                      <Table2 className="size-3.5" aria-hidden="true" />
                      Pantallas
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent
                    value="menu"
                    className="m-0 focus-visible:outline-none"
                  >
                    <Suspense fallback={<Loading />}>
                      <ScreenMenuReorder
                        className="screen-manager-menu-reorder"
                        objects={objects}
                        menuLayout={resolvedMenuLayout}
                        onMenuLayoutChange={saveMenuLayout}
                      />
                    </Suspense>
                  </TabsContent>

                  <TabsContent
                    value="screens"
                    className="m-0 focus-visible:outline-none"
                  >
                    <div className="savia-surface-card screen-manager-shell">
                      <Suspense fallback={<Loading />}>
                        <ScreenManager
                          variant="table"
                          objects={objects}
                          onCancel={() => navigate(object.name, "screens")}
                          onSaved={async (updated) => {
                            activeQueryClient.setQueryData(
                              getListObjectsQueryKey(),
                              (previous: any) =>
                                previous
                                  ? {
                                      ...previous,
                                      data: previous.data.map((o: CrmObject) =>
                                        o.name === updated.name
                                          ? { ...o, ...updated }
                                          : o,
                                      ),
                                    }
                                  : previous,
                            );
                            await refresh();
                            if (
                              updated.config.studio?.screen?.hidden &&
                              selected === updated.name
                            ) {
                              const next = objects.find(
                                (o) =>
                                  o.name !== updated.name &&
                                  !o.config.studio?.screen?.hidden,
                              );
                              navigate(
                                next?.name ?? updated.name,
                                next ? "records" : "designer",
                              );
                            }
                          }}
                        />
                      </Suspense>
                    </div>
                  </TabsContent>
                </Tabs>
              ) : (
                <div className="savia-surface-card screen-manager-shell">
                  <Suspense fallback={<Loading />}>
                    <ScreenManager
                      variant={view === "screen-settings" ? "detail" : "table"}
                      objects={
                        removeScreen
                          ? [
                              objects.find(
                                (item) => item.name === removeScreen.name,
                              ) ?? removeScreen,
                            ]
                          : view === "screen-settings"
                            ? [object]
                            : objects
                      }
                      initialRemoval={removeScreen?.name}
                      onCancel={() =>
                        navigate(
                          object.name,
                          view === "screen-settings"
                            ? "admin-screen"
                            : "screens",
                          view === "screen-settings"
                            ? undefined
                            : { tab: "screens" },
                        )
                      }
                      onSaved={async (updated) => {
                        activeQueryClient.setQueryData(
                          getListObjectsQueryKey(),
                          (previous: any) =>
                            previous
                              ? {
                                  ...previous,
                                  data: previous.data.map((o: CrmObject) =>
                                    o.name === updated.name
                                      ? { ...o, ...updated }
                                      : o,
                                  ),
                                }
                              : previous,
                        );
                        await refresh();
                        if (
                          updated.config.studio?.screen?.hidden &&
                          selected === updated.name
                        ) {
                          const next = objects.find(
                            (o) =>
                              o.name !== updated.name &&
                              !o.config.studio?.screen?.hidden,
                          );
                          navigate(
                            next?.name ?? updated.name,
                            view === "screen-settings"
                              ? "admin"
                              : next
                                ? "records"
                                : "designer",
                          );
                        } else if (view === "remove-screen") {
                          navigate(object.name, "screens", { tab: "screens" });
                        }
                      }}
                    />
                  </Suspense>
                </div>
              )}
            </div>
          ) : view === "records" && object.config.studio?.requestPage ? (
            <Suspense fallback={<Loading />}>
              <RequestPage key={object.name} object={object} />
            </Suspense>
          ) : view === "records" || view === "new-object" ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">Relaciones que crecen</p>
                  <h1>
                    {object.label}
                    {object.count !== undefined && (
                      <span className="title-count">{object.count}</span>
                    )}
                  </h1>
                  {object.description &&
                    !/^(Colección existente:|Recurso JSON:API:)/.test(
                      object.description,
                    ) && <p>{object.description}</p>}
                </div>
                <div className="heading-actions">
                  {capabilities.create && (
                    <Button onClick={() => editRecord("new")}>
                      <Plus size={17} />
                      Nuevo
                    </Button>
                  )}
                </div>
              </div>
              <Suspense fallback={<Loading />}>
                {capabilities.list ? (
                  <Records
                    key={object.name}
                    object={object}
                    onOpen={openRecord}
                    initialConfigTab={
                      location.get("configure") === "form" ? "form" : undefined
                    }
                  />
                ) : (
                  <p role="alert">
                    Esta colección no permite listar registros.
                  </p>
                )}
              </Suspense>
            </>
          ) : view === "designer" ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">Tu CRM, a tu manera</p>
                  <h1>Diseña una vez. Úsalo siempre.</h1>
                </div>
                <select
                  aria-label="Objeto a diseñar"
                  className="select-input"
                  disabled={!visibleObjects.length}
                  value={
                    visibleObjects.find((o) => o.name === selected)?.name ??
                    visibleObjects[0]?.name ??
                    ""
                  }
                  onChange={(e) => navigate(e.target.value, "designer")}
                >
                  {visibleObjects.map((o) => (
                    <option key={o.name} value={o.name}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <Suspense fallback={<Loading />}>
                {visibleObjects.length ? (
                  <Designer
                    object={
                      visibleObjects.find((o) => o.name === selected) ??
                      visibleObjects[0]
                    }
                    onSaved={refresh}
                  />
                ) : (
                  <div className="empty-screens">
                    <h2>No hay pantallas activas</h2>
                    <p>
                      Crea un objeto o recupera una pantalla para diseñar su
                      formulario.
                    </p>
                    <Button onClick={() => navigate(selected, "screens")}>
                      Gestionar pantallas
                    </Button>
                  </div>
                )}
              </Suspense>
            </>
          ) : (view === "relations" || view === "screen-relations") &&
            getCrmRuntime().apiBasePath?.startsWith("/v1/data-domains/") ? (
            <Suspense fallback={<Loading />}>
              <CollectionRelations
                focusObject={view === "screen-relations" ? selected : undefined}
                objects={objects}
                onOpenCollection={(name: string) => navigate(name)}
              />
            </Suspense>
          ) : view === "collection-sources" &&
            !getCrmRuntime().apiBasePath?.startsWith("/v1/dynamic-crm/") ? (
            <Suspense fallback={<Loading />}>
              <CollectionSourcesPanel
                onBound={async (bound) => {
                  await refresh();
                  navigate(bound.name);
                }}
              />
            </Suspense>
          ) : view === "integrations" ? (
            <Suspense fallback={<Loading />}>
              {!getCrmRuntime().apiBasePath?.startsWith("/v1/dynamic-crm/") && (
                <div className="mb-5 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate(selected, "collection-sources")}
                  >
                    Fuentes y colecciones
                  </Button>
                </div>
              )}
              <Integrations
                onImported={(name) => {
                  refresh();
                  navigate(name);
                }}
              />
            </Suspense>
          ) : view === "service-credentials" ? (
            <Suspense fallback={<Loading />}>
              <ServiceCredentials
                selected={selected}
                domainTools={Boolean(
                  getCrmRuntime().apiBasePath?.startsWith("/v1/data-domains/"),
                )}
                onNavigate={navigate}
              />
            </Suspense>
          ) : view === "operations" ? (
            <Suspense fallback={<Loading />}>
              <Operations objects={objects} />
            </Suspense>
          ) : (
            <Audit
              objectName={view === "screen-audit" ? selected : undefined}
            />
          )}
        </div>
        {!embedded ? (
          <footer className="app-footer">
            <span>Savia CRM Studio</span>
            <span>Entorno local · Guardado en el servidor</span>
          </footer>
        ) : null}
      </main>
      {newObject && (
        <NewObject
          initialMode={view === "import-spreadsheet" ? "spreadsheet" : "blank"}
          onClose={() => {
            setNewObject(false);
            if (view === "new-object" || view === "import-spreadsheet")
              navigate(object.name);
          }}
          onCreated={async (name) => {
            await refresh();
            setNewObject(false);
            navigate(name, "designer");
          }}
        />
      )}
      {recordId && capabilities.read && !editing && detailQuery.data && (
        <Suspense fallback={<Loading />}>
          <RecordDetail
            object={object}
            record={detailQuery.data.data}
            onEdit={editRecord}
            onNavigate={(name, id) => navigate(name, "records", { record: id })}
            onQuotation={(record) =>
              navigate("cotizaciones", "records", { record: record.id })
            }
            onClose={closeRecord}
            onRefresh={refresh}
          />
        </Suspense>
      )}
      {recordId && !editing && detailQuery.error && (
        <Modal
          title="Registro no disponible"
          description={detailQuery.error.message}
          onClose={closeRecord}
        >
          <Button onClick={closeRecord}>Volver a la lista</Button>
        </Modal>
      )}
      {view !== "create" &&
        view !== "edit" &&
        view !== "screens" &&
        view !== "remove-screen" &&
        recordEditor}
      {!embedded ? <Toaster position="bottom-right" richColors /> : null}
    </div>
  );
}
function DeleteRecord({
  object,
  record,
  onDeleted,
}: {
  object: CrmObject;
  record: CrmRecord;
  onDeleted: () => void;
}) {
  const hubspotArchive = object.config.studio?.collection?.kind === "crm";
  const permanent = !supportsLocalRecordTools(object);
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false);
  if (!collectionCapabilities(object).delete) return null;
  return (
    <div className="delete-section">
      {confirm ? (
        <>
          <span>
            {hubspotArchive
              ? "¿Archivar este registro en HubSpot?"
              : permanent
                ? "¿Eliminar permanentemente este registro? Esta acción no se puede deshacer."
                : "¿Mover este registro a la papelera?"}
          </span>
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(
                  `/records/${object.name}/${record.id}?version=${record._version}`,
                  "DELETE",
                );
                toast.success(
                  hubspotArchive
                    ? "Registro archivado en HubSpot"
                    : permanent
                      ? "Registro eliminado"
                      : "Registro movido a la papelera",
                );
                onDeleted();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {hubspotArchive
              ? "Archivar en HubSpot"
              : permanent
                ? "Eliminar permanentemente"
                : "Mover a papelera"}
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          className="delete-button"
          onClick={() => setConfirm(true)}
        >
          <Trash2 size={15} />
          {hubspotArchive
            ? "Archivar en HubSpot"
            : permanent
              ? "Eliminar permanentemente"
              : "Mover a papelera"}
        </Button>
      )}
    </div>
  );
}
function NewObject({
  onClose,
  onCreated,
  initialMode = "blank",
}: {
  onClose: () => void;
  onCreated: (name: string) => void | Promise<void>;
  initialMode?: "spreadsheet" | "blank";
}) {
  const [mode, setMode] = useState<"spreadsheet" | "blank">(initialMode);
  const [name, setName] = useState(""),
    [label, setLabel] = useState(""),
    [description, setDescription] = useState(""),
    [showInSidebar, setShowInSidebar] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);

  if (mode === "spreadsheet") {
    return (
      <CollectionImportWizard
        onClose={onClose}
        onCreated={onCreated}
        onSwitchToBlank={() => setMode("blank")}
      />
    );
  }

  return (
    <Modal
      title="Crea un objeto a tu medida"
      description="Define una entidad y dale forma en el diseñador."
      onClose={onClose}
      dialogClassName="savia-crm-new-object-dialog"
    >
      <div className="flex items-center justify-between p-2.5 mb-4 bg-emerald-50/70 border border-emerald-200/80 rounded-lg">
        <div className="flex items-center gap-2 text-xs text-emerald-900 font-medium">
          <FileSpreadsheet size={16} className="text-emerald-700 shrink-0" />
          <span>¿Tienes un archivo Excel o CSV?</span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-xs h-7 gap-1 bg-white hover:bg-emerald-50 text-emerald-800 border-emerald-300 shadow-none font-semibold cursor-pointer"
          onClick={() => setMode("spreadsheet")}
        >
          Crear desde archivo
        </Button>
      </div>
      <form
        className="standard-form new-object-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const baseConfig = makeConfig({
              name: { type: "Textbox", label: "Nombre", required: true },
            });
            await api("/objects", "POST", {
              name,
              label,
              description,
              config: showInSidebar
                ? baseConfig
                : {
                    ...baseConfig,
                    studio: {
                      screen: {
                        hidden: true,
                      },
                    },
                  },
            });
            toast.success("Objeto creado");
            await onCreated(name);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="new-object-field">
          <Label htmlFor="object-label">Nombre visible</Label>
          <Input
            id="object-label"
            placeholder="Nombre del objeto"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setName(
                e.target.value
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "_"),
              );
            }}
            required
          />
        </div>
        <div className="new-object-field">
          <Label htmlFor="object-name">Identificador</Label>
          <Input
            id="object-name"
            placeholder="nombre_del_objeto"
            value={name}
            onChange={(e) => setName(e.target.value)}
            pattern="[a-z][a-z0-9_]{0,47}"
            required
          />
        </div>
        <div className="new-object-field">
          <Label htmlFor="object-description">Descripción</Label>
          <Input
            id="object-description"
            placeholder="Describe qué gestionarás"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="new-object-field new-object-sidebar-toggle">
          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="space-y-0.5">
              <Label
                htmlFor="object-sidebar-toggle"
                className="text-sm font-medium cursor-pointer"
              >
                Mostrar en la barra lateral
              </Label>
              <p className="text-xs text-muted-foreground">
                Desactívalo si esta pantalla solo se llamará desde otras páginas
                o flujos.
              </p>
            </div>
            <Switch
              id="object-sidebar-toggle"
              checked={showInSidebar}
              onCheckedChange={setShowInSidebar}
              disabled={busy}
              aria-label="Mostrar en la barra lateral"
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="form-submit">
          <Plus size={16} />
          {busy ? "Creando…" : "Crear y diseñar"}
        </Button>
      </form>
    </Modal>
  );
}
function Audit({ objectName }: { objectName?: string }) {
  const query = useQuery({
    queryKey: ["audit", objectName],
    queryFn: () =>
      api(
        "/audit" +
          (objectName ? `?object=${encodeURIComponent(objectName)}` : ""),
      ),
  });
  const actions: Record<string, string> = {
    "record.created": "Registro creado",
    "record.updated": "Registro actualizado",
    "record.deleted": "Registro eliminado",
    "object.created": "Objeto creado",
    "object.updated": "Formulario publicado",
    "object.imported": "Objeto importado",
    "integration.executed": "Operación ejecutada",
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Todo cambio deja una historia</p>
          <h1>Historial de cambios</h1>
          <p>
            Las últimas 100 operaciones guardadas
            {objectName ? " para esta pantalla" : " en el dominio"}.
          </p>
        </div>
        <Button variant="outline" onClick={() => query.refetch()}>
          Actualizar
        </Button>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <p role="alert">{query.error.message}</p>
      ) : query.data?.data.length ? (
        <div className="audit-list">
          {query.data.data.map((row: any) => (
            <div className="audit-row" key={row.id}>
              <span className="audit-icon">
                <History size={18} />
              </span>
              <div>
                <strong>{actions[row.action] ?? row.action}</strong>
                <p>
                  {row.object_name}
                  {row.record_id && " · " + row.record_id.slice(0, 8)}
                </p>
              </div>
              <time>{new Date(row.created_at).toLocaleString("es-CO")}</time>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <History size={30} />
          <h2>Tu historia está por empezar</h2>
          <p>
            Crea un registro o publica un formulario para ver el primer cambio.
          </p>
        </div>
      )}
    </>
  );
}
export default function Root({
  embedded = false,
  search,
}: {
  embedded?: boolean;
  search?: string;
} = {}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 0,
            refetchOnWindowFocus: false,
            networkMode: "always",
          },
          mutations: { networkMode: "always", retry: false },
        },
      }),
  );
  const [store] = useState(() => memoryStore());
  const [authorizationError, setAuthorizationError] = useState<string>();
  useEffect(() => {
    const workspace = getCrmRuntime().localWorkspace;
    if (!workspace) return;
    let previous = new Set<string>();
    let active = true;
    const unsubscribe = workspace.store.subscribeQueryChanges((change) => {
      if (!active) return;
      setAuthorizationError(change.authorizationError);
      const before = previous;
      previous = change.current;
      if (change.authorizationError) {
        void queryClient.cancelQueries();
        queryClient.clear();
        return;
      }
      void reconcileLocalQueries(
        queryClient,
        before,
        change.current,
        change.changed,
      ).catch(() => undefined);
      if (change.metadataChanged) {
        void queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [queryClient]);

  useEffect(
    () => () => {
      void queryClient.cancelQueries();
      queryClient.clear();
    },
    [queryClient],
  );
  if (authorizationError)
    return (
      <div role="alert">
        Tu acceso a este espacio cambió. Conecta y verifica tu sesión para
        continuar.
      </div>
    );
  return (
    <div className={embedded ? "savia-crm savia-embedded" : "savia-crm"}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        store={store}
        i18nProvider={i18nProvider}
      >
        <App embedded={embedded} search={search} />
      </CoreAdminContext>
    </div>
  );
}
