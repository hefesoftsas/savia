CREATE TABLE realtime_event_outbox (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  principal_id TEXT NOT NULL,
  topic TEXT NOT NULL CHECK (topic IN ('assistant-threads', 'request-pages')),
  type TEXT NOT NULL CHECK (type IN ('created', 'updated', 'deleted')),
  collection TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX realtime_event_outbox_principal_cursor
  ON realtime_event_outbox(principal_id, event_id);
--> statement-breakpoint
CREATE INDEX realtime_event_outbox_pending
  ON realtime_event_outbox(published_at, next_attempt_at, event_id);
--> statement-breakpoint
CREATE TABLE realtime_event_retention (
  principal_id TEXT PRIMARY KEY NOT NULL,
  expired_through INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER assistant_threads_realtime_insert
AFTER INSERT ON assistant_threads
BEGIN
  INSERT INTO realtime_event_outbox
    (principal_id, topic, type, collection, resource_id, created_at)
  VALUES
    (NEW.user_id, 'assistant-threads', 'created', 'threads', NEW.id,
     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER assistant_threads_realtime_update
AFTER UPDATE ON assistant_threads
BEGIN
  INSERT INTO realtime_event_outbox
    (principal_id, topic, type, collection, resource_id, created_at)
  VALUES
    (NEW.user_id, 'assistant-threads', 'updated', 'threads', NEW.id,
     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER assistant_threads_realtime_delete
AFTER DELETE ON assistant_threads
BEGIN
  INSERT INTO realtime_event_outbox
    (principal_id, topic, type, collection, resource_id, created_at)
  VALUES
    (OLD.user_id, 'assistant-threads', 'deleted', 'threads', OLD.id,
     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER request_page_runs_realtime_insert
AFTER INSERT ON request_page_runs
WHEN NEW.status IN ('complete', 'failed')
BEGIN
  INSERT INTO realtime_event_outbox
    (principal_id, topic, type, collection, resource_id, created_at)
  VALUES
    (NEW.principal_id, 'request-pages', 'created', NEW.page_name, NEW.id,
     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
--> statement-breakpoint
CREATE TRIGGER request_page_runs_realtime_status
AFTER UPDATE OF status ON request_page_runs
WHEN NEW.status != OLD.status AND NEW.status IN ('complete', 'failed')
BEGIN
  INSERT INTO realtime_event_outbox
    (principal_id, topic, type, collection, resource_id, created_at)
  VALUES
    (NEW.principal_id, 'request-pages', 'updated', NEW.page_name, NEW.id,
     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
