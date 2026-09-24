export type OfficeMetadata = {
  id: string;
  name: string;
  mime: string;
  size: number;
  version: number;
  field: string;
  object: string;
  recordId: string;
  maxSize: number;
  readOnly: boolean;
};
export type OfficeRevision = {
  version: number;
  size: number;
  created_at: string;
  created_by: string | null;
};
export function officeEditorUrl(base: string | undefined, file: string) {
  if (
    !base ||
    !/^\/v1\/(?:(?:studio|dynamic-crm)\/[1-9][0-9]*|data-domains\/[a-z][a-z0-9_-]{0,47})$/.test(
      base,
    ) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(file)
  )
    return null;
  return "/office/?" + new URLSearchParams({ base, file });
}
export class OfficeApi {
  constructor(
    private base: string,
    private file: string,
  ) {
    if (!officeEditorUrl(base, file))
      throw new Error("El enlace del documento no es válido.");
  }
  private async request(suffix: string, init?: RequestInit) {
    const response = await fetch(
      this.base + "/api/file/" + encodeURIComponent(this.file) + suffix,
      {
        ...init,
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(45000),
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const message =
        response.status === 401
          ? "Tu sesión venció. Descarga tus cambios e inicia sesión en Savia."
          : response.status === 403
            ? "No tienes permiso para editar este archivo."
            : typeof body?.error === "string"
              ? body.error
              : (body?.error?.message ?? "No se pudo completar la operación.");
      throw Object.assign(new Error(message), { status: response.status });
    }
    return response;
  }
  async metadata(): Promise<OfficeMetadata> {
    return (await (await this.request("/office")).json()).data;
  }
  async revisions(): Promise<OfficeRevision[]> {
    return (await (await this.request("/revisions")).json()).data;
  }
  async download(version: number) {
    return new Uint8Array(
      await (
        await this.request("/revisions/" + version + "/download")
      ).arrayBuffer(),
    );
  }
  async save(
    meta: OfficeMetadata,
    bytes: Uint8Array,
  ): Promise<{ version: number }> {
    if (bytes.byteLength > meta.maxSize)
      throw new Error(
        "El archivo supera el tamaño permitido para este campo. Descarga una copia de tus cambios.",
      );
    const form = new FormData();
    form.set("version", String(meta.version));
    form.set(
      "file",
      new File([bytes.slice().buffer], meta.name, { type: meta.mime }),
    );
    return (
      await (
        await this.request("/revisions", { method: "POST", body: form })
      ).json()
    ).data;
  }
}
