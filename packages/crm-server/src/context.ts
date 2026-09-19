import { HTTPException } from "hono/http-exception";
export type Env = {
  Bindings: {
    DB: D1Database;
    POC_LOCAL: string;
    FILES: R2Bucket;
    INTEGRATION_KEY?: string;
    GEOAPIFY_API_KEY?: string;
  };
  Variables: { tenant: string; principalId: string };
};
export function fail(
  message: string,
  status: 400 | 403 | 404 | 409 | 413 | 422 | 428 | 502 = 400,
): never {
  throw new HTTPException(status, { message });
}
