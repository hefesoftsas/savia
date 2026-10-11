import { pluginEditorTypeScriptLibraries } from "./plugin-editor-typescript-libraries";
import {
  createPluginEditorTypeScriptService,
  type PluginEditorFileMap,
} from "./plugin-editor-typescript-service";

type CompleteRequest = {
  id: number;
  files: PluginEditorFileMap;
  path: string;
  offset: number;
};

type WorkerResponse =
  | {
      id: number;
      entries: ReturnType<
        ReturnType<typeof createPluginEditorTypeScriptService>["complete"]
      >;
    }
  | { id: number; error: string };

type PluginEditorWorkerScope = {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<CompleteRequest>) => void,
  ): void;
  postMessage(response: WorkerResponse): void;
};

const service = createPluginEditorTypeScriptService({
  libraries: pluginEditorTypeScriptLibraries,
});
const workerScope = self as unknown as PluginEditorWorkerScope;

workerScope.addEventListener(
  "message",
  (event: MessageEvent<CompleteRequest>) => {
    const { id, files, path, offset } = event.data;
    let response: WorkerResponse;
    try {
      service.updateFiles(files);
      response = { id, entries: service.complete(path, offset) };
    } catch (error) {
      response = {
        id,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    workerScope.postMessage(response);
  },
);
