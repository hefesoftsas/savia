/** Serializes document writes; a conflict stops the queue until the page is reopened. */
export class PageSaveQueue<T, R extends { version: number }> {
  private pending: Promise<R> | null = null;
  private failure: unknown;
  constructor(
    private version: number,
    private write: (draft: T, version: number) => Promise<R>,
  ) {}
  save(draft: T): Promise<R> {
    const run = async () => {
      if (this.failure) throw this.failure;
      try {
        const result = await this.write(draft, this.version);
        this.version = result.version;
        return result;
      } catch (error) {
        this.failure = error;
        throw error;
      }
    };
    const next = this.pending ? this.pending.then(run) : run();
    this.pending = next;
    return next;
  }
}
