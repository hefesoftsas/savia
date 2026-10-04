import { describe, expect, it } from "vitest";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-wasmfile-release-sync";
import { createQuickJSExecutor } from "../src/executor";
import { createHandler } from "../src/handler";

const engine = newQuickJSWASMModuleFromVariant(variant);
const handler = createHandler(createQuickJSExecutor(() => engine));
const request = (value: unknown) =>
  new Request("https://hooks.internal/execute", {
    method: "POST",
    body: JSON.stringify(value),
  });
describe("private hook HTTP contract", () => {
  it("executes through the real interpreter", async () => {
    const response = await handler.fetch(
      request({
        code: 'bru.setVar("ok",true)',
        payload: { body: "", values: {} },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      body: "",
      variables: { ok: "true" },
    });
  });
  it.each([
    null,
    {},
    { code: 12 },
    { code: "1", payload: { body: "", values: [] } },
    { code: "1", payload: { body: "", values: { x: 1 } } },
    { code: "1", payload: { body: "", values: {}, response: {} } },
  ])("rejects malformed input %j", async (body) => {
    expect((await handler.fetch(request(body))).status).toBe(400);
  });
  it("does not leak guest errors or stack traces", async () => {
    const response = await handler.fetch(
      request({
        code: 'throw new Error("secret")',
        payload: { body: "", values: {} },
      }),
    );
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain("secret");
  });
  it("rejects oversized source", async () => {
    expect(
      (
        await handler.fetch(
          request({
            code: "x".repeat(300_000),
            payload: { body: "", values: {} },
          }),
        )
      ).status,
    ).toBe(413);
  });
  it("rejects unsupported routes and methods", async () => {
    expect(
      (await handler.fetch(new Request("https://hooks.internal/execute")))
        .status,
    ).toBe(404);
  });
});
