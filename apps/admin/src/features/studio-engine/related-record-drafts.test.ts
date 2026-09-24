import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import {
  createRelatedRecordDraft,
  clearRelatedRecordDrafts,
} from "./related-record-drafts";
const environment = "draft-test";
const workspaceScope = (
  user = "user",
  tenant = "tenant",
  permissions = "operator",
) =>
  JSON.stringify([
    JSON.stringify([environment, user]),
    `/api/tenants/${tenant}/crm`,
    { role: permissions },
  ]);
const scope = {
  workspaceScope: workspaceScope(),
  object: "contacts",
  recordId: "1",
};
afterEach(async () => {
  await clearRelatedRecordDrafts(environment);
  vi.restoreAllMocks();
});
it("restores parent and child versions after close and reopening", async () => {
  const draft = createRelatedRecordDraft(scope);
  const value = {
    values: { name: "Edited" },
    version: 3,
    relations: [{ id: "child", version: 2, data: { name: "Child" } }],
  };
  draft.schedule(value);
  await draft.close();
  expect((await createRelatedRecordDraft(scope).read())?.value).toEqual(value);
});
it("isolates every identity, collection and record dimension", async () => {
  const draft = createRelatedRecordDraft(scope);
  draft.schedule({ name: "Private" });
  await draft.flush();
  for (const changed of [
    { workspaceScope: workspaceScope("other") },
    { workspaceScope: workspaceScope("user", "other") },
    { workspaceScope: workspaceScope("user", "tenant", "other") },
    { object: "other" },
    { recordId: "other" },
  ]) {
    expect(
      await createRelatedRecordDraft({ ...scope, ...changed }).read(),
    ).toBeUndefined();
  }
  expect(
    await createRelatedRecordDraft({ ...scope, recordId: undefined }).read(),
  ).toBeUndefined();
});
it("clear wins over queued writes and pending debounce", async () => {
  const draft = createRelatedRecordDraft(scope);
  draft.schedule({ name: "first" });
  const writing = draft.flush();
  draft.schedule({ name: "second" });
  await draft.clear();
  await writing;
  await draft.close();
  expect(await createRelatedRecordDraft(scope).read()).toBeUndefined();
});
it("coalesces updates and snapshots mutable input", async () => {
  const draft = createRelatedRecordDraft(scope);
  const value = { name: "final" };
  draft.schedule({ name: "old" });
  draft.schedule(value);
  value.name = "mutated";
  await draft.flush();
  expect((await draft.read())?.value).toEqual({ name: "final" });
});
it("warns on persistence failure without rejecting or dropping editing", async () => {
  const warning = vi.fn();
  const draft = createRelatedRecordDraft(scope, warning);
  await draft.read();
  const failure = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
  draft.schedule({ name: "unsaved" });
  await expect(draft.flush()).resolves.toBeUndefined();
  expect(warning).toHaveBeenCalled();
  failure.mockRestore();
  draft.schedule({ name: "retry" });
  await draft.flush();
  expect((await draft.read())?.value).toEqual({ name: "retry" });
});
it("logout prevents a mounted form from recreating cleared drafts", async () => {
  const draft = createRelatedRecordDraft(scope);
  draft.schedule({ name: "before logout" });
  await clearRelatedRecordDrafts(environment);
  draft.schedule({ name: "late" });
  await draft.close();
  expect(await createRelatedRecordDraft(scope).read()).toBeUndefined();
});
it("rejects incomplete authenticated scopes", () => {
  expect(() =>
    createRelatedRecordDraft({
      ...scope,
      workspaceScope: JSON.stringify([
        JSON.stringify([environment, ""]),
        "/api/crm",
        {},
      ]),
    }),
  ).toThrow("authenticated workspace");
});
it("debounces writes without requiring the form to close", async () => {
  const draft = createRelatedRecordDraft(scope, undefined, 10);
  draft.schedule({ name: "typing" });
  draft.schedule({ name: "complete" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect((await createRelatedRecordDraft(scope).read())?.value).toEqual({
    name: "complete",
  });
  await draft.close();
});
it("waits for an outgoing form's flush before reopening the same draft", async () => {
  const outgoing = createRelatedRecordDraft(scope);
  outgoing.schedule({ name: "last keystroke" });
  const closing = outgoing.close();
  const reopened = createRelatedRecordDraft(scope);
  expect((await reopened.read())?.value).toEqual({ name: "last keystroke" });
  await closing;
  await reopened.clear();
  await reopened.close();
});

it("does not let an old successful save erase a reopened form's newer draft", async () => {
  const first = createRelatedRecordDraft(scope);
  first.schedule({ name: "request in flight" });
  await first.flush();
  const second = createRelatedRecordDraft(scope);
  await second.read();
  second.schedule({ name: "newer changes" });
  await second.flush();
  await first.clear();
  expect((await second.read())?.value).toEqual({ name: "newer changes" });
  await first.close();
  await second.close();
});
