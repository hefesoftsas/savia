import type { StudioObject } from "./metadata";
import type { WorkflowDefinition } from "./workflows";

/** Trusted release contributions. Never accepted as schema patches from a request. */
export type WorkflowBundle = {
  id: string;
  extensionId?: string;
  label: string;
  description: string;
  collections: readonly string[];
  fields: readonly {
    collection: string;
    optional?: boolean;
    fields: Record<
      string,
      StudioObject["config"]["fields"][string] & {
        labels?: Record<string, string>;
      }
    >;
  }[];
  workflows: readonly {
    key: string;
    name: string;
    definition: WorkflowDefinition;
  }[];
};
