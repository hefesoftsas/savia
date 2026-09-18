import Dexie, { type Table } from "dexie";
import type { UserIdentity } from "ra-core";
import type { AuthSession, AuthPermissions } from "@/auth/auth-session";
import { isOfflineError } from "@/offline/offline-error";

const LEASE_MS = 12 * 60 * 60 * 1000;
type Profile = {
  environment: string;
  identity: UserIdentity;
  permissions: AuthPermissions;
  expiresAt: number;
};
type Metadata = { key: string; value: unknown };
class SessionDb extends Dexie {
  profiles!: Table<Profile, string>;
  metadata!: Table<Metadata, string>;
  constructor() {
    super("savia-workspaces");
    this.version(1).stores({ profiles: "environment", metadata: "key" });
  }
}
let database: SessionDb | undefined;
const db = () => (database ??= new SessionDb());
export async function clearSessionCache(environment: string) {
  if (typeof indexedDB === "undefined") return;
  try {
    await db().profiles.delete(environment);
  } catch {
    /* Cache availability must not block logout. */
  }
}
export async function readWorkspaceMetadata<T>(
  key: string,
): Promise<T | undefined> {
  if (typeof indexedDB === "undefined") return;
  try {
    return (await db().metadata.get(key))?.value as T | undefined;
  } catch {
    return undefined;
  }
}
export async function writeWorkspaceMetadata(key: string, value: unknown) {
  if (typeof indexedDB !== "undefined")
    try {
      await db().metadata.put({ key, value });
    } catch {
      /* Metadata caching is best effort. */
    }
}
export async function removeWorkspaceMetadata(prefix: string) {
  if (typeof indexedDB !== "undefined")
    try {
      await db().metadata.where("key").startsWith(prefix).delete();
    } catch {
      /* Cleanup must not block authentication. */
    }
}
/** Persist only an expiring offline workspace identity, never access/refresh tokens. */
export function createLocalSession(
  remote: AuthSession,
  environment: string,
  verifyRemote: () => Promise<void> = () => remote.checkSession(),
): AuthSession {
  let cached: Profile | undefined;
  const read = async () => {
    let profile = cached;
    if (typeof indexedDB !== "undefined") {
      try {
        profile = await db().profiles.get(environment);
      } catch {
        /* A previously verified in-memory lease survives temporary storage failure. */
      }
    }
    if (!profile || profile.expiresAt <= Date.now())
      throw new Error(
        "Conecta para verificar tu acceso al espacio de trabajo.",
      );
    return profile;
  };
  const invalidate = async () => {
    cached = undefined;
    await clearSessionCache(environment);
  };
  const capture = async () => {
    const [identity, permissions] = await Promise.all([
      remote.getIdentity(),
      remote.getPermissions(),
    ]);
    const profile = {
      environment,
      identity,
      permissions,
      expiresAt: Date.now() + LEASE_MS,
    };
    if (typeof indexedDB !== "undefined")
      try {
        await db().profiles.put(profile);
      } catch {
        /* Online authentication still succeeds without persistence. */
      }
    cached = profile;
  };
  const ensureLease = async () => {
    try {
      await read();
    } catch {
      await verifyRemote();
      await capture();
    }
  };
  const fallback = async <T>(
    action: () => Promise<T>,
    pick: (profile: Profile) => T,
  ): Promise<T> => {
    try {
      return await action();
    } catch (error) {
      if (!isOfflineError(error)) {
        await invalidate();
        throw error;
      }
      return pick(await read());
    }
  };
  return {
    login: () => remote.login(),
    getAuthorizeUrl: () => remote.getAuthorizeUrl(),
    getAccessToken: () => remote.getAccessToken(),
    handleCallback: async () => {
      const result = await remote.handleCallback();
      await verifyRemote();
      await capture();
      return result;
    },
    checkSession: async () => {
      await fallback(
        async () => {
          await remote.checkSession();
          await verifyRemote();
          await capture();
        },
        () => undefined,
      );
    },
    getIdentity: () =>
      fallback(
        async () => {
          await ensureLease();
          return remote.getIdentity();
        },
        (p) => p.identity,
      ),
    getPermissions: () =>
      fallback(
        async () => {
          await ensureLease();
          return remote.getPermissions();
        },
        (p) => p.permissions,
      ),
    clearSession: async () => {
      await invalidate();
      await remote.clearSession();
    },
    logout: async () => {
      await invalidate();
      return remote.logout();
    },
  };
}
