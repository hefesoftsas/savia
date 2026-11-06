import * as pulumi from "@pulumi/pulumi";
import {
  makeVectorizeProvider,
  vectorizeDependencies,
} from "./vectorize-resource.mjs";
export class VectorizeIndex extends pulumi.dynamic.Resource {
  constructor(
    name: string,
    inputs: {
      accountId: string;
      environment: string;
      name: string;
      dimensions: number;
      metric: string;
      adoptExisting: boolean;
      deleteData: boolean;
    },
    opts?: pulumi.CustomResourceOptions,
  ) {
    super(
      makeVectorizeProvider(vectorizeDependencies),
      name,
      inputs,
      opts,
      "vectorize",
      "Index",
    );
  }
}
