import type { BaseNodeRegistry } from "./base-node-registry";
import type { BaseToolRegistry } from "./base-tool-registry";
import type { CredentialService } from "./credential-service";
import type { CreditService } from "./credit-service";
import type { DatabaseService } from "./database-service";
import type { DatasetService } from "./dataset-service";
import type { DurableObjectRegistry } from "./durable-object-registry";
import type { ExecutionStore } from "./execution-store";
import type { ExecutionPolicy } from "./execution-policy";
import type { MailboxService } from "./mailbox-service";
import type { MonitoringService } from "./monitoring-service";
import type { ObjectStore } from "./object-store";
import type { OrganizationService } from "./organization-service";
import type { QueueService } from "./queue-service";
import type { SchemaService } from "./schema-service";
import type { CodeModeExecutor } from "./utils/code-mode";
import type { SandboxExecutor } from "./utils/sandbox-mode";

/**
 * Collaborators a Runtime needs. Concrete wiring happens in the consuming app's
 * factory functions (e.g. createWorkflowRuntime(), createWorkerRuntime()).
 *
 * The required entries are those the engine itself calls on every run. The
 * optional ones are capabilities the host may not offer; nodes that need one
 * check for it and report a clear error when it is absent.
 */
export interface RuntimeDependencies<Env = unknown> {
  nodeRegistry: BaseNodeRegistry<Env>;
  credentialProvider: CredentialService;
  executionStore: ExecutionStore;
  /** Optional host-owned execution admission and hard quota service. */
  executionPolicy?: ExecutionPolicy;
  monitoringService: MonitoringService;
  creditService: CreditService;
  objectStore: ObjectStore;
  toolRegistry?: BaseToolRegistry;
  databaseService?: DatabaseService;
  datasetService?: DatasetService;
  durableObjectRegistry?: DurableObjectRegistry;
  queueService?: QueueService;
  schemaService?: SchemaService;
  mailboxService?: MailboxService;
  organizationService?: OrganizationService;
  /** Sandboxed JavaScript executor (private QuickJS service in production). */
  codeModeExecutor?: CodeModeExecutor;
  /** Multi-language sandbox executor (Cloudflare Containers in production). */
  sandboxExecutor?: SandboxExecutor;
  runtimeVersion?: string;
}
