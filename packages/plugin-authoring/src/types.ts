import type { compileAuthoringProject } from "./project";
export type { IdeFiles as AuthoringFiles, PluginIdeFixtures } from "./project";
export type CompiledAuthoringProject = Awaited<
  ReturnType<typeof compileAuthoringProject>
>;
