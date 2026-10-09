import { useState } from "react";
import { useMessages } from "@/i18n/core";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { tenantSettingsMessages } from "./settings-messages";
import "@/features/service-credentials/service-credentials.css";
import { OfficeSettingsPanel } from "@/features/office-settings/office-settings-panel";
import { useAppServices } from "@/features/assistant/assistant-context";
import { TenantAccessUrl } from "@/features/tenant-branding/tenant-access-url";
import "@/features/tenant-branding/tenant-branding.css";
import { ResourceEditSync } from "@/realtime/resource-realtime";
import type { ResourceProps } from "ra-core";
import { EmailVerificationField } from "@/features/users/email-verification-field";
import {
  required,
  useCreatePath,
  useRecordContext,
  useTranslate,
} from "ra-core";
import { TenantUserCapacity } from "@/features/users/tenant-user-capacity";
import { TenantPagesSearchSettingsPanel } from "@/features/tenant-pages-search/tenant-pages-search-settings-panel";
import { TenantApiKeysPanel } from "@/features/tenant-api-keys/tenant-api-keys";
import { TenantSignInLinks } from "@/features/tenant-sso/tenant-sign-in-links";
import { useWatch } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import {
  AutocompleteInput,
  BooleanInput,
  Create,
  CreateButton,
  DataTable,
  Edit,
  EditButton,
  List,
  RadioButtonGroupInput,
  ReferenceInput,
  SelectInput,
  SimpleForm,
  TextInput,
} from "@/components/admin";
import { Badge } from "@/components/ui/badge";
import { applyRealtimeListEvent } from "@/realtime/realtime-list";
import { useRealtimeTopics } from "@/realtime/use-realtime";
import type { UserRecord } from "@/api/identity-user-data-provider";
import type { TenantRecord } from "@/api/tenant-data-provider";

function TenantFields() {
  const translate = useTranslate();
  return (
    <>
      <TextInput
        source="name"
        label={translate("savia.tenants.fields.name", {
          _: "Nombre del tenant",
        })}
        validate={required()}
      />
      <p className="text-sm text-muted-foreground md:col-span-2">
        {translate("savia.tenants.fields.urlHelper", {
          _: "La URL del tenant se asigna automáticamente a partir de su nombre y no cambia al renombrarlo.",
        })}
      </p>
      <BooleanInput
        source="isActive"
        label={translate("savia.tenants.fields.isActive", {
          _: "Activo",
        })}
        helperText={translate("savia.tenants.fields.isActiveHelper", {
          _: "Desactivar el tenant suspende el acceso de sus miembros.",
        })}
      />
    </>
  );
}

function InitialTenantUserFields() {
  const translate = useTranslate();
  const memberMode = useWatch({ name: "memberMode" }) ?? "new";
  return (
    <>
      <RadioButtonGroupInput
        source="memberMode"
        label={translate("savia.tenants.fields.memberMode", {
          _: "Primer administrador",
        })}
        choices={[
          {
            id: "new",
            name: translate("savia.tenants.fields.memberModeNew", {
              _: "Crear usuario nuevo",
            }),
          },
          {
            id: "existing",
            name: translate("savia.tenants.fields.memberModeExisting", {
              _: "Transferir usuario existente",
            }),
          },
        ]}
        row
      />
      {memberMode === "existing" ? (
        <ExistingTenantMemberFields />
      ) : (
        <>
          <TextInput
            source="initialUser.email"
            label={translate("savia.tenants.fields.initialAdminEmail", {
              _: "Correo del primer administrador",
            })}
            type="email"
            validate={required()}
          />
          <TextInput
            source="initialUser.firstName"
            label={translate("savia.tenants.fields.initialAdminFirstName", {
              _: "Nombres del primer administrador",
            })}
            validate={required()}
          />
          <TextInput
            source="initialUser.lastName"
            label={translate("savia.tenants.fields.initialAdminLastName", {
              _: "Apellidos del primer administrador",
            })}
            validate={required()}
          />
          <TextInput
            source="initialUser.temporaryPassword"
            label={translate("savia.tenants.fields.temporaryPassword", {
              _: "Contraseña temporal",
            })}
            type="password"
            helperText={translate(
              "savia.tenants.fields.temporaryPasswordHelper",
              {
                _: "Opcional. Si se deja vacía, se enviará un enlace para definirla.",
              },
            )}
          />
          <EmailVerificationField source="initialUser.emailVerified" />
        </>
      )}
    </>
  );
}

function tenantMemberLabel(user: UserRecord) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left whitespace-normal">
      <span className="break-words font-medium">
        {user.displayName || user.email}
      </span>{" "}
      {user.displayName && (
        <span className="break-all text-xs text-muted-foreground">
          {user.email}
        </span>
      )}
    </span>
  );
}

