CREATE TRIGGER notification_record_insert AFTER INSERT ON crm_records
BEGIN
INSERT INTO notification_events(id,scope_kind,scope_id,event_key,payload,created_at)
SELECT 'ntf_'||lower(hex(randomblob(8))),'workspace',NEW.tenant_id,
 'record:'||NEW.tenant_id||':'||NEW.object_name||':'||NEW.id||':'||NEW.version,
 json_object('scope',json_object('kind','workspace','id',NEW.tenant_id),'key','record:'||NEW.tenant_id||':'||NEW.object_name||':'||NEW.id||':'||NEW.version,
 'actor',json_object('kind',COALESCE((SELECT actor_kind FROM crm_record_history_context WHERE tenant_id=NEW.tenant_id),'system'),'id',(SELECT actor_id FROM crm_record_history_context WHERE tenant_id=NEW.tenant_id)),
 'source',json_object('kind','record','collection',NEW.object_name,'id',NEW.id,'operation','created'),
 'title',NEW.object_name||' created','body','',
 'audience',json_object('kind','collection-followers','collection',NEW.object_name),
 'createdAt',CAST(strftime('%s','now') AS INTEGER)*1000,'expiresAt',json('null')),
 CAST(strftime('%s','now') AS INTEGER)*1000
WHERE EXISTS(SELECT 1 FROM notification_subscriptions WHERE workspace_id=NEW.tenant_id AND collection=NEW.object_name);
END;
--> statement-breakpoint
CREATE TRIGGER notification_record_update AFTER UPDATE ON crm_records
WHEN OLD.data IS NOT NEW.data OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
BEGIN
INSERT INTO notification_events(id,scope_kind,scope_id,event_key,payload,created_at)
SELECT 'ntf_'||lower(hex(randomblob(8))),'workspace',NEW.tenant_id,
 'record:'||NEW.tenant_id||':'||NEW.object_name||':'||NEW.id||':'||NEW.version,
 json_object('scope',json_object('kind','workspace','id',NEW.tenant_id),'key','record:'||NEW.tenant_id||':'||NEW.object_name||':'||NEW.id||':'||NEW.version,
 'actor',json_object('kind',COALESCE((SELECT actor_kind FROM crm_record_history_context WHERE tenant_id=NEW.tenant_id),'system'),'id',(SELECT actor_id FROM crm_record_history_context WHERE tenant_id=NEW.tenant_id)),
 'source',json_object('kind','record','collection',NEW.object_name,'id',NEW.id,'operation',
  CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'deleted' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'created' ELSE 'updated' END),
 'title',NEW.object_name||' '||CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'deleted' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restored' ELSE 'updated' END,'body','',
 'audience',json_object('kind','collection-followers','collection',NEW.object_name),
 'createdAt',CAST(strftime('%s','now') AS INTEGER)*1000,'expiresAt',json('null')),
 CAST(strftime('%s','now') AS INTEGER)*1000
WHERE EXISTS(SELECT 1 FROM notification_subscriptions WHERE workspace_id=NEW.tenant_id AND collection=NEW.object_name);
END;
--> statement-breakpoint
CREATE TRIGGER notification_record_purge AFTER DELETE ON crm_records
BEGIN
INSERT INTO notification_events(id,scope_kind,scope_id,event_key,payload,created_at)
SELECT 'ntf_'||lower(hex(randomblob(8))),'workspace',OLD.tenant_id,
 'record:'||OLD.tenant_id||':'||OLD.object_name||':'||OLD.id||':purged',
 json_object('scope',json_object('kind','workspace','id',OLD.tenant_id),'key','record:'||OLD.tenant_id||':'||OLD.object_name||':'||OLD.id||':purged',
 'actor',json_object('kind','system','id',NULL),
 'source',json_object('kind','record','collection',OLD.object_name,'id',OLD.id,'operation','deleted'),
 'title',OLD.object_name||' deleted','body','',
 'audience',json_object('kind','collection-followers','collection',OLD.object_name),
 'createdAt',CAST(strftime('%s','now') AS INTEGER)*1000,'expiresAt',json('null')),
 CAST(strftime('%s','now') AS INTEGER)*1000
WHERE EXISTS(SELECT 1 FROM notification_subscriptions WHERE workspace_id=OLD.tenant_id AND collection=OLD.object_name);
END;
--> statement-breakpoint
CREATE TRIGGER notification_event_fanout AFTER INSERT ON notification_events
BEGIN
INSERT OR IGNORE INTO notification_deliveries(id,event_id,scope_kind,scope_id,recipient_id,created_at)
SELECT 'dlv_'||NEW.id||'_'||s.principal_id,NEW.id,NEW.scope_kind,NEW.scope_id,s.principal_id,NEW.created_at
FROM notification_subscriptions s
WHERE s.workspace_id=NEW.scope_id
 AND s.collection=json_extract(NEW.payload,'$.audience.collection')
 AND json_extract(NEW.payload,'$.audience.kind')='collection-followers'
 AND (json_extract(NEW.payload,'$.actor.id') IS NULL OR s.principal_id<>json_extract(NEW.payload,'$.actor.id'));
END;
