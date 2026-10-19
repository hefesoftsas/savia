import * as pulumi from "@pulumi/pulumi";
import { makeRuntimeProvider } from "./runtime-provider.mjs";

export interface RuntimeInputs {
  accountId: pulumi.Input<string>;
  environment: pulumi.Input<string>;
  workers: pulumi.Input<
    pulumi.Input<{
      name: pulumi.Input<string>;
      cloudId: pulumi.Input<string>;
    }>[]
  >;
  mode: pulumi.Input<"adopt" | "release">;
  artifactDigest?: pulumi.Input<string>;
  configDigest?: pulumi.Input<string>;
  artifactDirectory?: pulumi.Input<string>;
  adoptionManifest?: pulumi.Input<object>;
  deleteData?: pulumi.Input<boolean>;
}

export class RuntimeRelease extends pulumi.dynamic.Resource {
  declare readonly status: pulumi.Output<string>;
  declare readonly workerVersions: pulumi.Output<object[]>;
  declare readonly namespaceIds: pulumi.Output<object[]>;
  declare readonly attachments: pulumi.Output<object[]>;
  declare readonly retentionWorkerNames: pulumi.Output<string[]>;
  constructor(
    name: string,
    inputs: RuntimeInputs,
    makeDependencies: Parameters<typeof makeRuntimeProvider>[0],
    opts?: pulumi.CustomResourceOptions,
  ) {
    super(
      makeRuntimeProvider(makeDependencies),
      name,
      {
        ...inputs,
        status: undefined,
        workerVersions: undefined,
        namespaceIds: undefined,
        attachments: undefined,
        retentionWorkerNames: undefined,
        runtimeId: undefined,
        releaseDigest: undefined,
      },
      opts,
      "runtime",
      "RuntimeRelease",
    );
  }
}
