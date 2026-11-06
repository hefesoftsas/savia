export default {
  async fetch(request, env) {
    if (
      request.headers.get("authorization") !==
      "Bearer " + env.BOOTSTRAP_SECRET
    )
      return new Response("Unauthorized", { status: 401 });
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS savia_flows_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    if (request.method === "GET") {
      const result = await env.DB.prepare(
        "SELECT name FROM savia_flows_migrations ORDER BY name",
      ).all();
      return Response.json(result.results.map((row) => row.name));
    }
    const { name, statements } = await request.json();
    if (
      typeof name !== "string" ||
      !Array.isArray(statements) ||
      statements.some((sql) => typeof sql !== "string")
    )
      return new Response("Invalid migration", { status: 400 });
    const existing = await env.DB.prepare(
      "SELECT name FROM savia_flows_migrations WHERE name = ?",
    )
      .bind(name)
      .first();
    if (existing) return Response.json({ applied: false });
    // D1 migrations use defer_foreign_keys for table rebuilds, not foreign_keys=OFF.
    const prepared = statements
      .filter((sql) => !/^\s*PRAGMA\s+foreign_keys\s*=/i.test(sql))
      .map((sql) => env.DB.prepare(sql));
    await env.DB.batch([
      env.DB.prepare("PRAGMA defer_foreign_keys=ON"),
      ...prepared,
      env.DB.prepare(
        "INSERT INTO savia_flows_migrations(name, applied_at) VALUES (?, ?)",
      ).bind(name, new Date().toISOString()),
    ]);
    return Response.json({ applied: true });
  },
};
