import { describe, expect, it } from "vitest";
import { parseIssueLink } from "../src/issue-links";

describe("parseIssueLink", () => {
  it("parses canonical Jira Cloud browse links", () => {
    expect(parseIssueLink("https://acme.atlassian.net/browse/OPS-42")).toEqual({
      provider: "jira",
      identifier: "OPS-42",
      url: "https://acme.atlassian.net/browse/OPS-42",
      site: "acme.atlassian.net",
    });
  });

  it("parses Linear links with an optional issue slug", () => {
    expect(
      parseIssueLink("https://linear.app/acme/issue/ENG-7/fix-the-dashboard"),
    ).toEqual({
      provider: "linear",
      identifier: "ENG-7",
      url: "https://linear.app/acme/issue/ENG-7/fix-the-dashboard",
      workspace: "acme",
    });
  });

  it.each([
    "http://acme.atlassian.net/browse/OPS-42",
    "https://user@acme.atlassian.net/browse/OPS-42",
    "https://acme.atlassian.net.evil.test/browse/OPS-42",
    "https://acme.atlassian.net:8443/browse/OPS-42",
    "https://acme.atlassian.net/browse/OPS-42?next=https://evil.test",
    "https://acme.atlassian.net/browse/OPS-42?",
    "https://acme.atlassian.net/browse/not-an-issue",
    "https://linear.app.evil.test/acme/issue/ENG-7",
    "https://linear.app/acme/issue/ENG-7?redirect=https://evil.test",
    "https://linear.app/acme/issue/ENG-7#",
    "https://linear.app/acme/issue/ENG-7/slug/extra",
    "https://linear.app/acme/issue/not-an-issue",
  ])("rejects unsafe or malformed issue link %s", (value) => {
    expect(parseIssueLink(value)).toBeNull();
  });
});
