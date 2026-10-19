// Compatibility probe only: production ownership must wait for the full lifecycle
// fixture. These identities cannot target an existing application environment.
export function validateFixturePrefix(prefix) {
  if (
    typeof prefix !== "string" ||
    !/^savia-iac-fixture-[a-z0-9]{5,16}$/.test(prefix)
  ) {
    throw new Error("Invalid isolated fixture prefix");
  }
  return prefix;
}

export function fixtureWorkerDefinitions(prefix, accountId) {
  validateFixturePrefix(prefix);
  if (!/^[a-f0-9]{32}$/.test(accountId)) throw new Error("Invalid account ID");
  return ["gateway", "api", "auth", "coordinator"].map((role) => ({
    role,
    args: {
      accountId,
      name: `${prefix}-${role}`,
      force: false,
      subdomain: { enabled: false, previewsEnabled: false },
    },
  }));
}
