import { describe, expect, it } from "vitest";
import * as db from "../src/database-sources";
const connection = {kind:"postgres", host:"pg.internal", database:"erp", username:"writer", password:"secret"};
const field = (name: string, nullable = false) => ({name,nativeType:"text",valueType:"string" as const,nullable,generated:false,writable:true,hasDefault:false});
it.each([["postgres",5432],["mysql",3306],["mssql",1433],["mongodb",27017]])("normalizes %s connections", (kind, port) => {
  expect(db.databaseConnectionSchema.parse({...connection,kind}).port).toBe(port);
});
it("keeps secrets out of persisted configuration and defaults to read-only", () => {
  const config = db.databaseSourceConfigFromInput({...connection,id:"erp",label:"ERP"});
  expect(config.writeEnabled).toBe(false);
  expect(config).not.toHaveProperty("password");
});
it("requires identifiers for update and rejects arbitrary operators", () => {
  const input = {connection,resource:"orders",idColumn:"id",columns:["id","name"],operation:"update",values:{name:"Acme"}};
  expect(db.databaseMutationSchema.safeParse(input).success).toBe(false);
  expect(db.databaseMutationSchema.safeParse({...input,id:"1",values:{$set:{name:"bad"}}}).success).toBe(false);
  expect(db.databaseMutationSchema.safeParse({...input,id:"1"}).success).toBe(true);
});
it("rejects Mongo operator injection inside JSON and unsafe number values", () => {
  const input = {connection,resource:"orders",idColumn:"id",columns:["id"],operation:"create"};
  for (const values of [{data:{$where:"bad"}},{data:NaN},JSON.parse('{"data":{"__proto__":{}}}')])
    expect(db.databaseMutationSchema.safeParse({...input,values}).success).toBe(false);
});
it("does not treat members of composite keys as unique", () => {
  const meta = {resource:"orders",kind:"table" as const,fields:[field("a"),field("b"),field("email",true)],primaryKey:["a","b"],uniqueKeys:[["email"]],sampled:false};
  expect(db.resolveRecordKey(meta)).toBeUndefined();
  expect(db.resolveRecordKey(meta,"a")).toBeUndefined();
  expect(db.deriveDatabaseCapabilities(meta,true).update).toBe(false);
  expect(db.deriveDatabaseCapabilities(meta,true).read).toBe(false);
  expect(db.resolveRecordKey({...meta,fields:[...meta.fields,field("external_id")],uniqueKeys:[["external_id"]]})).toBe("external_id");
});
it("keeps views and source policy read-only", () => {
  const meta = {resource:"orders",kind:"view" as const,fields:[field("id")],primaryKey:["id"],uniqueKeys:[],sampled:false};
  expect(db.deriveDatabaseCapabilities(meta,true).create).toBe(false);
  expect(db.deriveDatabaseCapabilities({...meta,kind:"table"},false).update).toBe(false);
  expect(db.deriveDatabaseCapabilities({...meta,kind:"table"},true).update).toBe(true);
});
it("requires an explicit supported Mongo identifier type", () => {
 const meta = {resource:"orders",kind:"collection" as const,fields:[field("_id")],primaryKey:["_id"],uniqueKeys:[],sampled:true};
 expect(db.resolveRecordKey(meta)).toBeUndefined();
 expect(db.resolveRecordKey({...meta,idType:"string"})).toBe("_id");
});
