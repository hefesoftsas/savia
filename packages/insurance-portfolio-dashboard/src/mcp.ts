import { z, type ZodType } from "zod";
import { insurancePortfolioExtensionManifest } from "./manifest";

type ExtensionStatus = {
  builtIn: boolean;
  installed: { enabled: boolean } | null;
};

type PortfolioSummaryClient = {
  extensionStatus(id: string): Promise<ExtensionStatus>;
  getExtensionSummary(id: string): Promise<unknown>;
};

type ReadOnlyToolRegistrar = (
  config: {
    name: `savia_extension_${string}`;
    description: string;
    input: ZodType;
  },
  handler: (args: unknown) => unknown,
) => void;

export type InsurancePortfolioAssistantExtensionInput = {
  registerReadOnlyTool: ReadOnlyToolRegistrar;
  clientForRequest: () => PortfolioSummaryClient;
};

export function registerInsurancePortfolioMcpTool(
  input: InsurancePortfolioAssistantExtensionInput,
) {
  input.registerReadOnlyTool(
    {
      name: "savia_extension_insurance_portfolio",
      description:
        "Read the authorized tenant's portfolio of policies, active coverage, upcoming expirations, and total premium. This tool never changes policy data.",
      input: z.object({}),
    },
    async () => {
      const client = input.clientForRequest();
      const extension = await client.extensionStatus(
        insurancePortfolioExtensionManifest.id,
      );
      if (!extension.builtIn && !extension.installed?.enabled) {
        throw new Error(
          "The insurance.portfolio-dashboard extension is not active for this tenant",
        );
      }
      return {
        extension: insurancePortfolioExtensionManifest.id,
        summary: await client.getExtensionSummary(
          insurancePortfolioExtensionManifest.id,
        ),
      };
    },
  );
}

export const insurancePortfolioAssistantExtension = {
  id: insurancePortfolioExtensionManifest.id,
  register(input: InsurancePortfolioAssistantExtensionInput) {
    registerInsurancePortfolioMcpTool(input);
  },
};
