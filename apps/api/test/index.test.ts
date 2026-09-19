import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  assistantRuntimeFromEnvironment,
  nangoConfigurationFromEnvironment,
} from "../src/index";

describe("assistant Worker runtime", () => {
  it("keeps the assistant available for D1 configuration before a deployment key exists", () => {
    const runtime = assistantRuntimeFromEnvironment({
      DB: env.DB,
      SAVIA_MCP_URL: "http://mcp:8789/mcp",
      SAVIA_MCP_SHARED_SECRET: "not-a-real-shared-secret",
    } as Env & {
      SAVIA_MCP_URL: string;
      SAVIA_MCP_SHARED_SECRET: string;
    });

    expect(runtime.configuration).toBeDefined();
    expect(runtime.service).toBeDefined();
  });

  it("keeps the Worker runtime constructible when its settings encryption key is invalid", () => {
    expect(() =>
      assistantRuntimeFromEnvironment({
        DB: env.DB,
        SAVIA_MCP_URL: "http://mcp:8789/mcp",
        SAVIA_MCP_SHARED_SECRET: "not-a-real-shared-secret",
        ASSISTANT_SETTINGS_ENCRYPTION_KEY: "not-base64",
      } as Env & {
        SAVIA_MCP_URL: string;
        SAVIA_MCP_SHARED_SECRET: string;
        ASSISTANT_SETTINGS_ENCRYPTION_KEY: string;
      }),
    ).not.toThrow();
  });
});

describe("personal Nango integration configuration", () => {
  it("keeps every personal provider integration id separate", () => {
    const configuration = nangoConfigurationFromEnvironment({
      NANGO_GOOGLE_DRIVE_INTEGRATION_ID: "drive-production",
      NANGO_GMAIL_INTEGRATION_ID: "gmail-production",
      NANGO_GOOGLE_CALENDAR_INTEGRATION_ID: "calendar-production",
      NANGO_OUTLOOK_INTEGRATION_ID: "outlook-production",
      NANGO_ONEDRIVE_PERSONAL_INTEGRATION_ID: "onedrive-personal-production",
      NANGO_ONEDRIVE_BUSINESS_INTEGRATION_ID: "onedrive-business-production",
    } as Record<string, string>);

    expect(configuration).toMatchObject({
      googleDriveIntegrationId: "drive-production",
      gmailIntegrationId: "gmail-production",
      googleCalendarIntegrationId: "calendar-production",
      outlookIntegrationId: "outlook-production",
      oneDrivePersonalIntegrationId: "onedrive-personal-production",
      oneDriveBusinessIntegrationId: "onedrive-business-production",
    });
  });
});
