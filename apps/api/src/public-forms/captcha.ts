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
  rateLimiter?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
};
const unavailable = () =>
  new HTTPException(503, { message: "Public forms are not configured." });
const invalid = () =>
  new HTTPException(403, {
    message: "Verification failed. Complete the challenge again.",
  });
export function captchaConfiguration(options: CaptchaOptions) {
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

const hex = (length: number) =>
  z.string().regex(new RegExp(`^[a-f0-9]{${length}}$`));
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
            data: z
              .object({
                formId: z.string().uuid(),
                origin: z.string().url(),
                action: z.literal("public_submit"),
              })
              .strict(),
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
export async function publicFormChallenge(
  options: CaptchaOptions,
  formId: string,
) {
  const config = captchaConfiguration(options);
  if (config.provider !== "altcha")
    throw new HTTPException(404, { message: "Not found." });
  return createChallenge({
    algorithm: "PBKDF2/SHA-256",
    cost: 1000,
    counter: randomInt(5000, 1000),
    deriveKey,
    hmacSignatureSecret: config.secretKey,
    expiresAt: new Date(Date.now() + 300_000),
    data: { formId, origin: config.origin, action: "public_submit" },
  });
}
/** Unique proof identity is independent of JSON/base64 encoding and solver timing. */
export function captchaIdentity(options: CaptchaOptions, token: string) {
  if (captchaConfiguration(options).provider === "turnstile")
    return { key: token, proof: undefined };
  const { challenge, solution } = decodeProof(token);
  // zod emits keys in schema order. Include the complete proof in the request
  // fingerprint so an unsolved challenge cannot retrieve an accepted receipt.
  return {
    key: `altcha:${challenge.signature}`,
    proof: JSON.stringify({
      challenge,
      solution: { counter: solution.counter, derivedKey: solution.derivedKey },
    }),
  };
}
export async function verifyCaptcha(
  options: CaptchaOptions,
  input: { token: string; submissionId: string; formId: string; ip: string },
) {
  const config = captchaConfiguration(options);
  if (config.provider === "turnstile") return verifyTurnstile(options, input);
  const { challenge, solution } = decodeProof(input.token);
  if (
    challenge.parameters.data.formId !== input.formId ||
    challenge.parameters.data.origin !== config.origin ||
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
          hmacSignatureSecret: config.secretKey,
        })
      ).verified
    )
      throw invalid();
  } catch {
    throw invalid();
  }
}
