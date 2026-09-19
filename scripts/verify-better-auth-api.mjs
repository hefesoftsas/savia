import assert from "node:assert/strict";

const apiUrl = (process.env.API_URL ?? "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);
const email =
  process.env.BETTER_AUTH_BOOTSTRAP_EMAIL ?? "savia.admin@example.test";
const password =
  process.env.BETTER_AUTH_BOOTSTRAP_PASSWORD ?? "TestUser321!";

function cookie(response, name) {
  const cookies = response.headers.getSetCookie?.() ?? [];
  const candidate =
    cookies.find((entry) => entry.startsWith(`${name}=`)) ??
    response.headers.get("set-cookie");
  return candidate?.startsWith(`${name}=`)
    ? candidate.split(";", 1)[0]
    : undefined;
}

function requiredCookie(response, name, message) {
  const value = cookie(response, name);
  assert.ok(value, message);
  return value;
}

const signIn = await fetch(`${apiUrl}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: apiUrl },
  body: JSON.stringify({ email, password }),
});
assert.equal(signIn.status, 200, "Better Auth sign-in failed");

const signInBody = await signIn.json();
const isMfaChallenge =
  signInBody &&
  typeof signInBody === "object" &&
  signInBody.twoFactorRedirect === true;

if (isMfaChallenge) {
  assert.equal(
    signIn.headers.get("set-auth-token"),
    null,
    "Better Auth issued a bearer token before MFA completion",
  );
  const challengeCookie = requiredCookie(
    signIn,
    "savia_two_factor",
    "Better Auth did not set an MFA challenge cookie",
  );
  const code = process.env.TOTP_CODE;
  if (!code) {
    console.log(
      "MFA challenge verified; set TOTP_CODE from the authenticator app to verify an authenticated API session",
    );
  } else {
    const completion = await fetch(
      `${apiUrl}/api/auth/two-factor/verify-totp`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: challengeCookie,
          origin: apiUrl,
        },
        body: JSON.stringify({ code }),
      },
    );
    assert.equal(completion.status, 200, "TOTP challenge completion failed");
    const sessionCookie = requiredCookie(
      completion,
      "savia.session_token",
      "Better Auth did not set a session cookie after MFA completion",
    );
    const bearerToken = completion.headers.get("set-auth-token");
    assert.ok(
      bearerToken,
      "Better Auth did not issue a bearer session token after MFA completion",
    );
    await verifyIdentity(apiUrl, sessionCookie, bearerToken);
    console.log("MFA-protected Better Auth-to-API session verified");
  }
} else {
  const sessionCookie = requiredCookie(
    signIn,
    "savia.session_token",
    "Better Auth did not set a session cookie",
  );
  const bearerToken = signIn.headers.get("set-auth-token");
  assert.ok(bearerToken, "Better Auth did not issue a bearer session token");

  const [cookieIdentity, bearerIdentity] = await Promise.all([
    fetch(`${apiUrl}/v1/identity/me`, { headers: { cookie: sessionCookie } }),
    fetch(`${apiUrl}/v1/identity/me`, {
      headers: { authorization: `Bearer ${bearerToken}` },
    }),
  ]);
  assert.equal(
    cookieIdentity.status,
    403,
    "Unenrolled platform administrator was unexpectedly authorized",
  );
  assert.equal(
    bearerIdentity.status,
    403,
    "Unenrolled bearer session was unexpectedly authorized",
  );
  console.log("MFA enrollment requirement verified");
}

async function verifyIdentity(url, sessionCookie, bearerToken) {
  const [cookieIdentity, bearerIdentity] = await Promise.all([
    fetch(`${url}/v1/identity/me`, { headers: { cookie: sessionCookie } }),
    fetch(`${url}/v1/identity/me`, {
      headers: { authorization: `Bearer ${bearerToken}` },
    }),
  ]);
  assert.equal(
    cookieIdentity.status,
    200,
    "Cookie session was rejected by the API",
  );
  assert.equal(
    bearerIdentity.status,
    200,
    "Bearer session was rejected by the API",
  );
}
