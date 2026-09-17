import { assistantQuoteInputSchema } from "@savia/release-catalog/assistant-contracts";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "@hono/zod-openapi";
import {
  convertToModelMessages,
  hasToolCall,
  isStepCount,
  streamText,
  type UIMessage,
} from "ai";
import type {
  AssistantActionRequest,
  AssistantActionResult,
  AssistantChatRequest,
  AssistantService,
} from "./contracts";
import {
  AssistantConfigurationUnavailableError,
  type EffectiveAssistantConfiguration,
} from "./configuration";
import { PendingActionRepository } from "./pending-actions";
import { PersonalActionPayloadCipher } from "./personal-action-payload";
import {
  presentationInputSchema,
  type AssistantPresentationInput,
} from "./presentations";
import { visualizationRequested } from "./visualization-policy";
import {
  VirtualEmployeesRepository,
  type VirtualEmployee,
} from "./virtual-employees";
import { retrieveRelevantChunks, type RagEnvironment } from "./rag";

const defaultOpenRouterModel = "deepseek/deepseek-v4-flash";
const defaultAssistantMaxOutputTokens = 1024;
const readToolNames = new Set([
  "savia_list_domains",
  "savia_list_documents",
  "savia_get_document",
  "savia_get_crm_sync_status",
  "savia_search_personal_files",
  "savia_search_personal_messages",
  "savia_list_personal_events",
  "savia_get_quote_summary",
  "savia_get_quote_form",
  "savia_lookup_dane_city",
  "savia_lookup_quote_vehicle",
  "savia_list_crm_collections",
  "savia_list_crm_records",
  "savia_get_crm_record",
  "savia_get_crm_record_links",
  "savia_aggregate_crm_records",
]);

const prepareCommandInputSchema = z.object({
  domain: z.string().trim().min(1),
  command: z.string().trim().min(1),
  input: z.record(z.string(), z.unknown()),
});
type PreparedCommandInput = z.infer<typeof prepareCommandInputSchema>;

type AssistantMcpClient = Pick<MCPClient, "callTool" | "close" | "tools">;

export type AssistantServiceConfiguration = {
  database: D1Database;
  mcpUrl: string;
  mcpFetch?: typeof fetch;
  mcpSharedSecret: string;
  openRouterApiKey?: string;
  openRouterModel?: string;
};

export type AssistantServiceDependencies = {
  mcpClientFactory?: (authorization: string) => Promise<AssistantMcpClient>;
  configurationResolver?: {
    effectiveConfigurationFor(
      principalId: string,
    ): Promise<EffectiveAssistantConfiguration>;
  };
  virtualEmployeesRepo?: VirtualEmployeesRepository;
  ragEnv?: RagEnvironment;
};

function unavailableResponse(): Response {
  return Response.json(
    {
      error: {
        code: "ASSISTANT_UNAVAILABLE",
        message: "The assistant is not configured",
      },
    },
    { status: 503 },
  );
}

function delegatedMcpClientFactory(
  configuration: AssistantServiceConfiguration,
): (authorization: string) => Promise<AssistantMcpClient> {
  return (authorization) =>
    createMCPClient({
      transport: {
        type: "http",
        url: configuration.mcpUrl,
        fetch: configuration.mcpFetch ?? globalThis.fetch.bind(globalThis),
        redirect: "follow",
        headers: {
          "x-savia-mcp-secret": configuration.mcpSharedSecret,
          "x-savia-user-authorization": authorization,
        },
      },
    });
}

type McpToolMetadata = {
  annotations?: { readOnlyHint?: boolean };
};

export function isExtensionReadTool(
  name: string,
  tool: McpToolMetadata,
): boolean {
  return (
    name.startsWith("savia_extension_") &&
    tool.annotations?.readOnlyHint === true
  );
}

export function readOnlyTools(
  tools: Awaited<ReturnType<AssistantMcpClient["tools"]>>,
) {
  return Object.fromEntries(
    Object.entries(tools).filter(
      ([name, tool]) =>
        readToolNames.has(name) ||
        isExtensionReadTool(name, tool as McpToolMetadata),
    ),
  );
}

