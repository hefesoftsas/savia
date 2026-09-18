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
} from "lucide-react";
import {
  required,
  useCanAccess,
  useDataProvider,
  useDelete,
  useEditContext,
  useGetList,
  useListContext,
  useNotify,
  useRecordContext,
  useRedirect,
  useRefresh,
  useResourceContext,
  useShowContext,
} from "ra-core";
import MicrosoftExcel from "@thesvg/react/microsoft-excel";
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
  ReferenceInput,
  SelectInput,
  Show,
  ShowButton,
  SimpleForm,
  TextInput,
} from "@/components/admin";
import { Confirm } from "@/components/admin/confirm";
import { isOfflineError } from "@/offline/offline-error";
import type { TenantRecord } from "@/api/tenant-data-provider";
import type {
  IdentityUserDataProvider,
  UserRecord,
} from "@/api/identity-user-data-provider";
import type { AgencyAccessRole } from "@/api/identity-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const requiredField = required("Este campo es obligatorio.");

const tenantRoleChoices: { id: AgencyAccessRole; name: string }[] = [
  { id: "tenant_admin", name: "Administrador de tenant" },
  { id: "operator", name: "Operador" },
  { id: "viewer", name: "Solo lectura" },
];

const userFilters = [
  <TextInput
    key="q"
    source="q"
    label={false}
    alwaysOn
    placeholder="Buscar por usuario o correo…"
    inputClassName="w-full sm:w-72"
  />,
];

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

export function deleteUserErrorMessage(error: unknown): string {
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
  label = "Eliminar usuario",
  redirectTo = "list",
}: {
  iconOnly?: boolean;
  label?: string;
  redirectTo?: "list" | false;
}) {
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
          notify("Usuario eliminado.", { type: "success" });
          refresh();
          if (redirectTo) redirect(redirectTo, resource);
        },
        onError: (error: unknown) => {
          setConfirmOpen(false);
          notify(deleteUserErrorMessage(error), { type: "error" });
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
        aria-label={label}
        title={iconOnly ? label : undefined}
        disabled={isPending}
        onClick={(event) => {
          event.stopPropagation();
          setConfirmOpen(true);
        }}
        className="cursor-pointer hover:bg-destructive/10! text-destructive! border-destructive! focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40"
      >
        <Trash2 className="size-4" />
        {iconOnly ? null : label}
      </Button>
      <Confirm
        isOpen={confirmOpen}
        title="Eliminar usuario"
        content={`¿Eliminar a ${record.displayName ?? record.email}? Esta acción no se puede deshacer.`}
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
  return (
    <List
      title="Usuarios"
      sort={{ field: "displayName", order: "ASC" }}
      filterDefaultValues={{ isActive: true }}
      filters={userFilters}
      perPage={20}
      actions={<UserListActions />}
    >
      <TenantUserScope />
      <UserTabbedTable />
    </List>
  );
}

function TenantUserScope() {
  const { filterValues, setFilters, displayedFilters } =
    useListContext<UserRecord>();
  const tenantId = Number(filterValues.tenantId);
  if (!Number.isSafeInteger(tenantId) || tenantId < 0) return null;

  const clearTenantScope = () => {
    const { tenantId: _tenantId, ...filters } = filterValues;
    setFilters(filters, displayedFilters);
  };

  return (
    <section className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-3">
      <div>
        <p className="font-medium">Usuarios del tenant #{tenantId}</p>
        <p className="text-sm text-muted-foreground">
          Este listado muestra únicamente las personas asignadas a este tenant.
        </p>
      </div>
      <Button type="button" variant="outline" onClick={clearTenantScope}>
        Ver todos los usuarios
      </Button>
    </section>
  );
}

function UserListActions() {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <ExportButton
        iconOnly
        label="Exportar a Excel"
        icon={<MicrosoftExcel aria-hidden className="size-4" />}
      />
      <CreateButton
        iconOnly
        variant="default"
        label="Nuevo usuario"
      />
    </div>
  );
}

