import {
  EmailVerificationField,
  EmailVerificationStatus,
} from "./email-verification-field";
import {
  ResourceEditSync,
  ResourceReadSync,
} from "@/realtime/resource-realtime";
import { UserAccessRoles } from "./user-access-roles";
import { useMessages } from "@/i18n/core";
import { settingsMessages } from "@/i18n/locales/settings";
import { useEffect, useState, type ReactNode } from "react";
import {
  Ban,
  KeyRound,
  LogOut,
  Plus,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Info,
  UsersRound,
} from "lucide-react";
import {
  required,
  useCanAccess,
  useChoicesContext,
  useDataProvider,
  useDelete,
  useEditContext,
  useGetList,
  useGetOne,
  useListContext,
  useNotify,
  usePermissions,
  useRecordContext,
  useRedirect,
  useRefresh,
  useResourceContext,
  useShowContext,
  useTranslate,
} from "ra-core";
import MicrosoftExcel from "@thesvg/react/microsoft-excel";
import { useQueryClient } from "@tanstack/react-query";
import { useFormContext, useWatch } from "react-hook-form";
import {
  BooleanInput,
  Count,
  Create,
  CreateButton,
  DataTable,
  Edit,
  EditButton,
  ExportButton,
  List,
  ListPagination,
  ReferenceInput,
  SelectInput,
  Show,
  ShowButton,
  SimpleForm,
  TextInput,
} from "@/components/admin";
import { Confirm } from "@/components/admin/confirm";
import { isOfflineError } from "@/offline/offline-error";
import { applyRealtimeListEvent } from "@/realtime/realtime-list";
import { useRealtimeTopics } from "@/realtime/use-realtime";
import type { TenantRecord } from "@/api/tenant-data-provider";
import type {
  IdentityUserDataProvider,
  UserRecord,
} from "@/api/identity-user-data-provider";
import type { AgencyAccessRole } from "@/api/identity-client";
import type { AuthPermissions } from "@/auth/auth-session";
import { TenantUserCapacity } from "./tenant-user-capacity";
import { TenantSignInSettingsLink } from "@/features/tenant-sso/tenant-sign-in-links";
import {
  tenantAdminTenantId,
  tenantAdminUserUpdateData,
  userCreateScope,
} from "./tenant-user-scope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButtonWithTooltip } from "@/components/admin/icon-button-with-tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const requiredField = required("ra.validation.required");

const tenantRoleChoices: { id: AgencyAccessRole; name: string }[] = [
  { id: "tenant_admin", name: "Administrador de tenant" },
  { id: "operator", name: "Operador" },
  { id: "viewer", name: "Solo lectura" },
];

function userFilters(
  t: ReturnType<typeof useMessages<typeof settingsMessages>>,
) {
  return [
    <TextInput
      key="q"
      source="q"
      label={false}
      alwaysOn
      placeholder={t("Buscar por usuario o correo…")}
      inputClassName="w-full sm:w-72"
    />,
  ];
}

const userStoreKeys = {
  active: "users.active",
  inactive: "users.inactive",
  all: "users.all",
};

type UserStatusView = keyof typeof userStoreKeys;

function getUserStatusView(isActive: unknown): UserStatusView {
  if (isActive === true) return "active";
  if (isActive === false) return "inactive";
  return "all";
}

type ApiErrorLike = {
  code?: string;
  status?: number;
};

function asApiErrorLike(error: unknown): ApiErrorLike {
  if (typeof error !== "object" || error === null) return {};
  const candidate = error as Record<string, unknown>;
  const nested =
    typeof candidate.body === "object" && candidate.body !== null
      ? (candidate.body as Record<string, unknown>).error
      : undefined;
  const nestedRecord =
    typeof nested === "object" && nested !== null
      ? (nested as Record<string, unknown>)
      : undefined;
  const code =
    (typeof candidate.code === "string" && candidate.code) ||
    (nestedRecord && typeof nestedRecord.code === "string"
      ? (nestedRecord.code as string)
      : undefined);
  const status =
    typeof candidate.status === "number" ? candidate.status : undefined;
  return { code, status };
}

export function deleteUserErrorMessage(
  error: unknown,
): keyof typeof settingsMessages {
  if (isOfflineError(error)) {
    return "Sin conexión o servicio no disponible. Inténtalo de nuevo.";
  }
  const { code, status } = asApiErrorLike(error);
  if (code === "LAST_ACTIVE_MEMBER") {
    return "No se puede eliminar: el tenant debe conservar al menos un usuario activo.";
  }
  if (code === "AUTHORIZATION_FORBIDDEN") {
    return "No tienes permiso para eliminar este usuario (no puedes eliminarte a ti mismo).";
  }
  if (code === "VALIDATION_ERROR") {
    return "No se puede eliminar al último administrador de plataforma activo.";
  }
  if (code === "NOT_FOUND" || status === 404) {
    return "El usuario ya no existe. Actualiza la lista.";
  }
  if (status === 403) {
    return "No tienes permiso para eliminar usuarios.";
  }
  return "No fue posible eliminar el usuario.";
}

