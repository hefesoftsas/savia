import fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { AuthoringController, type AuthoringUi } from "../src/controller";
import { PluginTreeProvider } from "../src/tree";
import { PublishedSourceProvider } from "../src/documents";
import { authoringFixture, testBundles, rootUri } from "./authoring-fixtures";
let f: Awaited<ReturnType<typeof authoringFixture>> | undefined;
afterEach(async () => {
  await f?.dispose();
  f = undefined;
});
async function setup(overrides: Partial<AuthoringUi> = {}) {
  f = await authoringFixture();
  const notices: { code: string; values?: Record<string, string> }[] = [];
  let confirmations = 0;
  let rootChoices = 0;
  const ui: AuthoringUi = {
    isTrusted: () => true,
    projectRoots: () => [f!.uri],
    saveAll: async () => true,
    pickRoot: async (roots) => {
      rootChoices++;
      return roots[0];
    },
    chooseDestination: async () => "tenant",
    chooseVersion: async () => "1.1.0",
    confirmPublication: async () => {
      confirmations++;
      return true;
    },
    diagnostics: () => {},
    pickPlugin: async (catalog) => catalog[0]?.pluginId,
    pickFile: async (files) => files[0]?.path,
    chooseFolder: async () => undefined,
    openFile: async () => {},
    openVirtual: async () => {},
    showDiff: async () => {},
    chooseAttempt: async (attempts) => attempts[0]?.sha256,
    notify: async (code, values) => {
      notices.push({ code, values });
    },
    ...overrides,
  };
  const tree = new PluginTreeProvider();
  const documents = new PublishedSourceProvider();
  const controller = new AuthoringController(
    f.manager,
    tree,
    documents,
    await testBundles(),
    ui,
  );
  return {
    controller,
    ui,
    tree,
    documents,
    notices,
    get confirmations() {
      return confirmations;
    },
    get rootChoices() {
      return rootChoices;
    },
  };
}
it("refreshes remote metadata without replacing local edits", async () => {
  const { controller, tree } = await setup();
  await fs.writeFile(join(f!.root, "entry.tsx"), "local unsent edit");
  await controller.refresh();
  expect(tree.getChildren()[0].pluginId).toBe("custom.example");
  expect(await fs.readFile(join(f!.root, "entry.tsx"), "utf8")).toBe(
    "local unsent edit",
  );
});
it.each(["root", "target", "version", "confirmation"])(
  "cancels publication at the %s choice without an HTTP write",
  async (cancel) => {
    const extra = rootUri("/unselected-root");
    const context = await setup({
      ...(cancel === "root"
        ? {
            projectRoots: () => [f!.uri, extra],
            pickRoot: async () => undefined,
          }
        : {}),
      ...(cancel === "target"
        ? { chooseDestination: async () => undefined }
        : {}),
      ...(cancel === "version" ? { chooseVersion: async () => undefined } : {}),
      ...(cancel === "confirmation"
        ? { confirmPublication: async () => false }
        : {}),
    });
    await context.controller.publish();
    expect(f!.state.posts).toEqual([]);
  },
);
it("requires a root choice for a multi-root workspace and shows the confirmed version and outcome", async () => {
  const context = await setup({
    projectRoots: () => [f!.uri, rootUri("/other-project")],
  });
  await context.controller.publish();
  expect(context.rootChoices).toBe(1);
  expect(context.confirmations).toBe(1);
  expect(f!.state.posts[0].metadata.version).toBe("1.1.0");
  expect(context.notices.some((notice) => notice.code === "published")).toBe(
    true,
  );
});
it("rejects a changed head before transmission and preserves both sources and the descriptor", async () => {
  const context = await setup();
  f!.state.head = { version: "1.0.1", sha256: "c".repeat(64) };
  const before = await fs.readFile(join(f!.root, ".savia/plugin.json"), "utf8");
  await expect(context.controller.publish()).rejects.toThrow("head");
  expect(f!.state.posts).toEqual([]);
  expect(await fs.readFile(join(f!.root, ".savia/plugin.json"), "utf8")).toBe(
    before,
  );
});
it("does not send an old confirmation after the connection is disconnected", async () => {
  const context = await setup({
    confirmPublication: async () => {
      await f!.manager.disconnect();
      return true;
    },
  });
  await expect(context.controller.publish()).rejects.toThrow("connection");
  expect(f!.state.posts).toEqual([]);
});
it("keeps unbuildable newer edits while recovering the prior immutable publication", async () => {
  const context = await setup();
  f!.state.lost = true;
  await expect(context.controller.publish()).rejects.toThrow();
  await fs.writeFile(join(f!.root, "entry.tsx"), "newer broken edit (");
  await context.controller.recover();
  expect(f!.state.posts[1].bytes).toEqual(f!.state.posts[0].bytes);
  expect(await fs.readFile(join(f!.root, "entry.tsx"), "utf8")).toBe(
    "newer broken edit (",
  );
});

it("compares the latest server source after a conflict without replacing local edits", async () => {
  let comparedUri = "";
  const context = await setup({
    pickFile: async (files) =>
      files.find((file) => file.path === "entry.tsx")?.path,
    showDiff: async (uri) => {
      comparedUri = uri;
    },
  });
  const old = f!.snapshots.get("1.0.0")!;
  f!.state.head = { version: "1.0.1", sha256: "c".repeat(64) };
  f!.snapshots.set("1.0.1", {
    ...old,
    sourceVersion: "1.0.1",
    head: f!.state.head,
    files: { ...old.files, "entry.tsx": "new server source" },
  });
  await fs.writeFile(join(f!.root, "entry.tsx"), "local changes");
  await context.controller.compare();
  expect(comparedUri).toContain("/1.0.1/");
  expect(await fs.readFile(join(f!.root, "entry.tsx"), "utf8")).toBe(
    "local changes",
  );
});
it("does not select credentials from a tampered project origin", async () => {
  const context = await setup();
  const path = join(f!.root, ".savia/plugin.json");
  const descriptor = JSON.parse(await fs.readFile(path, "utf8"));
  await fs.writeFile(
    path,
    JSON.stringify({ ...descriptor, origin: "https://untrusted.test" }),
  );
  await expect(context.controller.publish()).rejects.toThrow("connection");
  expect(f!.state.posts).toEqual([]);
});
