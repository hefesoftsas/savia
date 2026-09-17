import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { importVariables } from "./import-savia-request-variables.mjs";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE flows(id TEXT PRIMARY KEY,definition TEXT); INSERT INTO flows VALUES('quote','{}'); CREATE TABLE flow_variables(flow_id TEXT,key TEXT,value TEXT,secret INTEGER,PRIMARY KEY(flow_id,key)); INSERT INTO flow_variables VALUES('quote','existing','production-value',1),('quote','empty','',1)",
  );
  const query = async (sql, params = []) => db.prepare(sql).all(...params);
  return { db, query };
}
const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const flows = [
  {
    flowId: "quote",
    variables: [
      { key: "existing", value: "local-value", secret: true },
      { key: "empty", value: "private-value", secret: false },
      { key: "endpoint", value: "https://provider.test", secret: false },
    ],
  },
];

test("imports missing values, encrypts existing secret slots, and preserves production values on rerun", async () => {
  const { db, query } = fixture();
  try {
    assert.deepEqual(await importVariables({ query, flows, encryptionKey }), {
      flows: 1,
      imported: 2,
      preserved: 1,
    });
    assert.equal(
      db.prepare("SELECT value FROM flow_variables WHERE key='existing'").get()
        .value,
      "production-value",
    );
    const secret = db
      .prepare("SELECT value,secret FROM flow_variables WHERE key='empty'")
      .get();
    assert.equal(secret.secret, 1);
    assert.notEqual(secret.value, "private-value");
    const [iv, ciphertext] = secret.value
      .split(".")
      .map((x) => Buffer.from(x, "base64"));
    const key = await webcrypto.subtle.importKey(
      "raw",
      Buffer.from(encryptionKey, "base64"),
      "AES-GCM",
      false,
      ["decrypt"],
    );
    assert.equal(
      new TextDecoder().decode(
        await webcrypto.subtle.decrypt(
          { name: "AES-GCM", iv },
          key,
          ciphertext,
        ),
      ),
      "private-value",
    );
    assert.equal(
      db.prepare("SELECT value FROM flow_variables WHERE key='endpoint'").get()
        .value,
      "https://provider.test",
    );
    assert.deepEqual(await importVariables({ query, flows, encryptionKey }), {
      flows: 1,
      imported: 0,
      preserved: 3,
    });
  } finally {
    db.close();
  }
});

test("rejects missing flows and invalid input before any write", async () => {
  const { db, query } = fixture();
  try {
    await assert.rejects(
      importVariables({
        query,
        flows: [...flows, { flowId: "missing", variables: [] }],
        encryptionKey,
      }),
      /Missing flow/,
    );
    await assert.rejects(
      importVariables({ query, flows, encryptionKey: "bad" }),
      /32 bytes/,
    );
    await assert.rejects(
      importVariables({
        query,
        flows: [
          {
            flowId: "quote",
            variables: [{ key: "bad", value: 42, secret: true }],
          },
        ],
        encryptionKey,
      }),
      /Invalid variable/,
    );
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM flow_variables").get().n,
      2,
    );
  } finally {
    db.close();
  }
});
