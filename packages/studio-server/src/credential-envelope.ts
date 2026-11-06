/** Migration metadata belongs to a ciphertext, never to workspace resolution. */
export function readCredentialEnvelope(
  value: string,
  context: string,
): { value: string; aad: string } {
  if (!value.startsWith("{")) return { value, aad: context };
  const envelope: unknown = JSON.parse(value);
  if (
    !envelope ||
    typeof envelope !== "object" ||
    !("version" in envelope) ||
    envelope.version !== 2 ||
    !("context" in envelope) ||
    envelope.context !== context ||
    !("aad" in envelope) ||
    typeof envelope.aad !== "string" ||
    !("value" in envelope) ||
    typeof envelope.value !== "string"
  )
    throw new Error("Credential context does not match the tenant.");
  return { value: envelope.value, aad: envelope.aad };
}
