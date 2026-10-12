import runtimeBundle from "virtual:savia-plugin-ide-runtime";
import vendorBundles from "virtual:savia-plugin-ide-vendors";
import {
  compileAuthoringProject,
  packageAuthoringProject,
  type IdeFiles,
} from "@savia/plugin-authoring/project";
export {
  createPluginProject,
  serializePluginProject,
  parsePluginProject,
} from "@savia/plugin-authoring/project";
export type {
  IdeFiles,
  PluginIdeFixtures,
} from "@savia/plugin-authoring/project";
const bundles = { runtimeBundle, vendorBundles };
export function compilePluginProject(files: IdeFiles) {
  return compileAuthoringProject(files, bundles);
}
export async function packagePluginProject(files: IdeFiles) {
  const packaged = await packageAuthoringProject(files, bundles);
  return {
    blob: new Blob([packaged.zipBytes.buffer as ArrayBuffer], {
      type: "application/zip",
    }),
    manifest: packaged.manifest,
    entryJs: packaged.entryJs,
  };
}
