import type {
  PluginApi,
  PluginCollection,
  PluginCollectionDefinition,
  PluginCollectionListOptions,
  PluginQueryCondition,
  PluginRecordPage,
} from "./index";

type MockRecord = Record<string, unknown> & { id: string; _version?: number };
export type MockPluginCollection = {
  definition: PluginCollectionDefinition;
  records?: MockRecord[];
};
export type MockPluginApiOptions = {
  collections?: MockPluginCollection[];
  /** Fail matching operation keys such as `tasks:update` or `collections:list`. */
  deny?: string[];
  /** Make every supported API operation fail as a network error. */
  offline?: boolean;
  /** Cause matching updates/deletes to fail with a version conflict. */
  conflict?: boolean | { collection: string; id: string };
};

export class MockPluginError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MockPluginError";
  }
}

/**
 * Build a small in-memory API for plugin development. Collections support list,
 * get, create, update, remove and describe. Other PluginApi features reject
 * with an explicit unsupported-operation error.
 */
export function createMockPluginApi(
  options: MockPluginApiOptions = {},
): PluginApi {
  const data = new Map<string, MockRecord[]>();
  const definitions = new Map<string, PluginCollectionDefinition>();
  for (const item of options.collections ?? []) {
    definitions.set(item.definition.name, structuredClone(item.definition));
    data.set(
      item.definition.name,
      (item.records ?? []).map((record) => ({
        ...structuredClone(record),
        _version: record._version ?? 1,
      })),
    );
  }
  const usedIds = new Set(
    [...data.values()].flatMap((records) => records.map((record) => record.id)),
  );
  let generatedId = 1;

  const check = (operation: string) => {
    if (options.offline)
      throw new MockPluginError("Mock API is offline.", "network_error", 0);
    if (options.deny?.includes(operation))
      throw new MockPluginError(
        `Permission denied: ${operation}`,
        "forbidden",
        403,
      );
  };
  const getCollection = (name: string) => {
    check(`${name}:schema`);
    const definition = definitions.get(name);
    if (!definition)
      throw new MockPluginError(
        `Unknown collection: ${name}`,
        "not_found",
        404,
      );
    return definition;
  };
  const getRecords = (name: string) => {
    getCollection(name);
    return data.get(name)!;
  };
  const checkConflict = (name: string, id: string, version?: number) => {
    const record = data.get(name)!.find((item) => item.id === id);
    if (!record)
      throw new MockPluginError(`Record not found: ${id}`, "not_found", 404);
    const forced =
      options.conflict === true ||
      (typeof options.conflict === "object" &&
        options.conflict.collection === name &&
        options.conflict.id === id);
    if (forced || (version !== undefined && version !== record._version))
      throw new MockPluginError(
        "Record version conflict.",
        "version_conflict",
        409,
      );
    return record;
  };

  const collection = <T extends MockRecord>(
    name: string,
  ): PluginCollection<T> => ({
    async list(query = {}): Promise<PluginRecordPage<T>> {
      check(`${name}:list`);
      let records = [...getRecords(name)] as T[];
      if (query.q) {
        const fields = query.searchFields ?? [];
        records = records.filter((record) =>
          fields.some((field) =>
            String(record[field] ?? "")
              .toLowerCase()
              .includes(query.q!.toLowerCase()),
          ),
        );
      }
      if (query.filters) {
        const matches = (record: T, condition: PluginQueryCondition) => {
          const value = record[condition.field];
          switch (condition.op) {
            case "eq":
              return value === condition.value;
            case "ne":
              return value !== condition.value;
            case "gt":
              return (value as never) > (condition.value as never);
            case "gte":
              return (value as never) >= (condition.value as never);
            case "lt":
              return (value as never) < (condition.value as never);
            case "lte":
              return (value as never) <= (condition.value as never);
            case "contains":
              return String(value ?? "").includes(
                String(condition.value ?? ""),
              );
            case "startsWith":
              return String(value ?? "").startsWith(
                String(condition.value ?? ""),
              );
            case "endsWith":
              return String(value ?? "").endsWith(
                String(condition.value ?? ""),
              );
            case "empty":
              return value === null || value === undefined || value === "";
            case "in":
              return (
                Array.isArray(condition.value) &&
                condition.value.includes(value)
              );
          }
        };
        const conditions = query.filters.conditions;
        records = records.filter((record) =>
          query.filters!.logic === "or"
            ? conditions.some((condition) => matches(record, condition))
            : conditions.every((condition) => matches(record, condition)),
        );
      }
      if (query.sort) {
        const direction = query.order === "ASC" ? 1 : -1;
        records.sort(
          (left, right) =>
            String(left[query.sort!] ?? "").localeCompare(
              String(right[query.sort!] ?? ""),
            ) * direction,
        );
      }
      const total = records.length;
      const page = Math.max(1, Math.floor(query.page ?? 1));
      const perPage = Math.max(
        1,
        Math.min(500, Math.floor(query.perPage ?? 25)),
      );
      return {
        data: structuredClone(
          records.slice((page - 1) * perPage, page * perPage),
        ),
        total,
        page,
        perPage,
      };
    },
    async get(id): Promise<T> {
      check(`${name}:read`);
      const record = getRecords(name).find((item) => item.id === id);
      if (!record)
        throw new MockPluginError(`Record not found: ${id}`, "not_found", 404);
      return structuredClone(record) as T;
    },
    async create(input): Promise<T> {
      check(`${name}:create`);
      const records = getRecords(name);
      const record = {
        ...structuredClone(input),
        id: (() => {
          let id: string;
          do id = `mock-${generatedId++}`;
          while (usedIds.has(id));
          usedIds.add(id);
          return id;
        })(),
        _version: 1,
      } as T;
      if (records.some((item) => item.id === record.id))
        throw new MockPluginError(
          `Record already exists: ${record.id}`,
          "conflict",
          409,
        );
      records.push(record);
      return structuredClone(record);
    },
    async update(id, input, recordOptions = {}): Promise<T> {
      check(`${name}:update`);
      const records = getRecords(name);
      const current = checkConflict(name, id, recordOptions.version);
      const updated = {
        ...current,
        ...structuredClone(input),
        id,
        _version: (current._version ?? 0) + 1,
      } as T;
      records[records.indexOf(current)] = updated;
      return structuredClone(updated);
    },
    async remove(id, recordOptions = {}): Promise<void> {
      check(`${name}:delete`);
      const records = getRecords(name);
      checkConflict(name, id, recordOptions.version);
      records.splice(
        records.findIndex((record) => record.id === id),
        1,
      );
    },
    async describe() {
      check(`${name}:schema`);
      return definitions.get(name);
    },
  });

  const unsupported = (name: string) => async (): Promise<never> => {
    throw new Error(`Mock PluginApi does not support ${name}.`);
  };
  return {
    collections: {
      async list() {
        check("collections:list");
        return [...definitions.values()].map((definition) =>
          structuredClone(definition),
        );
      },
      collection: <T, I = Partial<T>>(name: string) =>
        collection<T & MockRecord>(name) as unknown as PluginCollection<T, I>,
    },
    settings: {
      get: unsupported("settings.get"),
      replace: unsupported("settings.replace"),
    },
    connections: {
      list: unsupported("connections.list"),
      replace: unsupported("connections.replace"),
      remove: unsupported("connections.remove"),
    },
    actions: {
      execute: unsupported("actions.execute"),
      list: unsupported("actions.list"),
    },
    services: { get: unsupported("services.get") },
  } as unknown as PluginApi;
}
