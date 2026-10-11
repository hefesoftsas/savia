import "@codingame/monaco-vscode-extension-api/localExtensionHost";
import {
  initialize,
  getService,
  IFileService,
} from "@codingame/monaco-vscode-api";
import { VSBuffer } from "@codingame/monaco-vscode-api/vscode/vs/base/common/buffer";
import { createModelReference } from "@codingame/monaco-vscode-api/monaco";
import {
  registerExtension,
  ExtensionHostKind,
} from "@codingame/monaco-vscode-api/extensions";
import * as monaco from "@codingame/monaco-vscode-editor-api";
import getKeybindings from "@codingame/monaco-vscode-keybindings-service-override";
import getConfiguration from "@codingame/monaco-vscode-configuration-service-override";
import "@codingame/monaco-vscode-editor-api/esm/vs/editor/browser/coreCommands";
import "@codingame/monaco-vscode-api/vscode/vs/editor/contrib/suggest/browser/suggestController";
import "@codingame/monaco-vscode-editor-api/esm/vs/editor/contrib/inlineCompletions/browser/inlineCompletions.contribution";
import getModels from "@codingame/monaco-vscode-model-service-override";
import getLanguages from "@codingame/monaco-vscode-languages-service-override";
import getTheme from "@codingame/monaco-vscode-theme-service-override";
import "@codingame/monaco-vscode-theme-defaults-default-extension";
import getTextmate from "@codingame/monaco-vscode-textmate-service-override";
import getExtensions from "@codingame/monaco-vscode-extensions-service-override";
import "@codingame/monaco-vscode-typescript-basics-default-extension";
import "@codingame/monaco-vscode-json-default-extension";
import EditorWorker from "@codingame/monaco-vscode-editor-api/esm/vs/editor/editor.worker?worker";
import TextmateWorker from "@codingame/monaco-vscode-textmate-service-override/worker?worker";
import {
  editorStateSchema,
  projectFileUri,
  type EditorState,
} from "./plugin-vscode-protocol";
import { PluginEditorTypescriptClient } from "./plugin-editor-typescript-client";
import { pluginIdeDeclarations } from "./plugin-ide-declarations";
import { formatPluginDocument } from "./plugin-editor-format";

const send = (data: unknown) =>
  window.parent.postMessage(data, location.origin);
let state: EditorState | undefined;
let editor: monaco.editor.IStandaloneCodeEditor;
let applying = false;
const documents = new Map<
  string,
  Awaited<ReturnType<typeof createModelReference>>
>();
const models = new Map<string, monaco.editor.ITextModel>();
const views = new Map<string, monaco.editor.ICodeEditorViewState | null>();
const installed = new Map<string, { dispose(): Promise<void> }>();
let activeFile = "";
let navigation = "";
let chain = Promise.resolve();
const completions = new Map<string, (value: string | null) => void>();
let sequence = 0;
const localEdits = new Map<string, number>();

function completionFiles() {
  const files = { ...state?.files };
  for (const [path, model] of models) {
    if (Object.hasOwn(files, path)) files[path] = model.getValue();
  }
  return files;
}

function language(path: string) {
  const ext = path.split(".").pop();
  return (
    (
      {
        tsx: "typescriptreact",
        ts: "typescript",
        jsx: "javascriptreact",
        js: "javascript",
        json: "json",
        css: "css",
        html: "html",
        svg: "html",
      } as Record<string, string>
    )[ext ?? ""] ?? "plaintext"
  );
}

