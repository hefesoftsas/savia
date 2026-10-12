// Re-export validation functions from @savia/flows-runtime
export {
  detectCycles,
  type ValidationError,
  validateTypeCompatibility,
  validateWorkflow,
} from "@savia/flows-runtime";

/**
 * Validates that a workflow has nodes before execution
 * @throws Error if workflow is empty or has no nodes
 */
export function validateWorkflowForExecution(workflow: {
  nodes?: any[];
}): void {
  if (!workflow.nodes || workflow.nodes.length === 0) {
    throw new Error(
      "Cannot execute an empty workflow. Please add nodes to the workflow."
    );
  }
}
