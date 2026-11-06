export function isolateCompose(base, project, appPort, storagePort) {
  const overrides = fixtureConfig(project, appPort, storagePort);
  const isolated = structuredClone(base);
  isolated.name = project;
  for (const [name, override] of Object.entries(overrides.services))
    if (isolated.services[name])
      Object.assign(isolated.services[name], override);
  for (const resource of [
    ...Object.values(isolated.volumes ?? {}),
    ...Object.values(isolated.networks ?? {}),
  ]) {
    if (resource.external)
      throw new Error(
        "External resources are forbidden in disposable fixtures",
      );
    delete resource.name;
  }
  return isolated;
}

export function fixtureConfig(project, appPort, storagePort) {
  if (!/^savia-mcp-e2e-[a-z0-9]+$/.test(project))
    throw new Error("Only disposable MCP E2E projects are allowed");
  if (
    [appPort, storagePort].some(
      (p) => !Number.isInteger(p) || p < 1024 || p > 65535,
    ) ||
    appPort === storagePort
  )
    throw new Error("Distinct unprivileged ports are required");
  const image = `${project}:local`;
  return {
    services: {
      savia: { image, ports: [`127.0.0.1:${appPort}:8080`], restart: "no" },
      storage: { ports: [`127.0.0.1:${storagePort}:8333`], restart: "no" },
      "storage-init": { image },
      "storage-config": { image },
      "db-bridge": { image },
    },
  };
}
