import type { IdeFiles } from "./plugin-ide-project";
export type ProjectDraft = {
  files: IdeFiles;
  history: { role: "user" | "assistant"; content: string }[];
};
export type RecoveryDraft = ProjectDraft & { version: number };
export type SaveState = {
  state: "saved" | "dirty" | "saving" | "error";
  error?: unknown;
};
export class PluginProjectSession {
  private stopped = false;
  private latest: ProjectDraft;
  private acknowledged: string;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  constructor(
    private version: number,
    initial: ProjectDraft,
    private save: (input: RecoveryDraft) => Promise<{ version: number }>,
    private recover: (input: RecoveryDraft | null) => void,
    private notify: (state: SaveState) => void,
  ) {
    this.latest = initial;
    this.acknowledged = JSON.stringify(initial);
  }
  get isSaved() {
    return JSON.stringify(this.latest) === this.acknowledged;
  }
  update(next: ProjectDraft) {
    if (this.stopped) return;
    if (JSON.stringify(next) === JSON.stringify(this.latest)) return;
    this.latest = next;
    this.recover({ ...next, version: this.version });
    this.notify({ state: "dirty" });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, 600);
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.pending) return this.pending;
    this.pending = this.drain().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async drain() {
    try {
      while (!this.stopped && !this.isSaved) {
        const snapshot = this.latest;
        this.notify({ state: "saving" });
        const result = await this.save({ ...snapshot, version: this.version });
        this.version = result.version;
        this.acknowledged = JSON.stringify(snapshot);
        this.recover(
          this.isSaved ? null : { ...this.latest, version: this.version },
        );
      }
      this.notify({ state: "saved" });
    } catch (error) {
      this.notify({ state: "error", error });
      throw error;
    }
  }
  cancel() {
    this.stopped = true;
    this.dispose();
  }
  dispose() {
    clearTimeout(this.timer);
  }
}
