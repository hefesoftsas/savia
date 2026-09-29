// Local benchmark adapter: execute the actual Studio routes with synthetic identity.
// Never deploy this worker. OAuth/ACL evaluation and external integrations are excluded.
import { createStudioApp } from "../../packages/studio-server/src/index";
let app: ReturnType<typeof createStudioApp>;
export default {
  async fetch(request: Request, env: any) {
    app ??= createStudioApp("900001", {
      principalId: "stress-principal",
      seedObjects: [],
    });
    const input: any = await request.json();
    const queries: any[] = [];
    const statements = new WeakMap<object, any>();
    function wrap(statement: any, sql: string, args: any[] = []): any {
      const proxy = new Proxy(statement, {
        get(target, key) {
          if (key === "bind")
            return (...values: any[]) =>
              wrap(target.bind(...values), sql, values);
          if (key === "first")
            return async (column?: string) => {
              const row = await target.first(column);
              queries.push({ sql, args, metaUnavailable: true });
              return row;
            };
          if (key === "all" || key === "run")
            return async () => {
              const result = await target[key]();
              queries.push({ sql, args, meta: result.meta });
              return result;
            };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      statements.set(proxy, { statement, sql, args });
      return proxy;
    }
    const db = new Proxy(env.DB, {
      get(target, key) {
        if (key === "prepare")
          return (sql: string) => wrap(target.prepare(sql), sql);
        if (key === "batch")
          return async (items: any[]) => {
            const info = items.map((s) => statements.get(s));
            const results = await target.batch(
              items.map((s, i) => info[i]?.statement ?? s),
            );
            results.forEach((r: any, i: number) =>
              queries.push({ ...info[i], statement: undefined, meta: r.meta }),
            );
            return results;
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const started = performance.now();
    const response = await app.fetch(
      new Request("http://127.0.0.1" + input.path, {
        method: input.method ?? "GET",
        headers: { "Content-Type": "application/json" },
        body: input.body ? JSON.stringify(input.body) : undefined,
      }),
      { ...env, DB: db },
    );
    const body = await response.json();
    return Response.json({
      status: response.status,
      body,
      workerMs: performance.now() - started,
      queries,
    });
  },
};
