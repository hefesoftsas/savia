import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";
import { createApp, openApiDocument } from "../../api/src/app";
const app = createApp({} as D1Database);
const document = app.getOpenAPI31Document(openApiDocument);
const outputUrl = new URL("../src/api/generated/openapi.ts", import.meta.url);
const outputPath = fileURLToPath(outputUrl);
const ast = await openapiTS(document);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, astToString(ast));
