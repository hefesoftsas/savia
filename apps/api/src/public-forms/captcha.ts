import { createChallenge, randomInt, verifySolution } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { HTTPException } from "hono/http-exception";
import { z } from "@hono/zod-openapi";
import {
  turnstileConfiguration,
  verifyTurnstile,
  type TurnstileOptions,
} from "./turnstile";

export type CaptchaOptions = TurnstileOptions & {
  captchaProvider?: "turnstile" | "altcha";
  altchaSecret?: string;
  /**
   * Local-development bypass for anonymous verification. Honored only when
   * `publicOrigin` is a localhost origin; anywhere else the flag is ignored
   * and the normal provider configuration applies (fail closed).
   */
  disableCaptcha?: boolean;
  rateLimiter?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
};

export function isLocalPublicOrigin(publicOrigin: string | undefined): boolean {
  if (!publicOrigin) return false;
  try {
    const origin = new URL(publicOrigin);
    return (
      (origin.protocol === "http:" || origin.protocol === "https:") &&
      ["localhost", "127.0.0.1", "::1"].includes(origin.hostname)
    );
  } catch {
    return false;
  }
}

export function isCaptchaDisabled(options: CaptchaOptions): boolean {
  return (
    options.disableCaptcha === true && isLocalPublicOrigin(options.publicOrigin)
  );
}
const unavailable = () =>
  new HTTPException(503, { message: "Public forms are not configured." });
const invalid = () =>
  new HTTPException(403, {
    message: "Verification failed. Complete the challenge again.",
  });
export function captchaConfiguration(options: CaptchaOptions) {
  if (isCaptchaDisabled(options))
    return { provider: "disabled" as const, secretKey: "local-captcha-bypass" };
  if (
    options.captchaProvider === undefined ||
    options.captchaProvider === "turnstile"
  )
    return {
      provider: "turnstile" as const,
      ...turnstileConfiguration(options),
    };
  if (
    options.captchaProvider !== "altcha" ||
    !options.altchaSecret ||
    options.altchaSecret.length < 32 ||
    !options.publicOrigin ||
    !options.rateLimiter
  )
    throw unavailable();
  let origin: URL;
  try {
    origin = new URL(options.publicOrigin);
  } catch {
    throw unavailable();
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password
  )
    throw unavailable();
  return {
    provider: "altcha" as const,
    secretKey: options.altchaSecret,
    origin: origin.origin,
  };
}

export type CaptchaBinding = {
  purpose: "public_submit" | "tenant_signup";
  subject: string;
  origin: string;
};
const hex = (length: number) =>
  z.string().regex(new RegExp(`^[a-f0-9]{${length}}$`));
