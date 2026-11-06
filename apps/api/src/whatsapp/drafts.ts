import { PersonalActionPayloadCipher } from "../assistant/personal-action-payload";
import type { EmployeeSession } from "./channel-contracts";
import { WhatsappChannelRepository } from "./channel-repository";

export class ChannelDrafts {
  private readonly cipher: PersonalActionPayloadCipher;
  constructor(
    private readonly repository: WhatsappChannelRepository,
    secret: string,
  ) {
    this.cipher = new PersonalActionPayloadCipher(secret);
  }
  private key(session: EmployeeSession) {
    return `${session.access.connectionId}:${session.access.contact}:${session.access.generation}:${session.employeeId}`;
  }
  async get(session: EmployeeSession): Promise<Record<string, unknown>> {
    const row = await this.repository.db
      .prepare(
        "SELECT draft_json FROM whatsapp_channel_contacts WHERE connection_id=? AND contact=? AND generation=?",
      )
      .bind(
        session.access.connectionId,
        session.access.contact,
        session.access.generation,
      )
      .first<{ draft_json: string | null }>();
    const payload = row?.draft_json
      ? JSON.parse(row.draft_json)[session.employeeId]
      : null;
    if (!payload) return {};
    return this.cipher.unseal({
      actionId: this.key(session),
      principalId: session.access.principalId ?? session.access.contact,
      storedInput: { sealedPayload: payload },
    });
  }
  async save(session: EmployeeSession, patch: Record<string, unknown>) {
    patch = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    const current = await this.repository.getSession(session.access);
    if (
      current?.employeeId !== session.employeeId ||
      current.access.generation !== session.access.generation
    )
      throw new Error("CHANNEL_DRAFT_REVOKED");
    if (JSON.stringify(patch).length > 20000)
      throw new Error("CHANNEL_DRAFT_TOO_LARGE");
    const row = await this.repository.db
      .prepare(
        "SELECT draft_json FROM whatsapp_channel_contacts WHERE connection_id=? AND contact=? AND generation=?",
      )
      .bind(
        session.access.connectionId,
        session.access.contact,
        session.access.generation,
      )
      .first<{ draft_json: string | null }>();
    const all = row?.draft_json ? JSON.parse(row.draft_json) : {};
    const existing = await this.get(session);
    const value = { ...existing, ...patch };
    const previousVehicle = existing.vehicle as
      Record<string, unknown> | undefined;
    const nextVehicle = patch.vehicle as Record<string, unknown> | undefined;
    const newPlate =
      nextVehicle?.plate && previousVehicle?.plate !== nextVehicle.plate;
    for (const field of ["vehicle", "applicant"])
      if (
        patch[field] &&
        typeof patch[field] === "object" &&
        !Array.isArray(patch[field])
      )
        value[field] = {
          ...((field === "vehicle" && newPlate
            ? {}
            : (existing[field] as Record<string, unknown>)) ?? {}),
          ...(patch[field] as Record<string, unknown>),
        };
    if (
      ["vehicle", "applicant"].some(
        (field) =>
          JSON.stringify(value[field]) !== JSON.stringify(existing[field]),
      )
    ) {
      value.consent = false;
      value.consentPrompt = null;
    }
    value.updatedAt = new Date().toISOString();
    all._updatedAt = new Date().toISOString();
    all[session.employeeId] = await this.cipher.seal({
      actionId: this.key(session),
      principalId: session.access.principalId ?? session.access.contact,
      payload: value,
    });
    await this.repository.db
      .prepare(
        "UPDATE whatsapp_channel_contacts SET draft_json=? WHERE connection_id=? AND contact=? AND generation=?",
      )
      .bind(
        JSON.stringify(all),
        session.access.connectionId,
        session.access.contact,
        session.access.generation,
      )
      .run();
    await this.repository.db
      .prepare(
        "UPDATE whatsapp_channel_actions SET status='cancelled' WHERE connection_id=? AND contact=? AND generation=? AND employee_id=? AND status='pending'",
      )
      .bind(
        session.access.connectionId,
        session.access.contact,
        session.access.generation,
        session.employeeId,
      )
      .run();
    return value;
  }
}