function isMcpToolError(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "isError" in result &&
    result.isError === true
  );
}

export function applyCollectionScoping(
  tools: Record<string, any>,
  employee?: VirtualEmployee | null,
): Record<string, any> {
  if (!employee) return tools;
  const isAll = employee.allowedCollections.includes("*");
  if (isAll) return tools;

  const allowed = new Set(
    employee.allowedCollections.map((c) => c.toLowerCase().trim()),
  );

  const scopedTools: Record<string, any> = { ...tools };

  const filterDiscovery = (result: any): any => {
    if (!result || typeof result !== "object") return result;
    const filtered = { ...result };
    for (const key of ["collections", "data"]) {
      if (Array.isArray(result[key])) {
        filtered[key] = result[key].filter(
          (col: any) =>
            allowed.has(String(col.name ?? "").toLowerCase()) ||
            allowed.has(String(col.slug ?? "").toLowerCase()),
        );
      }
    }
    if (result.structuredContent) {
      filtered.structuredContent = filterDiscovery(result.structuredContent);
    }
    if (Array.isArray(result.content)) {
      filtered.content = result.content.map((part: any) => {
        if (part.type !== "text" || typeof part.text !== "string") return part;
        try {
          return {
            ...part,
            text: JSON.stringify(filterDiscovery(JSON.parse(part.text))),
          };
        } catch {
          return part;
        }
      });
    }
    return filtered;
  };

  if (scopedTools.savia_list_crm_collections) {
    const originalList = scopedTools.savia_list_crm_collections;
    scopedTools.savia_list_crm_collections = {
      ...originalList,
      execute: async (args: any, options: any) =>
        filterDiscovery(await originalList.execute(args, options)),
    };
  }

  for (const quoteTool of [
    "savia_get_quote_summary",
    "savia_get_quote_form",
    "savia_lookup_quote_vehicle",
  ]) {
    if (!scopedTools[quoteTool]) continue;
    const originalSummary = scopedTools[quoteTool];
    scopedTools[quoteTool] = {
      ...originalSummary,
      execute: async (args: any, options: any) => {
        if (
          !["cotizaciones", "cotizaciones_detalle"].every((name) =>
            allowed.has(name),
          )
        ) {
          return {
            isError: true,
            error: "ACCESS_DENIED",
            message:
              "El resumen requiere acceso a Cotizaciones y Detalles de cotización.",
          };
        }
        return originalSummary.execute(args, options);
      },
    };
  }

  const dataTools = [
    "savia_list_crm_records",
    "savia_get_crm_record",
    "savia_get_crm_record_links",
    "savia_aggregate_crm_records",
  ];

  for (const toolName of dataTools) {
    if (scopedTools[toolName]) {
      const originalTool = scopedTools[toolName];
      scopedTools[toolName] = {
        ...originalTool,
        execute: async (args: any, options: any) => {
          const targetCollection = String(
            args?.object ?? args?.collection ?? "",
          )
            .toLowerCase()
            .trim();
          if (targetCollection && !allowed.has(targetCollection)) {
            return {
              isError: true,
              error: "ACCESS_DENIED",
              message: `Acceso denegado: El empleado @${employee.handle} tiene acceso restringido y no puede consultar la colección '${targetCollection}'. Colecciones permitidas: ${employee.allowedCollections.join(", ")}.`,
            };
          }
          return originalTool.execute(args, options);
        },
      };
    }
  }

  return scopedTools;
}

export class SaviaAssistantService implements AssistantService {
  private readonly actions: PendingActionRepository;
  private readonly mcpClientFactory: (
    authorization: string,
  ) => Promise<AssistantMcpClient>;
  private readonly configurationResolver: NonNullable<
    AssistantServiceDependencies["configurationResolver"]
  >;
  private readonly personalActionPayloadCipher: PersonalActionPayloadCipher;
  private readonly virtualEmployees: VirtualEmployeesRepository;
  private readonly ragEnv: RagEnvironment;

