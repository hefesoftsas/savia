import { createHash } from "node:crypto";
import {
  PluginDevelopmentClient,
  type ConnectionProfile,
  type Transport,
  PluginDevelopmentError,
} from "./client";
import type { PluginDevelopmentCapabilities } from "@savia/studio-shared/plugin-development";
export interface CredentialStorage {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}
export type ActiveConnection = {
  profile: ConnectionProfile;
  capabilities: PluginDevelopmentCapabilities;
  client: PluginDevelopmentClient;
};
export function profileIdentity(
  origin: string,
  tenantId: number,
  principalId: string,
) {
  return createHash("sha256")
    .update(JSON.stringify([origin, tenantId, principalId]))
    .digest("hex");
}
export const credentialKey = (id: string) => `savia.plugin-authoring.${id}`;
export class ConnectionManager {
  current: ActiveConnection | undefined;
  private generation = 0;
  private pending = new Set<PluginDevelopmentClient>();
  private writes: Promise<void> = Promise.resolve();
  constructor(
    private secrets: CredentialStorage,
    private transport: Transport = fetch,
  ) {}
  private changed(): never {
    throw new PluginDevelopmentError(
      0,
      "CONNECTION_CHANGED",
      "The connection changed. Select it again.",
    );
  }
  private enqueue(write: () => Promise<void>) {
    const result = this.writes.then(write);
    this.writes = result.catch(() => {});
    return result;
  }
  async connect(
    origin: string,
    tenantId: number,
    token: string,
    expectedPrincipal?: string,
  ): Promise<ActiveConnection> {
    const generation = ++this.generation;
    this.current?.client.dispose();
    this.current = undefined;
    for (const request of this.pending) request.dispose();
    const probe = new PluginDevelopmentClient(
      { id: "pending", origin, tenantId, principalId: expectedPrincipal },
      async () => token,
      this.transport,
    );
    this.pending.add(probe);
    try {
      const capabilities = await probe.capabilities();
      if (generation !== this.generation) this.changed();
      const profile = {
        id: profileIdentity(origin, tenantId, capabilities.principalId),
        origin,
        tenantId,
        principalId: capabilities.principalId,
      };
      await this.enqueue(async () => {
        if (generation !== this.generation) this.changed();
        await this.secrets.store(credentialKey(profile.id), token);
      });
      if (generation !== this.generation) this.changed();
      const client = new PluginDevelopmentClient(
        profile,
        () => this.secrets.get(credentialKey(profile.id)),
        this.transport,
      );
      const connection = { profile, capabilities, client };
      this.current = connection;
      return connection;
    } finally {
      probe.dispose();
      this.pending.delete(probe);
    }
  }
  async reconnect(profile: ConnectionProfile): Promise<ActiveConnection> {
    if (
      !profile.principalId ||
      profile.id !==
        profileIdentity(profile.origin, profile.tenantId, profile.principalId)
    )
      throw new Error("Invalid saved connection profile.");
    const token = await this.secrets.get(credentialKey(profile.id));
    if (!token) throw new Error("Reconnect with a personal API key.");
    const connection = await this.connect(
      profile.origin,
      profile.tenantId,
      token,
      profile.principalId,
    );
    if (connection.profile.principalId !== profile.principalId) {
      await this.disconnect();
      throw new Error("The connection identity changed. Reconnect.");
    }
    return connection;
  }
  async disconnect() {
    ++this.generation;
    const previous = this.current;
    this.current = undefined;
    previous?.client.dispose();
    for (const request of this.pending) request.dispose();
    if (previous)
      await this.enqueue(async () => {
        await this.secrets.delete(credentialKey(previous.profile.id));
      });
  }
  dispose() {
    ++this.generation;
    this.current?.client.dispose();
    this.current = undefined;
    for (const request of this.pending) request.dispose();
  }
}
