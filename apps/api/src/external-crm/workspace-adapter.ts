import type { StudioObject } from "@savia/studio-shared/metadata";
import type {
  ActiveCrmConnection,
  CrmProviderId,
  NangoClient,
} from "./contracts";
import { CrmUnavailableError, CrmUpstreamError } from "./contracts";
import { HTTPException } from "hono/http-exception";
import { salesforceModule } from "./salesforce-workspace";
import { zohoModule } from "./zoho-workspace";
import { pipedriveModule } from "./pipedrive-workspace";

export type RemoteProviderId = Exclude<CrmProviderId, "hubspot">;
export type WorkspaceResource = "contacts" | "companies" | "deals";

export type WorkspaceCapabilities = {
  list: boolean;
  read: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  schema: boolean;
  customFields: boolean;
  search: boolean;
  filter: boolean;
  sort: boolean;
};

export type WorkspaceDescription = {
  fields: Record<string, StudioObject["config"]["fields"][string]>;
  capabilities: WorkspaceCapabilities;
  title: string;
  schemaIssues?: string[];
};

export type WorkspacePage = {
  records: Record<string, unknown>[];
  hasNextPage: boolean;
  total?: number;
};

export type RemoteWorkspaceAdapter = {
  resources: Array<{ resource: WorkspaceResource; label: string }>;
  describe(
    connection: ActiveCrmConnection,
    resource: WorkspaceResource,
  ): Promise<WorkspaceDescription>;
  list(
    connection: ActiveCrmConnection,
    resource: WorkspaceResource,
    options: { page: number; perPage: number; q?: string; fields: string[] },
  ): Promise<WorkspacePage>;
  get(
    connection: ActiveCrmConnection,
    resource: WorkspaceResource,
    id: string,
    fields: string[],
  ): Promise<Record<string, unknown>>;
  create(
    connection: ActiveCrmConnection,
    resource: WorkspaceResource,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  update(
    connection: ActiveCrmConnection,
    resource: WorkspaceResource,
    id: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  links(
    connection: ActiveCrmConnection,
    resource: WorkspaceResource,
    id: string,
    target: WorkspaceResource,
    options: { page: number; perPage: number; fields: string[] },
  ): Promise<WorkspacePage>;
  canEditLink?(resource: WorkspaceResource, target: WorkspaceResource): boolean;
  setLink?(
    connection: ActiveCrmConnection,
    resource: WorkspaceResource,
    id: string,
    target: WorkspaceResource,
    targetId: string,
    remove: boolean,
  ): Promise<void>;
  origin?(
    connection: ActiveCrmConnection,
    resource: WorkspaceResource,
    id: string,
  ): { provider: string; label: string; url: string } | undefined;
};

type ProviderModule =
  typeof salesforceModule | typeof zohoModule | typeof pipedriveModule;
const capabilities = (
  values: Partial<WorkspaceCapabilities> = {},
): WorkspaceCapabilities => ({
  list: true,
  read: true,
  create: false,
  update: false,
  delete: false,
  schema: true,
  customFields: true,
  search: true,
  filter: false,
  sort: false,
  ...values,
});
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const str = (value: unknown): string | undefined =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
const safeName = /^[A-Za-z][A-Za-z0-9_]*$/;

function nativeId(module: ProviderModule, resource: WorkspaceResource): string {
  return module.names[resource];
}
function resourcePath(
  module: ProviderModule,
  resource: WorkspaceResource,
): string {
  return module.provider === "salesforce"
    ? `${module.apiRoot}/sobjects/${nativeId(module, resource)}`
    : `${module.apiRoot}/${nativeId(module, resource)}`;
}
function validateId(module: ProviderModule, id: string): void {
  if (!module.idPattern.test(id))
    throw new CrmUnavailableError("The CRM record identifier is invalid");
}
function responseRecords(
  module: ProviderModule,
  body: Record<string, unknown>,
): Record<string, unknown>[] {
  if (body.success === false) throw new CrmUpstreamError();
  if (
    module.provider === "zoho" &&
    array(body.data).some(
      (item) =>
        record(item).status === "error" ||
        (record(item).code && record(item).code !== "SUCCESS"),
    )
  )
    throw new CrmUpstreamError();
  if (module.provider === "salesforce" && !Array.isArray(body.records))
    throw new CrmUpstreamError();
  if (module.provider === "zoho" && !Array.isArray(body.data))
    throw new CrmUpstreamError();
  if (
    module.provider === "pipedrive" &&
    (body.success !== true ||
      (!Array.isArray(body.data) && !Array.isArray(record(body.data).items)))
  )
    throw new CrmUpstreamError();
  const raw =
    module.provider === "salesforce" ? array(body.records) : array(body.data);
  const values =
    module.provider === "pipedrive" && !raw.length
      ? array(record(body.data).items).map(
          (entry) => record(entry).item ?? entry,
        )
      : raw;
  return values
    .map((value) => record(value))
    .filter((value) => {
      const id = str(value.Id ?? value.id);
      if (!id) throw new CrmUpstreamError();
      value.id = id;
      if (module.provider === "pipedrive") {
        for (const field of ["email", "phone"]) {
          const entries = array(value[field]);
          if (field === "email")
            value._crmEmailValues = entries
              .map((entry) => str(record(entry).value))
              .filter(Boolean);
          if (entries.length)
            value[field] =
              str(
                record(
                  entries.find((entry) => record(entry).primary === true) ??
                    entries[0],
                ).value,
              ) ?? "";
        }
        for (const field of ["org_id", "person_id", "owner_id", "stage_id"]) {
          const reference = record(value[field]);
          if (Object.keys(reference).length)
            value[field] = str(reference.value ?? reference.id) ?? value[field];
        }
      }
      if (module.provider === "zoho") {
        for (const field of ["Account_Name", "Contact_Name", "Owner"]) {
          const reference = record(value[field]);
          if (str(reference.id)) value[field] = String(reference.id);
        }
      }
      return true;
    });
}
async function call(
  nango: NangoClient,
  connection: ActiveCrmConnection,
  method: "GET" | "POST" | "PATCH" | "PUT",
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await nango.proxy({ method, path, connection, body });
  if (!response.ok) throw upstreamError(response.status);
  if (response.status === 204)
    return connection.provider === "zoho" && method === "GET"
      ? { data: [], info: { more_records: false } }
      : {};
  const payload: unknown = await response.json().catch(() => undefined);
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new CrmUpstreamError();
  return payload as Record<string, unknown>;
}
function upstreamError(status: number): CrmUpstreamError {
  const message =
    status === 401
      ? "The CRM connection must be reconnected"
      : status === 403
        ? "The CRM account denied this operation"
        : status === 404
          ? "The CRM resource was not found"
          : status === 422
            ? "The CRM rejected the record fields"
            : status === 429
              ? "The CRM rate limit was reached"
              : "The CRM provider request could not be completed";
  return new CrmUpstreamError(
    status === 401 ? "RECONNECT_REQUIRED" : "NANGO_REQUEST_FAILED",
    message,
    status,
  );
}
function fieldMap(
  module: ProviderModule,
  resource: WorkspaceResource,
  values: unknown[],
): {
  fields: Record<string, StudioObject["config"]["fields"][string]>;
  create: boolean;
  update: boolean;
} {
  const fields: Record<string, StudioObject["config"]["fields"][string]> = {};
  let create = false;
  let update = false;
  for (const item of values) {
    const field = record(item);
    const name = str(
      module.provider === "pipedrive"
        ? field.key
        : (field.api_name ?? field.apiName ?? field.name),
    );
    const label = str(
      field.label ??
        field.field_label ??
        field.display_name ??
        (module.provider === "pipedrive"
          ? field.name
          : (field.field_name ?? field.name)),
    );
    if (!name || !label) continue;
    const kind = str(
      field.type ?? field.data_type ?? field.field_type,
    )?.toLowerCase();
    const fieldRequired =
      (field.nillable === false && field.defaultedOnCreate !== true) ||
      field.required === true ||
      field.mandatory === true ||
      field.system_mandatory === true ||
      field.mandatory_flag === true;
    if (!safeName.test(name)) {
      if (fieldRequired)
        throw new HTTPException(422, {
          message: `Required CRM field ${name} has an unsupported identifier`,
        });
      continue;
    }
    const optionsRaw =
      field.pick_list_values ??
      field.picklistValues ??
      field.options ??
      field.enumValues;
    const optionsList = array(optionsRaw).filter(
      (option) =>
        record(option).active !== false && record(option).active_flag !== false,
    );
    if (optionsList.length > 200)
      throw new HTTPException(422, {
        message: `CRM field ${name} has too many choices to edit safely`,
      });
    const options = optionsList
      .map((option) => {
        const item = record(option);
        const value = str(
          item.value ??
            item.actual_value ??
            item.id ??
            item.display_value ??
            item.label ??
            item.name,
        );
        const label = str(
          item.label ?? item.display_value ?? item.name ?? value,
        );
        return value && label ? { value, label } : undefined;
      })
      .filter((option): option is { value: string; label: string } => !!option);
    const dateTime = kind?.includes("datetime") === true;
    const type = options.length
      ? kind?.includes("multiselect")
        ? "MultiSelect"
        : "Dropdown"
      : kind?.includes("email")
        ? "Email"
        : kind?.includes("phone")
          ? "Phone"
          : kind?.includes("boolean") || kind?.includes("checkbox")
            ? "Toggle"
            : kind?.includes("date") && !dateTime
              ? "DateControl"
              : kind?.includes("currency") ||
                  kind?.includes("double") ||
                  kind?.includes("decimal") ||
                  kind?.includes("number") ||
                  ["int", "integer", "long", "float", "monetary"].includes(
                    kind ?? "",
                  )
                ? "Number"
                : "Textbox";
    const canCreateField =
      module.provider === "pipedrive" ||
      field.createable === true ||
      record(field.operation_type).api_create === true ||
      field.read_only === false;
    const canUpdateField =
      module.provider === "pipedrive" ||
      field.updateable === true ||
      record(field.operation_type).api_update === true ||
      field.read_only === false;
    const composite = [
      "address",
      "location",
      "geolocation",
      "json",
      "object",
    ].some((part) => kind?.includes(part));
    const required = fieldRequired && canCreateField;
    if (required && composite)
      throw new HTTPException(422, {
        message: `Required CRM field ${name} uses an unsupported composite value`,
      });
    if (type === "MultiSelect" && required)
      throw new HTTPException(422, {
        message: `Required CRM field ${name} has a multi-value format that this workspace cannot edit`,
      });
    fields[name] = {
      type: type === "MultiSelect" ? "Textbox" : type,
      label,
      required,
      readOnly:
        (module.provider === "pipedrive" &&
          ["first_name", "last_name"].includes(name)) ||
        type === "MultiSelect" ||
        (module.provider === "pipedrive"
          ? false
          : field.updateable === false ||
            field.read_only === true ||
            field.readOnly === true ||
            record(field.operation_type).api_update === false),
      ...(dateTime ? { config: { dateTime: true } } : {}),
      ...(options.length
        ? {
            options: options.map((option) => ({
              label: option.label,
              value: option.value,
            })),
          }
        : {}),
    } as StudioObject["config"]["fields"][string];
    create ||= canCreateField;
    update ||= canUpdateField;
  }
  if (!Object.keys(fields).length) throw new CrmUpstreamError();
  return { fields, create, update };
}

export function createRemoteWorkspaceAdapter(
  provider: RemoteProviderId,
  nango: NangoClient,
): RemoteWorkspaceAdapter {
  const module: ProviderModule =
    provider === "salesforce"
      ? salesforceModule
      : provider === "zoho"
        ? zohoModule
        : pipedriveModule;
  const requireProvider = (connection: ActiveCrmConnection) => {
    if (connection.provider !== provider)
      throw new CrmUnavailableError(
        "The requested CRM operation is unavailable",
      );
  };
  const describe = async (
    connection: ActiveCrmConnection,
    resource: WorkspaceResource,
  ): Promise<WorkspaceDescription> => {
    requireProvider(connection);
    let path: string;
    if (provider === "salesforce")
      path = `${resourcePath(module, resource)}/describe`;
    else if (provider === "zoho")
      path = `/crm/v2/settings/fields?module=${encodeURIComponent(nativeId(module, resource))}&per_page=50&page=1`;
    else
      path = `/v1/${resource === "contacts" ? "personFields" : resource === "companies" ? "organizationFields" : "dealFields"}`;
    const body = await call(nango, connection, "GET", path);
    let modulePermissions: Record<string, unknown> = {};
    let zohoFields: unknown[] = [];
    if (provider === "zoho") {
      const modules = await call(
        nango,
        connection,
        "GET",
        `/crm/v2/settings/modules?module=${encodeURIComponent(nativeId(module, resource))}`,
      );
      modulePermissions =
        array(modules.modules)
          .map(record)
          .find((item) => item.api_name === nativeId(module, resource)) ?? {};
      let page = 1;
      let more = true;
      while (more && page <= 20) {
        const fields =
          page === 1
            ? body
            : await call(
                nango,
                connection,
                "GET",
                `/crm/v2/settings/fields?module=${encodeURIComponent(nativeId(module, resource))}&per_page=50&page=${page}`,
              );
        zohoFields.push(...array(fields.fields ?? record(fields.data).fields));
        more = record(fields.info).more_records === true;
        page += 1;
      }
      if (more)
        throw new HTTPException(422, {
          message:
            "The CRM schema has more fields than this workspace can safely load",
        });
    }
    const values =
      provider === "salesforce"
        ? array(body.fields)
        : provider === "zoho"
          ? zohoFields
          : array(body.data);
    if (
      provider === "pipedrive" &&
      record(record(body.additional_data).pagination)
        .more_items_in_collection === true
    ) {
      throw new HTTPException(422, {
        message:
          "The CRM schema exceeds the supported field metadata page; screen installation cannot safely omit required fields",
      });
    }
    const mapped = fieldMap(module, resource, values);
    const pipedriveScopes = connection.scopes.map((scope) =>
      scope.toLowerCase(),
    );
    const objectCreate =
      provider === "salesforce"
        ? body.createable === true
        : provider === "zoho"
          ? modulePermissions.creatable === true
          : pipedriveScopes.some(
              (scope) =>
                scope ===
                  (resource === "deals" ? "deals:full" : "contacts:full") ||
                scope ===
                  (resource === "deals" ? "deals:write" : "contacts:write"),
            );
    const objectUpdate =
      provider === "salesforce"
        ? body.updateable === true
        : provider === "zoho"
          ? modulePermissions.editable === true
          : pipedriveScopes.some(
              (scope) =>
                scope ===
                  (resource === "deals" ? "deals:full" : "contacts:full") ||
                scope ===
                  (resource === "deals" ? "deals:write" : "contacts:write"),
            );
    const canRead =
      provider === "salesforce"
        ? body.queryable === true && body.retrieveable === true
        : provider === "zoho"
          ? modulePermissions.viewable === true
          : pipedriveScopes.some(
              (scope) =>
                scope ===
                  (resource === "deals" ? "deals:read" : "contacts:read") ||
                scope ===
                  (resource === "deals" ? "deals:full" : "contacts:full") ||
                scope ===
                  (resource === "deals" ? "deals:write" : "contacts:write"),
            );
    const title =
      provider === "salesforce"
        ? resource === "contacts"
          ? "LastName"
          : "Name"
        : provider === "zoho"
          ? resource === "contacts"
            ? "Last_Name"
            : resource === "companies"
              ? "Account_Name"
              : "Deal_Name"
          : resource === "deals"
            ? "title"
            : "name";
    if (!mapped.fields[title])
      throw new HTTPException(422, {
        message: `The CRM does not provide the required title field ${title}`,
      });
    const schemaIssues: string[] = [];
    if (provider === "zoho" && Object.keys(mapped.fields).length > 50) {
      const required = Object.keys(mapped.fields).filter(
        (key) => key === title || mapped.fields[key].required,
      );
      if (required.length > 50)
        throw new HTTPException(422, {
          message:
            "The CRM requires more than 50 fields; this workspace cannot safely create records",
        });
      const preferred = [
        "Email",
        "First_Name",
        "Phone",
        "Account_Name",
        "Contact_Name",
        "Owner",
        "Amount",
        "Stage",
        "Closing_Date",
        "Website",
        "Modified_Time",
      ];
      const selected = [
        ...new Set([
          ...required,
          ...preferred.filter((key) => mapped.fields[key]),
          ...Object.keys(mapped.fields),
        ]),
      ].slice(0, 50);
      mapped.fields = Object.fromEntries(
        selected.map((key) => [key, mapped.fields[key]]),
      );
      schemaIssues.push(
        "Zoho screens include at most 50 fields, prioritizing the title and required fields. Additional optional fields remain in Zoho.",
      );
    }
    return {
      title,
      fields: mapped.fields,
      ...(schemaIssues.length ? { schemaIssues } : {}),
      capabilities: capabilities({
        list: canRead,
        read: canRead,
        create: objectCreate && (provider === "pipedrive" || mapped.create),
        update: objectUpdate && (provider === "pipedrive" || mapped.update),
        schema: false,
        customFields: false,
      }),
    };
  };
  return {
    resources: module.resources.map((resource) => ({
      resource,
      label: module.labels[resource],
    })),
    describe,
    async list(connection, resource, options) {
      requireProvider(connection);
      const perPage = Math.max(1, Math.min(100, Math.floor(options.perPage)));
      const page = Math.max(1, Math.floor(options.page));
      const fields = [...new Set(["id", ...options.fields])];
      if (provider === "zoho" && fields.length > 51)
        throw new HTTPException(422, {
          message: "Zoho requests support at most 50 fields",
        });
      if (fields.some((field) => !safeName.test(field)))
        throw new CrmUnavailableError("The requested CRM fields are invalid");
      const url = new URL(
        resourcePath(module, resource),
        "https://savia.invalid",
      );
      let method: "GET" | "POST" = "GET";
      let body: unknown;
      if (provider === "salesforce") {
        if ((page - 1) * perPage > 2000)
          throw new CrmUnavailableError(
            "The requested page is beyond the CRM paging limit",
          );
        const columns = fields.filter((field) => field !== "id");
        columns.unshift("Id");
        const nativeFields = columns
          .map((field) => (field === "id" ? "Id" : field))
          .join(",");
        const where = options.q?.trim()
          ? ` WHERE Name LIKE '%${options.q.trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'")}%'`
          : "";
        url.pathname = "/services/data/v60.0/query";
        url.searchParams.set(
          "q",
          `SELECT ${nativeFields} FROM ${nativeId(module, resource)}${where} LIMIT ${Math.min(2000, perPage + 1)} OFFSET ${(page - 1) * perPage}`,
        );
      } else if (provider === "zoho") {
        url.searchParams.set(
          "fields",
          fields.filter((field) => field !== "id").join(","),
        );
        url.searchParams.set("page", String(page));
        url.searchParams.set("per_page", String(perPage));
        if (options.q?.trim()) {
          url.pathname += "/search";
          url.searchParams.set("word", options.q.trim().slice(0, 100));
        }
      } else {
        url.searchParams.set("start", String((page - 1) * perPage));
        url.searchParams.set("limit", String(perPage));
        if (options.q?.trim()) {
          url.pathname += "/search";
          url.searchParams.set("term", options.q.trim().slice(0, 100));
        }
      }
      const response = await nango.proxy({
        method,
        path: `${url.pathname}${url.search}`,
        connection,
        body,
      });
      if (!response.ok) throw upstreamError(response.status);
      if (response.status === 204) return { records: [], hasNextPage: false };
      const payload = record(await response.json().catch(() => undefined));
      if (payload.success === false) throw new CrmUpstreamError();
      const fetched = responseRecords(module, payload);
      let records =
        provider === "salesforce" ? fetched.slice(0, perPage) : fetched;
      if (provider === "pipedrive" && options.q?.trim()) {
        const hydrated: Record<string, unknown>[] = [];
        for (let offset = 0; offset < records.length; offset += 5) {
          hydrated.push(
            ...(await Promise.all(
              records
                .slice(offset, offset + 5)
                .map((entry) =>
                  this.get(
                    connection,
                    resource,
                    String(entry.id),
                    options.fields,
                  ),
                ),
            )),
          );
        }
        records = hydrated;
      }
      const info = record(payload.info);
      const pagination = record(record(payload.additional_data).pagination);
      const hasNextPage =
        provider === "salesforce"
          ? fetched.length > perPage
          : provider === "zoho"
            ? info.more_records === true
            : pagination.more_items_in_collection === true;
      return { records, hasNextPage };
    },
    async get(connection, resource, id, fields) {
      requireProvider(connection);
      validateId(module, id);
      if (
        provider === "zoho" &&
        fields.filter((field) => field !== "id").length > 50
      )
        throw new HTTPException(422, {
          message: "Zoho requests support at most 50 fields",
        });
      const url = new URL(
        `${resourcePath(module, resource)}/${encodeURIComponent(id)}`,
        "https://savia.invalid",
      );
      if (provider === "salesforce" && fields.length)
        url.searchParams.set(
          "fields",
          ["Id", ...fields.filter((field) => field !== "id")].join(","),
        );
      if (provider === "zoho" && fields.length)
        url.searchParams.set(
          "fields",
          fields.filter((field) => field !== "id").join(","),
        );
      const payload = await call(
        nango,
        connection,
        "GET",
        `${url.pathname}${url.search}`,
      );
      const rows =
        provider === "zoho" ? array(payload.data) : [payload.data ?? payload];
      const envelope =
        provider === "salesforce"
          ? { records: rows }
          : provider === "pipedrive"
            ? { success: true, data: rows }
            : { data: rows };
      const entry = responseRecords(module, envelope)[0] ?? record(rows[0]);
      if (!str(entry.Id ?? entry.id)) throw new CrmUpstreamError();
      return { ...entry, id: String(entry.Id ?? entry.id) };
    },
    async create(connection, resource, data) {
      requireProvider(connection);
      const description = await describe(connection, resource);
      if (!description.capabilities.create)
        throw new HTTPException(405, {
          message: "This CRM connection cannot create records",
        });
      validateRequired(description, data);
      const safeData = providerWrite(provider, resource, data);
      const path = resourcePath(module, resource);
      const payload = await call(
        nango,
        connection,
        "POST",
        path,
        provider === "zoho" ? { data: [safeData] } : safeData,
      );
      assertMutationSuccess(provider, payload);
      const id =
        provider === "salesforce"
          ? str(payload.id)
          : provider === "zoho"
            ? str(
                record(array(payload.data)[0]).details &&
                  record(record(array(payload.data)[0]).details).id,
              )
            : str(record(payload.data).id);
      if (!id) throw new CrmUpstreamError();
      return this.get(connection, resource, id, Object.keys(safeData));
    },
    async update(connection, resource, id, data) {
      requireProvider(connection);
      validateId(module, id);
      const description = await describe(connection, resource);
      if (!description.capabilities.update)
        throw new HTTPException(405, {
          message: "This CRM connection cannot update records",
        });
      const unknown = Object.keys(data).filter(
        (field) => !description.fields[field],
      );
      const readonly = Object.keys(data).filter(
        (field) => description.fields[field]?.readOnly,
      );
      if (unknown.length || readonly.length)
        throw new CrmUnavailableError(
          "The requested CRM fields cannot be updated",
        );
      const safeData = providerWrite(provider, resource, data);
      const method = provider === "salesforce" ? "PATCH" : "PUT";
      const path = `${resourcePath(module, resource)}/${encodeURIComponent(id)}`;
      const result = await call(
        nango,
        connection,
        method,
        path,
        provider === "zoho" ? { data: [{ id, ...safeData }] } : safeData,
      );
      assertMutationSuccess(provider, result);
      return this.get(connection, resource, id, Object.keys(safeData));
    },
    async links(connection, resource, id, target, options) {
      requireProvider(connection);
      validateId(module, id);
      const single = async (
        targetResource: WorkspaceResource,
        targetId: string | undefined,
      ): Promise<WorkspacePage> => {
        if (!targetId || options.page > 1)
          return { records: [], hasNextPage: false };
        const item = await this.get(
          connection,
          targetResource,
          targetId,
          options.fields,
        );
        return { records: [item], hasNextPage: false, total: 1 };
      };
      if (provider === "salesforce") {
        if (
          (resource === "contacts" || resource === "deals") &&
          target === "companies"
        ) {
          const source = await this.get(connection, resource, id, [
            "AccountId",
          ]);
          return single("companies", str(source.AccountId));
        }
        if (
          resource === "companies" &&
          (target === "contacts" || target === "deals")
        ) {
          const fields = [
            ...new Set([
              "Id",
              ...options.fields.filter((field) => field !== "id"),
            ]),
          ];
          if (fields.some((field) => !safeName.test(field)))
            throw new CrmUnavailableError(
              "The requested CRM fields are invalid",
            );
          const fk = "AccountId";
          const query = `SELECT ${fields.join(",")} FROM ${nativeId(module, target)} WHERE ${fk} = '${id}' LIMIT ${Math.min(2000, options.perPage + 1)} OFFSET ${(options.page - 1) * options.perPage}`;
          const payload = await call(
            nango,
            connection,
            "GET",
            `/services/data/v60.0/query?${new URLSearchParams({ q: query })}`,
          );
          const fetched = responseRecords(module, payload);
          return {
            records: fetched.slice(0, options.perPage),
            hasNextPage: fetched.length > options.perPage,
          };
        }
      }
      if (provider === "zoho") {
        const relationField =
          resource === "contacts"
            ? "Account_Name"
            : resource === "deals"
              ? target === "companies"
                ? "Account_Name"
                : "Contact_Name"
              : undefined;
        if (
          (resource === "contacts" || resource === "deals") &&
          ((target === "companies" && relationField === "Account_Name") ||
            (resource === "deals" && target === "contacts"))
        ) {
          const source = await this.get(connection, resource, id, [
            relationField!,
          ]);
          return single(target, str(source[relationField!]));
        }
        if (
          (resource === "companies" &&
            (target === "contacts" || target === "deals")) ||
          (resource === "contacts" && target === "deals")
        ) {
          const fk = resource === "contacts" ? "Contact_Name" : "Account_Name";
          const fields = [
            ...new Set(options.fields.filter((field) => field !== "id")),
          ];
          const params = new URLSearchParams({
            criteria: `(${fk}:equals:${id})`,
            fields: fields.join(","),
            page: String(options.page),
            per_page: String(options.perPage),
          });
          const payload = await call(
            nango,
            connection,
            "GET",
            `/crm/v2/${nativeId(module, target)}/search?${params}`,
          );
          const fetched = responseRecords(module, payload);
          const info = record(payload.info);
          return { records: fetched, hasNextPage: info.more_records === true };
        }
      }
      if (provider === "pipedrive") {
        const reference =
          resource === "contacts" && target === "companies"
            ? "org_id"
            : resource === "deals" && target === "companies"
              ? "org_id"
              : resource === "deals" && target === "contacts"
                ? "person_id"
                : undefined;
        if (reference) {
          const source = await this.get(connection, resource, id, [reference]);
          return single(target, str(source[reference]));
        }
        if (
          (resource === "companies" &&
            (target === "contacts" || target === "deals")) ||
          (resource === "contacts" && target === "deals")
        ) {
          const path =
            resource === "companies"
              ? `/v1/organizations/${encodeURIComponent(id)}/${target === "contacts" ? "persons" : "deals"}`
              : `/v1/persons/${encodeURIComponent(id)}/deals`;
          const url = new URL(path, "https://savia.invalid");
          url.searchParams.set(
            "start",
            String((options.page - 1) * options.perPage),
          );
          url.searchParams.set("limit", String(options.perPage));
          const payload = await call(
            nango,
            connection,
            "GET",
            `${url.pathname}${url.search}`,
          );
          const records = responseRecords(module, payload);
          const pagination = record(record(payload.additional_data).pagination);
          return {
            records,
            hasNextPage: pagination.more_items_in_collection === true,
          };
        }
      }
      throw new HTTPException(405, {
        message: "This relationship is not supported by the CRM adapter",
      });
    },
    canEditLink(resource, target) {
      return provider === "salesforce"
        ? (resource === "contacts" || resource === "deals") &&
            target === "companies"
        : ((resource === "contacts" || resource === "deals") &&
            target === "companies") ||
            (resource === "deals" && target === "contacts");
    },
    async setLink(connection, resource, id, target, targetId, remove) {
      requireProvider(connection);
      validateId(module, id);
      validateId(module, targetId);
      if (!this.canEditLink?.(resource, target))
        throw new HTTPException(405, {
          message: "This relationship cannot be edited by the CRM adapter",
        });
      const field =
        provider === "salesforce"
          ? "AccountId"
          : provider === "zoho"
            ? resource === "deals" && target === "contacts"
              ? "Contact_Name"
              : "Account_Name"
            : resource === "deals" && target === "contacts"
              ? "person_id"
              : "org_id";
      if (remove) {
        const current = await this.get(connection, resource, id, [field]);
        if (str(current[field]) !== targetId)
          throw new HTTPException(409, {
            message: "The CRM relationship changed before it could be removed",
          });
      }
      await this.update(connection, resource, id, {
        [field]: remove ? null : targetId,
      });
    },
  };
}

function validateWrite(data: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(data);
  if (
    !entries.length ||
    entries.some(
      ([name, value]) =>
        !safeName.test(name) ||
        value === undefined ||
        (value !== null && typeof value === "object"),
    )
  )
    throw new CrmUnavailableError("The CRM record fields are invalid");
  return Object.fromEntries(entries);
}

function validateRequired(
  description: WorkspaceDescription,
  data: Record<string, unknown>,
): void {
  const unknown = Object.keys(data).filter(
    (field) => !description.fields[field],
  );
  const readonly = Object.keys(data).filter(
    (field) => description.fields[field]?.readOnly,
  );
  const missing = Object.entries(description.fields)
    .filter(
      ([field, definition]) => definition.required && data[field] === undefined,
    )
    .map(([field]) => field);
  if (unknown.length || readonly.length)
    throw new CrmUnavailableError("The requested CRM fields cannot be created");
  if (missing.length)
    throw new HTTPException(422, {
      message: `Required CRM fields are missing: ${missing.join(", ")}`,
    });
}

function providerWrite(
  provider: RemoteProviderId,
  resource: WorkspaceResource,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...validateWrite(data) };
  if (provider === "zoho")
    for (const field of resource === "companies"
      ? ["Owner"]
      : ["Account_Name", "Contact_Name", "Owner"]) {
      const value = normalized[field];
      if (typeof value === "string") normalized[field] = { id: value };
    }
  if (provider === "pipedrive") {
    for (const field of ["org_id", "person_id", "owner_id", "stage_id"])
      if (typeof normalized[field] === "string")
        normalized[field] = Number(normalized[field]);
    for (const field of ["email", "phone"])
      if (typeof normalized[field] === "string")
        normalized[field] = [{ value: normalized[field], primary: true }];
    if (
      resource === "contacts" &&
      (normalized.first_name !== undefined ||
        normalized.last_name !== undefined)
    ) {
      const name = [normalized.first_name, normalized.last_name]
        .filter((item) => typeof item === "string" && item.trim())
        .join(" ");
      if (name) normalized.name = name;
      delete normalized.first_name;
      delete normalized.last_name;
    }
  }
  if (
    Object.entries(normalized).some(
      ([name, value]) =>
        !safeName.test(name) ||
        value === undefined ||
        (value !== null &&
          typeof value === "object" &&
          !(
            provider === "zoho" &&
            ["Account_Name", "Contact_Name", "Owner"].includes(name) &&
            typeof record(value).id === "string"
          ) &&
          !(
            provider === "pipedrive" &&
            ["email", "phone"].includes(name) &&
            Array.isArray(value) &&
            value.every((entry) => typeof record(entry).value === "string")
          )),
    )
  )
    throw new CrmUnavailableError("The CRM record fields are invalid");
  return normalized;
}

function assertMutationSuccess(
  provider: RemoteProviderId,
  payload: Record<string, unknown>,
): void {
  if (provider === "pipedrive" && payload.success !== true)
    throw new CrmUpstreamError();
  if (provider === "zoho") {
    const first = record(array(payload.data)[0]);
    if (first.status !== "success" || first.code !== "SUCCESS")
      throw new CrmUpstreamError();
  }
}
