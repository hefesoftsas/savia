import { PAGE_SIZE, type SearchInput, type SearchPage } from "./logic";

export type SearchErrorKind =
  "authorization" | "timeout" | "unavailable" | "unknown";

function errorKind(error: unknown): SearchErrorKind {
  const status =
    error && typeof error === "object" && "status" in error
      ? error.status
      : undefined;
  if (status === 401 || status === 403) return "authorization";
  if (
    status === 408 ||
    status === 504 ||
    (error instanceof Error &&
      error.message === "El host no respondió a tiempo.")
  )
    return "timeout";
  if ([429, 500, 502, 503].includes(status as number)) return "unavailable";
  return "unknown";
}

export type SearchFeedSnapshot = {
  result: SearchPage | null;
  criteria: SearchInput;
  loading: boolean;
  error: boolean;
  errorKind: SearchErrorKind | null;
  searched: boolean;
};

/** Holds search state and safely appends pages for an infinite results view. */
export class SearchFeed {
  private listeners = new Set<() => void>();
  private requestId = 0;
  private activeRequest: number | null = null;
  private snapshot: SearchFeedSnapshot = {
    result: null,
    criteria: {},
    loading: false,
    error: false,
    errorKind: null,
    searched: false,
  };

  constructor(
    private readonly fetchPage: (input: SearchInput) => Promise<SearchPage>,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  async search(criteria: SearchInput): Promise<void> {
    const normalizedCriteria = {
      ...criteria,
      page: 1,
      perPage: PAGE_SIZE,
    };
    const requestId = ++this.requestId;
    this.activeRequest = requestId;
    this.update({
      result: null,
      criteria: normalizedCriteria,
      loading: true,
      error: false,
      errorKind: null,
      searched: true,
    });

    try {
      const result = await this.fetchWithRetry(normalizedCriteria, requestId);
      if (!this.isCurrent(requestId)) return;
      const data = uniqueRows(result.data);
      this.activeRequest = null;
      this.update({
        result: {
          ...result,
          data,
          hasNext: data.length > 0 && result.hasNext,
        },
        loading: false,
        error: false,
        errorKind: null,
      });
    } catch (error) {
      if (!this.isCurrent(requestId)) return;
      this.activeRequest = null;
      this.update({ loading: false, error: true, errorKind: errorKind(error) });
    }
  }

  async more(): Promise<void> {
    const { result, criteria } = this.snapshot;
    if (this.activeRequest !== null || !result || !result.hasNext) return;

    const requestId = ++this.requestId;
    this.activeRequest = requestId;
    this.update({ loading: true, error: false, errorKind: null });
    try {
      const nextPage = await this.fetchWithRetry(
        {
          ...criteria,
          page: result.page + 1,
          perPage: PAGE_SIZE,
        },
        requestId,
      );
      if (!this.isCurrent(requestId)) return;

      const existingIds = new Set(result.data.map((row) => row.id));
      const novelRows = uniqueRows(nextPage.data).filter(
        (row) => !existingIds.has(row.id),
      );
      this.activeRequest = null;
      this.update({
        result: {
          ...nextPage,
          data: [...result.data, ...novelRows],
          hasNext: novelRows.length > 0 && nextPage.hasNext,
        },
        loading: false,
        error: false,
        errorKind: null,
      });
    } catch (error) {
      if (!this.isCurrent(requestId)) return;
      this.activeRequest = null;
      this.update({ loading: false, error: true, errorKind: errorKind(error) });
    }
  }

  private async fetchWithRetry(
    input: SearchInput,
    requestId: number,
  ): Promise<SearchPage> {
    try {
      return await this.fetchPage(input);
    } catch (error) {
      const kind = errorKind(error);
      if (
        !this.isCurrent(requestId) ||
        (kind !== "timeout" && kind !== "unavailable")
      )
        throw error;
      // Search is read-only. Retry the same offset once after a short backoff.
      await new Promise((resolve) => setTimeout(resolve, 750));
      if (!this.isCurrent(requestId)) throw error;
      return this.fetchPage(input);
    }
  }

  cancel(): void {
    this.requestId += 1;
    this.activeRequest = null;
    if (this.snapshot.loading) this.update({ loading: false });
  }

  private isCurrent(requestId: number) {
    return this.activeRequest === requestId;
  }

  private update(update: Partial<SearchFeedSnapshot>) {
    this.snapshot = { ...this.snapshot, ...update };
    for (const listener of this.listeners) listener();
  }
}

function uniqueRows(rows: SearchPage["data"]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}
