import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import type { SaviaCollectionEvent } from "@savia/studio-shared/savia-flows";
import { SaviaCollectionHostError } from "../nodes/savia/collection-client";
import {
  isTerminalSaviaAuthorizationSkip,
  matchesSaviaCollectionSource,
  verifySaviaCollectionEvent,
} from "./savia-collection-events";

const secret = "a-secure-local-flows-bridge-secret-that-is-long-enough";
const event: SaviaCollectionEvent = {
  id: "event-1",
  tenant: "tenant:one",
  collection: "Tasks",
  operation: "created",
  recordId: "record-1",
  recordVersion: 1,
  timestamp: "2026-10-12T10:00:00.000Z",
  before: null,
  after: { title: "One" },
  changedFields: ["title"],
  actor: { kind: "user", id: "user-1" },
};

async function sign(
  body: string,
  claims = {},
  lifetime = 30,
  includeTimes = true,
) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  const bodyDigest = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({
    tenant: "tenant:one",
    eventId: "event-1",
    bodyDigest,
    ...claims,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("savia")
    .setAudience("savia-flows-collection-events");
  if (includeTimes) jwt.setIssuedAt(now).setExpirationTime(now + lifetime);
  return jwt.sign(new TextEncoder().encode(secret));
}

describe("verifySaviaCollectionEvent", () => {
  it("accepts an event only when the signed digest and tenant/id match the body", async () => {
    const body = JSON.stringify(event);
    await expect(
      verifySaviaCollectionEvent(await sign(body), body, secret),
    ).resolves.toEqual(event);
  });
  it("rejects a validly signed token whose body digest does not match", async () => {
    const body = JSON.stringify(event);
    const token = await sign(body);
    await expect(
      verifySaviaCollectionEvent(token, `${body} `, secret),
    ).rejects.toThrow();
  });
  it("rejects body binding claims that identify a different event", async () => {
    const body = JSON.stringify(event);
    await expect(
      verifySaviaCollectionEvent(
        await sign(body, { eventId: "event-other" }),
        body,
        secret,
      ),
    ).rejects.toThrow();
  });
  it("requires explicit issued-at and expiry claims", async () => {
    const body = JSON.stringify(event);
    await expect(
      verifySaviaCollectionEvent(await sign(body, {}, 30, false), body, secret),
    ).rejects.toThrow();
  });
  it("rejects a token lifetime longer than thirty seconds", async () => {
    const body = JSON.stringify(event);
    await expect(
      verifySaviaCollectionEvent(await sign(body, {}, 31), body, secret),
    ).rejects.toThrow();
  });
});

describe("collection event admission prechecks", () => {
  it("does not authorize subscriptions for unrelated collections or operations", () => {
    const subscription = {
      collection: "Tasks",
      operations: ["updated"] as const,
      ignoreOwnChanges: true,
    };
    expect(matchesSaviaCollectionSource(event, subscription)).toBe(false);
    expect(
      matchesSaviaCollectionSource(
        { ...event, operation: "updated" },
        subscription,
      ),
    ).toBe(true);
    expect(
      matchesSaviaCollectionSource(
        { ...event, collection: "Invoices" },
        subscription,
      ),
    ).toBe(false);
  });

  it("treats inaccessible or unsupported collections as terminal skips but retries authentication and host failures", () => {
    expect(
      isTerminalSaviaAuthorizationSkip(
        new SaviaCollectionHostError(403, "denied"),
      ),
    ).toBe(true);
    expect(
      isTerminalSaviaAuthorizationSkip(
        new SaviaCollectionHostError(404, "gone"),
      ),
    ).toBe(true);
    expect(
      isTerminalSaviaAuthorizationSkip(
        new SaviaCollectionHostError(422, "unsupported"),
      ),
    ).toBe(true);
    expect(
      isTerminalSaviaAuthorizationSkip(
        new SaviaCollectionHostError(401, "bridge config"),
      ),
    ).toBe(false);
    expect(
      isTerminalSaviaAuthorizationSkip(
        new SaviaCollectionHostError(503, "temporary"),
      ),
    ).toBe(false);
  });
});
