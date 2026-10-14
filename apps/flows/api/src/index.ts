import "./outbound-policy-install";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import auth from "./auth";
import { saviaMaintenanceRoutes } from "./routes/savia-maintenance";
import { executionPolicyRoutes } from "./services/execution-policy-routes";
import {
  policyStatus,
  syncExecutionPolicyPause,
} from "./services/execution-policy";
import { ApiContext, type Bindings } from "./context";
import { DatabaseDO } from "./durable-objects/database-do";
import { handleIncomingEmail } from "./email";
import { corsMiddleware } from "./middleware/cors";
import { createRateLimitMiddleware } from "./middleware/rate-limit";
import { handleQueueMessages } from "./queue";
import { queueRetryDelaySeconds } from "./queue-backoff";
import adminRoutes from "./routes/admin";
import apiKeyRoutes from "./routes/api-keys";
import billingRoutes from "./routes/billing";
import botRoutes from "./routes/bots";
import cloudflareAiRoutes from "./routes/cloudflare-ai";
import cloudflareGatewayRoutes from "./routes/cloudflare-gateway";
import dashboardRoutes from "./routes/dashboard";
import databaseRoutes from "./routes/databases";
import datasetRoutes from "./routes/datasets";
import discordWebhook from "./routes/discord-webhook";
import emailRoutes from "./routes/emails";
import exampleRoutes from "./routes/examples";
import executionRoutes from "./routes/executions";
import feedbackRoutes from "./routes/feedback";
import feedbackFormRoutes from "./routes/feedback-forms";
import formTriggerRoutes from "./routes/form-triggers";
import formRoutes from "./routes/forms";
import generateRoutes from "./routes/generate";
import health from "./routes/health";
import httpTriggerRoutes from "./routes/http-triggers";
import integrationRoutes from "./routes/integrations";
import invitationRoutes from "./routes/invitations";
import llmsRoutes from "./routes/llms";
import oauthRoutes from "./routes/oauth";
import objectRoutes from "./routes/objects";
import organizationRoutes from "./routes/organizations";
import playgroundRoutes from "./routes/playground";
import profileRoutes from "./routes/profile";
import queuePublishRoutes from "./routes/queue-publish";
import queueRoutes from "./routes/queues";
import replicateRoutes from "./routes/replicate";
import robotsRoutes from "./routes/robots";
import schemaRoutes from "./routes/schemas";
import secretRoutes from "./routes/secrets";
import slackWebhook from "./routes/slack-webhook";
import stripeWebhooks from "./routes/stripe-webhooks";
import telegramWebhook from "./routes/telegram-webhook";
import templateRoutes from "./routes/templates";
import typeRoutes from "./routes/types";
import usageRoutes from "./routes/usage";
import whatsappWebhook from "./routes/whatsapp-webhook";
import workflowRoutes from "./routes/workflows";
import { saviaCollectionEventRoutes } from "./routes/savia-collection-events";
import { saviaCollectionSubscriptionRoutes } from "./routes/savia-collection-subscriptions";
import { saviaHttpAuthorityRoutes } from "./routes/savia-http-authority";
import { saviaCollectionsRoutes } from "./routes/savia-collections";
import { saviaNativeFlowsRoutes } from "./routes/savia-native-flows";
import wsRoutes from "./routes/ws";
import { registerLocalScheduledRoute } from "./local-scheduled-route";
import { saviaBridgeMiddleware } from "./savia-bridge";
import { handleScheduledEvent } from "./scheduled";

// Export WorkflowRuntimeEntrypoint as "Runtime" for wrangler config compatibility
export { WorkflowRuntimeEntrypoint as Runtime } from "./runtime/workflow-runtime-entrypoint";

// Initialize Hono app with types
const app = new Hono<ApiContext>();
// Bound ingress before JSON parsing; multipart retains one MiB of envelope space.
app.use("*", bodyLimit({ maxSize: 9 * 1024 * 1024 }));

// Only current Worker entrypoints synchronize the deployment's pause setting.
// Durable instances read this shared control without clearing it themselves.
app.use("*", async (c, next) => {
  await syncExecutionPolicyPause(c.env);
  return next();
});

// Signed host delivery is validated by this route itself and must bypass the
// browser-facing Savia bridge identity middleware below.
app.route("/internal/savia/execution-policy", executionPolicyRoutes);
app.route("/internal/savia/maintenance", saviaMaintenanceRoutes);
app.use("*", async (c, next) => {
  if (c.env.SAVIA_FLOWS_MAINTENANCE === "true" && c.req.path !== "/health")
    return c.json({ error: "Flows is in maintenance mode" }, 503);
  return next();
});

app.route("/internal/savia/collection-events", saviaCollectionEventRoutes);

// Global middleware
app.use("*", corsMiddleware);
app.use("*", saviaBridgeMiddleware);

