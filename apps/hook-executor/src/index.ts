import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
} from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-wasmfile-release-sync";
// Wrangler's module collector needs the actual .wasm suffix, not the package's
// extensionless /wasm export. This asset stays pinned with the npm dependency.
import wasm from "../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm";
import { createQuickJSExecutor } from "./executor";
import { createHandler } from "./handler";

let engine: ReturnType<typeof newQuickJSWASMModuleFromVariant> | undefined;
const execute = createQuickJSExecutor(() => {
  engine ??= newQuickJSWASMModuleFromVariant(
    newVariant(variant, { wasmModule: wasm }),
  );
  return engine;
});

export default createHandler(execute);
