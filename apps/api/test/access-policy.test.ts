import { describe, expect, it } from "vitest";
import {
  authorizedAgencyIds,
  canExecuteCommand,
  canManageIdentity,
  canReadGlobal,
  hasAgencyCapability,
  isRegisteredAgencyRole,
} from "../src/auth/access-policy";
import {
  agencyAdministratorAuthenticator,
  agencyMemberAuthenticator,
  agencyOperatorAuthenticator,
  platformAdministratorAuthenticator,
} from "./auth-fixtures";

describe("access policy", () => {
  it("grants every initial capability only to a platform administrator", async () => {
    const actor = await platformAdministratorAuthenticator().authenticate(
      new Request("https://savia.test/v1/domains"),
      {} as D1Database,
    );

    expect(canReadGlobal(actor)).toBe(true);
    expect(canExecuteCommand(actor)).toBe(true);
    expect(canManageIdentity(actor)).toBe(true);
  });

  it("limits a viewer to active agency memberships and no privileged actions", async () => {
    const actor = await agencyMemberAuthenticator().authenticate(
      new Request("https://savia.test/v1/domains"),
      {} as D1Database,
    );

    expect(canReadGlobal(actor)).toBe(true);
    expect(authorizedAgencyIds(actor)).toEqual([101]);
    expect(canExecuteCommand(actor)).toBe(false);
    expect(canManageIdentity(actor)).toBe(false);
  });

  it("recognizes only initial membership roles", () => {
    expect(isRegisteredAgencyRole("agency_admin")).toBe(true);
    expect(isRegisteredAgencyRole("operator")).toBe(true);
    expect(isRegisteredAgencyRole("viewer")).toBe(true);
    expect(isRegisteredAgencyRole("unreviewed_role")).toBe(false);
  });

  it("reserves CRM and provider credential management for agency administrators", async () => {
    const crmManagement = "crm:manage" as never;
    const providerManagement = "providers:manage" as never;
    const [administrator, operator, member, platformAdministrator] =
      await Promise.all([
        agencyAdministratorAuthenticator().authenticate(
          new Request("https://savia.test/v1/crm/connections"),
          {} as D1Database,
        ),
        agencyOperatorAuthenticator().authenticate(
          new Request("https://savia.test/v1/crm/connections"),
          {} as D1Database,
        ),
        agencyMemberAuthenticator().authenticate(
          new Request("https://savia.test/v1/crm/connections"),
          {} as D1Database,
        ),
        platformAdministratorAuthenticator().authenticate(
          new Request("https://savia.test/v1/crm/connections"),
          {} as D1Database,
        ),
      ]);

    expect(hasAgencyCapability(administrator, 101, crmManagement)).toBe(true);
    expect(hasAgencyCapability(operator, 101, crmManagement)).toBe(false);
    expect(hasAgencyCapability(member, 101, crmManagement)).toBe(false);
    expect(hasAgencyCapability(platformAdministrator, 101, crmManagement)).toBe(
      false,
    );
    expect(hasAgencyCapability(administrator, 101, providerManagement)).toBe(
      true,
    );
    expect(hasAgencyCapability(operator, 101, providerManagement)).toBe(false);
    expect(hasAgencyCapability(member, 101, providerManagement)).toBe(false);
    expect(
      hasAgencyCapability(platformAdministrator, 101, providerManagement),
    ).toBe(false);
  });
});
