import { z } from "zod";
const reserved =
  /^(authorization|host|content-type|connection|content-length|cookie|set-cookie|transfer-encoding|forwarded|x-forwarded-.+|proxy-.+|sec-.+|idempotency-key|x-savia-.+)$/i;
export const webhookDestinationSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    url: z.string().url().max(2048),
    authType: z.enum(["none", "bearer", "api-key"]),
    authHeader: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9-]{0,79}$/)
      .refine((v) => !reserved.test(v))
      .optional(),
    secret: z
      .string()
      .min(1)
      .max(8192)
      .regex(/^[\x20-\x7e]+$/)
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.authType === "api-key") !== !!v.authHeader)
      ctx.addIssue({
        code: "custom",
        message: "Only API-key authentication requires a header",
      });
    if (v.authType === "none" && v.secret)
      ctx.addIssue({
        code: "custom",
        message: "Unauthenticated destinations cannot have secrets",
      });
  });
export type WebhookDestinationInput = z.infer<typeof webhookDestinationSchema>;
export type WebhookDestinationSummary = Omit<
  WebhookDestinationInput,
  "secret"
> & { id: string; revision: number; hasSecret: boolean; enabled: boolean };
export type WebhookAccepted = { executionId: string; duplicate: boolean };
