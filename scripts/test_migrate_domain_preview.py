import importlib.util
from contextlib import contextmanager
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('migration', Path(__file__).with_name('migrate-domain-preview.py'))
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

@contextmanager
def connection(path):
    db = sqlite3.connect(path)
    try:
        with db:
            yield db
    finally:
        db.close()

SCHEMA = '''
CREATE TABLE agencies(id INTEGER PRIMARY KEY, name TEXT, id_slug TEXT);
CREATE TABLE customer_client(id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE customer_clientagency(id INTEGER PRIMARY KEY, client_id INTEGER REFERENCES customer_client(id), agency_id INTEGER REFERENCES agencies(id));
CREATE TABLE identity_principal(id TEXT PRIMARY KEY, issuer TEXT, subject TEXT, email TEXT, display_name TEXT, is_active INTEGER, created_at TEXT, updated_at TEXT);
CREATE TABLE identity_global_role(principal_id TEXT REFERENCES identity_principal(id), role TEXT);
CREATE TABLE identity_agency_membership(principal_id TEXT REFERENCES identity_principal(id), agency_id INTEGER REFERENCES agencies(id));
CREATE TABLE agency_crm_connections(id TEXT PRIMARY KEY, agency_id INTEGER REFERENCES agencies(id), created_by_principal_id TEXT REFERENCES identity_principal(id), provider TEXT, status TEXT, nango_connection_id TEXT);
CREATE TABLE customer_crm_sync_records(agency_id INTEGER REFERENCES agencies(id), customer_profile_id INTEGER REFERENCES customer_clientagency(id), external_object_id TEXT);
CREATE TABLE personal_integration_connections(id TEXT PRIMARY KEY, secret TEXT);
CREATE TABLE user_user(id INTEGER PRIMARY KEY, password TEXT);
CREATE TABLE crm_objects(tenant_id TEXT,name TEXT, PRIMARY KEY(tenant_id,name));
CREATE TABLE crm_records(id TEXT,tenant_id TEXT,object_name TEXT,data TEXT,PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,object_name) REFERENCES crm_objects(tenant_id,name));
CREATE TABLE crm_data_domains(id TEXT PRIMARY KEY,label TEXT);
CREATE TABLE server_id_sequences(resource TEXT PRIMARY KEY,next_id INTEGER);
'''

class MigrationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.source, self.preview = self.root/'source.db', self.root/'preview.db'
        for path in (self.source,self.preview):
            with connection(path) as c: c.executescript(SCHEMA)
        with connection(self.source) as c:
            c.executescript("""
            INSERT INTO agencies VALUES(1,'Real','real');
            INSERT INTO customer_client VALUES(55,'Original');
            INSERT INTO customer_clientagency VALUES(88,55,1);
            INSERT INTO identity_principal VALUES('source','real-login','secret-subject','real@example.test','Real person',1,'2020','2020');
            INSERT INTO identity_global_role VALUES('source','platform_admin');
            INSERT INTO agency_crm_connections VALUES('connection',1,'source','hubspot','connected','nango-ref');
            INSERT INTO customer_crm_sync_records VALUES(1,88,'external-ref');
            INSERT INTO personal_integration_connections VALUES('secret','do-not-copy');
            """)
        with connection(self.preview) as c:
            c.executescript("""
            INSERT INTO agencies VALUES(1,'Demo','demo');
            INSERT INTO identity_principal VALUES('local','local-login','local-subject','local@example.test','Local',1,'2020','2020');
            INSERT INTO identity_global_role VALUES('local','platform_admin');
            INSERT INTO crm_data_domains VALUES('projects','Projects');
            INSERT INTO crm_objects VALUES('domain:projects','projects'),('domain:platform','agencias'),('agency:1','clients');
            INSERT INTO crm_records VALUES('project','domain:projects','projects','{}'),('1','domain:platform','agencias','{"demo":true}'),('demo','agency:1','clients','{}');
            """)
    def tearDown(self): self.tmp.cleanup()
    def run_migration(self):
        return module.migrate(self.source,self.preview,self.root/'output.db',self.root/'backup.db',self.root/'report.json')
    def test_preserves_source_ids_custom_domains_local_access_and_no_source_secrets(self):
        before=(self.source.read_bytes(),self.preview.read_bytes())
        report=self.run_migration()
        with connection(self.root/'output.db') as c:
            self.assertEqual(c.execute('SELECT id,name FROM agencies').fetchall(),[(1,'Real')])
            self.assertEqual(c.execute('SELECT * FROM customer_clientagency').fetchall(),[(88,55,1)])
            self.assertEqual(c.execute('SELECT id FROM crm_records').fetchall(),[('project',)])
            self.assertEqual(c.execute('SELECT * FROM identity_global_role').fetchall(),[('local','platform_admin')])
            self.assertEqual(c.execute("SELECT issuer,is_active FROM identity_principal WHERE id='source'").fetchone(),('urn:savia:local-import',0))
            self.assertEqual(c.execute('SELECT count(*) FROM personal_integration_connections').fetchone()[0],0)
            self.assertEqual(c.execute('SELECT count(*) FROM agency_crm_connections').fetchone()[0],1)
            self.assertEqual(c.execute('PRAGMA foreign_key_check').fetchall(),[])
        self.assertEqual(before,(self.source.read_bytes(),self.preview.read_bytes()))
        self.assertEqual(report['foreign_keys']['introduced'],0)
        self.assertNotIn('nango-ref',json.dumps(report))
        self.assertEqual((self.root/'output.db').stat().st_mode & 0o777,0o600)
    def test_refuses_overwrite_or_source_as_output(self):
        with self.assertRaises(ValueError): module.migrate(self.source,self.preview,self.source,self.root/'backup.db',self.root/'report.json')
        self.assertFalse((self.root/'backup.db').exists())
    def test_distinguishes_existing_source_orphans(self):
        with connection(self.source) as c: c.execute('INSERT INTO customer_clientagency VALUES(99,999,1)')
        report=self.run_migration()
        self.assertEqual(report['foreign_keys']['source'],1)
        self.assertEqual(report['foreign_keys']['introduced'],0)
    def test_rejects_membership_collision_instead_of_granting_new_agency_access(self):
        with connection(self.preview) as c: c.execute("INSERT INTO identity_agency_membership VALUES('local',1)")
        with self.assertRaisesRegex(ValueError,'membership'): self.run_migration()
        self.assertFalse((self.root/'output.db').exists())
    def test_rejects_nonempty_legacy_password_table(self):
        with connection(self.source) as c: c.execute("INSERT INTO user_user VALUES(1,'hash')")
        with self.assertRaisesRegex(ValueError,'user_user'): self.run_migration()

if __name__=='__main__': unittest.main()
