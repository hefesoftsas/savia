import { expect, it } from "vitest";
import { solveChallenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import {
  createCaptchaChallenge,
  verifyCaptchaProof,
  captchaProofIdentity,
} from "../src/captcha/verification";
import {
  publicFormChallenge,
  verifyCaptcha,
} from "../src/public-forms/captcha";
const options = {
  captchaProvider: "altcha" as const,
  altchaSecret: "a-local-altcha-secret-at-least-32-characters",
  publicOrigin: "https://team.example.test",
  rateLimiter: { limit: async () => ({ success: true }) },
};
const binding = {
  purpose: "tenant_signup" as const,
  subject: "4",
  origin: "https://team.example.test",
};
async function solution() {
  const challenge = await createCaptchaChallenge(options, binding);
  const solved = await solveChallenge({ challenge, deriveKey });
  if (!solved) throw new Error("No solution");
  return btoa(JSON.stringify({ challenge, solution: solved }));
}
it("accepts an actual ALTCHA solve only for the signed tenant purpose and origin", async () => {
  const token = await solution();
  await expect(
    verifyCaptchaProof(options, {
      token,
      submissionId: crypto.randomUUID(),
      ip: "192.0.2.4",
      binding,
    }),
  ).resolves.toBeUndefined();
  for (const change of [
    { subject: "5" },
    { origin: "https://other.example.test" },
    { purpose: "public_submit" as const },
  ])
    await expect(
      verifyCaptchaProof(options, {
        token,
        submissionId: crypto.randomUUID(),
        ip: "192.0.2.4",
        binding: { ...binding, ...change },
      }),
    ).rejects.toThrow();
  await expect(
    verifyCaptcha(options, {
      token,
      submissionId: crypto.randomUUID(),
      ip: "192.0.2.4",
      formId: "dc379d9c-2e6b-4e73-8b6e-8f0bb1aa348c",
    }),
  ).rejects.toThrow();
});
it("rejects public-form proofs, rotated secrets, expiration and localhost bypass", async () => {
  const challenge = await publicFormChallenge(
    options,
    "dc379d9c-2e6b-4e73-8b6e-8f0bb1aa348c",
  );
  const solved = await solveChallenge({ challenge, deriveKey });
  const token = btoa(JSON.stringify({ challenge, solution: solved }));
  await expect(
    verifyCaptchaProof(options, {
      token,
      submissionId: crypto.randomUUID(),
      ip: "unknown",
      binding,
    }),
  ).rejects.toThrow();
  const valid = await solution();
  await expect(
    verifyCaptchaProof(
      {
        ...options,
        altchaSecret: "a-different-local-secret-at-least-32-characters",
      },
      {
        token: valid,
        submissionId: crypto.randomUUID(),
        ip: "unknown",
        binding,
      },
    ),
  ).rejects.toThrow();
  await expect(
    verifyCaptchaProof(
      { disableCaptcha: true, publicOrigin: "http://localhost" },
      {
        token: "bypass",
        submissionId: crypto.randomUUID(),
        ip: "unknown",
        binding: { ...binding, origin: "http://localhost" },
      },
    ),
  ).rejects.toThrow();
  const parsed = JSON.parse(atob(valid));
  parsed.challenge.parameters.expiresAt = 1;
  await expect(
    verifyCaptchaProof(options, {
      token: btoa(JSON.stringify(parsed)),
      submissionId: crypto.randomUUID(),
      ip: "unknown",
      binding,
    }),
  ).rejects.toThrow();
});
it("gives equivalent ALTCHA encodings one proof identity", async () => {
  const token = await solution();
  const parsed = JSON.parse(atob(token));
  parsed.solution.time = 12345;
  expect(captchaProofIdentity(options, token)).toEqual(
    captchaProofIdentity(options, btoa(JSON.stringify(parsed))),
  );
});
it("requires exact Turnstile action, hostname and tenant custom data", async () => {
  const base = {
    siteKey: "live-site",
    secretKey: "live-secret",
    publicOrigin: binding.origin,
  };
  for (const result of [
    { success: false },
    {
      success: true,
      hostname: "evil.test",
      action: "tenant_signup",
      cdata: "4",
    },
    {
      success: true,
      hostname: "team.example.test",
      action: "public_submit",
      cdata: "4",
    },
    {
      success: true,
      hostname: "team.example.test",
      action: "tenant_signup",
      cdata: "5",
    },
  ])
    await expect(
      verifyCaptchaProof(
        { ...base, fetch: async () => Response.json(result) },
        {
          token: "token",
          submissionId: crypto.randomUUID(),
          ip: "unknown",
          binding,
        },
      ),
    ).rejects.toThrow();
  await expect(
    verifyCaptchaProof(
      {
        ...base,
        fetch: async () =>
          Response.json({
            success: true,
            hostname: "team.example.test",
            action: "tenant_signup",
            cdata: "4",
          }),
      },
      {
        token: "token",
        submissionId: crypto.randomUUID(),
        ip: "unknown",
        binding,
      },
    ),
  ).resolves.toBeUndefined();
  await expect(
    verifyCaptchaProof(
      { ...base, siteKey: "1x00000000000000000000AA" },
      {
        token: "token",
        submissionId: crypto.randomUUID(),
        ip: "unknown",
        binding,
      },
    ),
  ).rejects.toThrow();
});
