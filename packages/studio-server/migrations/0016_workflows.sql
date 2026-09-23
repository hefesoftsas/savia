CREATE TABLE workflows (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
 definition TEXT NOT NULL CHECK(json_valid(definition)), revision INTEGER NOT NULL DEFAULT 1,
 enabled INTEGER NOT NULL DEFAULT 0, published_version TEXT, created_by TEXT NOT NULL,
 next_run_at INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE workflow_versions (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, workflow_id TEXT NOT NULL,
 definition TEXT NOT NULL CHECK(json_valid(definition)), owner_id TEXT NOT NULL,
 revision INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,workflow_id,revision),
 FOREIGN KEY(workspace_id,workflow_id) REFERENCES workflows(workspace_id,id)
);
CREATE TABLE workflow_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL, collection TEXT NOT NULL,
 kind TEXT NOT NULL, before_state TEXT NOT NULL, after_state TEXT NOT NULL,
 depth INTEGER NOT NULL DEFAULT 0, cause TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE workflow_executions (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, workflow_id TEXT NOT NULL, version_id TEXT NOT NULL,
 owner_id TEXT NOT NULL, initiator_id TEXT NOT NULL, event_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','waiting','completed','failed','blocked','cancelled')),
 node_id TEXT, context TEXT NOT NULL CHECK(json_valid(context)), depth INTEGER NOT NULL DEFAULT 0,
 wake_at INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0, error TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,workflow_id,event_key),
 FOREIGN KEY(workspace_id,version_id) REFERENCES workflow_versions(workspace_id,id)
);
CREATE INDEX workflow_executions_due ON workflow_executions(status,wake_at,lease_until);
CREATE INDEX workflow_executions_history ON workflow_executions(workspace_id,workflow_id,created_at);
CREATE TABLE workflow_jobs (
 workspace_id TEXT NOT NULL, execution_id TEXT NOT NULL, node_id TEXT NOT NULL,
 sequence INTEGER NOT NULL, type TEXT NOT NULL, input TEXT NOT NULL, output TEXT NOT NULL,
 attempts INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(workspace_id,execution_id,node_id),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES workflow_executions(workspace_id,id)
);
CREATE TABLE workflow_tasks (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, execution_id TEXT NOT NULL, node_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('task','notification')), title TEXT NOT NULL, assignee TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')), due_at INTEGER,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,execution_id,node_id),
 FOREIGN KEY(workspace_id,execution_id) REFERENCES workflow_executions(workspace_id,id)
);
CREATE INDEX workflow_tasks_inbox ON workflow_tasks(workspace_id,assignee,status);
CREATE TABLE workflow_write_context (
 workspace_id TEXT NOT NULL, record_id TEXT NOT NULL, depth INTEGER NOT NULL, cause TEXT NOT NULL,
 PRIMARY KEY(workspace_id,record_id)
);
CREATE TRIGGER workflow_record_created AFTER INSERT ON crm_records
 WHEN NEW.deleted_at IS NULL AND EXISTS (
 SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version
 WHERE w.workspace_id=NEW.tenant_id AND w.enabled=1 AND json_extract(v.definition,'$.trigger.type')='created'
 AND json_extract(v.definition,'$.trigger.collection')=NEW.object_name)
 BEGIN
 INSERT INTO workflow_events(workspace_id,collection,kind,before_state,after_state,depth,cause)
 SELECT NEW.tenant_id,NEW.object_name,'created','{}',
 json_set(NEW.data,'$.id',NEW.id,'$._version',NEW.version,'$.created_at',NEW.created_at,'$.updated_at',NEW.updated_at),
 COALESCE(c.depth,0),c.cause FROM (SELECT 1) LEFT JOIN workflow_write_context c ON c.workspace_id=NEW.tenant_id AND c.record_id=NEW.id;
END;
CREATE TRIGGER workflow_record_updated AFTER UPDATE OF data ON crm_records
 WHEN NEW.deleted_at IS NULL AND OLD.deleted_at IS NULL AND NEW.data<>OLD.data AND EXISTS (
 SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version
 WHERE w.workspace_id=NEW.tenant_id AND w.enabled=1 AND json_extract(v.definition,'$.trigger.type')='updated'
 AND json_extract(v.definition,'$.trigger.collection')=NEW.object_name)
 BEGIN
 INSERT INTO workflow_events(workspace_id,collection,kind,before_state,after_state,depth,cause)
 SELECT NEW.tenant_id,NEW.object_name,'updated',
 json_set(OLD.data,'$.id',OLD.id,'$._version',OLD.version,'$.created_at',OLD.created_at,'$.updated_at',OLD.updated_at),
 json_set(NEW.data,'$.id',NEW.id,'$._version',NEW.version,'$.created_at',NEW.created_at,'$.updated_at',NEW.updated_at),
 COALESCE(c.depth,0),c.cause FROM (SELECT 1) LEFT JOIN workflow_write_context c ON c.workspace_id=NEW.tenant_id AND c.record_id=NEW.id;
END;
CREATE TRIGGER workflow_event_dispatch AFTER INSERT ON workflow_events WHEN NEW.depth<5 BEGIN
 INSERT INTO workflow_executions(workspace_id,id,workflow_id,version_id,owner_id,initiator_id,event_key,node_id,context,depth)
 SELECT w.workspace_id,v.id||':'||NEW.id,w.id,v.id,v.owner_id,v.owner_id,'event:'||NEW.id,
 json_extract(v.definition,'$.nodes[0].id'),
 json_object('trigger',json(NEW.after_state),'before',json(NEW.before_state),'steps',json('{}'),
 'system',json_object('owner',v.owner_id,'workspace',w.workspace_id,'event',NEW.id,'cause',NEW.cause)),NEW.depth
 FROM workflows w JOIN workflow_versions v ON v.workspace_id=w.workspace_id AND v.id=w.published_version
 WHERE w.workspace_id=NEW.workspace_id AND w.enabled=1 AND json_extract(v.definition,'$.trigger.type')=NEW.kind
 AND json_extract(v.definition,'$.trigger.collection')=NEW.collection AND (
 NEW.kind='created' OR COALESCE(json_array_length(v.definition,'$.trigger.changedFields'),0)=0 OR EXISTS (
 SELECT 1 FROM json_each(v.definition,'$.trigger.changedFields') f
 WHERE json_extract(NEW.before_state,'$.'||f.value) IS NOT json_extract(NEW.after_state,'$.'||f.value)));
END;
