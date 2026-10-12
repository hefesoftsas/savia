import type {
  EditorExtensionMetadata,
  InstalledEditorExtension,
  ProjectEditorExtensionReference,
} from "@savia/studio-shared/plugin-editor-extensions";

export type MarketplaceExtension = {
  publisher: string;
  name: string;
  version: string;
  displayName: string | null;
  description: string | null;
  license: string | null;
};

export type MarketplaceSearchResponse = {
  results: MarketplaceExtension[];
  offset: number;
  totalSize: number;
  nextOffset: number | null;
};

export type EditorExtensionInspection = {
  inspectionId: string;
  metadata: EditorExtensionMetadata;
  manifestSummary: {
    description: string | null;
    categories: string[];
    contributes: Record<string, unknown>;
  };
};

type EditorExtensionFetcher = (
  path: string,
  init?: RequestInit,
) => Promise<Response>;

export class PluginEditorExtensionClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "PluginEditorExtensionClientError";
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as {
    error?: unknown;
    message?: unknown;
  } | null;
  if (!response.ok) {
    const nestedError =
      payload?.error && typeof payload.error === "object"
        ? (payload.error as { message?: unknown })
        : null;
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : typeof nestedError?.message === "string"
          ? nestedError.message
          : typeof payload?.message === "string"
            ? payload.message
            : `Editor extension request failed (${response.status}).`;
    throw new PluginEditorExtensionClientError(
      message,
      response.status,
      payload,
    );
  }
  return payload as T;
}

const apiPath = "/api/plugin-editor-extensions";

export class PluginEditorExtensionClient {
  constructor(private readonly fetcher: EditorExtensionFetcher) {}

  async search(
    query: string,
    offset = 0,
    signal?: AbortSignal,
  ): Promise<MarketplaceSearchResponse> {
    const params = new URLSearchParams({ q: query, offset: String(offset) });
    return readJson(
      await this.fetcher(`${apiPath}/marketplace?${params}`, { signal }),
    );
  }

  async inspectUpload(
    file: File,
    signal?: AbortSignal,
  ): Promise<EditorExtensionInspection> {
    const params = new URLSearchParams({
      source: "vsix",
      fileName: file.name,
    });
    return readJson(
      await this.fetcher(`${apiPath}/inspect?${params}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: file,
        signal,
      }),
    );
  }

  async inspectMarketplace(input: {
    publisher: string;
    name: string;
    version: string;
  }): Promise<EditorExtensionInspection> {
    return readJson(
      await this.fetcher(`${apiPath}/inspect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "open-vsx",
          publisher: input.publisher,
          name: input.name,
          version: input.version,
        }),
      }),
    );
  }

  async install(inspectionId: string): Promise<InstalledEditorExtension> {
    const result = await readJson<{ installation: InstalledEditorExtension }>(
      await this.fetcher(`${apiPath}/install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inspectionId }),
      }),
    );
    return result.installation;
  }

  async list(): Promise<InstalledEditorExtension[]> {
    const result = await readJson<{
      installations: InstalledEditorExtension[];
    }>(await this.fetcher(`${apiPath}/installed`));
    return result.installations;
  }

  async downloadPackage(
    installationId: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const response = await this.fetcher(
      `${apiPath}/installed/${encodeURIComponent(installationId)}/package`,
      { signal },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new PluginEditorExtensionClientError(
        typeof body?.error === "string"
          ? body.error
          : `Editor extension request failed (${response.status}).`,
        response.status,
        body,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async uninstall(installationId: string): Promise<void> {
    const response = await this.fetcher(
      `${apiPath}/installed/${encodeURIComponent(installationId)}`,
      { method: "DELETE" },
    );
    if (response.ok) return;
    const body = await response.json().catch(() => null);
    throw new PluginEditorExtensionClientError(
      typeof body?.error === "string"
        ? body.error
        : `Editor extension request failed (${response.status}).`,
      response.status,
      body,
    );
  }
}

export type { InstalledEditorExtension, ProjectEditorExtensionReference };
