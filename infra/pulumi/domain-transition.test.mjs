import assert from "node:assert/strict";
import test from "node:test";
import { transitionResponse } from "./domain-transition.mjs";

test("pending canonical links temporarily use the active app without caching redirects", () => {
  const response = transitionResponse(
    new Request("https://savia.hefesoft.com/office/?file=one"),
  );
  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "https://savia.app.hefesoft.com/office/?file=one",
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("pending tenant links preserve only a valid single tenant label", () => {
  assert.equal(
    transitionResponse(
      new Request("https://savia-team.savia.hefesoft.com/"),
    ).headers.get("location"),
    "https://savia-team.savia.app.hefesoft.com/api/auth/admin/authorize",
  );
  for (const host of [
    "a.b.savia.hefesoft.com",
    "api.savia.hefesoft.com",
    "evil.example.com",
  ])
    assert.equal(
      transitionResponse(new Request(`https://${host}/`)).status,
      404,
    );
});
test("pending OAuth links restart without replaying codes and write requests are not redirected", () => {
  assert.equal(
    transitionResponse(
      new Request(
        "https://savia.hefesoft.com/auth/callback?code=secret&state=old",
      ),
    ).headers.get("location"),
    "https://savia.app.hefesoft.com/api/auth/admin/authorize",
  );
  const response = transitionResponse(
    new Request("https://savia.hefesoft.com/api/auth/admin/callback", {
      method: "POST",
      body: "secret",
    }),
  );
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("location"), null);
});

test("stale app workers retire without deleting caches or navigating open documents", async () => {
  const response = transitionResponse(
    new Request("https://savia.hefesoft.com/sw.js"),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /javascript/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const source = await response.text();
  assert.match(source, /registration.unregister/);
  assert.match(source, /pathname === "\/"/);
  assert.doesNotMatch(source, /caches\.|indexedDB|localStorage/);
  assert.equal(
    await transitionResponse(
      new Request("https://savia.hefesoft.com/sw.js", { method: "HEAD" }),
    ).text(),
    "",
  );
});