  constructor(
    private readonly configuration: AssistantServiceConfiguration,
    dependencies: AssistantServiceDependencies = {},
  ) {
    this.actions = new PendingActionRepository(configuration.database);
    this.personalActionPayloadCipher = new PersonalActionPayloadCipher(
      configuration.mcpSharedSecret,
    );
    this.virtualEmployees =
      dependencies.virtualEmployeesRepo ??
      new VirtualEmployeesRepository(configuration.database);
    this.ragEnv = dependencies.ragEnv ?? { DB: configuration.database };
    this.mcpClientFactory =
      dependencies.mcpClientFactory ?? delegatedMcpClientFactory(configuration);
    this.configurationResolver = dependencies.configurationResolver ?? {
      async effectiveConfigurationFor() {
        return {
          ...(configuration.openRouterApiKey
            ? { apiKey: configuration.openRouterApiKey }
            : {}),
          model: configuration.openRouterModel ?? defaultOpenRouterModel,
        };
      },
    };
  }

  async chat(request: AssistantChatRequest): Promise<Response> {
    let effective: EffectiveAssistantConfiguration;
    try {
      effective = await this.configurationResolver.effectiveConfigurationFor(
        request.principalId,
      );
    } catch (error) {
      if (error instanceof AssistantConfigurationUnavailableError) {
        return unavailableResponse();
      }
      throw error;
    }
    if (!effective.apiKey) return unavailableResponse();

    // 1. Resolve active agency if any
    let agencyId: number | undefined;
    if (typeof this.configuration.database?.prepare === "function") {
      try {
        const activeAgencyRow = await this.configuration.database
          .prepare(
            `SELECT agency_id FROM assistant_active_agencies WHERE principal_id = ?`,
          )
          .bind(request.principalId)
          .first<{ agency_id: number }>();
        agencyId = activeAgencyRow?.agency_id;
      } catch {}
    }

    // 2. Extract last user text
    let lastUserText = "";
    if (Array.isArray(request.messages)) {
      for (let i = request.messages.length - 1; i >= 0; i--) {
        const m = request.messages[i] as any;
        if (m?.role === "user") {
          if (typeof m.content === "string") {
            lastUserText = m.content;
            break;
          } else if (Array.isArray(m.parts)) {
            lastUserText = m.parts
              .filter((p: any) => p.type === "text")
              .map((p: any) => p.text)
              .join(" ");
            break;
          }
        }
      }
    }

    // 3. Resolve Virtual Employee (by request handle/ID or @handle in prompt)
    let employee: VirtualEmployee | null = null;
    if (typeof this.configuration.database?.prepare === "function") {
      try {
        if (request.employeeId) {
          employee = await this.virtualEmployees.getById(
            request.employeeId,
            agencyId,
          );
        } else if (request.employeeHandle) {
          employee = await this.virtualEmployees.getByHandle(
            request.employeeHandle,
            agencyId,
          );
        } else if (lastUserText) {
          const mentionMatch = lastUserText.match(/@([a-zA-Z0-9_\-]+)/);
          if (mentionMatch) {
            employee = await this.virtualEmployees.getByHandle(
              mentionMatch[1],
              agencyId,
            );
          }
        }

        // If not mentioned in latest user message, inherit from earlier turns in the same thread
        if (!employee && Array.isArray(request.messages)) {
          for (let i = request.messages.length - 1; i >= 0; i--) {
            const m = request.messages[i] as any;
            if (m?.role === "user") {
              const text =
                typeof m.content === "string"
                  ? m.content
                  : Array.isArray(m.parts)
                    ? m.parts
                        .filter((p: any) => p.type === "text")
                        .map((p: any) => p.text)
                        .join(" ")
                    : "";
              const mentionMatch = text.match(/@([a-zA-Z0-9_\-]+)/);
              if (mentionMatch) {
                employee = await this.virtualEmployees.getByHandle(
                  mentionMatch[1],
                  agencyId,
                );
                if (employee) break;
              }
            }
          }
        }
      } catch {}
    }

    // 4. Retrieve RAG chunks if employee is active
    let ragChunksText = "";
    if (employee && lastUserText) {
      try {
        const chunks = await retrieveRelevantChunks(
          this.ragEnv,
          employee.id,
          lastUserText,
          4,
        );
        if (chunks.length > 0) {
          ragChunksText = [
            "<knowledge_base>",
            "The following verified reference documents are available to you:",
            ...chunks.map(
              (c, i) =>
                `[Document ${i + 1}] (Relevance: ${(c.score ?? 1).toFixed(2)})\n${c.text}`,
            ),
            "</knowledge_base>",
            "Answer using the knowledge base context whenever relevant to the question.",
          ].join("\n\n");
        }
      } catch (ragError) {
        console.warn("[Assistant RAG] Error retrieving chunks:", ragError);
      }
    }

    const mcpClient = await this.mcpClientFactory(request.authorization);
    try {
      const requiresVisualization = visualizationRequested(request.messages);
      const mcpTools = await mcpClient.tools();
      const rawTools = {
        ...readOnlyTools(mcpTools),
        savia_prepare_command: {
          description:
            "Prepare one documented Savia domain command or CRM record change for the user to explicitly confirm. This never executes the command.",
          inputSchema: prepareCommandInputSchema,
          execute: async ({ domain, command, input }: PreparedCommandInput) => {
            if (domain === "insurance" && command === "quote-auto") {
              if (
                employee &&
                !employee.allowedCollections.includes("*") &&
                !["cotizaciones", "cotizaciones_detalle"].every((name) =>
                  employee.allowedCollections.includes(name),
                )
              )
                return {
                  isError: true,
                  error: "ACCESS_DENIED",
                  message:
                    "El empleado necesita acceso a Cotizaciones y Detalles de cotización.",
                };
              const parsed = assistantQuoteInputSchema.safeParse(input);
              if (!parsed.success)
                return {
                  isError: true,
                  error: "VALIDATION_ERROR",
                  missingOrInvalidFields: parsed.error.issues.map((issue) => ({
                    field: issue.path.join("."),
                    message: issue.message,
                  })),
                  message:
                    "Solicita o corrige estos datos antes de preparar la cotización.",
                };
              input = parsed.data;
            }

            if (employee && !employee.allowedCollections.includes("*")) {
              const cmd = command.toLowerCase();
              const isCrmCommand =
                domain === "crm" ||
                cmd === "create-record" ||
                cmd === "update-record" ||
                cmd === "delete-record" ||
                cmd === "create_crm_record" ||
                cmd === "update_crm_record" ||
                cmd === "delete_crm_record" ||
                cmd === "create" ||
                cmd === "update" ||
                cmd === "delete" ||
                Boolean(input.collection) ||
                Boolean(input.object);

              if (isCrmCommand) {
                const targetCollection = String(
                  input.collection ??
                    input.object ??
                    (domain !== "crm" ? domain : ""),
                )
                  .toLowerCase()
                  .trim();

                if (targetCollection) {
                  const allowed = new Set(
                    employee.allowedCollections.map((c) =>
                      c.toLowerCase().trim(),
                    ),
                  );
                  if (!allowed.has(targetCollection)) {
                    return {
                      isError: true,
                      error: "ACCESS_DENIED",
                      message: `Acceso denegado: El empleado @${employee.handle} no tiene permiso para modificar la colección '${targetCollection}'. Colecciones permitidas: ${employee.allowedCollections.join(", ")}.`,
                    };
                  }
                }
              }
            }

            const id = crypto.randomUUID();
            const action = await this.actions.issue({
              id,
              principalId: request.principalId,
              domain,
              command,
              input:
                domain === "personal-integrations"
                  ? {
                      sealedPayload:
                        await this.personalActionPayloadCipher.seal({
                          actionId: id,
                          principalId: request.principalId,
                          payload: input,
                        }),
                    }
                  : input,
            });
            return {
              actionId: action.id,
              domain: action.domain,
              command: action.command,
              input,
              expiresAt: action.expiresAt,
              requiresConfirmation: true,
            };
          },
        },
        savia_present_visualization: {
          description:
            "Display authorized information as a compact table or a bar/line chart. This only renders data and never queries, changes, or executes anything.",
          inputSchema: presentationInputSchema,
          execute: async (presentation: AssistantPresentationInput) =>
            presentation,
        },
      };

      const tools = applyCollectionScoping(rawTools, employee);

      const openrouter = createOpenRouter({
        apiKey: effective.apiKey,
      });

      const systemInstructions: string[] = [];
      if (employee) {
        systemInstructions.push(
          `[VIRTUAL EMPLOYEE ACTIVE: ${employee.name} (@${employee.handle})]`,
          employee.position ? `Position: ${employee.position}` : "",
          `System Instructions:\n${employee.systemPrompt}`,
        );
      } else {
        systemInstructions.push(
          "You are Savia Assistant for authorized operations and business staff.",
        );
      }

      if (ragChunksText) {
        systemInstructions.push(ragChunksText);
      }

      systemInstructions.push(
        "Be concise and decision-oriented. Read tools silently: do not narrate plans, searches, retries or intermediate conclusions. Give the answer first, then at most three useful facts and one next step. For simple questions prefer a short paragraph; do not add unsolicited tables or repeat the same data in multiple formats.",
        "For saved insurance quote counts, status or comparisons, first use savia_get_quote_summary in a single call, without collection discovery or listing all details. It returns the latest quote unless the user provides a reference. Use other authorized tools only when that summary cannot answer the question. Distinguish one master quote from its insurer proposals.",
        "When asked which insurance option suits the user, default to balancing price and coverage. Lead with a conditional recommendation based only on returned evidence. If coverage or deductibles are unavailable, say there is no justified overall winner; identify the cheapest returned priced offers and any price tie, then ask for the missing coverage/deductibles or one relevant user preference. Equal premiums do not imply equal coverage. Do not recommend failed, pending or unpriced responses, invent benefits, rank insurers by reputation, or claim suitability solely from a product name. If complete is false, explicitly limit the comparison to the analyzed offers. Keep references and raw detail rows out of the answer unless requested.",
        "Use savia_list_domains, savia_list_documents, savia_get_document, savia_get_crm_sync_status, savia_search_personal_files, savia_search_personal_messages, and savia_list_personal_events for domain documents, sync status, and personal tools. Use savia_get_crm_sync_status to explain whether automatic CRM delivery is queued, processing, synced, failed, or blocked, optionally filtered by customer. Personal tools access only the caller's connected account and return metadata, never credentials or content. When a list result includes page.total, use it as the exact count instead of requesting further pages.",
        "For other CRM business data beyond the quote summary, such as clients or policies: first use savia_list_crm_collections to discover collections, record counts, and available fields with their types. Use savia_list_crm_records to query and filter specific records (supports text search and structured filters). Use savia_get_crm_record and savia_get_crm_record_links to inspect individual records and their relations. Use savia_aggregate_crm_records to compute totals, counts, and metric distributions grouped by fields (like city, status, category) directly.",
        "Use savia_present_visualization only when the user requests a table, chart or report; a quote recommendation or a count does not need it. Keep requested tables compact (at most 5 rows), summarize the rest, and never retry a failed visualization just to repeat the same information; answer briefly in text instead. Copy only values returned by the authorized tools; do not invent, estimate, or include credentials. Use charts only for finite numeric series.",
        "When the user explicitly requests a graph, chart, report, plot, or visualization, call savia_present_visualization with exact authorized data and never state that a graph was created unless that tool was called. If the authorized results do not contain a finite numeric series, say that a graph cannot be created instead of claiming one was created.",
        "To generate a NEW auto insurance quote, call savia_get_quote_form to learn requirements but NEVER recite the whole form. Start with plate and city; collect only missing data, at most 3 short questions per turn. As soon as a plate is supplied, call savia_lookup_quote_vehicle once for it and use the returned Fasecolda, year, insured value and accessories; do not ask the user to find these codes. Resolve city names with savia_lookup_dane_city, not domain discovery. Use an unambiguous official result directly (including correcting a mistyped code when the city is explicit); if multiple municipalities match, ask for the department. Ask whether circulation and residence city are the same only if unclear. Preserve all supplied and verified data. Parse natural dates, gender words/obvious typos and yes/no into form values without asking confirmation just for formatting. Do not infer sex from names, invent missing personal data or amounts, or ask for optional second surname. Never repeat the same lookup unless the plate/city changed or the user requests a retry; if it fails explain once and request only the unavailable fields. With all validated fields, call savia_prepare_command exactly once with domain insurance, command quote-auto, input {vehicle, applicant}. After the tool returns a confirmation card say only: Revisa los datos y pulsa Confirmar y cotizar. Do NOT repeat its data, ask for another yes, or add a second confirmation or warning. The card handles the real requests and saved result. Do not create quote rows through CRUD, buy or issue policies, or automatically retry confirmed quotes. Missing coverage/deductibles must be stated rather than inventing a best policy.",
        "Never execute a write directly. All writes require explicit confirmation via savia_prepare_command.",
        "To create, update, or delete records in CRM collections (e.g. cartera, clientes, contact, account, etc.): call savia_prepare_command exactly once. Use domain: 'crm' (or the collection name) and command: 'create-record', 'update-record', or 'delete-record'. For 'create-record', supply input: { collection: '<collection_name>', data: { <field>: <value>, ... } }. For 'update-record', supply input: { collection: '<collection_name>', id: '<record_id>', data: { <field>: <value>, ... } }. For 'delete-record', supply input: { collection: '<collection_name>', id: '<record_id>' }. Before preparing an update or delete, query or read the record first with savia_get_crm_record or savia_list_crm_records to verify the target id and existing fields. Tell the user what record change is proposed and that their confirmation is required.",
        "To send an email or create a calendar event through a personal integration, prepare exactly one command in domain personal-integrations: send-email with provider gmail or outlook, to, subject, and body; or create-event with provider google_calendar or outlook, title, startsAt, endsAt, and optional attendees. To save a new text file, prepare upload-file with provider google_drive, onedrive_personal, or onedrive_business, name, content, and optional mimeType text/plain, text/markdown, text/csv, or application/json. Explicit confirmation is always required.",
        "Do not reveal, request, or repeat credentials, authorization headers, internal URLs, or secrets.",
      );

      const chosenModel = employee?.model?.trim() || effective.model;

      const result = streamText({
        model: openrouter(chosenModel),
        system: systemInstructions.filter(Boolean).join(" "),
        messages: await convertToModelMessages(
          request.messages as UIMessage[],
          {
            tools,
            ignoreIncompleteToolCalls: true,
          },
        ),
        tools,
        toolChoice: requiresVisualization ? "required" : "auto",
        maxOutputTokens: defaultAssistantMaxOutputTokens,
        stopWhen: requiresVisualization
          ? [isStepCount(5), hasToolCall("savia_present_visualization")]
          : isStepCount(5),
        prepareStep: requiresVisualization
          ? ({ stepNumber }) =>
              stepNumber >= 2
                ? {
                    toolChoice: {
                      type: "tool",
                      toolName: "savia_present_visualization",
                    },
                  }
                : undefined
          : undefined,
        onEnd: () => {
          void mcpClient.close().catch(() => undefined);
        },
      });

      const response = result.toUIMessageStreamResponse({
        originalMessages: request.messages as UIMessage[],
      });

      if (employee) {
        response.headers.set("x-savia-employee-id", employee.id);
        response.headers.set("x-savia-employee-handle", employee.handle);
        response.headers.set(
          "x-savia-employee-name",
          encodeURIComponent(employee.name),
        );
        if (employee.avatar) {
          response.headers.set("x-savia-employee-avatar", employee.avatar);
        }
      }

      return response;
    } catch (error) {
      await mcpClient.close();
      throw error;
    }
  }

