import type { SaviaCollectionEvent } from "@savia/studio-shared/savia-flows";
import type { NodeType, NodeExecution } from "@savia/flows-types";
import { ExecutableNode, type NodeContext } from "@savia/flows-runtime";
import { callSaviaCollections } from "./collection-client";

const stringInput = (name: string, description: string) => ({
  name,
  type: "string" as const,
  description,
  required: true,
});
const jsonInput = (name: string, description: string, required = true) => ({
  name,
  type: "json" as const,
  description,
  required,
});
const jsonOutput = (name: string, description: string) => ({
  name,
  type: "json" as const,
  description,
});

abstract class SaviaCollectionNode extends ExecutableNode {
  protected call<T>(
    context: NodeContext,
    action: Parameters<typeof callSaviaCollections>[1]["action"],
    values: Record<string, unknown> = {},
  ) {
    return callSaviaCollections<T>(
      context.env as never,
      {
        action,
        ...values,
        cause: values.cause ??
          context.saviaCollectionEvent?.cause ?? {
            rootEventId:
              context.saviaCollectionEvent?.id ??
              `execution:${context.executionId ?? "unknown"}`,
            workflowIds: [],
            depth: 0,
          },
      } as Parameters<typeof callSaviaCollections>[1],
      {
        principalId: context.userId ?? "",
        tenant: context.organizationId,
        workflowId: context.workflowId,
        executionId: context.executionId,
        nodeId: context.nodeId,
      },
    );
  }

  protected requiredString(context: NodeContext, name: string): string {
    const value = context.inputs[name];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`${name} is required`);
    }
    return value;
  }
}

export class SaviaCollectionEventNode extends SaviaCollectionNode {
  static readonly nodeType: NodeType = {
    id: "savia-collection-event",
    name: "Collection Event",
    type: "savia-collection-event",
    description: "Starts a workflow when a local collection record changes.",
    tags: ["Savia", "Trigger"],
    icon: "database",
    trigger: true,
    inlinable: true,
    inputs: [],
    outputs: [
      jsonOutput("event", "Permission-projected collection event"),
      jsonOutput("events", "Permission-projected collection events"),
      { name: "eventCount", type: "number", description: "Number of events" },
    ],
  };

  async execute(context: NodeContext): Promise<NodeExecution> {
    const event = context.saviaCollectionEvent as
      SaviaCollectionEvent | undefined;
    if (!event)
      return this.createErrorResult("No Savia collection event was supplied.");
    const events = context.saviaCollectionEvents ?? [event];
    return this.createSuccessResult({
      event,
      events,
      eventCount: events.length,
    });
  }
}

export class SaviaListRecordsNode extends SaviaCollectionNode {
  static readonly nodeType: NodeType = {
    id: "savia-list-records",
    name: "List Records",
    type: "savia-list-records",
    description: "Lists permission-visible records from a Savia collection.",
    tags: ["Savia", "Data"],
    icon: "list",
    inputs: [
      stringInput("collection", "Local collection"),
      jsonInput("filters", "Equality filters", false),
      {
        name: "page",
        type: "number",
        description: "Page number",
        required: false,
      },
      {
        name: "pageSize",
        type: "number",
        description: "Records per page",
        required: false,
      },
    ],
    outputs: [
      jsonOutput("data", "Records"),
      { name: "total", type: "number", description: "Matching record count" },
      { name: "page", type: "number", description: "Current page" },
      { name: "pageSize", type: "number", description: "Page size" },
    ],
  };
  async execute(context: NodeContext): Promise<NodeExecution> {
    const result = await this.call<{
      data: unknown[];
      total?: number;
      page: number;
      pageSize: number;
    }>(context, "list", {
      collection: this.requiredString(context, "collection"),
      filters: context.inputs.filters ?? {},
      page: context.inputs.page,
      pageSize: context.inputs.pageSize,
    });
    return this.createSuccessResult({
      data: result.data,
      total: result.total ?? result.data.length,
      page: result.page,
      pageSize: result.pageSize,
    });
  }
}

