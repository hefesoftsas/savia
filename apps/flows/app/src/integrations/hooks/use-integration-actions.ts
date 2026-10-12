import type { IntegrationProvider } from "@savia/flows-types";
import { toast } from "sonner";

interface IntegrationActionsResult {
  isProcessing: boolean;
  connectOAuth: (provider: IntegrationProvider) => void;
  createManual: (
    provider: IntegrationProvider,
    name: string,
    apiKey: string,
  ) => Promise<void>;
  deleteIntegration: (integrationId: string) => Promise<void>;
  updateIntegration: (
    integrationId: string,
    updates: {
      name?: string;
      token?: string;
      refreshToken?: string;
      tokenExpiresAt?: Date;
      metadata?: string;
    },
  ) => Promise<void>;
}

/** Local-only runtime keeps provider configuration read-only and prevents OAuth or credential writes. */
export function useIntegrationActions(): IntegrationActionsResult {
  const unavailable = () =>
    toast.info(
      "Provider connections and credential changes are unavailable in local Savia Flows.",
    );
  return {
    isProcessing: false,
    connectOAuth: () => unavailable(),
    createManual: async () => {
      unavailable();
    },
    deleteIntegration: async () => {
      unavailable();
    },
    updateIntegration: async () => {
      unavailable();
    },
  };
}
