import { z } from "zod";
export const personalMailProviders = ["gmail", "outlook"] as const;
export type PersonalMailProvider = (typeof personalMailProviders)[number];
const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
export const mailContextReferenceSchema = z
  .object({
    apiBasePath: z
      .string()
      .regex(/^\/v1\/(?:studio|dynamic-crm)\/(?:0|[1-9][0-9]*)$/),
    collection: identifier,
    recordId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine(
        (value) =>
          !/[\u0000-\u001f]/.test(value) && value !== "." && value !== "..",
      ),
    fields: z
      .array(identifier)
      .min(1)
      .max(50)
      .refine((fields) => new Set(fields).size === fields.length),
  })
  .strict();
export const sendPersonalMailSchema = z
  .object({
    provider: z.enum(personalMailProviders),
    to: z.array(z.string().trim().email().max(320)).min(1).max(20),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .refine(
        (value) => !/[\r\n\u0000]/.test(value),
        "Subject must not contain line breaks",
      ),
    body: z
      .string()
      .min(1)
      .max(10000)
      .refine((value) => value.trim().length > 0, "Message must not be blank"),
    context: z.array(mailContextReferenceSchema).max(10).optional(),
  })
  .strict();
export type MailContextReference = z.infer<typeof mailContextReferenceSchema>;
export type SendPersonalMailInput = z.infer<typeof sendPersonalMailSchema>;
export type PersonalMailMessage = {
  id: string;
  subject: string | null;
  sender: string | null;
  receivedAt: string | null;
  webLink: string | null;
};
