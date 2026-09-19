export type StreamManifest = {
  sourceType: "surreal" | "r2" | "kv" | "d1";
  sourceName: string;
  destinationPrefix: string;
  records: number;
  bytes: number;
  sha256: string;
};

export type SnapshotManifest = {
  snapshotId: string;
  createdAt: string;
  streams: StreamManifest[];
};
