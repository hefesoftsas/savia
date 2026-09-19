export type HookPayload = {
  body: string;
  values: Record<string, string>;
  response?: string;
};
export type HookResult = { body: string; variables: Record<string, string> };
export interface HookExecutor {
  execute(code: string, payload: HookPayload): Promise<HookResult>;
}
export interface Env {
  DB: D1Database;
  ENCRYPTION_KEY: string;
  LOADER?: WorkerLoader;
  HOOK_EXECUTOR?: HookExecutor;
}
