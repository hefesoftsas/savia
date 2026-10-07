import {
  REQUEST_TIMEOUT_MS,
  RequestTimeoutError,
  withRequestTimeout,
} from "./request-timeout";

export type AccessTokenSource = {
  getAccessToken(): Promise<string | null>;
};

export type ApiClientOptions = {
  baseUrl: string;
  tokenSource: AccessTokenSource;
  fetcher?: typeof fetch;
};

type ApiErrorEnvelope = {
  error?: string | { code?: string; message?: string };
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

  async postForm<T>(
    path: string,
    body: FormData,
    init?: RequestInit,
  ): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.delete("Content-Type");
    return this.request<T>(path, {
      ...init,
      method: "POST",
      body,
      headers,
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
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<Response> {
    const { response } = await this.requestResponseWithBody(
      path,
      init,
      async (result) => result,
      timeoutMs,
    );
    return response;
  }

  /** Keeps the request timeout active while consuming the response body. */
  async requestResponseWithBody<T>(
    path: string,
    init: RequestInit,
    consume: (response: Response) => Promise<T>,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<{ response: Response; body: T }> {
    const token = await this.getAccessToken(init.signal);
    return withRequestTimeout(
      async (signal) => {
        const response = await this.fetchResponse(path, init, signal, token);
        const body = await consume(response);
        return { response, body };
      },
      timeoutMs,
      init.signal,
    );
  }

  async request<T>(
    path: string,
    init: RequestInit = {},
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    try {
      const token = await this.getAccessToken(init.signal);
      return await withRequestTimeout(
        async (signal) => {
          const response = await this.fetchResponse(path, init, signal, token);
          const body = await responseBody(response);
          if (!response.ok) {
            const envelope = body as ApiErrorEnvelope | null;
            const serverError = envelope?.error;
            throw new ApiClientError(
              response.status,
              serverError && typeof serverError === "object"
                ? (serverError.code ?? `HTTP_${response.status}`)
                : `HTTP_${response.status}`,
              typeof serverError === "string"
                ? serverError
                : (serverError?.message ??
                    response.statusText ??
                    "Request failed"),
              body,
            );
          }
          return body as T;
        },
        timeoutMs,
        init.signal,
      );
    } catch (error) {
      if (error instanceof RequestTimeoutError) {
        throw new ApiClientError(0, "REQUEST_TIMEOUT", error.message, {
          timeoutMs: error.timeoutMs,
        });
      }
      throw error;
    }
  }

  private async fetchResponse(
    path: string,
    init: RequestInit,
    signal: AbortSignal,
    token: string | null,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    return this.fetcher(requestUrl(this.baseUrl, path), {
      ...init,
      signal,
      credentials: init.credentials ?? "include",
      headers,
    });
  }

  private async getAccessToken(
    signal?: AbortSignal | null,
  ): Promise<string | null> {
    if (!signal) return this.tokenSource.getAccessToken();
    if (signal.aborted)
      throw signal.reason ?? new DOMException("Aborted", "AbortError");

    let removeAbortListener: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      const abort = () =>
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      removeAbortListener = () => signal.removeEventListener("abort", abort);
      if (signal.aborted) abort();
    });

    try {
      return await Promise.race([this.tokenSource.getAccessToken(), aborted]);
    } finally {
      removeAbortListener?.();
    }
  }
}
