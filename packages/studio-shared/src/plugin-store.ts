import { z } from "zod";
import {
  extensionManifestSchema,
  type ExtensionManifest,
} from "./extension-package";
import { identifier, supportedTypes } from "./metadata";
import {
  solutionIdSchema,
  solutionPackageSchema,
  type SolutionPackage,
} from "./solution-package";

/**
 * Contrato del Store de plugins por tenant.
 *
 * Un artefacto del store es un ZIP con:
 * - `savia-extension.json` (manifiesto `savia.extension` v1, id con prefijo `custom.`)
 * - `dist/plugin.js` (ESM autocontenido, ver `validatePluginEntrySource`)
 *
 * El JS se ejecuta en un `iframe sandbox="allow-scripts"` sin
 * `allow-same-origin`: no tiene acceso al DOM padre, ni a
 * `localStorage`, ni a la red directa. Solo habla con el host por
 * `postMessage` y el host reenvía a la API ya autorizada.
 */
export const PLUGIN_STORE_MAX_ZIP_BYTES = 6 * 1024 * 1024;
export const PLUGIN_STORE_MAX_ENTRY_BYTES = 2 * 1024 * 1024;
export const PLUGIN_STORE_MANIFEST_PATH = "savia-extension.json";
export const PLUGIN_STORE_ENTRY_PATH = "dist/plugin.js";
export const PLUGIN_STORE_CONFIG_PATH = "store.json";

/**
 * Manifiesto del store: mismo contrato `savia.extension`, pero con
 * cualquier id válido. Antes se exigía el prefijo `custom.`; desde la
 * migración fuera del release, un tenant puede publicar bajo el id
 * original (p. ej. `insurance.collections`) porque todo el estado es
 * por tenant: solo afecta a su propio espacio. `custom.*` sigue como
 * convención para plugins de terceros.
 */
export const pluginStoreManifestSchema = extensionManifestSchema;

export type PluginStoreManifest = ExtensionManifest;