/**
 * Pessimistic delete with confirmation for identity users.
 *
 * The generic undoable DeleteButton hides backend guards behind an
 * optimistic toast, so a rejected delete looks like it worked and then the
 * row "reappears". This button waits for the server and surfaces the reason
 * in Spanish, matching the pessimistic pattern used elsewhere (tenants).
 */
function UserDeleteButton({
  iconOnly = false,
  label,
  redirectTo = "list",
}: {
  iconOnly?: boolean;
  label?: string;
  redirectTo?: "list" | false;
}) {
  const translate = useTranslate();
  const t = useMessages(settingsMessages);
  const displayLabel =
    label ?? translate("savia.users.actions.delete", { _: "Eliminar usuario" });
  const record = useRecordContext<UserRecord>();
  const resource = useResourceContext() ?? "users";
  const { canAccess } = useCanAccess({
    resource,
    action: "delete",
    record,
  });
  const notify = useNotify();
  const refresh = useRefresh();
  const redirect = useRedirect();
  const queryClient = useQueryClient();
  const [deleteOne, { isPending }] = useDelete();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!canAccess || record?.id == null) return null;

  const handleConfirm = () => {
    deleteOne(
      resource,
      { id: record.id, previousData: record },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          void queryClient.invalidateQueries({
            queryKey: ["tenant-user-capacity"],
          });
          notify(
            translate("savia.users.notifications.userDeleted", {
              _: "Usuario eliminado.",
            }),
            { type: "success" },
          );
          refresh();
          if (redirectTo) redirect(redirectTo, resource);
        },
        onError: (error: unknown) => {
          setConfirmOpen(false);
          notify(t(deleteUserErrorMessage(error)), { type: "error" });
        },
      },
    );
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={iconOnly ? "icon" : "default"}
        aria-label={displayLabel}
        title={iconOnly ? displayLabel : undefined}
        disabled={isPending}
        onClick={(event) => {
          event.stopPropagation();
          setConfirmOpen(true);
        }}
        className="max-sm:size-11 cursor-pointer hover:bg-destructive/10! text-destructive! border-destructive! focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40"
      >
        <Trash2 className="size-4" />
        {iconOnly ? null : (
          <span className="sr-only sm:not-sr-only">{displayLabel}</span>
        )}
      </Button>
      <Confirm
        isOpen={confirmOpen}
        title={translate("savia.users.dialogs.deleteTitle", {
          _: "Eliminar usuario",
        })}
        content={translate("savia.users.dialogs.deleteContent", {
          name: record.displayName ?? record.email,
          _: `¿Eliminar a ${record.displayName ?? record.email}? Esta acción no se puede deshacer.`,
        })}
        confirm="ra.action.delete"
        confirmColor="warning"
        ConfirmIcon={Trash2}
        loading={isPending}
        onClose={() => {
          if (!isPending) setConfirmOpen(false);
        }}
        onConfirm={handleConfirm}
      />
    </>
  );
}

export function UserList() {
  const t = useMessages(settingsMessages);
  const translate = useTranslate();
  return (
    <List
      title={translate("savia.users.title", { _: "Usuarios" })}
      sort={{ field: "displayName", order: "ASC" }}
      filterDefaultValues={{ isActive: true }}
      filters={userFilters(t)}
      perPage={20}
      queryOptions={{ retry: false }}
      pagination={<ListPagination rowsPerPageOptions={[10, 20, 50, 100]} />}
      actions={<UserListActions />}
    >
      <UserListContent />
    </List>
  );
}

function UserListContent() {
  const t = useMessages(settingsMessages);
  const { data, error, isPending, refetch } = useListContext<UserRecord>();
  const hasUsers = Array.isArray(data) && data.length > 0;

  if (error && !isPending && !hasUsers) {
    return (
      <section
        role="alert"
        className="my-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
      >
        <p className="text-sm">
          {t(
            "No se pudo cargar el listado de usuarios. Comprueba tu conexión e inténtalo de nuevo.",
          )}
        </p>
        <Button type="button" variant="outline" onClick={() => void refetch()}>
          {t("Reintentar")}
        </Button>
      </section>
    );
  }

  return (
    <>
      <TenantUserScope />
      <UserTabbedTable />
    </>
  );
}

function TenantUserScope() {
  const t = useMessages(settingsMessages);
  const translate = useTranslate();
  const { permissions } = usePermissions<AuthPermissions>();
  const { filterValues, setFilters, displayedFilters } =
    useListContext<UserRecord>();
  const isPlatformAdmin = Boolean(permissions?.canManageIdentity);
  const tenantAdminId = tenantAdminTenantId(permissions?.memberships);
  const selectedTenantId = Number(filterValues.tenantId);
  const tenantId = isPlatformAdmin
    ? Number.isSafeInteger(selectedTenantId) && selectedTenantId >= 0
      ? selectedTenantId
      : undefined
    : tenantAdminId;
  const tenantName = useTenantName(tenantId);
  if (tenantId === undefined) return null;

  const clearTenantScope = () => {
    const { tenantId: _tenantId, ...filters } = filterValues;
    setFilters(filters, displayedFilters);
  };

  return (
    <>
      <TenantUserCapacity
        tenantId={tenantId}
        platformCanEdit={isPlatformAdmin}
      />
      <section className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {tenantName
              ? t("Users in %{name}", { name: tenantName })
              : t("Tenant users")}
            <IconButtonWithTooltip
              label={t(
                "Este listado muestra únicamente las personas asignadas a este tenant.",
              )}
              className="size-11 p-0 sm:size-5"
            >
              <Info className="size-3.5" aria-hidden="true" />
            </IconButtonWithTooltip>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tenantId > 0 && <TenantSignInSettingsLink tenantId={tenantId} />}
          {isPlatformAdmin && (
            <Button
              type="button"
              variant="outline"
              onClick={clearTenantScope}
              className="max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0"
            >
              <UsersRound aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">
                {translate("savia.users.viewAllUsers", {
                  _: "Ver todos los usuarios",
                })}
              </span>
            </Button>
          )}
        </div>
      </section>
    </>
  );
}

