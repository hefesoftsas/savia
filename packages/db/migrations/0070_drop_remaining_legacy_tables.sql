-- Drop the remaining unused legacy tables. Keeps only the 9 legacy tables the live
-- customer sync path needs: 5 read tables (customer_clientagency, customer_naturalperson,
-- customer_legalperson, customer_address, customer_legalpersoncontact) plus their 4 FK parents
-- (customer_client, customer_group, business_commercialunit, app_economicactivity), which have
-- no runtime readers. Runs after 0046 (whose DML touches dropped tables while they exist) and
-- after 0069. See docs/superpowers/plans/2026-09-24-legacy-tables-cleanup.md.
DROP TABLE IF EXISTS `sales_sale`;
--> statement-breakpoint
DROP TABLE IF EXISTS `renewal_initialstepconfig`;
--> statement-breakpoint
DROP TABLE IF EXISTS `production_data_standardizeramo`;
--> statement-breakpoint
DROP TABLE IF EXISTS `production_data_standardizeinsurer`;
--> statement-breakpoint
DROP TABLE IF EXISTS `production_data_importproductiondatafile`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_tasktag`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_taskassignmentrule`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_task`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_reimbursementreport`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_reconciliationfile`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_portfolioreconciliationfile`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_payment`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_collectionfile`;
--> statement-breakpoint
DROP TABLE IF EXISTS `notification_externalnotification`;
--> statement-breakpoint
DROP TABLE IF EXISTS `notification_configuration`;
--> statement-breakpoint
DROP TABLE IF EXISTS `insurance_reinvestmentactivity`;
--> statement-breakpoint
DROP TABLE IF EXISTS `insurance_agencyshare`;
--> statement-breakpoint
DROP TABLE IF EXISTS `help_request`;
--> statement-breakpoint
DROP TABLE IF EXISTS `financial_statements_financialstatement`;
--> statement-breakpoint
DROP TABLE IF EXISTS `financial_statements_financialreportrequest_agencies`;
--> statement-breakpoint
DROP TABLE IF EXISTS `financial_statements_agencyauthentication`;
--> statement-breakpoint
DROP TABLE IF EXISTS `financial_statements_accountnormalization`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_prospectlog`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_prospectdocument_tags`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_document_tags`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_customersellershare`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_consortium`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_clientlog`;
--> statement-breakpoint
DROP TABLE IF EXISTS `compliance_processstepemailtemplate`;
--> statement-breakpoint
DROP TABLE IF EXISTS `compliance_compliancetag`;
--> statement-breakpoint
DROP TABLE IF EXISTS `compliance_compliancerequest`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_zurichconnectionkey`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_suraconnectionkey`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_solidariaconnectionkey`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_sbsconnectionkey`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_renewalconfiguration`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_qualitasconnectionkey`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_previsoraconnectionkey`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_mapfreconnectionkey`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_hdiconnectionkey`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_equidadconnectionkey`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_defaultcommission`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_chubbconnectionkey`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_bolivarconnectionkey`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_axaconnectionkey`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_allianzconnectionkey`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_agencycomplementarydata`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_agency_renewal_task_managers`;
--> statement-breakpoint
DROP TABLE IF EXISTS `api_key`;
--> statement-breakpoint
DROP TABLE IF EXISTS `sales_plan`;
--> statement-breakpoint
DROP TABLE IF EXISTS `sales_contractlead`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_tasktype`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_settlement`;
--> statement-breakpoint
DROP TABLE IF EXISTS `notification_emailtemplate`;
--> statement-breakpoint
DROP TABLE IF EXISTS `insurance_endorsement`;
--> statement-breakpoint
DROP TABLE IF EXISTS `help_requestcategory`;
--> statement-breakpoint
DROP TABLE IF EXISTS `financial_statements_financialreportrequest`;
--> statement-breakpoint
DROP TABLE IF EXISTS `financial_statements_financialreportfile`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_prospectdocument`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_document`;
--> statement-breakpoint
DROP TABLE IF EXISTS `compliance_complianceprogramtype`;
--> statement-breakpoint
DROP TABLE IF EXISTS `compliance_compliancecancellationreason`;
--> statement-breakpoint
DROP TABLE IF EXISTS `claim_claim`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_agencycompliancemailbox`;
--> statement-breakpoint
DROP TABLE IF EXISTS `app_documenttag`;
--> statement-breakpoint
DROP TABLE IF EXISTS `app_bank`;
--> statement-breakpoint
DROP TABLE IF EXISTS `sales_provider`;
--> statement-breakpoint
DROP TABLE IF EXISTS `sales_product`;
--> statement-breakpoint
DROP TABLE IF EXISTS `sales_holder`;
--> statement-breakpoint
DROP TABLE IF EXISTS `renewal_nonrenewalreason`;
--> statement-breakpoint
DROP TABLE IF EXISTS `insurance_term`;
--> statement-breakpoint
DROP TABLE IF EXISTS `claim_claimtype`;
--> statement-breakpoint
DROP TABLE IF EXISTS `claim_claimsubstatus`;
--> statement-breakpoint
DROP TABLE IF EXISTS `sales_operator`;
--> statement-breakpoint
DROP TABLE IF EXISTS `sales_entity`;
--> statement-breakpoint
DROP TABLE IF EXISTS `insurance_policy`;
--> statement-breakpoint
DROP TABLE IF EXISTS `claim_claimstatus`;
--> statement-breakpoint
DROP TABLE IF EXISTS `user_user`;
--> statement-breakpoint
DROP TABLE IF EXISTS `customer_prospect`;
--> statement-breakpoint
DROP TABLE IF EXISTS `user_role`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_seller`;
