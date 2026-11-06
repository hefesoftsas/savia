import { expect, it } from "vitest";
import { crmRecordOrigin } from "../src/external-crm/workspace-origins";
it("builds CRM record links from trusted native account routing", () => {
  expect(
    crmRecordOrigin(
      "salesforce",
      { instanceUrl: "https://example.my.salesforce.com" },
      "org",
      "contacts",
      "003000000000001AAA",
    )?.url,
  ).toBe(
    "https://example.lightning.force.com/lightning/r/Contact/003000000000001AAA/view",
  );
  expect(
    crmRecordOrigin("zoho", { extension: "eu" }, "123", "companies", "456")
      ?.url,
  ).toBe("https://crm.zoho.eu/crm/org123/tab/Accounts/456");
  expect(
    crmRecordOrigin(
      "pipedrive",
      { apiDomain: "https://example.pipedrive.com" },
      "123",
      "deals",
      "456",
    )?.url,
  ).toBe("https://example.pipedrive.com/deal/456");
});
it("omits unsupported or unsafe hosts, paths, and record identifiers", () => {
  for (const apiDomain of [
    "https://evil.test",
    "http://example.pipedrive.com",
    "https://example.pipedrive.com@evil.test",
    "https://example.pipedrive.com/path",
    "https://api.pipedrive.com",
  ])
    expect(
      crmRecordOrigin("pipedrive", { apiDomain }, "123", "contacts", "456"),
    ).toBeUndefined();
  expect(
    crmRecordOrigin(
      "zoho",
      { extension: "evil.test" },
      "123",
      "contacts",
      "456",
    ),
  ).toBeUndefined();
  expect(
    crmRecordOrigin(
      "salesforce",
      { instanceUrl: "https://example.my.salesforce.com" },
      "123",
      "contacts",
      "../etc",
    ),
  ).toBeUndefined();
});
