import { expect, it } from "vitest";
import { ConnectionPools } from "../src/connection-pools";
it("isolates credentials and drains evicted leases", async () => {
  const closed: string[] = [];
  const pools = new ConnectionPools(
    async (key: string) => ({ key }),
    async (p) => {
      closed.push(p.key);
    },
    1,
  );
  let release!: () => void;
  const active = pools.use("reader", async () => {
    await new Promise<void>((r) => {
      release = r;
    });
  });
  await new Promise((r) => setTimeout(r, 0));
  await pools.use("writer", async (p) => expect(p.key).toBe("writer"));
  expect(closed).not.toContain("reader");
  release();
  await active;
  expect(closed).toContain("reader");
  await pools.close();
  expect(closed).toContain("writer");
});