function ExistingTenantMemberFields() {
  const translate = useTranslate();
  return (
    <>
      <ReferenceInput
        source="existingUserId"
        reference="users"
        perPage={100}
        sort={{ field: "displayName", order: "ASC" }}
      >
        <AutocompleteInput
          optionText={tenantMemberLabel}
          inputText={tenantMemberLabel}
          popoverClassName="w-(--radix-popover-trigger-width)"
          label={translate("savia.tenants.fields.existingUser", {
            _: "Usuario existente",
          })}
          helperText={translate("savia.tenants.fields.existingUserHelper", {
            _: "El usuario dejará su organización actual: la transferencia no comparte la cuenta.",
          })}
          validate={required()}
        />
      </ReferenceInput>
      <SelectInput
        source="existingRole"
        label={translate("savia.tenants.fields.existingRole", {
          _: "Rol en el nuevo tenant",
        })}
        choices={[
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
            name: translate("savia.users.roles.viewer", {
              _: "Solo lectura",
            }),
          },
        ]}
        validate={required()}
      />
      <p className="text-sm text-muted-foreground md:col-span-2">
        {translate("savia.tenants.fields.existingUserWarning", {
          _: "No se puede transferir al último miembro activo de su organización ni a un administrador de plataforma.",
        })}
      </p>
    </>
  );
}

function TenantListActions() {
  const translate = useTranslate();
  const queryClient = useQueryClient();
  useRealtimeTopics({
    topics: ["tenants"],
    onConnected: (reason) => {
      if (reason === "subscription-change") return;
      void queryClient.invalidateQueries({ queryKey: ["tenants"] });
    },
    onEvent: (event) => {
      applyRealtimeListEvent(queryClient, "tenants", event);
    },
  });
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <CreateButton
        label={translate("savia.tenants.newTenant", { _: "Nuevo tenant" })}
      />
    </div>
  );
}

function TenantList() {
  const translate = useTranslate();
  const createPath = useCreatePath();
  const usersPath = createPath({ resource: "users", type: "list" });

  return (
    <List
      title={translate("savia.tenants.title", { _: "Tenants" })}
      sort={{ field: "name", order: "ASC" }}
      actions={<TenantListActions />}
    >
      <DataTable<TenantRecord>
        rowClick={(_id, _resource, record) =>
          `${usersPath}?filter=${encodeURIComponent(
            JSON.stringify({ tenantId: record.id }),
          )}`
        }
        bulkActionButtons={false}
      >
        <DataTable.Col
          source="name"
          label={translate("savia.tenants.table.tenant", { _: "Tenant" })}
        />
        <DataTable.Col
          source="idSlug"
          label={translate("savia.tenants.table.identifier", {
            _: "Identificador",
          })}
        />
        <DataTable.Col
          source="kind"
          label={translate("savia.tenants.table.type", { _: "Tipo" })}
          render={(record) => (
            <Badge
              variant={record.kind === "platform" ? "outline" : "secondary"}
            >
              {record.kind === "platform"
                ? translate("savia.tenants.table.internal", { _: "Interno" })
                : translate("savia.tenants.table.commercial", {
                    _: "Comercial",
                  })}
            </Badge>
          )}
        />
        <DataTable.Col
          source="isActive"
          label={translate("savia.tenants.table.status", { _: "Estado" })}
          render={(record) => (
            <Badge variant={record.isActive ? "default" : "secondary"}>
              {record.isActive
                ? translate("savia.tenants.table.active", { _: "Activo" })
                : translate("savia.tenants.table.inactive", {
                    _: "Inactivo",
                  })}
            </Badge>
          )}
        />
        <DataTable.Col
          label={translate("savia.tenants.table.actions", { _: "Acciones" })}
          render={(record) =>
            record.kind === "commercial" ? <EditButton iconOnly /> : null
          }
        />
      </DataTable>
    </List>
  );
}

function TenantCreate() {
  const translate = useTranslate();
  return (
    <Create
      title={translate("savia.tenants.newTenant", { _: "Nuevo tenant" })}
      redirect="edit"
    >
      <SimpleForm
        className="max-w-2xl"
        defaultValues={{
          isActive: true,
          memberMode: "new",
          existingRole: "tenant_admin",
        }}
      >
        <TenantFields />
        <InitialTenantUserFields />
      </SimpleForm>
    </Create>
  );
}

function SavedTenantAccessUrl() {
  const record = useRecordContext<TenantRecord>();
  if (record?.kind !== "commercial") return null;
  return (
    <div className="md:col-span-2">
      <TenantAccessUrl
        key={`${record.id}:${record.idSlug}`}
        slug={record.idSlug}
      />
    </div>
  );
}

function TenantCapacityEditor() {
  const record = useRecordContext<TenantRecord>();
  return (
    <TenantUserCapacity
      tenantId={record ? Number(record.id) : null}
      platformCanEdit
    />
  );
}

function TenantOfficeSettings() {
  const record = useRecordContext<TenantRecord>();
  const services = useAppServices();
  if (!record || record.kind !== "commercial") return null;
  return (
    <div className="md:col-span-2">
      <OfficeSettingsPanel
        key={record.id}
        tenantId={Number(record.id)}
        services={services}
      />
    </div>
  );
}

