import type { FastMCP } from "@prefecthq/fastmcp-ts/server";
import { runtimeReleaseCatalog } from "@savia/release-catalog/runtime";
import type { ZodType } from "zod";
import type { SaviaApiClient } from "../savia-api";

export type ExtensionReadOnlyToolRegistrar = (
  config: {
    name: `savia_extension_${string}`;
    description: string;
    input: ZodType;
  },
  handler: (args: any) => unknown,
) => void;

export type TrustedAssistantExtension = {
  id: string;
  register(input: {
    registerReadOnlyTool: ExtensionReadOnlyToolRegistrar;
    clientForRequest: () => SaviaApiClient;
  }): void;
};

export function registerTrustedAssistantExtensions(
  server: FastMCP,
  clientForRequest: () => SaviaApiClient,
): void {
  const registerReadOnlyTool: ExtensionReadOnlyToolRegistrar = (
    config,
    handler,
  ) => {
    if (!config.name.startsWith("savia_extension_")) {
      throw new Error("Extension tool names must start with savia_extension_");
    }
    server.tool(
      {
        ...config,
        annotations: { readOnlyHint: true },
      },
      handler,
    );
  };
  for (const extension of runtimeReleaseCatalog.assistantExtensions) {
    extension.register({ registerReadOnlyTool, clientForRequest });
  }
}