  private buildMcpToolCallForAction(action: {
    id: string;
    domain: string;
    command: string;
    input: Record<string, unknown>;
  }): { name: string; arguments: Record<string, unknown> } {
    if (action.domain === "personal-integrations") {
      return {
        name: "savia_execute_personal_action",
        arguments: { actionId: action.id },
      };
    }

    const cmd = action.command.toLowerCase();
    const isCrmRecordAction =
      action.domain === "crm" ||
      cmd === "create-record" ||
      cmd === "update-record" ||
      cmd === "delete-record" ||
      cmd === "create_crm_record" ||
      cmd === "update_crm_record" ||
      cmd === "delete_crm_record" ||
      cmd === "create" ||
      cmd === "update" ||
      cmd === "delete" ||
      Boolean(action.input.collection && cmd.includes("record")) ||
      Boolean(action.input.object && cmd.includes("record"));

    if (isCrmRecordAction) {
      const object = String(
        action.input.collection ??
          action.input.object ??
          (action.domain !== "crm" ? action.domain : ""),
      ).trim();

      const id = action.input.id ? String(action.input.id) : undefined;
      const version =
        typeof action.input.version === "number"
          ? action.input.version
          : undefined;

      let data = (
        action.input.data && typeof action.input.data === "object"
          ? action.input.data
          : null
      ) as Record<string, unknown> | null;

      if (!data) {
        const {
          collection: _c,
          object: _o,
          id: _i,
          version: _v,
          _employeeId: _e,
          ...rest
        } = action.input;
        data = Object.keys(rest).length > 0 ? rest : {};
      }

      if (cmd.includes("delete") || cmd.includes("remove")) {
        return {
          name: "savia_delete_crm_record",
          arguments: {
            object,
            id: id ?? "",
            ...(version !== undefined ? { version } : {}),
          },
        };
      }

      if (
        cmd.includes("update") ||
        cmd.includes("edit") ||
        cmd.includes("patch")
      ) {
        return {
          name: "savia_update_crm_record",
          arguments: {
            object,
            id: id ?? "",
            data,
          },
        };
      }

      // Default to create
      return {
        name: "savia_create_crm_record",
        arguments: {
          object,
          data,
        },
      };
    }

    return {
      name: "savia_execute_command",
      arguments: {
        domain: action.domain,
        command: action.command,
        input: action.input,
      },
    };
  }

