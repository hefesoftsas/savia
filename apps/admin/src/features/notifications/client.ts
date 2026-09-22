export interface NoticeItem {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  readAt: number | null;
  archivedAt: number | null;
  source: { kind: string; id?: string; collection?: string };
  actionState: "none" | "pending" | "done" | "expired" | "unavailable";
}

export interface InboxPage {
  items: NoticeItem[];
  nextCursor: string | null;
  cutoff: string;
}

export type InboxFilter = "all" | "unread" | "pending";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (response.status === 401) throw new Error("unauthorized");
  if (response.status === 403) throw new Error("forbidden");
  if (!response.ok)
    throw new Error(`notifications request failed: ${response.status}`);
  return (await response.json()) as T;
}

export const notificationClient = {
  async inbox(filter: InboxFilter, cursor?: string): Promise<InboxPage> {
    const params = new URLSearchParams({ filter });
    if (cursor) params.set("cursor", cursor);
    const { data } = await request<{ data: InboxPage }>(
      `/notifications?${params}`,
    );
    return data;
  },
  async unreadCount(): Promise<number> {
    const { data } = await request<{ data: { count: number } }>(
      "/notifications/count?filter=unread",
    );
    return data.count;
  },
  async setRead(id: string, read: boolean): Promise<void> {
    await request(`/notifications/${encodeURIComponent(id)}/read`, {
      method: "POST",
      body: JSON.stringify({ read }),
    });
  },
  async archive(id: string): Promise<void> {
    await request(`/notifications/${encodeURIComponent(id)}/archive`, {
      method: "POST",
    });
  },
  async readAll(
    cursor?: string,
  ): Promise<{ updated: number; nextCursor: string | null }> {
    const { data } = await request<{
      data: { updated: number; nextCursor: string | null };
    }>("/notifications/read-all", {
      method: "POST",
      body: JSON.stringify(cursor ? { cursor } : {}),
    });
    return data;
  },
  async resolve(id: string): Promise<void> {
    await request(`/notifications/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
    });
  },
  async follows(): Promise<string[]> {
    const { data } = await request<{ data: string[] }>(
      "/notifications/follows",
    );
    return data;
  },
  async follow(collection: string): Promise<void> {
    await request("/notifications/follow", {
      method: "POST",
      body: JSON.stringify({ collection }),
    });
  },
  async unfollow(collection: string): Promise<void> {
    await request(`/notifications/follow/${encodeURIComponent(collection)}`, {
      method: "DELETE",
    });
  },
  async sendAdminNotice(input: {
    scope: string;
    key: string;
    title: string;
    body: string;
    audience:
      | { kind: "explicit"; principals: string[] }
      | { kind: "workspace-members" };
  }): Promise<{ eventId: string; status: string; duplicate: boolean }> {
    const { scope, ...rest } = input;
    const { data } = await request<{
      data: { eventId: string; status: string; duplicate: boolean };
    }>("/notifications/admin/send", {
      method: "POST",
      body: JSON.stringify({
        ...rest,
        scope: { kind: "workspace", id: scope },
      }),
    });
    return data;
  },
  async adminStatus(eventId: string): Promise<{
    status: string;
    delivered: number;
    failed: number;
    pendingRetries: number;
  }> {
    const { data } = await request<{
      data: {
        status: string;
        delivered: number;
        failed: number;
        pendingRetries: number;
      };
    }>(`/notifications/admin/${encodeURIComponent(eventId)}/status`);
    return data;
  },
};

export type NotificationClient = typeof notificationClient;
