#!/usr/bin/env python3
"""Build a verified isolated preview database. Never replaces either input.

Source business table allowlist is deliberately explicit: adding a new source
schema requires a reviewed migration update, never automatic secret discovery.
"""
import argparse
import collections
import json
import os
import sqlite3
import uuid
from pathlib import Path

BUSINESS_TABLES = frozenset("""
agencies
agency_branches
agency_contacts
agency_crm_connections
api_customerfile
api_paymentfile
api_policyfile
api_propertiesfile
api_proposalscarsfile
api_sarlaftfile
app_bank
app_changelog
app_documenttag
app_economicactivity
app_importdata
app_reporthistory
auto_light_quote_offers
auto_light_quote_requests
business_agency_renewal_task_managers
business_agencycomplementarydata
business_agencycompliancemailbox
business_agencycompliancemailbox_reply_authorized_users
business_commercialunit
business_defaultcommission
business_ramorenewalconfiguration
business_renewalconfiguration
business_seller
business_sellercommission
business_sellerdocument
business_sellerdocument_tags
business_sellerlog
categories
cities
claim_claim
claim_claimdocument
claim_claimdocument_tags
claim_claimlog
claim_claimstatus
claim_claimsubstatus
claim_claimtype
claim_coverage
compliance_compliancecancellationreason
compliance_compliancelog
compliance_complianceprogramtype
compliance_compliancerequest
compliance_compliancerequest_tags
compliance_compliancetag
compliance_documentspecification
compliance_processstepemailtemplate
compliance_requestdocument
compliance_requestdocument_tags
constance_constance
countries
customer_address
customer_client
customer_clientagency
customer_clientlog
customer_consortium
customer_crm_sync_records
customer_customersellershare
customer_document
customer_document_tags
customer_group
customer_legalperson
customer_legalpersoncontact
customer_naturalperson
customer_prospect
customer_prospectdocument
customer_prospectdocument_tags
customer_prospectlog
departments
document_ownership
financial_statements_accountnormalization
financial_statements_accountnormalizationfile
financial_statements_financialreportfile
financial_statements_financialreportrequest
financial_statements_financialreportrequest_agencies
financial_statements_financialstatement
help_newsletter
help_newsletterusersurvey
help_request
help_requestcategory
help_requestdocument
help_requestlog
help_trainingcategory
help_trainingvideo
insurance_agencyshare
insurance_beneficiary
insurance_endorsement
insurance_endorsementdocument
insurance_endorsementdocument_tags
insurance_insured
insurance_insurershare
insurance_paymenttaskreminder
insurance_policy
insurance_policydocument
insurance_policydocument_tags
insurance_policylog
insurance_reinvestment
insurance_reinvestmentactivity
insurance_reinvestmentterm
insurance_sellershare
insurance_term
insurer_companies
notification_attachment
notification_configuration
notification_customemailtemplatetype
notification_emailtemplate
notification_emailtemplate_ramos
notification_emailtemplateimage
notification_externalnotification
notification_internalnotification
notification_microsoftgraphevent
notification_microsoftgraphnotification
notification_ramoconfiguration
operation_collectionfile
operation_payment
operation_paymentamount
operation_paymentcollectionfollowup
operation_paymentlog
operation_paymentresponsible
operation_portfolioreconciliationfile
operation_reconciliationfile
operation_reimbursement
operation_reimbursementreport
operation_reimbursementreport_reimbursements
operation_settlement
operation_settlementdocument
operation_settlementdocument_tags
operation_settlementlog
operation_task
operation_task_tags
operation_taskassignmentrule
operation_taskassignmentrule_insurers
operation_taskassignmentrule_ramos
operation_taskassignmentrule_sellers
operation_taskdocument
operation_taskdocument_tags
operation_tasklog
operation_tasktag
operation_tasktype
production_data_importproductiondatafile
production_data_normalizationfile
production_data_productiondata
production_data_standardizeinsurer
production_data_standardizeramo
ramos
redactor_redactorfile
renewal_documentspecification
renewal_documentspecification_ramo
renewal_initialstep
renewal_initialstepconfig
renewal_nonrenewalreason
renewal_renewal
renewal_renewaldocument
renewal_renewaldocument_tags
renewal_renewallog
sales_contractlead
sales_contractleadsimportfile
sales_entity
sales_entitycity
sales_holder
sales_operator
sales_plan
sales_product
sales_provider
sales_sale
sales_saleaudio
sales_saletranscription
sub_ramos
survey_npsresponse
survey_npssurvey
user_role
user_user
""".split())


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def tables(db):
    return {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}


def columns(db, table):
    return [r[1] for r in db.execute('PRAGMA table_info(' + quote(table) + ')')]


def snapshot(path):
    source = sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)
    frozen = sqlite3.connect(':memory:')
    try:
        source.backup(frozen)
    finally:
        source.close()
    return frozen


def create_private(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)


def save_snapshot(db, path):
    create_private(path)
    target = sqlite3.connect(path)
    try:
        db.backup(target)
    finally:
        target.close()


