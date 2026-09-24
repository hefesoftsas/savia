CREATE TABLE notification_events (
 id TEXT PRIMARY KEY, scope_kind TEXT NOT NULL CHECK(scope_kind IN ('workspace','account')), scope_id TEXT NOT NULL,
 event_key TEXT NOT NULL, payload TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
 cursor TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_retry BIGINT NOT NULL DEFAULT 0,
 lease_token TEXT, lease_until BIGINT NOT NULL DEFAULT 0, error TEXT,
 UNIQUE(scope_kind,scope_id,event_key)
);
CREATE INDEX notification_events_due ON notification_events(status,next_retry,lease_until,created_at,id);
CREATE TABLE notification_deliveries (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES notification_events(id),
 scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
 channel TEXT NOT NULL DEFAULT 'in-app' CHECK(channel='in-app'), created_at BIGINT NOT NULL,
 read_at BIGINT, archived_at BIGINT, resolved_at BIGINT,
 UNIQUE(event_id,recipient_id,channel)
);
CREATE INDEX notification_inbox ON notification_deliveries(recipient_id,scope_kind,scope_id,created_at DESC,id DESC);
CREATE INDEX notification_unread ON notification_deliveries(recipient_id,scope_kind,scope_id,read_at,archived_at);
CREATE TABLE notification_recipient_retries (
 event_id TEXT NOT NULL REFERENCES notification_events(id), recipient_id TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, next_retry BIGINT NOT NULL, error TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','failed')),
 PRIMARY KEY(event_id,recipient_id)
);
CREATE INDEX notification_retries_due ON notification_recipient_retries(status,next_retry,event_id);
CREATE TABLE notification_subscriptions (
 workspace_id TEXT NOT NULL, principal_id TEXT NOT NULL, collection TEXT NOT NULL,
 created_at BIGINT NOT NULL, PRIMARY KEY(workspace_id,principal_id,collection)
);
CREATE INDEX notification_followers ON notification_subscriptions(workspace_id,collection,principal_id,created_at);
CREATE TABLE notification_admin_audit (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 event_id TEXT NOT NULL, action TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE INDEX notification_audit_scope ON notification_admin_audit(workspace_id,created_at,id);
CREATE TABLE notification_send_limits (
 workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, window_start BIGINT NOT NULL,
 count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 10), PRIMARY KEY(workspace_id,actor_id,window_start)
);
CREATE TABLE notification_scope_settings (
 workspace_id TEXT PRIMARY KEY, read_days INTEGER NOT NULL DEFAULT 90 CHECK(read_days BETWEEN 7 AND 365),
 unread_days INTEGER NOT NULL DEFAULT 180 CHECK(unread_days BETWEEN 30 AND 730 AND unread_days>=read_days)
);
CREATE TABLE notification_maintenance_checkpoints (name TEXT PRIMARY KEY, cursor TEXT NOT NULL);
