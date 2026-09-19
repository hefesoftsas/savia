import type { WorkflowBundle } from "@savia/crm-shared/workflow-bundles";
import { fail } from "../context";
import { getObject, assertLocalCollection } from "../services";
import { publishSchema, previewSchema } from "../schema";
import { WorkflowRepository } from "./repository";

export async function prepareWorkflowBundle(
  db: D1Database,
  workspace: string,
  owner: string,
  bundle: WorkflowBundle,
) {
  const repo = new WorkflowRepository(db, workspace);
  for (const collection of bundle.collections) {
    await assertLocalCollection(db, workspace, collection);
    await getObject(db, workspace, collection);
  }
  const patches = [];
  for (const patch of bundle.fields) {
    if (
      patch.optional &&
      !(await db
        .prepare("SELECT 1 FROM crm_objects WHERE tenant_id=? AND name=?")
        .bind(workspace, patch.collection)
        .first())
    )
      continue;
    const current = await getObject(db, workspace, patch.collection);
    const fields = { ...current.config.fields };
    let changed = false;
    for (const [key, field] of Object.entries(patch.fields)) {
      if (fields[key]) {
        if (
          fields[key].type !== field.type ||
          Boolean(fields[key].config?.multiple) !==
            Boolean(field.config?.multiple) ||
          (fields[key].config?.onDelete ?? "restrict") !==
            (field.config?.onDelete ?? "restrict") ||
          fields[key].config?.relation !== field.config?.relation ||
          Boolean(fields[key].config?.unique) !==
            Boolean(field.config?.unique) ||
          (field.required && !fields[key].required)
        )
          fail(
            `El campo ${patch.collection}.${key} ya existe con otra configuración. Revisa el diseñador antes de preparar este flujo.`,
            409,
          );
      } else {
        fields[key] = field;
        changed = true;
      }
    }
    if (!changed) continue;
    const next = {
      ...current,
      config: {
        ...current.config,
        fields,
        fieldOrder: [
          ...(current.config.fieldOrder ?? Object.keys(current.config.fields)),
          ...Object.keys(patch.fields).filter(
            (key) => !current.config.fields[key],
          ),
        ],
      },
    };
    const preview = await previewSchema(db, workspace, patch.collection, next);
    if (!preview.valid)
      fail(
        `La colección ${patch.collection} contiene datos incompatibles. Revisa el diseñador.`,
        409,
      );
    patches.push(next);
  }
  // Preflight all schemas before applying additive changes. A concurrent conflict
  // can leave earlier additions installed; retry resumes without replacing fields.
  for (const object of patches)
    await publishSchema(db, workspace, object.name, object);
  const drafts = [];
  for (const flow of bundle.workflows) {
    await repo.validate(flow.definition);
    const id = `bundle:${bundle.id}:${flow.key}`;
    await db
      .prepare(
        "INSERT INTO workflows(workspace_id,id,name,definition,created_by) VALUES (?,?,?,?,?) ON CONFLICT(workspace_id,id) DO NOTHING",
      )
      .bind(workspace, id, flow.name, JSON.stringify(flow.definition), owner)
      .run();
    drafts.push(await repo.get(id));
  }
  return { workflows: drafts, collections: patches.map((p) => p.name) };
}
