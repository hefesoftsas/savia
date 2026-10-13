export interface ExecutionPolicyAdmission {
  executionId: string;
  organizationId: string;
  workflowId: string;
  nodeCount: number;
}

/** Host integration for pausing runs and enforcing per-organization quotas. */
export interface ExecutionPolicy {
  admit(input: ExecutionPolicyAdmission): Promise<{
    allowed: boolean;
    reason?: string;
    alreadyActive?: boolean;
  }>;
  consumeStep(executionId: string): Promise<void>;
  release(executionId: string, terminal: boolean): Promise<void>;
}
