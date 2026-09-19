export type FlowSummary = {
  id: string;
  name: string;
  folderPath?: string;
  steps: Array<{ id: string; name: string; method: string }>;
};

export type RequestVariable = {
  key: string;
  value: string;
  secret: boolean;
  required?: boolean;
  configured?: boolean;
};

export type RequestStep = {
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
};

export type RequestFlow = Omit<FlowSummary, "steps"> & {
  description: string;
  provider?: string;
  kind?: string;
  resultPrefix?: string;
  allowedOrigins?: string[];
  input: Record<string, string>;
  variables: RequestVariable[];
  versions: Array<{ id: string; created_at: string }>;
  steps: RequestStep[];
};

export type RequestTrace = {
  name: string;
  status: string;
  durationMs: number;
  httpStatus?: number;
  responseJson?: unknown;
  extracted?: string[];
  error?: string;
};

export type RequestRun = {
  id: string;
  flowId: string;
  mode: "mock" | "live";
  status: string;
  createdAt: string;
  versionId: string | null;
  steps: RequestTrace[];
  result: Record<string, unknown> | null;
  error?: string;
};

export type RequestRunDetail = { run: RequestRun; flow: RequestFlow };
