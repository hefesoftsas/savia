import { expect, it } from "vitest";
import { encryptSecret, decryptSecret } from "../src/integrations";
const key = "migration-test-key-long-enough-for-aes";
it("reads migrated credentials only under their canonical context", async () => {
  const value = await encryptSecret(
    "preserved-secret",
    key,
    "domain:old:geocoding",
  );
  const migrated = JSON.stringify({
    version: 2,
    context: "tenant:12:geocoding",
    aad: "domain:old:geocoding",
    value,
  });
  expect(await decryptSecret(migrated, key, "tenant:12:geocoding")).toBe(
    "preserved-secret",
  );
  await expect(
    decryptSecret(migrated, key, "tenant:13:geocoding"),
  ).rejects.toThrow();
});
it("keeps fresh credentials bound directly to the tenant context", async () => {
  const value = await encryptSecret("fresh-secret", key, "tenant:12:geocoding");
  expect(await decryptSecret(value, key, "tenant:12:geocoding")).toBe(
    "fresh-secret",
  );
  await expect(
    decryptSecret(value, key, "tenant:13:geocoding"),
  ).rejects.toThrow();
});
