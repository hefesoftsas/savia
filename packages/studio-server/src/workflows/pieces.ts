import {
  checkPieceValue,
  validatePieceConfig,
  workflowPieceSchema,
  type WorkflowPiece,
} from "@savia/studio-shared/workflow-pieces";
import type { WorkflowValue } from "@savia/studio-shared/workflows";
import { resolveWorkflowValue } from "@savia/studio-shared/workflows";
import { fail } from "../context";

export type PieceContext = {
  db: D1Database;
  workspace: string;
  owner: string;
  executionId: string;
  nodeId: string;
  fetch: typeof fetch;
  now: number;
};
export type WorkflowPieceHandler = {
  descriptor: WorkflowPiece;
  execute: (input: {
    config: Record<string, unknown>;
    context: PieceContext;
  }) => Promise<unknown>;
};

const logPiece: WorkflowPieceHandler = {
  descriptor: workflowPieceSchema.parse({
    id: "log",
    version: 1,
    label: "Log message",
    description:
      "Records a message in the execution history for debugging flows.",
    inputs: [
      { key: "message", label: "Message", type: "text", required: true },
    ],
    outputs: ["message"],
    retryable: false,
  }),
  execute: async ({ config }) => ({ message: config.message }),
};

const builtinWorkflowPieces: WorkflowPieceHandler[] = [logPiece];

/** Descriptors of the pieces every workspace can use. */
export function builtinWorkflowPieceDescriptors(): WorkflowPiece[] {
  return builtinWorkflowPieces.map((piece) => piece.descriptor);
}

/** Descriptor-level merge with the same override rule as handlers. */
export function resolveWorkflowPieceDescriptors(
  custom: readonly WorkflowPiece[] = [],
): WorkflowPiece[] {
  const overridden = new Set(
    custom.map((piece) => `${piece.id}:${piece.version}`),
  );
  return [
    ...builtinWorkflowPieceDescriptors().filter(
      (piece) => !overridden.has(`${piece.id}:${piece.version}`),
    ),
    ...custom,
  ];
}

/** Custom pieces override builtins only on exact id+version match. */
export function resolveWorkflowPieces(
  custom: readonly WorkflowPieceHandler[] = [],
): WorkflowPieceHandler[] {
  const overridden = new Set(
    custom.map((piece) => `${piece.descriptor.id}:${piece.descriptor.version}`),
  );
  return [
    ...builtinWorkflowPieces.filter(
      (piece) =>
        !overridden.has(`${piece.descriptor.id}:${piece.descriptor.version}`),
    ),
    ...custom,
  ];
}

export function findWorkflowPiece(
  pieces: readonly WorkflowPieceHandler[],
  pieceId: string,
  pieceVersion: number,
): WorkflowPieceHandler {
  const piece = pieces.find(
    (entry) =>
      entry.descriptor.id === pieceId &&
      entry.descriptor.version === pieceVersion,
  );
  if (!piece) fail("Workflow piece is not available", 422);
  return piece;
}

function resolveConfig(
  descriptor: WorkflowPiece,
  config: Record<string, WorkflowValue>,
  resolve: (value: WorkflowValue) => unknown,
): Record<string, unknown> {
  const errors = validatePieceConfig(descriptor, config);
  if (errors.length > 0) fail(errors[0], 422);
  const resolved: Record<string, unknown> = {};
  for (const [name, fieldValue] of Object.entries(config)) {
    const value = resolve(fieldValue);
    const error = checkPieceValue(descriptor, name, value);
    if (error) fail(error, 422);
    if (value !== null && value !== undefined) resolved[name] = value;
  }
  return resolved;
}

export async function executeWorkflowPiece(
  piece: WorkflowPieceHandler,
  config: Record<string, WorkflowValue>,
  resolve: (value: WorkflowValue) => unknown,
  context: PieceContext,
): Promise<unknown> {
  const resolved = resolveConfig(piece.descriptor, config, resolve);
  try {
    return await piece.execute({ config: resolved, context });
  } catch (error) {
    if (piece.descriptor.retryable === false) {
      const message = error instanceof Error ? error.message : String(error);
      fail(message.slice(0, 1000), 422);
    }
    throw error;
  }
}
