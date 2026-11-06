export function discordApplicationLinks(applicationId: string) {
  const encodedId = encodeURIComponent(applicationId);
  const invitation = new URL("https://discord.com/oauth2/authorize");
  invitation.searchParams.set("client_id", applicationId);
  invitation.searchParams.set("scope", "bot applications.commands");
  invitation.searchParams.set("permissions", "2048");
  return {
    generalInfoUrl: applicationId
      ? `https://discord.com/developers/applications/${encodedId}/information`
      : "https://discord.com/developers/applications",
    botSettingsUrl: applicationId
      ? `https://discord.com/developers/applications/${encodedId}/bot`
      : "https://discord.com/developers/applications",
    inviteUrl: applicationId ? invitation.href : null,
  };
}
