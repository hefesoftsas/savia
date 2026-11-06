import { expect, it } from "vitest";
import { isHubspotArchive } from "../crm-provider";

it("uses archive wording only for HubSpot CRM collections", () => {
  expect(isHubspotArchive("hubspot", "crm")).toBe(true);
  expect(isHubspotArchive("salesforce", "crm")).toBe(false);
  expect(isHubspotArchive("zoho", "crm")).toBe(false);
  expect(isHubspotArchive("pipedrive", "crm")).toBe(false);
  expect(isHubspotArchive("hubspot", "postgres")).toBe(false);
});

it("rejects prototype names as CRM providers", async () => {
  const { isStudioCrmProvider } = await import("../crm-provider");
  for (const provider of ["constructor", "toString", "__proto__"])
    expect(isStudioCrmProvider(provider)).toBe(false);
});
