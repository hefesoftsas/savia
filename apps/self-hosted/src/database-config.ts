export type DatabaseConfiguration =
  | { driver: "sqlite" }
  | { driver: "postgres"; connectionString: string; maxConnections: number };

export function databaseConfiguration(
  env: Record<string, string | undefined>,
): DatabaseConfiguration {
  const driver = env.SAVIA_DATABASE_DRIVER ?? "sqlite";
  if (driver === "sqlite") return { driver };
  if (driver !== "postgres") throw new Error("Unsupported database driver.");
  let url: URL;
  try {
    url = new URL(env.SAVIA_POSTGRES_URL ?? "");
  } catch {
    throw new Error("SAVIA_POSTGRES_URL must be a valid PostgreSQL URL.");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    url.pathname.length < 2 ||
    url.hash
  )
    throw new Error(
      "SAVIA_POSTGRES_URL requires a host, database and credentials.",
    );
  const local = ["localhost", "127.0.0.1", "[::1]", "postgres"].includes(
    url.hostname,
  );
  const mode = url.searchParams.get("sslmode");
  if (
    (!local && mode !== "verify-full") ||
    (mode && !["verify-full", ...(local ? ["disable"] : [])].includes(mode))
  )
    throw new Error(
      "External PostgreSQL connections require verified TLS (sslmode=verify-full).",
    );
  const allowed = new Set(["sslmode", "sslrootcert"]);
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key)))
    throw new Error("Unsupported PostgreSQL connection URL options.");
  const maxConnections = Number(env.SAVIA_POSTGRES_POOL_SIZE ?? 5);
  if (
    !Number.isInteger(maxConnections) ||
    maxConnections < 1 ||
    maxConnections > 20
  )
    throw new Error(
      "PostgreSQL pool size must be between 1 and 20 per schema.",
    );
  return { driver, connectionString: url.toString(), maxConnections };
}
