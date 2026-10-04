# Share records with Slack and Microsoft Teams

Owner: Savia platform maintainers. Reviewed: 2026-10-04.

## Scope

This first version shares an existing Studio record with a channel selected by
the user. It adds Slack and Microsoft Teams to personal connections and uses
Nango for OAuth and provider requests. It does not ingest conversation history,
run autonomous notifications, or install a conversational Teams bot.

Slack sends as the Savia app's bot in a workspace authorized by the caller.
Microsoft Teams sends as the connected work or school user through delegated
Microsoft Graph permissions. A personal Microsoft account is not supported for
Teams channel messages. A connection to Outlook alone does not enable Teams.

## User flow

1. Open **Integrations**, connect Slack or Microsoft Teams, and complete OAuth.
2. Open an existing record and choose **Share to chat**.
3. Select the provider and channel. Teams channels include their team name.
4. Review the title, summary, and link, then submit the share.

The message copies the reviewed text into the selected channel. Recipients still
need their own Savia access to open the record link; sharing does not grant it.
Channel membership determines who can read the copied text. Reconnect an expired
connection from Integrations before trying again.

The backend rechecks access to the referenced record and fields before sending.
OAuth credentials remain in Nango and the backend resolves the caller's saved
connection. Channel lists and message drafts are not persisted in browser
storage. Durable request identifiers prevent a repeated submission from sending
the same request again. If delivery is uncertain, check the destination before
starting a new share; the server does not blindly retry an ambiguous send.

## Configure Nango

Create integrations independently in the Nango environment used by the backend.
The integration IDs below are recommended names, not credentials:

| Provider        | Nango provider  | Integration ID    | Backend variable                       |
| --------------- | --------------- | ----------------- | -------------------------------------- |
| Slack           | Slack           | `slack`           | `NANGO_SLACK_INTEGRATION_ID`           |
| Microsoft Teams | Microsoft Teams | `microsoft-teams` | `NANGO_MICROSOFT_TEAMS_INTEGRATION_ID` |

Use the environment's existing `NANGO_BASE_URL`, `NANGO_CONNECT_URL`, and
`NANGO_API_KEY`. Configure the OAuth callback shown by that Nango installation.
For the inspected self-hosted installation it is
`https://nango.cloud.hefesoft.com/oauth/callback`, not Nango Cloud's callback.

### Slack

Create a Slack app in the intended workspace using the
[prepared manifest](../../infra/nango/slack-app-manifest.json). Adjust its redirect
URL when deploying another Nango installation. Use distinct app credentials for
development and production where those environments must be isolated.

Configure the app's Client ID and Client secret directly in Nango, with bot scopes
`channels:read`, `groups:read`, and `chat:write`. The app does not request channel
history or the ability to post into every public channel. Invite Savia into the
channels intended for sharing. Install/authorize from Savia so the connection is
bound to the authenticated principal; a dashboard test connection alone is not a
Savia personal connection.

Nango's Slack proxy uses the bot token by default. This is intentional: the
message author is Savia, not an impersonated human. See the official
[Slack setup guide](https://nango.dev/docs/api-integrations/slack/how-to-register-your-own-slack-api-oauth-app)
and [Nango token behavior](https://nango.dev/docs/api-integrations/slack/slack-user-access-tokens).

### Microsoft Teams

Register an application in the intended Microsoft Entra directory. Choose account
types appropriate to the deployment: a single organization for an internal app,
or organizational multitenancy for customers in other Microsoft 365 tenants.
Add a **Web** redirect URI matching Nango's callback. Configure its client ID and
secret in the Microsoft Teams integration in Nango.

Request delegated permissions `User.Read`, `Team.ReadBasic.All`,
`Channel.ReadBasic.All`, and `ChannelMessage.Send`, plus `offline_access` for
refresh. The organization's consent policies can require an administrator.
The person connecting must have access to the destination team/channel.

Do not use `Teamwork.Migrate.All` for routine notifications. Autonomous messages
from a Savia Teams bot require a separate app installation and bot delivery flow;
they are outside this MVP. See [Nango setup](https://nango.dev/docs/api-integrations/microsoft-teams/how-to-register-your-own-microsoft-teams-api-oauth-app)
and [Graph channel message permissions](https://learn.microsoft.com/en-us/graph/api/channel-post-messages?view=graph-rest-1.0).

## Enable an environment

Set the two integration ID variables only after the matching Nango integrations
and OAuth applications are ready. Hosted preview and production workflows pass
their GitHub environment variables to the API configuration renderer. The
providers stay unavailable when their IDs are unset. Self-hosted deployments
accept the same backend environment variables. Local development can put them in
the gitignored `infra/secrets/assistant-api.dev.env`.

Apply the database migrations before running the new API. Deployment configuration
contains only integration IDs; keep all secrets in backend secret storage and
Nango. The frontend must never receive `NANGO_API_KEY` or OAuth client secrets.

## Live acceptance

With an authorized test account and an explicitly selected test channel:

1. Connect each provider from Savia and confirm only that caller sees the connection.
2. List channels, including subsequent pages where available.
3. Share a harmless test record once and verify the title, summary and working link.
4. Confirm another caller cannot reuse the connection or share an inaccessible record.
5. Repeat the same request identifier and verify no duplicate message is posted.
6. Disconnect or revoke authorization and verify the reconnect/unavailable behavior.

Automated tests use provider fixtures. They do not establish OAuth consent or
prove delivery to a live Slack workspace or Microsoft 365 organization.
