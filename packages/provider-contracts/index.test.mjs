import assert from "node:assert/strict";
import test from "node:test";
import {
  activeAutoLightQuoteOperationIds,
  isPublicProviderOperation,
  providerCredentialOperationIds,
  publicProviderOperationIds,
  vehicleLookupOperationIds,
} from "./index.js";

test("exposes Scalar-verified provider operations", () => {
  assert.deepEqual(publicProviderOperationIds, [
    "sura-vehicle-by-plate",
    "sbs-product-8-quote",
    "sbs-product-10-quote",
    "sbs-product-11-quote",
  ]);
  assert.deepEqual(vehicleLookupOperationIds, ["sura-vehicle-by-plate"]);
  assert.deepEqual(providerCredentialOperationIds, [
    "sura-vehicle-by-plate",
    "sbs-product-8-quote",
    "sbs-product-10-quote",
    "sbs-product-11-quote",
  ]);
  assert.deepEqual(activeAutoLightQuoteOperationIds, [
    "sbs-product-8-quote",
    "sbs-product-10-quote",
    "sbs-product-11-quote",
  ]);
  assert.equal(isPublicProviderOperation("sura-vehicle-by-plate"), true);
  assert.equal(isPublicProviderOperation("sbs-product-8-quote"), true);
  assert.equal(isPublicProviderOperation("allianz-autos-quote"), false);
});
