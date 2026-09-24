/** Staged relation changes submitted together with their parent record. */
export type RelatedRecordRow = {
  /** UUID reserved locally for a new row; never combined with id or version. */
  clientId?: string;
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
  record: {
    clientId?: string;
    id?: string;
    version?: number;
    data: Record<string, unknown>;
  };
  relations: RelatedRecordChanges[];
};
