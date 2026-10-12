import { createHash } from "node:crypto";
import { z } from "zod";
import {
  pluginDevelopmentOriginSchema,
  pluginDevelopmentCapabilitiesSchema,
  pluginCatalogSchema,
  pluginCheckoutSchema,
  pluginPublicationRequestSchema,
  pluginPublicationReceiptSchema,
  pluginVersionSchema,
  type PluginPublicationRequest,
} from "@savia/studio-shared/plugin-development";
import {
  pluginStoreManifestSchema,
  PLUGIN_STORE_MAX_ZIP_BYTES,
} from "@savia/studio-shared/plugin-store";

export type ConnectionProfile = {
  id: string;
  origin: string;
  tenantId: number;
  principalId?: string;
};
export type Transport = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
export class PluginDevelopmentError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export class PluginDevelopmentClient {
  readonly profile: Readonly<ConnectionProfile>;
  private disposed = false;
  private requests = new Set<AbortController>();
  constructor(
    profile: ConnectionProfile,
    private tokenProvider: () => PromiseLike<string | undefined>,
    private transport: Transport = fetch,
  ) {
    pluginDevelopmentOriginSchema.parse(profile.origin);
    if (!Number.isSafeInteger(profile.tenantId) || profile.tenantId <= 0)
      throw new Error("Select a commercial workspace.");
    this.profile = Object.freeze({ ...profile });
  }
  dispose() {
    this.disposed = true;
    for (const request of this.requests) request.abort();
    this.requests.clear();
  }
  private assertActive() {
    if (this.disposed)
      throw new PluginDevelopmentError(
        0,
        "CONNECTION_CHANGED",
        "The connection changed. Retry in the selected connection.",
      );
  }
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    limit: number,
    init: RequestInit = {},
    signal?: AbortSignal,
  ): Promise<T> {
    this.assertActive();
    const controller = new AbortController();
    this.requests.add(controller);
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) controller.abort();
    let timedOut = false;
    const cancellation = () =>
      new PluginDevelopmentError(
        0,
        timedOut ? "REQUEST_TIMEOUT" : "CANCELLED",
        timedOut
          ? "The Savia request timed out. Its outcome is unconfirmed; recover the retained publication before retrying."
          : "The request was cancelled.",
      );
    const timeout = setTimeout(() => {
      timedOut = true;
      cancel();
    }, 30_000);
    try {
      const token = await this.tokenProvider();
      this.assertActive();
      if (!token || !/^[\x21-\x7e]+$/.test(token))
        throw new PluginDevelopmentError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Connect with a personal API key.",
        );
      const url = new URL(
        `/v1/studio/${this.profile.tenantId}/api/plugin-development${path}`,
        this.profile.origin,
      );
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${token}`);
      headers.set("accept", "application/json");
      let response: Response;
      try {
        response = await this.transport(url, {
          ...init,
          headers,
          redirect: "error",
          signal: controller.signal,
        });
      } catch {
        this.assertActive();
        if (controller.signal.aborted) throw cancellation();
        throw new PluginDevelopmentError(
          0,
          "NETWORK_ERROR",
          "The Savia request could not be confirmed. Retain your files and retry.",
        );
      }
      this.assertActive();
      if (controller.signal.aborted) throw cancellation();
      if (
        response.redirected ||
        (response.url &&
          new URL(response.url).origin !== this.profile.origin) ||
        (response.status >= 300 && response.status < 400)
      )
        throw new PluginDevelopmentError(
          response.status,
          "REDIRECT_REFUSED",
          "The selected connection refused a redirect.",
        );
      if (!response.ok) {
        const messages: Record<number, string> = {
          401: "The personal API key expired or was revoked. Reconnect.",
          403: "The key or its owner does not have the required plugin permission.",
          404: "The plugin or selected source is unavailable.",
          409: "The plugin head or source changed. Compare and rebase before publishing.",
          413: "The plugin request exceeds its byte limit.",
          422: "The plugin package or metadata is invalid.",
        };
        await response.body?.cancel();
        throw new PluginDevelopmentError(
          response.status,
          "REQUEST_REJECTED",
          messages[response.status] ??
            "Savia could not complete the plugin request.",
        );
      }
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > limit) {
        await response.body?.cancel();
        throw new Error("Plugin response exceeds its byte limit.");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Invalid empty plugin response.");
      const cancelBody = () => {
        void reader.cancel().catch(() => {});
      };
      controller.signal.addEventListener("abort", cancelBody, { once: true });
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          this.assertActive();
          if (controller.signal.aborted) throw cancellation();
          if (done) break;
          length += value.length;
          if (length > limit) {
            await reader.cancel();
            throw new Error("Plugin response exceeds its byte limit.");
          }
          chunks.push(value);
        }
      } finally {
        controller.signal.removeEventListener("abort", cancelBody);
        reader.releaseLock();
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      try {
        return schema.parse(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        );
      } catch {
        throw new PluginDevelopmentError(
          0,
          "INVALID_RESPONSE",
          "Savia returned an invalid plugin response.",
        );
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      this.requests.delete(controller);
    }
  }
  async capabilities(signal?: AbortSignal) {
    const value = await this.request(
      "/capabilities",
      pluginDevelopmentCapabilitiesSchema,
      128 * 1024,
      {},
      signal,
    );
    if (
      value.tenantId !== this.profile.tenantId ||
      (this.profile.principalId !== undefined &&
        value.principalId !== this.profile.principalId)
    )
      throw new PluginDevelopmentError(
        403,
        "IDENTITY_CHANGED",
        "The connection identity changed. Reconnect to the selected workspace.",
      );
    return value;
  }
  catalog(signal?: AbortSignal) {
    return this.request(
      "/catalog",
      pluginCatalogSchema,
      4 * 1024 * 1024,
      {},
      signal,
    );
  }
  async checkout(id: string, version: string, signal?: AbortSignal) {
    pluginStoreManifestSchema.shape.id.parse(id);
    pluginVersionSchema.parse(version);
    const checkout = await this.request(
      `/${encodeURIComponent(id)}/checkout?version=${encodeURIComponent(version)}`,
      pluginCheckoutSchema,
      5 * 1024 * 1024 + 64 * 1024,
      {},
      signal,
    );
    if (checkout.pluginId !== id || checkout.sourceVersion !== version)
      throw new PluginDevelopmentError(
        0,
        "INVALID_COORDINATE",
        "The checkout coordinate does not match the selected plugin version.",
      );
    return checkout;
  }
  async publish(
    metadata: PluginPublicationRequest,
    zipBytes: Uint8Array,
    signal?: AbortSignal,
  ) {
    const input = pluginPublicationRequestSchema.parse(metadata);
    if (!zipBytes.length || zipBytes.length > PLUGIN_STORE_MAX_ZIP_BYTES)
      throw new Error("Plugin ZIP exceeds its byte limit.");
    const form = new FormData();
    form.set("metadata", JSON.stringify(input));
    form.set(
      "file",
      new Blob([Uint8Array.from(zipBytes).buffer], { type: "application/zip" }),
      "plugin.zip",
    );
    const receipt = await this.request(
      `/${encodeURIComponent(input.pluginId)}/publish`,
      pluginPublicationReceiptSchema,
      128 * 1024,
      { method: "POST", body: form },
      signal,
    );
    if (
      receipt.destination !== input.destination ||
      receipt.local.pluginId !== input.pluginId ||
      receipt.local.version !== input.version ||
      receipt.local.sha256 !==
        createHash("sha256").update(zipBytes).digest("hex") ||
      (receipt.shared &&
        (receipt.shared.pluginId !== input.pluginId ||
          receipt.shared.version !== input.version))
    )
      throw new PluginDevelopmentError(
        0,
        "INVALID_COORDINATE",
        "The publication coordinate or digest does not match the retained ZIP.",
      );
    return receipt;
  }
}