async function extensions(ids: string[]) {
  for (const [id, extension] of installed) {
    if (!ids.includes(id)) {
      await extension.dispose();
      installed.delete(id);
    }
  }
  for (const id of ids) {
    if (installed.has(id)) continue;
    const extension = registerExtension(
      {
        name: id.split(".")[1],
        publisher: "savia",
        version: "1.0.0",
        engines: { vscode: "*" },
        browser: "extension.js",
        extensionKind: ["ui"],
      },
      ExtensionHostKind.LocalProcess,
    );
    const api = await extension.getApi();
    const selectors = [
      "typescript",
      "typescriptreact",
      "javascript",
      "javascriptreact",
      "json",
      "css",
      "html",
    ].map((language) => ({ language, scheme: "file" }));
    const provider =
      id === "savia.formatter"
        ? api.languages.registerDocumentFormattingEditProvider(selectors, {
            async provideDocumentFormattingEdits(document, _options, token) {
              if (state?.readOnly || token.isCancellationRequested) return [];
              const source = document.getText();
              const version = document.version;
              const value = await formatPluginDocument(
                source,
                document.languageId,
              );
              if (
                token.isCancellationRequested ||
                state?.readOnly ||
                document.version !== version
              )
                return [];
              return [
                api.TextEdit.replace(
                  new api.Range(
                    document.positionAt(0),
                    document.positionAt(source.length),
                  ),
                  value,
                ),
              ];
            },
          })
        : api.languages.registerCompletionItemProvider(selectors.slice(0, 4), {
            provideCompletionItems(document, position) {
              if (state?.readOnly) return [];
              const prefix = document
                .lineAt(position.line)
                .text.slice(0, position.character);
              if (/\.[$\w]*$/.test(prefix)) return [];
              const component = new api.CompletionItem(
                "sfc",
                api.CompletionItemKind.Snippet,
              );
              component.detail = "Savia React component";
              component.insertText = new api.SnippetString(
                "export function ${1:Component}() {\n  return <${2:div}>${3}</${2:div}>;\n}\n",
              );
              const hook = new api.CompletionItem(
                "useState",
                api.CompletionItemKind.Snippet,
              );
              hook.detail = "Savia React state";
              hook.insertText = new api.SnippetString(
                "const [${1:value}, ${2:setValue}] = React.useState(${3:initialValue});",
              );
              return [component, hook];
            },
          });
    installed.set(id, {
      async dispose() {
        provider.dispose();
        await extension.dispose();
      },
    });
  }
}

async function update(next: EditorState) {
  const previous = state;
  state = next;
  for (const [path, value] of Object.entries(next.files)) {
    if ((next.acknowledgements[path] ?? 0) >= (localEdits.get(path) ?? 0))
      localEdits.delete(path);
    if ((next.acknowledgements[path] ?? 0) < (localEdits.get(path) ?? 0))
      continue;
    if (
      previous?.files[path] === value &&
      models.get(path)?.getValue() === value
    )
      continue;
    const uri = monaco.Uri.parse(projectFileUri(path));
    const existing = models.get(path);
    if (!existing || existing.getValue() !== value) {
      const fileService = await getService(IFileService);
      await fileService.createFolder(
        uri.with({ path: uri.path.slice(0, uri.path.lastIndexOf("/")) }),
      );
      await fileService.writeFile(uri, VSBuffer.fromString(value));
      if (existing && existing.getValue() !== value && !localEdits.has(path)) {
        applying = true;
        existing.setValue(value);
        applying = false;
      }
    }
  }
  await extensions(next.extensions);
  for (const [path, reference] of documents) {
    if (!Object.hasOwn(next.files, path)) {
      if (activeFile === path) editor.setModel(null);
      reference.dispose();
      documents.delete(path);
      models.delete(path);
      views.delete(path);
      localEdits.delete(path);
    }
  }
  if (!Object.hasOwn(next.files, next.activeFile)) {
    editor.setModel(null);
    activeFile = "";
    editor.updateOptions({ readOnly: true, ariaLabel: next.activeFile });
    return;
  }
  if (!documents.has(next.activeFile)) {
    const reference = await createModelReference(
      monaco.Uri.parse(projectFileUri(next.activeFile)),
    );
    // The resolver declarations refer to the standalone monaco package, but
    // this iframe resolves models from the isolated VS Code model service.
    const model = reference.object
      .textEditorModel! as unknown as monaco.editor.ITextModel;
    monaco.editor.setModelLanguage(model, language(next.activeFile));
    const path = next.activeFile;
    model.onDidChangeContent(() => {
      if (!applying && !state?.readOnly) {
        localEdits.set(path, ++sequence);
        send({
          type: "savia-editor-change",
          path,
          value: model.getValue(),
          sequence,
        });
      }
    });
    documents.set(path, reference);
    models.set(path, model);
  }
  if (activeFile !== next.activeFile) {
    if (activeFile) views.set(activeFile, editor.saveViewState());
    activeFile = next.activeFile;
    editor.setModel(models.get(activeFile)!);
    editor.restoreViewState(views.get(activeFile) ?? null);
    editor.focus();
  }
  monaco.editor.setTheme(
    next.theme.isDark ? "Default Dark Modern" : "Default Light Modern",
  );
  editor.updateOptions({ readOnly: next.readOnly, ariaLabel: activeFile });
  const key = JSON.stringify([next.activeFile, next.selectionId]);
  if (next.selection && navigation !== key) {
    const range = {
      startLineNumber: next.selection.lineNumber,
      endLineNumber: next.selection.lineNumber,
      startColumn: next.selection.column,
      endColumn: next.selection.endColumn,
    };
    editor.setSelection(range);
    editor.revealRangeInCenter(range);
    editor.focus();
  }
  navigation = key;
}

