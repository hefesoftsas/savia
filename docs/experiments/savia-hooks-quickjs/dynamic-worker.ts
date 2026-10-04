import { hook } from "./baseline-hooks";
export default {
  async fetch(request, env) {
    const { code, payload, repeat = 1, cached = false } = await request.json();
    try {
      let hookEnv = env;
      if (cached) {
        // Include contract version; payload is never part of the identity or code.
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode("probe-contract-v1:" + code),
        );
        const id = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        hookEnv = {
          LOADER: { load: (config) => env.LOADER.get(id, () => config) },
        };
      }
      let result;
      for (let i = 0; i < repeat; i++)
        result = await hook(hookEnv, code, payload);
      return Response.json({ ok: true, result });
    } catch {
      return Response.json({ ok: false });
    }
  },
};
