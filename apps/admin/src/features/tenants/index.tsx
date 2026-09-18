import type { ResourceProps } from "ra-core";
import { required, useCreatePath } from "ra-core";
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
import { useRealtimeTopics } from "@/realtime/use-realtime";
import type { TenantRecord } from "@/api/tenant-data-provider";

function TenantFields() {
  return (
    <>
      <TextInput source="name" label="Nombre del tenant" validate={required()} />
      <TextInput
        source="idSlug"
        label="Identificador"
        helperText="Identificador único del tenant."
      />
      <BooleanInput
        source="isActive"
        label="Activo"
        helperText="Desactivar el tenant suspende el acceso de sus miembros."
      />
    </>
  );
}
function InitialTenantUserFields() {
  return (
    <>
      <TextInput
        source="initialUser.email"
        label="Correo del primer administrador"
        type="email"
        validate={required()}
      />
      <TextInput
        source="initialUser.firstName"
        label="Nombres del primer administrador"
        validate={required()}
      />
      <TextInput
        source="initialUser.lastName"
        label="Apellidos del primer administrador"
        validate={required()}
      />
      <TextInput
        source="initialUser.temporaryPassword"
        label="Contraseña temporal"
        type="password"
        helperText="Opcional. Si se deja vacía, se enviará un enlace para definirla."
      />
    </>
  );
}
function TenantListActions() {
  const queryClient = useQueryClient();
  const { status } = useRealtimeTopics({
    topics: ["tenants"],
    onEvent: () => {
      void queryClient.invalidateQueries({ queryKey: ["tenants"] });
    },
  });
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <LiveIndicator status={status} />
      <CreateButton label="Nuevo tenant" />
    </div>
  );
}
function TenantList() {
  const createPath = useCreatePath();
  const usersPath = createPath({ resource: "users", type: "list" });

  return (
    <List
      title="Tenants"
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
        <DataTable.Col source="name" label="Tenant" />
        <DataTable.Col source="idSlug" label="Identificador" />
        <DataTable.Col
          source="kind"
          label="Tipo"
          render={(record) => (
            <Badge variant={record.kind === "platform" ? "outline" : "secondary"}>
              {record.kind === "platform" ? "Interno" : "Comercial"}
            </Badge>
          )}
        />
        <DataTable.Col
          source="isActive"
          label="Estado"
          render={(record) => (
            <Badge variant={record.isActive ? "default" : "secondary"}>
              {record.isActive ? "Activo" : "Inactivo"}
            </Badge>
          )}
        />
        <DataTable.Col
          label="Acciones"
          render={(record) =>
            record.kind === "commercial" ? <EditButton iconOnly /> : null
          }
        />
      </DataTable>
    </List>
  );
}
function TenantCreate() {
  return (
    <Create title="Nuevo tenant">
      <SimpleForm className="max-w-2xl" defaultValues={{ isActive: true }}>
        <TenantFields />
        <InitialTenantUserFields />
      </SimpleForm>
    </Create>
  );
}
function TenantEdit() {
  return (
    <Edit title="Editar tenant" mutationMode="optimistic">
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
