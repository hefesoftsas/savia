import fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  preparePublication,
  publishPrepared,
  recoverPublication,
  listPublicationAttempts,
} from "../src/publication";
import { authoringFixture, testBundles } from "./authoring-fixtures";
let f: Awaited<ReturnType<typeof authoringFixture>> | undefined;
afterEach(async () => {
  await f?.dispose();
  f = undefined;
});
const options = {
  isTrusted: () => true,
  saveAll: async () => true,
  diagnostics: () => {},
};
async function prepared(destination: "tenant" | "shared" = "tenant") {
  f = await authoringFixture();
  await fs.writeFile(
    join(f.root, "entry.tsx"),
    'export function render(el) { el.textContent="Edited"; }',
  );
  return preparePublication(
    f.uri,
    f.connection.profile,
    await testBundles(),
    { destination, version: "1.1.0" },
    options,
  );
}
it("retains the immutable artifact before HTTP publication and confirms its exact receipt", async () => {
  const publication = await prepared();
  f!.state.onPublish = async (_metadata, bytes) => {
    expect(
      new Uint8Array(
        await fs.readFile(
          join(f!.root, ".savia/artifacts", publication!.sha256 + ".zip"),
        ),
      ),
    ).toEqual(bytes);
  };
  const outcome = await publishPrepared(publication!, f!.connection.client, {
    isTrusted: () => true,
    isCurrent: () => f!.manager.current === f!.connection,
  });
  expect(outcome.receipt).toMatchObject({
    state: "published",
    local: { version: "1.1.0", sha256: publication!.sha256 },
  });
  expect(await fs.readFile(join(f!.root, "entry.tsx"), "utf8")).toContain(
    "Edited",
  );
  expect(
    (await listPublicationAttempts(f!.uri, f!.connection.profile))[0].receipt
      ?.state,
  ).toBe("published");
});
it("keeps edits and the baseline unchanged after server head rejection", async () => {
  const publication = await prepared();
  f!.state.reject = 409;
  const descriptor = await fs.readFile(
    join(f!.root, ".savia/plugin.json"),
    "utf8",
  );
  await expect(
    publishPrepared(publication!, f!.connection.client, {
      isTrusted: () => true,
      isCurrent: () => true,
    }),
  ).rejects.toThrow("changed");
  expect(await fs.readFile(join(f!.root, ".savia/plugin.json"), "utf8")).toBe(
    descriptor,
  );
  expect(await fs.readFile(join(f!.root, "entry.tsx"), "utf8")).toContain(
    "Edited",
  );
});
it("does not transmit after a connection switch or trust removal", async () => {
  const publication = await prepared();
  await expect(
    publishPrepared(publication!, f!.connection.client, {
      isTrusted: () => true,
      isCurrent: () => false,
    }),
  ).rejects.toThrow("connection");
  await expect(
    publishPrepared(publication!, f!.connection.client, {
      isTrusted: () => false,
      isCurrent: () => true,
    }),
  ).rejects.toThrow("trusted");
  expect(f!.state.posts).toEqual([]);
});
it("recovers a lost response from the unchanged retained ZIP even after further local edits", async () => {
  const publication = await prepared();
  f!.state.lost = true;
  await expect(
    publishPrepared(publication!, f!.connection.client, {
      isTrusted: () => true,
      isCurrent: () => true,
    }),
  ).rejects.toThrow();
  await fs.writeFile(
    join(f!.root, "entry.tsx"),
    'export function render(el) { el.textContent="Newer unsent edit"; }',
  );
  const attempt = (
    await listPublicationAttempts(f!.uri, f!.connection.profile)
  )[0];
  expect(attempt.state).toBe("uncertain");
  const outcome = await recoverPublication(
    f!.uri,
    f!.connection.profile,
    attempt.sha256,
    f!.connection.client,
    { isTrusted: () => true, isCurrent: () => true },
  );
  expect(outcome.receipt.state).toBe("published");
  expect(f!.state.posts[1].bytes).toEqual(f!.state.posts[0].bytes);
  expect(await fs.readFile(join(f!.root, "entry.tsx"), "utf8")).toContain(
    "Newer unsent edit",
  );
});
it("retries shared partial publication with retry-shared metadata and no recompile", async () => {
  const publication = await prepared("shared");
  f!.state.sharedPending = true;
  expect(
    (
      await publishPrepared(publication!, f!.connection.client, {
        isTrusted: () => true,
        isCurrent: () => true,
      })
    ).receipt.state,
  ).toBe("shared-pending");
  await fs.writeFile(join(f!.root, "entry.tsx"), "broken newer edit (");
  f!.state.sharedPending = false;
  const outcome = await recoverPublication(
    f!.uri,
    f!.connection.profile,
    publication!.sha256,
    f!.connection.client,
    { isTrusted: () => true, isCurrent: () => true },
  );
  expect(outcome.receipt.state).toBe("published");
  expect(f!.state.posts[1].metadata.mode).toBe("retry-shared");
  expect(f!.state.posts[1].bytes).toEqual(publication!.zipBytes);
});