function UserListActions() {
  const translate = useTranslate();
  const queryClient = useQueryClient();
  useRealtimeTopics({
    topics: ["users"],
    onConnected: (reason) => {
      if (reason === "subscription-change") return;
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void queryClient.invalidateQueries({
        queryKey: ["tenant-user-capacity"],
      });
    },
    onEvent: (event) => {
      applyRealtimeListEvent(queryClient, "users", event);
      void queryClient.invalidateQueries({
        queryKey: ["tenant-user-capacity"],
      });
    },
  });
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 [&_button]:max-sm:size-11 [&_a]:max-sm:min-h-11 [&_a]:max-sm:min-w-11">
      <ExportButton
        iconOnly
        label={translate("savia.users.exportExcel", {
          _: "Exportar a Excel",
        })}
        icon={<MicrosoftExcel aria-hidden className="size-4" />}
      />
      <CreateButton
        iconOnly
        variant="default"
        label={translate("savia.users.newUser", { _: "Nuevo usuario" })}
      />
    </div>
  );
}

function UserTabbedTable() {
  const translate = useTranslate();
  const { filterValues, setFilters, displayedFilters } =
    useListContext<UserRecord>();
  const statusView = getUserStatusView(filterValues.isActive);
  const { isActive: _isActive, ...filtersWithoutStatus } = filterValues;
  const setStatus = (nextStatus: UserStatusView) => {
    setFilters(
      nextStatus === "all"
        ? filtersWithoutStatus
        : { ...filtersWithoutStatus, isActive: nextStatus === "active" },
      displayedFilters,
    );
  };

  return (
    <Tabs
      value={statusView}
      onValueChange={(value) => setStatus(value as UserStatusView)}
      className="mb-4 gap-2"
    >
      <TabsList className="group-data-[orientation=horizontal]/tabs:h-auto min-h-11 w-full flex-wrap justify-start overflow-visible [&>[role=tab]]:min-h-11">
        <TabsTrigger value="active">
          {translate("savia.users.tabs.active", { _: "Activos" })}
          <Badge variant="outline" className="hidden md:inline-flex">
            <Count filter={{ ...filtersWithoutStatus, isActive: true }} />
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="inactive">
          {translate("savia.users.tabs.inactive", { _: "Suspendidos" })}
          <Badge variant="outline" className="hidden md:inline-flex">
            <Count filter={{ ...filtersWithoutStatus, isActive: false }} />
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="all">
          {translate("savia.users.tabs.all", { _: "Todos" })}
          <Badge variant="outline" className="hidden md:inline-flex">
            <Count filter={filtersWithoutStatus} />
          </Badge>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="active">
        <UserTable storeKey={userStoreKeys.active} />
      </TabsContent>
      <TabsContent value="inactive">
        <UserTable storeKey={userStoreKeys.inactive} />
      </TabsContent>
      <TabsContent value="all">
        <UserTable storeKey={userStoreKeys.all} />
      </TabsContent>
    </Tabs>
  );
}

function UserTable({ storeKey }: { storeKey: string }) {
  const t = useMessages(settingsMessages);
  const translate = useTranslate();
  return (
    <DataTable<UserRecord>
      storeKey={storeKey}
      bulkActionButtons={false}
      rowClick="show"
    >
      <DataTable.Col
        source="displayName"
        label={translate("savia.users.fields.name", { _: "Usuario" })}
        className="font-medium"
      />
      <DataTable.Col
        source="email"
        label={translate("savia.users.fields.email", { _: "Correo" })}
        className="hidden md:table-cell"
        headerClassName="hidden md:table-cell"
      />
      <DataTable.Col
        source="platformAdmin"
        label={t("Acceso")}
        className="hidden lg:table-cell"
        headerClassName="hidden lg:table-cell"
        render={(record) => <UserAccessSummary record={record as UserRecord} />}
      />
      <DataTable.Col
        source="twoFactorEnabled"
        label="MFA"
        className="hidden xl:table-cell"
        headerClassName="hidden xl:table-cell"
        render={(record) => <MfaStatus enabled={record.twoFactorEnabled} />}
      />
      <DataTable.Col
        source="isActive"
        label={translate("savia.users.fields.status", { _: "Estado" })}
        className="hidden sm:table-cell"
        headerClassName="hidden sm:table-cell"
        render={(record) => <UserStatus active={record.isActive} />}
      />
      <DataTable.Col
        label={translate("savia.tenants.table.actions", { _: "Acciones" })}
        disableSort
        className="w-px whitespace-nowrap"
        headerClassName="w-px text-right"
      >
        <div
          className="flex justify-end gap-2 py-1 [&_button]:max-sm:size-11"
          onClick={(event) => event.stopPropagation()}
        >
          <ShowButton iconOnly />
          <EditButton iconOnly />
          <UserDeleteButton iconOnly redirectTo={false} />
        </div>
      </DataTable.Col>
    </DataTable>
  );
}

