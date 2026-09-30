import { APIError } from "better-auth/api";
import type { TenantSSOAdapter } from "./tenant-sso";

/** An activity tombstone also covers providers first configured during deactivation. */
export async function assertTenantAuthenticationActive(
  adapter: TenantSSOAdapter,
  tenantId: number,
) {
  const state = await adapter.findOne<{ active: boolean }>({
    model: "tenantAuthState",
    where: [{ field: "tenantId", value: tenantId }],
  });
  if (state?.active === false)
    throw new APIError("FORBIDDEN", { message: "The tenant is inactive" });
}
