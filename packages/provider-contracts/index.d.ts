export declare const autoLightQuoteOperationIds: readonly [
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

export declare const vehicleLookupOperationIds: readonly [
  "sura-vehicle-by-plate",
];

export declare const activeAutoLightQuoteOperationIds: readonly [
  "sbs-product-8-quote",
  "sbs-product-10-quote",
  "sbs-product-11-quote",
];

export declare const publicProviderOperationIds: readonly [
  "sura-vehicle-by-plate",
  "sbs-product-8-quote",
  "sbs-product-10-quote",
  "sbs-product-11-quote",
];

export declare const providerCredentialOperationIds: readonly [
  "sura-vehicle-by-plate",
  "sbs-product-8-quote",
  "sbs-product-10-quote",
  "sbs-product-11-quote",
];
export declare function isPublicProviderOperation(operationId: string): boolean;
export declare function isActiveAutoLightQuoteOperation(
  operationId: string,
): boolean;
