import type { ApiClient } from "./api-client";
export function createEmbeddedTransport(client: ApiClient, prefix: string) {
  return async (path: string, init: RequestInit = {}): Promise<Response> => {
    let decoded = path;
    try {
      for (let i = 0; i < 4; i++) decoded = decodeURIComponent(decoded);
    } catch {
      return Response.json({ error: "Ruta no permitida." }, { status: 400 });
    }
    if (
      !/^\/api\//.test(decoded) ||
      decoded.includes("..") ||
      decoded.includes("\\") ||
      /[\r\n]/.test(decoded)
    )
      return Response.json({ error: "Ruta no permitida." }, { status: 400 });
    try {
      const response = await client.requestResponse(prefix + path, init);
      if (
        !response.ok &&
        response.headers.get("content-type")?.includes("application/json")
      ) {
        const body = await response.json();
        return Response.json(
          {
            error: body.error?.message ?? "No se pudo completar la operación.",
          },
          { status: response.status },
        );
      }
      return response;
    } catch {
      return Response.json(
        { error: "No se pudo conectar con Savia. Reintenta." },
        { status: 503 },
      );
    }
  };
}
