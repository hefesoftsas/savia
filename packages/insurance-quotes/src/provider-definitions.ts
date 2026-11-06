import {
  providerOperationMetadata,
  type ProviderCredentialVariable,
  type ProviderOperationMetadata,
} from "./provider-metadata.generated";
import { providerCredentialOperationIds } from "@savia/provider-contracts";
import { ProviderConfigurationInvalidError } from "./errors";
import { runtimeCredentialFieldsForOperation } from "./provider-request-preparation";

export type ProviderCredentialField = ProviderCredentialVariable & {
  label: string;
  required: boolean;
};

export type ProviderDefinition = {
  id: string;
  label: string;
  schemaVersion: number;
  fields: ProviderCredentialField[];
  operationIds: string[];
  safeTestOperationId?: string;
};

function fieldLabel(name: string): string {
  return name
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function definitionsForOperations(
  operationsMetadata: ProviderOperationMetadata[],
): ProviderDefinition[] {
  const grouped = new Map<string, ProviderOperationMetadata[]>();
  for (const operation of operationsMetadata) {
    const operations = grouped.get(operation.providerId) ?? [];
    operations.push(operation);
    grouped.set(operation.providerId, operations);
  }

  return [...grouped]
    .map(([id, operations]) => {
      const fields = new Map<string, ProviderCredentialField>();
      for (const operation of operations) {
        for (const credential of operation.credentialVariables) {
          fields.set(credential.name, {
            ...credential,
            label: fieldLabel(credential.name),
            required: true,
          });
        }
        for (const credential of runtimeCredentialFieldsForOperation(
          operation.id,
        )) {
          fields.set(credential.name, {
            ...credential,
            label: fieldLabel(credential.name),
            required: credential.required !== false,
          });
        }
      }
      return {
        id,
        label: operations[0].provider,
        schemaVersion: [...fields.values()].some(
          (field) =>
            !operations.some((operation) =>
              operation.credentialVariables.some(
                (credential) => credential.name === field.name,
              ),
            ),
        )
          ? 2
          : 1,
        fields: [...fields.values()].sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
        operationIds: operations.map((operation) => operation.id).sort(),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export const providerDefinitions = definitionsForOperations(
  providerOperationMetadata,
);

const autoLightCredentialOperationIds = new Set<string>(
  providerCredentialOperationIds,
);

export const autoLightCredentialProviderDefinitions = definitionsForOperations(
  providerOperationMetadata.filter((operation) =>
    autoLightCredentialOperationIds.has(operation.id),
  ),
);

const definitionsById = new Map(
  providerDefinitions.map((definition) => [definition.id, definition]),
);
const autoLightDefinitionsById = new Map(
  autoLightCredentialProviderDefinitions.map((definition) => [
    definition.id,
    definition,
  ]),
);
const operationsById = new Map(
  providerOperationMetadata.map((operation) => [operation.id, operation]),
);

export function requireProviderDefinition(
  provider: string,
): ProviderDefinition {
  const definition = definitionsById.get(provider);
  if (!definition) throw new ProviderConfigurationInvalidError();
  return definition;
}

export function requireAutoLightCredentialProviderDefinition(
  provider: string,
): ProviderDefinition {
  const definition = autoLightDefinitionsById.get(provider);
  if (!definition) throw new ProviderConfigurationInvalidError();
  return definition;
}

export function requireProviderOperation(
  operationId: string,
): ProviderOperationMetadata {
  const operation = operationsById.get(operationId);
  if (!operation) throw new ProviderConfigurationInvalidError();
  return operation;
}

export function validatedProviderCredentials(
  definition: ProviderDefinition,
  values: unknown,
): Record<string, string> {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new ProviderConfigurationInvalidError();
  }

  const candidate = values as Record<string, unknown>;
  const declared = new Map(
    definition.fields.map((field) => [field.name, field]),
  );
  if (Object.keys(candidate).some((name) => !declared.has(name))) {
    throw new ProviderConfigurationInvalidError();
  }

  return Object.fromEntries(
    definition.fields.flatMap((field) => {
      const value = candidate[field.name];
      if (value === undefined && !field.required) return [];
      if (typeof value !== "string" || !value.trim()) {
        throw new ProviderConfigurationInvalidError();
      }
      const normalized = value.trim();
      if (field.kind === "url") {
        try {
          const url = new URL(normalized);
          if (url.protocol !== "https:" && url.protocol !== "http:") {
            throw new Error("Unsupported URL protocol");
          }
        } catch {
          throw new ProviderConfigurationInvalidError();
        }
      }
      return [[field.name, normalized]];
    }),
  );
}
