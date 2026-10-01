import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  createPendingVerification,
  sendPendingVerification,
  consumePendingVerification,
} from "../src/pending-email-verification";
const environment = { ...env, BETTER_AUTH_SECRET: "pending-secret" };
const input = {
  purpose: "microsoft_link" as const,
  tenantId: 712004,
  email: "Owner@Example.test",
  revision: "policy-1",
  returnOrigin: "https://team.example.test",
  browserNonce: "browser-secret",
  providerSubject: "immutable-oid",
  providerTenantId: "9188040d-6c67-4c5b-b112-36a304b66dad",
};
async function fixture() {
  let url = "";
  const pending = await createPendingVerification(input, environment);
  await sendPendingVerification(
    {
      id: pending.id,
      browserNonce: input.browserNonce,
      origin: input.returnOrigin,
    },
    environment,
    {
      sendTransactionalEmail: async (mail) => {
        url = mail.text.match(/https:\/\/[^\s]+/)?.[0] ?? "";
      },
    },
  );
  const token = new URL(url).searchParams.get("token")!;
  return { pending, token };
}
const proof = (id: string, token: string) => ({
  id,
  token,
  browserNonce: input.browserNonce,
  origin: input.returnOrigin,
  purpose: input.purpose,
  tenantId: input.tenantId,
});
describe("pending email ownership verification", () => {
  it("consumes_once_under_concurrency", async () => {
    const { pending, token } = await fixture();
    const results = await Promise.allSettled([
      consumePendingVerification(proof(pending.id, token), environment),
      consumePendingVerification(proof(pending.id, token), environment),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const result = results.find(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<any>;
    expect(result.value).toMatchObject({
      email: "owner@example.test",
      providerSubject: "immutable-oid",
      tenantId: 712004,
    });
  });
  it("rejects_wrong_purpose_tenant_browser_origin_and_expiry", async () => {
    const { pending, token } = await fixture();
    for (const override of [
      { purpose: "password_registration" as const },
      { tenantId: 712005 },
      { browserNonce: "other-device" },
      { origin: "https://evil.test" },
    ])
      await expect(
        consumePendingVerification(
          { ...proof(pending.id, token), ...override },
          environment,
        ),
      ).rejects.toThrow();
    await environment.AUTH_DB.prepare(
      "UPDATE pending_email_verification SET token_expires_at=? WHERE id=?",
    )
      .bind(Date.now() - 1, pending.id)
      .run();
    await expect(
      consumePendingVerification(proof(pending.id, token), environment),
    ).rejects.toThrow();
  });
  it("mail_failure_leaves_no_usable_identity", async () => {
    const pending = await createPendingVerification(input, environment);
    await expect(
      sendPendingVerification(
        {
          id: pending.id,
          browserNonce: input.browserNonce,
          origin: input.returnOrigin,
        },
        environment,
        {
          sendTransactionalEmail: async () => {
            throw new Error("smtp unreachable");
          },
        },
      ),
    ).rejects.toThrow();
    const row = await environment.AUTH_DB.prepare(
      "SELECT token_hash FROM pending_email_verification WHERE id=?",
    )
      .bind(pending.id)
      .first<{ token_hash: string | null }>();
    expect(row?.token_hash).toBeNull();
  });
  it("resend_preserves_one_intent_and_bounds_attempts", async () => {
    const { pending, token } = await fixture();
    await expect(
      sendPendingVerification(
        {
          id: pending.id,
          browserNonce: input.browserNonce,
          origin: input.returnOrigin,
        },
        environment,
        { sendTransactionalEmail: async () => undefined },
      ),
    ).rejects.toThrow();
    await environment.AUTH_DB.prepare(
      "UPDATE pending_email_verification SET sent_at=? WHERE id=?",
    )
      .bind(Date.now() - 61_000, pending.id)
      .run();
    let url = "";
    await sendPendingVerification(
      {
        id: pending.id,
        browserNonce: input.browserNonce,
        origin: input.returnOrigin,
      },
      environment,
      {
        sendTransactionalEmail: async (mail) => {
          url = mail.text.match(/https:\/\/[^\s]+/)?.[0] ?? "";
        },
      },
    );
    await expect(
      consumePendingVerification(proof(pending.id, token), environment),
    ).rejects.toThrow();
    expect(
      await consumePendingVerification(
        proof(pending.id, new URL(url).searchParams.get("token")!),
        environment,
      ),
    ).toMatchObject({ id: pending.id });
  });
});

it("bounds mail across separate intents for the same tenant and address", async () => {
  const { limitVerificationMail } =
    await import("../src/pending-email-verification");
  const email = `limited-${crypto.randomUUID()}@example.test`;
  for (let i = 0; i < 5; i++)
    await limitVerificationMail(environment, {
      tenantId: 712004,
      email,
      ip: "192.0.2.44",
    });
  await expect(
    limitVerificationMail(environment, {
      tenantId: 712004,
      email,
      ip: "192.0.2.45",
    }),
  ).rejects.toThrow();
});

it("routes ChatGPT link proofs through the ChatGPT verification endpoint", async () => {
  let url = "";
  const pending = await createPendingVerification(
    {
      ...input,
      purpose: "chatgpt_link",
      providerSubject: "a".repeat(64),
      providerTenantId: "oaiapp_test",
    },
    environment,
  );

  await sendPendingVerification(
    {
      id: pending.id,
      browserNonce: input.browserNonce,
      origin: input.returnOrigin,
    },
    environment,
    {
      sendTransactionalEmail: async (mail) => {
        url = mail.text.match(/https:\/\/[^\s]+/)?.[0] ?? "";
      },
    },
  );

  expect(new URL(url).pathname).toBe(
    "/api/auth/chatgpt-email-verification/verify",
  );
  expect(pending).toMatchObject({
    purpose: "chatgpt_link",
    providerSubject: "a".repeat(64),
    providerTenantId: "oaiapp_test",
  });
});
