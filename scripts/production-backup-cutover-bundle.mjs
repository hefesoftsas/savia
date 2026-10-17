import { randomUUID } from "node:crypto";

const JS_MODULE = /\.(?:js|mjs|cjs)$/i;
const RESERVED_BINDINGS = new Set([
  "BACKUP_GATE",
  "SAVIA_BACKUP_GATE_REQUIRED",
  "SAVIA_MAINTENANCE",
]);

function boundaryFrom(contentType) {
  const match =
    /^multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(
      contentType ?? "",
    );
  if (!match) throw new Error("Worker bundle must be multipart/form-data");
  return match[1] ?? match[2];
}

function dispositionName(headerLines) {
  const line = headerLines.find((value) =>
    value.toLowerCase().startsWith("content-disposition:"),
  );
  if (!line) return undefined;
  const value = line.slice(line.indexOf(":") + 1);
  let cursor = 0;
  while (cursor < value.length) {
    while (cursor < value.length && /[\s;]/.test(value[cursor])) cursor += 1;
    const keyStart = cursor;
    while (
      cursor < value.length &&
      value[cursor] !== "=" &&
      value[cursor] !== ";"
    )
      cursor += 1;
    if (cursor >= value.length || value[cursor] !== "=") {
      while (cursor < value.length && value[cursor] !== ";") cursor += 1;
      continue;
    }
    const key = value.slice(keyStart, cursor).trim().toLowerCase();
    cursor += 1;
    while (cursor < value.length && /\s/.test(value[cursor])) cursor += 1;
    let parameter = "";
    if (value[cursor] === '"') {
      cursor += 1;
      let closed = false;
      while (cursor < value.length) {
        const char = value[cursor];
        if (char === '"') {
          cursor += 1;
          closed = true;
          break;
        }
        if (char === "\\") {
          cursor += 1;
          if (cursor >= value.length) return undefined;
        }
        parameter += value[cursor];
        cursor += 1;
      }
      if (!closed) return undefined;
    } else {
      const start = cursor;
      while (cursor < value.length && value[cursor] !== ";") cursor += 1;
      parameter = value.slice(start, cursor).trim();
    }
    if (key === "name") return parameter;
    while (cursor < value.length && value[cursor] !== ";") cursor += 1;
  }
  return undefined;
}

function readRawParts(buffer, boundary) {
  const marker = Buffer.from(`--${boundary}`);
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  const parts = [];
  let cursor = buffer.indexOf(marker);
  if (cursor !== 0)
    throw new Error("Worker bundle has an invalid multipart body");
  cursor += marker.length;
  while (cursor < buffer.length) {
    if (buffer.subarray(cursor, cursor + 2).equals(Buffer.from("--"))) break;
    if (!buffer.subarray(cursor, cursor + 2).equals(Buffer.from("\r\n")))
      throw new Error("Worker bundle has an invalid multipart boundary");
    cursor += 2;
    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd < 0)
      throw new Error("Worker bundle has incomplete part headers");
    const headerText = buffer.subarray(cursor, headerEnd).toString("latin1");
    const headerLines = headerText.split("\r\n");
    const name = dispositionName(headerLines);
    if (!name) throw new Error("Worker bundle part is missing its field name");
    const contentTypeLine = headerLines.find((line) =>
      line.toLowerCase().startsWith("content-type:"),
    );
    const type = contentTypeLine
      ?.slice(contentTypeLine.indexOf(":") + 1)
      .trim()
      .split(";", 1)[0];
    const payloadStart = headerEnd + 4;
    const payloadEnd = buffer.indexOf(delimiter, payloadStart);
    if (payloadEnd < 0)
      throw new Error("Worker bundle has an unterminated part");
    parts.push({
      name,
      type: type || null,
      bytes: buffer.subarray(payloadStart, payloadEnd),
    });
    cursor = payloadEnd + 2 + marker.length;
  }
  return parts;
}

function inferType(name) {
  if (/\.m?js$/i.test(name)) return "application/javascript+module";
  if (/\.wasm$/i.test(name)) return "application/wasm";
  if (/\.json$/i.test(name)) return "application/json";
  return "application/octet-stream";
}

