import { z } from "zod";

export const defaultTicketStatuses = [
  "To Do",
  "In Code Review",
  "Code Review",
  "Ready for QA",
  "QA",
  "QA / Acceptance",
];
export const ticketSummaryConfigSchema = z
  .object({
    project: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
      .optional(),
    statuses: z
      .array(z.string().trim().min(1).max(100))
      .min(1)
      .max(20)
      .optional(),
  })
  .strict();
export type TicketSummaryConfig = z.infer<typeof ticketSummaryConfigSchema>;

const commentSchema = z.object({
  author: z.string(),
  body: z.string(),
  createdAt: z.string(),
  url: z.string(),
});
const commentsSchema = z.object({
  total: z.number().int().nonnegative().nullable(),
  latest: commentSchema.nullable(),
});
export const ticketPullRequestSchema = z.object({
  url: z.string(),
  title: z.string(),
  state: z.enum(["open", "draft", "closed", "merged", "unknown"]),
  reviewDecision: z.enum([
    "approved",
    "changes_requested",
    "review_required",
    "unknown",
  ]),
  comments: commentsSchema,
  unresolvedThreads: z.number().int().nonnegative().nullable(),
  available: z.boolean(),
});
export const ticketSummarySchema = z.object({
  updatedAt: z.string(),
  tickets: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      url: z.string(),
      status: z.string(),
      comments: commentsSchema,
      pullRequests: z.array(ticketPullRequestSchema),
      prLookup: z.enum(["complete", "partial", "unavailable"]),
    }),
  ),
  partial: z.boolean(),
  warnings: z.array(
    z.enum([
      "jira_partial",
      "github_unavailable",
      "github_partial",
      "limit_reached",
    ]),
  ),
});
export type TicketSummary = z.infer<typeof ticketSummarySchema>;
export type TicketPullRequest = z.infer<typeof ticketPullRequestSchema>;
export type TicketSummaryComment = z.infer<typeof commentSchema>;
