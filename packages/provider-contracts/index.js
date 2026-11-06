export const autoLightQuoteOperationIds = [
  "allianz-autos-quote",
  "bolivar-legacy-quote",
  "equidad-v2-quote-soap",
  "hdi-autos-quote-soap",
  "liberty-autos-quote",
  "mapfre-autos-quote",
  "sbs-autos-create-session",
  "sbs-product-8-quote",
  "zurich-expertia-create-quote-movlight",
];

export const vehicleLookupOperationIds = ["sura-vehicle-by-plate"];

export const activeAutoLightQuoteOperationIds = [
  "sbs-product-8-quote",
  "sbs-product-10-quote",
  "sbs-product-11-quote",
];

export const publicProviderOperationIds = [
  "sura-vehicle-by-plate",
  "sbs-product-8-quote",
  "sbs-product-10-quote",
  "sbs-product-11-quote",
];

export const providerCredentialOperationIds = [
  "sura-vehicle-by-plate",
  "sbs-product-8-quote",
  "sbs-product-10-quote",
  "sbs-product-11-quote",
];

export function isPublicProviderOperation(operationId) {
  return publicProviderOperationIds.includes(operationId);
}

export function isActiveAutoLightQuoteOperation(operationId) {
  return activeAutoLightQuoteOperationIds.includes(operationId);
}
