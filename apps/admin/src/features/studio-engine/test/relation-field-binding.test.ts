import { expect, it } from "vitest";
import { makeConfig, type StudioObject } from "@savia/studio-shared/metadata";
import type { RelationDefinition } from "@savia/studio-shared/relations";
import { bindRelationField } from "../relation-field-binding";

const relation = {
  id: "details",
  sourceObject: "parents",
  targetObject: "children",
  cardinality: "one-to-many",
} as RelationDefinition;
it("clears presentation and action settings when moving a relation binding", () => {
  const object: StudioObject = {
    name: "parents",
    label: "Parents",
    config: makeConfig({
      old: {
        type: "Textbox",
        label: "Old",
        config: {
          collectionRelation: "details",
          multiple: true,
          relationPresentation: "table",
          relationFields: ["name"],
          relationAllowCreate: false,
          relationAllowEdit: false,
          relationAllowLink: false,
          relationAllowUnlink: false,
        },
      },
      next: { type: "Textbox", label: "Next" },
    }),
  };
  const result = bindRelationField(object, relation, "next");
  expect(result.config.fields.old.config).toEqual({});
  expect(result.config.fields.next.config).toEqual({
    collectionRelation: "details",
    multiple: true,
  });
});
it("converts a table into a subform when rebinding on the single side", () => {
  const object: StudioObject = {
    name: "children",
    label: "Children",
    config: makeConfig({
      parent: {
        type: "Textbox",
        label: "Parent",
        config: {
          collectionRelation: "details",
          multiple: true,
          relationPresentation: "table",
        },
      },
    }),
  };
  expect(
    bindRelationField(object, relation, "parent").config.fields.parent.config,
  ).toMatchObject({ multiple: false, relationPresentation: "subform" });
});
