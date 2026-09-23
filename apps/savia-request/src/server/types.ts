export interface Variable {
  key: string;
  value: string;
  secret: boolean;
  required?: boolean;
  configured?: boolean;
  overridden?: boolean;
}
export interface Step {
  id: string;
  name: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  bodyType?: string;
  auth?: { username: string; password: string };
  sourcePath?: string;
  pre: string;
  post: string;
}
export interface Flow {
  folderPath?: string;
  provider?: string;
  kind?: string;
  resultPrefix?: string;
  allowedOrigins?: string[];
  customized?: boolean;
  id: string;
  name: string;
  description: string;
  steps: Step[];
  variables: Variable[];
  input: Record<string, string>;
}
export interface Trace {
  name: string;
  status: string;
  durationMs: number;
  httpStatus?: number;
  responseJson?: unknown;
  extracted?: string[];
  error?: string;
}
export interface Run {
  id: string;
  flowId: string;
  mode: "mock" | "live";
  status: string;
  createdAt: string;
  versionId: string | null;
  steps: Trace[];
  result: Record<string, unknown> | null;
  error?: string;
}
