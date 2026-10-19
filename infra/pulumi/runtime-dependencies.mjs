// Only this credential-free function is serialized by Pulumi. Both normal
// projects and their branch/shared siblings resolve the checked-out adapter.
export async function runtimeDependencies(inputs) {
  const { existsSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const candidates = [
    resolve(process.cwd(), "runtime-operations.mjs"),
    resolve(process.cwd(), "../runtime-operations.mjs"),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path)
    throw new Error("Checked-out Savia runtime operations are required");
  const operations = await import(pathToFileURL(path).href);
  return operations.createRuntimeOperations(inputs);
}