export function UserCreate() {
  const translate = useTranslate();
  const { permissions, isPending } = usePermissions<AuthPermissions>();
  const scope = userCreateScope(permissions);
  const { platformCanEdit, tenantId } = scope;
  if (isPending)
    return <p role="status">{translate("savia.users.loadingPermissions")}</p>;
  if (!platformCanEdit && tenantId === undefined)
    return <p role="alert">{translate("savia.users.tenantAdminRequired")}</p>;

  return (
    <Create title={translate("savia.users.newUser", { _: "Nuevo usuario" })}>
      <SimpleForm
        className="max-w-5xl gap-8"
        defaultValues={scope.defaultValues}
      >
        <UserIdentityFields />
        <UserInitialAccessFields
          tenantAdminTenantId={tenantId}
          platformCanEdit={platformCanEdit}
        />
        <UserCreateCapacity
          tenantAdminTenantId={tenantId}
          platformCanEdit={platformCanEdit}
        />
      </SimpleForm>
    </Create>
  );
}

function UserCreateCapacity({
  tenantAdminTenantId: ownTenantId,
  platformCanEdit,
}: {
  tenantAdminTenantId?: number;
  platformCanEdit: boolean;
}) {
  const formTenantId = useWatch({ name: "tenantId" });
  const parsedTenantId = Number(formTenantId);
  return (
    <TenantUserCapacity
      tenantId={
        platformCanEdit
          ? Number.isSafeInteger(parsedTenantId) && parsedTenantId > 0
            ? parsedTenantId
            : undefined
          : ownTenantId
      }
      platformCanEdit={platformCanEdit}
    />
  );
}

export function UserEdit() {
  const translate = useTranslate();
  const { permissions } = usePermissions<AuthPermissions>();
  const platformCanEdit = Boolean(permissions?.canManageIdentity);
  return (
    <Edit
      title={<UserEditTitle />}
      actions={<UserEditActions />}
      mutationMode="optimistic"
      transform={platformCanEdit ? undefined : tenantAdminUserUpdateData}
    >
      <SimpleForm
        className="max-w-5xl gap-6"
        resetOptions={{ keepDirtyValues: true }}
      >
        <ResourceEditSync resource="users" />
        <Tabs defaultValue="identity" className="w-full gap-6">
          <div className="max-w-full overflow-x-auto">
            <TabsList
              aria-label={translate("savia.users.tabs.ariaLabel", {
                _: "Configuración del usuario",
              })}
              className="[&>[role=tab]]:min-h-11"
            >
              <TabsTrigger value="identity">
                {translate("savia.users.tabs.identity", { _: "Identidad" })}
              </TabsTrigger>
              {platformCanEdit && (
                <>
                  <TabsTrigger value="access">
                    {translate("savia.users.tabs.access", {
                      _: "Acceso de plataforma",
                    })}
                  </TabsTrigger>
                  <TabsTrigger value="tenant">
                    {translate("savia.users.tabs.tenant", {
                      _: "Tenant asignado",
                    })}
                  </TabsTrigger>
                </>
              )}
            </TabsList>
          </div>
          <TabsContent
            value="identity"
            forceMount
            className="data-[state=inactive]:hidden"
          >
            <UserIdentityFields edit />
          </TabsContent>
          {platformCanEdit && (
            <>
              <TabsContent
                value="access"
                forceMount
                className="data-[state=inactive]:hidden"
              >
                <UserPlatformAccessFields />
              </TabsContent>
              <TabsContent
                value="tenant"
                forceMount
                className="data-[state=inactive]:hidden"
              >
                <UserMembershipEditor />
              </TabsContent>
            </>
          )}
        </Tabs>
      </SimpleForm>
    </Edit>
  );
}

function UserEditTitle() {
  const { record } = useEditContext<UserRecord>();
  const translate = useTranslate();
  return (
    <>
      <span className="block text-sm font-medium text-muted-foreground">
        {translate("savia.users.editUser", { _: "Editar usuario" })}
      </span>
      <span className="mt-1 block">{record?.displayName}</span>
    </>
  );
}

function UserEditActions() {
  const translate = useTranslate();
  return (
    <div className="flex flex-wrap justify-end gap-2 [&_button]:max-sm:size-11 [&_a]:max-sm:min-h-11 [&_a]:max-sm:min-w-11">
      <ShowButton
        iconOnly
        label={translate("savia.users.actions.showCard", { _: "Ver ficha" })}
      />
      <UserDeleteButton
        iconOnly
        label={translate("savia.users.actions.delete", {
          _: "Eliminar usuario",
        })}
      />
    </div>
  );
}

