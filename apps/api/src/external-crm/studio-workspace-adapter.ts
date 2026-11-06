import { HTTPException } from "hono/http-exception";
import type { ActiveCrmConnection } from "./contracts";
import type {
  RemoteWorkspaceAdapter,
  WorkspaceDescription,
  WorkspaceResource,
} from "./workspace-adapter";

/** Translate native API identifiers without relaxing Studio's local identifier contract. */
export function studioWorkspaceAdapter(
  native: RemoteWorkspaceAdapter,
): RemoteWorkspaceAdapter {
  type Mapping = {
    description: WorkspaceDescription;
    nativeByLocal: Map<string, string>;
  };
  const descriptions = new Map<string, Promise<Mapping>>();
  async function mapping(
    connection: ActiveCrmConnection,
    resource: WorkspaceResource,
  ): Promise<Mapping> {
    const cacheKey = `${connection.id}:${connection.externalAccountId}:${resource}`;
    let pending = descriptions.get(cacheKey);
    if (!pending) {
      pending = native.describe(connection, resource).then((description) => {
        const nativeByLocal = new Map<string, string>();
        const fields: WorkspaceDescription["fields"] = {};
        for (const [name, field] of Object.entries(description.fields)) {
          if (name.toLowerCase() === "id") continue;
          let local = name.toLowerCase();
          if (
            !/^[a-z]/.test(local) ||
            ["created_at", "updated_at"].includes(local)
          )
            local = "crm_" + local;
          if (!/^[a-z][a-z0-9_]{0,47}$/.test(local) || nativeByLocal.has(local))
            throw new HTTPException(422, {
              message:
                "The CRM field names cannot be represented safely in this screen.",
            });
          nativeByLocal.set(local, name);
          fields[local] = field;
        }
        const title =
          [...nativeByLocal].find(
            ([, name]) => name === description.title,
          )?.[0] ?? "id";
        return {
          description: { ...description, fields, title },
          nativeByLocal,
        };
      });
      descriptions.set(cacheKey, pending);
    }
    return pending;
  }
  function project(record: Record<string, unknown>, mapped: Mapping) {
    return {
      id: record.id,
      ...Object.fromEntries(
        [...mapped.nativeByLocal].map(([local, name]) => [
          local,
          record[name] ?? null,
        ]),
      ),
      ...(record.created_at === undefined
        ? {}
        : { created_at: record.created_at }),
      ...(record.updated_at === undefined
        ? {}
        : { updated_at: record.updated_at }),
    };
  }
  function fieldsToNative(fields: string[], mapped: Mapping) {
    return fields.map((field) => {
      const native = mapped.nativeByLocal.get(field);
      if (!native)
        throw new HTTPException(422, {
          message:
            "The CRM field is no longer available. Reinstall this screen.",
        });
      return native;
    });
  }
  function valuesToNative(values: Record<string, unknown>, mapped: Mapping) {
    return Object.fromEntries(
      Object.entries(values).map(([field, value]) => {
        const native = mapped.nativeByLocal.get(field);
        if (!native)
          throw new HTTPException(422, { message: "Unknown CRM field." });
        return [native, value];
      }),
    );
  }
  return {
    resources: native.resources,
    async describe(connection, resource) {
      return (await mapping(connection, resource)).description;
    },
    async list(connection, resource, options) {
      const mapped = await mapping(connection, resource);
      const result = await native.list(connection, resource, {
        ...options,
        fields: fieldsToNative(options.fields, mapped),
      });
      return {
        ...result,
        records: result.records.map((record) => project(record, mapped)),
      };
    },
    async get(connection, resource, id, fields) {
      const mapped = await mapping(connection, resource);
      return project(
        await native.get(
          connection,
          resource,
          id,
          fieldsToNative(fields, mapped),
        ),
        mapped,
      );
    },
    async create(connection, resource, values) {
      const mapped = await mapping(connection, resource);
      return project(
        await native.create(
          connection,
          resource,
          valuesToNative(values, mapped),
        ),
        mapped,
      );
    },
    async update(connection, resource, id, values) {
      const mapped = await mapping(connection, resource);
      return project(
        await native.update(
          connection,
          resource,
          id,
          valuesToNative(values, mapped),
        ),
        mapped,
      );
    },
    async links(connection, resource, id, target, options) {
      const mapped = await mapping(connection, target);
      const result = await native.links(connection, resource, id, target, {
        ...options,
        fields: fieldsToNative(options.fields, mapped),
      });
      return {
        ...result,
        records: result.records.map((record) => project(record, mapped)),
      };
    },
    ...(native.canEditLink
      ? { canEditLink: native.canEditLink.bind(native) }
      : {}),
    ...(native.setLink ? { setLink: native.setLink.bind(native) } : {}),
    ...(native.origin ? { origin: native.origin.bind(native) } : {}),
  };
}
