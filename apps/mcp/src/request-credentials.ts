import { timingSafeEqual } from "node:crypto";

export class McpRequestCredentialError extends Error {}

export type DelegatedRequestCredentials = {
  authorization: string;
};

function matchesSecret(expected: string, received: string | null): boolean {
  if (received === null) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return (
    expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes)
  );
}

export function readDelegatedRequestCredentials(
  headers: Headers,
  expectedSecret: string,
): DelegatedRequestCredentials {
  const authorization = headers.get("x-savia-user-authorization")?.trim();
  if (
    expectedSecret.length === 0 ||
    !matchesSecret(expectedSecret, headers.get("x-savia-mcp-secret")) ||
    !authorization ||
    !/^Bearer\s+\S+$/i.test(authorization)
  ) {
    throw new McpRequestCredentialError("MCP request credentials are invalid");
  }

  return { authorization };
}
