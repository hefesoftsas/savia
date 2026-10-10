import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import {
  createPluginProject,
  compilePluginProject,
  packagePluginProject,
  parsePluginProject,
  serializePluginProject,
  type IdeFiles,
} from "../plugin-ide-project";
import { PLUGIN_PROJECT_MAX_BYTES } from "@savia/studio-shared/plugin-projects";
import { createPluginPreviewDocument } from "../plugin-ide-preview";

function withEntry(entry: string): IdeFiles {
  return { ...createPluginProject(), "entry.tsx": entry };
}

describe("plugin IDE project", () => {
  it("creates a custom plugin project with a working counter starter", async () => {
    const project = createPluginProject();
    const manifest = JSON.parse(project["savia-extension.json"]);
    expect(manifest).toMatchObject({
      format: "savia.extension",
      formatVersion: 1,
      id: expect.stringMatching(/^custom\.plugin-[0-9a-f-]+$/),
      version: "1.0.0",
      apiVersion: 1,
    });
    expect(project["entry.tsx"]).toContain("export function render");
    expect(project["store.json"]).toContain('"format": "savia.store"');
    await expect(compilePluginProject(project)).resolves.toMatchObject({
      manifest,
      fixtures: { collections: {}, settings: {} },
    });
  });

  it("opens and compiles a retained runtime bundle larger than the authoring limit", async () => {
    const source = `/*${"compiled".repeat(20_000)}*/
export function render(element) { element.textContent = "Activities"; }`;
    const files = withEntry(source);
    expect(parsePluginProject(serializePluginProject(files))).toEqual(files);
    const compiled = await compilePluginProject(files);
    const render = new Function(
      `${compiled.entryJs.replace("export function render", "function render")}; return render;`,
    )();
    const element = document.createElement("div");
    render(element);
    expect(element.textContent).toBe("Activities");
  });

  it("compiles the real packaged activities release for editor preview", async () => {
    const directory = mkdtempSync(join(tmpdir(), "savia-ide-activities-"));
    const artifact = join(directory, "activities.zip");
    try {
      execFileSync(process.execPath, [
        resolve("../../scripts/pack-store-plugin.mjs"),
        "store-ports/activities",
        "--output",
        artifact,
      ]);
      const extract = (path: string) =>
        execFileSync("unzip", ["-p", artifact, path], {
          encoding: "utf8",
          maxBuffer: 3 * 1024 * 1024,
        });
      const files: IdeFiles = {
        "entry.tsx": extract("dist/plugin.js"),
        "original-source.json": extract("src/original-source.json"),
        "savia-extension.json": extract("savia-extension.json"),
        "store.json": extract("store.json"),
        "preview.json": '{"collections":{},"settings":{}}',
      };
      const compiled = await compilePluginProject(files);
      expect(compiled.manifest.id).toBe("insurance.activities");
      expect(compiled.entryJs).toContain("insurance_activities");
      const html = createPluginPreviewDocument(
        compiled.entryJs,
        compiled.fixtures,
        compiled.store,
        "activities-session",
        "es",
      );
      const dom = new JSDOM(html, {
        runScripts: "outside-only",
        pretendToBeVisual: true,
      });
      try {
        Object.assign(dom.window, { structuredClone });
        const executable =
          compiled.entryJs.replace(/export const /g, "const ") +
          "; return {render, renderPanel, widgets, screens};";
        dom.window.eval(`window.__testPlugin = (() => { ${executable} })();`);
        const script = dom.window.document
          .querySelector('script[type="module"]')!
          .textContent!.replace(
            /const sourceUrl = .*?\n\s*const plugin = await import\(sourceUrl\);\n\s*URL\.revokeObjectURL\(sourceUrl\);/s,
            "const plugin = window.__testPlugin;",
          );
        dom.window.eval(`window.__completion = (async () => { ${script} })();`);
        await (dom.window as unknown as { __completion: Promise<void> })
          .__completion;
        await vi.waitFor(() =>
          expect(
            dom.window.document.getElementById("root")!.textContent,
          ).toContain("Nueva actividad"),
        );
      } finally {
        dom.window.close();
      }

      expect(parsePluginProject(serializePluginProject(files))).toEqual(files);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60000);

  it("rebuilds every shipped plugin from its retained source graph", async () => {
    const directory = mkdtempSync(join(tmpdir(), "savia-source-builds-"));
    try {
      for (const port of readdirSync(resolve("../../store-ports"))) {
        const artifact = join(directory, `${port}.zip`);
        execFileSync(process.execPath, [
          resolve("../../scripts/pack-store-plugin.mjs"),
          `store-ports/${port}`,
          "--output",
          artifact,
        ]);
        const extract = (path: string) =>
          execFileSync("unzip", ["-p", artifact, path], {
            encoding: "utf8",
            maxBuffer: 4 * 1024 * 1024,
          });
        const source = extract("src/original-source.json");
        const compiled = await compilePluginProject({
          "entry.tsx": extract("dist/plugin.js"),
          "savia-extension.json": extract("savia-extension.json"),
          "store.json": extract("store.json"),
          "preview.json": '{"collections":{},"settings":{}}',
          "original-source.json": source,
        });
        expect(compiled.entryJs, port).toContain("__saviaModules");
        expect(
          new TextEncoder().encode(compiled.entryJs).length,
          port,
        ).toBeLessThan(2 * 1024 * 1024);
        const originals = JSON.parse(source);
        const entry = Object.keys(originals).find((name) =>
          /(?:^|\/)entry\.(tsx|jsx|js)$/.test(name),
        )!;
        const changed = {
          ...originals,
          [entry]:
            originals[entry] + "\n// Original source compilation verified.",
        };
        const edited = await compilePluginProject({
          "entry.tsx": extract("dist/plugin.js"),
          "savia-extension.json": extract("savia-extension.json"),
          "store.json": extract("store.json"),
          "preview.json": '{"collections":{},"settings":{}}',
          "original-source.json": JSON.stringify(changed),
        });
        expect(edited.entryJs, port).toContain(
          "Original source compilation verified.",
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 90000);

  it("rejects invalid metadata and entry source that imports or uses unsafe APIs", async () => {
    const project = createPluginProject();
    await expect(
      compilePluginProject({ ...project, "savia-extension.json": "{}" }),
    ).rejects.toThrow();
    await expect(
      compilePluginProject(
        withEntry(
          'import Thing from "https://example.com/thing.js"; export function render() {}',
        ),
      ),
    ).rejects.toThrow(/import/i);
    await expect(
      compilePluginProject(
        withEntry("export function render() { eval('1'); }"),
      ),
    ).rejects.toThrow(/eval/i);
  });

  it("round trips bounded strict project JSON and rejects unknown file names", () => {
    const files = createPluginProject();
    expect(parsePluginProject(serializePluginProject(files))).toEqual(files);
    expect(() =>
      parsePluginProject(
        JSON.stringify({
          format: "savia.plugin-ide-project",
          formatVersion: 1,
          files: { ...files, surprise: "value" },
        }),
      ),
    ).toThrow();
    expect(() =>
      parsePluginProject("x".repeat(PLUGIN_PROJECT_MAX_BYTES + 1)),
    ).toThrow();
  });

  it("rejects a serialized wrapper that expands beyond the shared project limit", () => {
    const quoted = "\u0000".repeat(2 * 1024 * 1024);
    const files: IdeFiles = {
      "entry.tsx": quoted,
      "savia-extension.json": "{}",
      "store.json": "{}",
      "preview.json": "{}",
    };
    expect(() => serializePluginProject(files)).toThrow(/5 MB/i);
  });

  it("uses shared authoring bounds and rejects dangerous fixture object keys", async () => {
    const files = createPluginProject();
    await expect(
      compilePluginProject({
        ...files,
        "entry.tsx": "x".repeat(2 * 1024 * 1024 + 1),
      }),
    ).rejects.toThrow();
    const tooManyFixtures = {
      collections: { leads: Array.from({ length: 201 }, () => ({})) },
      settings: {},
    };
    await expect(
      compilePluginProject({
        ...files,
        "preview.json": JSON.stringify(tooManyFixtures),
      }),
    ).rejects.toThrow();
    const dangerous = JSON.parse(
      '{"collections":{"leads":[{"__proto__":{"polluted":true}}]},"settings":{}}',
    );
    await expect(
      compilePluginProject({
        ...files,
        "preview.json": JSON.stringify(dangerous),
      }),
    ).rejects.toThrow(/unsafe fixture key/i);
  });

  it("packages a stored ZIP with the server-required files and authoring recovery files", async () => {
    const packaged = await packagePluginProject(createPluginProject());
    const bytes = new Uint8Array(await packaged.blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const names: string[] = [];
    const decoder = new TextDecoder();
    let offset = 0;
    while (view.getUint32(offset, true) === 0x04034b50) {
      const nameLength = view.getUint16(offset + 26, true);
      const extraLength = view.getUint16(offset + 28, true);
      const dataLength = view.getUint32(offset + 18, true);
      names.push(
        decoder.decode(bytes.slice(offset + 30, offset + 30 + nameLength)),
      );
      expect(view.getUint16(offset + 8, true)).toBe(0);
      offset += 30 + nameLength + extraLength + dataLength;
    }
    expect(names).toEqual([
      "savia-extension.json",
      "dist/plugin.js",
      "store.json",
      "src/entry.tsx",
      "src/preview.json",
    ]);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(packaged.entryJs).toContain("SaviaPluginReact");
  });

  it("builds edited modules and CSS from the source archive rather than the retained bundle", async () => {
    const archive = {
      "store-ports/demo/entry.tsx":
        'import { title } from "./screen"; import "./entry.css"; export function render(el) { el.textContent = title; }',
      "store-ports/demo/screen.ts": 'export const title = "Edited original";',
      "store-ports/demo/entry.css": ".edited-original { color: red; }",
    };
    const compiled = await compilePluginProject({
      ...withEntry(
        'export function render(el) { el.textContent = "Old bundle"; }',
      ),
      "original-source.json": JSON.stringify(archive),
    });
    const render = new Function(
      compiled.entryJs.replace(/export const /g, "const ") + "; return render;",
    )();
    const element = document.createElement("div");
    render(element);
    expect(element.textContent).toBe("Edited original");
    expect(document.head.textContent).toContain(
      ".edited-original { color: red; }",
    );
    expect(compiled.entryJs).not.toMatch(/\brequire\s*\(/);
  });

  it("loads literal dynamic source modules asynchronously and preserves JSON and image imports", async () => {
    const compiled = await compilePluginProject({
      ...createPluginProject(),
      "original-source.json": JSON.stringify({
        "demo/entry.tsx":
          'import data from "./data.json"; import image from "./logo.svg"; export async function render(el) { const lazy = await import("./lazy"); el.textContent = data.title + lazy.value + image; }',
        "demo/lazy.ts":
          '/* import("./missing") */ export const value = " loaded ";',
        "demo/data.json": '{"title":"Original"}',
        "demo/logo.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
      }),
    });
    const render = new Function(
      compiled.entryJs.replace(/export const /g, "const ") + "; return render;",
    )() as (element: HTMLElement) => Promise<void>;
    const element = document.createElement("div");
    await render(element);
    expect(element.textContent).toContain(
      "Original loaded data:image/svg+xml,",
    );
    await expect(
      compilePluginProject({
        ...createPluginProject(),
        "original-source.json": JSON.stringify({
          "demo/entry.tsx":
            "export function render(path) { return import(path); }",
        }),
      }),
    ).rejects.toThrow("literal module path");
  });

  it("rejects missing modules and unbundled dependencies with source diagnostics", async () => {
    for (const specifier of ["./missing", "unknown-library"]) {
      const files = {
        ...createPluginProject(),
        "original-source.json": JSON.stringify({
          "demo/entry.tsx": `import { value } from "${specifier}"; export function render(el) { el.textContent = value; }`,
        }),
      };
      await expect(compilePluginProject(files)).rejects.toThrow(specifier);
    }
  });

  it("preserves original source through portable project backups and publication", async () => {
    const archive = JSON.stringify({
      "store-ports/demo/entry.tsx":
        'import { Screen } from "../../packages/demo/src/screen"; export function render(el) { el.textContent = "Original"; } export { Screen };',
      "packages/demo/src/screen.tsx":
        "export const Screen = () => <h1>Original</h1>;",
    });
    const files = { ...createPluginProject(), "original-source.json": archive };
    expect(parsePluginProject(serializePluginProject(files))).toEqual(files);
    const packaged = await packagePluginProject(files);
    const zip = new TextDecoder().decode(await packaged.blob.arrayBuffer());
    expect(zip).toContain("src/original-source.json");
    expect(zip).toContain(archive);
  });

  it("creates an opaque no-network preview document with escaped user code and session messages", () => {
    const preview = createPluginPreviewDocument(
      "export function render() { return null; }\n</script><script>alert(1)</script>",
      { collections: { leads: [{ id: "lead-1", name: "Ana" }] }, settings: {} },
      JSON.parse(createPluginProject()["store.json"]),
      "preview-session",
      "en",
    );
    expect(preview).toContain("default-src 'none'");
    expect(preview).toContain("connect-src 'none'");
    expect(preview).not.toContain("</script><script>alert(1)");
    expect(preview).toContain("preview-session");
    expect(preview).toContain("savia-plugin-ide");
  });

  it("runs the preview mock with PluginApi collection, settings, and panel shapes", async () => {
    const project = createPluginProject();
    const parsed = await compilePluginProject({
      ...project,
      "preview.json": JSON.stringify({
        collections: {
          leads: [
            { id: "lead-1", name: "Ana", status: "new", _version: 1 },
            { id: "lead-2", name: "Marco", status: "active", _version: 1 },
          ],
        },
        settings: { theme: "light" },
      }),
    });
    const html = createPluginPreviewDocument(
      parsed.entryJs,
      parsed.fixtures,
      parsed.store,
      "sdk-session",
      "pt",
    );
    const dom = new JSDOM(html, { runScripts: "outside-only" });
    const moduleSource = dom.window.document.querySelector(
      'script[type="module"]',
    )!.textContent!;
    const replaced = moduleSource.replace(
      /const sourceUrl = .*?\n\s*const plugin = await import\(sourceUrl\);\n\s*URL\.revokeObjectURL\(sourceUrl\);\n\s*if \(typeof plugin\.render.*?\n\s*const cleanup = await plugin\.render\(.*?\);/s,
      "const cleanup = undefined; window.__mockSavia = savia;",
    );
    expect(replaced).not.toBe(moduleSource);
    dom.window.requestAnimationFrame = (callback) => {
      callback(0);
      return 1;
    };
    Object.assign(dom.window, { structuredClone });
    const execute = new Function(
      "window",
      `return window.eval(${JSON.stringify(
        `window.__completion = (async () => { ${replaced} })();`,
      )});`,
    );
    execute(dom.window);
    await (dom.window as unknown as { __completion: Promise<void> })
      .__completion;
    const savia = (dom.window as unknown as { __mockSavia: any }).__mockSavia;

    const collection = savia.collections.collection("leads");
    const filtered = await collection.list({
      q: "mar",
      searchFields: ["name"],
      filters: { conditions: [{ field: "status", op: "eq", value: "active" }] },
      page: 1,
      perPage: 10,
    });
    expect(filtered).toMatchObject({ total: 1, page: 1, perPage: 10 });
    expect(filtered.data[0].id).toBe("lead-2");
    const created = await collection.create({ name: "New lead" });
    expect(created).toMatchObject({ name: "New lead", _version: 1 });
    await expect(collection.get(created.id)).resolves.toMatchObject({
      name: "New lead",
    });
    const updated = await collection.update(
      created.id,
      { status: "active" },
      { version: 1 },
    );
    expect(updated).toMatchObject({ status: "active", _version: 2 });
    await collection.remove(created.id, { version: 2 });
    await expect(collection.get(created.id)).rejects.toThrow(/not found/i);

    const initialSettings = await savia.settings.get();
    const changedSettings = await savia.settings.replace(
      { theme: "dark" },
      initialSettings.version,
    );
    expect(changedSettings).toMatchObject({
      value: { theme: "dark" },
      version: 2,
    });
    await expect(
      savia.settings.replace({}, initialSettings.version),
    ).rejects.toThrow(/version conflict/i);
    expect(savia.i18n.locale).toBe("pt");
    expect(
      await savia.ui.openPanel({
        view: "record-editor",
        title: "Preview",
        params: {},
      }),
    ).toEqual({ status: "cancelled" });
    savia.ui.setPanelState({ dirty: true, busy: false });
    savia.ui.requestClose();
    dom.window.close();
  });

  it("keeps logging bounded and still reports ready and later runtime errors", async () => {
    const project = createPluginProject();
    const compiled = await compilePluginProject(project);
    const html = createPluginPreviewDocument(
      compiled.entryJs,
      compiled.fixtures,
      compiled.store,
      "log-session",
      "en",
    );
    const dom = new JSDOM(html, { runScripts: "outside-only" });
    const messages: Array<{ kind: string; message: string }> = [];
    dom.window.addEventListener("message", (event) => {
      if (event.data?.type === "savia-plugin-ide") messages.push(event.data);
    });
    const moduleSource = dom.window.document.querySelector(
      'script[type="module"]',
    )!.textContent!;
    const replaced = moduleSource.replace(
      /const sourceUrl = .*?\n\s*const plugin = await import\(sourceUrl\);\n\s*URL\.revokeObjectURL\(sourceUrl\);\n\s*if \(typeof plugin\.render.*?\n\s*const cleanup = await plugin\.render\(.*?\);/s,
      `const plugin = window.__testPlugin;
      if (typeof plugin.render !== "function") throw new Error("missing test render");
      const cleanup = await plugin.render(document.getElementById("root"), savia);`,
    );
    expect(replaced).not.toBe(moduleSource);
    dom.window.requestAnimationFrame = (callback) => {
      callback(0);
      return 1;
    };
    for (const method of ["log", "info", "warn", "error", "debug"] as const)
      dom.window.console[method] = () => {};
    Object.assign(dom.window, {
      structuredClone,
      __testPlugin: {
        render() {
          for (let index = 0; index < 60; index += 1)
            dom.window.console.info(`entry ${index}`);
          const circular: Record<string, unknown> = {};
          circular.self = circular;
          dom.window.console.log(circular, 1n);
          dom.window.setTimeout(
            () =>
              dom.window.dispatchEvent(
                new dom.window.ErrorEvent("error", {
                  message: "late preview error",
                }),
              ),
            0,
          );
        },
      },
    });
    const execute = new Function(
      "window",
      `return window.eval(${JSON.stringify(
        `window.__completion = (async () => { ${replaced} })();`,
      )});`,
    );
    execute(dom.window);
    await (dom.window as unknown as { __completion: Promise<void> })
      .__completion;
    await vi.waitFor(() =>
      expect(messages).toContainEqual(
        expect.objectContaining({
          kind: "error",
          message: "late preview error",
        }),
      ),
    );
    expect(messages.filter((message) => message.kind === "log")).toHaveLength(
      50,
    );
    expect(messages.map((message) => message.kind)).toContain("ready");
    expect(messages).toContainEqual(
      expect.objectContaining({
        kind: "error",
        message: "late preview error",
      }),
    );
    dom.window.close();
  });

  it("omits credential-like fixture values from the preview document", () => {
    const preview = createPluginPreviewDocument(
      "export function render() { return null; }",
      {
        collections: { leads: [{ id: "lead-1", apiToken: "must-not-ship" }] },
        settings: { accessKey: "also-private", theme: "dark" },
      },
      JSON.parse(createPluginProject()["store.json"]),
      "preview-session",
      "en",
    );
    expect(preview).not.toContain("must-not-ship");
    expect(preview).not.toContain("also-private");
    expect(preview).toContain("dark");
  });
});