async function start() {
  (window as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
    getWorker: (_id: string, label: string) =>
      label === "TextMateWorker" ? new TextmateWorker() : new EditorWorker(),
  };
  await initialize({
    ...getKeybindings(),
    ...getConfiguration(),
    ...getModels(),
    ...getLanguages(),
    ...getTextmate(),
    ...getTheme(),
    ...getExtensions(),
  });
  // The plugin bundle supplies these globals. Keep them in the isolated
  // language workspace, outside the files saved or published by the parent.
  const ambientUri = monaco.Uri.parse("file:///workspace/savia-globals.d.ts");
  const fileService = await getService(IFileService);
  await fileService.createFolder(ambientUri.with({ path: "/workspace" }));
  await fileService.writeFile(
    ambientUri,
    VSBuffer.fromString(pluginIdeDeclarations),
  );
  const ambient = await createModelReference(ambientUri);
  monaco.editor.setModelLanguage(
    ambient.object.textEditorModel! as unknown as monaco.editor.ITextModel,
    "typescript",
  );
  window.addEventListener("pagehide", () => ambient.dispose(), { once: true });
  const typescript = new PluginEditorTypescriptClient();
  const contextExtension = registerExtension(
    {
      name: "plugin-types",
      publisher: "savia",
      version: "1.0.0",
      engines: { vscode: "*" },
      extensionKind: ["ui"],
    },
    ExtensionHostKind.LocalProcess,
  );
  const contextApi = await contextExtension.getApi();
  const contextProvider = contextApi.languages.registerCompletionItemProvider(
    ["typescript", "typescriptreact", "javascript", "javascriptreact"].map(
      (language) => ({ language, scheme: "file" }),
    ),
    {
      async provideCompletionItems(document, position, token) {
        if (!state || state.readOnly || token.isCancellationRequested)
          return [];
        const version = document.version;
        const path = document.uri.path.replace(/^\/workspace\//, "");
        if (!Object.hasOwn(state.files, path)) return [];
        const files = completionFiles();
        files[path] = document.getText();
        const entries = await typescript.complete(
          files,
          path,
          document.offsetAt(position),
        );
        const currentFiles = completionFiles();
        if (
          token.isCancellationRequested ||
          state?.readOnly ||
          document.version !== version ||
          Object.keys(files).length !== Object.keys(currentFiles).length ||
          Object.entries(files).some(
            ([path, text]) => currentFiles[path] !== text,
          )
        )
          return [];
        const kinds: Record<string, number> = {
          method: contextApi.CompletionItemKind.Method,
          function: contextApi.CompletionItemKind.Function,
          property: contextApi.CompletionItemKind.Property,
          class: contextApi.CompletionItemKind.Class,
          interface: contextApi.CompletionItemKind.Interface,
          keyword: contextApi.CompletionItemKind.Keyword,
        };
        return entries.map((entry) => {
          const item = new contextApi.CompletionItem(
            entry.name,
            kinds[entry.kind] ?? contextApi.CompletionItemKind.Variable,
          );
          item.insertText = entry.insertText ?? entry.name;
          item.sortText = entry.sortText;
          item.range = document.getWordRangeAtPosition(position);
          return item;
        });
      },
    },
    ".",
  );
  window.addEventListener(
    "pagehide",
    () => {
      contextProvider.dispose();
      typescript.dispose();
      void contextExtension.dispose();
    },
    { once: true },
  );
  editor = monaco.editor.create(document.getElementById("editor")!, {
    automaticLayout: true,
    editContext: false,
    fontSize: 14,
    lineHeight: 22,
    minimap: { enabled: false },
    tabSize: 2,
    scrollBeyondLastLine: false,
    padding: { top: 8, bottom: 8 },
    readOnly: true,
  });
  monaco.languages.registerInlineCompletionsProvider(
    { scheme: "file", language: "typescriptreact" },
    {
      async provideInlineCompletions(model, position, _context, token) {
        if (
          activeFile !== "entry.tsx" ||
          state?.readOnly ||
          token.isCancellationRequested
        )
          return { items: [] };
        const offset = model.getOffsetAt(position);
        const source = model.getValue();
        const version = model.getVersionId();
        const requestId = crypto.randomUUID();
        const value = await new Promise<string | null>((resolve) => {
          const finish = (value: string | null) => {
            completions.delete(requestId);
            clearTimeout(timeout);
            resolve(value);
          };
          const timeout = setTimeout(() => finish(null), 10000);
          completions.set(requestId, finish);
          send({
            type: "savia-editor-completion",
            requestId,
            prefix: source.slice(Math.max(0, offset - 100000), offset),
            suffix: source.slice(offset, offset + 100000),
          });
        });
        if (
          !value ||
          token.isCancellationRequested ||
          state?.readOnly ||
          activeFile !== "entry.tsx" ||
          model.getVersionId() !== version
        )
          return { items: [] };
        return {
          items: [
            {
              insertText: value,
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column,
              ),
            },
          ],
        };
      },
      disposeInlineCompletions() {},
    },
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        event.stopPropagation();
        send({ type: "savia-editor-search" });
      }
    },
    true,
  );
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== location.origin)
      return;
    if (
      event.data?.type === "savia-editor-completion-result" &&
      typeof event.data.requestId === "string"
    ) {
      completions.get(event.data.requestId)?.(
        typeof event.data.value === "string" ? event.data.value : null,
      );
      return;
    }
    if (event.data?.type === "savia-editor-format") {
      chain = chain
        .then(async () => {
          if (state?.readOnly || !state?.extensions.includes("savia.formatter"))
            return;
          await editor.getAction("editor.action.formatDocument")?.run();
        })
        .catch((error) =>
          send({
            type: "savia-editor-error",
            message: String(error).slice(0, 2000),
          }),
        );
      return;
    }
    const result = editorStateSchema.safeParse(event.data);
    if (!result.success) return;
    chain = chain
      .then(() => update(result.data))
      .catch((error) => {
        console.error("Savia extension editor update failed", error);
        send({
          type: "savia-editor-error",
          message: String(error).slice(0, 2000),
        });
      });
  });
  send({ type: "savia-editor-ready" });
}
void start().catch((error) => {
  console.error("Savia extension editor initialization failed", error);
  send({ type: "savia-editor-error", message: String(error).slice(0, 2000) });
});
