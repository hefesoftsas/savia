import { PAGE_SIZE, type SearchInput, type SearchPage } from "./logic";

export type SearchFeedSnapshot = {
  result: SearchPage | null;
  criteria: SearchInput;
  loading: boolean;
  error: boolean;
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
      searched: true,
    });

    try {
      const result = await this.fetchPage(normalizedCriteria);
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
      });
    } catch {
      if (!this.isCurrent(requestId)) return;
      this.activeRequest = null;
      this.update({ loading: false, error: true });
    }
  }

  async more(): Promise<void> {
    const { result, criteria } = this.snapshot;
    if (this.activeRequest !== null || !result || !result.hasNext) return;

    const requestId = ++this.requestId;
    this.activeRequest = requestId;
    this.update({ loading: true, error: false });
    try {
      const nextPage = await this.fetchPage({
        ...criteria,
        page: result.page + 1,
        perPage: PAGE_SIZE,
      });
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
      });
    } catch {
      if (!this.isCurrent(requestId)) return;
      this.activeRequest = null;
      this.update({ loading: false, error: true });
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
