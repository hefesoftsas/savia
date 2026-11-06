// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RecordOriginLinks } from "../record-origin-links";
afterEach(cleanup);
const url = "https://app.hubspot.com/contacts/51969008/record/0-1/247951049777";
it("opens the persisted origin independently of table row navigation", () => {
  const openRow = vi.fn();
  render(
    <div onClick={openRow}>
      <RecordOriginLinks
        record={{
          _crmLinks: [
            { provider: "hubspot", label: "Contacto en HubSpot", url },
          ],
        }}
      />
    </div>,
  );
  const link = screen.getByRole("link", { name: "Contacto en HubSpot" });
  expect(link.getAttribute("href")).toBe(url);
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
  expect(link.textContent).toContain("Contacto en HubSpot");
  expect(link.getAttribute("title")).toBe("Contacto en HubSpot");
  expect(link.querySelector("span")?.className).toContain("truncate");
  expect(link.querySelector("svg")).not.toBeNull();
  fireEvent.click(link);
  expect(openRow).not.toHaveBeenCalled();
});
it("hides missing mappings and rejects unsafe or unrecognized destinations", () => {
  render(
    <RecordOriginLinks
      record={{
        _crmLinks: [
          { provider: "hubspot", url: "javascript:alert(1)" },
          {
            provider: "hubspot",
            url: "https://app.hubspot.com.evil.test/contacts/1/record/0-1/2",
          },
          {
            provider: "hubspot",
            url: "https://user:password@app.hubspot.com/contacts/1/record/0-1/2",
          },
          { provider: "hubspot", url: "https://app.hubspot.com/redirect" },
        ],
      }}
    />,
  );
  expect(screen.queryByRole("link")).toBeNull();
});
it("renders deal origin links for the standard HubSpot object catalog", () => {
  const dealUrl = "https://app.hubspot.com/contacts/51969008/record/0-3/123";
  render(
    <RecordOriginLinks
      record={{
        _crmLinks: [
          { provider: "hubspot", label: "Negocio en HubSpot", url: dealUrl },
        ],
      }}
    />,
  );
  expect(
    screen
      .getByRole("link", { name: "Negocio en HubSpot" })
      .getAttribute("href"),
  ).toBe(dealUrl);
});

it("opens only validated Salesforce, Zoho, and Pipedrive record URLs with provider labels", () => {
  render(
    <RecordOriginLinks
      record={{
        _crmLinks: [
          {
            provider: "salesforce",
            label: "Contact in Salesforce",
            url: "https://acme.lightning.force.com/lightning/r/Contact/003000000000001AAA/view",
          },
          {
            provider: "zoho",
            label: "Contact in Zoho CRM",
            url: "https://crm.zoho.com/crm/org123/tab/Contacts/5725767000001234567",
          },
          {
            provider: "pipedrive",
            label: "Person in Pipedrive",
            url: "https://acme.pipedrive.com/person/123",
          },
          {
            provider: "salesforce",
            label: "Untrusted Salesforce link",
            url: "https://acme.lightning.force.com.evil.test/lightning/r/Contact/003000000000001AAA/view",
          },
          {
            provider: "zoho",
            label: "Untrusted Zoho link",
            url: "https://evilzoho.com/crm/org123/tab/Contacts/5725767000001234567",
          },
          {
            provider: "pipedrive",
            label: "Untrusted Pipedrive link",
            url: "https://pipedrive.com.evil.test/person/123",
          },
        ],
      }}
    />,
  );
  expect(
    screen.getByRole("link", { name: "Contact in Salesforce" }),
  ).toHaveAttribute(
    "href",
    "https://acme.lightning.force.com/lightning/r/Contact/003000000000001AAA/view",
  );
  expect(
    screen.getByRole("link", { name: "Contact in Zoho CRM" }),
  ).toHaveAttribute(
    "href",
    "https://crm.zoho.com/crm/org123/tab/Contacts/5725767000001234567",
  );
  expect(
    screen.getByRole("link", { name: "Person in Pipedrive" }),
  ).toHaveAttribute("href", "https://acme.pipedrive.com/person/123");
  expect(screen.queryByRole("link", { name: /Untrusted/ })).toBeNull();
});
