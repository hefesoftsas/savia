import { expect, it } from "vitest";
import { makeConfig, type CrmObject } from "@savia/crm-shared/metadata";
import {
  duplicateRecordValues,
  canDuplicateRecord,
} from "../record-duplication";
const object: CrmObject = {
  name: "contacts",
  label: "Contacts",
  description: "",
  config: makeConfig({
    name: { type: "Textbox", label: "Name" },
    score: { type: "Number", label: "Score" },
    enabled: { type: "Toggle", label: "Enabled" },
    email: { type: "Textbox", label: "Email", config: { unique: true } },
    locked: { type: "Textbox", label: "Locked", readOnly: true },
    calculated: {
      type: "Number",
      label: "Calculated",
      config: { formula: { op: "sum", fields: ["score", "score"] } },
    },
    relation: {
      type: "Textbox",
      label: "Relation",
      config: { relation: "contacts" },
    },
    link: {
      type: "Textbox",
      label: "Link",
      config: { collectionRelation: "link" },
    },
    file: { type: "File", label: "File" },
    files: { type: "ArrayFile", label: "Files" },
    hidden: { type: "Textbox", label: "Hidden", hidden: true },
    id: { type: "Textbox", label: "Id" },
    owner_id: { type: "Textbox", label: "Owner" },
    created_at: { type: "Textbox", label: "Created" },
  }),
};
it("copies only safe visible writable scalar values without mutating the source", () => {
  const source = Object.freeze({
    id: "source",
    _version: 4,
    name: "Ana",
    score: 0,
    enabled: false,
    email: "unique",
    locked: "locked",
    calculated: 3,
    relation: "r",
    link: "l",
    file: "secret",
    files: ["secret"],
    hidden: "secret",
    owner_id: "u",
    created_at: "today",
    unknown: "secret",
  });
  expect(duplicateRecordValues(object, source)).toEqual({
    name: "Ana",
    score: 0,
    enabled: false,
  });
  expect(source.id).toBe("source");
  expect(source.email).toBe("unique");
});
it("rejects object and array payloads even in scalar fields", () => {
  expect(
    duplicateRecordValues(object, {
      id: "s",
      name: { secret: true },
      score: [1],
    }),
  ).toEqual({});
});
it("limits duplication to local collections with both read and create", () => {
  expect(canDuplicateRecord(object)).toBe(true);
  for (const studio of [
    { capabilities: { read: false, create: true } },
    { capabilities: { read: true, create: false } },
    { collection: { kind: "crm", capabilities: { read: true, create: true } } },
    { business: "managed-customer" },
  ])
    expect(
      canDuplicateRecord({
        ...object,
        config: { ...object.config, studio },
      } as CrmObject),
    ).toBe(false);
});

it("omits a custom pipeline ownership field", () => {
  const configured: CrmObject = {
    ...object,
    config: {
      ...object.config,
      fields: {
        ...object.config.fields,
        assignee: { type: "Textbox", label: "Assigned to" },
      },
      studio: { ...object.config.studio, pipeline: { ownerField: "assignee" } },
    },
  };
  expect(
    duplicateRecordValues(configured, {
      id: "source",
      name: "Ana",
      assignee: "original-owner",
    }),
  ).toEqual({ name: "Ana" });
});
