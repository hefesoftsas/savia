import { HTTPException } from "hono/http-exception";
export type TurnstileOptions = {
  siteKey?: string;
  secretKey?: string;
  publicOrigin?: string;
  fetch?: typeof fetch;
};
export function turnstileConfiguration(options: TurnstileOptions) {
  if (
    !options.siteKey ||
    !options.secretKey ||
    !options.publicOrigin ||
    /^[123]x0{10,}/.test(options.siteKey) ||
    /^[123]x0{10,}/.test(options.secretKey)
  )
    throw new HTTPException(503, {
      message: "Public forms are not configured.",
    });
  let origin: URL;
  try {
    origin = new URL(options.publicOrigin);
  } catch {
    throw new HTTPException(503, {
      message: "Public forms are not configured.",
    });
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password
  )
    throw new HTTPException(503, {
      message: "Public forms are not configured.",
    });
  return {
    siteKey: options.siteKey,
    // Pasted secrets sometimes carry whitespace that siteverify rejects.
    secretKey: options.secretKey.trim(),
    hostname: origin.hostname,
  };
}
export async function verifyTurnstile(
  options: TurnstileOptions,
  input: { token: string; submissionId: string; formId: string; ip: string },
) {
  const config = turnstileConfiguration(options);
  let result: any;
  let logged = false;
  try {
    const response = await (options.fetch ?? fetch)(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: config.secretKey,
          response: input.token,
          remoteip: input.ip === "unknown" ? undefined : input.ip,
          idempotency_key: input.submissionId,
        }),
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      },
    );
    // Anonymous diagnostics: HTTP status only. A non-OK siteverify (for
    // example a mismatched secret) is a configuration problem, not downtime.
    if (!response.ok) {
      console.error(
        JSON.stringify({
          event: "public-form-turnstile-siteverify",
          siteverifyStatus: response.status,
        }),
      );
      logged = true;
      throw Error();
    }
    result = await response.json();
  } catch (error) {
    // Network, timeout, and payload failures land here (the non-OK branch
    // already logged above). The constructor name alone carries no PII.
    if (!logged)
      console.error(
        JSON.stringify({
          event: "public-form-turnstile-siteverify",
          siteverifyStatus: "exception",
          errorName:
            error instanceof Error ? error.constructor.name : "unknown",
        }),
      );
    throw new HTTPException(503, {
      message: "Verification is temporarily unavailable.",
    });
  }
  if (
    result?.success !== true ||
    result.hostname !== config.hostname ||
    result.action !== "public_submit" ||
    result.cdata !== input.formId
  )
    throw new HTTPException(403, {
      message: "Verification failed. Complete the challenge again.",
    });
}
