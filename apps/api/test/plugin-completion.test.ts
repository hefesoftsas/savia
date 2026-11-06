import { describe, expect, it, vi } from "vitest";
import { APICallError } from "ai";
import {
  createPluginCompletionService,
  PluginCompletionError,
} from "../src/assistant/plugin-completion";

function configuration() {
  return {
    assertTenantAdministrator: vi.fn(async () => undefined),
    effectiveConfigurationForTenant: vi.fn(async () => ({
      apiKey: "server-only-key",
      model: "selected/model",
    })),
    effectiveConfigurationForPlatformTenant: vi.fn(async () => ({
      apiKey: "server-only-key",
      model: "selected/model",
    })),
  };
}

describe("plugin completion service", () => {
  it("returns the sanitized provider completion", async () => {
    const generateText = vi.fn(async () => ({ text: "  setValue(1);" }));
    const service = createPluginCompletionService(configuration() as never, {
      generateText: generateText as never,
    });

    await expect(
      service.complete({
        principalId: "author-1",
        tenantId: 4,
        prefix:
          "function Counter() { const [v, setValue] = React.useState(0); ",
        suffix: " }",
      }),
    ).resolves.toEqual({ completion: "setValue(1);" });
    expect(generateText.mock.calls[0]?.[0].maxOutputTokens).toBe(256);
    expect(generateText.mock.calls[0]?.[0].maxRetries).toBe(0);
    expect(generateText.mock.calls[0]?.[0].system).toContain("no import");
  });

  it("strips import lines forbidden by the plugin source policy", async () => {
    const generateText = vi.fn(async () => ({
      text: 'import { x } from "y";\nsetValue(x);',
    }));
    const service = createPluginCompletionService(configuration() as never, {
      generateText: generateText as never,
    });

    await expect(
      service.complete({
        principalId: "author-1",
        tenantId: 4,
        prefix: "const x = 1; ",
        suffix: "",
      }),
    ).resolves.toEqual({ completion: "setValue(x);" });
  });

  it("does not call the provider without a configured key", async () => {
    const generateText = vi.fn();
    const service = createPluginCompletionService(
      {
        assertTenantAdministrator: vi.fn(async () => undefined),
        effectiveConfigurationForTenant: vi.fn(async () => ({
          model: "selected/model",
        })),
      } as never,
      { generateText: generateText as never },
    );

    await expect(
      service.complete({
        principalId: "author-1",
        tenantId: 4,
        prefix: "const x = ",
        suffix: "",
      }),
    ).rejects.toMatchObject({
      code: "PLUGIN_COMPLETION_NOT_CONFIGURED",
    });
    expect(generateText).not.toHaveBeenCalled();
  });

  it("maps provider timeouts without leaking details", async () => {
    const service = createPluginCompletionService(configuration() as never, {
      generateText: vi.fn(async () => {
        throw new APICallError({
          message: "private-provider-response",
          url: "https://openrouter.ai/api/v1/chat/completions",
          requestBodyValues: {},
          responseBody: "private-provider-response",
          statusCode: 504,
        });
      }) as never,
    });

    const error = await service
      .complete({
        principalId: "author-1",
        tenantId: 4,
        prefix: "const x = ",
        suffix: "",
      })
      .catch((reason: unknown) => reason as Error);
    expect(error).toMatchObject({ code: "PLUGIN_COMPLETION_TIMEOUT" });
    expect(error.message).not.toContain("private-provider-response");
  });

  it("rejects oversized contexts", async () => {
    const generateText = vi.fn();
    const service = createPluginCompletionService(configuration() as never, {
      generateText: generateText as never,
    });

    await expect(
      service.complete({
        principalId: "author-1",
        tenantId: 4,
        prefix: "x".repeat(8001),
        suffix: "",
      }),
    ).rejects.toBeInstanceOf(PluginCompletionError);
    expect(generateText).not.toHaveBeenCalled();
  });
});
