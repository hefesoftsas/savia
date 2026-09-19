import type { AccessPolicy } from "./access-control";
import type { CrmObject } from "./metadata";

export type PluginHostRequest = <T>(
  path: string,
  method?: string,
  data?: unknown,
  options?: { responseType?: "blob" },
) => Promise<T>;

export type PluginCollectionDefinition = Pick<
  CrmObject,
  "name" | "label" | "description" | "config"
>;

export type PluginRecordPage<T> = {
  data: T[];
  total: number;
  page: number;
  perPage: number;
};

export type PluginCollectionListOptions = {
  page?: number;
  perPage?: number;
  sort?: string;
  order?: "ASC" | "DESC";
};

export type PluginRecordVersion = { version?: number };

export type PluginSettings<T extends Record<string, unknown>> = {
  value: T;
  version: number;
  updatedAt: string | null;
};

export type PluginExtensionConnectionSummary = {
  connectionId: string;
  connectorId: string;
  configured: true;
  updatedAt: string;
};

export type PluginActionResult<T> = {
  run: { runId: string; status: string };
  output: T;
};

export type PluginExtensionActionRun = {
  runId: string;
  actionId: string;
  connectionId: string;
  status: "pending" | "succeeded" | "failed" | "expired";
  output: unknown;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PluginCollection<TRecord, TInput = Partial<TRecord>> = {
  list(
    options?: PluginCollectionListOptions,
  ): Promise<PluginRecordPage<TRecord>>;
  get(id: string): Promise<TRecord>;
  create(input: TInput): Promise<TRecord>;
  update(
    id: string,
    input: TInput,
    options?: PluginRecordVersion,
  ): Promise<TRecord>;
  remove(id: string, options?: PluginRecordVersion): Promise<void>;
  describe(): Promise<PluginCollectionDefinition | undefined>;
};

export type PluginFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  version: number;
  created_at?: string;
};
export type PluginFiles = {
  list(object: string, recordId: string): Promise<PluginFile[]>;
  upload(object: string, recordId: string, file: File): Promise<PluginFile>;
  download(id: string): Promise<Blob>;
  remove(id: string, version: number): Promise<void>;
};
export type PluginApi = {
  files?: PluginFiles;
  access?: { effective(): Promise<AccessPolicy | null> };
  settings: {
    get<T extends Record<string, unknown>>(): Promise<PluginSettings<T>>;
    replace<T extends Record<string, unknown>>(
      value: T,
      version: number,
    ): Promise<PluginSettings<T>>;
  };
  connections: {
    list(): Promise<PluginExtensionConnectionSummary[]>;
    replace(
      connectionId: string,
      value: { connectorId: string; values: Record<string, unknown> },
    ): Promise<void>;
    remove(connectionId: string): Promise<void>;
  };
  actions: {
    execute<T>(
      actionId: string,
      input: { connectionId?: string; input: Record<string, unknown> },
    ): Promise<PluginActionResult<T>>;
    list(options?: { limit?: number }): Promise<PluginExtensionActionRun[]>;
  };
  collections: {
    list(): Promise<PluginCollectionDefinition[]>;
    collection<TRecord, TInput = Partial<TRecord>>(
      name: string,
    ): PluginCollection<TRecord, TInput>;
  };
  services: {
    get<T>(name: string): Promise<T>;
  };
};

type HostData<T> = { data: T };

