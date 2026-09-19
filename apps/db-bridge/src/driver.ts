import type {
  BridgeIntrospectColumnsResult,
  BridgeQuery,
  BridgeQueryResult,
  BridgeTable,
  PostgresConnection,
} from "@savia/crm-shared/sql-sources";

export type BridgeConnectionWithPassword = PostgresConnection & {
  password: string;
};

/**
 * Acceso a Postgres. La app HTTP valida el protocolo; el driver solo
 * ejecuta SQL parametrizado con identificadores ya validados por zod.
 */
export interface BridgeDriver {
  close?(): Promise<void>;
  listTables(connection: BridgeConnectionWithPassword): Promise<BridgeTable[]>;
  getColumns(
    connection: BridgeConnectionWithPassword,
    table: string,
  ): Promise<BridgeIntrospectColumnsResult>;
  query(query: BridgeQuery): Promise<BridgeQueryResult>;
}

import type {
  DatabaseConnection,
  DatabaseRead,
  DatabaseMutation,
  DatabaseResult,
  ResourceMetadata,
} from "@savia/crm-shared/database-sources";
export interface DatabaseDriver {
  testConnection(connection: DatabaseConnection): Promise<void>;
  listResources(
    connection: DatabaseConnection,
  ): Promise<{ resource: string; kind: "table" | "view" | "collection" }[]>;
  inspect(
    connection: DatabaseConnection,
    resource: string,
  ): Promise<ResourceMetadata>;
  read(input: DatabaseRead): Promise<DatabaseResult>;
  mutate(input: DatabaseMutation): Promise<DatabaseResult>;
  close(): Promise<void>;
}
