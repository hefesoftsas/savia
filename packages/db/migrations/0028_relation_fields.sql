ALTER TABLE crm_collection_relations ADD COLUMN source_field TEXT NOT NULL DEFAULT 'id';
--> statement-breakpoint
ALTER TABLE crm_collection_relations ADD COLUMN target_field TEXT NOT NULL DEFAULT 'id';
--> statement-breakpoint
ALTER TABLE crm_collection_relations ADD COLUMN source_display_field TEXT;
--> statement-breakpoint
ALTER TABLE crm_collection_relations ADD COLUMN target_display_field TEXT;
--> statement-breakpoint
ALTER TABLE crm_collection_relations ADD COLUMN storage TEXT NOT NULL DEFAULT 'local' CHECK(storage IN ('local','fields'));
--> statement-breakpoint
ALTER TABLE crm_collection_relations ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TABLE crm_native_relation_overrides(tenant_id TEXT NOT NULL,id TEXT NOT NULL,config TEXT NOT NULL CHECK(json_valid(config)),version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(tenant_id,id));
--> statement-breakpoint
CREATE TRIGGER crm_relation_definition_update BEFORE UPDATE ON crm_collection_relations
BEGIN
 SELECT RAISE(ABORT,'relation_mapping_has_links') WHERE (NEW.source_field<>OLD.source_field OR NEW.target_field<>OLD.target_field OR NEW.storage<>OLD.storage) AND EXISTS(SELECT 1 FROM crm_record_links WHERE tenant_id=OLD.tenant_id AND relation_id=OLD.id);
 SELECT RAISE(ABORT,'relation_cardinality_conflict') WHERE (NEW.cardinality='one-to-one' AND EXISTS(SELECT 1 FROM crm_record_links WHERE tenant_id=OLD.tenant_id AND relation_id=OLD.id GROUP BY source_id HAVING count(*)>1)) OR (NEW.cardinality IN ('one-to-one','one-to-many') AND EXISTS(SELECT 1 FROM crm_record_links WHERE tenant_id=OLD.tenant_id AND relation_id=OLD.id GROUP BY target_id HAVING count(*)>1));
END;
--> statement-breakpoint
CREATE TRIGGER crm_record_links_storage BEFORE INSERT ON crm_record_links
BEGIN
 SELECT RAISE(ABORT,'relation_mapping_has_links') WHERE EXISTS(SELECT 1 FROM crm_collection_relations WHERE tenant_id=NEW.tenant_id AND id=NEW.relation_id AND storage<>'local');
END;
