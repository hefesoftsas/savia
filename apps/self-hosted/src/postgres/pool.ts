import pg from "pg";

const drains = new WeakMap<
  pg.Pool,
  { clients: Set<pg.PoolClient>; drained?: () => void }
>();

/** Idle errors include err.client (and credentials); never forward or log them. */
export function createPostgresPool(options: pg.PoolConfig): pg.Pool {
  const pool = new pg.Pool(options);
  const state = { clients: new Set<pg.PoolClient>() } as {
    clients: Set<pg.PoolClient>;
    drained?: () => void;
  };
  drains.set(pool, state);
  pool.on("error", () => {});
  pool.on("connect", (client) => state.clients.add(client));
  pool.on("remove", (client) => {
    state.clients.delete(client);
    if (state.clients.size === 0) state.drained?.();
  });
  return pool;
}

/** pg-pool end resolves before idle socket close callbacks; drain those too. */
export async function closePostgresPool(pool: pg.Pool): Promise<void> {
  const state = drains.get(pool);
  await pool.end();
  if (state?.clients.size) {
    await new Promise<void>((resolve) => {
      state.drained = resolve;
      if (state.clients.size === 0) resolve();
    });
  }
  drains.delete(pool);
}