export function UserShow() {
  return (
    <Show title={<UserShowTitle />} actions={<UserShowActions />}>
      <ResourceReadSync resource="users" />
      <UserShowContent />
    </Show>
  );
}

function UserShowTitle() {
  const { record } = useShowContext<UserRecord>();
  const translate = useTranslate();
  return (
    <>
      <span className="block text-sm font-medium text-muted-foreground">
        {translate("savia.users.userDetails", { _: "Ficha de usuario" })}
      </span>
      <span className="mt-1 block">{record?.displayName}</span>
    </>
  );
}

function UserShowActions() {
  const translate = useTranslate();
  return (
    <div className="flex flex-wrap justify-end gap-2 [&_button]:max-sm:size-11 [&_a]:max-sm:min-h-11 [&_a]:max-sm:min-w-11">
      <EditButton
        iconOnly
        label={translate("savia.users.editUser", { _: "Editar usuario" })}
      />
      <UserDeleteButton
        iconOnly
        label={translate("savia.users.actions.delete", {
          _: "Eliminar usuario",
        })}
      />
    </div>
  );
}

function UserShowContent() {
  const t = useMessages(settingsMessages);
  const { record } = useShowContext<UserRecord>();
  const translate = useTranslate();
  if (!record) return null;

  return (
    <div className="max-w-5xl space-y-5">
      <UserSection
        title={translate("savia.users.sections.identity", { _: "Identidad" })}
        description={translate("savia.users.sections.identityDetailsDesc", {
          _: "Datos que identifican la cuenta y su acceso a Savia.",
        })}
      >
        <UserReadOnlyField
          label={translate("savia.users.fields.name", { _: "Nombre" })}
          value={record.displayName}
        />
        <UserReadOnlyField
          label={translate("savia.users.fields.email", { _: "Correo" })}
          value={
            <span className="grid gap-1">
              {record.email}
              <span className="text-sm text-muted-foreground">
                <EmailVerificationStatus verified={record.emailVerified} />
              </span>
            </span>
          }
        />
        <UserReadOnlyField
          label={translate("savia.users.fields.platformRole", {
            _: "Rol de plataforma",
          })}
          value={
            record.platformAdmin
              ? translate("savia.users.fields.platformAdmin", {
                  _: "Administrador de plataforma",
                })
              : translate("savia.users.fields.noGlobalAccess", {
                  _: "Sin acceso global",
                })
          }
        />
        <UserReadOnlyField
          label={translate("savia.users.fields.status", { _: "Estado" })}
          value={<UserStatus active={record.isActive} />}
        />
      </UserSection>
      <UserSection
        title={translate("savia.users.sections.assignedTenant", {
          _: "Tenant asignado",
        })}
        description={translate("savia.users.sections.assignedRoleDesc", {
          _: "El rol se aplica dentro del tenant asignado.",
        })}
      >
        {record.memberships.length === 0 ? (
          <p className="text-sm text-muted-foreground md:col-span-2">
            {translate("savia.users.noTenantAssigned", {
              _: "No tiene tenant asignado.",
            })}
          </p>
        ) : (
          record.memberships
            .slice(0, 1)
            .map((membership) => (
              <UserReadOnlyField
                key={membership.id}
                label={t("Tenant #%{value}", { value: membership.tenantId })}
                value={tenantRoleName(membership.role, translate)}
              />
            ))
        )}
      </UserSection>
      <UserSection
        title={translate("savia.users.sections.security", { _: "Seguridad" })}
        description={translate("savia.users.sections.securityDesc", {
          _: "La MFA se gestiona desde la cuenta del usuario; el administrador puede ver su estado.",
        })}
      >
        <UserReadOnlyField
          label={translate("savia.users.fields.mfa", {
            _: "Autenticación multifactor",
          })}
          value={<MfaStatus enabled={record.twoFactorEnabled} />}
        />
        <UserReadOnlyField
          label={translate("savia.users.fields.sessions", { _: "Sesiones" })}
          value={translate("savia.users.fields.sessionsHelper", {
            _: "Puedes cerrarlas desde las acciones de cuenta.",
          })}
        />
      </UserSection>
      <UserAccountActions record={record} />
    </div>
  );
}

function UserIdentityFields({ edit = false }: { edit?: boolean }) {
  const translate = useTranslate();
  return (
    <UserSection
      title={translate("savia.users.sections.identity", { _: "Identidad" })}
      description={
        edit
          ? translate("savia.users.sections.identityEditDesc", {
              _: "Actualiza el nombre de la persona. El correo se conserva como identificador de acceso.",
            })
          : translate("savia.users.sections.identityCreateDesc", {
              _: "Puedes enviar un enlace seguro o definir una contraseña temporal para el primer ingreso.",
            })
      }
    >
      <TextInput
        source="firstName"
        label={translate("savia.users.fields.firstName", { _: "Nombres" })}
        validate={requiredField}
      />
      <TextInput
        source="lastName"
        label={translate("savia.users.fields.lastName", { _: "Apellidos" })}
        validate={requiredField}
      />
      <TextInput
        source="email"
        label={translate("savia.users.fields.email", { _: "Correo" })}
        type="email"
        readOnly={edit}
        validate={edit ? undefined : requiredField}
        className="md:col-span-2"
      />
      <EmailVerificationField />
    </UserSection>
  );
}

