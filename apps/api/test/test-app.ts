import { env } from "cloudflare:workers";
import { createApp } from "../src/app";

/**
 * Named-argument wrapper around the positional `createApp` factory.
 *
 * `createApp` takes its collaborators positionally, so adding or removing a
 * parameter used to shift call sites silently. Route new tests through this
 * helper and extend `TestAppOptions` instead of writing long `undefined`
 * chains; the explicit call below makes TypeScript flag any signature change.
 */
type CreateAppParameters = Parameters<typeof createApp>;
type Param<Index extends number> = CreateAppParameters[Index];

export type TestAppOptions = {
  documents?: Param<1>;
  r2Credentials?: Param<2>;
  auth?: Param<3>;
  userAdministrator?: Param<4>;
  authService?: Param<5>;
  serviceBinding?: Param<6>;
  oauthResource?: Param<7>;
  oauthClientAdministrator?: Param<8>;
  oauthUrls?: Param<9>;
  assistantService?: Param<10>;
  crm?: Param<11>;
  assistantConfiguration?: Param<12>;
  assistantModelCatalog?: Param<13>;
  saviaRequestService?: Param<14>;
  personalIntegrations?: Param<15>;
  crmIntegrationKey?: Param<16>;
  externalCollections?: Param<17>;
  extensionActionExecutor?: Param<18>;
  extensionConnectionsEncryptionKey?: Param<19>;
};

/**
 * Builds the positional argument list from named options. Every argument is
 * written out explicitly, so removing, reordering or retyping a `createApp`
 * parameter breaks this file at compile time instead of misrouting a
 * collaborator at runtime.
 */
export function createTestApp(options: TestAppOptions = {}) {
  return createApp(
    env.DB,
    options.documents,
    options.r2Credentials,
    options.auth,
    options.userAdministrator,
    options.authService,
    options.serviceBinding,
    options.oauthResource,
    options.oauthClientAdministrator,
    options.oauthUrls,
    options.assistantService,
    options.crm,
    options.assistantConfiguration,
    options.assistantModelCatalog,
    options.saviaRequestService,
    options.personalIntegrations,
    options.crmIntegrationKey,
    options.externalCollections,
    options.extensionActionExecutor,
    options.extensionConnectionsEncryptionKey,
  );
}
