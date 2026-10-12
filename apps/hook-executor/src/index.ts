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
import { WorkerEntrypoint } from "cloudflare:workers";
import { createFlowExecutor, type FlowToolDispatcher } from "./flow-executor";

let engine: ReturnType<typeof newQuickJSWASMModuleFromVariant> | undefined;
const loadEngine = () => {
  engine ??= newQuickJSWASMModuleFromVariant(
    newVariant(variant, { wasmModule: wasm }),
  );
  return engine;
};

const execute = createQuickJSExecutor(loadEngine);
const executeFlow = createFlowExecutor(loadEngine);

/** Private named entrypoint; the default Request hook HTTP contract is unchanged. */
export class FlowsExecutor extends WorkerEntrypoint {
  execute(
    code: string,
    dispatcher: FlowToolDispatcher,
    options?: { timeoutMs?: number },
  ) {
    return executeFlow(code, dispatcher, options);
  }
}

export default createHandler(execute);
