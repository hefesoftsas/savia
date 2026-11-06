export interface DurableObjectRegistry {
  register(kind: "workflow-agent" | "agent-runner" | "email-agent-runner", name: string): Promise<void>;
}
