import { z } from "@hono/zod-openapi";

const phone = z
  .string()
  .max(40)
  .transform((v) => v.replace(/[^\d]/g, ""))
  .pipe(z.string().regex(/^[1-9]\d{6,14}$/));
export const channelConfigurationSchema = z
  .object({
    routingEnabled: z.boolean(),
    defaultTaskId: z.string().max(120).nullable().optional(),
    tasks: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            employeeId: z.string().min(1).max(255),
            title: z.string().trim().min(1).max(24),
            description: z.string().trim().max(72),
            order: z.number().int().min(0),
            audiences: z
              .array(z.enum(["external", "internal"]))
              .min(1)
              .max(2),
          })
          .strict(),
      )
      .max(100),
    staff: z
      .array(
        z
          .object({
            phone,
            label: z.string().trim().min(1).max(120),
            active: z.boolean(),
            principalId: z.string().min(1).nullable(),
          })
          .strict(),
      )
      .max(200),
    internalCapabilities: z.array(z.string().min(1).max(120)).max(100),
    externalCapabilities: z.array(z.string().min(1).max(120)).max(100),
  })
  .strict()
  .superRefine((config, ctx) => {
    for (const [field, values] of [
      ["tasks", config.tasks.map((t) => t.id)],
      ["staff", config.staff.map((s) => s.phone)],
    ] as const)
      if (new Set(values).size !== values.length)
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Duplicate identifiers",
        });
    if (
      config.defaultTaskId &&
      !config.tasks.some((t) => t.id === config.defaultTaskId)
    )
      ctx.addIssue({
        code: "custom",
        path: ["defaultTaskId"],
        message: "Default task must be published",
      });
  });
export type ChannelConfiguration = z.infer<typeof channelConfigurationSchema>;
export type ContactKey = {
  tenantId: number;
  connectionId: string;
  contact: string;
};
export type ContactAccess = ContactKey & {
  audience: "external" | "internal";
  generation: string;
  principalId: string | null;
  profileId: string;
  capabilities: string[];
};
export type PublishedTask = ChannelConfiguration["tasks"][number];
export type EmployeeSession = {
  access: ContactAccess;
  employeeId: string;
  selectionRevision: number;
};
export type ChannelAction = {
  id: string;
  session: EmployeeSession;
  revision: number;
  domain: string;
  command: string;
  input: Record<string, unknown>;
};
export type ActionOutcome =
  | { state: "completed"; result: unknown }
  | { state: "failed" | "uncertain"; message: string };
export type ChannelMenu = { id: string; tasks: PublishedTask[]; page: number };
