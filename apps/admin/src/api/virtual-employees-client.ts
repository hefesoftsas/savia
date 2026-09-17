import type { ApiClient } from "./api-client";

export type VirtualEmployee = {
  id: string;
  agencyId: number | null;
  name: string;
  handle: string;
  position: string | null;
  avatar: string | null;
  greeting: string | null;
  systemPrompt: string;
  allowedCollections: string[];
  model: string | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  filesCount?: number;
  files?: VirtualEmployeeFile[];
};

export type VirtualEmployeeFile = {
  id: string;
  employeeId: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  r2Key: string;
  ragStatus: "pending" | "indexed" | "failed";
  createdAt: string;
};

export type CreateVirtualEmployeeInput = {
  name: string;
  handle: string;
  position?: string | null;
  avatar?: string | null;
  greeting?: string | null;
  systemPrompt: string;
  allowedCollections?: string[];
  model?: string | null;
  status?: "active" | "inactive";
};

export type UpdateVirtualEmployeeInput = Partial<CreateVirtualEmployeeInput>;

export type SystemCollection = {
  name: string;
  label: string;
  description?: string;
};

export class VirtualEmployeesClient {
  constructor(private readonly apiClient: ApiClient) {}

  async listCollections(): Promise<SystemCollection[]> {
    const res = await this.apiClient.get<{ data: SystemCollection[] }>(
      "/api/assistant/collections",
    );
    return res.data;
  }

  async list(): Promise<VirtualEmployee[]> {
    const res = await this.apiClient.get<{ data: VirtualEmployee[] }>(
      "/api/assistant/employees",
    );
    return res.data;
  }

  async get(id: string): Promise<VirtualEmployee> {
    const res = await this.apiClient.get<{ data: VirtualEmployee }>(
      `/api/assistant/employees/${encodeURIComponent(id)}`,
    );
    return res.data;
  }

  async create(input: CreateVirtualEmployeeInput): Promise<VirtualEmployee> {
    const res = await this.apiClient.post<{ data: VirtualEmployee }>(
      "/api/assistant/employees",
      input,
    );
    return res.data;
  }

  async update(
    id: string,
    input: UpdateVirtualEmployeeInput,
  ): Promise<VirtualEmployee> {
    const res = await this.apiClient.patch<{ data: VirtualEmployee }>(
      `/api/assistant/employees/${encodeURIComponent(id)}`,
      input,
    );
    return res.data;
  }

  async delete(id: string): Promise<void> {
    await this.apiClient.delete(
      `/api/assistant/employees/${encodeURIComponent(id)}`,
    );
  }

  async uploadFile(employeeId: string, file: File): Promise<VirtualEmployeeFile> {
    const formData = new FormData();
    formData.append("file", file);

    const res = await this.apiClient.requestResponse(
      `/api/assistant/employees/${encodeURIComponent(employeeId)}/files`,
      {
        method: "POST",
        body: formData,
      },
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any)?.error?.message || "Error al subir archivo");
    }

    const json = (await res.json()) as { data: VirtualEmployeeFile };
    return json.data;
  }

  async deleteFile(employeeId: string, fileId: string): Promise<void> {
    await this.apiClient.delete(
      `/api/assistant/employees/${encodeURIComponent(employeeId)}/files/${encodeURIComponent(fileId)}`,
    );
  }
}
