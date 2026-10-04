import type { Env } from "./env";
// Isolated request-hook compatibility surface. No imports, bindings or network.
export async function hook(
  env: Env,
  code: string,
  payload: { body: string; values: Record<string, string>; response?: string },
) {
  if (!code.trim())
    return { body: payload.body, variables: {} as Record<string, string> };
  if (env.HOOK_EXECUTOR) return env.HOOK_EXECUTOR.execute(code, payload);
  if (!env.HOOK_SERVICE) throw new Error("Hook executor is not configured.");
  const controller = new AbortController();
  const failure =
    "El hook falló o superó el tiempo permitido. Revisa el script.";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(failure));
    }, 35_000);
  });
  try {
    const result: unknown = await Promise.race([
      (async () => {
        let response: Response;
        try {
          response = await env.HOOK_SERVICE!.fetch(
            new Request("https://savia-hook-executor.internal/execute", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ code, payload }),
              signal: controller.signal,
            }),
          );
        } catch {
          throw new Error(failure);
        }
        if (!response.ok) throw new Error(failure);
        try {
          return await response.json();
        } catch {
          throw new Error("Salida del hook inválida.");
        }
      })(),
      timeout,
    ]);
    if (!isHookResult(result)) throw new Error("Salida del hook inválida.");
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export function isHookResult(
  value: unknown,
): value is { body: string; variables: Record<string, string> } {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.body === "string" &&
    !!result.variables &&
    typeof result.variables === "object" &&
    !Array.isArray(result.variables) &&
    Object.values(result.variables).every((value) => typeof value === "string")
  );
}

/** Shared guest contract. The caller supplies only serialized data. */
export function hookExecutionSource(code: string): string {
  return `let body=data.body; const variables=Object.create(null);
 const console={log(){},warn(){},error(){},info(){},debug(){}};
 const bru={getEnvVar:(key)=>data.values[key],getGlobalEnvVar:(key)=>data.values[key],getVar:(key)=>variables[key]??data.values[key],setVar:(key,value)=>{variables[key]=String(value)}};
 const req={getBody:()=>body,setBody:(value)=>{body=String(value)}};
 const res={getBody:()=>data.response??''};
 await (async()=>{\n${code}\n})(); return {body,variables};`;
}