it("recovers a retained ZIP even when the current manifest is incomplete", async () => {
  const publication = await prepared();
  f!.state.lost = true;
  await expect(
    publishPrepared(publication!, f!.connection.client, {
      isTrusted: () => true,
      isCurrent: () => true,
    }),
  ).rejects.toThrow();
  await fs.writeFile(
    join(f!.root, "savia-extension.json"),
    "{ incomplete JSON",
  );
  const outcome = await recoverPublication(
    f!.uri,
    f!.connection.profile,
    publication!.sha256,
    f!.connection.client,
    { isTrusted: () => true, isCurrent: () => true },
  );
  expect(outcome.receipt.state).toBe("published");
  expect(await fs.readFile(join(f!.root, "savia-extension.json"), "utf8")).toBe(
    "{ incomplete JSON",
  );
});

it("reports server success separately when writing the local receipt fails", async () => {
  const publication = await prepared();
  f!.state.onPublish = async () => {
    await fs.chmod(join(f!.root, ".savia/receipts"), 0o500);
  };
  try {
    const outcome = await publishPrepared(publication!, f!.connection.client, {
      isTrusted: () => true,
      isCurrent: () => true,
    });
    expect(outcome.receipt.state).toBe("published");
    expect(outcome.receiptSaved).toBe(false);
  } finally {
    await fs.chmod(join(f!.root, ".savia/receipts"), 0o700);
  }
});

it("keeps gateway and server errors recoverable from the exact retained artifact", async () => {
  const publication = await prepared();
  f!.state.reject = 502;
  await expect(
    publishPrepared(publication!, f!.connection.client, {
      isTrusted: () => true,
      isCurrent: () => true,
    }),
  ).rejects.toThrow();
  const attempt = (
    await listPublicationAttempts(f!.uri, f!.connection.profile)
  )[0];
  expect(attempt.state).toBe("uncertain");
  f!.state.reject = 0;
  const result = await recoverPublication(
    f!.uri,
    f!.connection.profile,
    attempt.sha256,
    f!.connection.client,
    { isTrusted: () => true, isCurrent: () => true },
  );
  expect(result.receipt.state).toBe("published");
  expect(f!.state.posts[1].bytes).toEqual(publication!.zipBytes);
});

it("retries uncertain shared creation even when the first request never persisted locally", async () => {
  const publication = await prepared("shared");
  f!.state.onPublish = async () => {
    throw new Error("Request never arrived");
  };
  await expect(
    publishPrepared(publication!, f!.connection.client, {
      isTrusted: () => true,
      isCurrent: () => true,
    }),
  ).rejects.toThrow();
  expect(f!.state.head.version).toBe("1.0.0");
  f!.state.onPublish = undefined;
  await recoverPublication(
    f!.uri,
    f!.connection.profile,
    publication!.sha256,
    f!.connection.client,
    { isTrusted: () => true, isCurrent: () => true },
  );
  expect(f!.state.posts[1].metadata.mode).toBe("create");
  expect(f!.state.posts[1].bytes).toEqual(publication!.zipBytes);
});

it("recovers a committed shared attempt after permissions are removed before the shared write", async () => {
  const publication = await prepared("shared");
  f!.state.permissionLostAfterCommit = true;
  await expect(
    publishPrepared(publication!, f!.connection.client, {
      isTrusted: () => true,
      isCurrent: () => true,
    }),
  ).rejects.toThrow("permission");
  expect(f!.state.head.version).toBe("1.1.0");
  const attempt = (
    await listPublicationAttempts(f!.uri, f!.connection.profile)
  )[0];
  expect(attempt.state).toBe("uncertain");
  f!.state.permissionLostAfterCommit = false;
  const recovered = await recoverPublication(
    f!.uri,
    f!.connection.profile,
    publication!.sha256,
    f!.connection.client,
    { isTrusted: () => true, isCurrent: () => true },
  );
  expect(recovered.receipt.state).toBe("published");
  expect(f!.state.posts[1].metadata.mode).toBe("create");
  expect(f!.state.posts[1].bytes).toEqual(publication!.zipBytes);
});
