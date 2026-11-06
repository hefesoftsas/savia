import { createHash } from "node:crypto";
import {
  packageAuthoringProject,
  pluginSourceEntry,
  type AuthoringBundles,
} from "@savia/plugin-authoring";
import { pluginVersionSchema } from "@savia/studio-shared/plugin-development";
import { readLocalProject } from "./project";
import type { ConnectionProfile } from "./client";
import type { ProjectRoot } from "./filesystem";
export type BuildDiagnostic = {
  path: string;
  line: number;
  column: number;
  message: string;
};
export type BuildOptions = {
  isTrusted(): boolean;
  saveAll(): PromiseLike<boolean>;
  diagnostics(items: BuildDiagnostic[]): void;
  version?: string;
};
export function requireTrusted(trusted: boolean) {
  if (!trusted)
    throw new Error(
      "A trusted workspace is required to build or publish plugins.",
    );
}
export async function buildLocalProject(
  root: ProjectRoot,
  profile: ConnectionProfile,
  bundles: AuthoringBundles,
  options: BuildOptions,
) {
  requireTrusted(options.isTrusted());
  if (!(await options.saveAll())) return undefined;
  requireTrusted(options.isTrusted());
  options.diagnostics([]);
  let entryPath = "entry.tsx";
  try {
    const project = await readLocalProject(root, profile);
    entryPath = project.descriptor.entryPath;
    if (project.files["original-source.json"])
      entryPath = pluginSourceEntry(
        JSON.parse(project.files["original-source.json"]),
      );
    if (options.version) {
      pluginVersionSchema.parse(options.version);
      project.files["savia-extension.json"] =
        JSON.stringify(
          {
            ...JSON.parse(project.files["savia-extension.json"]),
            version: options.version,
          },
          null,
          2,
        ) + "\n";
    }
    const packaged = await packageAuthoringProject(project.files, bundles);
    requireTrusted(options.isTrusted());
    return {
      ...project,
      ...packaged,
      root,
      profile,
      sha256: createHash("sha256").update(packaged.zipBytes).digest("hex"),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The plugin build failed.";
    const location = /\((\d+):(\d+)\)/.exec(message);
    const path =
      /^([^:\n]+\.(?:tsx?|jsx?|json|css))(?::|\s)/.exec(message)?.[1] ??
      entryPath;
    options.diagnostics([
      {
        path,
        line: Math.max(0, Number(location?.[1] ?? 1) - 1),
        column: Math.max(0, Number(location?.[2] ?? 1) - 1),
        message,
      },
    ]);
    throw error;
  }
}
export type LocalBuild = NonNullable<
  Awaited<ReturnType<typeof buildLocalProject>>
>;
