import type { StudioObject } from "@savia/studio-shared/metadata";
import type { RelationDefinition } from "@savia/studio-shared/relations";

export function boundRelationField(
  object: StudioObject | undefined,
  relationId: string,
) {
  return (
    Object.entries(object?.config.fields ?? {}).find(
      ([, field]) => field.config?.collectionRelation === relationId,
    )?.[0] ?? ""
  );
}
export function bindRelationField(
  object: StudioObject,
  relation: RelationDefinition,
  field: string,
) {
  const fields = Object.fromEntries(
    Object.entries(object.config.fields).map(([key, definition]) => {
      if (
        key !== field &&
        definition.config?.collectionRelation !== relation.id
      )
        return [key, definition];
      const config = { ...definition.config };
      delete config.collectionRelation;
      if (key !== field) {
        delete config.relationPresentation;
        delete config.relationFields;
        delete config.relationAllowCreate;
        delete config.relationAllowEdit;
        delete config.relationAllowLink;
        delete config.relationAllowUnlink;
        delete config.multiple;
      }
      if (key === field) {
        config.collectionRelation = relation.id;
        config.multiple =
          relation.cardinality === "many-to-many" ||
          (relation.sourceObject === object.name &&
            relation.cardinality === "one-to-many");
        if (!config.multiple && config.relationPresentation === "table")
          config.relationPresentation = "subform";
      }
      return [key, { ...definition, config }];
    }),
  );
  return {
    ...object,
    config: { ...object.config, fields },
    version: object.version ?? 1,
  };
}
