export interface BackupCoordinatorStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<unknown>;
}

export interface BackupCoordinatorState {
  storage: BackupCoordinatorStorage;
}

export interface BackupGateStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

export interface BackupGateNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): BackupGateStub;
}

export interface BackupGateEnvironment {
  BACKUP_GATE?: BackupGateNamespace;
  SAVIA_BACKUP_GATE_REQUIRED?: string;
  [binding: string]: unknown;
}

export declare class BackupCoordinator {
  constructor(state: BackupCoordinatorState, env: Record<string, unknown>);
  fetch(request: Request): Promise<Response>;
}

export declare function guardStorageEnvironment<T extends object>(env: T): T;

export declare const BACKUP_GATE_OBJECT_NAME: "production-backup-v1";