// Apply rate limiting to all routes except health check
app.use("*", async (c, next) => {
  if (c.req.path === "/health") {
    return next();
  }

  // Use stricter rate limiting for auth routes
  if (c.req.path.startsWith("/auth/login") || c.req.path === "/auth/refresh") {
    const rateLimit = createRateLimitMiddleware(c.env.RATE_LIMIT_AUTH);
    return rateLimit(c, next);
  }

  // Use default rate limiting for other routes
  const rateLimit = createRateLimitMiddleware(c.env.RATE_LIMIT_DEFAULT);
  return rateLimit(c, next);
});

registerLocalScheduledRoute(app);

// Mount routes
app.route("/health", health);
app.route("/auth", auth);
app.route("/admin", adminRoutes);
app.route("/oauth", oauthRoutes);
app.route("/profile", profileRoutes);
app.route("/organizations", organizationRoutes);
app.route("/invitations", invitationRoutes);
app.route("/robots.txt", robotsRoutes);
app.route("/llms.txt", llmsRoutes);

// Stripe webhooks (no auth, verified by signature)
app.route("/stripe/webhooks", stripeWebhooks);

// Telegram webhook (no auth, called by Telegram)
app.route("/telegram", telegramWebhook);

// Discord webhook (no auth, verified by Ed25519 signature)
app.route("/discord", discordWebhook);

// WhatsApp webhook (no auth, verified by HMAC-SHA256 signature)
app.route("/whatsapp", whatsappWebhook);

// Slack webhook (no auth, verified by HMAC-SHA256 signature)
app.route("/slack", slackWebhook);

// Trigger execution (API key auth, org derived from resource record)
app.route("/http", httpTriggerRoutes);
app.route("/queues", queuePublishRoutes);

// Replicate schema proxy (JWT-authenticated, not org-scoped)
app.route("/replicate", replicateRoutes);

// Cloudflare Workers AI schema proxy (JWT-authenticated, not org-scoped)
app.route("/cloudflare-ai", cloudflareAiRoutes);
app.route("/cloudflare-gateway", cloudflareGatewayRoutes);

// Public routes
app.route("/forms", formRoutes);
app.route("/form-triggers", formTriggerRoutes);
app.route("/feedback-forms", feedbackFormRoutes);
app.route("/templates", templateRoutes);
app.route("/types", typeRoutes);

app.route("/:organizationId/api-keys", apiKeyRoutes);
app.route("/:organizationId/billing", billingRoutes);
app.route("/:organizationId/dashboard", dashboardRoutes);
app.route("/:organizationId/databases", databaseRoutes);
app.route("/:organizationId/datasets", datasetRoutes);
app.route("/:organizationId/bots", botRoutes);
app.route("/:organizationId/emails", emailRoutes);
app.route("/:organizationId/feedback", feedbackRoutes);
app.route("/:organizationId/executions", executionRoutes);
app.route("/:organizationId/integrations", integrationRoutes);
app.route("/:organizationId/queues", queueRoutes);
app.route("/:organizationId/schemas", schemaRoutes);
app.route("/:organizationId/secrets", secretRoutes);
app.route("/:organizationId/workflows", workflowRoutes);
app.route("/:organizationId/workflows", saviaCollectionSubscriptionRoutes);
app.route("/:organizationId/workflows", saviaHttpAuthorityRoutes);
app.route("/:organizationId/savia/collections", saviaCollectionsRoutes);
app.route("/:organizationId/savia/native", saviaNativeFlowsRoutes);
app.route("/:organizationId/workflows/:workflowId/examples", exampleRoutes);
app.route("/:organizationId/objects", objectRoutes);
app.route("/:organizationId/playground", playgroundRoutes);
app.route("/:organizationId/usage", usageRoutes);
app.route("/:organizationId/ws", wsRoutes);
app.route("/:organizationId/generate", generateRoutes);

// Export Durable Objects
export { WorkflowAgent } from "./durable-objects/workflow-agent";
export { DatabaseDO };
export { Sandbox } from "@cloudflare/sandbox";
export { FFmpegContainer } from "./containers/ffmpeg-container";
export { LanguageSandbox } from "./containers/language-sandbox";
export { AgentRunner } from "./durable-objects/agent-runner";
export { EmailAgentRunner } from "./durable-objects/email-agent-runner";
export { MailboxDO } from "./durable-objects/mailbox-do";

export default {
  async email(
    message: ForwardableEmailMessage,
    env: Bindings,
    ctx: ExecutionContext,
  ) {
    await syncExecutionPolicyPause(env);
    if (env.SAVIA_FLOWS_MAINTENANCE === "true") {
      message.setReject("Savia Flows is in maintenance mode");
      return;
    }
    return handleIncomingEmail(message, env, ctx);
  },
  async queue(batch: MessageBatch, env: Bindings, ctx: ExecutionContext) {
    await syncExecutionPolicyPause(env);
    if (!(await policyStatus(env)).executionsEnabled) {
      for (const message of batch.messages)
        message.retry({
          delaySeconds: queueRetryDelaySeconds(message.attempts),
        });
      return;
    }
    return handleQueueMessages(batch, env, ctx);
  },
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    await syncExecutionPolicyPause(env);
    return handleScheduledEvent(event, env, ctx);
  },
  fetch: app.fetch,
};