export function createPluginApi({
  extensionId,
  request,
}: {
  extensionId: string;
  request: PluginHostRequest;
}): PluginApi {
  const extensionPath = `/extensions/${encodeURIComponent(extensionId)}`;
  const collections: PluginApi["collections"] = {
    list: async () =>
      (await request<HostData<PluginCollectionDefinition[]>>("/objects", "GET"))
        .data,
    collection: <TRecord, TInput = Partial<TRecord>>(
      name: string,
    ): PluginCollection<TRecord, TInput> => {
      const resource = encodeURIComponent(name);
      const describe = async (): Promise<
        PluginCollectionDefinition | undefined
      > =>
        (await collections.list()).find(
          (collection) => collection.name === name,
        );
      return {
        async list(options = {}) {
          const parameters = new URLSearchParams({
            page: String(options.page ?? 1),
            perPage: String(options.perPage ?? 25),
            sort: options.sort ?? "updated_at",
            order: options.order ?? "DESC",
          });
          return request<PluginRecordPage<TRecord>>(
            `/records/${resource}?${parameters}`,
            "GET",
          );
        },
        async get(id) {
          return (
            await request<HostData<TRecord>>(
              `/records/${resource}/${encodeURIComponent(id)}`,
              "GET",
            )
          ).data;
        },
        async create(input) {
          return (
            await request<HostData<TRecord>>(
              `/records/${resource}`,
              "POST",
              input,
            )
          ).data;
        },
        async update(id, input, options = {}) {
          return (
            await request<HostData<TRecord>>(
              `/records/${resource}/${encodeURIComponent(id)}`,
              "PATCH",
              {
                ...input,
                ...(options.version === undefined
                  ? {}
                  : { _version: options.version }),
              },
            )
          ).data;
        },
        async remove(id, options = {}) {
          const parameters = new URLSearchParams();
          if (options.version !== undefined)
            parameters.set("version", String(options.version));
          await request(
            `/records/${resource}/${encodeURIComponent(id)}${
              parameters.size ? `?${parameters}` : ""
            }`,
            "DELETE",
          );
        },
        describe,
      };
    },
  };

  return {
    access: {
      async effective() {
        return (
          await request<HostData<AccessPolicy | null>>("/access-context", "GET")
        ).data;
      },
    },
    files: {
      async list(object, recordId) {
        return (
          await request<HostData<PluginFile[]>>(
            `/files/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}`,
            "GET",
          )
        ).data;
      },
      async upload(object, recordId, file) {
        const form = new FormData();
        form.set("file", file);
        return (
          await request<HostData<PluginFile>>(
            `/files/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}`,
            "POST",
            form,
          )
        ).data;
      },
      download: (id) =>
        request<Blob>(
          `/file/${encodeURIComponent(id)}/download`,
          "GET",
          undefined,
          { responseType: "blob" },
        ),
      async remove(id, version) {
        await request(`/file/${encodeURIComponent(id)}`, "DELETE", { version });
      },
    },
    settings: {
      async get<T extends Record<string, unknown>>() {
        return (
          await request<HostData<PluginSettings<T>>>(
            `${extensionPath}/settings`,
            "GET",
          )
        ).data;
      },
      async replace<T extends Record<string, unknown>>(
        value: T,
        version: number,
      ) {
        return (
          await request<HostData<PluginSettings<T>>>(
            `${extensionPath}/settings`,
            "PUT",
            { value, version },
          )
        ).data;
      },
    },
    connections: {
      async list() {
        return (
          await request<HostData<PluginExtensionConnectionSummary[]>>(
            `${extensionPath}/connections`,
            "GET",
          )
        ).data;
      },
      async replace(connectionId, value) {
        await request(
          `${extensionPath}/connections/${encodeURIComponent(connectionId)}`,
          "PUT",
          value,
        );
      },
      async remove(connectionId) {
        await request(
          `${extensionPath}/connections/${encodeURIComponent(connectionId)}`,
          "DELETE",
        );
      },
    },
    actions: {
      async list(options = {}) {
        const requestedLimit = options.limit ?? 20;
        const limit = Math.min(
          100,
          Math.max(
            1,
            Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 20,
          ),
        );
        return (
          await request<HostData<PluginExtensionActionRun[]>>(
            `${extensionPath}/actions/runs?limit=${limit}`,
            "GET",
          )
        ).data;
      },
      async execute<T>(
        actionId: string,
        input: { connectionId?: string; input: Record<string, unknown> },
      ) {
        return (
          await request<HostData<PluginActionResult<T>>>(
            `${extensionPath}/actions/${encodeURIComponent(actionId)}`,
            "POST",
            input,
          )
        ).data;
      },
    },
    collections,
    services: {
      async get<T>(name: string): Promise<T> {
        return (
          await request<HostData<T>>(
            `/extensions/${encodeURIComponent(extensionId)}/${encodeURIComponent(name)}`,
            "GET",
          )
        ).data;
      },
    },
  };
}