function UserTabbedTable() {
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
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="active">
          Activos
          <Badge variant="outline" className="hidden md:inline-flex">
            <Count filter={{ ...filtersWithoutStatus, isActive: true }} />
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="inactive">
          Suspendidos
          <Badge variant="outline" className="hidden md:inline-flex">
            <Count filter={{ ...filtersWithoutStatus, isActive: false }} />
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="all">
          Todos
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
  return (
    <DataTable<UserRecord>
      storeKey={storeKey}
      bulkActionButtons={false}
      rowClick="show"
    >
      <DataTable.Col
        source="displayName"
        label="Usuario"
        className="font-medium"
      />
      <DataTable.Col
        source="email"
        label="Correo"
        className="hidden md:table-cell"
        headerClassName="hidden md:table-cell"
      />
      <DataTable.Col
        source="platformAdmin"
        label="Acceso"
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
        label="Estado"
        className="hidden sm:table-cell"
        headerClassName="hidden sm:table-cell"
        render={(record) => <UserStatus active={record.isActive} />}
      />
      <DataTable.Col
        label="Acciones"
        disableSort
        className="w-px whitespace-nowrap"
        headerClassName="w-px text-right"
      >
        <div
          className="flex justify-end gap-2 py-1"
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
  return (
    <Create title="Nuevo usuario">
      <SimpleForm
        className="max-w-5xl gap-8"
        defaultValues={{ platformAdmin: false, agencyRole: "viewer" }}
      >
        <UserIdentityFields />
        <UserInitialAccessFields />
      </SimpleForm>
    </Create>
  );
}

export function UserEdit() {
  return (
    <Edit
      title={<UserEditTitle />}
      actions={<UserEditActions />}
      mutationMode="optimistic"
    >
      <SimpleForm className="max-w-5xl gap-6">
        <Tabs defaultValue="identity" className="w-full gap-6">
          <div className="max-w-full overflow-x-auto">
            <TabsList aria-label="Configuración del usuario">
              <TabsTrigger value="identity">Identidad</TabsTrigger>
              <TabsTrigger value="access">Acceso de plataforma</TabsTrigger>
              <TabsTrigger value="tenant">Tenant asignado</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="identity" forceMount className="data-[state=inactive]:hidden">
            <UserIdentityFields edit />
          </TabsContent>
          <TabsContent value="access" forceMount className="data-[state=inactive]:hidden">
            <UserPlatformAccessFields />
          </TabsContent>
          <TabsContent value="tenant" forceMount className="data-[state=inactive]:hidden">
            <UserMembershipEditor />
          </TabsContent>
        </Tabs>
      </SimpleForm>
    </Edit>
  );
}

function UserEditTitle() {
  const { record } = useEditContext<UserRecord>();
  return (
    <>
      <span className="block text-sm font-medium text-muted-foreground">
        Editar usuario
      </span>
      <span className="mt-1 block">{record?.displayName}</span>
    </>
  );
}

function UserEditActions() {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <ShowButton iconOnly label="Ver ficha" />
      <UserDeleteButton iconOnly label="Eliminar usuario" />
    </div>
  );
}

export function UserShow() {
  return (
    <Show title={<UserShowTitle />} actions={<UserShowActions />}>
      <UserShowContent />
    </Show>
  );
}

function UserShowTitle() {
  const { record } = useShowContext<UserRecord>();
  return (
    <>
      <span className="block text-sm font-medium text-muted-foreground">
        Ficha de usuario
      </span>
      <span className="mt-1 block">{record?.displayName}</span>
    </>
  );
}

function UserShowActions() {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <EditButton iconOnly label="Editar usuario" />
      <UserDeleteButton iconOnly label="Eliminar usuario" />
    </div>
  );
}

function UserShowContent() {
  const { record } = useShowContext<UserRecord>();
  if (!record) return null;

  return (
    <div className="max-w-5xl space-y-5">
      <UserSection
        title="Identidad"
        description="Datos que identifican la cuenta y su acceso a Savia."
      >
        <UserReadOnlyField label="Nombre" value={record.displayName} />
        <UserReadOnlyField label="Correo" value={record.email} />
        <UserReadOnlyField
          label="Rol de plataforma"
          value={
            record.platformAdmin
              ? "Administrador de plataforma"
              : "Sin acceso global"
          }
        />
        <UserReadOnlyField
          label="Estado"
          value={<UserStatus active={record.isActive} />}
        />
      </UserSection>
      <UserSection
        title="Tenant asignado"
        description="El rol se aplica dentro del tenant asignado."
      >
        {record.memberships.length === 0 ? (
          <p className="text-sm text-muted-foreground md:col-span-2">
            No tiene tenant asignado.
          </p>
        ) : (
          record.memberships.slice(0, 1).map((membership) => (
            <UserReadOnlyField
              key={membership.id}
              label={`Tenant #${membership.tenantId}`}
              value={tenantRoleName(membership.role)}
            />
          ))
        )}
      </UserSection>
      <UserSection
        title="Seguridad"
        description="La MFA se gestiona desde la cuenta del usuario; el administrador puede ver su estado."
      >
        <UserReadOnlyField
          label="Autenticación multifactor"
          value={<MfaStatus enabled={record.twoFactorEnabled} />}
        />
        <UserReadOnlyField
          label="Sesiones"
          value="Puedes cerrarlas desde las acciones de cuenta."
        />
      </UserSection>
      <UserAccountActions record={record} />
    </div>
  );
}

