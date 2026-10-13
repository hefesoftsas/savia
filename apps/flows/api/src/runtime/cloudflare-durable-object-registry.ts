import type { DurableObjectRegistry } from "@savia/flows-runtime";

import type { Bindings } from "../context";

export class CloudflareDurableObjectRegistry implements DurableObjectRegistry {
  constructor(private readonly db: D1Database) {}

  async register(
    kind: "workflow-agent" | "agent-runner" | "email-agent-runner",
    name: string,
  ): Promise<void> {
    if (!name || name.length > 512)
      throw new Error("Invalid durable object name");
    await this.db
      .prepare(
        "INSERT INTO durable_object_registry(kind,name) VALUES(?,?) ON CONFLICT(kind,name) DO NOTHING",
      )
      .bind(kind, name)
      .run();
  }
}

export function createDurableObjectRegistry(
  env: Pick<Bindings, "DB">,
): DurableObjectRegistry {
  return new CloudflareDurableObjectRegistry(env.DB);
}
