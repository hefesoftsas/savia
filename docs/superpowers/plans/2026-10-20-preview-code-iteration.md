# Preview code iteration

Goal: reduce the time from a small verified change to shared Preview, without
bypassing managed deployment or losing failed-release recovery.

1. Select focused CI for isolated Auth, API and shared backup-gate changes;
   retain the trusted-base classifier and fail closed for unknown changes.
2. Derive code-only publication from the cumulative verified deployed ancestor.
   Bind targets and source revisions to the immutable artifact digest. Keep all
   resource configurations frozen and validated.
3. Publish only affected existing Workers for eligible source updates. Skip data
   backup/migration, Flows pause/drain and secrets; retain Auth initialization,
   health verification and Worker-version rollback. Full releases remain required
   for configuration, schema, infrastructure, dependencies and unknown changes.
4. Skip Office and store-plugin publication when cumulative paths are unchanged.
5. Fix full-release secret staging after rollback and preserve bounded private
   diagnostics when Auth initialization fails. Preserve renewal cookies during
   transient provider outages.
6. Run classifier, artifact, publisher/recovery and renewal regressions. Merge
   through managed CI, deploy Preview, measure release stages and authentication,
   and verify a real browser session. Report actual measurements separately from
   anticipated improvements in subsequent eligible releases.
