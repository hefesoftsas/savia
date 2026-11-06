import type {
  HookPayload,
  HookResult,
} from "../../savia-request/src/server/env";
import { MAX_CODE_BYTES, MAX_INPUT_BYTES } from "./limits";

class InputError extends Error {
  constructor(readonly status: number) {
    super("Invalid hook request");
  }
}

async function readInput(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_INPUT_BYTES)
    throw new InputError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new InputError(400);
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_INPUT_BYTES) {
        await reader.cancel();
        throw new InputError(413);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text + decoder.decode());
  } catch {
    throw new InputError(400);
  }
}

function isInput(
  value: unknown,
): value is { code: string; payload: HookPayload } {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  if (
    typeof input.code !== "string" ||
    !input.payload ||
    typeof input.payload !== "object"
  )
    return false;
  const payload = input.payload as Record<string, unknown>;
  return (
    typeof payload.body === "string" &&
    !!payload.values &&
    typeof payload.values === "object" &&
    !Array.isArray(payload.values) &&
    Object.values(payload.values).every((value) => typeof value === "string") &&
    (payload.response === undefined || typeof payload.response === "string")
  );
}

export function createHandler(
  execute: (code: string, payload: HookPayload) => Promise<HookResult>,
) {
  return {
    async fetch(request: Request): Promise<Response> {
      if (
        request.method !== "POST" ||
        new URL(request.url).pathname !== "/execute"
      )
        return new Response("Not found", { status: 404 });
      let input: unknown;
      try {
        input = await readInput(request);
      } catch (error) {
        return Response.json(
          { error: "Invalid hook request" },
          { status: error instanceof InputError ? error.status : 400 },
        );
      }
      if (!isInput(input))
        return Response.json(
          { error: "Invalid hook request" },
          { status: 400 },
        );
      if (new TextEncoder().encode(input.code).length > MAX_CODE_BYTES)
        return Response.json(
          { error: "Hook source exceeds the limit" },
          { status: 413 },
        );
      try {
        return Response.json(await execute(input.code, input.payload));
      } catch {
        return Response.json(
          {
            error:
              "El hook rechazó los datos o superó sus límites. Revisa el script.",
          },
          { status: 422 },
        );
      }
    },
  };
}
