# Identity email uniqueness

Savia prevents a new active principal from using another active principal's email. The comparison trims surrounding spaces and ignores case. The rule spans authentication issuers: a matching email alone never links accounts or transfers roles.

The identity repository checks before an authentication principal is created or changes email. User provisioning checks before creating the Better Auth account or sending a password setup message. A conflict returns HTTP 409 with code `IDENTITY_EMAIL_CONFLICT`; administrators must resolve the conflicting identity explicitly. Successful repeat logins with the same issuer and subject retain the principal ID and assignments. An inactive principal is not automatically reactivated by login.

SQLite migration `0078_identity_principal_email_uniqueness.sql` and PostgreSQL migration `0020_identity_principal_email_uniqueness.sql` add database guards for inserts, changes to an active email and reactivation. Database enforcement covers concurrent requests as well as application checks. Deploy the migration with the API change.

The migrations deliberately leave historical duplicate principals intact. Their existing same-subject logins and profile updates continue to work; no privileges, memberships or audit references are merged or deleted. Resolve those duplicates only after checking the authoritative authentication account and each principal's assignments. A display name or email is not enough evidence to delete an identity.

Regression coverage: `apps/api/test/identity.test.ts` and `scripts/identity-email-uniqueness.test.mjs`.
