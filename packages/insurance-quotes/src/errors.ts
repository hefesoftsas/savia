export class ProviderConfigurationInvalidError extends Error {
  readonly code = "PROVIDER_CONFIGURATION_INVALID" as const;

  constructor() {
    super("La configuración del proveedor no es válida.");
  }
}

export class ExternalProviderUpstreamError extends Error {
  readonly code = "EXTERNAL_PROVIDER_UPSTREAM_ERROR" as const;

  constructor(readonly reason: "connection" | "response" = "connection") {
    super("No fue posible comunicarse con el proveedor externo.");
  }
}