/** Parse a Cloudflare multipart Worker bundle without losing module payload bytes. */
export async function parseWorkerBundle(buffer, contentType) {
  const bytes = Buffer.from(buffer);
  const boundary = boundaryFrom(contentType);
  const rawParts = readRawParts(bytes, boundary);
  const form = await new Response(bytes, {
    headers: { "Content-Type": contentType },
  }).formData();
  const parsed = [];
  for (const [name, value] of form.entries()) {
    const rawIndex = rawParts.findIndex(
      (part, index) =>
        !parsed.some((item) => item.rawIndex === index) && part.name === name,
    );
    if (rawIndex < 0)
      throw new Error("Worker bundle multipart parts do not match");
    const raw = rawParts[rawIndex];
    if (name === "metadata") continue;
    parsed.push({
      rawIndex,
      module: {
        name,
        type:
          raw.type ||
          (typeof value === "string"
            ? inferType(name)
            : value.type || inferType(name)),
        bytes: Buffer.from(raw.bytes),
      },
    });
  }
  const modules = parsed.map(({ module }) => module);
  const jsModules = modules.filter(({ name }) => JS_MODULE.test(name));
  const indexed = jsModules.filter(({ name }) => name === "index.js");
  let mainModule;
  if (indexed.length === 1) mainModule = indexed[0].name;
  else if (jsModules.length === 1) mainModule = jsModules[0].name;
  else if (jsModules.length === 0)
    throw new Error("Worker bundle has no JavaScript entry module");
  else
    throw new Error("Worker bundle has an ambiguous JavaScript entry module");
  return { mainModule, modules };
}

function normalizedSnapshot(snapshot) {
  if (snapshot && Array.isArray(snapshot.modules)) {
    const modules = snapshot.modules.map(({ name, type, bytes }) => {
      if (
        typeof name !== "string" ||
        !name ||
        (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array))
      )
        throw new Error("Worker snapshot contains an invalid module");
      return { name, type: type || inferType(name), bytes: Buffer.from(bytes) };
    });
    return { mainModule: snapshot.mainModule, modules };
  }
  if (snapshot?.bundle && snapshot.contentType)
    return parseWorkerBundle(snapshot.bundle, snapshot.contentType);
  if (Buffer.isBuffer(snapshot) || snapshot instanceof Uint8Array)
    throw new Error(
      "Worker snapshot contentType is required for multipart bundles",
    );
  throw new Error(
    "Worker snapshot must include a multipart bundle or parsed modules",
  );
}

function entryModule(snapshot) {
  const modules = snapshot.modules.filter(({ name }) => JS_MODULE.test(name));
  if (snapshot.mainModule) {
    if (!modules.some(({ name }) => name === snapshot.mainModule))
      throw new Error(
        "Worker snapshot main module is missing from its modules",
      );
    return snapshot.mainModule;
  }
  const indexed = modules.filter(({ name }) => name === "index.js");
  if (indexed.length === 1) return indexed[0].name;
  if (modules.length === 1) return modules[0].name;
  if (modules.length === 0)
    throw new Error("Worker bundle has no JavaScript entry module");
  throw new Error("Worker bundle has an ambiguous JavaScript entry module");
}

function guardSource({ mainModule, guardName, coreName, controlName }) {
  const importPath = `./${mainModule.split("/").map(encodeURIComponent).join("/")}`;
  return `import { guardStorageEnvironment } from ${JSON.stringify(`./${coreName}`)};\nimport { backupCapability, handleBackupControl } from ${JSON.stringify(`./${controlName}`)};\nimport original from ${JSON.stringify(importPath)};\nexport * from ${JSON.stringify(importPath)};\nconst originalFetch = original?.fetch;\nif (typeof originalFetch !== "function") throw new Error("Captured Worker has no default fetch handler");\nconst wrapped = {\n  async fetch(request, env, ctx) {\n    const capability = backupCapability(request, env);\n    if (capability) return capability;\n    const control = await handleBackupControl(request, env);\n    if (control) return control;\n    const guardedEnv = guardStorageEnvironment(env);\n    return originalFetch.call(original, request, guardedEnv, ctx);\n  },\n  ...(typeof original?.scheduled === "function" ? {\n    async scheduled(controller, env, ctx) {\n      const guardedEnv = guardStorageEnvironment(env);\n      return original.scheduled.call(original, controller, guardedEnv, ctx);\n    },\n  } : {}),\n};\nexport default wrapped;\n// ${guardName}\n`;
}

