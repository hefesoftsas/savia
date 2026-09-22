import { ExtensionLocaleBridge } from "@/i18n/app-locale-provider";
import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { defaultAppLocale, isAppLocale } from "@/i18n/app-locale";
import { automationMessages } from "@/i18n/locales/automation";
import {
  canDuplicateRecord,
  duplicateRecordValues,
} from "./record-duplication";
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
  useRef,
  useState,
} from "react";

import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CoreAdminContext,
  ListBase,
  useListContext,
  useStore,
  memoryStore,
} from "ra-core";
import { DataTable } from "@/components/admin/data-table";
import { ListPagination } from "@/components/admin/list-pagination";
import { ScreenListSkeleton } from "@/components/admin/page-skeletons";
import { i18nProvider } from "@/lib/i18nProvider";
import { Button } from "@/components/ui/button";
import { CollectionFollow } from "@/features/notifications/collection-follow";
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
const initials = (value: unknown) =>
  String(value ?? "")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
const Loading = () => {
  const t = useMessages(automationMessages);

  return (
    <div
      className="w-full space-y-4 py-4"
      role="status"
      aria-label={t("Cargando espacio de trabajo…")}
    >
      <span className="sr-only">{t("Cargando espacio de trabajo…")}</span>
      <ScreenListSkeleton count={4} />
    </div>
  );
};
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
  const t = useMessages(automationMessages);

  if (page)
    return (
      <section
        className={
          "record-page " + (conversational ? "record-page-conversation" : "")
        }
      >
        <Button variant="ghost" onClick={onClose}>
          <ArrowLeft size={16} />
          {t("Volver a")}{" "}
          {title.split(" · ").slice(1).join(" · ") || t("la lista")}
        </Button>
        <header className="record-page-heading">
          <h1>{title}</h1>
          <p>
            {conversational
              ? t(
                  "Vamos paso a paso. Podrás revisar tus respuestas antes de guardar.",
                )
              : description}
          </p>
        </header>
        <Suspense fallback={<Loading />}>{children}</Suspense>
      </section>
    );
  const copy = conversational
    ? t("Vamos paso a paso. Podrás revisar tus respuestas antes de guardar.")
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
  const t = useMessages(automationMessages);
  const extensionLocale = useAppLocale();
  const extensionLocaleRef = useRef(extensionLocale);
  extensionLocaleRef.current = extensionLocale;

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
        throw new Error(body.error ?? t("No se pudo preparar el dominio."));
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
  const [duplicate, setDuplicate] = useState<{
    object: string;
    values: Record<string, unknown>;
  } | null>(null);
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
    () => (contribution ? extensionApiFor(contribution, api, () => extensionLocaleRef.current) : null),
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
    setDuplicate(null);
  };
  const selectTab = (tab: string) => {
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
    setDuplicate(null);
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
  const duplicateRecord = (record: CrmRecord) => {
    if (!object || !canDuplicateRecord(object)) return;
    const values = duplicateRecordValues(object, record);
    editRecord("new");
    setDuplicate({ object: object.name, values });
  };
  useEffect(() => {
    if (embedded) return;
    const pop = () => {
      setLocation(new URLSearchParams(window.location.search));
      setEditing(null);
      setDuplicate(null);
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
        hidden ? t("Pantalla eliminada del menú") : t("Pantalla recuperada"),
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
      toast.success(t("Menú de pantallas actualizado"));
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
          ? t("Pantalla «%{value0}» y sus registros eliminados", {
              value0: target.label,
            })
          : t("Pantalla «%{value0}» eliminada permanentemente", {
              value0: target.label,
            }),
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
        <h1>{t("No pudimos conectar con el CRM")}</h1>
        <p>{bootError}</p>
        <Button onClick={() => window.location.reload()}>
          {t("Reintentar")}
        </Button>
      </div>
    );
  const domainContent =
    view === "integrations" ? (
      <Suspense fallback={<Loading />}>
        {!getCrmRuntime().apiBasePath?.startsWith("/v1/dynamic-crm/") && (
          <div className="mb-5 flex justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(selected, "collection-sources")}
            >
              {t("Fuentes y colecciones")}
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
    ) : view === "operations" ? (
      <Suspense fallback={<Loading />}>
        <Operations
          objects={objects}
          tab={location.get("tab") ?? "tasks"}
          onTabChange={selectTab}
        />
      </Suspense>
    ) : view === "audit" ? (
      <Audit />
    ) : null;
  if (!object)
    return objectsQuery.error ? (
      <div role="alert">{(objectsQuery.error as Error).message}</div>
    ) : !ready || objectsQuery.isPending ? (
      <Loading />
    ) : (
      <main className="page-content">
        {domainContent ??
          (view === "collection-sources" ? (
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
                tab={
                  location.get("tab") === "packages" ? "packages" : "screens"
                }
                onTabChange={selectTab}
              />
            </Suspense>
          ))}
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
    setDuplicate(null);
    if (view === "create" || view === "edit") navigate(object.name);
  };
  const editorSurface = recordSurface(
    object,
    editing === "new" || view === "create" ? "create" : "edit",
  );
  const copying = editing === "new" && duplicate?.object === object.name;
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
            ? `${copying ? t("Duplicar registro") : t("Nuevo registro")} · ${object.label}`
            : String(editing.name ?? t("Editar registro"))
        }
        description={
          editing === "new"
            ? copying
              ? t(
                  "Se copiaron los campos simples editables. Se excluyen identificadores, propietarios, fechas de auditoría, campos únicos, ocultos o calculados, archivos y relaciones. Revisa los datos antes de guardar. Al cerrar se descarta esta copia.",
                )
              : t("Completa los datos. Los campos con * son obligatorios.")
            : t("Edita los datos y guarda tus cambios.")
        }
        onClose={closeEditor}
      >
        {editing !== "new" && <RecordOriginLinks record={editing} />}
        <DynamicForm
          key={writeKey}
          ephemeralDraft={copying}
          object={object}
          values={
            editing === "new" ? (copying ? duplicate.values : {}) : editing
          }
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
                ? t("Guardado en este dispositivo · sincronización pendiente")
                : editing === "new"
                  ? t("Registro creado")
                  : t("Cambios guardados"),
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
              {t("savia")}
              <span className="brand-dot">.</span>
            </span>
            <span className="studio-label">{t("CRM Studio")}</span>
          </a>
          <div className="workspace-switch">
            <span className="workspace-icon">S</span>
            <div>
              <strong>{t("Espacio de Savia")}</strong>
              <span>{t("Demostración local")}</span>
            </div>
            <span className="workspace-status" />
          </div>
          <p className="nav-caption">{t("Tu negocio")}</p>
          <nav aria-label={t("Módulos del CRM")}>
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
                        aria-label={t("Eliminar pantalla %{value0}", {
                          value0: o.label,
                        })}
                        title={t("Eliminar pantalla %{value0}", {
                          value0: o.label,
                        })}
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
            <SlidersHorizontal size={18} /> {t("Administrar")}
          </button>
          <button
            className={
              "nav-item " + (view === "service-credentials" ? "active" : "")
            }
            onClick={() => navigate(selected, "service-credentials")}
          >
            <KeyRound size={18} /> {t("Claves y servicios")}
          </button>
          <div className="sidebar-bottom">
            <div className="storage-note">
              <Database size={15} />
              <span>{t("Datos persistidos en D1")}</span>
              <span className="live-dot" />
            </div>
            <div className="profile">
              <span className="avatar">{t("SV")}</span>
              <div>
                <strong>{t("Equipo Savia")}</strong>
                <span>{t("Sesión de demostración")}</span>
              </div>
              <PanelLeftClose size={17} />
            </div>
          </div>
        </aside>
      ) : null}
      {!embedded && mobile ? (
        <button
          className="sidebar-backdrop"
          aria-label={t("Cerrar menú")}
          onClick={() => setMobile(false)}
        />
      ) : null}
      <main className="main">
        {!embedded ? (
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="mobile-menu"
                aria-label={t("Abrir menú")}
                onClick={() => setMobile(true)}
              >
                <Menu size={20} />
              </button>
              <span>{t("Espacio de Savia")}</span>
              <ChevronRight size={14} />
              <strong>
                {view === "records" || view === "create" || view === "edit"
                  ? object.label
                  : view === "collection-sources"
                    ? t("Fuentes y colecciones")
                    : view === "designer"
                      ? t("Diseñador")
                      : view === "integrations"
                        ? t("Integraciones")
                        : view === "service-credentials"
                          ? t("Claves y servicios")
                          : view === "operations"
                            ? t("Operaciones")
                            : view === "screens" || view === "remove-screen"
                              ? t("Pantallas")
                              : view.startsWith("admin")
                                ? t("Administración")
                                : t("Historial")}
              </strong>
            </div>
            <span className="demo-label">
              <span className="live-dot" /> {t("Entorno de prueba")}
            </span>
          </header>
        ) : null}
        <div className="page-content">
          {domainContent ? (
            domainContent
          ) : view.startsWith("admin") || view === "new-object" ? (
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
                tab={
                  location.get("tab") === "packages" ? "packages" : "screens"
                }
                onTabChange={selectTab}
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
                  <p className="eyebrow">{t("Tu negocio")}</p>
                  <div className="page-heading-title-row">
                    <h1>
                      {removeScreen
                        ? t("Eliminar pantalla · %{value0}", {
                            value0: removeScreen.label,
                          })
                        : view === "screen-settings"
                          ? t("Presentación")
                          : t("Gestionar pantallas")}
                    </h1>
                    {view !== "screen-settings" ? (
                      <StudioHelpTooltip
                        label={t("Ayuda sobre gestionar pantallas")}
                      >
                        {t(
                          "Reordena el menú de Tu negocio, crea secciones, activa u oculta pantallas y configura cómo se abren sus formularios.",
                        )}
                      </StudioHelpTooltip>
                    ) : null}
                  </div>
                </div>
                {view === "screen-settings" ? (
                  <select
                    aria-label={t("Pantalla a configurar")}
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
                        {item.config.studio?.screen?.hidden
                          ? t(" · Oculta")
                          : ""}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              {view === "screens" ? (
                <Tabs
                  value={screensTab}
                  onValueChange={(val) => selectTab(val as "menu" | "screens")}
                  className="w-full space-y-4"
                >
                  <TabsList className="bg-muted/70 p-1 rounded-xl h-10">
                    <TabsTrigger
                      value="menu"
                      className="gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs transition-all"
                    >
                      <GripVertical className="size-3.5" aria-hidden="true" />
                      {t("Orden del menú")}
                    </TabsTrigger>
                    <TabsTrigger
                      value="screens"
                      className="gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs transition-all"
                    >
                      <Table2 className="size-3.5" aria-hidden="true" />
                      {t("Pantallas")}
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
                  <p className="eyebrow">{t("Relaciones que crecen")}</p>
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
                  <CollectionFollow collection={object.name} />
                  {capabilities.create && (
                    <Button onClick={() => editRecord("new")}>
                      <Plus size={17} />
                      {t("Nuevo")}
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
                    {t("Esta colección no permite listar registros.")}
                  </p>
                )}
              </Suspense>
            </>
          ) : view === "designer" ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">{t("Tu CRM, a tu manera")}</p>
                  <h1>{t("Diseña una vez. Úsalo siempre.")}</h1>
                </div>
                <select
                  aria-label={t("Objeto a diseñar")}
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
                    <h2>{t("No hay pantallas activas")}</h2>
                    <p>
                      {t(
                        "Crea un objeto o recupera una pantalla para diseñar su formulario.",
                      )}
                    </p>
                    <Button onClick={() => navigate(selected, "screens")}>
                      {t("Gestionar pantallas")}
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
          ) : (
            <Audit
              objectName={view === "screen-audit" ? selected : undefined}
            />
          )}
        </div>
        {!embedded ? (
          <footer className="app-footer">
            <span>{t("Savia CRM Studio")}</span>
            <span>{t("Entorno local · Guardado en el servidor")}</span>
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
            key={`${object.name}:${recordId}`}
            object={object}
            record={detailQuery.data.data}
            onEdit={editRecord}
            onDuplicate={duplicateRecord}
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
          title={t("Registro no disponible")}
          description={detailQuery.error.message}
          onClose={closeRecord}
        >
          <Button onClick={closeRecord}>{t("Volver a la lista")}</Button>
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
  const t = useMessages(automationMessages);

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
              ? t("¿Archivar este registro en HubSpot?")
              : permanent
                ? t(
                    "¿Eliminar permanentemente este registro? Esta acción no se puede deshacer.",
                  )
                : t("¿Mover este registro a la papelera?")}
          </span>
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            {t("Cancelar")}
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
                    ? t("Registro archivado en HubSpot")
                    : permanent
                      ? t("Registro eliminado")
                      : t("Registro movido a la papelera"),
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
              ? t("Archivar en HubSpot")
              : permanent
                ? t("Eliminar permanentemente")
                : t("Mover a papelera")}
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
            ? t("Archivar en HubSpot")
            : permanent
              ? t("Eliminar permanentemente")
              : t("Mover a papelera")}
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
  const t = useMessages(automationMessages);

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
      title={t("Crea un objeto a tu medida")}
      description={t("Define una entidad y dale forma en el diseñador.")}
      onClose={onClose}
      dialogClassName="savia-crm-new-object-dialog"
    >
      <div className="flex items-center justify-between p-2.5 mb-4 bg-emerald-50/70 border border-emerald-200/80 rounded-lg">
        <div className="flex items-center gap-2 text-xs text-emerald-900 font-medium">
          <FileSpreadsheet size={16} className="text-emerald-700 shrink-0" />
          <span>{t("¿Tienes un archivo Excel o CSV?")}</span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-xs h-7 gap-1 bg-white hover:bg-emerald-50 text-emerald-800 border-emerald-300 shadow-none font-semibold cursor-pointer"
          onClick={() => setMode("spreadsheet")}
        >
          {t("Crear desde archivo")}
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
              name: { type: "Textbox", label: t("Nombre"), required: true },
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
            toast.success(t("Objeto creado"));
            await onCreated(name);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="new-object-field">
          <Label htmlFor="object-label">{t("Nombre visible")}</Label>
          <Input
            id="object-label"
            placeholder={t("Nombre del objeto")}
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
          <Label htmlFor="object-name">{t("Identificador")}</Label>
          <Input
            id="object-name"
            placeholder={t("nombre_del_objeto")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            pattern="[a-z][a-z0-9_]{0,47}"
            required
          />
        </div>
        <div className="new-object-field">
          <Label htmlFor="object-description">{t("Descripción")}</Label>
          <Input
            id="object-description"
            placeholder={t("Describe qué gestionarás")}
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
                {t("Mostrar en la barra lateral")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t(
                  "Desactívalo si esta pantalla solo se llamará desde otras páginas o flujos.",
                )}
              </p>
            </div>
            <Switch
              id="object-sidebar-toggle"
              checked={showInSidebar}
              onCheckedChange={setShowInSidebar}
              disabled={busy}
              aria-label={t("Mostrar en la barra lateral")}
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
          {busy ? t("Creando…") : t("Crear y diseñar")}
        </Button>
      </form>
    </Modal>
  );
}
function Audit({ objectName }: { objectName?: string }) {
  const t = useMessages(automationMessages);
  const locale = useAppLocale();

  const query = useQuery({
    queryKey: ["audit", objectName],
    queryFn: () =>
      api(
        "/audit" +
          (objectName ? `?object=${encodeURIComponent(objectName)}` : ""),
      ),
  });
  const actions: Record<string, string> = {
    "record.created": t("Registro creado"),
    "record.updated": t("Registro actualizado"),
    "record.deleted": t("Registro eliminado"),
    "object.created": t("Objeto creado"),
    "object.updated": t("Formulario publicado"),
    "object.imported": t("Objeto importado"),
    "integration.executed": t("Operación ejecutada"),
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("Todo cambio deja una historia")}</p>
          <h1>{t("Historial de cambios")}</h1>
          <p>
            {t("Las últimas 100 operaciones guardadas")}
            {objectName ? t(" para esta pantalla") : t(" en el dominio")}.
          </p>
        </div>
        <Button variant="outline" onClick={() => query.refetch()}>
          {t("Actualizar")}
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
              <time>
                {new Date(row.created_at).toLocaleString(intlLocale(locale))}
              </time>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <History size={30} />
          <h2>{t("Tu historia está por empezar")}</h2>
          <p>
            {t(
              "Crea un registro o publica un formulario para ver el primer cambio.",
            )}
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
  const t = useMessages(automationMessages);
  // Read the outer admin store directly: useAppLocale() falls back to the
  // default ra-core I18nContext ("en") when there is no outer provider
  // (unit tests, standalone Root), which would force English incorrectly.
  const [outerLocaleRaw] = useStore<string>("locale", defaultAppLocale);
  const outerLocale = isAppLocale(outerLocaleRaw)
    ? outerLocaleRaw
    : defaultAppLocale;

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
  const [store] = useState(() => memoryStore({ locale: outerLocale }));
  useEffect(() => {
    store.setItem("locale", outerLocale);
  }, [store, outerLocale]);
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
        {t(
          "Tu acceso a este espacio cambió. Conecta y verifica tu sesión para continuar.",
        )}
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
        <ExtensionLocaleBridge><App embedded={embedded} search={search} /></ExtensionLocaleBridge>
      </CoreAdminContext>
    </div>
  );
}
