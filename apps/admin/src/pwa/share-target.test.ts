import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  clearSharedLink,
  readSharedLink,
  receiveSharedLink,
  sharedLinkRouteAfterAuth,
  sharedLinkStorageAvailable,
  updateSharedLink,
} from "./share-target";

const manifest = JSON.parse(readFileSync("public/site.webmanifest", "utf8"));

describe("Android PWA share target", () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearSharedLink();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("declares a GET share target for title, text, and URL", () => {
    expect(manifest.share_target).toEqual({
      action: "/?share-target=1",
      method: "GET",
      enctype: "application/x-www-form-urlencoded",
      params: { title: "title", text: "text", url: "url" },
    });
  });

  it("saves a valid URL and removes it from the shared text note", () => {
    window.history.replaceState(
      {},
      "",
      "/?share-target=1&title=Example&text=Read%20this%20https%3A%2F%2Fexample.com%2Fa%3Fx%3D1%20later",
    );

    receiveSharedLink();

    expect(readSharedLink()).toMatchObject({
      title: "Example",
      url: "https://example.com/a?x=1",
      note: "Read this later",
    });
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#/save-link");
  });

  it.each([
    [
      "https://example.com/Java_(language)",
      "https://example.com/Java_(language)",
    ],
    [
      "Read https://example.com/Java_(language) later",
      "https://example.com/Java_(language)",
    ],
    ["Read (https://example.com/article).", "https://example.com/article"],
    ["https://example.com/search?q=wow!", "https://example.com/search?q=wow!"],
  ])("preserves URL punctuation in shared text %s", (text, expected) => {
    window.history.replaceState(
      {},
      "",
      `/?share-target=1&text=${encodeURIComponent(text)}`,
    );
    receiveSharedLink();
    expect(readSharedLink()?.url).toBe(expected);
  });

  it("prefers a valid URL parameter and rejects unsafe or credential-bearing URLs", () => {
    window.history.replaceState(
      {},
      "",
      "/?share-target=1&url=javascript%3Aalert(1)&text=Visit%20https%3A%2F%2Fsafe.example%2F",
    );
    receiveSharedLink();
    expect(readSharedLink()?.url).toBe("https://safe.example/");

    clearSharedLink();
    window.history.replaceState(
      {},
      "",
      "/?share-target=1&url=https%3A%2F%2Fuser%3Apass%40bad.example",
    );
    receiveSharedLink();
    expect(readSharedLink()).toBeNull();
  });

  it("clears an older draft when a new invalid share contains no link", () => {
    window.history.replaceState(
      {},
      "",
      "/?share-target=1&url=https%3A%2F%2Fexample.com",
    );
    receiveSharedLink();
    window.history.replaceState(
      {},
      "",
      "/?share-target=1&url=javascript%3Aalert(1)",
    );
    receiveSharedLink();

    expect(readSharedLink()).toBeNull();
  });

  it("persists manual URL edits while they are temporarily incomplete", () => {
    const draft = {
      captureId: "b441d534-5ee0-40be-a404-95e9c193fae3",
      title: "",
      url: "https://example.com",
      note: "",
      receivedAt: Date.now(),
    };
    updateSharedLink({ ...draft, url: "" });

    expect(readSharedLink()?.url).toBe("");
    expect(readSharedLink()?.captureId).toBe(draft.captureId);
  });

  it("round trips the selected folder and pending capture attempt", () => {
    const draft = {
      captureId: "b441d534-5ee0-40be-a404-95e9c193fae3",
      title: "Read later",
      url: "https://example.com/article",
      note: "Useful notes",
      receivedAt: Date.now(),
      parentId: "folder-123",
      attempt: {
        accountId: "account-123",
        input: {
          captureId: "b441d534-5ee0-40be-a404-95e9c193fae3",
          title: "Read later",
          url: "https://example.com/article",
          note: "Useful notes",
          parentId: "folder-123",
        },
      },
    };
    updateSharedLink(draft);
    clearSharedLink();
    sessionStorage.setItem("savia.shared-link.v1", JSON.stringify(draft));

    expect(readSharedLink()).toEqual(draft);
  });

  it.each([
    {
      accountId: "account-123",
      input: {
        captureId: "a441d534-5ee0-40be-a404-95e9c193fae3",
        title: "Read later",
        url: "https://example.com/article",
      },
    },
    {
      accountId: "account-123",
      input: {
        captureId: "b441d534-5ee0-40be-a404-95e9c193fae3",
        title: "Read later",
        url: "javascript:alert(1)",
      },
    },
    {
      accountId: "a".repeat(257),
      input: {
        captureId: "b441d534-5ee0-40be-a404-95e9c193fae3",
        title: "Read later",
        url: "https://example.com/article",
      },
    },
    {
      accountId: "account-123",
      input: {
        captureId: "b441d534-5ee0-40be-a404-95e9c193fae3",
        title: "Read later",
        url: "https://example.com/article",
        unrecognized: true,
      },
    },
  ])("discards malformed stored attempts", (attempt) => {
    const draft = {
      captureId: "b441d534-5ee0-40be-a404-95e9c193fae3",
      title: "Read later",
      url: "https://example.com/article",
      note: "",
      receivedAt: Date.now(),
      attempt,
    };
    sessionStorage.setItem("savia.shared-link.v1", JSON.stringify(draft));

    expect(readSharedLink()).toBeNull();
    expect(sessionStorage.getItem("savia.shared-link.v1")).toBeNull();
  });

  it("caps oversized titles and shared text at the field limits", () => {
    const params = new URLSearchParams({
      "share-target": "1",
      title: "t".repeat(250),
      text: `n`.repeat(10001),
      url: "https://example.com/",
    });
    window.history.replaceState({}, "", `/?${params}`);

    receiveSharedLink();

    expect(readSharedLink()?.title).toHaveLength(200);
    expect(readSharedLink()?.note).toHaveLength(10000);
  });

  it("rejects URLs over the input limit", () => {
    const longUrl = `https://example.com/${"a".repeat(8192)}`;
    const params = new URLSearchParams({
      "share-target": "1",
      url: longUrl,
    });
    window.history.replaceState({}, "", `/?${params}`);

    receiveSharedLink();

    expect(readSharedLink()).toBeNull();
  });

  it("does not intercept unrelated queries or non-root navigation", () => {
    window.history.replaceState({}, "", "/?url=https%3A%2F%2Fexample.com");
    receiveSharedLink();
    expect(window.location.href).toContain("?url=");

    window.history.replaceState(
      {},
      "",
      "/auth/callback?share-target=1&code=auth-code&state=auth-state",
    );
    receiveSharedLink();
    expect(window.location.pathname).toBe("/auth/callback");
    expect(window.location.search).toContain("code=auth-code");
  });

  it("resumes an existing share after OAuth while leaving its callback query intact", () => {
    window.history.replaceState(
      {},
      "",
      "/?share-target=1&url=https%3A%2F%2Fexample.com",
    );
    receiveSharedLink();
    window.history.replaceState(
      {},
      "",
      "/auth/callback?code=auth-code&state=auth-state",
    );

    receiveSharedLink();

    expect(window.location.search).toBe("?code=auth-code&state=auth-state");
    expect(sharedLinkRouteAfterAuth()).toBe("#/save-link");
  });

  it("handles a cross-origin OAuth return marker without requiring a draft", () => {
    window.history.replaceState({}, "", "/?resume-share=1#/my-day");

    receiveSharedLink();

    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#/my-day");
  });

  it("resumes a draft when the OAuth return marker reaches its owning origin", () => {
    window.history.replaceState(
      {},
      "",
      "/?share-target=1&url=https%3A%2F%2Fexample.com",
    );
    receiveSharedLink();
    window.history.replaceState({}, "", "/?resume-share=1#/my-day");

    receiveSharedLink();

    expect(window.location.hash).toBe("#/save-link");
    expect(readSharedLink()?.url).toBe("https://example.com/");
  });

  it("expires drafts after one hour and removes malformed stored data", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T12:00:00.000Z"));
    window.history.replaceState(
      {},
      "",
      "/?share-target=1&url=https%3A%2F%2Fexample.com",
    );
    receiveSharedLink();
    vi.setSystemTime(new Date("2026-10-04T13:00:01.000Z"));
    expect(readSharedLink()).toBeNull();
    expect(sessionStorage.getItem("savia.shared-link.v1")).toBeNull();

    sessionStorage.setItem("savia.shared-link.v1", "not-json");
    expect(readSharedLink()).toBeNull();
    expect(sessionStorage.getItem("savia.shared-link.v1")).toBeNull();
  });

  it("keeps the shared link available in memory when session storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    window.history.replaceState(
      {},
      "",
      "/?share-target=1&url=https%3A%2F%2Fexample.com",
    );

    receiveSharedLink();

    expect(sharedLinkStorageAvailable()).toBe(false);
    expect(readSharedLink()?.url).toBe("https://example.com/");
  });
});
