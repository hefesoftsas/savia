import { historyDatabase } from "@savia/studio-server/record-history-storage";
import { HTTPException } from "hono/http-exception";
import { getObject, createRecord } from "@savia/studio-server/services";
import {
  validateRecord,
  type StudioObject,
} from "@savia/studio-shared/metadata";
import { z } from "@hono/zod-openapi";
import {
  captchaConfiguration,
  captchaIdentity,
  verifyCaptcha,
  type CaptchaOptions,
} from "./captcha";
export type PublicFormField = {
  name: string;
  label: string;
  type: "text" | "number" | "email" | "date" | "boolean" | "select";
  required: boolean;
  options?: { value: string; label: string }[];
};
export type PublicQuotePresentation = {
  renderer: "insurance-quote-wizard";
  entry: "wizard" | "direct";
  products: Array<{ flowId: string; label: string }>;
};

/** Safe plate-lookup projection: fixed vehicle fields, never raw provider output. */
export type PublicVehicleLookup = {
  plate: string;
  fasecoldaCode?: string;
  productionYear?: number;
  declaredValue?: number;
  accessoriesValue?: number;
};

export interface PublicQuoteAdapter {
  publish(input: {
    db: D1Database;
    tenant: string;
    domainId: string;
    object: StudioObject;
  }): Promise<{ fields: PublicFormField[]; snapshot: unknown }>;
  validate(input: {
    snapshot: unknown;
    values: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  execute(input: {
    db: D1Database;
    tenant: string;
    domainId: string;
    objectName: string;
    submissionId: string;
    snapshot: unknown;
    values: Record<string, unknown>;
    returnResult: boolean;
  }): Promise<unknown>;
  assertAvailable?(input: {
    db: D1Database;
    tenant: string;
    domainId: string;
    objectName: string;
    snapshot: unknown;
  }): Promise<void>;
  presentation?(input: {
    objectName: string;
    snapshot: unknown;
  }): Promise<PublicQuotePresentation>;
  lookupVehicle?(input: {
    db: D1Database;
    tenant: string;
    domainId: string;
    objectName: string;
    snapshot: unknown;
    plate: string;
  }): Promise<PublicVehicleLookup>;
  quoteStatus?(input: {
    db: D1Database;
    tenant: string;
    domainId: string;
    objectName: string;
    snapshot: unknown;
    submission: string;
  }): Promise<{
    items: {
      flowId: string;
      label: string;
      insurer: string;
      status: "waiting" | "quoting" | "done" | "unavailable";
      result?: unknown;
    }[];
  }>;
}
export type PublicFormOptions = CaptchaOptions & {
  quote?: PublicQuoteAdapter;
  saviaRequest?: {
    fetch(request: Request): Promise<Response> | Response;
  };
  rateLimiter?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
};
export const domainIdSchema = z
  .string()
  .regex(/^(?:[a-z][a-z0-9_-]{0,47}|tenant:[1-9][0-9]*)$/);
export const objectNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
export const publishSchema = z
  .object({
    domainId: domainIdSchema,
    objectName: objectNameSchema,
    kind: z.enum(["record", "quote"]),
    expiresAt: z.string().datetime().optional(),
    dailyLimit: z.number().int().min(1).max(1000).default(25),
    returnResult: z.boolean().default(false),
  })
  .strict();
export const submissionSchema = z
  .object({
    submissionId: z.string().uuid(),
    token: z.string().min(1).max(2048),
    values: z.record(
      z.string().max(48),
      z.union([
        z.string().max(10000),
        z.number().finite(),
        z.boolean(),
        z.null(),
      ]),
    ),
  })
  .strict();
export type PublicFormRow = {
  id: string;
  token: string;
  tenant_id: string;
  domain_id: string;
  object_name: string;
  kind: "record" | "quote";
  title: string;
  description: string | null;
  fields: string;
  snapshot: string;
  daily_limit: number;
  return_result: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};
type SubmissionRow = {
  fingerprint: string;
  captcha_hash: string;
  state: string;
  response: string | null;
};
function reject(
  message: string,
  status: 400 | 403 | 404 | 409 | 422 | 429 | 503 = 422,
): never {
  throw new HTTPException(status, { message });
}
export function tenantForDomain(domainId: string) {
  return domainId.startsWith("tenant:")
    ? domainId.replace("tenant:", "agency:")
    : "domain:" + domainId;
}
export function managedForm(row: PublicFormRow, publicOrigin?: string) {
  return {
    ...(publicOrigin
      ? { url: new URL("/public/forms/" + row.token, publicOrigin).href }
      : {}),
    id: row.id,
    token: row.token,
    path: "/public/forms/" + row.token,
    domainId: row.domain_id,
    objectName: row.object_name,
    kind: row.kind,
    title: row.title,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    dailyLimit: row.daily_limit,
    returnResult: Boolean(row.return_result),
    createdAt: row.created_at,
  };
}
export async function availableObject(
  db: D1Database,
  tenant: string,
  name: string,
  quoteAdapter = false,
) {
  const active = tenant.startsWith("agency:")
    ? await db
        .prepare(
          "SELECT 1 FROM tenants WHERE id=? AND kind='commercial' AND is_active=1",
        )
        .bind(Number(tenant.slice(7)))
        .first()
    : tenant === "domain:platform" ||
      (await db
        .prepare("SELECT 1 FROM crm_data_domains WHERE id=?")
        .bind(tenant.slice(7))
        .first());
  if (!active) reject("Public form unavailable.", 404);
  const object = await getObject(db, tenant, name);
  if (
    !quoteAdapter &&
    (object.config.studio?.collection ||
      object.config.studio?.business ||
      (await db
        .prepare(
          "SELECT 1 FROM crm_collection_bindings WHERE tenant_id=? AND object_name=?",
        )
        .bind(tenant, name)
        .first()))
  )
    reject("Bound collections cannot accept public submissions.", 422);
  return object;
}
const forbiddenName =
  /(?:password|secret|credential|token|api_?key|authorization|cookie)/i;
const safeTypes: Record<string, PublicFormField["type"]> = {
  Textbox: "text",
  Textarea: "text",
  Email: "email",
  Phone: "text",
  Url: "text",
  Number: "number",
  Currency: "number",
  DateControl: "date",
  Toggle: "boolean",
  Dropdown: "select",
};
export function projectRecordForm(object: StudioObject) {
  const fields: PublicFormField[] = [];
  const safeFields: StudioObject["config"]["fields"] = {};
  for (const [name, field] of (
    object.config.fieldOrder ?? Object.keys(object.config.fields)
  ).map((name) => [name, object.config.fields[name]] as const)) {
    const config = field.config ?? {};
    const type = safeTypes[field.type];
    const conditionalSection =
      config.section &&
      object.config.studio?.sections?.some(
        (section) => section.id === config.section && section.visibleWhen,
      );
    const unsupported =
      !type ||
      forbiddenName.test(name) ||
      field.hidden ||
      field.readOnly ||
      Boolean(conditionalSection) ||
      Boolean(
        field.computedValue || field.validate?.length || field.rules?.length,
      ) ||
      config.format === "password" ||
      [
        "collectionOptions",
        "relation",
        "collectionRelation",
        "formula",
        "jsonSchema",
        "lookup",
        "remoteOptions",
        "optionsWhen",
        "visibleWhen",
        "requiredWhen",
        "dateTime",
        "multiple",
      ].some((key) => Boolean(config[key as keyof typeof config]));
    if (unsupported) {
      if (field.required || config.requiredWhen)
        reject(
          "Required fields cannot be exposed safely. Simplify the public form first.",
        );
      continue;
    }
    const options =
      type === "select"
        ? field.options?.map((option) => ({
            value: String(option.value),
            label: String(option.label),
          }))
        : undefined;
    if (type === "select" && !options?.length) {
      if (field.required) reject("Required select fields need static options.");
      continue;
    }
    fields.push({
      name,
      label: field.label,
      type,
      required: Boolean(field.required),
      ...(options ? { options } : {}),
    });
    safeFields[name] = {
      type: field.type,
      label: field.label,
      required: field.required,
      ...(field.options
        ? {
            options: field.options.map((option) => ({
              value: option.value,
              label: option.label,
            })),
          }
        : {}),
      config: Object.fromEntries(
        [
          "format",
          "minimum",
          "maximum",
          "integer",
          "minLength",
          "maxLength",
          "pattern",
        ]
          .filter((key) => config[key as keyof typeof config] !== undefined)
          .map((key) => [key, config[key as keyof typeof config]]),
      ),
    } as typeof field;
  }
  if (!fields.length) reject("No supported public fields are available.");
  return {
    fields,
    snapshot: {
      name: object.name,
      label: object.label,
      config: { fields: safeFields },
    },
  };
}
function validateValues(
  fields: PublicFormField[],
  values: Record<string, unknown>,
) {
  const names = new Set(fields.map((field) => field.name));
  if (
    Object.keys(values).some(
      (name) =>
        !names.has(name) ||
        ["__proto__", "constructor", "prototype"].includes(name),
    )
  )
    reject("Unknown public field.");
  for (const field of fields) {
    const value = values[field.name];
    const empty = value === undefined || value === null || value === "";
    if (empty) {
      if (field.required) reject("Complete all required fields.");
      continue;
    }
    if (
      field.type === "number"
        ? typeof value !== "number" || !Number.isFinite(value)
        : field.type === "boolean"
          ? typeof value !== "boolean"
          : typeof value !== "string"
    )
      reject("Invalid public field type.");
    if (
      field.type === "select" &&
      !field.options?.some((option) => option.value === value)
    )
      reject("Invalid selection.");
    if (
      field.type === "email" &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))
    )
      reject("Invalid email address.");
    if (
      field.type === "date" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ||
        Number.isNaN(Date.parse(String(value))) ||
        new Date(String(value)).toISOString().slice(0, 10) !== value)
    )
      reject("Invalid date.");
  }
}
export async function publishPublicForm(
  db: D1Database,
  options: PublicFormOptions,
  owner: string,
  input: z.infer<typeof publishSchema>,
) {
  captchaConfiguration(options);
  if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now())
    reject("Expiry must be in the future.");
  const tenant = tenantForDomain(input.domainId);
  const object = await availableObject(
    db,
    tenant,
    input.objectName,
    input.kind === "quote",
  );
  if (input.kind === "quote" && !options.quote)
    reject("Public quotations are unavailable.", 503);
  const projected =
    input.kind === "record"
      ? projectRecordForm(object)
      : await options.quote!.publish({
          db,
          tenant,
          domainId: input.domainId,
          object,
        });
  const id = crypto.randomUUID(),
    token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  await db
    .prepare(
      "INSERT INTO public_forms(id,token,tenant_id,domain_id,object_name,kind,title,description,fields,snapshot,daily_limit,return_result,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      id,
      token,
      tenant,
      input.domainId,
      input.objectName,
      input.kind,
      object.label,
      object.description ?? null,
      JSON.stringify(projected.fields),
      JSON.stringify(projected.snapshot),
      input.dailyLimit,
      input.kind === "quote" && input.returnResult ? 1 : 0,
      input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
      owner,
      new Date().toISOString(),
    )
    .run();
  return managedForm(
    (await db
      .prepare("SELECT * FROM public_forms WHERE id=?")
      .bind(id)
      .first<PublicFormRow>())!,
    options.publicOrigin,
  );
}
export async function activePublicForm(db: D1Database, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) reject("Public form unavailable.", 404);
  const row = await db
    .prepare(
      "SELECT * FROM public_forms WHERE token=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)",
    )
    .bind(token, new Date().toISOString())
    .first<PublicFormRow>();
  if (!row) reject("Public form unavailable.", 404);
  await availableObject(
    db,
    row.tenant_id,
    row.object_name,
    row.kind === "quote",
  );
  return row;
}
async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
function replay(
  existing: SubmissionRow,
  fingerprint: string,
  captchaHash: string,
) {
  if (
    existing.fingerprint !== fingerprint ||
    existing.captcha_hash !== captchaHash
  )
    reject("Submission identifier already used.", 409);
  if (existing.state !== "complete" || !existing.response)
    reject("Submission already accepted. Do not send it again.", 409);
  return JSON.parse(existing.response);
}
export async function submitPublicForm(
  db: D1Database,
  options: PublicFormOptions,
  link: PublicFormRow,
  input: z.infer<typeof submissionSchema>,
  ip: string,
) {
  const configuration = captchaConfiguration(options);
  const fields = JSON.parse(link.fields) as PublicFormField[],
    snapshot = JSON.parse(link.snapshot);
  validateValues(fields, input.values);
  let values: Record<string, unknown>;
  if (link.kind === "record") {
    const validation = validateRecord(snapshot as StudioObject, input.values);
    if (Object.keys(validation.errors).length)
      reject("Values do not match the published form.");
    values = validation.data;
  } else {
    if (!options.quote) reject("Public quotations are unavailable.", 503);
    await options.quote.assertAvailable?.({
      db,
      tenant: link.tenant_id,
      domainId: link.domain_id,
      objectName: link.object_name,
      snapshot,
    });
    values = await options.quote.validate({ snapshot, values: input.values });
  }
  const identity = captchaIdentity(options, input.token);
  const sortedValues = Object.keys(input.values)
    .sort()
    .map((key) => [key, input.values[key]]);
  const fingerprint = await digest(
      JSON.stringify(
        identity.proof === undefined
          ? sortedValues
          : [sortedValues, identity.proof],
      ),
    ),
    captchaHash = await digest(identity.key);
  const existing = await db
    .prepare(
      "SELECT fingerprint,captcha_hash,state,response FROM public_form_submissions WHERE form_id=? AND submission_id=?",
    )
    .bind(link.id, input.submissionId)
    .first<SubmissionRow>();
  if (existing) return replay(existing, fingerprint, captchaHash);
  try {
    await verifyCaptcha(options, {
      token: input.token,
      submissionId: input.submissionId,
      formId: link.id,
      ip,
    });
  } catch (error) {
    // Anonymous diagnostics: form id and status only, never tokens or values.
    console.error(
      JSON.stringify({
        event: "public-form-captcha-failed",
        formId: link.id,
        status: error instanceof HTTPException ? error.status : "unexpected",
      }),
    );
    throw error;
  }
  const now = new Date().toISOString(),
    day = now.slice(0, 10),
    ipHash = await digest(configuration.secretKey + ":" + ip);
  // The quota predicates and reservation are one SQLite statement: concurrent
  // submitters cannot both observe the last free slot. Reservations count even
  // if execution fails; their side effects are never retried automatically.
  const reservation = await db
    .prepare(
      `INSERT INTO public_form_submissions(form_id,submission_id,tenant_id,ip_hash,day,fingerprint,captcha_hash,state,created_at)
 SELECT ?,?,?,?,?,?,?,'reserved',? WHERE
 EXISTS(SELECT 1 FROM public_forms WHERE id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?) )
 AND (SELECT count(*) FROM public_form_submissions WHERE form_id=? AND day=?)<?
 AND (SELECT count(*) FROM public_form_submissions WHERE tenant_id=? AND day=?)<1000
 AND (SELECT count(*) FROM public_form_submissions WHERE ip_hash=? AND day=?)<20
 ON CONFLICT DO NOTHING RETURNING submission_id`,
    )
    .bind(
      link.id,
      input.submissionId,
      link.tenant_id,
      ipHash,
      day,
      fingerprint,
      captchaHash,
      now,
      link.id,
      now,
      link.id,
      day,
      link.daily_limit,
      link.tenant_id,
      day,
      ipHash,
      day,
    )
    .first();
  if (!reservation) {
    const repeated = await db
      .prepare(
        "SELECT fingerprint,captcha_hash,state,response FROM public_form_submissions WHERE form_id=? AND submission_id=?",
      )
      .bind(link.id, input.submissionId)
      .first<SubmissionRow>();
    if (repeated) return replay(repeated, fingerprint, captchaHash);
    reject(
      "Submission limit reached or form unavailable. Try again later.",
      429,
    );
  }
  try {
    await activePublicForm(db, link.token);
    let result: unknown;
    if (link.kind === "record") {
      const current = await availableObject(
        db,
        link.tenant_id,
        link.object_name,
      );
      const stillPublic = new Set(
        projectRecordForm(current).fields.map((field) => field.name),
      );
      if (Object.keys(values).some((field) => !stillPublic.has(field)))
        reject("The form changed. Request a new link.", 409);
      await createRecord(
        historyDatabase(db, link.tenant_id, {
          kind: "public-form",
          id: link.id,
          causeId: input.submissionId,
        }),
        link.tenant_id,
        link.object_name,
        values,
        {
          idempotencyKey: "public-form:" + link.id + ":" + input.submissionId,
        },
      );
    } else
      result = await options.quote!.execute({
        db,
        tenant: link.tenant_id,
        domainId: link.domain_id,
        objectName: link.object_name,
        submissionId: input.submissionId,
        snapshot,
        values,
        returnResult: Boolean(link.return_result),
      });
    const response = {
      ok: true as const,
      reference: input.submissionId,
      ...(link.return_result && result !== undefined ? { result } : {}),
    };
    await db
      .prepare(
        "UPDATE public_form_submissions SET state='complete',response=? WHERE form_id=? AND submission_id=?",
      )
      .bind(JSON.stringify(response), link.id, input.submissionId)
      .run();
    return response;
  } catch (error) {
    await db
      .prepare(
        "UPDATE public_form_submissions SET state='failed' WHERE form_id=? AND submission_id=?",
      )
      .bind(link.id, input.submissionId)
      .run();
    // Anonymous diagnostics: form id, kind, and status only.
    console.error(
      JSON.stringify({
        event: "public-form-submit-failed",
        formId: link.id,
        kind: link.kind,
        status: error instanceof HTTPException ? error.status : "unexpected",
      }),
    );
    // Curated HTTP statuses keep their meaning (validation, provider, policy):
    // every message thrown in this flow is a safe, fixed string. Anything
    // else (raw provider errors) stays a sanitized 503.
    if (error instanceof HTTPException) throw error;
    reject(
      "Submission could not be completed. Contact the form owner before trying again.",
      503,
    );
  }
}
