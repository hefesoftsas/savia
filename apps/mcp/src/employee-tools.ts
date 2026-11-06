import type { FastMCP } from "@prefecthq/fastmcp-ts/server";
import { z } from "zod";
import type { SaviaApiClient } from "./savia-api";

const identifier = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);

export function registerEmployeeTools(
  server: FastMCP,
  client: () => SaviaApiClient,
) {
  server.tool(
    {
      name: "savia_list_employees",
      description:
        "Discover active Savia AI employees available in the user's selected organization, with their roles and greetings. Their private instructions and knowledge files are not exposed. Select an employee ID from this list before invoking it.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      input: z.object({}),
    },
    async () => client().listEmployees(),
  );
  server.tool(
    {
      name: "savia_invoke_employee",
      description:
        "Ask an authorized Savia AI employee to complete a task using its own instructions, knowledge and permitted collections. Returns an answer and any pending proposals. This does not execute proposed writes. Show each proposal to the user and get explicit approval before confirming it. If unavailable, do not substitute another employee without asking.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      input: z.object({
        employeeId: identifier,
        message: z.string().trim().min(1).max(12000),
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              text: z.string().max(12000),
            }),
          )
          .max(20)
          .default([]),
      }),
    },
    async ({ employeeId, message, history }) =>
      client().invokeEmployee(employeeId, message, history),
  );
  server.tool(
    {
      name: "savia_confirm_employee_action",
      description:
        "Execute a pending employee proposal only AFTER showing its exact operation and inputs to the user and receiving explicit approval. Requires write permission; the action must belong to this user and must not be expired or already executed. Never automatically approve an employee's own proposal.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
      input: z.object({ actionId: identifier, confirmed: z.literal(true) }),
    },
    async ({ actionId }) => client().employeeAction(actionId, "confirm"),
  );
  server.tool(
    {
      name: "savia_cancel_employee_action",
      description:
        "Cancel the current user's pending employee proposal without executing it.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      input: z.object({ actionId: identifier }),
    },
    async ({ actionId }) => client().employeeAction(actionId, "cancel"),
  );
  server.tool(
    {
      name: "savia_get_employee_action",
      description:
        "Read the status and result of this user's employee proposal. Use this after a connection interruption instead of repeating a write.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      input: z.object({ actionId: identifier }),
    },
    async ({ actionId }) => client().employeeAction(actionId, "status"),
  );
}