const FORBIDDEN_ENTRY_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  message: string;
}> = [
  {
    pattern: /\beval\s*\(/,
    message: "El plugin no puede usar eval().",
  },
  {
    pattern: /new\s+Function\s*\(|[^.\w$]Function\s*\(/,
    message: "El plugin no puede compilar código en tiempo de ejecución.",
  },
  {
    // setTimeout("código") compila igual que eval(); la forma con
    // función sí está permitida.
    pattern: /setTimeout\s*\(\s*["'`]/,
    message: "El plugin no puede diferir código como texto.",
  },
  {
    pattern: /setInterval\s*\(\s*["'`]/,
    message: "El plugin no puede repetir código como texto.",
  },
  {
    pattern: /process\.(env|argv|exit|cwd)/,
    message: "El plugin no puede acceder a process.",
  },
  {
    pattern: /require\s*\(/,
    message: "El plugin debe ser un bundle ESM autocontenido, sin require().",
  },
  {
    pattern: /\b(D1Database|R2Bucket|KVNamespace|DurableObjectNamespace)\b/,
    message: "El plugin no puede acceder a bindings del Worker.",
  },
  {
    // Solo usos reales de API (Deno.x, Bun.x): las palabras sueltas son
    // inertes en el sandbox (p. ej. olfateo de userAgent en una lib).
    pattern: /\b(Deno|Bun)\s*\./,
    message: "El plugin no puede usar runtimes externos.",
  },
  {
    // Imports desnudos (react, lodash, https://...) romperían el sandbox
    // de un solo archivo: todo debe venir empaquetado.
    pattern: /from\s+["'](?![./]|data:|blob:)[^"']+["']/,
    message:
      "El plugin debe ser autocontenido: sin imports desnudos ni URLs remotas.",
  },
  {
    pattern: /import\s*\(\s*["'](?![./]|data:|blob:)[^"']+["']\s*\)/,
    message:
      "El plugin debe ser autocontenido: sin import() dinámico de remotos.",
  },
  {
    // El shell redirige fetch() con rutas relativas (/api/...) al host.
    // Todo lo demás (remotos, variables, Request) está prohibido: en el
    // sandbox opaco solo serviría para exfiltrar.
    pattern: /fetch\s*\(\s*(?:["'`](?!\/)|[^"'`\s)])/,
    message:
      "El plugin solo puede usar fetch() con rutas relativas al host (/api/...).",
  },
  {
    pattern: /XMLHttpRequest|WebSocket|EventSource/,
    message:
      "El plugin no puede abrir conexiones directas: usa el objeto savia del host.",
  },
  {
    pattern: /localStorage|sessionStorage|indexedDB|document\.cookie/,
    message: "El plugin no puede usar almacenamiento del navegador.",
  },
];

export function validatePluginEntrySource(source: string): void {
  const bytes = new TextEncoder().encode(source).length;
  if (bytes === 0) throw new Error("dist/plugin.js está vacío.");
  if (bytes > PLUGIN_STORE_MAX_ENTRY_BYTES)
    throw new Error(
      `dist/plugin.js supera el máximo de ${PLUGIN_STORE_MAX_ENTRY_BYTES} bytes.`,
    );
  for (const { pattern, message } of FORBIDDEN_ENTRY_PATTERNS)
    if (pattern.test(source)) throw new Error(message);
  // Acepta fuente legible y bundles minificados (`export{Ag as render}`).
  const hasRenderExport =
    /export\s+default\b/.test(source) ||
    /export\s+(async\s+)?function\s+render\b/.test(source) ||
    /export\s+(const|let|var)\s+render\b/.test(source) ||
    /export\s*\{[^}]*\brender\b[^}]*\}/.test(source);
  if (!hasRenderExport)
    throw new Error(
      "dist/plugin.js debe exportar render(element, savia) o un default.",
    );
}

export function pluginStoreArtifactKey(
  tenantId: string,
  pluginId: string,
  version: string,
): string {
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `plugin-store/${safe(tenantId)}/${safe(pluginId)}/${safe(version)}.zip`;
}

/**
 * Texto visible para el asistente. Se valida en la subida y se vuelve a
 * sanear al servir: sin instrucciones, sin sintaxis de enlaces y con
 * topes de longitud. El modelo nunca recibe texto libre del autor más
 * allá de estos campos.
 */
const ASSISTANT_INJECTION_PATTERNS: ReadonlyArray<RegExp> = [
  /ignore\s+(previous|all|your)\s+instructions/i,
  /disregard\s+(previous|all|your)\s+instructions/i,
  /\bsystem\s*:/i,
  /<\||\|>/,
  /\bassistant\s+to\s*=/i,
  /\[.*?\]\(.*?\)/,
  /jailbreak/i,
];

export function assertAssistantText(value: string, field: string): void {
  if (/[\u0000-\u001F\u007F]/.test(value))
    throw new Error(`${field} contiene caracteres de control.`);
  for (const pattern of ASSISTANT_INJECTION_PATTERNS)
    if (pattern.test(value))
      throw new Error(
        `${field} contiene instrucciones o formato no permitido.`,
      );
}

/** Etiqueta y resumen que el asistente muestra de una acción del store. */
export const storeMcpSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    summary: z.string().trim().min(1).max(300),
  })
  .strict()
  .superRefine((mcp, ctx) => {
    for (const [field, value] of [
      ["label", mcp.label],
      ["summary", mcp.summary],
    ] as const) {
      try {
        assertAssistantText(value, field);
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: error instanceof Error ? error.message : "Texto no válido.",
        });
      }
    }
  });

export type StoreMcp = z.infer<typeof storeMcpSchema>;

/** Vuelve a sanear al servir (defensa en profundidad ante datos viejos). */
export function sanitizeAssistantCopy(value: string, max: number): string {
  const normalized = value.replace(/[\u0000-\u001F\u007F]+/g, " ").trim();
  const sliced = normalized.slice(0, max);
  try {
    assertAssistantText(sliced, "texto");
    return sliced;
  } catch {
    return "";
  }
}

export type StoreMcpCatalogAction = {
  id: string;
  kind: "simulation" | "http";
  method?: string;
  label: string;
  summary: string;
};

/** Acciones visibles al asistente, ya saneadas y con prefijo de origen. */
export function storeMcpActions(
  pluginId: string,
  config: StoreJson,
): StoreMcpCatalogAction[] {
  const actions: StoreMcpCatalogAction[] = [];
  for (const action of config.actions) {
    if (action.kind !== "simulation" && action.kind !== "http") continue;
    if (!action.mcp) continue;
    if (action.kind === "http" && action.request.method !== "GET") continue;
    const label = sanitizeAssistantCopy(
      `[${pluginId}/${action.id}] ${action.mcp.label}`,
      140,
    );
    const summary = sanitizeAssistantCopy(action.mcp.summary, 300);
    if (!label || !summary) continue;
    actions.push({
      id: action.id,
      kind: action.kind,
      ...(action.kind === "http" ? { method: action.request.method } : {}),
      label,
      summary,
    });
  }
  return actions;
}

/** Acción simulada: el host responde con la plantilla `output`. */
export const storeSimulationActionSchema = z
  .object({
    id: solutionIdSchema,
    kind: z.literal("simulation"),
    output: z.unknown(),
    mcp: storeMcpSchema.optional(),
  })
  .strict();

/**
 * Delegación a una acción compilada del release (p. ej. `insurance.quotes`
 * para ejecutar flujos savia-request). El host exige que la extensión
 * destino esté disponible en el tenant y reescribe el contexto; los
 * secretos y servicios siguen del lado del release.
 */
export const storeDelegatedActionSchema = z
  .object({
    id: solutionIdSchema,
    kind: z.literal("delegate"),
    extension: solutionIdSchema,
    action: solutionIdSchema,
  })
  .strict();

export const storeActionSchema = z.union([
  storeSimulationActionSchema,
  storeDelegatedActionSchema,
  z.lazy(() => storeHttpActionSchema),
]);

const storeHostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(
    /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/i,
    "Host no válido (dominio o *.dominio).",
  );

const storeJsonFieldSchema = z
  .object({
    type: z.enum(["string", "number", "boolean"]),
    enum: z
      .array(z.union([z.string(), z.number(), z.boolean()]))
      .max(50)
      .optional(),
  })
  .strict();

/**
 * Conector declarativo: el tenant guarda valores (incluidos secretos
 * cifrados) y el host los inyecta como `{{connection.*}}` al ejecutar.
 * `allowedHosts` delimita a dónde puede llamar (exacto o `*.dominio`).
 */
export const storeConnectorSchema = z
  .object({
    id: solutionIdSchema,
    label: z.string().trim().min(1).max(100),
    secretFields: z
      .array(z.string().trim().min(1).max(100))
      .max(30)
      .default([])
      .refine((fields) => new Set(fields).size === fields.length, {
        message: "Campos secretos duplicados.",
      }),
    configSchema: z
      .object({
        type: z.literal("object"),
        required: z
          .array(z.string().trim().min(1).max(100))
          .max(50)
          .default([]),
        properties: z.record(z.string(), storeJsonFieldSchema).default({}),
      })
      .strict()
      .superRefine((schema, ctx) => {
        for (const name of schema.required) {
          if (!schema.properties[name])
            ctx.addIssue({
              code: "custom",
              path: ["required"],
              message: `Requerido sin declarar: ${name}.`,
            });
        }
      }),
    allowedHosts: z.array(storeHostSchema).max(20).default([]),
    /**
     * Permite además el host del `endpoint` configurado por el tenant.
     * Para puertos migrados cuyo proveedor varía por tenant; exige el
     * campo `endpoint` y nunca acepta metadatos cloud.
     */
    allowConfiguredHost: z.boolean().default(false),
  })
  .strict()
  .superRefine((connector, ctx) => {
    for (const field of connector.secretFields) {
      if (!connector.configSchema.properties[field])
        ctx.addIssue({
          code: "custom",
          path: ["secretFields"],
          message: `Secreto sin declarar en el esquema: ${field}.`,
        });
    }
    if (
      connector.allowConfiguredHost &&
      connector.configSchema.properties["endpoint"] === undefined
    )
      ctx.addIssue({
        code: "custom",
        path: ["allowConfiguredHost"],
        message: "Requiere el campo endpoint en el esquema.",
      });
  });

/**
 * Pantalla aportada por el plugin: el host renderiza su iframe en la
 * ruta normal del objeto/vista cuando el plugin está activo,
 * reemplazando la vista CRM (igual que las pantallas compiladas).
 */
export const storeScreenSchema = z
  .object({
    object: identifier,
    view: z.string().trim().min(1).max(100).default("records"),
    hidden: z.boolean().default(false),
  })
  .strict();

export type StoreScreen = z.infer<typeof storeScreenSchema>;

/**
 * Requisito de colección declarado por un plugin del store. Al instalar,
 * el host crea la colección mínima si falta, conserva la compatible y
 * rechaza la instalación si existe una incompatible (igual que las
 * extensiones compiladas; sin migraciones ni borrados).
 */
export const storeCollectionSchema = z
  .object({
    object: z.unknown(),
    requiredFields: z
      .record(
        identifier,
        z
          .object({
            types: z.array(z.enum(supportedTypes)).min(1),
            required: z.boolean().optional(),
            optionValues: z.array(z.string().trim().min(1).max(200)).optional(),
          })
          .strict(),
      )
      .default({}),
  })
  .strict();

const storeHttpActionSchema = z
  .object({
    id: solutionIdSchema,
    kind: z.literal("http"),
    connector: solutionIdSchema,
    connectionOptional: z.boolean().default(false),
    request: z
      .object({
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]),
        url: z.string().trim().min(1).max(2000),
        headers: z.record(z.string(), z.string()).default({}),
        body: z.unknown().optional(),
      })
      .strict(),
    mcp: storeMcpSchema.optional(),
  })
  .strict();

export const storeJsonSchema = z
  .object({
    format: z.literal("savia.store"),
    formatVersion: z.literal(1),
    actions: z.array(storeActionSchema).max(20).default([]),
    connectors: z.array(storeConnectorSchema).max(10).default([]),
    collections: z.array(storeCollectionSchema).max(20).default([]),
    screens: z.array(storeScreenSchema).max(20).default([]),
    settings: z
      .object({ defaults: z.record(z.string(), z.unknown()) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    const connectorIds = new Set(config.connectors.map((c) => c.id));
    const secretsByConnector = new Map(
      config.connectors.map((c) => [c.id, new Set(c.secretFields)]),
    );
    for (const action of config.actions) {
      if (action.kind === "http" && !connectorIds.has(action.connector))
        ctx.addIssue({
          code: "custom",
          path: ["actions"],
          message: `La acción ${action.id} usa un conector no declarado.`,
        });
      if (action.kind === "http") {
        const secrets = secretsByConnector.get(action.connector) ?? new Set();
        for (const secret of secrets) {
          const marker = `{{connection.${secret}}}`;
          if (action.request.url.includes(marker))
            ctx.addIssue({
              code: "custom",
              path: ["actions"],
              message: `La acción ${action.id} expone el secreto ${secret} en la URL.`,
            });
        }
      }
      // El asistente solo expone acciones de lectura declaradas
      // (simulation o http GET con bloque mcp; delegate no admite mcp
      // por su esquema estricto).
      const mcp =
        action.kind === "simulation" || action.kind === "http"
          ? action.mcp
          : undefined;
      if (
        action.kind === "http" &&
        mcp !== undefined &&
        action.request.method !== "GET"
      )
        ctx.addIssue({
          code: "custom",
          path: ["actions"],
          message: `La acción ${action.id} solo puede exponerse al asistente si es GET.`,
        });
    }
  });

export type StoreJson = z.infer<typeof storeJsonSchema>;
export type StoreSimulationAction = z.infer<typeof storeSimulationActionSchema>;
export type StoreDelegatedAction = z.infer<typeof storeDelegatedActionSchema>;
export type StoreHttpAction = z.infer<typeof storeHttpActionSchema>;
export type StoreConnector = z.infer<typeof storeConnectorSchema>;

export type StoreCollection = z.infer<typeof storeCollectionSchema>;
export type SolutionPackageObject = SolutionPackage["objects"][number];

/** Sanea una colección declarada contra el contrato del diseñador. */
export function sanitizeStoreCollection(collection: StoreCollection): {
  object: SolutionPackageObject;
  requiredFields: StoreCollection["requiredFields"];
} {
  const parsed = solutionPackageSchema.parse({
    format: "savia.solution",
    formatVersion: 1,
    id: "extension.requirements",
    version: "1.0.0",
    label: "Extension requirements",
    description: "Trusted extension collection requirement.",
    requires: [],
    objects: [collection.object],
  });
  return {
    object: parsed.objects[0],
    requiredFields: collection.requiredFields,
  };
}
export type StoreAction = z.infer<typeof storeActionSchema>;

/**
 * Quita del output cualquier propiedad cuya clave parezca secreto.
 * Es la misma convención del normalizador de cotizaciones.
 */
const SENSITIVE_KEY = /(?:api[_-]?key|authorization|password|secret|token)/i;

export function redactSecrets(
  value: unknown,
  secrets: readonly string[] = [],
): unknown {
  if (Array.isArray(value))
    return value.map((item) => redactSecrets(item, secrets));
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && secrets.includes(value))
      return "[redacted]";
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .map(([key, nested]) => [key, redactSecrets(nested, secrets)]),
  );
}

/**
 * Valida la URL final de una acción http contra el allowlist del
 * conector. Deniega no-https, credenciales en URL, literales IP,
 * localhost/redes especiales y puertos distintos de 443.
 * (El reenlace DNS hacia IPs privadas no se puede resolver en el
 * Worker: se documenta como riesgo residual; mitigado con https
 * obligatorio, sin redirects y timeout.)
 */
export function assertStoreHttpUrl(
  rawUrl: string,
  allowedHosts: readonly string[],
): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("La URL de la acción no es válida.");
  }
  if (url.protocol !== "https:")
    throw new Error("La acción solo permite URLs https.");
  if (url.username || url.password)
    throw new Error("La URL no puede llevar credenciales.");
  if (url.port && url.port !== "443")
    throw new Error("La URL usa un puerto no permitido.");
  const host = url.hostname.toLowerCase();
  if (
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host.includes(":") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    host === "metadata.google.com" ||
    host.startsWith("169.254.") ||
    host === "100.100.100.200"
  )
    throw new Error("El host de la acción no está permitido.");
  const allowed = allowedHosts.some((rule) => {
    const normalized = rule.toLowerCase();
    if (normalized.startsWith("*.")) {
      const suffix = normalized.slice(1);
      return host === normalized.slice(2) || host.endsWith(suffix);
    }
    return host === normalized;
  });
  if (!allowed) throw new Error("El host no está en la lista del conector.");
  return url;
}

function resolveTemplatePath(
  scopes: Record<string, unknown>,
  path: string,
): unknown {
  const trimmed = path.trim();
  if (trimmed === "uuid") return crypto.randomUUID();
  if (trimmed === "now") return new Date().toISOString();
  const dot = trimmed.indexOf(".");
  if (dot < 0) {
    // Variables de contexto de ejecución (tenant, principal, ...).
    const value = scopes[trimmed];
    return value !== null && value !== undefined && typeof value !== "object"
      ? value
      : undefined;
  }
  let current: unknown = scopes[trimmed.slice(0, dot)];
  if (current === undefined) return undefined;
  for (const segment of trimmed.slice(dot + 1).split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current))
      return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current ?? undefined;
}

