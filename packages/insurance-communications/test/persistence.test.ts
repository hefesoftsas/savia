import { it, expect, vi } from "vitest";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import { saveIntegrationRecord } from "../src/persistence";
it("updates existing drafts with the displayed record version", async () => {
  const update = vi.fn(async () => ({ id: "draft", _version: 4 }));
  const savia = {
    collections: { collection: () => ({ update }) },
  } as unknown as PluginApi;
  await saveIntegrationRecord(
    savia,
    "insurance_communications",
    { title: "Draft" },
    { id: "draft", _version: 3 },
  );
  expect(update).toHaveBeenCalledWith(
    "draft",
    { title: "Draft" },
    { version: 3 },
  );
});
it("does not silently update when the displayed version is absent", async () => {
  const update = vi.fn();
  const savia = {
    collections: { collection: () => ({ update }) },
  } as unknown as PluginApi;
  await expect(
    saveIntegrationRecord(savia, "insurance_calendar", {}, { id: "event" }),
  ).rejects.toThrow("versión");
  expect(update).not.toHaveBeenCalled();
});
import { newMessage } from "../src/domain";
it("starts new messages without recipient consent or source metadata", () => {
  const fresh = newMessage();
  expect(fresh).toMatchObject({ recipient: "", consent: false, metadata: {} });
  fresh.metadata.clientId = "old";
  expect(newMessage().metadata).toEqual({});
});
