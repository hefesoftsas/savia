import { pagesReadCache } from "./read-cache";
import { publishPageChange } from "./page-events";
import type { ApiClient } from "@/api/api-client";
import type { Value } from "platejs";
import type {
  PageSummary,
  PageShare,
  PageRevision,
  PageFile,
  PageBinding,
  PagesArchive,
  PagesImportResult,
} from "@savia/studio-shared/pages";
export type {
  PageSummary,
  PageShare,
  PageRevision,
  PageFile,
  PagesArchive,
  PagesImportResult,
} from "@savia/studio-shared/pages";
export type RecordBinding = PageBinding;
export type PageDocument = PageSummary & { content: Value };
export type PagePublicLink = {
  shortUrl?: string | null;
  id: string;
  path: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
};
export type CaptureLinkInput = {
  captureId: string;
  title: string;
  url: string;
  note?: string;
  parentId?: string;
  folderTitle?: string;
};
export class PagesClient {
  constructor(readonly api: ApiClient) {}
  private path(id = "") {
    return `/v1/pages${id ? `/${encodeURIComponent(id)}` : ""}`;
  }
  cachedList(q = "") {
    return pagesReadCache(this.api).peek<PageSummary[]>(`list:${q}`);
  }
  cachedDocument(id: string) {
    return pagesReadCache(this.api).peek<PageDocument>(`document:${id}`);
  }
  async list(q = "", force = false) {
    return pagesReadCache(this.api).read(
      `list:${q}`,
      async (signal) =>
        (
          await this.api.get<{ data: PageSummary[] }>(
            `${this.path()}?q=${encodeURIComponent(q)}`,
            { signal },
          )
        ).data,
      force,
    );
  }
  async exportAll() {
    return (await this.api.get<{ data: PagesArchive }>(`${this.path()}/export`))
      .data;
  }
  async importArchive(archive: PagesArchive) {
    const cache = pagesReadCache(this.api);
    const result = (
      await this.api.post<{ data: PagesImportResult }>(
        `${this.path()}/import`,
        archive,
      )
    ).data;
    cache.invalidate();
    return result;
  }
  async get(id: string, force = false) {
    return pagesReadCache(this.api).read(
      `document:${id}`,
      async (signal) =>
        (await this.api.get<{ data: PageDocument }>(this.path(id), { signal }))
          .data,
      force,
    );
  }
  async create(input: {
    title: string;
    parentId?: string;
    kind?: "page" | "folder";
    binding?: RecordBinding;
  }) {
    const cache = pagesReadCache(this.api);
    const page = (
      await this.api.post<{ data: PageDocument }>(this.path(), input)
    ).data;
    cache.changed(page);
    publishPageChange({ api: this.api, page });
    return page;
  }
  async resolveBinding(input: { title: string; binding: RecordBinding }) {
    return this.create(input);
  }
  async capture(input: CaptureLinkInput) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const page = (
        await this.api.post<{ data: PageDocument }>(
          `${this.path()}/capture`,
          input,
          { signal: controller.signal },
        )
      ).data;
      const cache = pagesReadCache(this.api);
      // The capture may also have created the private destination folder.
      cache.invalidate();
      cache.changed(page);
      publishPageChange({ api: this.api });
      return page;
    } finally {
      clearTimeout(timeout);
    }
  }
  async save(
    id: string,
    input: { title: string; content: Value; version: number },
  ) {
    const cache = pagesReadCache(this.api);
    const page = (
      await this.api.put<{ data: PageDocument }>(this.path(id), input)
    ).data;
    cache.changed(page);
    publishPageChange({ api: this.api, page });
    return page;
  }
  async remove(id: string, version: number) {
    const cache = pagesReadCache(this.api);
    await this.api.request(`${this.path(id)}?version=${version}`, {
      method: "DELETE",
    });
    cache.changed(undefined, id);
    publishPageChange({ api: this.api, removedId: id });
  }
  async revisions(id: string) {
    return (
      await this.api.get<{ data: PageRevision[] }>(`${this.path(id)}/revisions`)
    ).data;
  }
  async clearHistory(id: string, version: number) {
    await this.api.request(`${this.path(id)}/revisions?version=${version}`, {
      method: "DELETE",
    });
  }
  async revision(id: string, version: number) {
    return (
      await this.api.get<{ data: { title: string; content: Value } }>(
        `${this.path(id)}/revisions/${version}`,
      )
    ).data;
  }
  async restore(id: string, revision: number, version: number) {
    const cache = pagesReadCache(this.api);
    const page = (
      await this.api.post<{ data: PageDocument }>(`${this.path(id)}/restore`, {
        revision,
        version,
      })
    ).data;
    cache.changed(page);
    publishPageChange({ api: this.api, page });
    return page;
  }
  async members() {
    return (
      await this.api.get<{
        data: Array<{
          principalId: string;
          displayName: string;
          email: string;
        }>;
      }>(`${this.path()}/members`)
    ).data;
  }
  async shares(id: string) {
    return (
      await this.api.get<{
        data: { rootId: string; version: number; shares: PageShare[] };
      }>(`${this.path(id)}/shares`)
    ).data;
  }
  async share(id: string, shares: PageShare[], version: number) {
    const cache = pagesReadCache(this.api);
    const result = await this.api.put(`${this.path(id)}/shares`, {
      shares,
      version,
    });
    cache.invalidate();
    publishPageChange({ api: this.api });
    return result;
  }
  async publicLinks(id: string) {
    return (
      await this.api.get<{ data: PagePublicLink[] }>(
        `${this.path(id)}/public-links`,
      )
    ).data;
  }
  async shortenPublicLink(id: string, linkId: string) {
    return (
      await this.api.post<{ data: { shortUrl: string } }>(
        `${this.path(id)}/public-links/${encodeURIComponent(linkId)}/short-url`,
        {},
      )
    ).data;
  }
  async createPublicLink(id: string, expiresAt?: string | null) {
    return (
      await this.api.post<{ data: PagePublicLink }>(
        `${this.path(id)}/public-links`,
        { ...(expiresAt ? { expiresAt } : {}) },
      )
    ).data;
  }
  async revokePublicLink(id: string, linkId: string) {
    return this.api.request(
      `${this.path(id)}/public-links/${encodeURIComponent(linkId)}`,
      { method: "DELETE" },
    );
  }
  async upload(id: string, file: File) {
    const body = new FormData();
    body.append("file", file);
    return (
      await this.api.request<{ data: PageFile }>(
        `${this.path(id)}/files`,
        {
          method: "POST",
          body,
        },
        300_000,
      )
    ).data;
  }
  async file(id: string, fileId: string) {
    const response = await this.api.requestResponse(
      `${this.path(id)}/files/${encodeURIComponent(fileId)}`,
    );
    if (!response.ok) throw new Error("File unavailable");
    return response.blob();
  }
}
