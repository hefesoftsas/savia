import type { CrmObject } from "@savia/crm-shared/metadata";
import type { RelationDefinition } from "@savia/crm-shared/relations";

export function boundRelationField(object: CrmObject | undefined, relationId: string) {
  return Object.entries(object?.config.fields ?? {}).find(([,field]) => field.config?.collectionRelation === relationId)?.[0] ?? "";
}
export function bindRelationField(object: CrmObject, relation: RelationDefinition, field: string) {
  const fields = Object.fromEntries(Object.entries(object.config.fields).map(([key,definition]) => {
    if (key !== field && definition.config?.collectionRelation !== relation.id) return [key,definition];
    const config = {...definition.config};
    delete config.collectionRelation;
    if (key === field) {
      config.collectionRelation = relation.id;
      config.multiple = relation.cardinality === "many-to-many" || (relation.sourceObject === object.name && relation.cardinality === "one-to-many");
    }
    return [key,{...definition,config}];
  }));
  return {...object,config:{...object.config,fields},version:object.version ?? 1};
}
