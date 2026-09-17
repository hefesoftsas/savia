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
  listTables(connection: BridgeConnectionWithPassword): Promise<BridgeTable[]>;
  getColumns(
    connection: BridgeConnectionWithPassword,
    table: string,
  ): Promise<BridgeIntrospectColumnsResult>;
  query(query: BridgeQuery): Promise<BridgeQueryResult>;
}
