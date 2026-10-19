import {
  adoptRuntime,
  readRuntime,
  diffRuntimeInputs,
  releaseRuntime,
  validateRuntimeInputs,
} from "./runtime-release.mjs";

const keys = [
  "accountId",
  "environment",
  "workers",
  "mode",
  "artifactDigest",
  "configDigest",
  "artifactDirectory",
  "adoptionManifest",
  "deleteData",
];
function inputsOf(props) {
  const result = Object.fromEntries(
    keys
      .filter((key) => props[key] !== undefined && props[key] !== null)
      .map((key) => [key, props[key]]),
  );
  return validateRuntimeInputs(result);
}
// The factory must read credentials inside an operation. Provider serialization
// captures code and identity metadata, never an authenticated client instance.
export function makeRuntimeProvider(makeDependencies) {
  return {
    async check(_olds, news) {
      try {
        inputsOf(news);
        return { inputs: news };
      } catch (error) {
        return {
          inputs: news,
          failures: [{ property: "runtime", reason: error.message }],
        };
      }
    },
    async diff(_id, olds, news) {
      return diffRuntimeInputs(inputsOf(olds), inputsOf(news));
    },
    async create(props) {
      const inputs = inputsOf(props);
      const deps = await makeDependencies(inputs);
      const state =
        inputs.mode === "adopt"
          ? await adoptRuntime(inputs, deps)
          : await releaseRuntime({}, inputs, deps);
      return { id: state.runtimeId, outs: { ...inputs, ...state } };
    },
    async read(id, props) {
      const inputs = inputsOf(props);
      const state = await readRuntime(
        inputs,
        props,
        await makeDependencies(inputs),
      );
      return { id, props: { ...inputs, ...state } };
    },
    async update(_id, olds, news) {
      const inputs = inputsOf(news);
      const previous = inputsOf(olds);
      diffRuntimeInputs(previous, inputs);
      const deps = await makeDependencies(inputs);
      // An explicit delete-data authorization update changes bookkeeping only.
      const publish =
        previous.mode !== inputs.mode ||
        previous.artifactDigest !== inputs.artifactDigest ||
        previous.configDigest !== inputs.configDigest;
      const state =
        publish && inputs.mode === "release"
          ? await releaseRuntime(olds, inputs, deps)
          : await readRuntime(inputs, olds, deps);
      return { outs: { ...inputs, ...state } };
    },
    async delete(_id, props) {
      const inputs = inputsOf(props);
      const deps = await makeDependencies(inputs);
      await deps.retire(props, {
        manifest: inputs.adoptionManifest,
        deleteData: inputs.deleteData ?? false,
      });
    },
  };
}
