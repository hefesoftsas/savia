const STATE_KEY = "backup-gate:v1";
const OBJECT_NAME = "production-backup-v1";
const MIN_TTL_MS = 30_000;
const MAX_TTL_MS = 300_000;
const WRAPPER_CACHES = new WeakMap();
const GATE_CLIENTS = new WeakMap();
const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_GATE_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [50, 100];

function json(body, status = 200) {
  return Response.json(body, { status });
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function newState() {
  return { version: 1, lease: null, permits: {} };
}

function normalizedState(value) {
  if (value === undefined) return newState();
  const state = asObject(value);
  if (!state || state.version !== 1 || !asObject(state.permits)) {
    throw new Error("invalid persisted backup coordinator state");
  }
  if (state.lease !== null) {
    if (
      !asObject(state.lease) ||
      !validOwner(state.lease.owner) ||
      !Number.isFinite(state.lease.expiresAt)
    ) {
      throw new Error("invalid persisted backup coordinator lease");
    }
  }
  for (const [permit, entry] of Object.entries(state.permits)) {
    if (
      !validPermit(permit) ||
      !asObject(entry) ||
      !Number.isFinite(entry.createdAt)
    ) {
      throw new Error("invalid persisted backup coordinator permit");
    }
  }
  return {
    version: 1,
    lease: state.lease,
    permits: state.permits,
  };
}

function validOwner(owner) {
  return (
    typeof owner === "string" && owner.trim().length > 0 && owner.length <= 256
  );
}

function validPermit(permit) {
  return typeof permit === "string" && UUID_PATTERN.test(permit);
}

function validTtl(ttlMs) {
  return Number.isInteger(ttlMs) && ttlMs >= MIN_TTL_MS && ttlMs <= MAX_TTL_MS;
}

function activeCount(state) {
  return Object.keys(state.permits).length;
}

/**
 * Durable Object that coordinates a production backup with application writes.
 * Its internal routes should only be exposed through an authenticated worker route.
 */
export class BackupCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.tail = Promise.resolve();
  }

  fetch(request) {
    const operation = this.tail.then(() => this.#handle(request));
    this.tail = operation.catch(() => undefined);
    return operation.catch((error) => {
      // Storage failures must fail closed. A failed enter/acquire is never treated as success.
      return json({ error: "backup coordinator unavailable" }, 500);
    });
  }

  async #read() {
    return normalizedState(await this.state.storage.get(STATE_KEY));
  }

  async #write(value) {
    await this.state.storage.put(STATE_KEY, value);
  }

  async #handle(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (path === "/status" && request.method === "POST") {
      let body;
      try {
        body = asObject(await request.json());
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }
      if (!body || !validOwner(body.owner))
        return json({ error: "owner is required" }, 400);
      const current = await this.#read();
      if (current.lease && current.lease.expiresAt <= Date.now()) {
        current.lease = null;
        await this.#write(current);
      }
      if (current.lease && current.lease.owner !== body.owner) {
        return json({ error: "backup lease is held by another owner" }, 409);
      }
      const active = activeCount(current);
      return json({
        owner: current.lease?.owner ?? null,
        expiresAt: current.lease?.expiresAt ?? null,
        active,
        drained: active === 0,
      });
    }

    if (request.method !== "POST") return json({ error: "not found" }, 404);
    let body;
    try {
      body = asObject(await request.json());
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }
    if (!body) return json({ error: "invalid JSON body" }, 400);

    const current = await this.#read();
    if (current.lease && current.lease.expiresAt <= Date.now())
      current.lease = null;

    if (path === "/enter") {
      if (!validPermit(body.permit))
        return json({ error: "permit must be a UUID" }, 400);
      if (Object.hasOwn(current.permits, body.permit))
        return json({ permit: body.permit });
      if (current.lease) {
        await this.#write(current);
        return json({ error: "backup in progress" }, 503);
      }
      current.permits[body.permit] = { createdAt: Date.now() };
      await this.#write(current);
      return json({ permit: body.permit });
    }

    if (path === "/leave") {
      if (!validPermit(body.permit))
        return json({ error: "permit must be a UUID" }, 400);
      if (Object.hasOwn(current.permits, body.permit)) {
        delete current.permits[body.permit];
        await this.#write(current);
      }
      return json({ ok: true, active: activeCount(current) });
    }

    if (path === "/acquire") {
      if (!validOwner(body.owner) || !validTtl(body.ttlMs)) {
        return json(
          { error: "owner and ttlMs (30000..300000) are required" },
          400,
        );
      }
      if (current.lease && current.lease.owner !== body.owner) {
        await this.#write(current);
        return json(
          { error: "backup lease is held", lease: current.lease },
          409,
        );
      }
      current.lease = { owner: body.owner, expiresAt: Date.now() + body.ttlMs };
      await this.#write(current);
      const active = activeCount(current);
      return json({ ...current.lease, active, drained: active === 0 });
    }

    if (path === "/renew") {
      if (!validOwner(body.owner) || !validTtl(body.ttlMs)) {
        return json(
          { error: "owner and ttlMs (30000..300000) are required" },
          400,
        );
      }
      if (!current.lease || current.lease.owner !== body.owner) {
        if (current.lease === null) await this.#write(current);
        return json({ error: "backup lease is not held by owner" }, 409);
      }
      current.lease.expiresAt = Date.now() + body.ttlMs;
      await this.#write(current);
      const active = activeCount(current);
      return json({ ...current.lease, active, drained: active === 0 });
    }

    if (path === "/release") {
      if (!validOwner(body.owner))
        return json({ error: "owner is required" }, 400);
      if (!current.lease || current.lease.owner !== body.owner) {
        if (current.lease === null) await this.#write(current);
        return json({ error: "backup lease is not held by owner" }, 409);
      }
      current.lease = null;
      await this.#write(current);
      const active = activeCount(current);
      return json({
        ok: true,
        owner: null,
        expiresAt: null,
        active,
        drained: active === 0,
      });
    }

    return json({ error: "not found" }, 404);
  }
}