const dataSchema = z.union([
  z
    .object({
      formId: z.string().uuid(),
      origin: z.string().url(),
      action: z.literal("public_submit"),
    })
    .strict(),
  z
    .object({
      tenantId: z.string().regex(/^[1-9]\d*$/),
      origin: z.string().url(),
      action: z.literal("tenant_signup"),
    })
    .strict(),
]);
const proofSchema = z
  .object({
    challenge: z
      .object({
        parameters: z
          .object({
            algorithm: z.literal("PBKDF2/SHA-256"),
            nonce: hex(32),
            salt: hex(32),
            cost: z.literal(1000),
            keyLength: z.literal(32),
            keyPrefix: hex(32),
            expiresAt: z.number().int().positive(),
            data: dataSchema,
          })
          .strict(),
        signature: hex(64),
      })
      .strict(),
    solution: z
      .object({
        counter: z.number().int().min(0).max(0xffffffff),
        derivedKey: hex(64),
        time: z.number().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();
function decodeProof(token: string) {
  try {
    return proofSchema.parse(JSON.parse(atob(token)));
  } catch {
    throw invalid();
  }
}
function boundConfiguration(options: CaptchaOptions, binding: CaptchaBinding) {
  if (
    binding.origin !==
    new URL(options.publicOrigin ?? "https://invalid.test").origin
  )
    throw invalid();
  if (
    binding.purpose === "tenant_signup" &&
    !/^[1-9]\d*$/.test(binding.subject)
  )
    throw invalid();
  return captchaConfiguration({
    ...options,
    ...(binding.purpose === "tenant_signup" ? { disableCaptcha: false } : {}),
  });
}
async function boundSecret(secret: string, purpose: CaptchaBinding["purpose"]) {
  if (purpose === "public_submit") return secret;
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`savia:tenant-signup-captcha:v1:${secret}`),
    ),
  );
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function createBoundCaptchaChallenge(
  options: CaptchaOptions,
  binding: CaptchaBinding,
) {
  const config = boundConfiguration(options, binding);
  if (config.provider !== "altcha")
    throw new HTTPException(404, { message: "Not found." });
  return createChallenge({
    algorithm: "PBKDF2/SHA-256",
    cost: 1000,
    counter: randomInt(5000, 1000),
    deriveKey,
    hmacSignatureSecret: await boundSecret(config.secretKey, binding.purpose),
    expiresAt: new Date(Date.now() + 300_000),
    data:
      binding.purpose === "public_submit"
        ? {
            formId: binding.subject,
            origin: config.origin,
            action: "public_submit",
          }
        : {
            tenantId: binding.subject,
            origin: config.origin,
            action: "tenant_signup",
          },
  });
}
export async function publicFormChallenge(
  options: CaptchaOptions,
  formId: string,
) {
  return createBoundCaptchaChallenge(options, {
    purpose: "public_submit",
    subject: formId,
    origin: new URL(options.publicOrigin ?? "https://invalid.test").origin,
  });
}
export function boundCaptchaIdentity(
  options: CaptchaOptions,
  token: string,
  purpose?: CaptchaBinding["purpose"],
) {
  const provider = captchaConfiguration({
    ...options,
    ...(purpose === "tenant_signup" ? { disableCaptcha: false } : {}),
  }).provider;
  if (provider === "turnstile" || provider === "disabled")
    return { key: token, proof: undefined };
  const { challenge, solution } = decodeProof(token);
  if (purpose && challenge.parameters.data.action !== purpose) throw invalid();
  return {
    key: `altcha:${challenge.signature}`,
    proof: JSON.stringify({
      challenge,
      solution: { counter: solution.counter, derivedKey: solution.derivedKey },
    }),
  };
}
export function captchaIdentity(options: CaptchaOptions, token: string) {
  return boundCaptchaIdentity(options, token, "public_submit");
}
export async function verifyBoundCaptcha(
  options: CaptchaOptions,
  input: {
    token: string;
    submissionId: string;
    ip: string;
    binding: CaptchaBinding;
  },
) {
  const config = boundConfiguration(options, input.binding);
  if (config.provider === "disabled") return;
  if (config.provider === "turnstile")
    return verifyTurnstile(
      options,
      { ...input, formId: input.binding.subject },
      { action: input.binding.purpose, cdata: input.binding.subject },
    );
  const { challenge, solution } = decodeProof(input.token),
    data = challenge.parameters.data;
  const subject = data.action === "public_submit" ? data.formId : data.tenantId;
  if (
    data.action !== input.binding.purpose ||
    subject !== input.binding.subject ||
    data.origin !== config.origin ||
    challenge.parameters.expiresAt <= Date.now() / 1000
  )
    throw invalid();
  try {
    if (
      !(
        await verifySolution({
          challenge,
          solution,
          deriveKey,
          hmacSignatureSecret: await boundSecret(
            config.secretKey,
            input.binding.purpose,
          ),
        })
      ).verified
    )
      throw invalid();
  } catch {
    throw invalid();
  }
}
export async function verifyCaptcha(
  options: CaptchaOptions,
  input: { token: string; submissionId: string; formId: string; ip: string },
) {
  return verifyBoundCaptcha(options, {
    ...input,
    binding: {
      purpose: "public_submit",
      subject: input.formId,
      origin: new URL(options.publicOrigin ?? "https://invalid.test").origin,
    },
  });
}
