/** Staged relation changes submitted together with their parent record. */
export type RelatedRecordRow = {
  id?: string;
  version?: number;
  data?: Record<string, unknown>;
};
export type RelatedRecordChanges = {
  relationId: string;
  previousIds?: string[];
  rows: RelatedRecordRow[];
};
export type RelatedRecordBundle = {
  record: { id?: string; version?: number; data: Record<string, unknown> };
  relations: RelatedRecordChanges[];
};
