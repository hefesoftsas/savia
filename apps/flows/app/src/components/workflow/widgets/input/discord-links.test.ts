import { describe, expect, it } from "vitest";
import { discordApplicationLinks } from "./discord-links";

describe("Discord application links", () => {
  it("keeps application IDs in a single path segment", () => {
    const applicationId = '123/../other?field="<img src=x>"#fragment';
    const links = discordApplicationLinks(applicationId);
    const information = new URL(links.generalInfoUrl);
    const settings = new URL(links.botSettingsUrl);
    expect(information.origin).toBe("https://discord.com");
    expect(information.pathname).toBe(
      `/developers/applications/${encodeURIComponent(applicationId)}/information`,
    );
    expect(settings.pathname).toBe(
      `/developers/applications/${encodeURIComponent(applicationId)}/bot`,
    );
    expect(information.search).toBe("");
    expect(information.hash).toBe("");
  });

  it("cannot override OAuth scope or permissions through an application ID", () => {
    const applicationId =
      '123&scope=admin&permissions=8#"<svg onload=alert(1)>';
    const invitation = new URL(
      discordApplicationLinks(applicationId).inviteUrl!,
    );
    expect(invitation.origin).toBe("https://discord.com");
    expect(invitation.searchParams.getAll("client_id")).toEqual([
      applicationId,
    ]);
    expect(invitation.searchParams.getAll("scope")).toEqual([
      "bot applications.commands",
    ]);
    expect(invitation.searchParams.getAll("permissions")).toEqual(["2048"]);
    expect(invitation.hash).toBe("");
  });

  it("retains valid IDs and empty-state portal destinations", () => {
    const links = discordApplicationLinks("123456789012345678");
    expect(links.generalInfoUrl).toBe(
      "https://discord.com/developers/applications/123456789012345678/information",
    );
    const empty = discordApplicationLinks("");
    expect(empty.generalInfoUrl).toBe(
      "https://discord.com/developers/applications",
    );
    expect(empty.botSettingsUrl).toBe(empty.generalInfoUrl);
    expect(empty.inviteUrl).toBeNull();
  });
});
