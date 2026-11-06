import type { WorkflowParameter } from "../../workflow-types";
import { createWidget } from "../widget";
import {
  SaviaCollectionInput,
  saviaCollectionInputConfig,
} from "./savia-collection-input";
import {
  SaviaCollectionTriggerWidget,
  saviaCollectionTriggerConfig,
} from "./savia-collection-trigger";

export const saviaCollectionInputWidget = createWidget({
  component: SaviaCollectionInput,
  nodeTypes: [
    "savia-list-records",
    "savia-read-record",
    "savia-create-record",
    "savia-update-record",
    "savia-delete-record",
  ],
  managedFields: ["collection", "data", "filters"],
  extractConfig: (nodeId, inputs) => {
    const has = (name: string) => inputs.some((input) => input.id === name);
    const nodeType = has("page")
      ? "savia-list-records"
      : has("data")
        ? has("version")
          ? "savia-update-record"
          : "savia-create-record"
        : has("version")
          ? "savia-delete-record"
          : "savia-read-record";
    return saviaCollectionInputConfig(
      nodeId,
      nodeType,
      inputs as WorkflowParameter[],
    );
  },
});

export const saviaCollectionTriggerWidget = createWidget({
  component: SaviaCollectionTriggerWidget,
  nodeTypes: ["savia-collection-event"],
  extractConfig: (nodeId) => saviaCollectionTriggerConfig(nodeId),
});
