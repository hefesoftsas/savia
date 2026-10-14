import {
  isNativeFlowsCall,
  type NativeFlowsCall,
} from "@savia/studio-shared/native-flows";
import { Hono } from "hono";
import { jwtMiddleware } from "../auth";
import type { ApiContext } from "../context";
import { requestNativeFlows } from "../nodes/savia/native-flow-client";
import { getAuthContext } from "../utils/auth-context";

export const saviaNativeFlowsRoutes = new Hono<ApiContext>();

saviaNativeFlowsRoutes.use("*", jwtMiddleware);
saviaNativeFlowsRoutes.all("*", async (c) => {
  const { organizationId, userId, isApiKey } = getAuthContext(c);
  if (isApiKey) return c.json({ error: "A user session is required" }, 403);
  const url = new URL(c.req.url);
  const matched = /^\/[^/]+\/savia\/native(\/.*)$/.exec(url.pathname);
  const query = [...url.searchParams.entries()];
  const hostTenantQuery =
    query.length === 1 &&
    query[0]![0] === "tenant" &&
    query[0]![1] === organizationId;
  if (!matched || (query.length > 0 && !hostTenantQuery))
    return c.json({ error: "Invalid native flow operation" }, 404);
  const path = matched[1]!;
  const method = c.req.method as NativeFlowsCall["method"];
  const call: NativeFlowsCall = { method, path };
  if (method !== "GET") {
    let raw = "";
    const reader = c.req.raw.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: false,
      });
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 96 * 1024) {
            await reader.cancel();
            return c.json({ error: "Native flow request is too large" }, 413);
          }
          raw += decoder.decode(value, { stream: true });
        }
        raw += decoder.decode();
      } catch {
        return c.json({ error: "Invalid request body" }, 400);
      } finally {
        reader.releaseLock();
      }
    }
    if (raw) {
      try {
        call.body = JSON.parse(raw);
      } catch {
        return c.json({ error: "Invalid JSON" }, 400);
      }
    }
  }
  if (!isNativeFlowsCall(call))
    return c.json({ error: "Invalid native flow operation" }, 404);
  try {
    const response = await requestNativeFlows(c.env, call, {
      principalId: userId,
      tenant: organizationId,
    });
    const headers = new Headers({
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    console.error("Native Savia Flows host is unavailable", error);
    return c.json(
      { error: "Savia native flows are temporarily unavailable" },
      503,
    );
  }
});
