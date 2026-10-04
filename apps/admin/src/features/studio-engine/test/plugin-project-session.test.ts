import { expect, it, vi } from "vitest";
import { PluginProjectSession } from "../plugin-project-session";
const draft = (code: string) => ({
  files: {
    "entry.tsx": code,
    "savia-extension.json": "{}",
    "store.json": "{}",
    "preview.json": "{}",
  },
  history: [],
});
it("serializes saves and carries the new version into changes typed during an in-flight save", async () => {
  let finish!: (data: { version: number }) => void;
  const save = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ version: 3 });
  const recover = vi.fn();
  const session = new PluginProjectSession(
    1,
    draft("one"),
    save,
    recover,
    vi.fn(),
  );
  session.update(draft("two"));
  const pending = session.flush();
  session.update(draft("three"));
  finish({ version: 2 });
  await pending;
  expect(
    save.mock.calls.map(([input]) => [input.version, input.files["entry.tsx"]]),
  ).toEqual([
    [1, "two"],
    [2, "three"],
  ]);
  expect(session.isSaved).toBe(true);
  session.dispose();
});
it("retains recovery content and does not overwrite a conflicted version", async () => {
  const save = vi
    .fn()
    .mockRejectedValue(Object.assign(new Error("Conflict"), { status: 409 }));
  const recover = vi.fn();
  const session = new PluginProjectSession(
    2,
    draft("one"),
    save,
    recover,
    vi.fn(),
  );
  session.update(draft("unsaved"));
  await expect(session.flush()).rejects.toThrow("Conflict");
  expect(session.isSaved).toBe(false);
  expect(recover).toHaveBeenLastCalledWith({ ...draft("unsaved"), version: 2 });
  expect(save).toHaveBeenCalledTimes(1);
  session.dispose();
});
