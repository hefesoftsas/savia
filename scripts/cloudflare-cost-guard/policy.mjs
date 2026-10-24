const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function id(value, label) {
  if (typeof value !== "string" || !NAME.test(value) || value === "*")
    throw new TypeError(`invalid ${label}`);
  return value;
}

function list(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const values = value.map((entry) => id(entry, label));
  if (new Set(values).size !== values.length)
    throw new TypeError(`duplicate ${label}`);
  return values;
}

export function parsePolicy(input) {
  const raw = typeof input === "string" ? JSON.parse(input) : input;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new TypeError("policy must be an object");
  for (const flag of ["accountWide", "denyCloudflareAi"])
    if (raw[flag] !== undefined && typeof raw[flag] !== "boolean")
      throw new TypeError(`${flag} must be a boolean`);
  const guardScript = id(raw.guardScript, "guard script");
  const backupBarrierScripts = list(
    raw.backupBarrierScripts,
    "backup barrier script",
  );
  const scripts = raw.scripts === undefined ? [] : raw.scripts;
  if (!Array.isArray(scripts)) throw new TypeError("scripts must be an array");
  const seenScripts = new Set();
  const normalizedScripts = scripts.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new TypeError("invalid script target");
    const script = id(item.script, "script");
    if (seenScripts.has(script)) throw new TypeError("duplicate script");
    seenScripts.add(script);
    if (script === guardScript || backupBarrierScripts.includes(script))
      throw new TypeError(`protected script target: ${script}`);
    const variables = item.variables ?? {};
    if (!variables || typeof variables !== "object" || Array.isArray(variables))
      throw new TypeError("script variables must be an object");
    for (const [key, value] of Object.entries(variables)) {
      if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key) || typeof value !== "string")
        throw new TypeError("invalid script variable override");
    }
    return { script, variables: { ...variables } };
  });
  const queues = list(raw.queues, "queue");
  const schedules = list(raw.schedules, "schedule script");
  const workflows = list(raw.workflows, "workflow");
  if (
    schedules.some(
      (name) => name === guardScript || backupBarrierScripts.includes(name),
    )
  )
    throw new TypeError("protected script target in schedules");
  const aiSearch = raw.aiSearch ?? [];
  if (!Array.isArray(aiSearch))
    throw new TypeError("aiSearch must be an array");
  const seenAiSearch = new Set();
  const normalizedAiSearch = aiSearch.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new TypeError("invalid AI Search target");
    const namespace = id(item.namespace, "AI Search namespace");
    const instanceId = id(item.id, "AI Search instance");
    const key = `${namespace}:${instanceId}`;
    if (seenAiSearch.has(key))
      throw new TypeError("duplicate AI Search target");
    seenAiSearch.add(key);
    return { namespace, id: instanceId };
  });
  return {
    guardScript,
    backupBarrierScripts,
    scripts: normalizedScripts,
    queues,
    schedules,
    workflows,
    aiSearch: normalizedAiSearch,
    accountWide: raw.accountWide === true,
    denyCloudflareAi: raw.denyCloudflareAi === true,
  };
}
