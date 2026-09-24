-- Drop unused legacy tables (no runtime, trigger, test, migration-0046, or import-script references).
-- Keeps the 90 legacy tables still referenced (5 live customer_* sync tables, 0046 tenant-invariant
-- tables, FK parents of retained tables, and import-script sources). Old migrations are immutable,
-- so removals land here. See docs/superpowers/plans/2026-09-24-legacy-tables-cleanup.md.
DROP TABLE IF EXISTS `user_usercomplementarydata`;
--> statement-breakpoint
DROP TABLE IF EXISTS `user_user_user_permissions`;
--> statement-breakpoint
DROP TABLE IF EXISTS `user_user_groups`;
--> statement-breakpoint
DROP TABLE IF EXISTS `user_trusteddevice`;
--> statement-breakpoint
DROP TABLE IF EXISTS `user_mfaauthenticationlog`;
--> statement-breakpoint
DROP TABLE IF EXISTS `survey_npsresponse`;
--> statement-breakpoint
DROP TABLE IF EXISTS `socialaccount_socialtoken`;
--> statement-breakpoint
DROP TABLE IF EXISTS `socialaccount_socialapp_sites`;
--> statement-breakpoint
DROP TABLE IF EXISTS `sales_saletranscription`;
--> statement-breakpoint
DROP TABLE IF EXISTS `sales_saleaudio`;
--> statement-breakpoint
DROP TABLE IF EXISTS `sales_entitycity`;
--> statement-breakpoint
DROP TABLE IF EXISTS `sales_contractleadsimportfile`;
--> statement-breakpoint
DROP TABLE IF EXISTS `renewal_renewallog`;
--> statement-breakpoint
DROP TABLE IF EXISTS `renewal_renewaldocument_tags`;
--> statement-breakpoint
DROP TABLE IF EXISTS `renewal_initialstep`;
--> statement-breakpoint
DROP TABLE IF EXISTS `renewal_documentspecification_ramo`;
--> statement-breakpoint
DROP TABLE IF EXISTS `redactor_redactorfile`;
--> statement-breakpoint
DROP TABLE IF EXISTS `production_data_productiondata`;
--> statement-breakpoint
DROP TABLE IF EXISTS `production_data_normalizationfile`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_tasklog`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_taskdocument_tags`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_taskassignmentrule_sellers`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_taskassignmentrule_ramos`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_taskassignmentrule_insurers`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_task_tags`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_settlementlog`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_settlementdocument_tags`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_reimbursementreport_reimbursements`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_paymentresponsible`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_paymentlog`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_paymentcollectionfollowup`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_paymentamount`;
--> statement-breakpoint
DROP TABLE IF EXISTS `notification_ramoconfiguration`;
--> statement-breakpoint
DROP TABLE IF EXISTS `notification_microsoftgraphnotification`;
--> statement-breakpoint
DROP TABLE IF EXISTS `notification_microsoftgraphevent`;
--> statement-breakpoint
DROP TABLE IF EXISTS `notification_internalnotification`;
--> statement-breakpoint
DROP TABLE IF EXISTS `notification_graphsubscription`;
--> statement-breakpoint
DROP TABLE IF EXISTS `notification_emailtemplateimage`;
--> statement-breakpoint
DROP TABLE IF EXISTS `notification_emailtemplate_ramos`;
--> statement-breakpoint
DROP TABLE IF EXISTS `notification_customemailtemplatetype`;
--> statement-breakpoint
DROP TABLE IF EXISTS `notification_attachment`;
--> statement-breakpoint
DROP TABLE IF EXISTS `mfa_authenticator`;
--> statement-breakpoint
DROP TABLE IF EXISTS `insurance_sellershare`;
--> statement-breakpoint
DROP TABLE IF EXISTS `insurance_reinvestmentterm`;
--> statement-breakpoint
DROP TABLE IF EXISTS `insurance_reinvestment`;
--> statement-breakpoint
DROP TABLE IF EXISTS `insurance_policylog`;
--> statement-breakpoint
DROP TABLE IF EXISTS `insurance_policydocument_tags`;
--> statement-breakpoint
DROP TABLE IF EXISTS `insurance_paymenttaskreminder`;
--> statement-breakpoint
DROP TABLE IF EXISTS `insurance_insurershare`;
--> statement-breakpoint
DROP TABLE IF EXISTS `insurance_endorsementdocument_tags`;
--> statement-breakpoint
DROP TABLE IF EXISTS `insurance_beneficiary`;
--> statement-breakpoint
DROP TABLE IF EXISTS `help_trainingvideo`;
--> statement-breakpoint
DROP TABLE IF EXISTS `help_requestlog`;
--> statement-breakpoint
DROP TABLE IF EXISTS `help_requestdocument`;
--> statement-breakpoint
DROP TABLE IF EXISTS `help_newsletterusersurvey`;
--> statement-breakpoint
DROP TABLE IF EXISTS `financial_statements_accountnormalizationfile`;
--> statement-breakpoint
DROP TABLE IF EXISTS `django_session`;
--> statement-breakpoint
DROP TABLE IF EXISTS `django_migrations`;
--> statement-breakpoint
DROP TABLE IF EXISTS `django_admin_log`;
--> statement-breakpoint
DROP TABLE IF EXISTS `constance_constance`;
--> statement-breakpoint
DROP TABLE IF EXISTS `compliance_requestdocument_tags`;
--> statement-breakpoint
DROP TABLE IF EXISTS `compliance_documentspecification`;
--> statement-breakpoint
DROP TABLE IF EXISTS `compliance_compliancerequest_tags`;
--> statement-breakpoint
DROP TABLE IF EXISTS `compliance_compliancelog`;
--> statement-breakpoint
DROP TABLE IF EXISTS `claim_coverage`;
--> statement-breakpoint
DROP TABLE IF EXISTS `claim_claimlog`;
--> statement-breakpoint
DROP TABLE IF EXISTS `claim_claimdocument_tags`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_sellerlog`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_sellerdocument_tags`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_sellercommission`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_ramorenewalconfiguration`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_agencycompliancemailbox_reply_authorized_users`;
--> statement-breakpoint
DROP TABLE IF EXISTS `axes_accesslog`;
--> statement-breakpoint
DROP TABLE IF EXISTS `axes_accessfailurelog`;
--> statement-breakpoint
DROP TABLE IF EXISTS `axes_accessattemptexpiration`;
--> statement-breakpoint
DROP TABLE IF EXISTS `auth_group_permissions`;
--> statement-breakpoint
DROP TABLE IF EXISTS `app_reporthistory`;
--> statement-breakpoint
DROP TABLE IF EXISTS `app_importdata`;
--> statement-breakpoint
DROP TABLE IF EXISTS `app_changelog`;
--> statement-breakpoint
DROP TABLE IF EXISTS `api_sarlaftfile`;
--> statement-breakpoint
DROP TABLE IF EXISTS `api_proposalscarsfile`;
--> statement-breakpoint
DROP TABLE IF EXISTS `api_propertiesfile`;
--> statement-breakpoint
DROP TABLE IF EXISTS `api_policyfile`;
--> statement-breakpoint
DROP TABLE IF EXISTS `api_paymentfile`;
--> statement-breakpoint
DROP TABLE IF EXISTS `api_customerfile`;
--> statement-breakpoint
DROP TABLE IF EXISTS `account_emailconfirmation`;
--> statement-breakpoint
DROP TABLE IF EXISTS `survey_npssurvey`;
--> statement-breakpoint
DROP TABLE IF EXISTS `socialaccount_socialapp`;
--> statement-breakpoint
DROP TABLE IF EXISTS `socialaccount_socialaccount`;
--> statement-breakpoint
DROP TABLE IF EXISTS `renewal_renewaldocument`;
--> statement-breakpoint
DROP TABLE IF EXISTS `renewal_documentspecification`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_taskdocument`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_settlementdocument`;
--> statement-breakpoint
DROP TABLE IF EXISTS `operation_reimbursement`;
--> statement-breakpoint
DROP TABLE IF EXISTS `insurance_policydocument`;
--> statement-breakpoint
DROP TABLE IF EXISTS `insurance_insured`;
--> statement-breakpoint
DROP TABLE IF EXISTS `insurance_endorsementdocument`;
--> statement-breakpoint
DROP TABLE IF EXISTS `help_trainingcategory`;
--> statement-breakpoint
DROP TABLE IF EXISTS `help_newsletter`;
--> statement-breakpoint
DROP TABLE IF EXISTS `django_site`;
--> statement-breakpoint
DROP TABLE IF EXISTS `compliance_requestdocument`;
--> statement-breakpoint
DROP TABLE IF EXISTS `claim_claimdocument`;
--> statement-breakpoint
DROP TABLE IF EXISTS `business_sellerdocument`;
--> statement-breakpoint
DROP TABLE IF EXISTS `axes_accessattempt`;
--> statement-breakpoint
DROP TABLE IF EXISTS `auth_permission`;
--> statement-breakpoint
DROP TABLE IF EXISTS `auth_group`;
--> statement-breakpoint
DROP TABLE IF EXISTS `account_emailaddress`;
--> statement-breakpoint
DROP TABLE IF EXISTS `renewal_renewal`;
--> statement-breakpoint
DROP TABLE IF EXISTS `django_content_type`;
