import { describe, expect, it, vi } from "vitest";
import {
  prepareProviderRequest,
  runtimeCredentialFieldsForOperation,
} from "../src/provider-request-preparation";

describe("provider request preparation", () => {
  it("does not add a provider-specific credential exchange for the verified Sura lookup", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const context = {
      credentials: { sura_api_key: "test-key" },
      fetcher,
      url: new URL("https://provider.test/vehicle/TESTCAR"),
      headers: new Headers({ "x-apikey": "test-key" }),
    };

    await prepareProviderRequest("sura-vehicle-by-plate", context);

    expect(
      runtimeCredentialFieldsForOperation("sura-vehicle-by-plate"),
    ).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(context.headers.get("x-apikey")).toBe("test-key");
  });
});
