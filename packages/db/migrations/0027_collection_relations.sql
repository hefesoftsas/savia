CREATE TABLE crm_collection_relations (
 tenant_id TEXT NOT NULL, id TEXT NOT NULL,
 source_object TEXT NOT NULL, target_object TEXT NOT NULL,
 source_label TEXT NOT NULL, target_label TEXT NOT NULL,
 cardinality TEXT NOT NULL CHECK(cardinality IN ('one-to-one','one-to-many','many-to-many')),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,source_object) REFERENCES crm_objects(tenant_id,name) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,target_object) REFERENCES crm_objects(tenant_id,name) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE crm_record_links (
 tenant_id TEXT NOT NULL, relation_id TEXT NOT NULL, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,relation_id,source_id,target_id),
 FOREIGN KEY(tenant_id,relation_id) REFERENCES crm_collection_relations(tenant_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX crm_record_links_incoming ON crm_record_links(tenant_id,relation_id,target_id,source_id);
--> statement-breakpoint
CREATE TRIGGER crm_record_links_cardinality BEFORE INSERT ON crm_record_links
BEGIN
 SELECT RAISE(ABORT,'relation_cardinality_conflict') WHERE EXISTS (
 SELECT 1 FROM crm_collection_relations r JOIN crm_record_links e ON e.tenant_id=r.tenant_id AND e.relation_id=r.id
 WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.relation_id
 AND ((r.cardinality='one-to-one' AND e.source_id=NEW.source_id AND e.target_id<>NEW.target_id)
 OR (r.cardinality IN ('one-to-one','one-to-many') AND e.target_id=NEW.target_id AND e.source_id<>NEW.source_id))
 );
END;