  async confirmAction(
    request: AssistantActionRequest,
  ): Promise<AssistantActionResult> {
    const action = await this.actions.consume(
      request.actionId,
      request.principalId,
    );
    if (!action) return { state: "unavailable" };

    let mcpClient: AssistantMcpClient | undefined;
    try {
      mcpClient = await this.mcpClientFactory(request.authorization);
      const toolCall = this.buildMcpToolCallForAction(action);
      const result = await mcpClient.callTool(
        action.domain === "insurance" && action.command === "quote-auto"
          ? {
              ...toolCall,
              options: { timeout: 300_000, maxTotalTimeout: 300_000 },
            }
          : toolCall,
      );
      if (isMcpToolError(result)) {
        const failed = await this.actions.fail(action.id, result);
        return failed ? { state: "failed" } : { state: "unavailable" };
      }
      const completed = await this.actions.complete(action.id, result);
      return completed
        ? { state: "completed", result: completed.result }
        : { state: "unavailable" };
    } catch {
      await this.actions.fail(action.id, {
        message: "The command could not be completed",
      });
      return { state: "failed" };
    } finally {
      await mcpClient?.close();
    }
  }

  async cancelAction({
    actionId,
    principalId,
  }: Omit<
    AssistantActionRequest,
    "authorization"
  >): Promise<AssistantActionResult> {
    return (await this.actions.cancel(actionId, principalId))
      ? { state: "cancelled" }
      : { state: "unavailable" };
  }
}
