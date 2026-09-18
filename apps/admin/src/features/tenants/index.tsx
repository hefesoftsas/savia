import type { ResourceProps } from "ra-core";
import { required, useCreatePath, useTranslate } from "ra-core";
import { useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import {
  BooleanInput,
  Create,
  CreateButton,
  DataTable,
  Edit,
  EditButton,
  List,
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
  return (
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
        helperText={translate("savia.tenants.fields.temporaryPasswordHelper", {
          _: "Opcional. Si se deja vacía, se enviará un enlace para definirla.",
        })}
      />
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
    <Create
      title={translate("savia.tenants.newTenant", { _: "Nuevo tenant" })}
    >
      <SimpleForm className="max-w-2xl" defaultValues={{ isActive: true }}>
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
