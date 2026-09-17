import mergeWith from "lodash/mergeWith";
import type { TranslationMessages } from "ra-core";

function mergeCustomizer(
  objectValue: unknown,
  sourceValue: unknown,
): unknown | undefined {
  if (Array.isArray(objectValue)) {
    return sourceValue;
  }
  return undefined;
}

export function mergeMessages(
  ...sources: ReadonlyArray<TranslationMessages | Record<string, unknown>>
): TranslationMessages {
  return mergeWith({}, ...sources, mergeCustomizer) as TranslationMessages;
}