const TEMPLATE_EXPRESSION = /\{\{\s*([^{}]+?)\s*\}\}/g;
const TEMPLATE_WHOLE = /^\{\{\s*([^{}]+?)\s*\}\}$/;

/** Rellena una plantilla con scopes (`input`, `connection`, contexto). */
export function renderTemplate(
  template: unknown,
  scopes: Record<string, unknown>,
): unknown {
  if (Array.isArray(template))
    return template.map((item) => renderTemplate(item, scopes));
  if (template && typeof template === "object")
    return Object.fromEntries(
      Object.entries(template as Record<string, unknown>).map(
        ([key, value]) => [key, renderTemplate(value, scopes)],
      ),
    );
  if (typeof template !== "string") return template;
  const whole = TEMPLATE_WHOLE.exec(template);
  if (whole) {
    const resolved = resolveTemplatePath(scopes, whole[1]);
    return resolved === undefined ? null : resolved;
  }
  return template.replace(TEMPLATE_EXPRESSION, (_, expression: string) => {
    const resolved = resolveTemplatePath(scopes, expression);
    if (resolved === undefined) return "";
    return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
  });
}

/** Rellena una plantilla de simulación con el `input` de la acción. */
export function renderSimulationOutput(
  template: unknown,
  input: Record<string, unknown>,
): unknown {
  return renderTemplate(template, { input });
}