function UserIdentityFields({ edit = false }: { edit?: boolean }) {
  return (
    <UserSection
      title="Identidad"
      description={
        edit
          ? "Actualiza el nombre de la persona. El correo se conserva como identificador de acceso."
          : "Puedes enviar un enlace seguro o definir una contraseña temporal para el primer ingreso."
      }
    >
      <TextInput source="firstName" label="Nombres" validate={requiredField} />
      <TextInput source="lastName" label="Apellidos" validate={requiredField} />
      <TextInput
        source="email"
        label="Correo"
        type="email"
        readOnly={edit}
        validate={edit ? undefined : requiredField}
        className="md:col-span-2"
      />
    </UserSection>
  );
}

function UserInitialAccessFields() {
  return (
    <UserSection
      title="Acceso inicial"
      description="Asigna el tenant comercial del usuario o conviértelo en administrador de plataforma."
    >
      <TextInput
        source="temporaryPassword"
        label="Contraseña temporal"
        type="password"
        autoComplete="new-password"
        helperText="Opcional. Si se deja vacía, se enviará un enlace para definirla."
        className="md:col-span-2"
      />
      <BooleanInput
        source="platformAdmin"
        label="Administrador de plataforma"
        helperText="Puede administrar usuarios, roles y toda la operación."
        className="md:col-span-2"
      />
      <ReferenceInput
        source="tenantId"
        reference="tenants"
        perPage={100}
        filter={{ kind: "commercial" }}
      >
        <SelectInput label="Tenant comercial" />
      </ReferenceInput>
      <SelectInput
        source="agencyRole"
        label="Rol en el tenant"
        choices={tenantRoleChoices}
      />
    </UserSection>
  );
}

function UserPlatformAccessFields() {
  return (
    <UserSection
      title="Acceso de plataforma"
      description="Los administradores de plataforma pueden gestionar toda Savia."
    >
      <BooleanInput
        source="platformAdmin"
        label="Administrador de plataforma"
        helperText="Al retirarlo, selecciona abajo el tenant comercial y el rol que conservará el usuario."
        className="md:col-span-2"
      />
      <ReferenceInput
        source="tenantId"
        reference="tenants"
        perPage={100}
        filter={{ kind: "commercial" }}
      >
        <SelectInput label="Tenant comercial al retirar acceso global" />
      </ReferenceInput>
      <SelectInput
        source="agencyRole"
        label="Rol al retirar acceso global"
        choices={tenantRoleChoices}
      />
    </UserSection>
  );
}