function TenantPagesSearchEditor() {
  const record = useRecordContext<TenantRecord>();
  const { apiClient } = useAppServices();
  if (record?.kind !== "commercial" || !record.isActive || !apiClient?.get)
    return null;
  return (
    <TenantPagesSearchSettingsPanel
      key={record.id}
      services={{ apiClient }}
      tenantId={Number(record.id)}
    />
  );
}

function TenantAuthenticationLinks() {
  const record = useRecordContext<TenantRecord>();
  if (record?.kind !== "commercial" || !record.isActive) return null;
  return <TenantSignInLinks tenantId={Number(record.id)} />;
}

function TenantApiKeysEditor() {
  const record = useRecordContext<TenantRecord>();
  const { apiClient } = useAppServices();
  if (record?.kind !== "commercial" || !record.isActive || !apiClient?.get)
    return null;
  return (
    <div className="md:col-span-2">
      <TenantApiKeysPanel
        key={record.id}
        api={apiClient}
        tenantId={Number(record.id)}
      />
    </div>
  );
}

function TenantEditSections() {
  const record = useRecordContext<TenantRecord>();
  const { apiClient } = useAppServices();
  const t = useMessages(tenantSettingsMessages);
  const [tab, setTab] = useState("general");
  const [visited, setVisited] = useState(() => new Set(["general"]));
  const commercial = record?.kind === "commercial";
  const hasApi = Boolean(apiClient?.get);
  const hasKeys = commercial && record?.isActive && hasApi;
  const activeTab =
    (tab !== "general" && !commercial) ||
    (tab === "keys" && !hasKeys) ||
    (tab === "configuration" && !hasApi)
      ? "general"
      : tab;
  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        setTab(value);
        setVisited((current) => new Set([...current, value]));
      }}
      className="min-w-0 max-w-4xl gap-6"
    >
      <div className="min-w-0 overflow-x-auto border-b">
        <TabsList
          variant="line"
          aria-label={t("Tenant settings")}
          className="h-auto min-h-12 justify-start rounded-none px-0"
        >
          <TabsTrigger value="general" className="min-h-11 flex-none px-4">
            {t("General")}
          </TabsTrigger>
          {commercial ? (
            <TabsTrigger value="access" className="min-h-11 flex-none px-4">
              {t("Access")}
            </TabsTrigger>
          ) : null}
          {commercial && hasApi ? (
            <TabsTrigger
              value="configuration"
              className="min-h-11 flex-none px-4"
            >
              {t("Configuration")}
            </TabsTrigger>
          ) : null}
          {hasKeys ? (
            <TabsTrigger value="keys" className="min-h-11 flex-none px-4">
              {t("API keys")}
            </TabsTrigger>
          ) : null}
        </TabsList>
      </div>
      <TabsContent
        value="general"
        forceMount
        className="grid gap-8 data-[state=inactive]:hidden"
      >
        <SimpleForm
          className="max-w-2xl"
          resetOptions={{ keepDirtyValues: true }}
        >
          <ResourceEditSync resource="tenants" />
          <TenantFields />
        </SimpleForm>
        <div className="max-w-2xl border-t pt-6">
          <TenantCapacityEditor />
        </div>
      </TabsContent>
      {commercial ? (
        <TabsContent
          value="access"
          forceMount
          className="grid gap-6 data-[state=inactive]:hidden"
        >
          <header className="grid gap-2">
            <h2 className="text-lg font-semibold">{t("Access")}</h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              {t("Manage access links and sign-in providers.")}
            </p>
          </header>
          <SavedTenantAccessUrl />
          <TenantAuthenticationLinks />
        </TabsContent>
      ) : null}
      {commercial && hasApi && visited.has("configuration") ? (
        <TabsContent
          value="configuration"
          forceMount
          className="grid gap-8 data-[state=inactive]:hidden"
        >
          <header className="grid gap-2">
            <h2 className="text-lg font-semibold">{t("Configuration")}</h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              {t("Configure the tools available to this tenant.")}
            </p>
          </header>
          <TenantOfficeSettings />
          <div className="border-t pt-6">
            <TenantPagesSearchEditor />
          </div>
        </TabsContent>
      ) : null}
      {hasKeys && visited.has("keys") ? (
        <TabsContent
          value="keys"
          forceMount
          className="data-[state=inactive]:hidden"
        >
          <TenantApiKeysEditor />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}

function TenantEditBody() {
  const record = useRecordContext<TenantRecord>();
  return <TenantEditSections key={record?.id} />;
}

function TenantEdit() {
  const translate = useTranslate();
  return (
    <Edit
      title={translate("savia.tenants.editTenant", { _: "Editar tenant" })}
      mutationMode="optimistic"
    >
      <TenantEditBody />
    </Edit>
  );
}
export const tenants: ResourceProps = {
  name: "tenants",
  options: { label: "Tenants" },
  icon: Building2,
  recordRepresentation: "name",
  list: TenantList,
  create: TenantCreate,
  edit: TenantEdit,
};
