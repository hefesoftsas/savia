import { beforeAll, afterAll, it, expect } from "vitest";
import { notificationFixture } from "./notifications-fixture";

let fixture: Awaited<ReturnType<typeof notificationFixture>>;

beforeAll(async () => {
  fixture = await notificationFixture();
});

afterAll(async () => {
  await fixture?.dispose();
});

it("arbitrates duplicate event identity and recipient delivery in the database", async () => {
  const db = fixture.db;
  const insert = () =>
    db
      .prepare(
        "INSERT INTO notification_events(id,scope_kind,scope_id,event_key,payload,created_at) VALUES ('e','workspace','w','k','{}',1000)",
      )
      .run();
  await insert();
  await expect(insert()).rejects.toThrow();
  await db
    .prepare(
      "INSERT INTO notification_deliveries(id,event_id,scope_kind,scope_id,recipient_id,created_at) VALUES ('d','e','workspace','w','alice',1000)",
    )
    .run();
  await expect(
    db
      .prepare(
        "INSERT INTO notification_deliveries(id,event_id,scope_kind,scope_id,recipient_id,created_at) VALUES ('d2','e','workspace','w','alice',1000)",
      )
      .run(),
  ).rejects.toThrow();
  expect(
    await db.prepare("SELECT COUNT(*) AS n FROM notification_deliveries").first("n"),
  ).toBe(1);
});
