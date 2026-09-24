export type RelationCardinality = "one-to-one" | "one-to-many" | "many-to-many";
export type RelationDefinition = {
  id: string;
  sourceObject: string;
  targetObject: string;
  sourceLabel: string;
  targetLabel: string;
  cardinality: RelationCardinality;
  storage: "local" | "native" | "fields";
  sourceField?: string;
  targetField?: string;
  sourceDisplayField?: string | null;
  targetDisplayField?: string | null;
  version?: number;
};
export type RecordRelationColumn = {
  key: string;
  label: string;
};
export type RecordRelationGroup = {
  definition: RelationDefinition;
  direction: "outgoing" | "incoming";
  targetObject: string;
  targetLabel: string;
  label: string;
  records: Array<{
    id: string;
    label: string;
    missing?: boolean;
    data?: Record<string, unknown>;
  }>;
  targetColumns?: RecordRelationColumn[];
  total: number;
  canEdit: boolean;
  readOnlyReason?: string;
  cardinalityConflict?: boolean;
};