def rows(db, table, condition=''):
    return db.execute('SELECT rowid,* FROM ' + quote(table) + condition + ' ORDER BY rowid')


def digest_rows(db, table, condition=''):
    import hashlib
    digest = hashlib.sha256()
    count = 0
    for row in rows(db, table, condition):
        digest.update(repr(tuple(row)).encode())
        digest.update(b'\n')
        count += 1
    return count, digest.hexdigest()


def fk_summary(violations):
    counts = collections.Counter((r[0], r[2]) for r in violations)
    return [{'table': t, 'parent': parent, 'count': count}
            for (t, parent), count in sorted(counts.items())]


def migrate(source_path, preview_path, output_path, backup_path, report_path):
    source_path, preview_path, output_path, backup_path, report_path = [
        Path(p).resolve() for p in (source_path, preview_path, output_path, backup_path, report_path)]
    if len({source_path, preview_path, output_path, backup_path, report_path}) != 5:
        raise ValueError('Source, preview, output, backup and report must be distinct paths')
    for path in (output_path, backup_path, report_path):
        if path.exists():
            raise ValueError('Refusing to overwrite an existing output, backup or report')
    source = snapshot(source_path)
    preview = snapshot(preview_path)
    try:
        source_tables, preview_tables = tables(source), tables(preview)
        selected = sorted(BUSINESS_TABLES & source_tables)
        if ('user_user' in source_tables and source.execute('SELECT count(*) FROM user_user').fetchone()[0]) or ('user_user' in preview_tables and preview.execute('SELECT count(*) FROM user_user').fetchone()[0]):
            raise ValueError('Nonempty user_user requires a reviewed credential-free legacy identity policy')
        for table in selected:
            if table not in preview_tables or columns(source, table) != columns(preview, table):
                raise ValueError('Business schema mismatch: ' + table)
            for fk in source.execute('PRAGMA foreign_key_list(' + quote(table) + ')'):
                if fk[2] not in selected and fk[2] != 'identity_principal':
                    raise ValueError('Unreviewed foreign-key dependency: ' + table + ' -> ' + fk[2])
        # A preview role bound to a demo agency must not silently gain a different
        # real agency when the numeric identifier happens to collide.
        if 'identity_agency_membership' in preview_tables:
            agency_columns = columns(source, 'agencies')
            identity_column = 'id_slug' if 'id_slug' in agency_columns else 'name'
            for (agency_id,) in preview.execute('SELECT DISTINCT agency_id FROM identity_agency_membership'):
                query = 'SELECT ' + quote(identity_column) + ' FROM agencies WHERE id=?'
                original = preview.execute(query, (agency_id,)).fetchone()
                incoming = source.execute(query, (agency_id,)).fetchone()
                if not incoming or original != incoming:
                    raise ValueError('Preview agency membership would change business identity; explicitly remap access first')
        # Retained preview state (provider credentials, selections, access, etc.)
        # must not silently become attached to another business after ID reuse.
        identity_column = 'id_slug' if 'id_slug' in columns(source, 'agencies') else 'name'
        for table in sorted(preview_tables - set(selected)):
            if table.startswith('crm_'):
                continue
            for fk in preview.execute('PRAGMA foreign_key_list(' + quote(table) + ')'):
                if fk[2] != 'agencies':
                    continue
                for (agency_id,) in preview.execute('SELECT DISTINCT ' + quote(fk[3]) + ' FROM ' + quote(table) + ' WHERE ' + quote(fk[3]) + ' IS NOT NULL'):
                    query = 'SELECT ' + quote(identity_column) + ' FROM agencies WHERE id=?'
                    if preview.execute(query, (agency_id,)).fetchone() != source.execute(query, (agency_id,)).fetchone():
                        raise ValueError('Retained preview state needs explicit agency remapping: ' + table)
        source_fk = set(source.execute('PRAGMA foreign_key_check'))
        preview_fk = set(preview.execute('PRAGMA foreign_key_check'))
        preserved_identity = {t: digest_rows(preview, t) for t in preview_tables
                              if t.startswith('identity_') and t != 'identity_principal'}
        preview_principals = list(rows(preview, 'identity_principal')) if 'identity_principal' in preview_tables else []
        save_snapshot(preview, backup_path)
        building = output_path.with_name(output_path.name + '.building-' + uuid.uuid4().hex)
        save_snapshot(preview, building)
        target = sqlite3.connect(building)
        target.execute('PRAGMA foreign_keys=OFF')
    except Exception:
        source.close()
        preview.close()
        raise
    count_report = {}
    cleared = {}
    inert_principals = set()
    try:
        target.execute('BEGIN IMMEDIATE')
        # Independent custom domains and their metadata/records survive unchanged.
        # Agency-scoped demos are removed; platform designer metadata can remain,
        # but projections and custom values attached to demo IDs cannot.
        platform_metadata = {'crm_objects', 'crm_schema_versions', 'crm_views'}
        for table in sorted(preview_tables):
            if not table.startswith('crm_') or 'tenant_id' not in columns(target, table):
                continue
            where = "tenant_id LIKE 'agency:%'"
            if table not in platform_metadata:
                where += " OR tenant_id='domain:platform'"
            deleted = target.execute('DELETE FROM ' + quote(table) + ' WHERE ' + where).rowcount
            if deleted:
                cleared[table] = deleted
        for table in selected:
            target.execute('DELETE FROM ' + quote(table))
            condition = " WHERE status='connected'" if table == 'agency_crm_connections' else ''
            colnames = ['rowid'] + columns(source, table)
            insert = 'INSERT INTO ' + quote(table) + '(' + ','.join(map(quote, colnames)) + ') VALUES (' + ','.join('?' for _ in colnames) + ')'
            cursor = rows(source, table, condition)
            while batch := cursor.fetchmany(1000):
                target.executemany(insert, batch)
            expected = digest_rows(source, table, condition)
            actual = digest_rows(target, table)
            if expected != actual:
                raise ValueError('Copied table differs from source: ' + table)
            count_report[table] = {'source_selected': expected[0], 'output': actual[0], 'sha256': actual[1]}
            for fk in source.execute('PRAGMA foreign_key_list(' + quote(table) + ')'):
                if fk[2] == 'identity_principal':
                    inert_principals.update(r[0] for r in target.execute(
                        'SELECT DISTINCT ' + quote(fk[3]) + ' FROM ' + quote(table) + ' WHERE ' + quote(fk[3]) + ' IS NOT NULL'))
        added = 0
        for principal_id in sorted(inert_principals):
            if target.execute('SELECT 1 FROM identity_principal WHERE id=?', (principal_id,)).fetchone():
                continue
            # Preserve historical FK identity without importing any login identity,
            # personal email, role, membership, token, or external auth subject.
            target.execute('INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?)',
                           (principal_id, 'urn:savia:local-import', principal_id, 'historical-creator@invalid.invalid',
                            'Imported historical creator', '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'))
            added += 1
        if 'server_id_sequences' in source_tables and 'server_id_sequences' in preview_tables:
            for resource, next_id in source.execute('SELECT resource,next_id FROM server_id_sequences'):
                target.execute('INSERT INTO server_id_sequences(resource,next_id) VALUES (?,?) ON CONFLICT(resource) DO UPDATE SET next_id=MAX(next_id,excluded.next_id)', (resource, next_id))
        for table, expected in preserved_identity.items():
            if digest_rows(target, table) != expected:
                raise ValueError('Preview identity/access changed: ' + table)
        for principal in preview_principals:
            actual = target.execute('SELECT rowid,* FROM identity_principal WHERE id=?', (principal[1],)).fetchone()
            if actual != principal:
                raise ValueError('Preview login identity changed')
        output_fk = set(target.execute('PRAGMA foreign_key_check'))
        known = {r for r in source_fk if r[0] in selected} | {r for r in preview_fk if r[0] not in selected}
        introduced = output_fk - known
        if introduced:
            raise ValueError('Migration introduced foreign-key violations: ' + json.dumps(fk_summary(introduced)))
        integrity = target.execute('PRAGMA integrity_check').fetchall()
        if integrity != [('ok',)]:
            raise ValueError('SQLite integrity check failed')
        target.commit()
        target.execute('PRAGMA foreign_keys=ON')
        report = {
            'source': str(source_path), 'preview': str(preview_path),
            'output': str(output_path), 'preview_backup': str(backup_path),
            'source_and_preview_modified': False,
            'tables': count_report,
            'demo_rows_cleared': cleared,
            'independent_domains_preserved': True,
            'inactive_creator_placeholders_added': added,
            'preview_access_preserved': True,
            'foreign_keys': {'source': len(source_fk), 'preview_before': len(preview_fk),
                             'output': len(output_fk), 'introduced': len(introduced),
                             'source_groups': fk_summary(source_fk), 'output_groups': fk_summary(output_fk)},
            'integrity_check': 'ok',
            'connections': [{'provider': r[0], 'status': r[1], 'count': r[2]}
                            for r in target.execute('SELECT provider,status,count(*) FROM agency_crm_connections GROUP BY provider,status')]
                            if 'agency_crm_connections' in selected else [],
            'external_calls': 0,
            'source_credentials_sessions_personal_integrations_imported': False,
        }
        target.close()
        # Hard-link publication refuses an output created after preflight.
        os.link(building, output_path)
        building.unlink()
        create_private(report_path)
        report_path.write_text(json.dumps(report, indent=2) + '\n')
        return report
    except Exception:
        target.close()
        building.unlink(missing_ok=True)
        raise
    finally:
        source.close()
        preview.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'preview', 'output', 'backup', 'report'):
        parser.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args()
    report = migrate(args.source, args.preview, args.output, args.backup, args.report)
    print(json.dumps({'output': report['output'], 'tables_verified': len(report['tables']),
                      'foreign_keys': report['foreign_keys'], 'connections': report['connections'],
                      'external_calls': 0}, indent=2))

if __name__ == '__main__':
    main()