function bindingText(name, text) {
  return { type: "plain_text", name, text };
}

/** Build an upload-only Worker bundle from captured live code and settings. */
export async function buildCutoverUpload({
  snapshot,
  settings,
  workerName,
  coordinatorName = "savia-backup-coordinator",
  gateSources,
  maintenance,
}) {
  if (typeof workerName !== "string" || !workerName.trim())
    throw new Error("Worker name is required");
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    throw new Error("Captured Worker settings are required");
  if (maintenance !== undefined && typeof maintenance !== "boolean")
    throw new Error("Maintenance must be true, false, or undefined");
  if (
    !gateSources ||
    typeof gateSources.index !== "string" ||
    typeof gateSources.control !== "string"
  )
    throw new Error("Both backup gate source modules are required");
  const parsed = await normalizedSnapshot(snapshot);
  const mainModule = entryModule(parsed);
  const existingBindings = Array.isArray(settings.bindings)
    ? settings.bindings
    : [];
  for (const binding of existingBindings) {
    if (
      binding.type === "durable_object_namespace" &&
      (binding.name !== "REALTIME_HUB" || binding.class_name !== "RealtimeHub")
    ) {
      throw new Error(
        `Unsupported Durable Object binding in captured Worker: ${binding.name}`,
      );
    }
  }
  if (settings.migrations && JSON.stringify(settings.migrations) !== "[]")
    throw new Error(
      "Captured Worker has application Durable Object migrations",
    );

  const unique = randomUUID();
  const guardName = `__savia_cutover_guard_${workerName}_${unique}.mjs`;
  const coreName = `__savia_backup_gate_core_${workerName}_${unique}.mjs`;
  const controlName = `__savia_backup_gate_control_${workerName}_${unique}.mjs`;
  const guard = Buffer.from(
    guardSource({ mainModule, guardName, coreName, controlName }),
    "utf8",
  );
  const inheritedBindings = existingBindings
    .filter(
      ({ name }) => maintenance === undefined || name !== "SAVIA_MAINTENANCE",
    )
    .map(({ name }) => ({ type: "inherit", name }));
  const boundNames = new Set(existingBindings.map(({ name }) => name));
  for (const name of RESERVED_BINDINGS) {
    if (boundNames.has(name)) {
      if (name !== "SAVIA_MAINTENANCE")
        throw new Error(
          `Captured Worker already defines reserved binding: ${name}`,
        );
    }
  }
  const bindings = [
    ...inheritedBindings,
    {
      type: "durable_object_namespace",
      name: "BACKUP_GATE",
      script_name: coordinatorName,
      class_name: "BackupCoordinator",
    },
    bindingText("SAVIA_BACKUP_GATE_REQUIRED", "true"),
  ];
  const oldMaintenance = existingBindings.find(
    ({ name }) => name === "SAVIA_MAINTENANCE",
  );
  if (maintenance !== undefined) {
    bindings.push(bindingText("SAVIA_MAINTENANCE", String(maintenance)));
  } else if (!oldMaintenance) {
    bindings.push(bindingText("SAVIA_MAINTENANCE", "false"));
  }

  const metadata = {};
  for (const key of [
    "compatibility_date",
    "compatibility_flags",
    "usage_model",
    "logpush",
    "tail_consumers",
    "observability",
    "placement",
    "tags",
  ]) {
    if (settings[key] !== undefined) metadata[key] = settings[key];
  }
  metadata.main_module = guardName;
  metadata.bindings = bindings;
  const annotations = settings.annotations ?? {};
  metadata.annotations = {
    ...(annotations["workers/tag"] !== undefined
      ? { "workers/tag": annotations["workers/tag"] }
      : {}),
    "workers/message": `Narrow backup cutover guard for captured ${workerName} bundle`,
  };

  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
    "metadata.json",
  );
  for (const module of parsed.modules) {
    form.append(
      module.name,
      new Blob([module.bytes], { type: module.type }),
      module.name,
    );
  }
  form.append(
    coreName,
    new Blob([gateSources.index], { type: "application/javascript+module" }),
    coreName,
  );
  form.append(
    controlName,
    new Blob([gateSources.control], { type: "application/javascript+module" }),
    controlName,
  );
  form.append(
    guardName,
    new Blob([guard], { type: "application/javascript+module" }),
    guardName,
  );
  return form;
}
