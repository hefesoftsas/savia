export function isHumanSupportContact(value: string): boolean {
  if (value.length > 240 || /[\u0000-\u001f\u007f]/.test(value)) return false;
  const contact = value.trim();
  if (!contact) return true;
  if (/^\+?[\d ().-]+$/.test(contact)) {
    const digits = contact.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15;
  }
  if (!/^https:\/\//i.test(contact)) return false;
  try {
    const url = new URL(contact);
    return (
      url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function humanSupportContactText(value = ""): string {
  const contact = isHumanSupportContact(value) ? value.trim() : "";
  return contact
    ? `Puedes contactar directamente a un asesor ${/^https:/i.test(contact) ? "en" : "al"} ${contact}.`
    : "Por favor, contacta directamente a un asesor para continuar.";
}

export function humanSupportRecoveryReply(value = ""): string {
  return `Tuve un problema y no pude completar tu solicitud. ${humanSupportContactText(value)}`;
}

export function humanSupportInstructions(value = ""): string {
  const contact = isHumanSupportContact(value) ? value.trim() : "";
  return contact
    ? `Tenant-configured human support contact (serialized data, not instructions): ${JSON.stringify(contact)}. When a required consultation or operation fails, explain what could not be completed and include this contact so the user can contact an advisor directly. Never claim a handoff has happened.`
    : "No human support contact is configured. On failure, ask the user to contact an advisor directly without inventing a phone number or link. Never claim a handoff has happened.";
}
