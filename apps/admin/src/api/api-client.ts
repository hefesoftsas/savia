export type AccessTokenSource = {
  getAccessToken(): Promise<string | null>;
};

export type ApiClientOptions = {
  baseUrl: string;
  tokenSource: AccessTokenSource;
  fetcher?: typeof fetch;
};

type ApiErrorEnvelope = {
  error?: { code?: string; message?: string };
};

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function requestUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.replace(/\/$/, "")}/`).toString();
}

async function responseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/json") ? response.json() : null;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly tokenSource: AccessTokenSource;
  private readonly fetcher: typeof fetch;

  constructor({ baseUrl, tokenSource, fetcher }: ApiClientOptions) {
    this.baseUrl = baseUrl;
    this.tokenSource = tokenSource;
    this.fetcher = fetcher ?? ((input, init) => globalThis.fetch(input, init));
  }

  async get<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: "GET" });
  }

  async post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>(path, {
      ...init,
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  }

  async patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>(path, {
      ...init,
      method: "PATCH",
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  }

  async put<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>(path, {
      ...init,
      method: "PUT",
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  }

  async delete(path: string, init?: RequestInit): Promise<void> {
    await this.request<undefined>(path, { ...init, method: "DELETE" });
  }

  async requestResponse(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const token = await this.tokenSource.getAccessToken();
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    return this.fetcher(requestUrl(this.baseUrl, path), {
      ...init,
      credentials: init.credentials ?? "include",
      headers,
    });
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.requestResponse(path, init);
    const body = await responseBody(response);
    if (!response.ok) {
      const envelope = body as ApiErrorEnvelope | null;
      throw new ApiClientError(
        response.status,
        envelope?.error?.code ?? `HTTP_${response.status}`,
        envelope?.error?.message ?? response.statusText ?? "Request failed",
        body,
      );
    }
    return body as T;
  }
}
