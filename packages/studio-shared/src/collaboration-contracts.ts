import { z } from "zod";
import { mailContextReferenceSchema } from "./mail-contracts";

export const collaborationProviderSchema = z.enum(["slack", "microsoft_teams"]);
export type CollaborationProvider = z.infer<typeof collaborationProviderSchema>;

export const collaborationChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  teamId: z.string().optional(),
  teamName: z.string().optional(),
});
export type CollaborationChannel = z.infer<typeof collaborationChannelSchema>;

export const collaborationChannelPageSchema = z.object({
  channels: z.array(collaborationChannelSchema),
  nextCursor: z.string().nullable(),
});
export type CollaborationChannelPage = z.infer<
  typeof collaborationChannelPageSchema
>;

export const shareRecordInputSchema = z
  .object({
    provider: collaborationProviderSchema,
    channelId: z.string().trim().min(1).max(512),
    teamId: z.string().trim().min(1).max(512).optional(),
    title: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(5000),
    url: z.string().trim().min(1).max(2048),
    context: mailContextReferenceSchema,
    requestId: z.string().trim().min(1).max(200),
  })
  .strict();
export type ShareRecordInput = z.infer<typeof shareRecordInputSchema>;

export const shareRecordResultSchema = z.object({
  provider: collaborationProviderSchema,
  messageId: z.string().min(1),
});
export type ShareRecordResult = z.infer<typeof shareRecordResultSchema>;
