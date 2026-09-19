import { expect, it } from "vitest";
import {
  decodeMongoId,
  inferMongoMetadata,
  encodeMongoValue,
} from "../src/mongodb-driver";
import { ObjectId } from "mongodb";
it("distinguishes hexadecimal strings from ObjectIds", () => {
  const id = "507f1f77bcf86cd799439011";
  expect(decodeMongoId(id, "string")).toBe(id);
  expect(decodeMongoId(id, "objectId")).toBeInstanceOf(ObjectId);
  expect(() => decodeMongoId("invalid", "objectId")).toThrow();
});
it("infers mixed JSON and nullable fields without guessing id type", () => {
  const meta = inferMongoMetadata("orders", [
    { _id: "1", data: { a: 1 }, name: "A" },
    { _id: "2", data: [1] },
  ]);
  expect(meta.idType).toBe("string");
  expect(meta.fields.find((f) => f.name === "data")?.valueType).toBe("json");
  expect(meta.fields.find((f) => f.name === "name")?.nullable).toBe(true);
  expect(
    inferMongoMetadata("orders", [{ _id: "1" }, { _id: new ObjectId() }])
      .idType,
  ).toBeUndefined();
  expect(inferMongoMetadata("orders", []).fields).toHaveLength(0);
});

it("preserves native ObjectId fields and rejects overflowing signed integers", () => {
  const id = new ObjectId();
  const meta = inferMongoMetadata("orders", [{ _id: "a", customer: id }]);
  const field = meta.fields.find((f) => f.name === "customer")!;
  expect(field.nativeType).toBe("objectId");
  expect(encodeMongoValue(field, id.toHexString())).toEqual(id);
  const bigint = {
    ...field,
    nativeType: "bigint",
    valueType: "bigint" as const,
  };
  expect(encodeMongoValue(bigint, "9223372036854775807").toString()).toBe(
    "9223372036854775807",
  );
  for (const value of [
    "9223372036854775808",
    "-9223372036854775809",
    "18446744073709551616",
  ])
    expect(() => encodeMongoValue(bigint, value)).toThrow();
});

it("keeps mixed ObjectId and string fields read-only", () => {
  const meta = inferMongoMetadata("orders", [
    { _id: "a", customer: new ObjectId() },
    { _id: "b", customer: "legacy" },
  ]);
  expect(meta.fields.find((f) => f.name === "customer")?.writable).toBe(false);
});
