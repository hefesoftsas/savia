import type { ResourceProps } from "ra-core";
import { required, useCreatePath, useTranslate } from "ra-core";
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
import { LiveIndicator } from "@/realtime/live-indicator";
import { applyRealtimeListEvent } from "@/realtime/realtime-list";
import { useRealtimeTopics } from "@/realtime/use-realtime";
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
      <TextInput
        source="idSlug"
        label={translate("savia.tenants.fields.idSlug", {
          _: "Identificador",
        })}
        helperText={translate("savia.tenants.fields.idSlugHelper", {
          _: "Identificador único del tenant.",
        })}
      />
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
        </>
      )}
    </>
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
  const { status } = useRealtimeTopics({
    topics: ["tenants"],
    onEvent: (event) => {
      applyRealtimeListEvent(queryClient, "tenants", event);
    },
  });
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <LiveIndicator status={status} />
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
    <Create title={translate("savia.tenants.newTenant", { _: "Nuevo tenant" })}>
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

function TenantEdit() {
  const translate = useTranslate();
  return (
    <Edit
      title={translate("savia.tenants.editTenant", { _: "Editar tenant" })}
      mutationMode="optimistic"
    >
      <SimpleForm className="max-w-2xl">
        <TenantFields />
      </SimpleForm>
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
