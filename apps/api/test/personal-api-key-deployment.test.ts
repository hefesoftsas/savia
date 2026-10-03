import { expect, it } from "vitest";
import { publicAuthUrls } from "../src/public-origin";
it("binds personal keys to configured origins, never an arbitrary request hostname", () => {
  expect(
    publicAuthUrls("https://attacker.example").personalApiKeyDeploymentId,
  ).toBeNull();
  expect(
    publicAuthUrls("https://tenant.preview.example", "https://preview.example")
      .personalApiKeyDeploymentId,
  ).toBe("https://preview.example");
  expect(
    publicAuthUrls("http://127.0.0.1:8787").personalApiKeyDeploymentId,
  ).toBe("http://127.0.0.1:8787");
});
