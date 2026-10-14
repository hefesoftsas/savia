import runtimeBundle from "virtual:savia-plugin-ide-runtime";
import vendorBundles from "virtual:savia-plugin-ide-vendors";
import { compilePluginSourceArchive as compileSource } from "@savia/plugin-authoring/source-compiler";
export {
  pluginSourceEntry,
  findMissingPluginSourceAssets,
} from "@savia/plugin-authoring/source-compiler";
export function compilePluginSourceArchive(archive: string) {
  return compileSource(archive, { runtimeBundle, vendorBundles });
}
