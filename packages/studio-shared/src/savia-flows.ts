/** Internal Savia/Flows protocol. No browser credentials cross this boundary. */
export type SaviaCollectionOperation =
  "created" | "updated" | "deleted" | "restored";

export interface SaviaCollectionEvent {
  id: string;
  tenant: string;
  collection: string;
  operation: SaviaCollectionOperation;
  recordId: string;
  recordVersion: number;
  timestamp: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedFields: string[];
  actor: { kind: string; id: string | null };
  cause?: { rootEventId: string; workflowIds: string[]; depth: number };
}

export interface SaviaCollectionField {
  name: string;
  label: string;
  type: string;
  required: boolean;
  readOnly: boolean;
  options?: unknown;
}

export interface SaviaCollectionSchema {
  name: string;
  label: string;
  fields: SaviaCollectionField[];
  capabilities: {
    list: boolean;
    read: boolean;
    create: boolean;
    update: boolean;
    delete: boolean;
  };
}

export interface SaviaCollectionCall {
  action:
    | "catalog"
    | "list"
    | "read"
    | "create"
    | "update"
    | "delete"
    | "authorize-event";
  collection?: string;
  recordId?: string;
  version?: number;
  data?: Record<string, unknown>;
  filters?: Record<string, unknown>;
  page?: number;
  pageSize?: number;
  eventId?: string;
  /** Backend-established ancestry; the host adds the current workflow on writes. */
  cause?: SaviaCollectionEvent["cause"];
}

export interface SaviaCollectionIdentity {
  principalId: string;
  tenant: string;
  workflowId?: string;
  executionId?: string;
  nodeId?: string;
}
