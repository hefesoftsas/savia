export type ProviderCredentialValues = Record<string, string>;

export type ProviderCredentialSummary = {
  provider: string;
  schemaVersion: number;
  lastValidationStatus: "valid" | "invalid" | null;
  lastValidationErrorCode: string | null;
  lastValidatedAt: string | null;
  updatedAt: string;
};

export type ProviderCredentialSummaryList = {
  providers: ProviderCredentialSummary[];
};

export class ProviderCredentialsUnavailableError extends Error {
  readonly code = "PROVIDER_CREDENTIALS_UNAVAILABLE" as const;

  constructor() {
    super("Provider credential encryption is unavailable");
  }
}

export class ProviderCredentialsNotConfiguredError extends Error {
  readonly code = "PROVIDER_CREDENTIALS_NOT_CONFIGURED" as const;

  constructor() {
    super("Provider credentials are not configured for this user");
  }
}

export class ProviderConfigurationInvalidError extends Error {
  readonly code = "PROVIDER_CONFIGURATION_INVALID" as const;

  constructor() {
    super("Provider credentials are invalid");
  }
}

export class ExternalProviderUpstreamError extends Error {
  readonly code = "EXTERNAL_PROVIDER_UPSTREAM_ERROR" as const;

  constructor(readonly reason: "connection" | "response" = "connection") {
    super("The external provider could not be reached");
  }
}