function UserInitialAccessFields({
  tenantAdminTenantId: ownTenantId,
  platformCanEdit,
}: {
  tenantAdminTenantId?: number;
  platformCanEdit: boolean;
}) {
  const translate = useTranslate();
  return (
    <UserSection
      title={translate("savia.users.sections.initialAccess", {
        _: "Acceso inicial",
      })}
      description={
        platformCanEdit
          ? translate("savia.users.sections.initialAccessDesc", {
              _: "Asigna el tenant comercial del usuario o conviértelo en administrador de plataforma.",
            })
          : translate("savia.users.sections.tenantInitialAccessDesc", {
              _: "El usuario se creará en tu tenant. Puedes elegir su rol dentro del tenant.",
            })
      }
    >
      <TextInput
        source="temporaryPassword"
        label={translate("savia.users.fields.temporaryPassword", {
          _: "Contraseña temporal",
        })}
        type="password"
        autoComplete="new-password"
        helperText={translate("savia.tenants.fields.temporaryPasswordHelper", {
          _: "Opcional. Si se deja vacía, se enviará un enlace para definirla.",
        })}
        className="md:col-span-2"
      />
      {platformCanEdit ? (
        <>
          <BooleanInput
            source="platformAdmin"
            label={translate("savia.users.fields.platformAdmin", {
              _: "Administrador de plataforma",
            })}
            helperText={translate("savia.users.fields.platformAdminHelper", {
              _: "Puede administrar usuarios, roles y toda la operación.",
            })}
            className="md:col-span-2"
          />
          <CommercialTenantInput
            label={translate("savia.users.fields.commercialTenant", {
              _: "Tenant comercial",
            })}
          />
        </>
      ) : (
        <TextInput
          source="tenantId"
          type="number"
          readOnly
          label={translate("savia.users.fields.tenant", { _: "Tenant" })}
          helperText={translate("savia.users.fields.fixedTenantHelper", {
            id: ownTenantId,
            _: `This user will be assigned to tenant #${ownTenantId}.`,
          })}
        />
      )}
      <SelectInput
        source="agencyRole"
        label={translate("savia.users.fields.tenantRole", {
          _: "Rol en el tenant",
        })}
        choices={getTenantRoleChoices(translate)}
      />
      <UserAccessRoles />
    </UserSection>
  );
}

function UserPlatformAccessFields() {
  const translate = useTranslate();
  return (
    <UserSection
      title={translate("savia.users.sections.platformAccess", {
        _: "Acceso de plataforma",
      })}
      description={translate("savia.users.sections.platformAccessDesc", {
        _: "Los administradores de plataforma pueden gestionar toda Savia.",
      })}
    >
      <BooleanInput
        source="platformAdmin"
        label={translate("savia.users.fields.platformAdmin", {
          _: "Administrador de plataforma",
        })}
        helperText={translate("savia.users.fields.platformAdminRemoveHelper", {
          _: "Al retirarlo, selecciona abajo el tenant comercial y el rol que conservará el usuario.",
        })}
        className="md:col-span-2"
      />
      <CommercialTenantInput
        label={translate("savia.users.fields.commercialTenantRemove", {
          _: "Tenant comercial al retirar acceso global",
        })}
      />
      <SelectInput
        source="agencyRole"
        label={translate("savia.users.fields.tenantRoleRemove", {
          _: "Rol al retirar acceso global",
        })}
        choices={getTenantRoleChoices(translate)}
      />
    </UserSection>
  );
}

function CommercialTenantInput({ label }: { label: string }) {
  return (
    <ReferenceInput
      source="tenantId"
      reference="tenants"
      perPage={100}
      filter={{ kind: "commercial" }}
    >
      <CommercialTenantChoiceInput label={label} />
    </ReferenceInput>
  );
}

function CommercialTenantChoiceInput({ label }: { label: string }) {
  const { allChoices = [] } = useChoicesContext();
  const tenants = allChoices as TenantRecord[];
  const { register, setValue } = useFormContext();

  useEffect(() => {
    if (tenants.length === 1) {
      setValue("tenantId", tenants[0].id, {
        shouldDirty: false,
        shouldTouch: false,
      });
    }
  }, [setValue, tenants]);

  if (tenants.length === 1) {
    return (
      <input type="hidden" {...register("tenantId", { valueAsNumber: true })} />
    );
  }

  return <SelectInput label={label} />;
}

