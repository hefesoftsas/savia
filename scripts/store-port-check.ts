import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  pluginStoreManifestSchema,
  storeJsonSchema,
} from "../packages/crm-shared/src/plugin-store";

/** Valida un port con los schemas reales. Imprime JSON. */
const [portDir] = process.argv.slice(2);
const errors: string[] = [];
let id = "";
let version = "";
try {
  const manifest = JSON.parse(
    readFileSync(join(portDir, "savia-extension.json"), "utf8"),
  );
  const parsed = pluginStoreManifestSchema.parse(manifest);
  id = parsed.id;
  version = parsed.version;
} catch (error) {
  errors.push(
    `manifiesto: ${error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)}`,
  );
}
const storePath = join(portDir, "store.json");
if (existsSync(storePath)) {
  try {
    storeJsonSchema.parse(JSON.parse(readFileSync(storePath, "utf8")));
  } catch (error) {
    errors.push(
      `store.json: ${error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)}`,
    );
  }
}
console.log(JSON.stringify({ id, version, errors }));
