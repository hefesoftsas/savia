import { WebhookDestinationRepository } from "./webhook-destinations";
import {
  workflowDraftSchema,
  type WorkflowDefinition,
} from "@savia/studio-shared/workflows";
import { fieldEntries } from "@savia/studio-shared/metadata";
import { fail } from "../context";
import {
  assertLocalCollection,
  getObject,
  guard,
  transaction,
} from "../services";

export type WorkflowRow = {
  workspace_id: string;
  id: string;
  name: string;
  definition: string;
  revision: number;
  enabled: number;
  published_version: string | null;
  created_by: string;
  next_run_at: number | null;
};
export type ExecutionRow = {
  workspace_id: string;
  id: string;
  workflow_id: string;
  version_id: string;
  owner_id: string;
  initiator_id: string;
  event_key: string;
  status: string;
  node_id: string | null;
  context: string;
  depth: number;
  wake_at: number;
  lease_token: string | null;
  lease_until: number;
  attempts: number;
  error: string | null;
};
const parse = (row: WorkflowRow) => ({
  ...row,
  definition: JSON.parse(row.definition) as WorkflowDefinition,
});

/** All public operations are workspace scoped. The host authorizes the action first. */
export class WorkflowRepository {
  constructor(
    readonly db: D1Database,
    readonly workspace: string,
  ) {}
  async list() {
    return (
      await this.db
        .prepare(
          "SELECT * FROM workflows WHERE workspace_id=? ORDER BY created_at DESC,id LIMIT 200",
        )
        .bind(this.workspace)
        .all<WorkflowRow>()
    ).results.map(parse);
  }
  async get(id: string) {
    const row = await this.db
      .prepare("SELECT * FROM workflows WHERE workspace_id=? AND id=?")
      .bind(this.workspace, id)
      .first<WorkflowRow>();
    if (!row) fail("Workflow not found", 404);
    return parse(row);
  }
  async create(input: unknown, owner: string) {
    const draft = workflowDraftSchema.parse(input),
      id = crypto.randomUUID();
    await this.db
      .prepare(
        "INSERT INTO workflows(workspace_id,id,name,definition,created_by) VALUES (?,?,?,?,?)",
      )
      .bind(
        this.workspace,
        id,
        draft.name,
        JSON.stringify(draft.definition),
        owner,
      )
      .run();
    return this.get(id);
  }
  async save(id: string, revision: number, input: unknown) {
    const draft = workflowDraftSchema.parse(input);
    const result = await this.db
      .prepare(
        "UPDATE workflows SET name=?,definition=?,revision=revision+1 WHERE workspace_id=? AND id=? AND revision=?",
      )
      .bind(
        draft.name,
        JSON.stringify(draft.definition),
        this.workspace,
        id,
        revision,
      )
      .run();
    if (!result.meta.changes) fail("Draft changed; reload before saving", 409);
    return this.get(id);
  }
  async validate(definition: WorkflowDefinition) {
    for (const node of definition.nodes)
      if (node.type === "webhook")
        await new WebhookDestinationRepository(
          this.db,
          this.workspace,
        ).validate(node.destinationId, node.destinationRevision);
    for (const item of [definition.trigger, ...definition.nodes]) {
      if (!("collection" in item) || !item.collection) continue;
      await assertLocalCollection(this.db, this.workspace, item.collection);
      const object = await getObject(this.db, this.workspace, item.collection);
      const kind = object.config.studio?.collection?.kind;
      if (kind && kind !== "crm")
        fail("Workflow steps currently support native collections only", 422);
      const fields = new Set(fieldEntries(object).map(([name]) => name));
      if ("type" in item && item.type === "query") fields.add("id");
      if ("type" in item && item.type === "create" && item.matchField) {
        const field = object.config.fields[item.matchField];
        if (
          !field?.config?.unique ||
          field.config?.multiple ||
          !["Textbox", "Dropdown"].includes(field.type) ||
          !(item.matchField in item.values)
        )
          fail("Matched creation requires a mapped unique field", 422);
      }
      const used =
        "values" in item
          ? Object.keys(item.values)
          : "field" in item
            ? [item.field]
            : "changedFields" in item
              ? item.changedFields
              : [];
      if (used.some((name) => !fields.has(name)))
        fail(`Unknown field in ${item.collection}`, 422);
      if (
        "conditions" in item &&
        item.conditions?.some(
          (condition) =>
            !fields.has(condition.field) && condition.field !== "id",
        )
      )
        fail(`Unknown field in ${item.collection}`, 422);
    }
  }
  async publish(id: string, revision: number, owner: string) {
    const draft = await this.get(id);
    if (draft.revision !== revision)
      fail("Draft changed; reload before publishing", 409);
    await this.validate(draft.definition);
    const version = `${id}:${revision}`,
      g = guard(
        this.db,
        "SELECT revision=? FROM workflows WHERE workspace_id=? AND id=?",
        [revision, this.workspace, id],
      );
    const due =
      draft.definition.trigger.type === "schedule"
        ? Date.parse(draft.definition.trigger.startAt)
        : null;
    await transaction(this.db, [
      g.start,
      this.db
        .prepare(
          "INSERT INTO workflow_versions(workspace_id,id,workflow_id,definition,owner_id,revision) VALUES (?,?,?,?,?,?) ON CONFLICT(workspace_id,workflow_id,revision) DO NOTHING",
        )
        .bind(
          this.workspace,
          version,
          id,
          JSON.stringify(draft.definition),
          owner,
          revision,
        ),
      this.db
        .prepare(
          "UPDATE workflows SET next_run_at=CASE WHEN published_version=? THEN next_run_at ELSE ? END,published_version=?,enabled=1 WHERE workspace_id=? AND id=?",
        )
        .bind(version, due, version, this.workspace, id),
      g.end,
    ]);
    return this.get(id);
  }
  async setEnabled(id: string, enabled: boolean) {
    const row = await this.get(id);
    if (enabled && !row.published_version) fail("Publish a version first", 422);
    await this.db
      .prepare("UPDATE workflows SET enabled=? WHERE workspace_id=? AND id=?")
      .bind(enabled ? 1 : 0, this.workspace, id)
      .run();
    return this.get(id);
  }
  async start(
    id: string,
    data: Record<string, unknown>,
    initiator: string,
    key: string,
  ) {
    if (!key || key.length > 150 || JSON.stringify(data).length > 32000)
      fail("Invalid execution input", 422);
    const row = await this.get(id);
    const version = await this.db
      .prepare(
        "SELECT definition,owner_id FROM workflow_versions WHERE workspace_id=? AND id=?",
      )
      .bind(this.workspace, row.published_version)
      .first<{ definition: string; owner_id: string }>();
    if (!row.enabled || !version) fail("Workflow is not active", 409);
    const definition = JSON.parse(version.definition) as WorkflowDefinition;
    if (definition.trigger.type !== "manual")
      fail("This workflow does not accept manual starts", 422);
    const run = crypto.randomUUID();
    const g = guard(
      this.db,
      "SELECT enabled=1 AND published_version=? FROM workflows WHERE workspace_id=? AND id=?",
      [row.published_version, this.workspace, id],
    );
    await transaction(this.db, [
      g.start,
      this.db
        .prepare(
          "INSERT INTO workflow_executions(workspace_id,id,workflow_id,version_id,owner_id,initiator_id,event_key,node_id,context) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,workflow_id,event_key) DO NOTHING",
        )
        .bind(
          this.workspace,
          run,
          id,
          row.published_version,
          version.owner_id,
          initiator,
          `manual:${initiator}:${key}`,
          definition.nodes[0].id,
          JSON.stringify({
            trigger: data,
            before: {},
            steps: {},
            system: {
              owner: version.owner_id,
              workspace: this.workspace,
              initiator,
            },
          }),
        ),
      g.end,
    ]);
    const result = await this.db
      .prepare(
        "SELECT * FROM workflow_executions WHERE workspace_id=? AND workflow_id=? AND event_key=?",
      )
      .bind(this.workspace, id, `manual:${initiator}:${key}`)
      .first<ExecutionRow>();
    if (
      !result ||
      JSON.stringify(JSON.parse(result.context).trigger) !==
        JSON.stringify(data)
    )
      fail("Execution key was used with different input", 409);
    return result;
  }
  async executions(id: string) {
    await this.get(id);
    return (
      await this.db
        .prepare(
          "SELECT * FROM workflow_executions WHERE workspace_id=? AND workflow_id=? ORDER BY created_at DESC,id LIMIT 100",
        )
        .bind(this.workspace, id)
        .all<ExecutionRow>()
    ).results;
  }
  async execution(id: string) {
    const row = await this.db
      .prepare(
        "SELECT * FROM workflow_executions WHERE workspace_id=? AND id=?",
      )
      .bind(this.workspace, id)
      .first<ExecutionRow>();
    if (!row) fail("Execution not found", 404);
    const jobs = (
      await this.db
        .prepare(
          "SELECT * FROM workflow_jobs WHERE workspace_id=? AND execution_id=? ORDER BY sequence",
        )
        .bind(this.workspace, id)
        .all<{ node_id: string; input: string; output: string }>()
    ).results.map((j) => ({
      ...j,
      input: JSON.parse(j.input),
      output: JSON.parse(j.output),
    }));
    const deliveries = (
      await this.db
        .prepare(
          "SELECT node_id,sequence,started_at,finished_at,status,error,output FROM workflow_webhook_attempts WHERE workspace_id=? AND execution_id=? ORDER BY node_id,sequence",
        )
        .bind(this.workspace, id)
        .all()
    ).results;
    return { ...row, context: JSON.parse(row.context), jobs, deliveries };
  }
  async cancel(id: string) {
    await this.execution(id);
    await this.db
      .prepare(
        "UPDATE workflow_executions SET status='cancelled',lease_token=NULL WHERE workspace_id=? AND id=? AND status IN ('queued','running','waiting')",
      )
      .bind(this.workspace, id)
      .run();
    return this.execution(id);
  }
  async retry(id: string) {
    const g = guard(
      this.db,
      "SELECT EXISTS(SELECT 1 FROM workflow_executions WHERE workspace_id=? AND id=? AND status IN ('failed','blocked'))",
      [this.workspace, id],
    );
    await transaction(this.db, [
      g.start,
      this.db
        .prepare(
          "UPDATE workflow_webhook_deliveries SET generation_attempts=0,retry_generation=retry_generation+1 WHERE workspace_id=? AND execution_id=? AND node_id=(SELECT node_id FROM workflow_executions WHERE workspace_id=? AND id=?)",
        )
        .bind(this.workspace, id, this.workspace, id),
      this.db
        .prepare(
          "UPDATE workflow_executions SET status='queued',attempts=0,wake_at=0,error=NULL WHERE workspace_id=? AND id=?",
        )
        .bind(this.workspace, id),
      g.end,
    ]);
    return this.execution(id);
  }
  async inbox(user: string) {
    return (
      await this.db
        .prepare(
          "SELECT * FROM workflow_tasks WHERE workspace_id=? AND assignee=? ORDER BY created_at DESC,id LIMIT 200",
        )
        .bind(this.workspace, user)
        .all<{ id: string; status: string; title: string; kind: string }>()
    ).results;
  }
  async resolveTask(id: string, user: string) {
    const result = await this.db
      .prepare(
        "UPDATE workflow_tasks SET status='done' WHERE workspace_id=? AND id=? AND assignee=?",
      )
      .bind(this.workspace, id, user)
      .run();
    if (!result.meta.changes) fail("Assigned item not found", 404);
  }
}