function UserMembershipEditor() {
  const { record } = useEditContext<UserRecord>();
  const dataProvider = useDataProvider() as IdentityUserDataProvider;
  const notify = useNotify();
  const refresh = useRefresh();
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
    setRole(savedRole === "agency_admin" ? "tenant_admin" : savedRole ?? "viewer");
    setTenantId(record?.memberships[0] ? String(record.memberships[0].tenantId) : "");
  }, [record?.id, record?.memberships[0]?.role]);

  if (!record) return null;

  const transferMembership = async () => {
    const selectedTenantId = Number(tenantId);
    if (!Number.isSafeInteger(selectedTenantId) || selectedTenantId < 1) {
      notify("Selecciona un tenant.", { type: "warning" });
      return;
    }
    setPending(true);
    try {
      await dataProvider.grantMembership(record.id, {
        tenantId: selectedTenantId,
        role,
      });
      setTenantId("");
      notify("Asignación de tenant actualizada.", { type: "success" });
      refresh();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "No fue posible actualizar el acceso.",
        {
          type: "error",
        },
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <UserSection
      title="Tenant asignado"
      description="Cada usuario pertenece a un tenant. Usa la transferencia para cambiarlo sin dejarlo sin acceso."
    >
      <div className="space-y-3 md:col-span-2">
        {record.memberships.slice(0, 1).map((membership) => (
          <div
            key={membership.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2"
          >
            <div className="text-sm">
              <span className="font-medium">Tenant #{membership.tenantId}</span>
              <span className="ml-2 text-muted-foreground">
                {tenantRoleName(membership.role)}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-3 rounded-lg border p-3 md:col-span-2 md:grid-cols-[1fr_220px_auto] md:items-end">
        <label className="grid gap-2 text-sm font-medium">
          Tenant
          <Select value={tenantId} onValueChange={setTenantId} disabled={pending}>
            <SelectTrigger>
              <SelectValue placeholder="Selecciona un tenant" />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((tenant) => (
                <SelectItem key={tenant.id} value={String(tenant.id)}>
                  {tenant.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Rol
          <Select
            value={role}
            onValueChange={(value) => {
              const choice = tenantRoleChoices.find((candidate) => candidate.id === value);
              if (choice) setRole(choice.id);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tenantRoleChoices.map((choice) => (
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
        >
          <Plus className="size-4" />
          {record.memberships.length ? "Transferir usuario" : "Asignar tenant"}
        </Button>
      </div>
    </UserSection>
  );
}

function UserAccountActions({ record }: { record: UserRecord }) {
  const dataProvider = useDataProvider() as IdentityUserDataProvider;
  const notify = useNotify();
  const refresh = useRefresh();
  const [pending, setPending] = useState<string | null>(null);

  const run = async (
    key: string,
    action: () => Promise<void>,
    message: string,
  ) => {
    setPending(key);
    try {
      await action();
      notify(message, { type: "success" });
      refresh();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "No fue posible completar la acción.",
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
      title="Acciones de cuenta"
      description="Estas acciones no modifican la contraseña ni desactivan MFA de otra persona."
    >
      <div className="flex flex-wrap gap-2 md:col-span-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending !== null}
          onClick={() =>
            void run(
              "reset",
              () => dataProvider.sendPasswordReset(record.id),
              "Enlace de restablecimiento enviado.",
            )
          }
        >
          <KeyRound className="size-4" />
          Reenviar contraseña
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending !== null}
          onClick={() =>
            void run(
              "sessions",
              () => dataProvider.revokeSessions(record.id),
              "Sesiones cerradas.",
            )
          }
        >
          <LogOut className="size-4" />
          Cerrar sesiones
        </Button>
        <Button
          type="button"
          variant={suspended ? "outline" : "destructive"}
          disabled={pending !== null}
          onClick={() =>
            void run(
              "status",
              () =>
                suspended
                  ? dataProvider.reactivate(record.id)
                  : dataProvider.suspend(record.id),
              suspended ? "Usuario reactivado." : "Usuario suspendido.",
            )
          }
        >
          {suspended ? (
            <RotateCcw className="size-4" />
          ) : (
            <Ban className="size-4" />
          )}
          {suspended ? "Reactivar usuario" : "Suspender usuario"}
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
    <section className="rounded-xl border bg-card p-6 shadow-sm">
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

function UserAccessSummary({ record }: { record: UserRecord }) {
  if (record.platformAdmin) return <Badge>Plataforma</Badge>;
  if (record.memberships.length === 0)
    return <span className="text-muted-foreground">Sin acceso</span>;
  return (
    <span>
      Tenant #{record.memberships[0]?.tenantId}
    </span>
  );
}

function UserStatus({ active }: { active: boolean }) {
  return active ? (
    <Badge>Activo</Badge>
  ) : (
    <Badge variant="secondary">Suspendido</Badge>
  );
}

function MfaStatus({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <span className="inline-flex items-center gap-1.5 text-sm text-primary">
      <ShieldCheck className="size-4" /> Activa
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <ShieldOff className="size-4" /> No activa
    </span>
  );
}

function tenantRoleName(role: AgencyAccessRole): string {
  return tenantRoleChoices.find((choice) => choice.id === (role === "agency_admin" ? "tenant_admin" : role))?.name ?? role;
}