function makeGateClient(namespace) {
  const cached = GATE_CLIENTS.get(namespace);
  if (cached) return cached;
  const id = namespace.idFromName(OBJECT_NAME);
  const client = {
    identity: null,
    async enter(permit) {
      if (!validPermit(permit))
        throw new Error("backup gate permit must be a UUID");
      const response = await requestWithRetry("enter", { permit });
      const payload = await response.json();
      if (payload?.permit !== permit) {
        throw new Error("backup gate returned an invalid permit");
      }
      return permit;
    },
    async leave(permit) {
      if (!validPermit(permit))
        throw new Error("backup gate permit must be a UUID");
      await requestWithRetry("leave", { permit });
    },
  };
  async function requestWithRetry(action, body) {
    let lastError;
    for (let attempt = 0; attempt < MAX_GATE_ATTEMPTS; attempt += 1) {
      let response;
      try {
        // Durable Object stubs are request-bound in Workers. Resolve one per
        // attempt so concurrent requests never share a stub across ownership.
        const stub = namespace.get(id);
        response = await stub.fetch(
          new Request(`https://backup-gate.internal/${action}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10_000),
          }),
        );
      } catch (error) {
        lastError = error;
      }
      if (response?.ok) return response;
      if (response) {
        lastError = new Error(
          `backup gate ${action} failed (${response.status})`,
        );
        // Enter 503 means the gate is intentionally closed. Leave retries 5xx because
        // the durable permit ID makes the operation idempotent.
        if (
          response.status < 500 ||
          (action === "enter" && response.status === 503)
        ) {
          throw lastError;
        }
      }
      if (attempt + 1 < MAX_GATE_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAYS_MS[attempt]),
        );
      }
    }
    throw lastError ?? new Error(`backup gate ${action} failed`);
  }
  client.identity = client;
  GATE_CLIENTS.set(namespace, client);
  return client;
}

async function guardedWrite(gate, callback) {
  const permit = crypto.randomUUID();
  try {
    await gate.enter(permit);
  } catch (enterError) {
    try {
      await gate.leave(permit);
    } catch (leaveError) {
      throw new AggregateError(
        [enterError, leaveError],
        "backup gate enter failed and its permit cleanup could not be confirmed",
      );
    }
    throw enterError;
  }
  try {
    return await callback();
  } finally {
    await gate.leave(permit);
  }
}

function wrapD1(database, gate, proxies, originals) {
  if (!database || typeof database !== "object") return database;
  if (proxies.has(database)) return proxies.get(database);
  const proxy = new Proxy(database, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;

      if (property === "prepare") {
        return (...args) =>
          wrapStatement(value.apply(target, args), gate, proxies, originals);
      }
      if (property === "batch") {
        return (statements, ...args) =>
          guardedWrite(gate, () =>
            value.apply(target, [
              Array.isArray(statements)
                ? statements.map(
                    (statement) => originals.get(statement) ?? statement,
                  )
                : statements,
              ...args,
            ]),
          );
      }
      if (property === "exec")
        return (...args) => guardedWrite(gate, () => value.apply(target, args));
      if (property === "withSession") {
        return (...args) =>
          wrapD1(value.apply(target, args), gate, proxies, originals);
      }
      return value.bind(target);
    },
  });
  proxies.set(database, proxy);
  originals.set(proxy, database);
  return proxy;
}

function wrapStatement(statement, gate, proxies, originals) {
  if (!statement || typeof statement !== "object") return statement;
  if (proxies.has(statement)) return proxies.get(statement);
  const writes = new Set(["run", "all", "raw", "first"]);
  const proxy = new Proxy(statement, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (property === "bind") {
        return (...args) =>
          wrapStatement(value.apply(target, args), gate, proxies, originals);
      }
      if (writes.has(property))
        return (...args) => guardedWrite(gate, () => value.apply(target, args));
      return value.bind(target);
    },
  });
  proxies.set(statement, proxy);
  originals.set(proxy, statement);
  return proxy;
}

function wrapMultipart(upload, gate, proxies, originals) {
  if (!upload || typeof upload !== "object") return upload;
  if (proxies.has(upload)) return proxies.get(upload);
  const writes = new Set(["uploadPart", "complete", "abort"]);
  const proxy = new Proxy(upload, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (writes.has(property))
        return (...args) => guardedWrite(gate, () => value.apply(target, args));
      return value.bind(target);
    },
  });
  proxies.set(upload, proxy);
  originals.set(proxy, upload);
  return proxy;
}

function wrapR2(bucket, gate, proxies, originals) {
  if (!bucket || typeof bucket !== "object") return bucket;
  if (proxies.has(bucket)) return proxies.get(bucket);
  const writes = new Set(["put", "delete"]);
  const proxy = new Proxy(bucket, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (writes.has(property))
        return (...args) => guardedWrite(gate, () => value.apply(target, args));
      if (property === "createMultipartUpload") {
        return (...args) =>
          guardedWrite(gate, async () =>
            wrapMultipart(
              await value.apply(target, args),
              gate,
              proxies,
              originals,
            ),
          );
      }
      if (property === "resumeMultipartUpload") {
        return (...args) =>
          wrapMultipart(value.apply(target, args), gate, proxies, originals);
      }
      return value.bind(target);
    },
  });
  proxies.set(bucket, proxy);
  originals.set(proxy, bucket);
  return proxy;
}

/**
 * Wrap D1 and R2 environment bindings so each storage mutation holds a durable
 * write permit for its full asynchronous operation. With no namespace this is
 * a passthrough unless SAVIA_BACKUP_GATE_REQUIRED is exactly "true".
 * @template {object} T
 * @param {T} env
 * @returns {T}
 */
export function guardStorageEnvironment(env) {
  const namespace = env?.BACKUP_GATE;
  const required = env?.SAVIA_BACKUP_GATE_REQUIRED === "true";
  if (!namespace) {
    if (required)
      throw new Error(
        "BACKUP_GATE binding is required when SAVIA_BACKUP_GATE_REQUIRED=true",
      );
    return env;
  }
  if (
    typeof namespace.idFromName !== "function" ||
    typeof namespace.get !== "function"
  ) {
    throw new Error("BACKUP_GATE binding is invalid");
  }
  const gate = makeGateClient(namespace);
  let gateCaches = WRAPPER_CACHES.get(gate.identity);
  if (!gateCaches) {
    gateCaches = { proxies: new WeakMap(), originals: new WeakMap() };
    WRAPPER_CACHES.set(gate.identity, gateCaches);
  }
  const { proxies, originals } = gateCaches;
  return new Proxy(env, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (!value || typeof value !== "object") return value;
      if (proxies.has(value)) return proxies.get(value);
      let result = value;
      if (
        typeof value.prepare === "function" &&
        typeof value.batch === "function" &&
        typeof value.exec === "function"
      ) {
        result = wrapD1(value, gate, proxies, originals);
      } else if (
        typeof value.get === "function" &&
        typeof value.put === "function" &&
        typeof value.list === "function" &&
        typeof value.delete === "function"
      ) {
        result = wrapR2(value, gate, proxies, originals);
      }
      return result;
    },
  });
}

export const BACKUP_GATE_OBJECT_NAME = OBJECT_NAME;