function UserMembershipEditor() {
  const t = useMessages(settingsMessages);
  const { record } = useEditContext<UserRecord>();
  const dataProvider = useDataProvider() as IdentityUserDataProvider;
  const notify = useNotify();
  const refresh = useRefresh();
  const translate = useTranslate();
  const [tenantId, setTenantId] = useState("");
  const [role, setRole] = useState<AgencyAccessRole>("viewer");
  const [pending, setPending] = useState(false);
  const { data: tenants = [] } = useGetList<TenantRecord>("tenants", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "name", order: "ASC" },
    filter: { kind: "commercial" },
  });

  useEffect(() => {
    const savedRole = record?.memberships[0]?.role;
    setRole(
      savedRole === "agency_admin" ? "tenant_admin" : (savedRole ?? "viewer"),
    );
    setTenantId(
      record?.memberships[0] ? String(record.memberships[0].tenantId) : "",
    );
  }, [record?.id, record?.memberships[0]?.role]);

  useEffect(() => {
    if (tenants.length === 1 && tenantId !== String(tenants[0].id)) {
      setTenantId(String(tenants[0].id));
    }
  }, [tenantId, tenants]);

  if (!record) return null;

  const transferMembership = async () => {
    const selectedTenantId = Number(tenantId);
    if (!Number.isSafeInteger(selectedTenantId) || selectedTenantId < 1) {
      notify(
        translate("savia.users.notifications.selectTenant", {
          _: "Selecciona un tenant.",
        }),
        { type: "warning" },
      );
      return;
    }
    setPending(true);
    try {
      await dataProvider.grantMembership(record.id, {
        tenantId: selectedTenantId,
        role,
      });
      setTenantId("");
      notify(
        translate("savia.users.notifications.tenantUpdated", {
          _: "Asignación de tenant actualizada.",
        }),
        { type: "success" },
      );
      refresh();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("savia.users.notifications.updateAccessError", {
              _: "No fue posible actualizar el acceso.",
            }),
        {
          type: "error",
        },
      );
    } finally {
      setPending(false);
    }
  };

  const roleChoices = getTenantRoleChoices(translate);

  return (
    <UserSection
      title={translate("savia.users.sections.assignedTenant", {
        _: "Tenant asignado",
      })}
      description={translate("savia.users.sections.assignedTenantDesc", {
        _: "Cada usuario pertenece a un tenant. Usa la transferencia para cambiarlo sin dejarlo sin acceso.",
      })}
    >
      <div className="space-y-3 md:col-span-2">
        {record.memberships.slice(0, 1).map((membership) => (
          <div
            key={membership.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2"
          >
            <div className="text-sm">
              <span className="font-medium">
                {t("Tenant #%{value}", { value: membership.tenantId })}
              </span>
              <span className="ml-2 text-muted-foreground">
                {tenantRoleName(membership.role, translate)}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-3 rounded-lg border p-3 md:col-span-2 md:grid-cols-[1fr_220px_auto] md:items-end">
        <label className="grid gap-2 text-sm font-medium">
          {translate("savia.users.fields.tenant", { _: "Tenant" })}
          {tenants.length === 1 ? (
            <span className="rounded-md border px-3 py-2 font-normal">
              {tenants[0].name}
            </span>
          ) : (
            <Select
              value={tenantId}
              onValueChange={setTenantId}
              disabled={pending}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={translate(
                    "savia.users.fields.selectTenantPlaceholder",
                    { _: "Selecciona un tenant" },
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((tenant) => (
                  <SelectItem key={tenant.id} value={String(tenant.id)}>
                    {tenant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </label>
        <label className="grid gap-2 text-sm font-medium">
          {translate("savia.users.fields.role", { _: "Rol" })}
          <Select
            value={role}
            onValueChange={(value) => {
              const choice = roleChoices.find(
                (candidate) => candidate.id === value,
              );
              if (choice) setRole(choice.id);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roleChoices.map((choice) => (
                <SelectItem key={choice.id} value={choice.id}>
                  {choice.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <Button
          type="button"
          disabled={pending}
          onClick={() => void transferMembership()}
          className="max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0"
        >
          <Plus className="size-4" />
          <span className="sr-only sm:not-sr-only">
            {record.memberships.length
              ? translate("savia.users.actions.transfer", {
                  _: "Transferir usuario",
                })
              : translate("savia.users.actions.assignTenant", {
                  _: "Asignar tenant",
                })}
          </span>
        </Button>
      </div>
    </UserSection>
  );
}

function UserAccountActions({ record }: { record: UserRecord }) {
  const dataProvider = useDataProvider() as IdentityUserDataProvider;
  const notify = useNotify();
  const refresh = useRefresh();
  const queryClient = useQueryClient();
  const translate = useTranslate();
  const [pending, setPending] = useState<string | null>(null);

  const run = async (
    key: string,
    action: () => Promise<void>,
    message: string,
  ) => {
    setPending(key);
    try {
      await action();
      if (key === "status") {
        void queryClient.invalidateQueries({
          queryKey: ["tenant-user-capacity"],
        });
      }
      notify(message, { type: "success" });
      refresh();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("savia.users.notifications.actionError", {
              _: "No fue posible completar la acción.",
            }),
        {
          type: "error",
        },
      );
    } finally {
      setPending(null);
    }
  };

  const suspended = !record.isActive || record.isBanned;
  return (
    <UserSection
      title={translate("savia.users.sections.accountActions", {
        _: "Acciones de cuenta",
      })}
      description={translate("savia.users.sections.accountActionsDesc", {
        _: "Estas acciones no modifican la contraseña ni desactivan MFA de otra persona.",
      })}
    >
      <div className="flex flex-wrap gap-2 md:col-span-2">
        <Button
          type="button"
          variant="outline"
          className="max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0"
          disabled={pending !== null}
          onClick={() =>
            void run(
              "reset",
              () => dataProvider.sendPasswordReset(record.id),
              translate("savia.users.notifications.passwordResetSent", {
                _: "Enlace de restablecimiento enviado.",
              }),
            )
          }
        >
          <KeyRound className="size-4" />
          <span className="sr-only sm:not-sr-only">
            {translate("savia.users.actions.resendPassword", {
              _: "Reenviar contraseña",
            })}
          </span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0"
          disabled={pending !== null}
          onClick={() =>
            void run(
              "sessions",
              () => dataProvider.revokeSessions(record.id),
              translate("savia.users.notifications.sessionsRevoked", {
                _: "Sesiones cerradas.",
              }),
            )
          }
        >
          <LogOut className="size-4" />
          <span className="sr-only sm:not-sr-only">
            {translate("savia.users.actions.revokeSessions", {
              _: "Cerrar sesiones",
            })}
          </span>
        </Button>
        <Button
          type="button"
          variant={suspended ? "outline" : "destructive"}
          className="max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0"
          disabled={pending !== null}
          onClick={() =>
            void run(
              "status",
              () =>
                suspended
                  ? dataProvider.reactivate(record.id)
                  : dataProvider.suspend(record.id),
              suspended
                ? translate("savia.users.notifications.userReactivated", {
                    _: "Usuario reactivado.",
                  })
                : translate("savia.users.notifications.userSuspended", {
                    _: "Usuario suspendido.",
                  }),
            )
          }
        >
          {suspended ? (
            <RotateCcw className="size-4" />
          ) : (
            <Ban className="size-4" />
          )}
          <span className="sr-only sm:not-sr-only">
            {suspended
              ? translate("savia.users.actions.reactivate", {
                  _: "Reactivar usuario",
                })
              : translate("savia.users.actions.suspend", {
                  _: "Suspender usuario",
                })}
          </span>
        </Button>
      </div>
    </UserSection>
  );
}

function UserSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-6 grid gap-5 md:grid-cols-2">{children}</div>
    </section>
  );
}

function UserReadOnlyField({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value ?? "—"}</dd>
    </div>
  );
}

function useTenantName(tenantId: number | undefined) {
  const { data } = useGetOne<TenantRecord>(
    "tenants",
    { id: tenantId },
    { enabled: tenantId !== undefined },
  );
  return data && data.id === tenantId ? data.name?.trim() : undefined;
}

function UserAccessSummary({ record }: { record: UserRecord }) {
  const translate = useTranslate();
  const tenantName = useTenantName(
    record.platformAdmin ? undefined : record.memberships[0]?.tenantId,
  );
  if (record.platformAdmin)
    return (
      <Badge>
        {translate("savia.users.badges.platform", { _: "Plataforma" })}
      </Badge>
    );
  if (record.memberships.length === 0)
    return (
      <span className="text-muted-foreground">
        {translate("savia.users.badges.noAccess", { _: "Sin acceso" })}
      </span>
    );
  return <span>{tenantName || "—"}</span>;
}

function UserStatus({ active }: { active: boolean }) {
  const translate = useTranslate();
  return active ? (
    <Badge>{translate("savia.users.status.active", { _: "Activo" })}</Badge>
  ) : (
    <Badge variant="secondary">
      {translate("savia.users.status.suspended", { _: "Suspendido" })}
    </Badge>
  );
}

function MfaStatus({ enabled }: { enabled: boolean }) {
  const translate = useTranslate();
  return enabled ? (
    <span className="inline-flex items-center gap-1.5 text-sm text-primary">
      <ShieldCheck className="size-4" />{" "}
      {translate("savia.users.mfa.active", { _: "Activa" })}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <ShieldOff className="size-4" />{" "}
      {translate("savia.users.mfa.inactive", { _: "No activa" })}
    </span>
  );
}

function getTenantRoleChoices(
  translate: (key: string, options?: any) => string,
): { id: AgencyAccessRole; name: string }[] {
  return [
    {
      id: "tenant_admin",
      name: translate("savia.users.roles.tenant_admin", {
        _: "Administrador de tenant",
      }),
    },
    {
      id: "operator",
      name: translate("savia.users.roles.operator", { _: "Operador" }),
    },
    {
      id: "viewer",
      name: translate("savia.users.roles.viewer", { _: "Solo lectura" }),
    },
  ];
}

function tenantRoleName(
  role: AgencyAccessRole,
  translate?: (key: string, options?: any) => string,
): string {
  const normalizedRole = role === "agency_admin" ? "tenant_admin" : role;
  if (translate) {
    const key = `savia.users.roles.${normalizedRole}`;
    const fallback =
      tenantRoleChoices.find((choice) => choice.id === normalizedRole)?.name ??
      role;
    return translate(key, { _: fallback });
  }
  return (
    tenantRoleChoices.find((choice) => choice.id === normalizedRole)?.name ??
    role
  );
}