export class SaviaReadRecordNode extends SaviaCollectionNode {
  static readonly nodeType: NodeType = {
    id: "savia-read-record",
    name: "Read Record",
    type: "savia-read-record",
    description: "Reads a permission-visible Savia collection record.",
    tags: ["Savia", "Data"],
    icon: "file-search",
    inputs: [
      stringInput("collection", "Local collection"),
      stringInput("recordId", "Record identifier"),
    ],
    outputs: [jsonOutput("data", "Record")],
  };
  async execute(context: NodeContext): Promise<NodeExecution> {
    const result = await this.call<{ data: unknown }>(context, "read", {
      collection: this.requiredString(context, "collection"),
      recordId: this.requiredString(context, "recordId"),
    });
    return this.createSuccessResult({ data: result.data });
  }
}

export class SaviaCreateRecordNode extends SaviaCollectionNode {
  static readonly nodeType: NodeType = {
    id: "savia-create-record",
    name: "Create Record",
    type: "savia-create-record",
    description: "Creates a Savia collection record.",
    tags: ["Savia", "Data"],
    icon: "plus",
    inputs: [
      stringInput("collection", "Local collection"),
      jsonInput("data", "Values for writable fields"),
    ],
    outputs: [jsonOutput("data", "Created record")],
  };
  async execute(context: NodeContext): Promise<NodeExecution> {
    const data = context.inputs.data;
    if (!data || typeof data !== "object" || Array.isArray(data))
      return this.createErrorResult("data must be an object");
    const result = await this.call<{ data: unknown }>(context, "create", {
      collection: this.requiredString(context, "collection"),
      data,
    });
    return this.createSuccessResult({ data: result.data });
  }
}

export class SaviaUpdateRecordNode extends SaviaCollectionNode {
  static readonly nodeType: NodeType = {
    id: "savia-update-record",
    name: "Update Record",
    type: "savia-update-record",
    description: "Updates a Savia collection record at its current version.",
    tags: ["Savia", "Data"],
    icon: "pencil",
    inputs: [
      stringInput("collection", "Local collection"),
      stringInput("recordId", "Record identifier"),
      {
        name: "version",
        type: "number",
        description: "Current record version",
        required: true,
      },
      jsonInput("data", "Values for writable fields"),
    ],
    outputs: [jsonOutput("data", "Updated record")],
  };
  async execute(context: NodeContext): Promise<NodeExecution> {
    const version = context.inputs.version;
    const data = context.inputs.data;
    if (!Number.isInteger(version) || Number(version) < 1)
      return this.createErrorResult("version must be a positive integer");
    if (!data || typeof data !== "object" || Array.isArray(data))
      return this.createErrorResult("data must be an object");
    const result = await this.call<{ data: unknown }>(context, "update", {
      collection: this.requiredString(context, "collection"),
      recordId: this.requiredString(context, "recordId"),
      version,
      data,
    });
    return this.createSuccessResult({ data: result.data });
  }
}

export class SaviaDeleteRecordNode extends SaviaCollectionNode {
  static readonly nodeType: NodeType = {
    id: "savia-delete-record",
    name: "Delete Record",
    type: "savia-delete-record",
    description: "Deletes a Savia collection record at its current version.",
    tags: ["Savia", "Data"],
    icon: "trash",
    inputs: [
      stringInput("collection", "Local collection"),
      stringInput("recordId", "Record identifier"),
      {
        name: "version",
        type: "number",
        description: "Current record version",
        required: true,
      },
    ],
    outputs: [jsonOutput("data", "Deleted record identity and version")],
  };
  async execute(context: NodeContext): Promise<NodeExecution> {
    const version = context.inputs.version;
    if (!Number.isInteger(version) || Number(version) < 1)
      return this.createErrorResult("version must be a positive integer");
    const result = await this.call<{ data: unknown }>(context, "delete", {
      collection: this.requiredString(context, "collection"),
      recordId: this.requiredString(context, "recordId"),
      version,
    });
    return this.createSuccessResult({ data: result.data });
  }
}

export const SAVIA_COLLECTION_NODES = [
  SaviaCollectionEventNode,
  SaviaListRecordsNode,
  SaviaReadRecordNode,
  SaviaCreateRecordNode,
  SaviaUpdateRecordNode,
  SaviaDeleteRecordNode,
] as const;
