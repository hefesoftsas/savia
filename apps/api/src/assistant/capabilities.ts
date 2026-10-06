import { z } from "@hono/zod-openapi";
import type { ToolSet } from "ai";
import type { VirtualEmployee } from "./virtual-employees";
import type { ContactAccess } from "../whatsapp/channel-contracts";
import { applyCollectionScoping } from "./tool-policy";

export type AssistantOperationPorts = {
  read(name: string, input: Record<string, unknown>): Promise<unknown>;
  prepare(
    domain: string,
    command: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  saveDraft?(input: Record<string, unknown>): Promise<unknown>;
};
const text = z.string().trim().min(1).max(200);
const definitions = [
  [
    "savia_get_quote_form",
    "insurance",
    "Read the configured quote requirements. Never recite the whole form.",
    z.object({}),
  ],
  [
    "savia_lookup_quote_vehicle",
    "insurance",
    "Look up verified vehicle fields once after a plate is supplied.",
    z.object({ plate: text }),
  ],
  [
    "savia_lookup_dane_city",
    "insurance",
    "Resolve a Colombian city to its DANE code; ask for department if ambiguous.",
    z.object({ city: text, department: text.optional() }),
  ],
  [
    "savia_get_quote_summary",
    "insurance",
    "Read authorized saved quotes and actual offer summaries.",
    z.object({ reference: text.optional() }),
  ],
  [
    "savia_list_studio_collections",
    "studio",
    "Discover authorized collections and fields.",
    z.object({ all: z.boolean().optional() }),
  ],
  [
    "savia_list_studio_records",
    "studio",
    "Read authorized collection records with filters and pagination.",
    z.object({
      object: text,
      page: z.number().int().min(1).optional(),
      perPage: z.number().int().min(1).max(100).optional(),
      query: text.optional(),
      filters: z.record(z.string(), z.unknown()).optional(),
    }),
  ],
  [
    "savia_get_studio_record",
    "studio",
    "Read a record before proposing an update or deletion.",
    z.object({ object: text, id: text }),
  ],
  [
    "savia_get_studio_record_links",
    "studio",
    "Read authorized record relations.",
    z.object({ object: text, id: text }),
  ],
  [
    "savia_aggregate_studio_records",
    "studio",
    "Aggregate records by fields and filters.",
    z.object({
      object: text,
      groupBy: text.optional(),
      amountField: text.optional(),
      filters: z.record(z.string(), z.unknown()).optional(),
    }),
  ],
  [
    "savia_search_personal_files",
    "personal-integrations",
    "Search metadata in the caller's own connected file account.",
    z.object({
      provider: z.enum([
        "google_drive",
        "onedrive_personal",
        "onedrive_business",
      ]),
      query: text,
    }),
  ],
  [
    "savia_search_personal_messages",
    "personal-integrations",
    "Search metadata in the caller's own mailbox.",
    z.object({ provider: z.enum(["gmail", "outlook"]), query: text }),
  ],
  [
    "savia_list_personal_events",
    "personal-integrations",
    "Read upcoming events from the caller's own connected calendar.",
    z.object({ provider: z.enum(["google_calendar", "outlook"]) }),
  ],
  [
    "savia_list_domains",
    "domains",
    "Read authorized domain collections and commands.",
    z.object({}),
  ],
  [
    "savia_list_documents",
    "domains",
    "Read authorized domain documents.",
    z.object({
      domain: text,
      collection: text,
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
  ],
  [
    "savia_get_document",
    "domains",
    "Read one authorized domain document.",
    z.object({ domain: text, collection: text, id: text }),
  ],
] as const;

export function channelCapabilityAllowed(
  access: ContactAccess,
  category: string,
) {
  const configured =
    access.capabilities.includes(category) || access.capabilities.includes("*");
  return (
    configured &&
    (category === "insurance" ||
      (access.audience === "internal" && Boolean(access.principalId)))
  );
}

export function assertChannelCommandAllowed(
  employee: Pick<VirtualEmployee, "allowedCollections">,
  access: ContactAccess,
  domain: string,
  command: string,
  input: Record<string, unknown>,
) {
  if (
    !employee.allowedCollections.length ||
    !channelCapabilityAllowed(access, domain)
  )
    throw new Error("CHANNEL_COMMAND_DENIED");
  if (domain === "insurance" && command === "quote-auto") {
    if (
      !employee.allowedCollections.includes("*") &&
      !["cotizaciones", "cotizaciones_detalle"].every((c) =>
        employee.allowedCollections.includes(c),
      )
    )
      throw new Error("CHANNEL_COMMAND_DENIED");
    return;
  }
  if (
    domain === "studio" &&
    ["create-record", "update-record", "delete-record"].includes(command)
  ) {
    const collection = String(input.collection ?? input.object ?? "")
      .trim()
      .toLowerCase();
    if (
      !collection ||
      (!employee.allowedCollections.includes("*") &&
        !employee.allowedCollections
          .map((c) => c.toLowerCase())
          .includes(collection))
    )
      throw new Error("CHANNEL_COMMAND_DENIED");
    return;
  }
  if (
    domain === "personal-integrations" &&
    ["send-email", "create-event", "upload-file"].includes(command)
  )
    return;
  throw new Error("CHANNEL_COMMAND_DENIED");
}

export function createEmployeeCapabilities(
  employee: VirtualEmployee,
  access: ContactAccess,
  ports: AssistantOperationPorts,
): ToolSet {
  if (!employee.allowedCollections.length) return {};
  const tools: ToolSet = {};
  if (ports.saveDraft)
    tools.savia_update_task_draft = {
      description:
        "Preserve supplied task fields across turns. Save partial vehicle/applicant fields after each intake turn; never put permissions or credentials here.",
      inputSchema: z
        .object({ fields: z.record(z.string(), z.unknown()) })
        .strict(),
      execute: ({ fields }) => ports.saveDraft!(fields),
    };
  for (const [name, category, description, schema] of definitions) {
    if (!channelCapabilityAllowed(access, category)) continue;
    tools[name] = {
      description,
      inputSchema: schema.strict(),
      execute: async (input) =>
        ports.read(name, input as Record<string, unknown>),
    };
  }
  if (access.capabilities.length)
    tools.savia_prepare_command = {
      description:
        "Prepare a validated operation for a server-issued WhatsApp confirmation. This never executes it.",
      inputSchema: z
        .object({
          domain: text,
          command: text,
          input: z.record(z.string(), z.unknown()),
        })
        .strict(),
      execute: async ({ domain, command, input }) => {
        try {
          assertChannelCommandAllowed(employee, access, domain, command, input);
          return await ports.prepare(domain, command, input);
        } catch {
          return {
            isError: true,
            message:
              "No se pudo preparar esta acción. Revisa los campos y los permisos; no se ejecutó ninguna solicitud.",
          };
        }
      },
    };
  return applyCollectionScoping(tools, employee);
}

export const whatsappOperationInstructions =
  "Use only exposed tools. Read tools silently and answer concisely with verified evidence. For insurance quotes, read savia_get_quote_form, look up the plate once, resolve city names with savia_lookup_dane_city, preserve supplied/verified values, and ask at most three missing fields per turn. Do not invent personal fields, amounts or coverage. Collect explicit data-processing consent before preparing insurance/quote-auto; pass {vehicle,applicant,consent:true}. All writes use savia_prepare_command exactly once and require the server-generated confirmation. Never claim a prepared action has executed. Do not print action tokens, credentials or internal URLs. The server displays confirmation controls. Describe only capabilities available in this conversation. The user can type menú or inicio at any time.";
