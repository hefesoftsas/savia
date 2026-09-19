-- Generated from the restored legacy PostgreSQL schema. Do not edit by hand.
-- Schema only: no data, PostGIS, extensions, views, sequences, or triggers.
-- The public OpenAPI surface is domain/collection based; these are internal D1 tables.

CREATE TABLE `account_emailaddress` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `email` TEXT NOT NULL,
  `verified` INTEGER NOT NULL,
  `primary` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  CONSTRAINT `account_emailaddress_user_id_2c513194_fk_user_user_id` FOREIGN KEY (`user_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `account_emailconfirmation` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `created` TEXT NOT NULL,
  `sent` TEXT,
  `key` TEXT NOT NULL,
  `email_address_id` INTEGER NOT NULL,
  CONSTRAINT `account_emailconfirm_email_address_id_5b7f8c58_fk_account_e` FOREIGN KEY (`email_address_id`) REFERENCES `account_emailaddress` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `api_customerfile` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `report` TEXT NOT NULL,
  `response_duration` TEXT
);
--> statement-breakpoint
CREATE TABLE `api_key` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `public_key` TEXT NOT NULL,
  `private_key` TEXT NOT NULL,
  `created_at` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_paymentfile` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `insurance_company` TEXT NOT NULL,
  `extension` TEXT NOT NULL,
  `csv_data` TEXT,
  `report` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_policyfile` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `report` TEXT NOT NULL,
  `response_duration` TEXT
);
--> statement-breakpoint
CREATE TABLE `api_propertiesfile` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `report` TEXT NOT NULL,
  `response_duration` TEXT
);
--> statement-breakpoint
CREATE TABLE `api_proposalscarsfile` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `report` TEXT NOT NULL,
  `response_duration` TEXT
);
--> statement-breakpoint
CREATE TABLE `api_sarlaftfile` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `report` TEXT NOT NULL,
  `response_duration` TEXT
);
--> statement-breakpoint
CREATE TABLE `app_bank` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_changelog` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `main_object_id` TEXT NOT NULL,
  `object_type` TEXT NOT NULL,
  `section` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `created_by` TEXT NOT NULL,
  `detail` TEXT NOT NULL,
  `type` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_documenttag` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `color` TEXT NOT NULL,
  `agency_id` BIGINT,
  `created_by` TEXT NOT NULL,
  CONSTRAINT `app_documenttag_agency_id_40679a9f_fk_business_agency_id` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `app_economicactivity` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `code` TEXT NOT NULL,
  `name` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_importdata` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `report` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_reporthistory` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `report_type` TEXT NOT NULL,
  `selected_columns` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `user_id` INTEGER,
  CONSTRAINT `app_reporthistory_user_id_c8b84a1e_fk_user_user_id` FOREIGN KEY (`user_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `auth_group` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_group_permissions` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `group_id` INTEGER NOT NULL,
  `permission_id` INTEGER NOT NULL,
  CONSTRAINT `auth_group_permissio_permission_id_84c5c92e_fk_auth_perm` FOREIGN KEY (`permission_id`) REFERENCES `auth_permission` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `auth_group_permissions_group_id_b120cbf9_fk_auth_group_id` FOREIGN KEY (`group_id`) REFERENCES `auth_group` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `auth_permission` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `content_type_id` INTEGER NOT NULL,
  `codename` TEXT NOT NULL,
  CONSTRAINT `auth_permission_content_type_id_2f476e4b_fk_django_co` FOREIGN KEY (`content_type_id`) REFERENCES `django_content_type` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `axes_accessattempt` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `user_agent` TEXT NOT NULL,
  `ip_address` TEXT,
  `username` TEXT,
  `http_accept` TEXT NOT NULL,
  `path_info` TEXT NOT NULL,
  `attempt_time` TEXT NOT NULL,
  `get_data` TEXT NOT NULL,
  `post_data` TEXT NOT NULL,
  `failures_since_start` INTEGER NOT NULL,
  CONSTRAINT `axes_accessattempt_failures_since_start_check` CHECK (`failures_since_start` >= 0)
);
--> statement-breakpoint
CREATE TABLE `axes_accessattemptexpiration` (
  `access_attempt_id` INTEGER PRIMARY KEY NOT NULL,
  `expires_at` TEXT NOT NULL,
  CONSTRAINT `axes_accessattemptex_access_attempt_id_6b73a47a_fk_axes_acce` FOREIGN KEY (`access_attempt_id`) REFERENCES `axes_accessattempt` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `axes_accessfailurelog` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `user_agent` TEXT NOT NULL,
  `ip_address` TEXT,
  `username` TEXT,
  `http_accept` TEXT NOT NULL,
  `path_info` TEXT NOT NULL,
  `attempt_time` TEXT NOT NULL,
  `locked_out` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE `axes_accesslog` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `user_agent` TEXT NOT NULL,
  `ip_address` TEXT,
  `username` TEXT,
  `http_accept` TEXT NOT NULL,
  `path_info` TEXT NOT NULL,
  `attempt_time` TEXT NOT NULL,
  `logout_time` TEXT,
  `session_hash` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `business_agency_renewal_task_managers` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `user_id` INTEGER NOT NULL,
  CONSTRAINT `business_agency_rene_agency_id_92d6284e_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `business_agency_rene_user_id_55162e62_fk_user_user` FOREIGN KEY (`user_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `business_agencycomplementarydata` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `employee_count` INTEGER,
  `agent_type` TEXT NOT NULL,
  `portfolio` INTEGER NOT NULL,
  `focus` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `commercial_executive_id` INTEGER NOT NULL,
  CONSTRAINT `business_agencycompl_agency_id_6737222a_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `business_agencycompl_commercial_executive_f8ab5dbf_fk_user_user` FOREIGN KEY (`commercial_executive_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `business_agencycomplementarydata_employee_count_check` CHECK (`employee_count` >= 0),
  CONSTRAINT `business_agencycomplementarydata_portfolio_e9f3deb7_check` CHECK (`portfolio` >= 0)
);
--> statement-breakpoint
CREATE TABLE `business_agencycompliancemailbox` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `email` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `last_sync_at` TEXT,
  CONSTRAINT `business_agencycompl_agency_id_3d4bf26b_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `business_agencycompliancemailbox_reply_authorized_users` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `agencycompliancemailbox_id` BIGINT NOT NULL,
  `user_id` INTEGER NOT NULL,
  CONSTRAINT `business_agencycompl_agencycompliancemail_3d1579c1_fk_business_` FOREIGN KEY (`agencycompliancemailbox_id`) REFERENCES `business_agencycompliancemailbox` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `business_agencycompl_user_id_3e632432_fk_user_user` FOREIGN KEY (`user_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `business_allianzconnectionkey` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `key` TEXT NOT NULL,
  `username` TEXT NOT NULL,
  `password` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL,
  `is_billable` INTEGER NOT NULL,
  `connection_tag` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `business_allianzconn_agency_id_cc986f8c_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `at_least_one_field_filled_allianz_connection_key` CHECK (`connection_tag` > '' OR `username` > '' OR `password` > '' OR `key` > '')
);
--> statement-breakpoint
CREATE TABLE `business_axaconnectionkey` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `key` TEXT NOT NULL,
  `username` TEXT NOT NULL,
  `password` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL,
  `is_billable` INTEGER NOT NULL,
  `vehicles_tag` TEXT NOT NULL,
  `motorcycle_tag` TEXT NOT NULL,
  `heavy_vehicles_tag` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `business_axaconnecti_agency_id_fb7a192b_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `at_least_one_field_filled_Axa_connection_key` CHECK (`vehicles_tag` > '' OR `username` > '' OR `password` > '' OR `key` > '' OR `motorcycle_tag` > '' OR `heavy_vehicles_tag` > '')
);
--> statement-breakpoint
CREATE TABLE `business_bolivarconnectionkey` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `key` TEXT NOT NULL,
  `username` TEXT NOT NULL,
  `password` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL,
  `is_billable` INTEGER NOT NULL,
  `connection_tag` TEXT NOT NULL,
  `vehicles_tag` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `business_bolivarconn_agency_id_ce22a6a7_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `at_least_one_field_filled_seguros_bolivar_connection_key` CHECK (`connection_tag` > '' OR `username` > '' OR `password` > '' OR `key` > '' OR `vehicles_tag` > '')
);
--> statement-breakpoint
CREATE TABLE `business_chubbconnectionkey` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `key` TEXT NOT NULL,
  `username` TEXT NOT NULL,
  `password` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL,
  `is_billable` INTEGER NOT NULL,
  `connection_tag` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `business_chubbconnec_agency_id_1d5e0fce_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `at_least_one_field_filled_chubb_connection_key` CHECK (`connection_tag` > '' OR `username` > '' OR `password` > '' OR `key` > '')
);
--> statement-breakpoint
CREATE TABLE `business_commercialunit` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `created_by` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `edited_by` TEXT NOT NULL,
  CONSTRAINT `business_commercialu_agency_id_3f578aee_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `business_defaultcommission` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `commission_percentage` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `insurer_id` BIGINT NOT NULL,
  `ramo_id` BIGINT NOT NULL,
  `migration_slug` TEXT NOT NULL,
  `external_id` TEXT NOT NULL,
  CONSTRAINT `business_defaultcomm_agency_id_f8f81f53_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `business_defaultcomm_insurer_id_74445edd_fk_business_` FOREIGN KEY (`insurer_id`) REFERENCES `insurer_companies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `business_defaultcommission_ramo_id_92f4c825_fk_business_ramo_id` FOREIGN KEY (`ramo_id`) REFERENCES `ramos` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `business_equidadconnectionkey` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `key` TEXT NOT NULL,
  `username` TEXT NOT NULL,
  `password` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL,
  `is_billable` INTEGER NOT NULL,
  `connection_tag` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `business_equidadconn_agency_id_79ac6da2_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `at_least_one_field_filled_equidad_connection_key` CHECK (`connection_tag` > '' OR `username` > '' OR `password` > '' OR `key` > '')
);
--> statement-breakpoint
CREATE TABLE `business_hdiconnectionkey` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `key` TEXT NOT NULL,
  `username` TEXT NOT NULL,
  `password` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL,
  `is_billable` INTEGER NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `business_hdiconnecti_agency_id_a0c9a0d9_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `at_least_one_field_filled_HDI_connection_key` CHECK (`username` > '' OR `password` > '' OR `key` > '')
);
--> statement-breakpoint
CREATE TABLE `business_mapfreconnectionkey` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `key` TEXT NOT NULL,
  `username` TEXT NOT NULL,
  `password` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL,
  `is_billable` INTEGER NOT NULL,
  `connection_tag` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `business_mapfreconne_agency_id_904b3266_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `at_least_one_field_filled_mapfre_connection_key` CHECK (`connection_tag` > '' OR `username` > '' OR `password` > '' OR `key` > '')
);
--> statement-breakpoint
CREATE TABLE `business_previsoraconnectionkey` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `key` TEXT NOT NULL,
  `username` TEXT NOT NULL,
  `password` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL,
  `is_billable` INTEGER NOT NULL,
  `connection_tag` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `business_previsoraco_agency_id_c814ac6b_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `at_least_one_field_filled_previsora_connection_key` CHECK (`connection_tag` > '' OR `username` > '' OR `password` > '' OR `key` > '')
);
--> statement-breakpoint
CREATE TABLE `business_qualitasconnectionkey` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `key` TEXT NOT NULL,
  `username` TEXT NOT NULL,
  `password` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL,
  `is_billable` INTEGER NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `business_qualitascon_agency_id_cf93908d_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `at_least_one_field_filled_qualitas_connection_key` CHECK (`username` > '' OR `password` > '' OR `key` > '')
);
--> statement-breakpoint
CREATE TABLE `business_ramorenewalconfiguration` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `renewal_days` INTEGER NOT NULL,
  `ramo_id` BIGINT NOT NULL,
  `configuration_id` BIGINT NOT NULL,
  CONSTRAINT `business_ramorenewal_configuration_id_036f37ef_fk_business_` FOREIGN KEY (`configuration_id`) REFERENCES `business_renewalconfiguration` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `business_ramorenewal_ramo_id_0df0a974_fk_business_` FOREIGN KEY (`ramo_id`) REFERENCES `ramos` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `business_ramorenewalconfiguration_renewal_days_check` CHECK (`renewal_days` >= 0)
);
--> statement-breakpoint
CREATE TABLE `business_renewalconfiguration` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `renewal_days` INTEGER NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `business_renewalconf_agency_id_c68406f8_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `business_renewalconfiguration_renewal_days_check` CHECK (`renewal_days` >= 0)
);
--> statement-breakpoint
CREATE TABLE `business_sbsconnectionkey` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `key` TEXT NOT NULL,
  `username` TEXT NOT NULL,
  `password` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL,
  `is_billable` INTEGER NOT NULL,
  `connection_tag` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `business_sbsconnecti_agency_id_a9bbee31_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `at_least_one_field_filled_sbs_connection_key` CHECK (`connection_tag` > '' OR `username` > '' OR `password` > '' OR `key` > '')
);
--> statement-breakpoint
CREATE TABLE `business_seller` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `id_number` TEXT NOT NULL,
  `contact_number` TEXT NOT NULL,
  `contact_email` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `bank_account_number` TEXT NOT NULL,
  `bank_account_type` TEXT NOT NULL,
  `bank_name` TEXT NOT NULL,
  `id_type` TEXT NOT NULL,
  `tax_iva` TEXT NOT NULL,
  `tax_rete_ica` TEXT NOT NULL,
  `tax_rete_iva` TEXT NOT NULL,
  `type` TEXT NOT NULL,
  `tax_regime` TEXT NOT NULL,
  `completed_at` TEXT,
  `tax_rete_fuente` TEXT NOT NULL,
  `migration_slug` TEXT NOT NULL,
  `external_id` TEXT NOT NULL,
  CONSTRAINT `business_seller_agency_id_47e0ac09_fk_business_agency_id` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `business_sellercommission` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `index` INTEGER NOT NULL,
  `percentage` TEXT NOT NULL,
  `seller_id` BIGINT NOT NULL,
  CONSTRAINT `business_sellercommi_seller_id_eb074fe3_fk_business_` FOREIGN KEY (`seller_id`) REFERENCES `business_seller` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `business_sellercommission_index_check` CHECK (`index` >= 0)
);
--> statement-breakpoint
CREATE TABLE `business_sellerdocument` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `completed_at` TEXT,
  `seller_id` BIGINT NOT NULL,
  `uploaded_by_id` INTEGER,
  CONSTRAINT `business_sellerdocum_seller_id_c161176d_fk_business_` FOREIGN KEY (`seller_id`) REFERENCES `business_seller` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `business_sellerdocument_uploaded_by_id_96fb72ba_fk_user_user_id` FOREIGN KEY (`uploaded_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `business_sellerdocument_tags` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `sellerdocument_id` BIGINT NOT NULL,
  `documenttag_id` INTEGER NOT NULL,
  CONSTRAINT `business_sellerdocum_documenttag_id_292246cd_fk_app_docum` FOREIGN KEY (`documenttag_id`) REFERENCES `app_documenttag` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `business_sellerdocum_sellerdocument_id_ec0a9c55_fk_business_` FOREIGN KEY (`sellerdocument_id`) REFERENCES `business_sellerdocument` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `business_sellerlog` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `created_at` TEXT NOT NULL,
  `info` TEXT NOT NULL,
  `created_by_id` INTEGER,
  `seller_id` BIGINT NOT NULL,
  CONSTRAINT `business_sellerlog_created_by_id_da77f23f_fk_user_user_id` FOREIGN KEY (`created_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `business_sellerlog_seller_id_db31eca3_fk_business_seller_id` FOREIGN KEY (`seller_id`) REFERENCES `business_seller` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `business_solidariaconnectionkey` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `key` TEXT NOT NULL,
  `username` TEXT NOT NULL,
  `password` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL,
  `is_billable` INTEGER NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `business_solidariaco_agency_id_bcf747a9_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `at_least_one_field_filled_Solidaria_connection_key` CHECK (`username` > '' OR `password` > '' OR `key` > '')
);
--> statement-breakpoint
CREATE TABLE `business_suraconnectionkey` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `key` TEXT NOT NULL,
  `username` TEXT NOT NULL,
  `password` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL,
  `is_billable` INTEGER NOT NULL,
  `connection_tag` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `business_suraconnect_agency_id_37d85990_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `at_least_one_field_filled_sura_connection_key` CHECK (`connection_tag` > '' OR `username` > '' OR `password` > '' OR `key` > '')
);
--> statement-breakpoint
CREATE TABLE `business_zurichconnectionkey` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `key` TEXT NOT NULL,
  `username` TEXT NOT NULL,
  `password` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL,
  `is_billable` INTEGER NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `business_zurichconne_agency_id_2e6d8391_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `at_least_one_field_filled_zurich_connection_key` CHECK (`username` > '' OR `password` > '' OR `key` > '')
);
--> statement-breakpoint
CREATE TABLE `claim_claim` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `insurer_number` TEXT NOT NULL,
  `incident_at` TEXT NOT NULL,
  `notified_at` TEXT,
  `adjuster` TEXT NOT NULL,
  `description` TEXT NOT NULL,
  `claimed_amount` TEXT,
  `deductible` TEXT NOT NULL,
  `paid_amount` TEXT,
  `completed_at` TEXT,
  `policy_id` BIGINT NOT NULL,
  `status_id` BIGINT NOT NULL,
  `type_id` BIGINT NOT NULL,
  `closed_at` TEXT,
  `migration_slug` TEXT NOT NULL,
  `created_by` TEXT NOT NULL,
  `created_by_slug` TEXT NOT NULL,
  `external_id` TEXT NOT NULL,
  `document_url` TEXT NOT NULL,
  CONSTRAINT `claim_claim_policy_id_39cf76fa_fk_insurance_policy_id` FOREIGN KEY (`policy_id`) REFERENCES `insurance_policy` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `claim_claim_status_id_3ff21869_fk_claim_claimsubstatus_id` FOREIGN KEY (`status_id`) REFERENCES `claim_claimsubstatus` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `claim_claim_type_id_835b6aa3_fk_claim_claimtype_id` FOREIGN KEY (`type_id`) REFERENCES `claim_claimtype` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `claim_claimdocument` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `completed_at` TEXT,
  `claim_id` BIGINT NOT NULL,
  `uploaded_by_id` INTEGER,
  CONSTRAINT `claim_claimdocument_claim_id_e2e36c11_fk_claim_claim_id` FOREIGN KEY (`claim_id`) REFERENCES `claim_claim` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `claim_claimdocument_uploaded_by_id_956e6c4a_fk_user_user_id` FOREIGN KEY (`uploaded_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `claim_claimdocument_tags` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `claimdocument_id` BIGINT NOT NULL,
  `documenttag_id` INTEGER NOT NULL,
  CONSTRAINT `claim_claimdocument__claimdocument_id_868d714d_fk_claim_cla` FOREIGN KEY (`claimdocument_id`) REFERENCES `claim_claimdocument` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `claim_claimdocument__documenttag_id_a497f965_fk_app_docum` FOREIGN KEY (`documenttag_id`) REFERENCES `app_documenttag` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `claim_claimlog` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `created_at` TEXT NOT NULL,
  `info` TEXT NOT NULL,
  `claim_id` BIGINT NOT NULL,
  `created_by_id` INTEGER,
  CONSTRAINT `claim_claimlog_claim_id_ced2ff40_fk_claim_claim_id` FOREIGN KEY (`claim_id`) REFERENCES `claim_claim` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `claim_claimlog_created_by_id_c3d5bb12_fk_user_user_id` FOREIGN KEY (`created_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `claim_claimstatus` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `index` INTEGER NOT NULL,
  `color` TEXT NOT NULL,
  `is_closed` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE `claim_claimsubstatus` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `index` INTEGER NOT NULL,
  `show_dropdown` INTEGER NOT NULL,
  `status_id` BIGINT NOT NULL,
  CONSTRAINT `claim_claimsubstatus_status_id_9db249b9_fk_claim_claimstatus_id` FOREIGN KEY (`status_id`) REFERENCES `claim_claimstatus` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `claim_claimtype` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `show_dropdown` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE `claim_coverage` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `claimant` TEXT NOT NULL,
  `amount` TEXT NOT NULL,
  `claim_id` BIGINT NOT NULL,
  `migration_slug` TEXT NOT NULL,
  `external_id` TEXT NOT NULL,
  CONSTRAINT `claim_coverage_claim_id_30284174_fk_claim_claim_id` FOREIGN KEY (`claim_id`) REFERENCES `claim_claim` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `compliance_compliancecancellationreason` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `compliance_compliancelog` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `created_at` TEXT NOT NULL,
  `info` TEXT NOT NULL,
  `compliance_id` BIGINT NOT NULL,
  `created_by_id` INTEGER,
  CONSTRAINT `compliance_complianc_compliance_id_fe9c6300_fk_complianc` FOREIGN KEY (`compliance_id`) REFERENCES `compliance_compliancerequest` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `compliance_compliancelog_created_by_id_94c23312_fk_user_user_id` FOREIGN KEY (`created_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `compliance_complianceprogramtype` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `compliance_complianc_agency_id_d1c61d58_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `compliance_compliancerequest` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `closed_at` TEXT,
  `status_trace` TEXT NOT NULL,
  `due_date` TEXT,
  `last_handled_at` TEXT,
  `status` TEXT NOT NULL,
  `request_type` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `cl_policy_id` BIGINT,
  `client_id` BIGINT,
  `main_policy_id` BIGINT,
  `owner_id` INTEGER,
  `process_steps` TEXT,
  `process_type` TEXT NOT NULL,
  `cl_policy_number` TEXT NOT NULL,
  `main_policy_number` TEXT NOT NULL,
  `last_email_read_at` TEXT,
  `last_inbound_email_at` TEXT,
  `ai_email_summary` TEXT,
  `contract_summary` TEXT NOT NULL,
  `contract_summary_attempted_at` TEXT,
  `modification_subtype` TEXT NOT NULL,
  `cancellation_reason_id` BIGINT,
  `mailbox_id` BIGINT NOT NULL,
  `contract_summary_failure_count` INTEGER NOT NULL,
  `insurance_subject` TEXT NOT NULL,
  `program_type_id` BIGINT,
  `source_compliance_id` BIGINT,
  CONSTRAINT `compliance_complianc_agency_id_d1d947d7_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `compliance_complianc_cancellation_reason__1a792a78_fk_complianc` FOREIGN KEY (`cancellation_reason_id`) REFERENCES `compliance_compliancecancellationreason` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `compliance_complianc_cl_policy_id_90163a8b_fk_insurance` FOREIGN KEY (`cl_policy_id`) REFERENCES `insurance_policy` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `compliance_complianc_client_id_c6caf474_fk_customer_` FOREIGN KEY (`client_id`) REFERENCES `customer_client` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `compliance_complianc_mailbox_id_b75e4de4_fk_business_` FOREIGN KEY (`mailbox_id`) REFERENCES `business_agencycompliancemailbox` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `compliance_complianc_main_policy_id_6af5bc41_fk_insurance` FOREIGN KEY (`main_policy_id`) REFERENCES `insurance_policy` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `compliance_complianc_program_type_id_d967280b_fk_complianc` FOREIGN KEY (`program_type_id`) REFERENCES `compliance_complianceprogramtype` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `compliance_complianc_source_compliance_id_888c1461_fk_complianc` FOREIGN KEY (`source_compliance_id`) REFERENCES `compliance_compliancerequest` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `compliance_compliancerequest_owner_id_bb49a3a4_fk_user_user_id` FOREIGN KEY (`owner_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `compliance_compliancerequest_contract_summary_failure_cou_check` CHECK (`contract_summary_failure_count` >= 0)
);
--> statement-breakpoint
CREATE TABLE `compliance_compliancerequest_tags` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `compliancerequest_id` BIGINT NOT NULL,
  `compliancetag_id` BIGINT NOT NULL,
  CONSTRAINT `compliance_complianc_compliancerequest_id_7fbae941_fk_complianc` FOREIGN KEY (`compliancerequest_id`) REFERENCES `compliance_compliancerequest` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `compliance_complianc_compliancetag_id_8b54a722_fk_complianc` FOREIGN KEY (`compliancetag_id`) REFERENCES `compliance_compliancetag` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `compliance_compliancetag` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `color` TEXT NOT NULL,
  `agency_id` BIGINT,
  CONSTRAINT `compliance_complianc_agency_id_bc1aed71_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `compliance_documentspecification` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `request_type` TEXT NOT NULL,
  `client_type` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `description` TEXT NOT NULL,
  `tag_id` INTEGER NOT NULL,
  `is_mandatory` INTEGER NOT NULL,
  `is_contract` INTEGER NOT NULL,
  CONSTRAINT `compliance_documents_tag_id_fc68fc28_fk_app_docum` FOREIGN KEY (`tag_id`) REFERENCES `app_documenttag` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `compliance_processstepemailtemplate` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `compliance_type` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `email_template_id` BIGINT NOT NULL,
  CONSTRAINT `compliance_processst_agency_id_998bdbdc_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `compliance_processst_email_template_id_ad815fcd_fk_notificat` FOREIGN KEY (`email_template_id`) REFERENCES `notification_emailtemplate` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `compliance_requestdocument` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `completed_at` TEXT,
  `reader_data` TEXT,
  `request_id` BIGINT NOT NULL,
  `uploaded_by_id` INTEGER,
  CONSTRAINT `compliance_requestdo_request_id_96088179_fk_complianc` FOREIGN KEY (`request_id`) REFERENCES `compliance_compliancerequest` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `compliance_requestdo_uploaded_by_id_6f12f14a_fk_user_user` FOREIGN KEY (`uploaded_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `compliance_requestdocument_tags` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `requestdocument_id` BIGINT NOT NULL,
  `documenttag_id` INTEGER NOT NULL,
  CONSTRAINT `compliance_requestdo_documenttag_id_1e12c089_fk_app_docum` FOREIGN KEY (`documenttag_id`) REFERENCES `app_documenttag` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `compliance_requestdo_requestdocument_id_4599fcb1_fk_complianc` FOREIGN KEY (`requestdocument_id`) REFERENCES `compliance_requestdocument` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `constance_constance` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `key` TEXT NOT NULL,
  `value` TEXT
);
--> statement-breakpoint
CREATE TABLE `customer_address` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `address` TEXT NOT NULL,
  `city_id` INTEGER NOT NULL,
  `coordinates` TEXT,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `complement` TEXT NOT NULL,
  CONSTRAINT `customer_address_city_id_121281ad_fk_app_city_id` FOREIGN KEY (`city_id`) REFERENCES `cities` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `customer_client` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `id_number` TEXT NOT NULL,
  `migration_slug` TEXT NOT NULL,
  `external_id` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `customer_clientagency` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `client_id` BIGINT NOT NULL,
  `created_by` TEXT NOT NULL,
  `created_by_slug` TEXT NOT NULL,
  `birthday_notification` INTEGER NOT NULL,
  `payment_notification` INTEGER NOT NULL,
  `renewal_notification` INTEGER NOT NULL,
  `commercial_unit_id` BIGINT,
  `group_id` BIGINT,
  `document_url` TEXT NOT NULL,
  `computed_data` TEXT NOT NULL,
  `completed_at` TEXT,
  `origin_from_prospects` INTEGER NOT NULL,
  CONSTRAINT `customer_clientagenc_commercial_unit_id_c62e178e_fk_business_` FOREIGN KEY (`commercial_unit_id`) REFERENCES `business_commercialunit` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_clientagency_agency_id_2219f9d3_fk_business_agency_id` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_clientagency_client_id_f7514a49_fk_customer_client_id` FOREIGN KEY (`client_id`) REFERENCES `customer_client` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_clientagency_group_id_45d26c9d_fk_customer_group_id` FOREIGN KEY (`group_id`) REFERENCES `customer_group` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `customer_clientlog` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `created_at` TEXT NOT NULL,
  `info` TEXT NOT NULL,
  `created_by_id` INTEGER,
  `client_id` BIGINT NOT NULL,
  CONSTRAINT `customer_clientlog_client_id_ea24d535_fk_customer_` FOREIGN KEY (`client_id`) REFERENCES `customer_clientagency` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_clientlog_created_by_id_f184b351_fk_user_user_id` FOREIGN KEY (`created_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `customer_consortium` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `percentage` TEXT NOT NULL,
  `legal_person_id` BIGINT,
  `is_main` INTEGER NOT NULL,
  `natural_person_id` BIGINT,
  `client_id` BIGINT NOT NULL,
  `name_display` TEXT NOT NULL,
  CONSTRAINT `customer_consortium_client_id_6da13012_fk_customer_` FOREIGN KEY (`client_id`) REFERENCES `customer_clientagency` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_consortium_legal_person_id_e82d5e08_fk_customer_` FOREIGN KEY (`legal_person_id`) REFERENCES `customer_legalperson` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_consortium_natural_person_id_7d1d6af7_fk_customer_` FOREIGN KEY (`natural_person_id`) REFERENCES `customer_naturalperson` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `check_legal_person_and_natural_person_not_null` CHECK (`legal_person_id` IS NULL OR `natural_person_id` IS NULL),
  CONSTRAINT `check_legal_person_or_natural_person` CHECK (`legal_person_id` IS NOT NULL OR `natural_person_id` IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `customer_customersellershare` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `percentage` TEXT NOT NULL,
  `client_agency_id` BIGINT NOT NULL,
  `seller_id` BIGINT NOT NULL,
  CONSTRAINT `customer_customersel_client_agency_id_7fea7fb0_fk_customer_` FOREIGN KEY (`client_agency_id`) REFERENCES `customer_clientagency` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_customersel_seller_id_71f300d2_fk_business_` FOREIGN KEY (`seller_id`) REFERENCES `business_seller` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `customer_document` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `completed_at` TEXT,
  `uploaded_by_id` INTEGER,
  `reader_data` TEXT,
  `client_id` BIGINT,
  CONSTRAINT `customer_document_client_id_59ab8226_fk_customer_` FOREIGN KEY (`client_id`) REFERENCES `customer_clientagency` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_document_uploaded_by_id_8852a471_fk_user_user_id` FOREIGN KEY (`uploaded_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `customer_document_tags` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `document_id` BIGINT NOT NULL,
  `documenttag_id` INTEGER NOT NULL,
  CONSTRAINT `customer_document_ta_document_id_ea97f781_fk_customer_` FOREIGN KEY (`document_id`) REFERENCES `customer_document` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_document_ta_documenttag_id_49ee51f4_fk_app_docum` FOREIGN KEY (`documenttag_id`) REFERENCES `app_documenttag` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `customer_group` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `agency_id` BIGINT,
  `description` TEXT NOT NULL,
  CONSTRAINT `customer_group_agency_id_3b3c328d_fk_business_agency_id` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `customer_legalperson` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `id_number` TEXT NOT NULL,
  `id_check_digit` TEXT NOT NULL,
  `incorporation_date` TEXT,
  `lr_name` TEXT NOT NULL,
  `lr_id_type` TEXT NOT NULL,
  `lr_id_number` TEXT NOT NULL,
  `address_id` BIGINT,
  `business_activity_id` INTEGER,
  `client_id` BIGINT NOT NULL,
  CONSTRAINT `customer_legalperson_address_id_93d0acf3_fk_customer_address_id` FOREIGN KEY (`address_id`) REFERENCES `customer_address` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_legalperson_business_activity_id_fbcde3c5_fk_app_econo` FOREIGN KEY (`business_activity_id`) REFERENCES `app_economicactivity` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_legalperson_client_id_4bf9637a_fk_customer_` FOREIGN KEY (`client_id`) REFERENCES `customer_clientagency` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `customer_legalpersoncontact` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `surname` TEXT NOT NULL,
  `email` TEXT NOT NULL,
  `phone` TEXT NOT NULL,
  `position` TEXT NOT NULL,
  `legal_person_id` BIGINT NOT NULL,
  `is_main` INTEGER NOT NULL,
  `name` TEXT NOT NULL,
  `comments` TEXT NOT NULL,
  CONSTRAINT `customer_legalperson_legal_person_id_af37b447_fk_customer_` FOREIGN KEY (`legal_person_id`) REFERENCES `customer_legalperson` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `customer_naturalperson` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `surname` TEXT NOT NULL,
  `birth_date` TEXT,
  `phone` TEXT NOT NULL,
  `id_type` TEXT NOT NULL,
  `id_number` TEXT NOT NULL,
  `id_issue_at` TEXT,
  `marital_status` TEXT NOT NULL,
  `occupation` TEXT NOT NULL,
  `company` TEXT NOT NULL,
  `home_address_id` BIGINT,
  `work_address_id` BIGINT,
  `genre` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `email` TEXT NOT NULL,
  `client_id` BIGINT NOT NULL,
  CONSTRAINT `customer_naturalpers_client_id_64a2c072_fk_customer_` FOREIGN KEY (`client_id`) REFERENCES `customer_clientagency` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_naturalpers_home_address_id_94875213_fk_customer_` FOREIGN KEY (`home_address_id`) REFERENCES `customer_address` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_naturalpers_work_address_id_191ca03d_fk_customer_` FOREIGN KEY (`work_address_id`) REFERENCES `customer_address` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `customer_prospect` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `status` TEXT NOT NULL,
  `person_type` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `surname` TEXT NOT NULL,
  `business_name` TEXT NOT NULL,
  `id_type` TEXT NOT NULL,
  `id_number` TEXT NOT NULL,
  `id_check_digit` TEXT NOT NULL,
  `phone` TEXT NOT NULL,
  `email` TEXT NOT NULL,
  `currency` TEXT NOT NULL,
  `annual_premium_potential` TEXT,
  `annual_commission_potential` TEXT,
  `closed_at` TEXT,
  `completed_at` TEXT,
  `agency_id` BIGINT NOT NULL,
  `origin` TEXT NOT NULL,
  `referred_by` TEXT NOT NULL,
  `referred_by_client_id` BIGINT,
  `conversion_client_agency_id` BIGINT,
  `commercial_analysis_last_attempt_failed` INTEGER NOT NULL,
  `is_commercial_analysis_generating` INTEGER NOT NULL,
  CONSTRAINT `customer_prospect_agency_id_4b27de94_fk_business_agency_id` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_prospect_conversion_client_ag_c3866cc2_fk_customer_` FOREIGN KEY (`conversion_client_agency_id`) REFERENCES `customer_clientagency` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_prospect_referred_by_client_i_bf2d016c_fk_customer_` FOREIGN KEY (`referred_by_client_id`) REFERENCES `customer_clientagency` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `customer_prospectdocument` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `completed_at` TEXT,
  `is_commercial_analysis` INTEGER NOT NULL,
  `prospect_id` BIGINT NOT NULL,
  `uploaded_by_id` INTEGER,
  CONSTRAINT `customer_prospectdoc_prospect_id_be0f5987_fk_customer_` FOREIGN KEY (`prospect_id`) REFERENCES `customer_prospect` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_prospectdoc_uploaded_by_id_55894c82_fk_user_user` FOREIGN KEY (`uploaded_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `customer_prospectdocument_tags` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `prospectdocument_id` BIGINT NOT NULL,
  `documenttag_id` INTEGER NOT NULL,
  CONSTRAINT `customer_prospectdoc_documenttag_id_bd2598fd_fk_app_docum` FOREIGN KEY (`documenttag_id`) REFERENCES `app_documenttag` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_prospectdoc_prospectdocument_id_7df9ac9d_fk_customer_` FOREIGN KEY (`prospectdocument_id`) REFERENCES `customer_prospectdocument` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `customer_prospectlog` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `created_at` TEXT NOT NULL,
  `info` TEXT NOT NULL,
  `created_by_id` INTEGER,
  `prospect_id` BIGINT NOT NULL,
  CONSTRAINT `customer_prospectlog_created_by_id_c5e6ea91_fk_user_user_id` FOREIGN KEY (`created_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `customer_prospectlog_prospect_id_73705178_fk_customer_` FOREIGN KEY (`prospect_id`) REFERENCES `customer_prospect` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `django_admin_log` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `action_time` TEXT NOT NULL,
  `object_id` TEXT,
  `object_repr` TEXT NOT NULL,
  `action_flag` INTEGER NOT NULL,
  `change_message` TEXT NOT NULL,
  `content_type_id` INTEGER,
  `user_id` INTEGER NOT NULL,
  CONSTRAINT `django_admin_log_content_type_id_c4bce8eb_fk_django_co` FOREIGN KEY (`content_type_id`) REFERENCES `django_content_type` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `django_admin_log_user_id_c564eba6_fk_user_user_id` FOREIGN KEY (`user_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `django_admin_log_action_flag_check` CHECK (`action_flag` >= 0)
);
--> statement-breakpoint
CREATE TABLE `django_content_type` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `app_label` TEXT NOT NULL,
  `model` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `django_migrations` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `app` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `applied` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `django_session` (
  `session_key` TEXT PRIMARY KEY NOT NULL,
  `session_data` TEXT NOT NULL,
  `expire_date` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `django_site` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `domain` TEXT NOT NULL,
  `name` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `financial_statements_accountnormalization` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `original_name` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `account_code` BIGINT NOT NULL,
  `eeff` TEXT NOT NULL,
  `fp_a` TEXT NOT NULL,
  `presupuesto` TEXT NOT NULL,
  `modelo` TEXT NOT NULL,
  CONSTRAINT `financial_statements_agency_id_e4c4bf4c_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `financial_statements_accountnormalizationfile` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `status` TEXT NOT NULL,
  `report` TEXT NOT NULL,
  `created_by_id` INTEGER,
  CONSTRAINT `financial_statements_created_by_id_81f89c14_fk_user_user` FOREIGN KEY (`created_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `financial_statements_agencyauthentication` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `user` TEXT NOT NULL,
  `key` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `financial_statements_agency_id_d33cb339_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `financial_statements_financialreportfile` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `month` INTEGER NOT NULL,
  `year` INTEGER NOT NULL,
  `status` TEXT NOT NULL,
  `report` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `financial_statements_agency_id_75df599f_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `financial_statements_financialreportfile_month_check` CHECK (`month` >= 0),
  CONSTRAINT `financial_statements_financialreportfile_year_check` CHECK (`year` >= 0)
);
--> statement-breakpoint
CREATE TABLE `financial_statements_financialreportrequest` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `month_since` INTEGER NOT NULL,
  `month_until` INTEGER NOT NULL,
  `year` INTEGER NOT NULL,
  `report` TEXT NOT NULL,
  `created_by_id` INTEGER,
  CONSTRAINT `financial_statements_created_by_id_c803e6fb_fk_user_user` FOREIGN KEY (`created_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `financial_statements_financialreportrequest_month_since_check` CHECK (`month_since` >= 0),
  CONSTRAINT `financial_statements_financialreportrequest_month_until_check` CHECK (`month_until` >= 0),
  CONSTRAINT `financial_statements_financialreportrequest_year_check` CHECK (`year` >= 0)
);
--> statement-breakpoint
CREATE TABLE `financial_statements_financialreportrequest_agencies` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `financialreportrequest_id` BIGINT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `financial_statements_agency_id_da7e2990_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `financial_statements_financialreportreque_158760b1_fk_financial` FOREIGN KEY (`financialreportrequest_id`) REFERENCES `financial_statements_financialreportrequest` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `financial_statements_financialstatement` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `level` TEXT NOT NULL,
  `transactional` TEXT NOT NULL,
  `account_code` BIGINT NOT NULL,
  `account_name` TEXT NOT NULL,
  `id_number` TEXT,
  `branch` TEXT,
  `third_party_name` TEXT,
  `initial_balance` TEXT NOT NULL,
  `debit_movement` TEXT NOT NULL,
  `credit_movement` TEXT NOT NULL,
  `final_balance` TEXT NOT NULL,
  `fp_a` TEXT NOT NULL,
  `eeff` TEXT NOT NULL,
  `presupuesto` TEXT NOT NULL,
  `report_file_id` BIGINT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `month` INTEGER NOT NULL,
  `year` INTEGER NOT NULL,
  `modelo` TEXT NOT NULL,
  CONSTRAINT `financial_statements_agency_id_8d43f63c_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `financial_statements_report_file_id_5d6d8329_fk_financial` FOREIGN KEY (`report_file_id`) REFERENCES `financial_statements_financialreportfile` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `financial_statements_financialstatement_month_check` CHECK (`month` >= 0),
  CONSTRAINT `financial_statements_financialstatement_year_check` CHECK (`year` >= 0)
);
--> statement-breakpoint
CREATE TABLE `help_newsletter` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `title` TEXT NOT NULL,
  `image` TEXT NOT NULL,
  `start_at` TEXT NOT NULL,
  `finish_at` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL,
  CONSTRAINT `check_start_at_before_finish_at` CHECK (`start_at` < `finish_at`)
);
--> statement-breakpoint
CREATE TABLE `help_newsletterusersurvey` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `user_name` TEXT NOT NULL,
  `response` TEXT NOT NULL,
  `comment` TEXT NOT NULL,
  `newsletter_id` BIGINT NOT NULL,
  `user_id` INTEGER,
  CONSTRAINT `help_newsletterusers_newsletter_id_182adbdb_fk_help_news` FOREIGN KEY (`newsletter_id`) REFERENCES `help_newsletter` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `help_newsletterusersurvey_user_id_d09582ca_fk_user_user_id` FOREIGN KEY (`user_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `help_request` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `title` TEXT NOT NULL,
  `created_by` TEXT NOT NULL,
  `created_by_slug` TEXT NOT NULL,
  `request_type` TEXT NOT NULL,
  `status` TEXT NOT NULL,
  `description` TEXT NOT NULL,
  `need_to_solve` TEXT NOT NULL,
  `problem_impact` TEXT NOT NULL,
  `problem_frequency` TEXT NOT NULL,
  `current_alternatives` TEXT NOT NULL,
  `expected_result` TEXT NOT NULL,
  `acceptance_criteria` TEXT NOT NULL,
  `priority` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `assigned_to_id` INTEGER NOT NULL,
  `category_id` BIGINT,
  CONSTRAINT `help_request_agency_id_98d824c1_fk_business_agency_id` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `help_request_assigned_to_id_96be169a_fk_user_user_id` FOREIGN KEY (`assigned_to_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `help_request_category_id_9f6f2b07_fk_help_requestcategory_id` FOREIGN KEY (`category_id`) REFERENCES `help_requestcategory` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `help_requestcategory` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `request_type` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `help_requestdocument` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `completed_at` TEXT,
  `request_id` BIGINT,
  CONSTRAINT `help_requestdocument_request_id_229c763b_fk_help_request_id` FOREIGN KEY (`request_id`) REFERENCES `help_request` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `help_requestlog` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `created_at` TEXT NOT NULL,
  `info` TEXT NOT NULL,
  `created_by_id` INTEGER,
  `request_id` BIGINT NOT NULL,
  `attachment` TEXT,
  CONSTRAINT `help_requestlog_created_by_id_44b7692f_fk_user_user_id` FOREIGN KEY (`created_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `help_requestlog_request_id_05a61021_fk_help_request_id` FOREIGN KEY (`request_id`) REFERENCES `help_request` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `help_trainingcategory` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `name_slug` TEXT NOT NULL,
  `is_main` INTEGER NOT NULL,
  `is_reconciliation` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE `help_trainingvideo` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `youtube_id` TEXT NOT NULL,
  `title` TEXT NOT NULL,
  `description` TEXT NOT NULL,
  `duration` TEXT NOT NULL,
  `order` INTEGER NOT NULL,
  `category_id` BIGINT NOT NULL,
  CONSTRAINT `help_trainingvideo_category_id_72f7823f_fk_help_trai` FOREIGN KEY (`category_id`) REFERENCES `help_trainingcategory` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `help_trainingvideo_order_check` CHECK ("order" >= 0)
);
--> statement-breakpoint
CREATE TABLE `insurance_agencyshare` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `percentage` TEXT NOT NULL,
  `is_main` INTEGER NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `policy_id` BIGINT NOT NULL,
  `commercial_unit_id` BIGINT,
  CONSTRAINT `insurance_agencyshar_commercial_unit_id_841e4958_fk_business_` FOREIGN KEY (`commercial_unit_id`) REFERENCES `business_commercialunit` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `insurance_agencyshare_agency_id_cc36e32f_fk_business_agency_id` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `insurance_agencyshare_policy_id_e13263a9_fk_insurance_policy_id` FOREIGN KEY (`policy_id`) REFERENCES `insurance_policy` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `insurance_beneficiary` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `id_number` TEXT NOT NULL,
  `is_borrow` INTEGER NOT NULL,
  `insured_id` BIGINT NOT NULL,
  CONSTRAINT `insurance_beneficiar_insured_id_e011a2c7_fk_insurance` FOREIGN KEY (`insured_id`) REFERENCES `insurance_insured` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `insurance_endorsement` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `number` TEXT,
  `type` TEXT NOT NULL,
  `start_at` TEXT,
  `finish_at` TEXT,
  `issue_at` TEXT,
  `description` TEXT NOT NULL,
  `basic_premium` TEXT,
  `additional_costs` TEXT NOT NULL,
  `issuing_costs` TEXT NOT NULL,
  `tax_amount` TEXT,
  `total_premium` TEXT,
  `policy_id` BIGINT NOT NULL,
  `completed_at` TEXT,
  `migration_slug` TEXT NOT NULL,
  `commission_percentage` TEXT,
  `commission_amount` TEXT,
  `sent_at` TEXT,
  `basic_premium_cop` TEXT,
  `commission_amount_cop` TEXT,
  `rmr` TEXT NOT NULL,
  `total_premium_cop` TEXT,
  `computed_data` TEXT NOT NULL,
  `cancellation_reason_id` BIGINT,
  `term_id` BIGINT,
  `external_id` TEXT NOT NULL,
  `renewal_at` TEXT,
  `contract_validity_at` TEXT,
  CONSTRAINT `insurance_endorsemen_cancellation_reason__8bc5b6a2_fk_renewal_n` FOREIGN KEY (`cancellation_reason_id`) REFERENCES `renewal_nonrenewalreason` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `insurance_endorsement_policy_id_b0b23462_fk_insurance_policy_id` FOREIGN KEY (`policy_id`) REFERENCES `insurance_policy` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `insurance_endorsement_term_id_07a63fca_fk_insurance_term_id` FOREIGN KEY (`term_id`) REFERENCES `insurance_term` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `start_finish_check` CHECK (`start_at` <= `finish_at`)
);
--> statement-breakpoint
CREATE TABLE `insurance_endorsementdocument` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `completed_at` TEXT,
  `endorsement_id` BIGINT,
  `uploaded_by_id` INTEGER,
  CONSTRAINT `insurance_endorsemen_endorsement_id_2e391ce7_fk_insurance` FOREIGN KEY (`endorsement_id`) REFERENCES `insurance_endorsement` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `insurance_endorsemen_uploaded_by_id_3203c443_fk_user_user` FOREIGN KEY (`uploaded_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `insurance_endorsementdocument_tags` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `endorsementdocument_id` BIGINT NOT NULL,
  `documenttag_id` INTEGER NOT NULL,
  CONSTRAINT `insurance_endorsemen_documenttag_id_2ce6ecc8_fk_app_docum` FOREIGN KEY (`documenttag_id`) REFERENCES `app_documenttag` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `insurance_endorsemen_endorsementdocument__c6763b47_fk_insurance` FOREIGN KEY (`endorsementdocument_id`) REFERENCES `insurance_endorsementdocument` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `insurance_insured` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `id_type` TEXT NOT NULL,
  `id_number` TEXT NOT NULL,
  `phone` TEXT,
  `email` TEXT NOT NULL,
  `birth_date` TEXT,
  `endorsement_id` BIGINT NOT NULL,
  `amount` TEXT,
  `end_at` TEXT,
  `label` TEXT NOT NULL,
  `start_at` TEXT,
  CONSTRAINT `insurance_insured_endorsement_id_b954bc53_fk_insurance` FOREIGN KEY (`endorsement_id`) REFERENCES `insurance_endorsement` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `insurance_insurershare` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `percentage` TEXT NOT NULL,
  `is_main` INTEGER NOT NULL,
  `insurer_company_id` BIGINT NOT NULL,
  `policy_id` BIGINT NOT NULL,
  CONSTRAINT `insurance_insuredsha_policy_id_cbdd6a1f_fk_insurance` FOREIGN KEY (`policy_id`) REFERENCES `insurance_policy` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `insurance_insurersha_insurer_company_id_60dcec34_fk_business_` FOREIGN KEY (`insurer_company_id`) REFERENCES `insurer_companies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `insurance_paymenttaskreminder` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `frequency` TEXT NOT NULL,
  `reminder_at` TEXT NOT NULL,
  `owner_id` INTEGER NOT NULL,
  `policy_id` BIGINT NOT NULL,
  `last_reminder_at` TEXT,
  CONSTRAINT `insurance_paymenttas_policy_id_205fbc21_fk_insurance` FOREIGN KEY (`policy_id`) REFERENCES `insurance_policy` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `insurance_paymenttaskreminder_owner_id_45067725_fk_user_user_id` FOREIGN KEY (`owner_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `insurance_policy` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `type` TEXT NOT NULL,
  `currency` TEXT NOT NULL,
  `insurance_number` TEXT NOT NULL,
  `holder_name` TEXT NOT NULL,
  `holder_id` TEXT NOT NULL,
  `client_id` BIGINT NOT NULL,
  `payment_type` TEXT NOT NULL,
  `ramo_id` BIGINT NOT NULL,
  `renewal_type` TEXT NOT NULL,
  `created_by` TEXT NOT NULL,
  `status` TEXT NOT NULL,
  `completed_at` TEXT,
  `is_same_insured` INTEGER NOT NULL,
  `renewed_policy_id` BIGINT,
  `migration_slug` TEXT NOT NULL,
  `created_by_slug` TEXT NOT NULL,
  `has_lienholder` INTEGER NOT NULL,
  `has_seller` INTEGER,
  `computed_data` TEXT NOT NULL,
  `insurance_subject` TEXT NOT NULL,
  `external_id` TEXT NOT NULL,
  `owner_id` INTEGER,
  `allows_endorsement_extended_term` INTEGER NOT NULL,
  `document_url` TEXT NOT NULL,
  `prospect_id` BIGINT,
  CONSTRAINT `insurance_policy_client_id_eb5c6b14_fk_customer_client_id` FOREIGN KEY (`client_id`) REFERENCES `customer_client` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `insurance_policy_owner_id_123e367d_fk_user_user_id` FOREIGN KEY (`owner_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `insurance_policy_prospect_id_9dd035d1_fk_customer_prospect_id` FOREIGN KEY (`prospect_id`) REFERENCES `customer_prospect` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `insurance_policy_ramo_id_923a5687_fk_business_ramo_id` FOREIGN KEY (`ramo_id`) REFERENCES `ramos` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `insurance_policy_renewed_policy_id_18cb811b_fk_insurance` FOREIGN KEY (`renewed_policy_id`) REFERENCES `insurance_policy` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `insurance_policydocument` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `policy_id` BIGINT,
  `completed_at` TEXT,
  `uploaded_by_id` INTEGER,
  `reader_data` TEXT,
  CONSTRAINT `insurance_document_policy_id_4ebbd891_fk_insurance_policy_id` FOREIGN KEY (`policy_id`) REFERENCES `insurance_policy` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `insurance_document_uploaded_by_id_08c02069_fk_user_user_id` FOREIGN KEY (`uploaded_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `insurance_policydocument_tags` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `policydocument_id` BIGINT NOT NULL,
  `documenttag_id` INTEGER NOT NULL,
  CONSTRAINT `insurance_policydocu_documenttag_id_60456c44_fk_app_docum` FOREIGN KEY (`documenttag_id`) REFERENCES `app_documenttag` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `insurance_policydocu_policydocument_id_879f945f_fk_insurance` FOREIGN KEY (`policydocument_id`) REFERENCES `insurance_policydocument` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `insurance_policylog` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `created_at` TEXT NOT NULL,
  `info` TEXT NOT NULL,
  `created_by_id` INTEGER,
  `policy_id` BIGINT NOT NULL,
  CONSTRAINT `insurance_policylog_created_by_id_894131d9_fk_user_user_id` FOREIGN KEY (`created_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `insurance_policylog_policy_id_384e51e8_fk_insurance_policy_id` FOREIGN KEY (`policy_id`) REFERENCES `insurance_policy` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `insurance_reinvestment` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `invoice` TEXT NOT NULL,
  `amount` TEXT NOT NULL,
  `provider_name` TEXT NOT NULL,
  `provider_id` TEXT NOT NULL,
  `provider_id_type` TEXT NOT NULL,
  `provider_id_check_digit` TEXT NOT NULL,
  `activity_at` TEXT NOT NULL,
  `observation` TEXT NOT NULL,
  `policy_id` BIGINT NOT NULL,
  `activity_id` BIGINT NOT NULL,
  `provider_name_slug` TEXT NOT NULL,
  CONSTRAINT `insurance_reinvestme_activity_id_0aab95b9_fk_insurance` FOREIGN KEY (`activity_id`) REFERENCES `insurance_reinvestmentactivity` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `insurance_reinvestme_policy_id_ed20e05e_fk_insurance` FOREIGN KEY (`policy_id`) REFERENCES `insurance_policy` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `insurance_reinvestmentactivity` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE `insurance_reinvestmentterm` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `total_estimated_amount` TEXT NOT NULL,
  `reinvestment_percentage` TEXT NOT NULL,
  `term_id` BIGINT NOT NULL,
  CONSTRAINT `insurance_reinvestme_term_id_c726b5ab_fk_insurance` FOREIGN KEY (`term_id`) REFERENCES `insurance_term` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `insurance_sellershare` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `percentage` TEXT NOT NULL,
  `policy_id` BIGINT NOT NULL,
  `seller_id` BIGINT NOT NULL,
  CONSTRAINT `insurance_sellershare_policy_id_7b1cda14_fk_insurance_policy_id` FOREIGN KEY (`policy_id`) REFERENCES `insurance_policy` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `insurance_sellershare_seller_id_37bb8da0_fk_business_seller_id` FOREIGN KEY (`seller_id`) REFERENCES `business_seller` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `insurance_term` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `start_at` TEXT NOT NULL,
  `finish_at` TEXT NOT NULL,
  `policy_id` BIGINT NOT NULL,
  `computed_data` TEXT NOT NULL,
  CONSTRAINT `insurance_term_policy_id_6da1bd48_fk_insurance_policy_id` FOREIGN KEY (`policy_id`) REFERENCES `insurance_policy` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `mfa_authenticator` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `type` TEXT NOT NULL,
  `data` TEXT NOT NULL,
  `user_id` INTEGER NOT NULL,
  `created_at` TEXT NOT NULL,
  `last_used_at` TEXT,
  CONSTRAINT `mfa_authenticator_user_id_0c3a50c0_fk_user_user_id` FOREIGN KEY (`user_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `notification_attachment` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `notification_id` BIGINT NOT NULL,
  `name` TEXT NOT NULL,
  `is_initial` INTEGER NOT NULL,
  `extension` TEXT NOT NULL,
  `microsoft_id` TEXT NOT NULL,
  CONSTRAINT `notification_attachm_notification_id_f2ac0433_fk_notificat` FOREIGN KEY (`notification_id`) REFERENCES `notification_externalnotification` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `notification_configuration` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `payment_email` TEXT NOT NULL,
  `renewal_email` TEXT NOT NULL,
  `payment_first_notification_days` INTEGER,
  `payment_second_notification_days` INTEGER,
  `renewal_first_notification_days` INTEGER,
  `renewal_second_notification_days` INTEGER,
  `agency_id` BIGINT NOT NULL,
  `birthday_email` TEXT NOT NULL,
  `birthday_notification` INTEGER NOT NULL,
  CONSTRAINT `notification_configu_agency_id_c1109958_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `notification_configuration_payment_first_notification_day_check` CHECK (`payment_first_notification_days` >= 0),
  CONSTRAINT `notification_configuration_payment_second_notification_da_check` CHECK (`payment_second_notification_days` >= 0),
  CONSTRAINT `notification_configuration_renewal_first_notification_day_check` CHECK (`renewal_first_notification_days` >= 0),
  CONSTRAINT `notification_configuration_renewal_second_notification_da_check` CHECK (`renewal_second_notification_days` >= 0)
);
--> statement-breakpoint
CREATE TABLE `notification_customemailtemplatetype` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `description` TEXT NOT NULL,
  `email_template_id` BIGINT,
  CONSTRAINT `notification_custome_email_template_id_1c39d1fd_fk_notificat` FOREIGN KEY (`email_template_id`) REFERENCES `notification_emailtemplate` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `notification_emailtemplate` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `type` TEXT NOT NULL,
  `subject` TEXT NOT NULL,
  `body` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `notification_emailte_agency_id_e8d21063_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `notification_emailtemplate_ramos` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `emailtemplate_id` BIGINT NOT NULL,
  `ramo_id` BIGINT NOT NULL,
  CONSTRAINT `notification_emailte_emailtemplate_id_dff5de74_fk_notificat` FOREIGN KEY (`emailtemplate_id`) REFERENCES `notification_emailtemplate` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `notification_emailte_ramo_id_0b6278db_fk_business_` FOREIGN KEY (`ramo_id`) REFERENCES `ramos` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `notification_emailtemplateimage` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `image` TEXT,
  `template_id` BIGINT,
  CONSTRAINT `notification_emailte_template_id_5e66b604_fk_notificat` FOREIGN KEY (`template_id`) REFERENCES `notification_emailtemplate` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `notification_externalnotification` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `mail_to` TEXT NOT NULL,
  `send_at` TEXT,
  `type` TEXT NOT NULL,
  `subject` TEXT NOT NULL,
  `body` TEXT NOT NULL,
  `status` TEXT NOT NULL,
  `client_id` BIGINT,
  `policy_id` BIGINT,
  `agency_id` BIGINT NOT NULL,
  `endorsement_id` BIGINT,
  `anymail_id` TEXT NOT NULL,
  `from_email` TEXT NOT NULL,
  `user_id` INTEGER,
  `cc_to` TEXT NOT NULL,
  `direction` TEXT NOT NULL,
  `microsoft_id` TEXT,
  `reply_to_message_id` TEXT NOT NULL,
  CONSTRAINT `notification_notific_agency_id_c168df86_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `notification_notific_client_id_56858ebd_fk_customer_` FOREIGN KEY (`client_id`) REFERENCES `customer_client` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `notification_notific_endorsement_id_c2c9e78e_fk_insurance` FOREIGN KEY (`endorsement_id`) REFERENCES `insurance_endorsement` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `notification_notific_policy_id_a1e28c8e_fk_insurance` FOREIGN KEY (`policy_id`) REFERENCES `insurance_policy` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `notification_graphsubscription` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `subscription_id` TEXT NOT NULL,
  `resource` TEXT NOT NULL,
  `expiration_datetime` TEXT NOT NULL,
  `client_state` TEXT NOT NULL,
  `mailbox_id` BIGINT NOT NULL,
  CONSTRAINT `notification_graphsu_mailbox_id_a6955787_fk_business_` FOREIGN KEY (`mailbox_id`) REFERENCES `business_agencycompliancemailbox` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `notification_internalnotification` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `section` TEXT NOT NULL,
  `created_by` TEXT NOT NULL,
  `redirect_url` TEXT NOT NULL,
  `info` TEXT NOT NULL,
  `title` TEXT NOT NULL,
  `read_at` TEXT,
  `user_id` INTEGER NOT NULL,
  CONSTRAINT `notification_interna_user_id_65cf0bbb_fk_user_user` FOREIGN KEY (`user_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `notification_microsoftgraphevent` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `external_notification_id_slug` TEXT NOT NULL,
  `action` TEXT NOT NULL,
  `outcome` TEXT NOT NULL,
  `response_data` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notification_microsoftgraphnotification` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `conversation_id` TEXT NOT NULL,
  `internet_message_id` TEXT NOT NULL,
  `compliance_request_id` BIGINT,
  `notification_id` BIGINT NOT NULL,
  CONSTRAINT `notification_microso_compliance_request_i_e29a7455_fk_complianc` FOREIGN KEY (`compliance_request_id`) REFERENCES `compliance_compliancerequest` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `notification_microso_notification_id_65e8e0e2_fk_notificat` FOREIGN KEY (`notification_id`) REFERENCES `notification_externalnotification` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `notification_ramoconfiguration` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `first_notification_days` INTEGER,
  `second_notification_days` INTEGER,
  `configuration_id` BIGINT NOT NULL,
  `ramo_id` BIGINT NOT NULL,
  `type` TEXT NOT NULL,
  CONSTRAINT `notification_ramocon_configuration_id_7dabf2e3_fk_notificat` FOREIGN KEY (`configuration_id`) REFERENCES `notification_configuration` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `notification_ramocon_ramo_id_f93c2e63_fk_business_` FOREIGN KEY (`ramo_id`) REFERENCES `ramos` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `notification_ramoconfiguration_first_notification_days_check` CHECK (`first_notification_days` >= 0),
  CONSTRAINT `notification_ramoconfiguration_second_notification_days_check` CHECK (`second_notification_days` >= 0)
);
--> statement-breakpoint
CREATE TABLE `operation_collectionfile` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `report_file` TEXT,
  `report` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `insurance_company_id` BIGINT,
  CONSTRAINT `operation_collection_agency_id_06507374_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_collection_insurance_company_id_8b62a21b_fk_business_` FOREIGN KEY (`insurance_company_id`) REFERENCES `insurer_companies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_payment` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `amount` TEXT NOT NULL,
  `commission_amount` TEXT NOT NULL,
  `due_date` TEXT NOT NULL,
  `receipt` TEXT,
  `status` TEXT NOT NULL,
  `commissioned_at` TEXT,
  `remission` TEXT,
  `paid_at` TEXT,
  `settlement_id` BIGINT,
  `migration_slug` TEXT NOT NULL,
  `created_by` TEXT NOT NULL,
  `created_by_slug` TEXT NOT NULL,
  `receipt_number` TEXT NOT NULL,
  `installments` INTEGER,
  `agency_id` BIGINT NOT NULL,
  `basic_premium_cop` TEXT,
  `commission_amount_cop` TEXT,
  `rmr` TEXT NOT NULL,
  `comments` TEXT NOT NULL,
  `reconciliation_slug` TEXT NOT NULL,
  `paid_at_set_at` TEXT,
  `computed_data` TEXT NOT NULL,
  `external_id` TEXT NOT NULL,
  `term_id` BIGINT NOT NULL,
  CONSTRAINT `operation_payment_agency_id_4f7025a4_fk_business_agency_id` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_payment_settlement_id_e045a3e1_fk_operation` FOREIGN KEY (`settlement_id`) REFERENCES `operation_settlement` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_payment_term_id_2da86979_fk_insurance_term_id` FOREIGN KEY (`term_id`) REFERENCES `insurance_term` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_paymentamount` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `amount` TEXT NOT NULL,
  `commission_amount` TEXT NOT NULL,
  `endorsement_id` BIGINT NOT NULL,
  `payment_id` BIGINT NOT NULL,
  CONSTRAINT `operation_paymentamo_endorsement_id_413129e4_fk_insurance` FOREIGN KEY (`endorsement_id`) REFERENCES `insurance_endorsement` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_paymentamo_payment_id_e5a76acd_fk_operation` FOREIGN KEY (`payment_id`) REFERENCES `operation_payment` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_paymentcollectionfollowup` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `contact_date` TEXT NOT NULL,
  `contact_type` TEXT NOT NULL,
  `outcome` TEXT NOT NULL,
  `promise_date` TEXT,
  `promise_amount` TEXT,
  `comments` TEXT NOT NULL,
  `created_by` TEXT NOT NULL,
  `created_by_slug` TEXT NOT NULL,
  `payment_id` BIGINT NOT NULL,
  `owner_id` INTEGER,
  CONSTRAINT `operation_paymentcol_owner_id_edfedb51_fk_user_user` FOREIGN KEY (`owner_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_paymentcol_payment_id_266572a1_fk_operation` FOREIGN KEY (`payment_id`) REFERENCES `operation_payment` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_paymentlog` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `created_at` TEXT NOT NULL,
  `info` TEXT NOT NULL,
  `created_by_id` INTEGER,
  `payment_id` BIGINT NOT NULL,
  CONSTRAINT `operation_paymentlog_created_by_id_637cf7c9_fk_user_user_id` FOREIGN KEY (`created_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_paymentlog_payment_id_a5a6f584_fk_operation` FOREIGN KEY (`payment_id`) REFERENCES `operation_payment` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_paymentresponsible` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `id_type` TEXT NOT NULL,
  `id_number` TEXT NOT NULL,
  `email` TEXT NOT NULL,
  `payment_id` BIGINT NOT NULL,
  CONSTRAINT `operation_paymentres_payment_id_768ebef5_fk_operation` FOREIGN KEY (`payment_id`) REFERENCES `operation_payment` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_portfolioreconciliationfile` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `uploaded_by_name` TEXT NOT NULL,
  `uploaded_file` TEXT NOT NULL,
  `report_file` TEXT,
  `agency_id` BIGINT NOT NULL,
  `insurance_company_id` BIGINT,
  CONSTRAINT `operation_portfolior_agency_id_dca12050_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_portfolior_insurance_company_id_931b5172_fk_business_` FOREIGN KEY (`insurance_company_id`) REFERENCES `insurer_companies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_reconciliationfile` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `file_hash` TEXT NOT NULL,
  `cutoff_date` TEXT NOT NULL,
  `extension` TEXT NOT NULL,
  `report` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `insurance_company_id` BIGINT,
  `completed_at` TEXT,
  `report_file` TEXT,
  CONSTRAINT `operation_reconcilia_agency_id_cb7c2dd3_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_reconcilia_insurance_company_id_ffe2759d_fk_business_` FOREIGN KEY (`insurance_company_id`) REFERENCES `insurer_companies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_reimbursement` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `charged_amount` TEXT,
  `affected` TEXT NOT NULL,
  `reason` TEXT NOT NULL,
  `subject` TEXT NOT NULL,
  `invoice_number` TEXT NOT NULL,
  `received_at` TEXT,
  `event_date` TEXT,
  `payment_at` TEXT,
  `paid_amount` TEXT,
  `is_foreign` INTEGER NOT NULL,
  `foreign_charged_amount` TEXT,
  `charged_currency` TEXT NOT NULL,
  `foreign_paid_amount` TEXT,
  `paid_currency` TEXT NOT NULL,
  `deductible` TEXT,
  `task_id` BIGINT NOT NULL,
  CONSTRAINT `operation_reimbursement_task_id_4b3c5c25_fk_operation_task_id` FOREIGN KEY (`task_id`) REFERENCES `operation_task` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_reimbursementreport` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `account_number` TEXT NOT NULL,
  `account_type` TEXT NOT NULL,
  `account_holder` TEXT NOT NULL,
  `observations` TEXT NOT NULL,
  `created_by` TEXT NOT NULL,
  `created_by_slug` TEXT NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `bank_id` INTEGER,
  `term_id` BIGINT NOT NULL,
  CONSTRAINT `operation_reimbursem_agency_id_7e5c4435_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_reimbursem_term_id_ed6a4b9b_fk_insurance` FOREIGN KEY (`term_id`) REFERENCES `insurance_term` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_reimbursementreport_bank_id_6af2f399_fk_app_bank_id` FOREIGN KEY (`bank_id`) REFERENCES `app_bank` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_reimbursementreport_reimbursements` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `reimbursementreport_id` BIGINT NOT NULL,
  `reimbursement_id` BIGINT NOT NULL,
  CONSTRAINT `operation_reimbursem_reimbursement_id_01608196_fk_operation` FOREIGN KEY (`reimbursement_id`) REFERENCES `operation_reimbursement` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_reimbursem_reimbursementreport__93d8f533_fk_operation` FOREIGN KEY (`reimbursementreport_id`) REFERENCES `operation_reimbursementreport` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_settlement` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `taxes` TEXT NOT NULL,
  `seller_id` BIGINT NOT NULL,
  `agency_commission_amount` TEXT NOT NULL,
  `premium_amount` TEXT NOT NULL,
  `seller_commission_amount` TEXT NOT NULL,
  `tax_withholding` TEXT NOT NULL,
  `total_amount` TEXT NOT NULL,
  `paid_at` TEXT,
  CONSTRAINT `operation_settlement_seller_id_1a02f672_fk_business_seller_id` FOREIGN KEY (`seller_id`) REFERENCES `business_seller` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_settlementdocument` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `completed_at` TEXT,
  `settlement_id` BIGINT NOT NULL,
  `uploaded_by_id` INTEGER,
  CONSTRAINT `operation_settlement_settlement_id_ae87858e_fk_operation` FOREIGN KEY (`settlement_id`) REFERENCES `operation_settlement` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_settlement_uploaded_by_id_8bdebe24_fk_user_user` FOREIGN KEY (`uploaded_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_settlementdocument_tags` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `settlementdocument_id` BIGINT NOT NULL,
  `documenttag_id` INTEGER NOT NULL,
  CONSTRAINT `operation_settlement_documenttag_id_43cdefe6_fk_app_docum` FOREIGN KEY (`documenttag_id`) REFERENCES `app_documenttag` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_settlement_settlementdocument_i_ea938c90_fk_operation` FOREIGN KEY (`settlementdocument_id`) REFERENCES `operation_settlementdocument` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_settlementlog` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `created_at` TEXT NOT NULL,
  `info` TEXT NOT NULL,
  `created_by_id` INTEGER,
  `settlement_id` BIGINT NOT NULL,
  CONSTRAINT `operation_settlement_settlement_id_11b6af00_fk_operation` FOREIGN KEY (`settlement_id`) REFERENCES `operation_settlement` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_settlementlog_created_by_id_5e49dea6_fk_user_user_id` FOREIGN KEY (`created_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_task` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `status` TEXT NOT NULL,
  `due_date` TEXT,
  `client_id` BIGINT,
  `owner_id` INTEGER,
  `policy_id` BIGINT,
  `ramo_id` BIGINT,
  `agency_id` BIGINT NOT NULL,
  `completed_at` TEXT,
  `name` TEXT NOT NULL,
  `priority` TEXT NOT NULL,
  `reminder_at` TEXT,
  `closed_at` TEXT,
  `type_id` BIGINT NOT NULL,
  `claim_id` BIGINT,
  `migration_slug` TEXT NOT NULL,
  `computed_data` TEXT NOT NULL,
  `seller_id` BIGINT,
  `is_automatic` INTEGER NOT NULL,
  `created_by` TEXT NOT NULL,
  `created_by_slug` TEXT NOT NULL,
  `external_id` TEXT NOT NULL,
  `days_count` INTEGER NOT NULL,
  `prospect_id` BIGINT,
  CONSTRAINT `operation_task_agency_id_255288ad_fk_business_agency_id` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_task_claim_id_8eb9e872_fk_claim_claim_id` FOREIGN KEY (`claim_id`) REFERENCES `claim_claim` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_task_client_id_920a42d2_fk_customer_client_id` FOREIGN KEY (`client_id`) REFERENCES `customer_client` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_task_owner_id_9dffc449_fk_user_user_id` FOREIGN KEY (`owner_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_task_policy_id_4956e34a_fk_insurance_policy_id` FOREIGN KEY (`policy_id`) REFERENCES `insurance_policy` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_task_prospect_id_bf6330d1_fk_customer_prospect_id` FOREIGN KEY (`prospect_id`) REFERENCES `customer_prospect` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_task_ramo_id_35a85ba2_fk_business_ramo_id` FOREIGN KEY (`ramo_id`) REFERENCES `ramos` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_task_seller_id_714fb3dd_fk_business_seller_id` FOREIGN KEY (`seller_id`) REFERENCES `business_seller` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_task_type_id_c50d3eec_fk_operation_tasktype_id` FOREIGN KEY (`type_id`) REFERENCES `operation_tasktype` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_task_tags` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `task_id` BIGINT NOT NULL,
  `tasktag_id` BIGINT NOT NULL,
  CONSTRAINT `operation_task_tags_task_id_3db112ae_fk_operation_task_id` FOREIGN KEY (`task_id`) REFERENCES `operation_task` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_task_tags_tasktag_id_6ffb96cf_fk_operation_tasktag_id` FOREIGN KEY (`tasktag_id`) REFERENCES `operation_tasktag` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_taskassignmentrule` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL,
  `created_by` TEXT NOT NULL,
  `position` INTEGER NOT NULL,
  `agency_id` BIGINT NOT NULL,
  `owner_id` INTEGER NOT NULL,
  CONSTRAINT `operation_taskassign_agency_id_1ef5517c_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_taskassignmentrule_owner_id_fc102e94_fk_user_user_id` FOREIGN KEY (`owner_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_taskassignmentrule_insurers` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `taskassignmentrule_id` BIGINT NOT NULL,
  `insurercompany_id` BIGINT NOT NULL,
  CONSTRAINT `operation_taskassign_insurercompany_id_3053060c_fk_business_` FOREIGN KEY (`insurercompany_id`) REFERENCES `insurer_companies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_taskassign_taskassignmentrule_i_fe025143_fk_operation` FOREIGN KEY (`taskassignmentrule_id`) REFERENCES `operation_taskassignmentrule` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_taskassignmentrule_ramos` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `taskassignmentrule_id` BIGINT NOT NULL,
  `ramo_id` BIGINT NOT NULL,
  CONSTRAINT `operation_taskassign_ramo_id_67cfb846_fk_business_` FOREIGN KEY (`ramo_id`) REFERENCES `ramos` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_taskassign_taskassignmentrule_i_1945617f_fk_operation` FOREIGN KEY (`taskassignmentrule_id`) REFERENCES `operation_taskassignmentrule` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_taskassignmentrule_sellers` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `taskassignmentrule_id` BIGINT NOT NULL,
  `seller_id` BIGINT NOT NULL,
  CONSTRAINT `operation_taskassign_seller_id_f1feaed8_fk_business_` FOREIGN KEY (`seller_id`) REFERENCES `business_seller` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_taskassign_taskassignmentrule_i_cb79d261_fk_operation` FOREIGN KEY (`taskassignmentrule_id`) REFERENCES `operation_taskassignmentrule` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_taskdocument` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `completed_at` TEXT,
  `task_id` BIGINT,
  `uploaded_by_id` INTEGER,
  CONSTRAINT `operation_taskdocument_task_id_61822f54_fk_operation_task_id` FOREIGN KEY (`task_id`) REFERENCES `operation_task` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_taskdocument_uploaded_by_id_a3a03143_fk_user_user_id` FOREIGN KEY (`uploaded_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_taskdocument_tags` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `taskdocument_id` BIGINT NOT NULL,
  `documenttag_id` INTEGER NOT NULL,
  CONSTRAINT `operation_taskdocume_documenttag_id_5cf3c231_fk_app_docum` FOREIGN KEY (`documenttag_id`) REFERENCES `app_documenttag` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_taskdocume_taskdocument_id_61a9dff4_fk_operation` FOREIGN KEY (`taskdocument_id`) REFERENCES `operation_taskdocument` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_tasklog` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `created_at` TEXT NOT NULL,
  `info` TEXT NOT NULL,
  `created_by_id` INTEGER,
  `task_id` BIGINT NOT NULL,
  CONSTRAINT `operation_tasklog_created_by_id_a31e54e9_fk_user_user_id` FOREIGN KEY (`created_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `operation_tasklog_task_id_45bc129b_fk_operation_task_id` FOREIGN KEY (`task_id`) REFERENCES `operation_task` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_tasktag` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `color` TEXT NOT NULL,
  `agency_id` BIGINT,
  CONSTRAINT `operation_tasktag_agency_id_c696bea0_fk_business_agency_id` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `operation_tasktype` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `slug` TEXT NOT NULL,
  `show_dropdown` INTEGER NOT NULL,
  `optional_customer` INTEGER NOT NULL,
  `prospect_status` TEXT
);
--> statement-breakpoint
CREATE TABLE `production_data_importproductiondatafile` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `status` TEXT NOT NULL,
  `report` TEXT NOT NULL,
  `uploaded_by_id` INTEGER,
  `agency_id` BIGINT,
  CONSTRAINT `production_data_impo_agency_id_394eab5b_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `production_data_impo_uploaded_by_id_26d8c9e6_fk_user_user` FOREIGN KEY (`uploaded_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `production_data_normalizationfile` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `type` TEXT NOT NULL,
  `status` TEXT NOT NULL,
  `report` TEXT NOT NULL,
  `created_by_id` INTEGER,
  CONSTRAINT `production_data_norm_created_by_id_56e6de5c_fk_user_user` FOREIGN KEY (`created_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `production_data_productiondata` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `policy_number` TEXT NOT NULL,
  `premium` TEXT NOT NULL,
  `commission` TEXT,
  `insured_id` TEXT,
  `insured_name` TEXT NOT NULL,
  `admission_date` TEXT NOT NULL,
  `start_date` TEXT NOT NULL,
  `end_date` TEXT NOT NULL,
  `ramo` TEXT NOT NULL,
  `insurer_name` TEXT NOT NULL,
  `agency_name` TEXT NOT NULL,
  `unique_slug` TEXT NOT NULL,
  `report_file_id` BIGINT,
  CONSTRAINT `production_data_prod_report_file_id_00ca2c92_fk_productio` FOREIGN KEY (`report_file_id`) REFERENCES `production_data_importproductiondatafile` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `production_data_standardizeinsurer` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `insurer_agency` TEXT NOT NULL,
  `agency_id` BIGINT,
  `insurer_id` BIGINT,
  CONSTRAINT `production_data_stan_agency_id_57fa445d_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `production_data_stan_insurer_id_0e630204_fk_business_` FOREIGN KEY (`insurer_id`) REFERENCES `insurer_companies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `production_data_standardizeramo` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `ramo_agency` TEXT NOT NULL,
  `agency_id` BIGINT,
  `ramo_id` BIGINT,
  CONSTRAINT `production_data_stan_agency_id_9fed3381_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `production_data_stan_ramo_id_e08d0d28_fk_business_` FOREIGN KEY (`ramo_id`) REFERENCES `ramos` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `redactor_redactorfile` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `file` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `is_image` INTEGER NOT NULL,
  `created_at` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `renewal_documentspecification` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `client_type` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `description` TEXT NOT NULL,
  `is_mandatory` INTEGER NOT NULL,
  `tag_id` INTEGER NOT NULL,
  CONSTRAINT `renewal_documentspec_tag_id_87912b0e_fk_app_docum` FOREIGN KEY (`tag_id`) REFERENCES `app_documenttag` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `renewal_documentspecification_ramo` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `documentspecification_id` BIGINT NOT NULL,
  `ramo_id` BIGINT NOT NULL,
  CONSTRAINT `renewal_documentspec_documentspecificatio_48192234_fk_renewal_d` FOREIGN KEY (`documentspecification_id`) REFERENCES `renewal_documentspecification` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `renewal_documentspec_ramo_id_a9ef1a20_fk_business_` FOREIGN KEY (`ramo_id`) REFERENCES `ramos` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `renewal_initialstep` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `step_type` TEXT NOT NULL,
  `step_status` TEXT NOT NULL,
  `owner_id` INTEGER,
  `renewal_id` BIGINT NOT NULL,
  CONSTRAINT `renewal_initialstep_owner_id_cf673e04_fk_user_user_id` FOREIGN KEY (`owner_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `renewal_initialstep_renewal_id_46b33430_fk_renewal_renewal_id` FOREIGN KEY (`renewal_id`) REFERENCES `renewal_renewal` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `renewal_initialstepconfig` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `commercial_notice_required` INTEGER NOT NULL,
  `claim_notice_required` INTEGER NOT NULL,
  `terms_management_required` INTEGER NOT NULL,
  `agency_id` BIGINT NOT NULL,
  CONSTRAINT `renewal_initialstepc_agency_id_b514db8c_fk_business_` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `renewal_nonrenewalreason` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `show_dropdown` INTEGER NOT NULL,
  `show_renewal_button` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE `renewal_renewal` (
  `updated_at` TEXT NOT NULL,
  `id_slug` TEXT NOT NULL,
  `id` INTEGER PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `reminder_at` TEXT,
  `closed_at` TEXT,
  `migration_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `computed_data` TEXT NOT NULL,
  `owner_id` INTEGER,
  `policy_id` BIGINT NOT NULL,
  `non_renewal_reason_id` BIGINT,
  `external_id` TEXT NOT NULL,
  `status` TEXT NOT NULL,
  `process_steps` TEXT,
  `extension_date` TEXT,
  `renewal_type` TEXT NOT NULL,
  `insurance_company_id` BIGINT,
  `send_terms_comments` TEXT NOT NULL,
  `main_renewal_id` BIGINT,
  CONSTRAINT `renewal_renewal_insurance_company_id_2b9b173a_fk_business_` FOREIGN KEY (`insurance_company_id`) REFERENCES `insurer_companies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `renewal_renewal_main_renewal_id_0b086500_fk_renewal_renewal_id` FOREIGN KEY (`main_renewal_id`) REFERENCES `renewal_renewal` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `renewal_renewal_non_renewal_reason_i_6bc146e6_fk_renewal_n` FOREIGN KEY (`non_renewal_reason_id`) REFERENCES `renewal_nonrenewalreason` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `renewal_renewal_owner_id_ced1d5f4_fk_user_user_id` FOREIGN KEY (`owner_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `renewal_renewal_policy_id_68628be4_fk_insurance_policy_id` FOREIGN KEY (`policy_id`) REFERENCES `insurance_policy` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `renewal_renewaldocument` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `completed_at` TEXT,
  `renewal_id` BIGINT NOT NULL,
  `uploaded_by_id` INTEGER,
  `has_review` INTEGER NOT NULL,
  CONSTRAINT `renewal_renewaldocument_renewal_id_d6ffd315_fk` FOREIGN KEY (`renewal_id`) REFERENCES `renewal_renewal` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `renewal_renewaldocument_uploaded_by_id_397bd316_fk_user_user_id` FOREIGN KEY (`uploaded_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `renewal_renewaldocument_tags` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `renewaldocument_id` BIGINT NOT NULL,
  `documenttag_id` INTEGER NOT NULL,
  CONSTRAINT `renewal_renewaldocum_documenttag_id_871e946c_fk_app_docum` FOREIGN KEY (`documenttag_id`) REFERENCES `app_documenttag` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `renewal_renewaldocum_renewaldocument_id_f467f203_fk_renewal_r` FOREIGN KEY (`renewaldocument_id`) REFERENCES `renewal_renewaldocument` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `renewal_renewallog` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `info` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `created_by_id` INTEGER,
  `renewal_id` BIGINT NOT NULL,
  CONSTRAINT `renewal_renewallog_created_by_id_d4dcfc42_fk_user_user_id` FOREIGN KEY (`created_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `renewal_renewallog_renewal_id_1aefad25_fk` FOREIGN KEY (`renewal_id`) REFERENCES `renewal_renewal` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `sales_contractlead` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `contract_number` TEXT NOT NULL,
  `stratum` INTEGER,
  `neighborhood` TEXT NOT NULL,
  `address` TEXT NOT NULL,
  `credit_or_request_number` TEXT NOT NULL,
  `reference_number` TEXT NOT NULL,
  `extra_info` TEXT NOT NULL,
  `credit_acquisition_date` TEXT,
  `credit_installments` INTEGER,
  `city_id` INTEGER NOT NULL,
  `entity_id` BIGINT NOT NULL,
  `holder_id` BIGINT,
  `provider_id` BIGINT NOT NULL,
  `is_prepaid` INTEGER NOT NULL,
  CONSTRAINT `sales_contractlead_city_id_d1d804c1_fk_app_city_id` FOREIGN KEY (`city_id`) REFERENCES `cities` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `sales_contractlead_entity_id_98488e86_fk_sales_entity_id` FOREIGN KEY (`entity_id`) REFERENCES `sales_entity` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `sales_contractlead_holder_id_46ba934c_fk_sales_holder_id` FOREIGN KEY (`holder_id`) REFERENCES `sales_holder` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `sales_contractlead_provider_id_de37056e_fk_sales_provider_id` FOREIGN KEY (`provider_id`) REFERENCES `sales_provider` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `sales_contractleadsimportfile` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `file` TEXT NOT NULL,
  `notify_email` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_entity` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `vendu_id` TEXT NOT NULL,
  `commercial_collective_end_day` INTEGER,
  `commercial_collective_start_day` INTEGER,
  `operational_collective_end_day` INTEGER,
  `operational_collective_start_day` INTEGER,
  `skip_otp` INTEGER NOT NULL,
  `vendu_code` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_entitycity` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `code` TEXT NOT NULL,
  `city_id` INTEGER NOT NULL,
  `entity_id` BIGINT NOT NULL,
  `department_smartflex` TEXT NOT NULL,
  `locality_smartflex` TEXT NOT NULL,
  CONSTRAINT `sales_entitycity_city_id_77a50829_fk_app_city_id` FOREIGN KEY (`city_id`) REFERENCES `cities` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `sales_entitycity_entity_id_4242e9c3_fk_sales_entity_id` FOREIGN KEY (`entity_id`) REFERENCES `sales_entity` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `sales_holder` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `id_type` TEXT NOT NULL,
  `id_number` TEXT NOT NULL,
  `id_issue_date` TEXT,
  `email` TEXT NOT NULL,
  `birth_date` TEXT,
  `phones` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_operator` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `has_ai_audit` INTEGER NOT NULL,
  `ai_instruction` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_plan` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `vendu_id` TEXT NOT NULL,
  `description` TEXT NOT NULL,
  `price` TEXT,
  `product_id` BIGINT,
  `vendu_code` TEXT NOT NULL,
  CONSTRAINT `sales_plan_product_id_260eba87_fk_sales_product_id` FOREIGN KEY (`product_id`) REFERENCES `sales_product` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `sales_product` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `prompt` TEXT NOT NULL,
  `vendu_id` TEXT NOT NULL,
  `entity_id` BIGINT,
  `insurer_company_id` BIGINT,
  `vendu_code` TEXT NOT NULL,
  `transactional_export_config` TEXT NOT NULL,
  `allowed_duplicates` INTEGER NOT NULL,
  `operator_id` BIGINT NOT NULL,
  CONSTRAINT `sales_product_entity_id_6ced0fd4_fk_sales_entity_id` FOREIGN KEY (`entity_id`) REFERENCES `sales_entity` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `sales_product_insurer_company_id_6ea848f0_fk_business_` FOREIGN KEY (`insurer_company_id`) REFERENCES `insurer_companies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `sales_product_operator_id_9bb354fe_fk_sales_operator_id` FOREIGN KEY (`operator_id`) REFERENCES `sales_operator` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `sales_product_allowed_duplicates_check` CHECK (`allowed_duplicates` >= 0)
);
--> statement-breakpoint
CREATE TABLE `sales_provider` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_sale` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `vendu_id` TEXT NOT NULL,
  `price` TEXT NOT NULL,
  `contract_number` TEXT NOT NULL,
  `sales_mode` TEXT NOT NULL,
  `status` TEXT NOT NULL,
  `otp_code` TEXT NOT NULL,
  `extra_info` TEXT NOT NULL,
  `created_by_name` TEXT NOT NULL,
  `is_otp_verified` INTEGER NOT NULL,
  `created_by_id` INTEGER,
  `entity_id` BIGINT NOT NULL,
  `plan_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `insurer_company_id` BIGINT NOT NULL,
  `transaction_id` TEXT,
  `positive_at` TEXT,
  `contract_id` BIGINT,
  `is_reviewed` INTEGER NOT NULL,
  `reviewed_at` TEXT,
  `reviewed_by_email` TEXT NOT NULL,
  `reviewed_by_name` TEXT NOT NULL,
  `client_id` BIGINT NOT NULL,
  CONSTRAINT `sales_sale_client_id_4942299c_fk_customer_clientagency_id` FOREIGN KEY (`client_id`) REFERENCES `customer_clientagency` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `sales_sale_contract_id_7a558867_fk_sales_contractlead_id` FOREIGN KEY (`contract_id`) REFERENCES `sales_contractlead` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `sales_sale_created_by_id_f6773268_fk_user_user_id` FOREIGN KEY (`created_by_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `sales_sale_entity_id_46f23b1b_fk_sales_entity_id` FOREIGN KEY (`entity_id`) REFERENCES `sales_entity` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `sales_sale_insurer_company_id_c3922dbf_fk_business_` FOREIGN KEY (`insurer_company_id`) REFERENCES `insurer_companies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `sales_sale_plan_id_5bea1e65_fk_sales_plan_id` FOREIGN KEY (`plan_id`) REFERENCES `sales_plan` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `sales_sale_product_id_e01466c2_fk_sales_product_id` FOREIGN KEY (`product_id`) REFERENCES `sales_product` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `all_review_fields_filled_and_reviewed_consistency` CHECK (NOT `is_reviewed` AND `reviewed_at` IS NULL AND `reviewed_by_email` = '' AND `reviewed_by_name` = '' OR `is_reviewed` AND `reviewed_at` IS NOT NULL AND `reviewed_by_email` IS NOT NULL AND `reviewed_by_name` IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `sales_saleaudio` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `audio_s3_key` TEXT NOT NULL,
  `sale_id` BIGINT NOT NULL,
  CONSTRAINT `sales_saleaudio_sale_id_e1f71d2b_fk_sales_sale_id` FOREIGN KEY (`sale_id`) REFERENCES `sales_sale` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `sales_saletranscription` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `sale_id` BIGINT NOT NULL,
  `audited_at` TEXT,
  `audition_analysis` TEXT NOT NULL,
  `transcription` TEXT NOT NULL,
  CONSTRAINT `sales_saletranscription_sale_id_0449c6e8_fk_sales_sale_id` FOREIGN KEY (`sale_id`) REFERENCES `sales_sale` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `socialaccount_socialaccount` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `provider` TEXT NOT NULL,
  `uid` TEXT NOT NULL,
  `last_login` TEXT NOT NULL,
  `date_joined` TEXT NOT NULL,
  `extra_data` TEXT NOT NULL,
  `user_id` INTEGER NOT NULL,
  CONSTRAINT `socialaccount_socialaccount_user_id_8146e70c_fk_user_user_id` FOREIGN KEY (`user_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `socialaccount_socialapp` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `provider` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `client_id` TEXT NOT NULL,
  `secret` TEXT NOT NULL,
  `key` TEXT NOT NULL,
  `provider_id` TEXT NOT NULL,
  `settings` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `socialaccount_socialapp_sites` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `socialapp_id` INTEGER NOT NULL,
  `site_id` INTEGER NOT NULL,
  CONSTRAINT `socialaccount_social_site_id_2579dee5_fk_django_si` FOREIGN KEY (`site_id`) REFERENCES `django_site` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `socialaccount_social_socialapp_id_97fb6e7d_fk_socialacc` FOREIGN KEY (`socialapp_id`) REFERENCES `socialaccount_socialapp` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `socialaccount_socialtoken` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `token` TEXT NOT NULL,
  `token_secret` TEXT NOT NULL,
  `expires_at` TEXT,
  `account_id` INTEGER NOT NULL,
  `app_id` INTEGER,
  CONSTRAINT `socialaccount_social_account_id_951f210e_fk_socialacc` FOREIGN KEY (`account_id`) REFERENCES `socialaccount_socialaccount` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `socialaccount_social_app_id_636a42d7_fk_socialacc` FOREIGN KEY (`app_id`) REFERENCES `socialaccount_socialapp` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `survey_npsresponse` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `score` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `user_name` TEXT NOT NULL,
  `user_email` TEXT NOT NULL,
  `agency_id_slug_snapshot` TEXT NOT NULL,
  `agency_name_snapshot` TEXT NOT NULL,
  `agency_short_name_snapshot` TEXT NOT NULL,
  `role_name` TEXT NOT NULL,
  `question` TEXT NOT NULL,
  `nps_classification` TEXT NOT NULL,
  `comment` TEXT NOT NULL,
  `responded_at` TEXT NOT NULL,
  `survey_id` BIGINT NOT NULL,
  CONSTRAINT `survey_npsresponse_survey_id_b9e958c5_fk_survey_npssurvey_id` FOREIGN KEY (`survey_id`) REFERENCES `survey_npssurvey` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `nps_response_classification_valid` CHECK (`nps_classification` IN ('detractor', 'passive', 'promoter')),
  CONSTRAINT `nps_response_score_between_0_10` CHECK (`score` >= 0 AND `score` <= 10),
  CONSTRAINT `survey_npsresponse_score_check` CHECK (`score` >= 0),
  CONSTRAINT `survey_npsresponse_user_id_check` CHECK (`user_id` >= 0)
);
--> statement-breakpoint
CREATE TABLE `survey_npssurvey` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `id_slug` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `question` TEXT NOT NULL,
  `periodicity` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL,
  `is_mandatory` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_mfaauthenticationlog` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `auth_method` TEXT NOT NULL,
  `result` TEXT NOT NULL,
  `ip_address` TEXT NOT NULL,
  `user_agent` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `user_id` INTEGER NOT NULL,
  CONSTRAINT `user_mfaauthenticationlog_user_id_4f3ae0f2_fk_user_user_id` FOREIGN KEY (`user_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `user_role` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `read_sections` TEXT NOT NULL,
  `write_sections` TEXT NOT NULL,
  `export_sections` TEXT NOT NULL,
  `is_default` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_trusteddevice` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `device_hash` TEXT NOT NULL,
  `ip_address` TEXT NOT NULL,
  `user_agent` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `last_used_at` TEXT NOT NULL,
  `user_id` INTEGER NOT NULL,
  `expires_at` TEXT NOT NULL,
  CONSTRAINT `user_trusteddevice_user_id_cae5e133_fk_user_user_id` FOREIGN KEY (`user_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `user_user` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `password` TEXT NOT NULL,
  `last_login` TEXT,
  `is_superuser` INTEGER NOT NULL,
  `email` TEXT NOT NULL,
  `first_name` TEXT NOT NULL,
  `last_name` TEXT NOT NULL,
  `is_staff` INTEGER NOT NULL,
  `is_active` INTEGER NOT NULL,
  `created_at` TEXT NOT NULL,
  `utm_source` TEXT NOT NULL,
  `utm_medium` TEXT NOT NULL,
  `utm_campaign` TEXT NOT NULL,
  `agency_id` BIGINT,
  `avatar` TEXT,
  `seller_id` BIGINT,
  `export_sections` TEXT NOT NULL,
  `read_sections` TEXT NOT NULL,
  `write_sections` TEXT NOT NULL,
  `role_id` INTEGER,
  `manage_requests` INTEGER NOT NULL,
  `mfa_enabled` INTEGER NOT NULL,
  `document_number` TEXT NOT NULL,
  `document_type` TEXT NOT NULL,
  `mobile_number` TEXT NOT NULL,
  `email_signature` TEXT NOT NULL,
  `origin` TEXT NOT NULL,
  CONSTRAINT `user_user_agency_id_7be33bad_fk_business_agency_id` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `user_user_role_id_aee6bf52_fk_user_role_id` FOREIGN KEY (`role_id`) REFERENCES `user_role` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `user_user_seller_id_d9b31783_fk_business_seller_id` FOREIGN KEY (`seller_id`) REFERENCES `business_seller` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `user_user_groups` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `user_id` INTEGER NOT NULL,
  `group_id` INTEGER NOT NULL,
  CONSTRAINT `user_user_groups_group_id_c57f13c0_fk_auth_group_id` FOREIGN KEY (`group_id`) REFERENCES `auth_group` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `user_user_groups_user_id_13f9a20d_fk_user_user_id` FOREIGN KEY (`user_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `user_user_user_permissions` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `user_id` INTEGER NOT NULL,
  `permission_id` INTEGER NOT NULL,
  CONSTRAINT `user_user_user_permi_permission_id_ce49d4de_fk_auth_perm` FOREIGN KEY (`permission_id`) REFERENCES `auth_permission` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `user_user_user_permissions_user_id_31782f58_fk_user_user_id` FOREIGN KEY (`user_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE `user_usercomplementarydata` (
  `id` INTEGER PRIMARY KEY NOT NULL,
  `rut` TEXT NOT NULL,
  `gender` TEXT NOT NULL,
  `branch_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `id_number` TEXT NOT NULL,
  `position` TEXT NOT NULL,
  CONSTRAINT `user_usercomplementarydata_branch_id_7e3852ba_fk_app_city_id` FOREIGN KEY (`branch_id`) REFERENCES `cities` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT `user_usercomplementarydata_user_id_fc2d52da_fk_user_user_id` FOREIGN KEY (`user_id`) REFERENCES `user_user` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE INDEX `account_emailaddress_email_03be32b2` ON `account_emailaddress` (`email`);
--> statement-breakpoint
CREATE INDEX `account_emailaddress_email_03be32b2_like` ON `account_emailaddress` (`email`);
--> statement-breakpoint
CREATE INDEX `account_emailaddress_user_id_2c513194` ON `account_emailaddress` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_emailaddress_user_id_email_987c8728_uniq` ON `account_emailaddress` (`user_id`, `email`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_primary_email` ON `account_emailaddress` (`user_id`, `primary`) WHERE "primary";
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_verified_email` ON `account_emailaddress` (`email`) WHERE verified;
--> statement-breakpoint
CREATE INDEX `account_emailconfirmation_email_address_id_5b7f8c58` ON `account_emailconfirmation` (`email_address_id`);
--> statement-breakpoint
CREATE INDEX `account_emailconfirmation_key_f43612bd_like` ON `account_emailconfirmation` (`key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_emailconfirmation_key_key` ON `account_emailconfirmation` (`key`);
--> statement-breakpoint
CREATE INDEX `api_customerfile_id_slug_942f29bc_like` ON `api_customerfile` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_customerfile_id_slug_key` ON `api_customerfile` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `api_key_private_key_56a332c0_like` ON `api_key` (`private_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_key_private_key_key` ON `api_key` (`private_key`);
--> statement-breakpoint
CREATE INDEX `api_key_public_key_ef12f092_like` ON `api_key` (`public_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_key_public_key_key` ON `api_key` (`public_key`);
--> statement-breakpoint
CREATE INDEX `api_paymentfile_id_slug_c021c510_like` ON `api_paymentfile` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_paymentfile_id_slug_key` ON `api_paymentfile` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `api_paymentfile_insurance_company_ae83f0f1` ON `api_paymentfile` (`insurance_company`);
--> statement-breakpoint
CREATE INDEX `api_paymentfile_insurance_company_ae83f0f1_like` ON `api_paymentfile` (`insurance_company`);
--> statement-breakpoint
CREATE INDEX `api_policyfile_id_slug_359852c9_like` ON `api_policyfile` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_policyfile_id_slug_key` ON `api_policyfile` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `api_propertiesfile_id_slug_dcac5b4b_like` ON `api_propertiesfile` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_propertiesfile_id_slug_key` ON `api_propertiesfile` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `api_proposalscarsfile_id_slug_7c7f4e4f_like` ON `api_proposalscarsfile` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_proposalscarsfile_id_slug_key` ON `api_proposalscarsfile` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `api_sarlaftfile_id_slug_58d2d564_like` ON `api_sarlaftfile` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_sarlaftfile_id_slug_key` ON `api_sarlaftfile` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `app_bank_name_1eb76041_like` ON `app_bank` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_bank_name_key` ON `app_bank` (`name`);
--> statement-breakpoint
CREATE INDEX `app_changelog_object_type_3b7ff820` ON `app_changelog` (`object_type`);
--> statement-breakpoint
CREATE INDEX `app_changelog_object_type_3b7ff820_like` ON `app_changelog` (`object_type`);
--> statement-breakpoint
CREATE INDEX `app_changelog_type_b2909f18` ON `app_changelog` (`type`);
--> statement-breakpoint
CREATE INDEX `app_changelog_type_b2909f18_like` ON `app_changelog` (`type`);
--> statement-breakpoint
CREATE INDEX `app_documenttag_agency_id_40679a9f` ON `app_documenttag` (`agency_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_documenttag_agency_id_name_fb5d77a5_uniq` ON `app_documenttag` (`agency_id`, `name`);
--> statement-breakpoint
CREATE INDEX `app_documenttag_color_4bc189c7` ON `app_documenttag` (`color`);
--> statement-breakpoint
CREATE INDEX `app_documenttag_color_4bc189c7_like` ON `app_documenttag` (`color`);
--> statement-breakpoint
CREATE INDEX `app_economicactivity_code_a9ea7a57_like` ON `app_economicactivity` (`code`);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_economicactivity_code_key` ON `app_economicactivity` (`code`);
--> statement-breakpoint
CREATE INDEX `app_importdata_id_slug_6030d3ed_like` ON `app_importdata` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_importdata_id_slug_key` ON `app_importdata` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `app_reporthistory_user_id_c8b84a1e` ON `app_reporthistory` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_reporthistory_user_id_report_type_c5c86a09_uniq` ON `app_reporthistory` (`user_id`, `report_type`);
--> statement-breakpoint
CREATE INDEX `auth_group_name_a6ea08ec_like` ON `auth_group` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_group_name_key` ON `auth_group` (`name`);
--> statement-breakpoint
CREATE INDEX `auth_group_permissions_group_id_b120cbf9` ON `auth_group_permissions` (`group_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_group_permissions_group_id_permission_id_0cd325b0_uniq` ON `auth_group_permissions` (`group_id`, `permission_id`);
--> statement-breakpoint
CREATE INDEX `auth_group_permissions_permission_id_84c5c92e` ON `auth_group_permissions` (`permission_id`);
--> statement-breakpoint
CREATE INDEX `auth_permission_content_type_id_2f476e4b` ON `auth_permission` (`content_type_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_permission_content_type_id_codename_01ab375a_uniq` ON `auth_permission` (`content_type_id`, `codename`);
--> statement-breakpoint
CREATE INDEX `axes_accessattempt_ip_address_10922d9c` ON `axes_accessattempt` (`ip_address`);
--> statement-breakpoint
CREATE INDEX `axes_accessattempt_user_agent_ad89678b` ON `axes_accessattempt` (`user_agent`);
--> statement-breakpoint
CREATE INDEX `axes_accessattempt_user_agent_ad89678b_like` ON `axes_accessattempt` (`user_agent`);
--> statement-breakpoint
CREATE INDEX `axes_accessattempt_username_3f2d4ca0` ON `axes_accessattempt` (`username`);
--> statement-breakpoint
CREATE INDEX `axes_accessattempt_username_3f2d4ca0_like` ON `axes_accessattempt` (`username`);
--> statement-breakpoint
CREATE UNIQUE INDEX `axes_accessattempt_username_ip_address_user_agent_8ea22282_uniq` ON `axes_accessattempt` (`username`, `ip_address`, `user_agent`);
--> statement-breakpoint
CREATE INDEX `axes_accessfailurelog_ip_address_2e9f5a7f` ON `axes_accessfailurelog` (`ip_address`);
--> statement-breakpoint
CREATE INDEX `axes_accessfailurelog_user_agent_ea145dda` ON `axes_accessfailurelog` (`user_agent`);
--> statement-breakpoint
CREATE INDEX `axes_accessfailurelog_user_agent_ea145dda_like` ON `axes_accessfailurelog` (`user_agent`);
--> statement-breakpoint
CREATE INDEX `axes_accessfailurelog_username_a8b7e8a4` ON `axes_accessfailurelog` (`username`);
--> statement-breakpoint
CREATE INDEX `axes_accessfailurelog_username_a8b7e8a4_like` ON `axes_accessfailurelog` (`username`);
--> statement-breakpoint
CREATE INDEX `axes_accesslog_ip_address_86b417e5` ON `axes_accesslog` (`ip_address`);
--> statement-breakpoint
CREATE INDEX `axes_accesslog_user_agent_0e659004` ON `axes_accesslog` (`user_agent`);
--> statement-breakpoint
CREATE INDEX `axes_accesslog_user_agent_0e659004_like` ON `axes_accesslog` (`user_agent`);
--> statement-breakpoint
CREATE INDEX `axes_accesslog_username_df93064b` ON `axes_accesslog` (`username`);
--> statement-breakpoint
CREATE INDEX `axes_accesslog_username_df93064b_like` ON `axes_accesslog` (`username`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_agency_renewal__agency_id_user_id_83ed4d81_uniq` ON `business_agency_renewal_task_managers` (`agency_id`, `user_id`);
--> statement-breakpoint
CREATE INDEX `business_agency_renewal_task_managers_agency_id_92d6284e` ON `business_agency_renewal_task_managers` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_agency_renewal_task_managers_user_id_55162e62` ON `business_agency_renewal_task_managers` (`user_id`);
--> statement-breakpoint
CREATE INDEX `business_agencycomplementa_commercial_executive_id_f8ab5dbf` ON `business_agencycomplementarydata` (`commercial_executive_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_agencycomplementarydata_agency_id_key` ON `business_agencycomplementarydata` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_agencycomplementarydata_agent_type_929ac2ba` ON `business_agencycomplementarydata` (`agent_type`);
--> statement-breakpoint
CREATE INDEX `business_agencycomplementarydata_agent_type_929ac2ba_like` ON `business_agencycomplementarydata` (`agent_type`);
--> statement-breakpoint
CREATE INDEX `business_agencycomplementarydata_focus_3f8e04ac` ON `business_agencycomplementarydata` (`focus`);
--> statement-breakpoint
CREATE INDEX `business_agencycomplementarydata_focus_3f8e04ac_like` ON `business_agencycomplementarydata` (`focus`);
--> statement-breakpoint
CREATE INDEX `business_agencycomplementarydata_id_slug_eb49365a_like` ON `business_agencycomplementarydata` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_agencycomplementarydata_id_slug_key` ON `business_agencycomplementarydata` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `business_agencycompliancemailbox_agency_id_3d4bf26b` ON `business_agencycompliancemailbox` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_agencycompliancemailbox_email_e21404fd_like` ON `business_agencycompliancemailbox` (`email`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_agencycompliancemailbox_email_key` ON `business_agencycompliancemailbox` (`email`);
--> statement-breakpoint
CREATE INDEX `business_agencycompliancemailbox_id_slug_59e687d9_like` ON `business_agencycompliancemailbox` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_agencycompliancemailbox_id_slug_key` ON `business_agencycompliancemailbox` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_agencycomplianc_agencycompliancemailbox__899251d6_uniq` ON `business_agencycompliancemailbox_reply_authorized_users` (`agencycompliancemailbox_id`, `user_id`);
--> statement-breakpoint
CREATE INDEX `business_agencycompliancem_agencycompliancemailbox_id_3d1579c1` ON `business_agencycompliancemailbox_reply_authorized_users` (`agencycompliancemailbox_id`);
--> statement-breakpoint
CREATE INDEX `business_agencycompliancem_user_id_3e632432` ON `business_agencycompliancemailbox_reply_authorized_users` (`user_id`);
--> statement-breakpoint
CREATE INDEX `business_allianzconnectionkey_agency_id_cc986f8c` ON `business_allianzconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_allianzconnectionkey_id_slug_265a61fc_like` ON `business_allianzconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_allianzconnectionkey_id_slug_key` ON `business_allianzconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_agency_allianz_connection_key` ON `business_allianzconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_axaconnectionkey_agency_id_fb7a192b` ON `business_axaconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_axaconnectionkey_id_slug_7c05cd06_like` ON `business_axaconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_axaconnectionkey_id_slug_key` ON `business_axaconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_agency_axa_connection_key` ON `business_axaconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_bolivarconnectionkey_agency_id_ce22a6a7` ON `business_bolivarconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_bolivarconnectionkey_id_slug_3dfc8f2b_like` ON `business_bolivarconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_bolivarconnectionkey_id_slug_key` ON `business_bolivarconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_agency_bolivar_connection_key` ON `business_bolivarconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_chubbconnectionkey_agency_id_1d5e0fce` ON `business_chubbconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_chubbconnectionkey_id_slug_f6ca85d9_like` ON `business_chubbconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_chubbconnectionkey_id_slug_key` ON `business_chubbconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_agency_chubb_connection_key` ON `business_chubbconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_commercialunit_agency_id_3f578aee` ON `business_commercialunit` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_commercialunit_id_slug_93b24ac2_like` ON `business_commercialunit` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_commercialunit_id_slug_key` ON `business_commercialunit` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_agency_commercial_unit` ON `business_commercialunit` (`agency_id`, `name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_defaultcommissi_agency_id_insurer_id_ram_56c2582d_uniq` ON `business_defaultcommission` (`agency_id`, `insurer_id`, `ramo_id`);
--> statement-breakpoint
CREATE INDEX `business_defaultcommission_agency_id_f8f81f53` ON `business_defaultcommission` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_defaultcommission_external_id_5cda4236` ON `business_defaultcommission` (`external_id`);
--> statement-breakpoint
CREATE INDEX `business_defaultcommission_external_id_5cda4236_like` ON `business_defaultcommission` (`external_id`);
--> statement-breakpoint
CREATE INDEX `business_defaultcommission_id_slug_684932c7_like` ON `business_defaultcommission` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_defaultcommission_id_slug_key` ON `business_defaultcommission` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `business_defaultcommission_insurer_id_74445edd` ON `business_defaultcommission` (`insurer_id`);
--> statement-breakpoint
CREATE INDEX `business_defaultcommission_migration_slug_2cea59c8` ON `business_defaultcommission` (`migration_slug`);
--> statement-breakpoint
CREATE INDEX `business_defaultcommission_migration_slug_2cea59c8_like` ON `business_defaultcommission` (`migration_slug`);
--> statement-breakpoint
CREATE INDEX `business_defaultcommission_ramo_id_92f4c825` ON `business_defaultcommission` (`ramo_id`);
--> statement-breakpoint
CREATE INDEX `business_equidadconnectionkey_agency_id_79ac6da2` ON `business_equidadconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_equidadconnectionkey_id_slug_6b0ee47f_like` ON `business_equidadconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_equidadconnectionkey_id_slug_key` ON `business_equidadconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_agency_equidad_connection_key` ON `business_equidadconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_hdiconnectionkey_agency_id_a0c9a0d9` ON `business_hdiconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_hdiconnectionkey_id_slug_634eb021_like` ON `business_hdiconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_hdiconnectionkey_id_slug_key` ON `business_hdiconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_agency_hdi_connection_key` ON `business_hdiconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_mapfreconnectionkey_agency_id_904b3266` ON `business_mapfreconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_mapfreconnectionkey_id_slug_6f783485_like` ON `business_mapfreconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_mapfreconnectionkey_id_slug_key` ON `business_mapfreconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_agency_mapfre_connection_key` ON `business_mapfreconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_previsoraconnectionkey_agency_id_c814ac6b` ON `business_previsoraconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_previsoraconnectionkey_id_slug_2e23ae30_like` ON `business_previsoraconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_previsoraconnectionkey_id_slug_key` ON `business_previsoraconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_agency_previsora_connection_key` ON `business_previsoraconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_qualitasconnectionkey_agency_id_cf93908d` ON `business_qualitasconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_qualitasconnectionkey_id_slug_ab118994_like` ON `business_qualitasconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_qualitasconnectionkey_id_slug_key` ON `business_qualitasconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_agency_qualitas_connection_key` ON `business_qualitasconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_ramorenewalconfiguration_configuration_id_036f37ef` ON `business_ramorenewalconfiguration` (`configuration_id`);
--> statement-breakpoint
CREATE INDEX `business_ramorenewalconfiguration_id_slug_5812fa25_like` ON `business_ramorenewalconfiguration` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_ramorenewalconfiguration_id_slug_key` ON `business_ramorenewalconfiguration` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `business_ramorenewalconfiguration_ramo_id_0df0a974` ON `business_ramorenewalconfiguration` (`ramo_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_renewal_ramo_configuration` ON `business_ramorenewalconfiguration` (`configuration_id`, `ramo_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_renewalconfiguration_agency_id_key` ON `business_renewalconfiguration` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_renewalconfiguration_id_slug_0dcd0a94_like` ON `business_renewalconfiguration` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_renewalconfiguration_id_slug_key` ON `business_renewalconfiguration` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `business_sbsconnectionkey_agency_id_a9bbee31` ON `business_sbsconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_sbsconnectionkey_id_slug_95eb3107_like` ON `business_sbsconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_sbsconnectionkey_id_slug_key` ON `business_sbsconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_agency_sbs_connection_key` ON `business_sbsconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_seller_agency_id_47e0ac09` ON `business_seller` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_seller_bank_account_type_1fcc0f00` ON `business_seller` (`bank_account_type`);
--> statement-breakpoint
CREATE INDEX `business_seller_bank_account_type_1fcc0f00_like` ON `business_seller` (`bank_account_type`);
--> statement-breakpoint
CREATE INDEX `business_seller_external_id_469746b2` ON `business_seller` (`external_id`);
--> statement-breakpoint
CREATE INDEX `business_seller_external_id_469746b2_like` ON `business_seller` (`external_id`);
--> statement-breakpoint
CREATE INDEX `business_seller_id_slug_759acbe8_like` ON `business_seller` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_seller_id_slug_key` ON `business_seller` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `business_seller_id_type_bed2277d` ON `business_seller` (`id_type`);
--> statement-breakpoint
CREATE INDEX `business_seller_id_type_bed2277d_like` ON `business_seller` (`id_type`);
--> statement-breakpoint
CREATE INDEX `business_seller_migration_slug_4dd975f8` ON `business_seller` (`migration_slug`);
--> statement-breakpoint
CREATE INDEX `business_seller_migration_slug_4dd975f8_like` ON `business_seller` (`migration_slug`);
--> statement-breakpoint
CREATE INDEX `business_seller_tax_regime_2f1d5fca` ON `business_seller` (`tax_regime`);
--> statement-breakpoint
CREATE INDEX `business_seller_tax_regime_2f1d5fca_like` ON `business_seller` (`tax_regime`);
--> statement-breakpoint
CREATE INDEX `business_seller_type_a6e4fd7f` ON `business_seller` (`type`);
--> statement-breakpoint
CREATE INDEX `business_seller_type_a6e4fd7f_like` ON `business_seller` (`type`);
--> statement-breakpoint
CREATE INDEX `business_sellercommission_id_slug_03eb7e9a_like` ON `business_sellercommission` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_sellercommission_id_slug_key` ON `business_sellercommission` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `business_sellercommission_seller_id_eb074fe3` ON `business_sellercommission` (`seller_id`);
--> statement-breakpoint
CREATE INDEX `business_sellerdocument_id_slug_9c3bf2ba_like` ON `business_sellerdocument` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_sellerdocument_id_slug_key` ON `business_sellerdocument` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `business_sellerdocument_seller_id_c161176d` ON `business_sellerdocument` (`seller_id`);
--> statement-breakpoint
CREATE INDEX `business_sellerdocument_uploaded_by_id_96fb72ba` ON `business_sellerdocument` (`uploaded_by_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_sellerdocument__sellerdocument_id_docume_30874aec_uniq` ON `business_sellerdocument_tags` (`sellerdocument_id`, `documenttag_id`);
--> statement-breakpoint
CREATE INDEX `business_sellerdocument_tags_documenttag_id_292246cd` ON `business_sellerdocument_tags` (`documenttag_id`);
--> statement-breakpoint
CREATE INDEX `business_sellerdocument_tags_sellerdocument_id_ec0a9c55` ON `business_sellerdocument_tags` (`sellerdocument_id`);
--> statement-breakpoint
CREATE INDEX `business_sellerlog_created_by_id_da77f23f` ON `business_sellerlog` (`created_by_id`);
--> statement-breakpoint
CREATE INDEX `business_sellerlog_seller_id_db31eca3` ON `business_sellerlog` (`seller_id`);
--> statement-breakpoint
CREATE INDEX `business_solidariaconnectionkey_agency_id_bcf747a9` ON `business_solidariaconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_solidariaconnectionkey_id_slug_89b91bd6_like` ON `business_solidariaconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_solidariaconnectionkey_id_slug_key` ON `business_solidariaconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_agency_solidaria_connection_key` ON `business_solidariaconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_suraconnectionkey_agency_id_37d85990` ON `business_suraconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_suraconnectionkey_id_slug_2784adde_like` ON `business_suraconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_suraconnectionkey_id_slug_key` ON `business_suraconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_agency_sura_connection_key` ON `business_suraconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_zurichconnectionkey_agency_id_2e6d8391` ON `business_zurichconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `business_zurichconnectionkey_id_slug_652a4dea_like` ON `business_zurichconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_zurichconnectionkey_id_slug_key` ON `business_zurichconnectionkey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_agency_zurich_connection_key` ON `business_zurichconnectionkey` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `claim_claim_created_by_slug_64838811` ON `claim_claim` (`created_by_slug`);
--> statement-breakpoint
CREATE INDEX `claim_claim_created_by_slug_64838811_like` ON `claim_claim` (`created_by_slug`);
--> statement-breakpoint
CREATE INDEX `claim_claim_external_id_806f796a` ON `claim_claim` (`external_id`);
--> statement-breakpoint
CREATE INDEX `claim_claim_external_id_806f796a_like` ON `claim_claim` (`external_id`);
--> statement-breakpoint
CREATE INDEX `claim_claim_id_slug_3475bb45_like` ON `claim_claim` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_claim_id_slug_key` ON `claim_claim` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `claim_claim_migration_slug_5929a83a` ON `claim_claim` (`migration_slug`);
--> statement-breakpoint
CREATE INDEX `claim_claim_migration_slug_5929a83a_like` ON `claim_claim` (`migration_slug`);
--> statement-breakpoint
CREATE INDEX `claim_claim_policy_id_39cf76fa` ON `claim_claim` (`policy_id`);
--> statement-breakpoint
CREATE INDEX `claim_claim_status_id_3ff21869` ON `claim_claim` (`status_id`);
--> statement-breakpoint
CREATE INDEX `claim_claim_type_id_835b6aa3` ON `claim_claim` (`type_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_policy_insurer_number` ON `claim_claim` (`policy_id`, `insurer_number`) WHERE (NOT (upper((insurer_number)) = upper('')));
--> statement-breakpoint
CREATE INDEX `claim_claimdocument_claim_id_e2e36c11` ON `claim_claimdocument` (`claim_id`);
--> statement-breakpoint
CREATE INDEX `claim_claimdocument_id_slug_85f93df2_like` ON `claim_claimdocument` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_claimdocument_id_slug_key` ON `claim_claimdocument` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `claim_claimdocument_uploaded_by_id_956e6c4a` ON `claim_claimdocument` (`uploaded_by_id`);
--> statement-breakpoint
CREATE INDEX `claim_claimdocument_tags_claimdocument_id_868d714d` ON `claim_claimdocument_tags` (`claimdocument_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_claimdocument_tags_claimdocument_id_documen_03cc95af_uniq` ON `claim_claimdocument_tags` (`claimdocument_id`, `documenttag_id`);
--> statement-breakpoint
CREATE INDEX `claim_claimdocument_tags_documenttag_id_a497f965` ON `claim_claimdocument_tags` (`documenttag_id`);
--> statement-breakpoint
CREATE INDEX `claim_claimlog_claim_id_ced2ff40` ON `claim_claimlog` (`claim_id`);
--> statement-breakpoint
CREATE INDEX `claim_claimlog_created_by_id_c3d5bb12` ON `claim_claimlog` (`created_by_id`);
--> statement-breakpoint
CREATE INDEX `claim_claimstatus_color_5d4077e0` ON `claim_claimstatus` (`color`);
--> statement-breakpoint
CREATE INDEX `claim_claimstatus_color_5d4077e0_like` ON `claim_claimstatus` (`color`);
--> statement-breakpoint
CREATE INDEX `claim_claimstatus_id_slug_cc1a3e63_like` ON `claim_claimstatus` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_claimstatus_id_slug_key` ON `claim_claimstatus` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_claimstatus_index_key` ON `claim_claimstatus` (`index`);
--> statement-breakpoint
CREATE INDEX `claim_claimstatus_name_fcc4b20b_like` ON `claim_claimstatus` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_claimstatus_name_key` ON `claim_claimstatus` (`name`);
--> statement-breakpoint
CREATE INDEX `claim_claimsubstatus_id_slug_f7be60be_like` ON `claim_claimsubstatus` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_claimsubstatus_id_slug_key` ON `claim_claimsubstatus` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `claim_claimsubstatus_name_29438e9b_like` ON `claim_claimsubstatus` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_claimsubstatus_name_key` ON `claim_claimsubstatus` (`name`);
--> statement-breakpoint
CREATE INDEX `claim_claimsubstatus_status_id_9db249b9` ON `claim_claimsubstatus` (`status_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_claimsubstatus_status_id_index_ebbee4d8_uniq` ON `claim_claimsubstatus` (`status_id`, `index`);
--> statement-breakpoint
CREATE INDEX `claim_claimtype_id_slug_8a63ecde_like` ON `claim_claimtype` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_claimtype_id_slug_key` ON `claim_claimtype` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `claim_claimtype_name_c72297e2_like` ON `claim_claimtype` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_claimtype_name_key` ON `claim_claimtype` (`name`);
--> statement-breakpoint
CREATE INDEX `claim_coverage_claim_id_30284174` ON `claim_coverage` (`claim_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_coverage_claim_id_name_34285814_uniq` ON `claim_coverage` (`claim_id`, `name`);
--> statement-breakpoint
CREATE INDEX `claim_coverage_external_id_f91f02d6` ON `claim_coverage` (`external_id`);
--> statement-breakpoint
CREATE INDEX `claim_coverage_external_id_f91f02d6_like` ON `claim_coverage` (`external_id`);
--> statement-breakpoint
CREATE INDEX `claim_coverage_id_slug_1945322e_like` ON `claim_coverage` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_coverage_id_slug_key` ON `claim_coverage` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `claim_coverage_migration_slug_0e1b8607` ON `claim_coverage` (`migration_slug`);
--> statement-breakpoint
CREATE INDEX `claim_coverage_migration_slug_0e1b8607_like` ON `claim_coverage` (`migration_slug`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancecancellationreason_id_slug_4504d788_like` ON `compliance_compliancecancellationreason` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_compliancecancellationreason_id_slug_key` ON `compliance_compliancecancellationreason` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_compliance_cancellation_reason_name` ON `compliance_compliancecancellationreason` (`name`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancelog_compliance_id_fe9c6300` ON `compliance_compliancelog` (`compliance_id`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancelog_created_by_id_94c23312` ON `compliance_compliancelog` (`created_by_id`);
--> statement-breakpoint
CREATE INDEX `compliance_complianceprogramtype_agency_id_d1c61d58` ON `compliance_complianceprogramtype` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `compliance_complianceprogramtype_id_slug_9fca3fb6_like` ON `compliance_complianceprogramtype` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_complianceprogramtype_id_slug_key` ON `compliance_complianceprogramtype` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_compliance_program_type_agency_name` ON `compliance_complianceprogramtype` (`agency_id`, `name`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_agency_id_d1d947d7` ON `compliance_compliancerequest` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_cancellation_reason_id_1a792a78` ON `compliance_compliancerequest` (`cancellation_reason_id`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_cl_policy_id_90163a8b` ON `compliance_compliancerequest` (`cl_policy_id`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_client_id_c6caf474` ON `compliance_compliancerequest` (`client_id`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_id_slug_ee3f39e1_like` ON `compliance_compliancerequest` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_compliancerequest_id_slug_key` ON `compliance_compliancerequest` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_mailbox_id_b75e4de4` ON `compliance_compliancerequest` (`mailbox_id`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_main_policy_id_6af5bc41` ON `compliance_compliancerequest` (`main_policy_id`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_modification_subtype_2e09246a` ON `compliance_compliancerequest` (`modification_subtype`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_modification_subtype_2e09246a_like` ON `compliance_compliancerequest` (`modification_subtype`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_owner_id_bb49a3a4` ON `compliance_compliancerequest` (`owner_id`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_process_type_1680c5c3` ON `compliance_compliancerequest` (`process_type`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_process_type_1680c5c3_like` ON `compliance_compliancerequest` (`process_type`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_program_type_id_d967280b` ON `compliance_compliancerequest` (`program_type_id`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_request_type_84aa3e32` ON `compliance_compliancerequest` (`request_type`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_request_type_84aa3e32_like` ON `compliance_compliancerequest` (`request_type`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_source_compliance_id_888c1461` ON `compliance_compliancerequest` (`source_compliance_id`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_status_bf761d9e` ON `compliance_compliancerequest` (`status`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_status_bf761d9e_like` ON `compliance_compliancerequest` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_compliancereq_compliancerequest_id_com_8572ec99_uniq` ON `compliance_compliancerequest_tags` (`compliancerequest_id`, `compliancetag_id`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_tags_compliancerequest_id_7fbae941` ON `compliance_compliancerequest_tags` (`compliancerequest_id`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancerequest_tags_compliancetag_id_8b54a722` ON `compliance_compliancerequest_tags` (`compliancetag_id`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancetag_agency_id_bc1aed71` ON `compliance_compliancetag` (`agency_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_compliancetag_agency_id_name_d1c4b309_uniq` ON `compliance_compliancetag` (`agency_id`, `name`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancetag_color_9437451b` ON `compliance_compliancetag` (`color`);
--> statement-breakpoint
CREATE INDEX `compliance_compliancetag_color_9437451b_like` ON `compliance_compliancetag` (`color`);
--> statement-breakpoint
CREATE INDEX `compliance_documentspecification_client_type_7fb5236b` ON `compliance_documentspecification` (`client_type`);
--> statement-breakpoint
CREATE INDEX `compliance_documentspecification_client_type_7fb5236b_like` ON `compliance_documentspecification` (`client_type`);
--> statement-breakpoint
CREATE INDEX `compliance_documentspecification_id_slug_ca51fff0_like` ON `compliance_documentspecification` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_documentspecification_id_slug_key` ON `compliance_documentspecification` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `compliance_documentspecification_request_type_fec6e111` ON `compliance_documentspecification` (`request_type`);
--> statement-breakpoint
CREATE INDEX `compliance_documentspecification_request_type_fec6e111_like` ON `compliance_documentspecification` (`request_type`);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_documentspecification_tag_id_fc68fc28_uniq` ON `compliance_documentspecification` (`tag_id`);
--> statement-breakpoint
CREATE INDEX `compliance_processstepem_compliance_type_16d1aa65_like` ON `compliance_processstepemailtemplate` (`compliance_type`);
--> statement-breakpoint
CREATE INDEX `compliance_processstepemailtemplate_agency_id_998bdbdc` ON `compliance_processstepemailtemplate` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `compliance_processstepemailtemplate_compliance_type_16d1aa65` ON `compliance_processstepemailtemplate` (`compliance_type`);
--> statement-breakpoint
CREATE INDEX `compliance_processstepemailtemplate_email_template_id_ad815fcd` ON `compliance_processstepemailtemplate` (`email_template_id`);
--> statement-breakpoint
CREATE INDEX `compliance_processstepemailtemplate_id_slug_e9084681_like` ON `compliance_processstepemailtemplate` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_processstepemailtemplate_id_slug_key` ON `compliance_processstepemailtemplate` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_agency_compliance_type_finish_process_email_template` ON `compliance_processstepemailtemplate` (`agency_id`, `compliance_type`);
--> statement-breakpoint
CREATE INDEX `compliance_requestdocument_id_slug_e28b8fb6_like` ON `compliance_requestdocument` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_requestdocument_id_slug_key` ON `compliance_requestdocument` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `compliance_requestdocument_request_id_96088179` ON `compliance_requestdocument` (`request_id`);
--> statement-breakpoint
CREATE INDEX `compliance_requestdocument_uploaded_by_id_6f12f14a` ON `compliance_requestdocument` (`uploaded_by_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_requestdocume_requestdocument_id_docum_bdc5d92d_uniq` ON `compliance_requestdocument_tags` (`requestdocument_id`, `documenttag_id`);
--> statement-breakpoint
CREATE INDEX `compliance_requestdocument_tags_documenttag_id_1e12c089` ON `compliance_requestdocument_tags` (`documenttag_id`);
--> statement-breakpoint
CREATE INDEX `compliance_requestdocument_tags_requestdocument_id_4599fcb1` ON `compliance_requestdocument_tags` (`requestdocument_id`);
--> statement-breakpoint
CREATE INDEX `constance_constance_key_c43474b0_like` ON `constance_constance` (`key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `constance_constance_key_key` ON `constance_constance` (`key`);
--> statement-breakpoint
CREATE INDEX `customer_address_city_id_121281ad` ON `customer_address` (`city_id`);
--> statement-breakpoint
CREATE INDEX `customer_address_coordinates_0b250f3d_id` ON `customer_address` (`coordinates`);
--> statement-breakpoint
CREATE INDEX `customer_client_external_id_ff2ecb68` ON `customer_client` (`external_id`);
--> statement-breakpoint
CREATE INDEX `customer_client_external_id_ff2ecb68_like` ON `customer_client` (`external_id`);
--> statement-breakpoint
CREATE INDEX `customer_client_id_slug_51651e62_like` ON `customer_client` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_client_id_slug_key` ON `customer_client` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `customer_client_migration_slug_87cd0ef0` ON `customer_client` (`migration_slug`);
--> statement-breakpoint
CREATE INDEX `customer_client_migration_slug_87cd0ef0_like` ON `customer_client` (`migration_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_id_number` ON `customer_client` (`id_number`) WHERE (NOT (upper((id_number)) = upper('')));
--> statement-breakpoint
CREATE INDEX `customer_clientagency_agency_id_2219f9d3` ON `customer_clientagency` (`agency_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_clientagency_client_id_agency_id_8d00008e_uniq` ON `customer_clientagency` (`client_id`, `agency_id`);
--> statement-breakpoint
CREATE INDEX `customer_clientagency_client_id_f7514a49` ON `customer_clientagency` (`client_id`);
--> statement-breakpoint
CREATE INDEX `customer_clientagency_commercial_unit_id_c62e178e` ON `customer_clientagency` (`commercial_unit_id`);
--> statement-breakpoint
CREATE INDEX `customer_clientagency_created_by_slug_fc0af2df` ON `customer_clientagency` (`created_by_slug`);
--> statement-breakpoint
CREATE INDEX `customer_clientagency_created_by_slug_fc0af2df_like` ON `customer_clientagency` (`created_by_slug`);
--> statement-breakpoint
CREATE INDEX `customer_clientagency_group_id_45d26c9d` ON `customer_clientagency` (`group_id`);
--> statement-breakpoint
CREATE INDEX `customer_clientagency_id_slug_44ceaef1_like` ON `customer_clientagency` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_clientagency_id_slug_key` ON `customer_clientagency` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `customer_clientlog_client_agency_id_4e47abb3` ON `customer_clientlog` (`client_id`);
--> statement-breakpoint
CREATE INDEX `customer_clientlog_created_by_id_f184b351` ON `customer_clientlog` (`created_by_id`);
--> statement-breakpoint
CREATE INDEX `customer_consortium_client_agency_id_3f0f5adc` ON `customer_consortium` (`client_id`);
--> statement-breakpoint
CREATE INDEX `customer_consortium_id_slug_300bd9c0_like` ON `customer_consortium` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_consortium_id_slug_key` ON `customer_consortium` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `customer_consortium_legal_person_id_e82d5e08` ON `customer_consortium` (`legal_person_id`);
--> statement-breakpoint
CREATE INDEX `customer_consortium_natural_person_id_7d1d6af7` ON `customer_consortium` (`natural_person_id`);
--> statement-breakpoint
CREATE INDEX `customer_customersellershare_client_agency_id_7fea7fb0` ON `customer_customersellershare` (`client_agency_id`);
--> statement-breakpoint
CREATE INDEX `customer_customersellershare_id_slug_26895d2e_like` ON `customer_customersellershare` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_customersellershare_id_slug_key` ON `customer_customersellershare` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `customer_customersellershare_seller_id_71f300d2` ON `customer_customersellershare` (`seller_id`);
--> statement-breakpoint
CREATE INDEX `customer_document_client_agency_id_e58f9d6e` ON `customer_document` (`client_id`);
--> statement-breakpoint
CREATE INDEX `customer_document_id_slug_15aac0c3_like` ON `customer_document` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_document_id_slug_key` ON `customer_document` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `customer_document_uploaded_by_id_8852a471` ON `customer_document` (`uploaded_by_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_document_tags_document_id_documenttag_id_706feb38_uniq` ON `customer_document_tags` (`document_id`, `documenttag_id`);
--> statement-breakpoint
CREATE INDEX `customer_document_tags_document_id_ea97f781` ON `customer_document_tags` (`document_id`);
--> statement-breakpoint
CREATE INDEX `customer_document_tags_documenttag_id_49ee51f4` ON `customer_document_tags` (`documenttag_id`);
--> statement-breakpoint
CREATE INDEX `customer_group_agency_id_3b3c328d` ON `customer_group` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `customer_group_id_slug_07cbc3f2_like` ON `customer_group` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_group_id_slug_key` ON `customer_group` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `customer_legalperson_address_id_93d0acf3` ON `customer_legalperson` (`address_id`);
--> statement-breakpoint
CREATE INDEX `customer_legalperson_business_activity_id_fbcde3c5` ON `customer_legalperson` (`business_activity_id`);
--> statement-breakpoint
CREATE INDEX `customer_legalperson_client_agency_id_3baf8ef1` ON `customer_legalperson` (`client_id`);
--> statement-breakpoint
CREATE INDEX `customer_legalperson_id_slug_7402ef0d_like` ON `customer_legalperson` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_legalperson_id_slug_key` ON `customer_legalperson` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `customer_legalperson_lr_id_type_df272121` ON `customer_legalperson` (`lr_id_type`);
--> statement-breakpoint
CREATE INDEX `customer_legalperson_lr_id_type_df272121_like` ON `customer_legalperson` (`lr_id_type`);
--> statement-breakpoint
CREATE INDEX `customer_legalpersoncontact_id_slug_4fbb0989_like` ON `customer_legalpersoncontact` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_legalpersoncontact_id_slug_key` ON `customer_legalpersoncontact` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `customer_legalpersoncontact_legal_person_id_af37b447` ON `customer_legalpersoncontact` (`legal_person_id`);
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_client_agency_id_d669e098` ON `customer_naturalperson` (`client_id`);
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_genre_5fb8d699` ON `customer_naturalperson` (`genre`);
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_genre_5fb8d699_like` ON `customer_naturalperson` (`genre`);
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_home_address_id_94875213` ON `customer_naturalperson` (`home_address_id`);
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_id_slug_745981bd_like` ON `customer_naturalperson` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_naturalperson_id_slug_key` ON `customer_naturalperson` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_id_type_bc04fc36` ON `customer_naturalperson` (`id_type`);
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_id_type_bc04fc36_like` ON `customer_naturalperson` (`id_type`);
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_marital_status_0279a05c` ON `customer_naturalperson` (`marital_status`);
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_marital_status_0279a05c_like` ON `customer_naturalperson` (`marital_status`);
--> statement-breakpoint
CREATE INDEX `customer_naturalperson_work_address_id_191ca03d` ON `customer_naturalperson` (`work_address_id`);
--> statement-breakpoint
CREATE INDEX `customer_prospect_agency_id_4b27de94` ON `customer_prospect` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `customer_prospect_conversion_client_agency_id_c3866cc2` ON `customer_prospect` (`conversion_client_agency_id`);
--> statement-breakpoint
CREATE INDEX `customer_prospect_currency_209b2b21` ON `customer_prospect` (`currency`);
--> statement-breakpoint
CREATE INDEX `customer_prospect_currency_209b2b21_like` ON `customer_prospect` (`currency`);
--> statement-breakpoint
CREATE INDEX `customer_prospect_id_slug_9a79dc50_like` ON `customer_prospect` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_prospect_id_slug_key` ON `customer_prospect` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `customer_prospect_id_type_a56d488c` ON `customer_prospect` (`id_type`);
--> statement-breakpoint
CREATE INDEX `customer_prospect_id_type_a56d488c_like` ON `customer_prospect` (`id_type`);
--> statement-breakpoint
CREATE INDEX `customer_prospect_origin_00b8cad2` ON `customer_prospect` (`origin`);
--> statement-breakpoint
CREATE INDEX `customer_prospect_origin_00b8cad2_like` ON `customer_prospect` (`origin`);
--> statement-breakpoint
CREATE INDEX `customer_prospect_person_type_ba3a0226` ON `customer_prospect` (`person_type`);
--> statement-breakpoint
CREATE INDEX `customer_prospect_person_type_ba3a0226_like` ON `customer_prospect` (`person_type`);
--> statement-breakpoint
CREATE INDEX `customer_prospect_referred_by_client_id_bf2d016c` ON `customer_prospect` (`referred_by_client_id`);
--> statement-breakpoint
CREATE INDEX `customer_prospect_status_813892e4` ON `customer_prospect` (`status`);
--> statement-breakpoint
CREATE INDEX `customer_prospect_status_813892e4_like` ON `customer_prospect` (`status`);
--> statement-breakpoint
CREATE INDEX `customer_prospectdocument_id_slug_1c233038_like` ON `customer_prospectdocument` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_prospectdocument_id_slug_key` ON `customer_prospectdocument` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `customer_prospectdocument_prospect_id_be0f5987` ON `customer_prospectdocument` (`prospect_id`);
--> statement-breakpoint
CREATE INDEX `customer_prospectdocument_uploaded_by_id_55894c82` ON `customer_prospectdocument` (`uploaded_by_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_prospectdocumen_prospectdocument_id_docu_99f54da6_uniq` ON `customer_prospectdocument_tags` (`prospectdocument_id`, `documenttag_id`);
--> statement-breakpoint
CREATE INDEX `customer_prospectdocument_tags_documenttag_id_bd2598fd` ON `customer_prospectdocument_tags` (`documenttag_id`);
--> statement-breakpoint
CREATE INDEX `customer_prospectdocument_tags_prospectdocument_id_7df9ac9d` ON `customer_prospectdocument_tags` (`prospectdocument_id`);
--> statement-breakpoint
CREATE INDEX `customer_prospectlog_created_by_id_c5e6ea91` ON `customer_prospectlog` (`created_by_id`);
--> statement-breakpoint
CREATE INDEX `customer_prospectlog_prospect_id_73705178` ON `customer_prospectlog` (`prospect_id`);
--> statement-breakpoint
CREATE INDEX `django_admin_log_content_type_id_c4bce8eb` ON `django_admin_log` (`content_type_id`);
--> statement-breakpoint
CREATE INDEX `django_admin_log_user_id_c564eba6` ON `django_admin_log` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `django_content_type_app_label_model_76bd3d3b_uniq` ON `django_content_type` (`app_label`, `model`);
--> statement-breakpoint
CREATE INDEX `django_session_expire_date_a5c62663` ON `django_session` (`expire_date`);
--> statement-breakpoint
CREATE INDEX `django_session_session_key_c0390e0f_like` ON `django_session` (`session_key`);
--> statement-breakpoint
CREATE INDEX `django_site_domain_a2e37b91_like` ON `django_site` (`domain`);
--> statement-breakpoint
CREATE UNIQUE INDEX `django_site_domain_a2e37b91_uniq` ON `django_site` (`domain`);
--> statement-breakpoint
CREATE INDEX `financial_statements_accountnormalization_agency_id_e4c4bf4c` ON `financial_statements_accountnormalization` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `financial_statements_accountnormalization_id_slug_30048c49_like` ON `financial_statements_accountnormalization` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_statements_accountnormalization_id_slug_key` ON `financial_statements_accountnormalization` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `financial_statements_acc_id_slug_65b662d9_like` ON `financial_statements_accountnormalizationfile` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `financial_statements_acc_status_6e829455_like` ON `financial_statements_accountnormalizationfile` (`status`);
--> statement-breakpoint
CREATE INDEX `financial_statements_accou_created_by_id_81f89c14` ON `financial_statements_accountnormalizationfile` (`created_by_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_statements_accountnormalizationfile_id_slug_key` ON `financial_statements_accountnormalizationfile` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `financial_statements_accountnormalizationfile_status_6e829455` ON `financial_statements_accountnormalizationfile` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_statements_agencyauthentication_agency_id_key` ON `financial_statements_agencyauthentication` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `financial_statements_agencyauthentication_id_slug_94594ac8_like` ON `financial_statements_agencyauthentication` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_statements_agencyauthentication_id_slug_key` ON `financial_statements_agencyauthentication` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `financial_statements_financialreportfile_agency_id_75df599f` ON `financial_statements_financialreportfile` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `financial_statements_financialreportfile_id_slug_1f753cc3_like` ON `financial_statements_financialreportfile` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_statements_financialreportfile_id_slug_key` ON `financial_statements_financialreportfile` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `financial_statements_financialreportfile_status_f1bcd849` ON `financial_statements_financialreportfile` (`status`);
--> statement-breakpoint
CREATE INDEX `financial_statements_financialreportfile_status_f1bcd849_like` ON `financial_statements_financialreportfile` (`status`);
--> statement-breakpoint
CREATE INDEX `financial_statements_fin_id_slug_0c64eb0b_like` ON `financial_statements_financialreportrequest` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `financial_statements_finan_created_by_id_c803e6fb` ON `financial_statements_financialreportrequest` (`created_by_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_statements_financialreportrequest_id_slug_key` ON `financial_statements_financialreportrequest` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_statements_fin_financialreportrequest_i_ecb4f228_uniq` ON `financial_statements_financialreportrequest_agencies` (`financialreportrequest_id`, `agency_id`);
--> statement-breakpoint
CREATE INDEX `financial_statements_finan_agency_id_da7e2990` ON `financial_statements_financialreportrequest_agencies` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `financial_statements_finan_financialreportrequest_id_158760b1` ON `financial_statements_financialreportrequest_agencies` (`financialreportrequest_id`);
--> statement-breakpoint
CREATE INDEX `financial_statements_financialstatement_agency_id_8d43f63c` ON `financial_statements_financialstatement` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `financial_statements_financialstatement_id_slug_6f4204d4_like` ON `financial_statements_financialstatement` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_statements_financialstatement_id_slug_key` ON `financial_statements_financialstatement` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `financial_statements_financialstatement_report_file_id_5d6d8329` ON `financial_statements_financialstatement` (`report_file_id`);
--> statement-breakpoint
CREATE INDEX `help_newsletter_id_slug_bbbf5645_like` ON `help_newsletter` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `help_newsletter_id_slug_key` ON `help_newsletter` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `help_newsletterusersurvey_id_slug_0cd843c9_like` ON `help_newsletterusersurvey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `help_newsletterusersurvey_id_slug_key` ON `help_newsletterusersurvey` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `help_newsletterusersurvey_newsletter_id_182adbdb` ON `help_newsletterusersurvey` (`newsletter_id`);
--> statement-breakpoint
CREATE INDEX `help_newsletterusersurvey_user_id_d09582ca` ON `help_newsletterusersurvey` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_user_newsletter` ON `help_newsletterusersurvey` (`user_id`, `newsletter_id`);
--> statement-breakpoint
CREATE INDEX `help_request_agency_id_98d824c1` ON `help_request` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `help_request_assigned_to_id_96be169a` ON `help_request` (`assigned_to_id`);
--> statement-breakpoint
CREATE INDEX `help_request_category_id_9f6f2b07` ON `help_request` (`category_id`);
--> statement-breakpoint
CREATE INDEX `help_request_created_by_slug_2089a10a` ON `help_request` (`created_by_slug`);
--> statement-breakpoint
CREATE INDEX `help_request_created_by_slug_2089a10a_like` ON `help_request` (`created_by_slug`);
--> statement-breakpoint
CREATE INDEX `help_request_id_slug_36457e14_like` ON `help_request` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `help_request_id_slug_key` ON `help_request` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `help_request_priority_8e38ced2` ON `help_request` (`priority`);
--> statement-breakpoint
CREATE INDEX `help_request_priority_8e38ced2_like` ON `help_request` (`priority`);
--> statement-breakpoint
CREATE INDEX `help_requestcategory_id_slug_639cd61d_like` ON `help_requestcategory` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `help_requestcategory_id_slug_key` ON `help_requestcategory` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `help_requestcategory_name_d8193289_like` ON `help_requestcategory` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `help_requestcategory_name_key` ON `help_requestcategory` (`name`);
--> statement-breakpoint
CREATE INDEX `help_requestdocument_id_slug_3e67bb04_like` ON `help_requestdocument` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `help_requestdocument_id_slug_key` ON `help_requestdocument` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `help_requestdocument_request_id_229c763b` ON `help_requestdocument` (`request_id`);
--> statement-breakpoint
CREATE INDEX `help_requestlog_created_by_id_44b7692f` ON `help_requestlog` (`created_by_id`);
--> statement-breakpoint
CREATE INDEX `help_requestlog_request_id_05a61021` ON `help_requestlog` (`request_id`);
--> statement-breakpoint
CREATE INDEX `help_trainingcategory_id_slug_75853c9a_like` ON `help_trainingcategory` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `help_trainingcategory_id_slug_key` ON `help_trainingcategory` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `help_trainingcategory_name_b3ae9c45_like` ON `help_trainingcategory` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `help_trainingcategory_name_key` ON `help_trainingcategory` (`name`);
--> statement-breakpoint
CREATE INDEX `help_trainingcategory_name_slug_e801bc3e` ON `help_trainingcategory` (`name_slug`);
--> statement-breakpoint
CREATE INDEX `help_trainingcategory_name_slug_e801bc3e_like` ON `help_trainingcategory` (`name_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_main_category` ON `help_trainingcategory` (`is_main`) WHERE is_main;
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_reconciliation_category` ON `help_trainingcategory` (`is_reconciliation`) WHERE is_reconciliation;
--> statement-breakpoint
CREATE INDEX `help_trainingvideo_category_id_72f7823f` ON `help_trainingvideo` (`category_id`);
--> statement-breakpoint
CREATE INDEX `help_trainingvideo_id_slug_035301db_like` ON `help_trainingvideo` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `help_trainingvideo_id_slug_key` ON `help_trainingvideo` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `help_trainingvideo_youtube_id_4cfeb6f3_like` ON `help_trainingvideo` (`youtube_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `help_trainingvideo_youtube_id_key` ON `help_trainingvideo` (`youtube_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_order` ON `help_trainingvideo` (`category_id`, `order`);
--> statement-breakpoint
CREATE INDEX `insurance_a_agency__d4c3e2_idx` ON `insurance_agencyshare` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `insurance_a_is_main_2b8bab_idx` ON `insurance_agencyshare` (`is_main`);
--> statement-breakpoint
CREATE INDEX `insurance_a_policy__6a148c_idx` ON `insurance_agencyshare` (`policy_id`);
--> statement-breakpoint
CREATE INDEX `insurance_agencyshare_agency_id_cc36e32f` ON `insurance_agencyshare` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `insurance_agencyshare_commercial_unit_id_841e4958` ON `insurance_agencyshare` (`commercial_unit_id`);
--> statement-breakpoint
CREATE INDEX `insurance_agencyshare_id_slug_c561257a_like` ON `insurance_agencyshare` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_agencyshare_id_slug_key` ON `insurance_agencyshare` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_agencyshare_policy_id_e13263a9` ON `insurance_agencyshare` (`policy_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_agency_share_per_policy` ON `insurance_agencyshare` (`policy_id`, `agency_id`);
--> statement-breakpoint
CREATE INDEX `insurance_beneficiary_id_slug_a8a4578c_like` ON `insurance_beneficiary` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_beneficiary_id_slug_key` ON `insurance_beneficiary` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_beneficiary_insured_id_e011a2c7` ON `insurance_beneficiary` (`insured_id`);
--> statement-breakpoint
CREATE INDEX `endor_term_status_type_idx` ON `insurance_endorsement` (`term_id`, `completed_at`, `type`);
--> statement-breakpoint
CREATE INDEX `insurance_e_complet_f85b4c_idx` ON `insurance_endorsement` (`completed_at`);
--> statement-breakpoint
CREATE INDEX `insurance_e_policy__7952d6_idx` ON `insurance_endorsement` (`policy_id`);
--> statement-breakpoint
CREATE INDEX `insurance_endorsement_cancellation_reason_obj_id_3ea1122d` ON `insurance_endorsement` (`cancellation_reason_id`);
--> statement-breakpoint
CREATE INDEX `insurance_endorsement_commission_amount_eb3a0d76` ON `insurance_endorsement` (`commission_amount`);
--> statement-breakpoint
CREATE INDEX `insurance_endorsement_external_id_747b996a` ON `insurance_endorsement` (`external_id`);
--> statement-breakpoint
CREATE INDEX `insurance_endorsement_external_id_747b996a_like` ON `insurance_endorsement` (`external_id`);
--> statement-breakpoint
CREATE INDEX `insurance_endorsement_id_slug_b934befb_like` ON `insurance_endorsement` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_endorsement_id_slug_key` ON `insurance_endorsement` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_endorsement_migration_slug_338f917c` ON `insurance_endorsement` (`migration_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_endorsement_migration_slug_338f917c_like` ON `insurance_endorsement` (`migration_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_endorsement_policy_id_b0b23462` ON `insurance_endorsement` (`policy_id`);
--> statement-breakpoint
CREATE INDEX `insurance_endorsement_term_id_07a63fca` ON `insurance_endorsement` (`term_id`);
--> statement-breakpoint
CREATE INDEX `insurance_endorsement_type_e67160e9` ON `insurance_endorsement` (`type`);
--> statement-breakpoint
CREATE INDEX `insurance_endorsement_type_e67160e9_like` ON `insurance_endorsement` (`type`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_policy_endorsement_number` ON `insurance_endorsement` (`policy_id`, `number`) WHERE (number IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_policy_initial_endorsement` ON `insurance_endorsement` (`policy_id`, `type`) WHERE ((type) = 'initial');
--> statement-breakpoint
CREATE INDEX `insurance_endorsementdocument_endorsement_id_2e391ce7` ON `insurance_endorsementdocument` (`endorsement_id`);
--> statement-breakpoint
CREATE INDEX `insurance_endorsementdocument_id_slug_57fc7e4c_like` ON `insurance_endorsementdocument` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_endorsementdocument_id_slug_key` ON `insurance_endorsementdocument` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_endorsementdocument_uploaded_by_id_3203c443` ON `insurance_endorsementdocument` (`uploaded_by_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_endorsementdoc_endorsementdocument_id_d_77f13755_uniq` ON `insurance_endorsementdocument_tags` (`endorsementdocument_id`, `documenttag_id`);
--> statement-breakpoint
CREATE INDEX `insurance_endorsementdocum_endorsementdocument_id_c6763b47` ON `insurance_endorsementdocument_tags` (`endorsementdocument_id`);
--> statement-breakpoint
CREATE INDEX `insurance_endorsementdocument_tags_documenttag_id_2ce6ecc8` ON `insurance_endorsementdocument_tags` (`documenttag_id`);
--> statement-breakpoint
CREATE INDEX `insurance_insured_endorsement_id_b954bc53` ON `insurance_insured` (`endorsement_id`);
--> statement-breakpoint
CREATE INDEX `insurance_insured_id_slug_8851c6a9_like` ON `insurance_insured` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_insured_id_slug_key` ON `insurance_insured` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_insured_id_type_19dda2ab` ON `insurance_insured` (`id_type`);
--> statement-breakpoint
CREATE INDEX `insurance_insured_id_type_19dda2ab_like` ON `insurance_insured` (`id_type`);
--> statement-breakpoint
CREATE INDEX `insurance_insuredshare_id_slug_f5dd8a4a_like` ON `insurance_insurershare` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_insuredshare_id_slug_key` ON `insurance_insurershare` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_insuredshare_insured_company_id_d2d83cfb` ON `insurance_insurershare` (`insurer_company_id`);
--> statement-breakpoint
CREATE INDEX `insurance_insuredshare_policy_id_cbdd6a1f` ON `insurance_insurershare` (`policy_id`);
--> statement-breakpoint
CREATE INDEX `insurance_paymenttaskreminder_frequency_0ee2e522` ON `insurance_paymenttaskreminder` (`frequency`);
--> statement-breakpoint
CREATE INDEX `insurance_paymenttaskreminder_frequency_0ee2e522_like` ON `insurance_paymenttaskreminder` (`frequency`);
--> statement-breakpoint
CREATE INDEX `insurance_paymenttaskreminder_id_slug_87e9c4d6_like` ON `insurance_paymenttaskreminder` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_paymenttaskreminder_id_slug_key` ON `insurance_paymenttaskreminder` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_paymenttaskreminder_owner_id_45067725` ON `insurance_paymenttaskreminder` (`owner_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_paymenttaskreminder_policy_id_key` ON `insurance_paymenttaskreminder` (`policy_id`);
--> statement-breakpoint
CREATE INDEX `idx_policy_client_status` ON `insurance_policy` (`client_id`, `status`);
--> statement-breakpoint
CREATE INDEX `idx_policy_owner` ON `insurance_policy` (`owner_id`);
--> statement-breakpoint
CREATE INDEX `insurance_policy_client_id_eb5c6b14` ON `insurance_policy` (`client_id`);
--> statement-breakpoint
CREATE INDEX `insurance_policy_created_by_slug_9539e65c` ON `insurance_policy` (`created_by_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_policy_created_by_slug_9539e65c_like` ON `insurance_policy` (`created_by_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_policy_currency_747f73c7` ON `insurance_policy` (`currency`);
--> statement-breakpoint
CREATE INDEX `insurance_policy_currency_747f73c7_like` ON `insurance_policy` (`currency`);
--> statement-breakpoint
CREATE INDEX `insurance_policy_external_id_6ee56820` ON `insurance_policy` (`external_id`);
--> statement-breakpoint
CREATE INDEX `insurance_policy_external_id_6ee56820_like` ON `insurance_policy` (`external_id`);
--> statement-breakpoint
CREATE INDEX `insurance_policy_id_slug_b1d0794d_like` ON `insurance_policy` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_policy_id_slug_key` ON `insurance_policy` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_policy_migration_slug_e1bb0d9b` ON `insurance_policy` (`migration_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_policy_migration_slug_e1bb0d9b_like` ON `insurance_policy` (`migration_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_policy_owner_id_123e367d` ON `insurance_policy` (`owner_id`);
--> statement-breakpoint
CREATE INDEX `insurance_policy_payment_type_60cf5808` ON `insurance_policy` (`payment_type`);
--> statement-breakpoint
CREATE INDEX `insurance_policy_payment_type_60cf5808_like` ON `insurance_policy` (`payment_type`);
--> statement-breakpoint
CREATE INDEX `insurance_policy_prospect_id_9dd035d1` ON `insurance_policy` (`prospect_id`);
--> statement-breakpoint
CREATE INDEX `insurance_policy_ramo_id_923a5687` ON `insurance_policy` (`ramo_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_policy_renewed_policy_id_key` ON `insurance_policy` (`renewed_policy_id`);
--> statement-breakpoint
CREATE INDEX `insurance_policy_status_795452dc` ON `insurance_policy` (`status`);
--> statement-breakpoint
CREATE INDEX `insurance_policy_status_795452dc_like` ON `insurance_policy` (`status`);
--> statement-breakpoint
CREATE INDEX `insurance_policy_type_600a6e18` ON `insurance_policy` (`type`);
--> statement-breakpoint
CREATE INDEX `insurance_policy_type_600a6e18_like` ON `insurance_policy` (`type`);
--> statement-breakpoint
CREATE INDEX `insurance_document_id_slug_4b8bd920_like` ON `insurance_policydocument` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_document_id_slug_key` ON `insurance_policydocument` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_document_policy_id_4ebbd891` ON `insurance_policydocument` (`policy_id`);
--> statement-breakpoint
CREATE INDEX `insurance_document_uploaded_by_id_08c02069` ON `insurance_policydocument` (`uploaded_by_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_policydocument_policydocument_id_docume_e29d652f_uniq` ON `insurance_policydocument_tags` (`policydocument_id`, `documenttag_id`);
--> statement-breakpoint
CREATE INDEX `insurance_policydocument_tags_documenttag_id_60456c44` ON `insurance_policydocument_tags` (`documenttag_id`);
--> statement-breakpoint
CREATE INDEX `insurance_policydocument_tags_policydocument_id_879f945f` ON `insurance_policydocument_tags` (`policydocument_id`);
--> statement-breakpoint
CREATE INDEX `insurance_policylog_created_by_id_894131d9` ON `insurance_policylog` (`created_by_id`);
--> statement-breakpoint
CREATE INDEX `insurance_policylog_policy_id_384e51e8` ON `insurance_policylog` (`policy_id`);
--> statement-breakpoint
CREATE INDEX `insurance_reinvestment_activity_id_0aab95b9` ON `insurance_reinvestment` (`activity_id`);
--> statement-breakpoint
CREATE INDEX `insurance_reinvestment_id_slug_9c7d59b7_like` ON `insurance_reinvestment` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_reinvestment_id_slug_key` ON `insurance_reinvestment` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_reinvestment_policy_id_ed20e05e` ON `insurance_reinvestment` (`policy_id`);
--> statement-breakpoint
CREATE INDEX `insurance_reinvestment_provider_id_type_14e4c780` ON `insurance_reinvestment` (`provider_id_type`);
--> statement-breakpoint
CREATE INDEX `insurance_reinvestment_provider_id_type_14e4c780_like` ON `insurance_reinvestment` (`provider_id_type`);
--> statement-breakpoint
CREATE INDEX `insurance_reinvestment_provider_name_slug_3bf82986` ON `insurance_reinvestment` (`provider_name_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_reinvestment_provider_name_slug_3bf82986_like` ON `insurance_reinvestment` (`provider_name_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_reinvestmentactivity_id_slug_b084b81a_like` ON `insurance_reinvestmentactivity` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_reinvestmentactivity_id_slug_key` ON `insurance_reinvestmentactivity` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_reinvestmentactivity_name_b108f6b2_like` ON `insurance_reinvestmentactivity` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_reinvestmentactivity_name_key` ON `insurance_reinvestmentactivity` (`name`);
--> statement-breakpoint
CREATE INDEX `insurance_reinvestmentterm_id_slug_ad23ad96_like` ON `insurance_reinvestmentterm` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_reinvestmentterm_id_slug_key` ON `insurance_reinvestmentterm` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_reinvestmentterm_term_id_key` ON `insurance_reinvestmentterm` (`term_id`);
--> statement-breakpoint
CREATE INDEX `insurance_sellershare_id_slug_d110ffa9_like` ON `insurance_sellershare` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_sellershare_id_slug_key` ON `insurance_sellershare` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_sellershare_policy_id_7b1cda14` ON `insurance_sellershare` (`policy_id`);
--> statement-breakpoint
CREATE INDEX `insurance_sellershare_seller_id_37bb8da0` ON `insurance_sellershare` (`seller_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_policy_seller` ON `insurance_sellershare` (`policy_id`, `seller_id`);
--> statement-breakpoint
CREATE INDEX `insurance_term_id_slug_2faddd35_like` ON `insurance_term` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_term_id_slug_key` ON `insurance_term` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `insurance_term_policy_id_6da1bd48` ON `insurance_term` (`policy_id`);
--> statement-breakpoint
CREATE INDEX `mfa_authenticator_user_id_0c3a50c0` ON `mfa_authenticator` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_authenticator_type` ON `mfa_authenticator` (`user_id`, `type`) WHERE ((type) IN (('totp'), ('recovery_codes')));
--> statement-breakpoint
CREATE INDEX `notification_attachment_id_slug_b15442a2_like` ON `notification_attachment` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_attachment_id_slug_key` ON `notification_attachment` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `notification_attachment_notification_id_f2ac0433` ON `notification_attachment` (`notification_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_configuration_agency_id_key` ON `notification_configuration` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `notification_configuration_id_slug_7f821db8_like` ON `notification_configuration` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_configuration_id_slug_key` ON `notification_configuration` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_customemailtemplatetype_email_template_id_key` ON `notification_customemailtemplatetype` (`email_template_id`);
--> statement-breakpoint
CREATE INDEX `notification_customemailtemplatetype_id_slug_a020a695_like` ON `notification_customemailtemplatetype` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_customemailtemplatetype_id_slug_key` ON `notification_customemailtemplatetype` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `notification_emailtemplate_agency_id_e8d21063` ON `notification_emailtemplate` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `notification_emailtemplate_id_slug_78cbeb90_like` ON `notification_emailtemplate` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_emailtemplate_id_slug_key` ON `notification_emailtemplate` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `notification_emailtemplate_type_0bb3bf80` ON `notification_emailtemplate` (`type`);
--> statement-breakpoint
CREATE INDEX `notification_emailtemplate_type_0bb3bf80_like` ON `notification_emailtemplate` (`type`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_emailtempla_emailtemplate_id_ramo_id_e1d92ebb_uniq` ON `notification_emailtemplate_ramos` (`emailtemplate_id`, `ramo_id`);
--> statement-breakpoint
CREATE INDEX `notification_emailtemplate_ramos_emailtemplate_id_dff5de74` ON `notification_emailtemplate_ramos` (`emailtemplate_id`);
--> statement-breakpoint
CREATE INDEX `notification_emailtemplate_ramos_ramo_id_0b6278db` ON `notification_emailtemplate_ramos` (`ramo_id`);
--> statement-breakpoint
CREATE INDEX `notification_emailtemplateimage_template_id_5e66b604` ON `notification_emailtemplateimage` (`template_id`);
--> statement-breakpoint
CREATE INDEX `notification_externalnotification_direction_40f6959f` ON `notification_externalnotification` (`direction`);
--> statement-breakpoint
CREATE INDEX `notification_externalnotification_direction_40f6959f_like` ON `notification_externalnotification` (`direction`);
--> statement-breakpoint
CREATE INDEX `notification_externalnotification_microsoft_id_fe7d5621_like` ON `notification_externalnotification` (`microsoft_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_externalnotification_microsoft_id_key` ON `notification_externalnotification` (`microsoft_id`);
--> statement-breakpoint
CREATE INDEX `notification_notification_agency_id_c168df86` ON `notification_externalnotification` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `notification_notification_client_id_56858ebd` ON `notification_externalnotification` (`client_id`);
--> statement-breakpoint
CREATE INDEX `notification_notification_endorsement_id_c2c9e78e` ON `notification_externalnotification` (`endorsement_id`);
--> statement-breakpoint
CREATE INDEX `notification_notification_id_slug_1fa2a4b2_like` ON `notification_externalnotification` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_notification_id_slug_key` ON `notification_externalnotification` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `notification_notification_policy_id_a1e28c8e` ON `notification_externalnotification` (`policy_id`);
--> statement-breakpoint
CREATE INDEX `notification_notification_status_75aae542` ON `notification_externalnotification` (`status`);
--> statement-breakpoint
CREATE INDEX `notification_notification_status_75aae542_like` ON `notification_externalnotification` (`status`);
--> statement-breakpoint
CREATE INDEX `notification_notification_type_8c8f8855` ON `notification_externalnotification` (`type`);
--> statement-breakpoint
CREATE INDEX `notification_notification_type_8c8f8855_like` ON `notification_externalnotification` (`type`);
--> statement-breakpoint
CREATE INDEX `notification_graphsubscription_id_slug_52ead3ca_like` ON `notification_graphsubscription` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_graphsubscription_id_slug_key` ON `notification_graphsubscription` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_graphsubscription_mailbox_id_key` ON `notification_graphsubscription` (`mailbox_id`);
--> statement-breakpoint
CREATE INDEX `notification_graphsubscription_subscription_id_f0acb510_like` ON `notification_graphsubscription` (`subscription_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_graphsubscription_subscription_id_key` ON `notification_graphsubscription` (`subscription_id`);
--> statement-breakpoint
CREATE INDEX `notification_internalnotification_id_slug_e4f7cbbf_like` ON `notification_internalnotification` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_internalnotification_id_slug_key` ON `notification_internalnotification` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `notification_internalnotification_section_c8385185` ON `notification_internalnotification` (`section`);
--> statement-breakpoint
CREATE INDEX `notification_internalnotification_section_c8385185_like` ON `notification_internalnotification` (`section`);
--> statement-breakpoint
CREATE INDEX `notification_internalnotification_user_id_65cf0bbb` ON `notification_internalnotification` (`user_id`);
--> statement-breakpoint
CREATE INDEX `notificatio_action_c85626_idx` ON `notification_microsoftgraphevent` (`action`, `created_at`);
--> statement-breakpoint
CREATE INDEX `notificatio_created_04d5fe_idx` ON `notification_microsoftgraphevent` (`created_at`);
--> statement-breakpoint
CREATE INDEX `notificatio_externa_b76ac8_idx` ON `notification_microsoftgraphevent` (`external_notification_id_slug`, `created_at`);
--> statement-breakpoint
CREATE INDEX `notificatio_outcome_9169bc_idx` ON `notification_microsoftgraphevent` (`outcome`, `created_at`);
--> statement-breakpoint
CREATE INDEX `notification_microsoftgr_external_notification_id_11ee502c_like` ON `notification_microsoftgraphevent` (`external_notification_id_slug`);
--> statement-breakpoint
CREATE INDEX `notification_microsoftgrap_external_notification_id_s_11ee502c` ON `notification_microsoftgraphevent` (`external_notification_id_slug`);
--> statement-breakpoint
CREATE INDEX `notification_microsoftgraphevent_id_slug_50991000_like` ON `notification_microsoftgraphevent` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_microsoftgraphevent_id_slug_key` ON `notification_microsoftgraphevent` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `notification_microsoftgr_conversation_id_fff6f041_like` ON `notification_microsoftgraphnotification` (`conversation_id`);
--> statement-breakpoint
CREATE INDEX `notification_microsoftgrap_compliance_request_id_e29a7455` ON `notification_microsoftgraphnotification` (`compliance_request_id`);
--> statement-breakpoint
CREATE INDEX `notification_microsoftgrap_conversation_id_fff6f041` ON `notification_microsoftgraphnotification` (`conversation_id`);
--> statement-breakpoint
CREATE INDEX `notification_microsoftgraphnotification_id_slug_3fe7966a_like` ON `notification_microsoftgraphnotification` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_microsoftgraphnotification_id_slug_key` ON `notification_microsoftgraphnotification` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_microsoftgraphnotification_notification_id_key` ON `notification_microsoftgraphnotification` (`notification_id`);
--> statement-breakpoint
CREATE INDEX `notification_ramoconfiguration_configuration_id_7dabf2e3` ON `notification_ramoconfiguration` (`configuration_id`);
--> statement-breakpoint
CREATE INDEX `notification_ramoconfiguration_id_slug_f7b5e6f6_like` ON `notification_ramoconfiguration` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_ramoconfiguration_id_slug_key` ON `notification_ramoconfiguration` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `notification_ramoconfiguration_ramo_id_f93c2e63` ON `notification_ramoconfiguration` (`ramo_id`);
--> statement-breakpoint
CREATE INDEX `notification_ramoconfiguration_type_7d21ebca` ON `notification_ramoconfiguration` (`type`);
--> statement-breakpoint
CREATE INDEX `notification_ramoconfiguration_type_7d21ebca_like` ON `notification_ramoconfiguration` (`type`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_ramo_configuration` ON `notification_ramoconfiguration` (`configuration_id`, `ramo_id`, `type`);
--> statement-breakpoint
CREATE INDEX `operation_collectionfile_agency_id_06507374` ON `operation_collectionfile` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `operation_collectionfile_id_slug_256ea08a_like` ON `operation_collectionfile` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_collectionfile_id_slug_key` ON `operation_collectionfile` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `operation_collectionfile_insurance_company_id_8b62a21b` ON `operation_collectionfile` (`insurance_company_id`);
--> statement-breakpoint
CREATE INDEX `operation_p_agency__afd057_idx` ON `operation_payment` (`agency_id`, `term_id`);
--> statement-breakpoint
CREATE INDEX `operation_p_status_d1c467_idx` ON `operation_payment` (`status`);
--> statement-breakpoint
CREATE INDEX `operation_payment_agency_id_4f7025a4` ON `operation_payment` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `operation_payment_created_by_slug_d331e830` ON `operation_payment` (`created_by_slug`);
--> statement-breakpoint
CREATE INDEX `operation_payment_created_by_slug_d331e830_like` ON `operation_payment` (`created_by_slug`);
--> statement-breakpoint
CREATE INDEX `operation_payment_external_id_43bb2be7` ON `operation_payment` (`external_id`);
--> statement-breakpoint
CREATE INDEX `operation_payment_external_id_43bb2be7_like` ON `operation_payment` (`external_id`);
--> statement-breakpoint
CREATE INDEX `operation_payment_id_slug_723e8cdb_like` ON `operation_payment` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_payment_id_slug_key` ON `operation_payment` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `operation_payment_migration_slug_d08ef3b7` ON `operation_payment` (`migration_slug`);
--> statement-breakpoint
CREATE INDEX `operation_payment_migration_slug_d08ef3b7_like` ON `operation_payment` (`migration_slug`);
--> statement-breakpoint
CREATE INDEX `operation_payment_reconciliation_slug_e0bc6874` ON `operation_payment` (`reconciliation_slug`);
--> statement-breakpoint
CREATE INDEX `operation_payment_reconciliation_slug_e0bc6874_like` ON `operation_payment` (`reconciliation_slug`);
--> statement-breakpoint
CREATE INDEX `operation_payment_settlement_id_e045a3e1` ON `operation_payment` (`settlement_id`);
--> statement-breakpoint
CREATE INDEX `operation_payment_status_eda91efe` ON `operation_payment` (`status`);
--> statement-breakpoint
CREATE INDEX `operation_payment_status_eda91efe_like` ON `operation_payment` (`status`);
--> statement-breakpoint
CREATE INDEX `operation_payment_term_id_2da86979` ON `operation_payment` (`term_id`);
--> statement-breakpoint
CREATE INDEX `operation_paymentamount_endorsement_id_413129e4` ON `operation_paymentamount` (`endorsement_id`);
--> statement-breakpoint
CREATE INDEX `operation_paymentamount_id_slug_47ec1509_like` ON `operation_paymentamount` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_paymentamount_id_slug_key` ON `operation_paymentamount` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `operation_paymentamount_payment_id_e5a76acd` ON `operation_paymentamount` (`payment_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_paymentamount_payment_id_endorsement_id_eea6ddb1_uniq` ON `operation_paymentamount` (`payment_id`, `endorsement_id`);
--> statement-breakpoint
CREATE INDEX `payamt_end_pay_idx` ON `operation_paymentamount` (`endorsement_id`, `payment_id`);
--> statement-breakpoint
CREATE INDEX `operation_paymentcollect_created_by_slug_12a1a647_like` ON `operation_paymentcollectionfollowup` (`created_by_slug`);
--> statement-breakpoint
CREATE INDEX `operation_paymentcollectionfollowup_contact_type_72d411b9` ON `operation_paymentcollectionfollowup` (`contact_type`);
--> statement-breakpoint
CREATE INDEX `operation_paymentcollectionfollowup_contact_type_72d411b9_like` ON `operation_paymentcollectionfollowup` (`contact_type`);
--> statement-breakpoint
CREATE INDEX `operation_paymentcollectionfollowup_created_by_slug_12a1a647` ON `operation_paymentcollectionfollowup` (`created_by_slug`);
--> statement-breakpoint
CREATE INDEX `operation_paymentcollectionfollowup_id_slug_93c3a5d0_like` ON `operation_paymentcollectionfollowup` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_paymentcollectionfollowup_id_slug_key` ON `operation_paymentcollectionfollowup` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `operation_paymentcollectionfollowup_outcome_0e5076b3` ON `operation_paymentcollectionfollowup` (`outcome`);
--> statement-breakpoint
CREATE INDEX `operation_paymentcollectionfollowup_outcome_0e5076b3_like` ON `operation_paymentcollectionfollowup` (`outcome`);
--> statement-breakpoint
CREATE INDEX `operation_paymentcollectionfollowup_owner_id_edfedb51` ON `operation_paymentcollectionfollowup` (`owner_id`);
--> statement-breakpoint
CREATE INDEX `operation_paymentcollectionfollowup_payment_id_266572a1` ON `operation_paymentcollectionfollowup` (`payment_id`);
--> statement-breakpoint
CREATE INDEX `pcf_payment_date_idx` ON `operation_paymentcollectionfollowup` (`payment_id`, `contact_date`, `id`);
--> statement-breakpoint
CREATE INDEX `pcf_payment_outcome_date_idx` ON `operation_paymentcollectionfollowup` (`payment_id`, `outcome`, `contact_date`, `id`);
--> statement-breakpoint
CREATE INDEX `operation_paymentlog_created_by_id_637cf7c9` ON `operation_paymentlog` (`created_by_id`);
--> statement-breakpoint
CREATE INDEX `operation_paymentlog_payment_id_a5a6f584` ON `operation_paymentlog` (`payment_id`);
--> statement-breakpoint
CREATE INDEX `operation_paymentresponsible_id_type_b335e821` ON `operation_paymentresponsible` (`id_type`);
--> statement-breakpoint
CREATE INDEX `operation_paymentresponsible_id_type_b335e821_like` ON `operation_paymentresponsible` (`id_type`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_paymentresponsible_payment_id_key` ON `operation_paymentresponsible` (`payment_id`);
--> statement-breakpoint
CREATE INDEX `operation_portfolioreconci_insurance_company_id_931b5172` ON `operation_portfolioreconciliationfile` (`insurance_company_id`);
--> statement-breakpoint
CREATE INDEX `operation_portfolioreconciliationfile_agency_id_dca12050` ON `operation_portfolioreconciliationfile` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `operation_portfolioreconciliationfile_id_slug_2818b793_like` ON `operation_portfolioreconciliationfile` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_portfolioreconciliationfile_id_slug_key` ON `operation_portfolioreconciliationfile` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `operation_reconciliationfile_agency_id_cb7c2dd3` ON `operation_reconciliationfile` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `operation_reconciliationfile_id_slug_d5aa7262_like` ON `operation_reconciliationfile` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_reconciliationfile_id_slug_key` ON `operation_reconciliationfile` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `operation_reconciliationfile_insurance_company_id_ffe2759d` ON `operation_reconciliationfile` (`insurance_company_id`);
--> statement-breakpoint
CREATE INDEX `operation_reimbursement_charged_currency_8cf28483` ON `operation_reimbursement` (`charged_currency`);
--> statement-breakpoint
CREATE INDEX `operation_reimbursement_charged_currency_8cf28483_like` ON `operation_reimbursement` (`charged_currency`);
--> statement-breakpoint
CREATE INDEX `operation_reimbursement_id_slug_5951065d_like` ON `operation_reimbursement` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_reimbursement_id_slug_key` ON `operation_reimbursement` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `operation_reimbursement_paid_currency_d4a88d0f` ON `operation_reimbursement` (`paid_currency`);
--> statement-breakpoint
CREATE INDEX `operation_reimbursement_paid_currency_d4a88d0f_like` ON `operation_reimbursement` (`paid_currency`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_reimbursement_task_id_key` ON `operation_reimbursement` (`task_id`);
--> statement-breakpoint
CREATE INDEX `operation_reimbursementreport_account_type_a6d1b3e4` ON `operation_reimbursementreport` (`account_type`);
--> statement-breakpoint
CREATE INDEX `operation_reimbursementreport_account_type_a6d1b3e4_like` ON `operation_reimbursementreport` (`account_type`);
--> statement-breakpoint
CREATE INDEX `operation_reimbursementreport_agency_id_7e5c4435` ON `operation_reimbursementreport` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `operation_reimbursementreport_bank_id_6af2f399` ON `operation_reimbursementreport` (`bank_id`);
--> statement-breakpoint
CREATE INDEX `operation_reimbursementreport_created_by_slug_a30ea7aa` ON `operation_reimbursementreport` (`created_by_slug`);
--> statement-breakpoint
CREATE INDEX `operation_reimbursementreport_created_by_slug_a30ea7aa_like` ON `operation_reimbursementreport` (`created_by_slug`);
--> statement-breakpoint
CREATE INDEX `operation_reimbursementreport_id_slug_53e66e4c_like` ON `operation_reimbursementreport` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_reimbursementreport_id_slug_key` ON `operation_reimbursementreport` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `operation_reimbursementreport_term_id_ed6a4b9b` ON `operation_reimbursementreport` (`term_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_reimbursementr_reimbursementreport_id_r_24b0eca8_uniq` ON `operation_reimbursementreport_reimbursements` (`reimbursementreport_id`, `reimbursement_id`);
--> statement-breakpoint
CREATE INDEX `operation_reimbursementrep_reimbursement_id_01608196` ON `operation_reimbursementreport_reimbursements` (`reimbursement_id`);
--> statement-breakpoint
CREATE INDEX `operation_reimbursementrep_reimbursementreport_id_93d8f533` ON `operation_reimbursementreport_reimbursements` (`reimbursementreport_id`);
--> statement-breakpoint
CREATE INDEX `operation_settlement_id_slug_e38cb6cc_like` ON `operation_settlement` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_settlement_id_slug_key` ON `operation_settlement` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `operation_settlement_seller_id_1a02f672` ON `operation_settlement` (`seller_id`);
--> statement-breakpoint
CREATE INDEX `operation_settlementdocument_id_slug_96520c21_like` ON `operation_settlementdocument` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_settlementdocument_id_slug_key` ON `operation_settlementdocument` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `operation_settlementdocument_settlement_id_ae87858e` ON `operation_settlementdocument` (`settlement_id`);
--> statement-breakpoint
CREATE INDEX `operation_settlementdocument_uploaded_by_id_8bdebe24` ON `operation_settlementdocument` (`uploaded_by_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_settlementdocu_settlementdocument_id_do_29125eaa_uniq` ON `operation_settlementdocument_tags` (`settlementdocument_id`, `documenttag_id`);
--> statement-breakpoint
CREATE INDEX `operation_settlementdocume_settlementdocument_id_ea938c90` ON `operation_settlementdocument_tags` (`settlementdocument_id`);
--> statement-breakpoint
CREATE INDEX `operation_settlementdocument_tags_documenttag_id_43cdefe6` ON `operation_settlementdocument_tags` (`documenttag_id`);
--> statement-breakpoint
CREATE INDEX `operation_settlementlog_created_by_id_5e49dea6` ON `operation_settlementlog` (`created_by_id`);
--> statement-breakpoint
CREATE INDEX `operation_settlementlog_settlement_id_11b6af00` ON `operation_settlementlog` (`settlement_id`);
--> statement-breakpoint
CREATE INDEX `operation_task_agency_id_255288ad` ON `operation_task` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `operation_task_claim_id_8eb9e872` ON `operation_task` (`claim_id`);
--> statement-breakpoint
CREATE INDEX `operation_task_client_id_920a42d2` ON `operation_task` (`client_id`);
--> statement-breakpoint
CREATE INDEX `operation_task_created_by_slug_0cc25c46` ON `operation_task` (`created_by_slug`);
--> statement-breakpoint
CREATE INDEX `operation_task_created_by_slug_0cc25c46_like` ON `operation_task` (`created_by_slug`);
--> statement-breakpoint
CREATE INDEX `operation_task_external_id_c0b507c4` ON `operation_task` (`external_id`);
--> statement-breakpoint
CREATE INDEX `operation_task_external_id_c0b507c4_like` ON `operation_task` (`external_id`);
--> statement-breakpoint
CREATE INDEX `operation_task_id_slug_d016eba7_like` ON `operation_task` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_task_id_slug_key` ON `operation_task` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `operation_task_migration_slug_95e6ff72` ON `operation_task` (`migration_slug`);
--> statement-breakpoint
CREATE INDEX `operation_task_migration_slug_95e6ff72_like` ON `operation_task` (`migration_slug`);
--> statement-breakpoint
CREATE INDEX `operation_task_owner_id_9dffc449` ON `operation_task` (`owner_id`);
--> statement-breakpoint
CREATE INDEX `operation_task_policy_id_4956e34a` ON `operation_task` (`policy_id`);
--> statement-breakpoint
CREATE INDEX `operation_task_priority_398547e8` ON `operation_task` (`priority`);
--> statement-breakpoint
CREATE INDEX `operation_task_priority_398547e8_like` ON `operation_task` (`priority`);
--> statement-breakpoint
CREATE INDEX `operation_task_prospect_id_bf6330d1` ON `operation_task` (`prospect_id`);
--> statement-breakpoint
CREATE INDEX `operation_task_ramo_id_35a85ba2` ON `operation_task` (`ramo_id`);
--> statement-breakpoint
CREATE INDEX `operation_task_seller_id_714fb3dd` ON `operation_task` (`seller_id`);
--> statement-breakpoint
CREATE INDEX `operation_task_status_59ce19ce` ON `operation_task` (`status`);
--> statement-breakpoint
CREATE INDEX `operation_task_status_59ce19ce_like` ON `operation_task` (`status`);
--> statement-breakpoint
CREATE INDEX `operation_task_type_id_c50d3eec` ON `operation_task` (`type_id`);
--> statement-breakpoint
CREATE INDEX `operation_task_tags_task_id_3db112ae` ON `operation_task_tags` (`task_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_task_tags_task_id_tasktag_id_9bb141e6_uniq` ON `operation_task_tags` (`task_id`, `tasktag_id`);
--> statement-breakpoint
CREATE INDEX `operation_task_tags_tasktag_id_6ffb96cf` ON `operation_task_tags` (`tasktag_id`);
--> statement-breakpoint
CREATE INDEX `operation_taskassignmentrule_agency_id_1ef5517c` ON `operation_taskassignmentrule` (`agency_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_taskassignmentrule_agency_id_name_1446dbe6_uniq` ON `operation_taskassignmentrule` (`agency_id`, `name`);
--> statement-breakpoint
CREATE INDEX `operation_taskassignmentrule_id_slug_51136409_like` ON `operation_taskassignmentrule` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_taskassignmentrule_id_slug_key` ON `operation_taskassignmentrule` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `operation_taskassignmentrule_owner_id_fc102e94` ON `operation_taskassignmentrule` (`owner_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_taskassignment_taskassignmentrule_id_in_752e5587_uniq` ON `operation_taskassignmentrule_insurers` (`taskassignmentrule_id`, `insurercompany_id`);
--> statement-breakpoint
CREATE INDEX `operation_taskassignmentru_insurercompany_id_3053060c` ON `operation_taskassignmentrule_insurers` (`insurercompany_id`);
--> statement-breakpoint
CREATE INDEX `operation_taskassignmentru_taskassignmentrule_id_fe025143` ON `operation_taskassignmentrule_insurers` (`taskassignmentrule_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_taskassignment_taskassignmentrule_id_ra_fb43e01b_uniq` ON `operation_taskassignmentrule_ramos` (`taskassignmentrule_id`, `ramo_id`);
--> statement-breakpoint
CREATE INDEX `operation_taskassignmentru_taskassignmentrule_id_1945617f` ON `operation_taskassignmentrule_ramos` (`taskassignmentrule_id`);
--> statement-breakpoint
CREATE INDEX `operation_taskassignmentrule_ramos_ramo_id_67cfb846` ON `operation_taskassignmentrule_ramos` (`ramo_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_taskassignment_taskassignmentrule_id_se_db073f2d_uniq` ON `operation_taskassignmentrule_sellers` (`taskassignmentrule_id`, `seller_id`);
--> statement-breakpoint
CREATE INDEX `operation_taskassignmentru_taskassignmentrule_id_cb79d261` ON `operation_taskassignmentrule_sellers` (`taskassignmentrule_id`);
--> statement-breakpoint
CREATE INDEX `operation_taskassignmentrule_sellers_seller_id_f1feaed8` ON `operation_taskassignmentrule_sellers` (`seller_id`);
--> statement-breakpoint
CREATE INDEX `operation_taskdocument_id_slug_2d5902e1_like` ON `operation_taskdocument` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_taskdocument_id_slug_key` ON `operation_taskdocument` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `operation_taskdocument_task_id_61822f54` ON `operation_taskdocument` (`task_id`);
--> statement-breakpoint
CREATE INDEX `operation_taskdocument_uploaded_by_id_a3a03143` ON `operation_taskdocument` (`uploaded_by_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_taskdocument_t_taskdocument_id_document_295a1196_uniq` ON `operation_taskdocument_tags` (`taskdocument_id`, `documenttag_id`);
--> statement-breakpoint
CREATE INDEX `operation_taskdocument_tags_documenttag_id_5cf3c231` ON `operation_taskdocument_tags` (`documenttag_id`);
--> statement-breakpoint
CREATE INDEX `operation_taskdocument_tags_taskdocument_id_61a9dff4` ON `operation_taskdocument_tags` (`taskdocument_id`);
--> statement-breakpoint
CREATE INDEX `operation_tasklog_created_by_id_a31e54e9` ON `operation_tasklog` (`created_by_id`);
--> statement-breakpoint
CREATE INDEX `operation_tasklog_task_id_45bc129b` ON `operation_tasklog` (`task_id`);
--> statement-breakpoint
CREATE INDEX `operation_tasktag_agency_id_c696bea0` ON `operation_tasktag` (`agency_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_tasktag_agency_id_name_8eb67091_uniq` ON `operation_tasktag` (`agency_id`, `name`);
--> statement-breakpoint
CREATE INDEX `operation_tasktag_color_8313293a` ON `operation_tasktag` (`color`);
--> statement-breakpoint
CREATE INDEX `operation_tasktag_color_8313293a_like` ON `operation_tasktag` (`color`);
--> statement-breakpoint
CREATE INDEX `operation_tasktype_name_190dd7fe_like` ON `operation_tasktype` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_tasktype_name_190dd7fe_uniq` ON `operation_tasktype` (`name`);
--> statement-breakpoint
CREATE INDEX `operation_tasktype_prospect_status_ce79b6ef` ON `operation_tasktype` (`prospect_status`);
--> statement-breakpoint
CREATE INDEX `operation_tasktype_prospect_status_ce79b6ef_like` ON `operation_tasktype` (`prospect_status`);
--> statement-breakpoint
CREATE INDEX `operation_tasktype_slug_c0dd8b62` ON `operation_tasktype` (`slug`);
--> statement-breakpoint
CREATE INDEX `operation_tasktype_slug_c0dd8b62_like` ON `operation_tasktype` (`slug`);
--> statement-breakpoint
CREATE INDEX `production_data_importprod_uploaded_by_id_26d8c9e6` ON `production_data_importproductiondatafile` (`uploaded_by_id`);
--> statement-breakpoint
CREATE INDEX `production_data_importproductiondatafile_agency_id_394eab5b` ON `production_data_importproductiondatafile` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `production_data_importproductiondatafile_id_slug_7cd6f365_like` ON `production_data_importproductiondatafile` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `production_data_importproductiondatafile_id_slug_key` ON `production_data_importproductiondatafile` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `production_data_importproductiondatafile_status_0afed144` ON `production_data_importproductiondatafile` (`status`);
--> statement-breakpoint
CREATE INDEX `production_data_importproductiondatafile_status_0afed144_like` ON `production_data_importproductiondatafile` (`status`);
--> statement-breakpoint
CREATE INDEX `production_data_normalizationfile_created_by_id_56e6de5c` ON `production_data_normalizationfile` (`created_by_id`);
--> statement-breakpoint
CREATE INDEX `production_data_normalizationfile_id_slug_513fe3cc_like` ON `production_data_normalizationfile` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `production_data_normalizationfile_id_slug_key` ON `production_data_normalizationfile` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `production_data_normalizationfile_status_711aba92` ON `production_data_normalizationfile` (`status`);
--> statement-breakpoint
CREATE INDEX `production_data_normalizationfile_status_711aba92_like` ON `production_data_normalizationfile` (`status`);
--> statement-breakpoint
CREATE INDEX `production_data_normalizationfile_type_dfe3832c` ON `production_data_normalizationfile` (`type`);
--> statement-breakpoint
CREATE INDEX `production_data_normalizationfile_type_dfe3832c_like` ON `production_data_normalizationfile` (`type`);
--> statement-breakpoint
CREATE INDEX `production_data_productiondata_id_slug_10803e63_like` ON `production_data_productiondata` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `production_data_productiondata_id_slug_key` ON `production_data_productiondata` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `production_data_productiondata_report_file_id_00ca2c92` ON `production_data_productiondata` (`report_file_id`);
--> statement-breakpoint
CREATE INDEX `production_data_productiondata_unique_slug_68f1046d_like` ON `production_data_productiondata` (`unique_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `production_data_productiondata_unique_slug_68f1046d_uniq` ON `production_data_productiondata` (`unique_slug`);
--> statement-breakpoint
CREATE INDEX `production_data_standardizeinsurer_agency_id_57fa445d` ON `production_data_standardizeinsurer` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `production_data_standardizeinsurer_id_slug_76025401_like` ON `production_data_standardizeinsurer` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `production_data_standardizeinsurer_id_slug_key` ON `production_data_standardizeinsurer` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `production_data_standardizeinsurer_insurer_id_0e630204` ON `production_data_standardizeinsurer` (`insurer_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_agency_insurer_agency` ON `production_data_standardizeinsurer` (`agency_id`, `insurer_agency`);
--> statement-breakpoint
CREATE INDEX `production_data_standardizeramo_agency_id_9fed3381` ON `production_data_standardizeramo` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `production_data_standardizeramo_id_slug_c93d30c5_like` ON `production_data_standardizeramo` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `production_data_standardizeramo_id_slug_key` ON `production_data_standardizeramo` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `production_data_standardizeramo_ramo_id_e08d0d28` ON `production_data_standardizeramo` (`ramo_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_agency_ramo_agency` ON `production_data_standardizeramo` (`agency_id`, `ramo_agency`);
--> statement-breakpoint
CREATE INDEX `renewal_documentspecification_client_type_0f5dd112` ON `renewal_documentspecification` (`client_type`);
--> statement-breakpoint
CREATE INDEX `renewal_documentspecification_client_type_0f5dd112_like` ON `renewal_documentspecification` (`client_type`);
--> statement-breakpoint
CREATE INDEX `renewal_documentspecification_id_slug_55f05808_like` ON `renewal_documentspecification` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `renewal_documentspecification_id_slug_key` ON `renewal_documentspecification` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `renewal_documentspecification_tag_id_key` ON `renewal_documentspecification` (`tag_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `renewal_documentspecific_documentspecification_id_30c246f2_uniq` ON `renewal_documentspecification_ramo` (`documentspecification_id`, `ramo_id`);
--> statement-breakpoint
CREATE INDEX `renewal_documentspecificat_documentspecification_id_48192234` ON `renewal_documentspecification_ramo` (`documentspecification_id`);
--> statement-breakpoint
CREATE INDEX `renewal_documentspecification_ramo_ramo_id_a9ef1a20` ON `renewal_documentspecification_ramo` (`ramo_id`);
--> statement-breakpoint
CREATE INDEX `renewal_initialstep_id_slug_640948f8_like` ON `renewal_initialstep` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `renewal_initialstep_id_slug_key` ON `renewal_initialstep` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `renewal_initialstep_owner_id_cf673e04` ON `renewal_initialstep` (`owner_id`);
--> statement-breakpoint
CREATE INDEX `renewal_initialstep_renewal_id_46b33430` ON `renewal_initialstep` (`renewal_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `renewal_initialstep_renewal_id_step_type_94f4890f_uniq` ON `renewal_initialstep` (`renewal_id`, `step_type`);
--> statement-breakpoint
CREATE INDEX `renewal_initialstep_step_status_0071c54c` ON `renewal_initialstep` (`step_status`);
--> statement-breakpoint
CREATE INDEX `renewal_initialstep_step_status_0071c54c_like` ON `renewal_initialstep` (`step_status`);
--> statement-breakpoint
CREATE INDEX `renewal_initialstep_step_type_53ff8dcb` ON `renewal_initialstep` (`step_type`);
--> statement-breakpoint
CREATE INDEX `renewal_initialstep_step_type_53ff8dcb_like` ON `renewal_initialstep` (`step_type`);
--> statement-breakpoint
CREATE UNIQUE INDEX `renewal_initialstepconfig_agency_id_key` ON `renewal_initialstepconfig` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `renewal_initialstepconfig_id_slug_276d637a_like` ON `renewal_initialstepconfig` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `renewal_initialstepconfig_id_slug_key` ON `renewal_initialstepconfig` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `renewal_nonrenewalreason_id_slug_7c1e056a_like` ON `renewal_nonrenewalreason` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `renewal_nonrenewalreason_id_slug_key` ON `renewal_nonrenewalreason` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `renewal_nonrenewalreason_name_580ec834_like` ON `renewal_nonrenewalreason` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `renewal_nonrenewalreason_name_key` ON `renewal_nonrenewalreason` (`name`);
--> statement-breakpoint
CREATE INDEX `renewal_renewal_external_id_fe950911` ON `renewal_renewal` (`external_id`);
--> statement-breakpoint
CREATE INDEX `renewal_renewal_external_id_fe950911_like` ON `renewal_renewal` (`external_id`);
--> statement-breakpoint
CREATE INDEX `renewal_renewal_id_slug_04f1fd4e_like` ON `renewal_renewal` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `renewal_renewal_id_slug_key` ON `renewal_renewal` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `renewal_renewal_insurance_company_id_2b9b173a` ON `renewal_renewal` (`insurance_company_id`);
--> statement-breakpoint
CREATE INDEX `renewal_renewal_main_renewal_id_0b086500` ON `renewal_renewal` (`main_renewal_id`);
--> statement-breakpoint
CREATE INDEX `renewal_renewal_migration_slug_8525e7db` ON `renewal_renewal` (`migration_slug`);
--> statement-breakpoint
CREATE INDEX `renewal_renewal_migration_slug_8525e7db_like` ON `renewal_renewal` (`migration_slug`);
--> statement-breakpoint
CREATE INDEX `renewal_renewal_new_status_ef33fbef` ON `renewal_renewal` (`status`);
--> statement-breakpoint
CREATE INDEX `renewal_renewal_new_status_ef33fbef_like` ON `renewal_renewal` (`status`);
--> statement-breakpoint
CREATE INDEX `renewal_renewal_non_renewal_reason_obj_id_a80be21b` ON `renewal_renewal` (`non_renewal_reason_id`);
--> statement-breakpoint
CREATE INDEX `renewal_renewal_owner_id_ced1d5f4` ON `renewal_renewal` (`owner_id`);
--> statement-breakpoint
CREATE INDEX `renewal_renewal_policy_id_68628be4` ON `renewal_renewal` (`policy_id`);
--> statement-breakpoint
CREATE INDEX `renewal_renewal_renewal_type_e416c45c` ON `renewal_renewal` (`renewal_type`);
--> statement-breakpoint
CREATE INDEX `renewal_renewal_renewal_type_e416c45c_like` ON `renewal_renewal` (`renewal_type`);
--> statement-breakpoint
CREATE INDEX `renewal_renewaldocument_id_slug_bd41b6db_like` ON `renewal_renewaldocument` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `renewal_renewaldocument_id_slug_key` ON `renewal_renewaldocument` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `renewal_renewaldocument_renewal_id_d6ffd315` ON `renewal_renewaldocument` (`renewal_id`);
--> statement-breakpoint
CREATE INDEX `renewal_renewaldocument_uploaded_by_id_397bd316` ON `renewal_renewaldocument` (`uploaded_by_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `renewal_renewaldocument__renewaldocument_id_docum_1665c32d_uniq` ON `renewal_renewaldocument_tags` (`renewaldocument_id`, `documenttag_id`);
--> statement-breakpoint
CREATE INDEX `renewal_renewaldocument_tags_documenttag_id_871e946c` ON `renewal_renewaldocument_tags` (`documenttag_id`);
--> statement-breakpoint
CREATE INDEX `renewal_renewaldocument_tags_renewaldocument_id_f467f203` ON `renewal_renewaldocument_tags` (`renewaldocument_id`);
--> statement-breakpoint
CREATE INDEX `renewal_renewallog_created_by_id_d4dcfc42` ON `renewal_renewallog` (`created_by_id`);
--> statement-breakpoint
CREATE INDEX `renewal_renewallog_renewal_id_1aefad25` ON `renewal_renewallog` (`renewal_id`);
--> statement-breakpoint
CREATE INDEX `sales_contractlead_city_id_d1d804c1` ON `sales_contractlead` (`city_id`);
--> statement-breakpoint
CREATE INDEX `sales_contractlead_contract_number_bb0f42dc` ON `sales_contractlead` (`contract_number`);
--> statement-breakpoint
CREATE INDEX `sales_contractlead_contract_number_bb0f42dc_like` ON `sales_contractlead` (`contract_number`);
--> statement-breakpoint
CREATE INDEX `sales_contractlead_entity_id_98488e86` ON `sales_contractlead` (`entity_id`);
--> statement-breakpoint
CREATE INDEX `sales_contractlead_holder_id_46ba934c` ON `sales_contractlead` (`holder_id`);
--> statement-breakpoint
CREATE INDEX `sales_contractlead_id_slug_6e7d485e_like` ON `sales_contractlead` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_contractlead_id_slug_key` ON `sales_contractlead` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `sales_contractlead_provider_id_de37056e` ON `sales_contractlead` (`provider_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_contract_lead_number_per_entity` ON `sales_contractlead` (`contract_number`, `entity_id`);
--> statement-breakpoint
CREATE INDEX `sales_contractleadsimportfile_id_slug_f68a1693_like` ON `sales_contractleadsimportfile` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_contractleadsimportfile_id_slug_key` ON `sales_contractleadsimportfile` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_entity_external_id_key` ON `sales_entity` (`vendu_id`);
--> statement-breakpoint
CREATE INDEX `sales_entity_id_slug_d80d9089_like` ON `sales_entity` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_entity_id_slug_key` ON `sales_entity` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `sales_entitycity_city_id_77a50829` ON `sales_entitycity` (`city_id`);
--> statement-breakpoint
CREATE INDEX `sales_entitycity_entity_id_4242e9c3` ON `sales_entitycity` (`entity_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_entitycity_entity_id_city_id_904d959a_uniq` ON `sales_entitycity` (`entity_id`, `city_id`);
--> statement-breakpoint
CREATE INDEX `sales_entitycity_id_slug_cc06c04a_like` ON `sales_entitycity` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_entitycity_id_slug_key` ON `sales_entitycity` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `sales_holder_id_number_351d5a76` ON `sales_holder` (`id_number`);
--> statement-breakpoint
CREATE INDEX `sales_holder_id_number_351d5a76_like` ON `sales_holder` (`id_number`);
--> statement-breakpoint
CREATE INDEX `sales_holder_id_slug_c2b72b89_like` ON `sales_holder` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_holder_id_slug_key` ON `sales_holder` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `sales_holder_id_type_db8c1d5d` ON `sales_holder` (`id_type`);
--> statement-breakpoint
CREATE INDEX `sales_holder_id_type_db8c1d5d_like` ON `sales_holder` (`id_type`);
--> statement-breakpoint
CREATE INDEX `sales_operator_id_slug_8bc09aeb_like` ON `sales_operator` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_operator_id_slug_key` ON `sales_operator` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_plan_external_id_key` ON `sales_plan` (`vendu_id`);
--> statement-breakpoint
CREATE INDEX `sales_plan_id_slug_8af92b47_like` ON `sales_plan` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_plan_id_slug_key` ON `sales_plan` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `sales_plan_product_id_260eba87` ON `sales_plan` (`product_id`);
--> statement-breakpoint
CREATE INDEX `sales_product_entity_id_6ced0fd4` ON `sales_product` (`entity_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_product_external_id_key` ON `sales_product` (`vendu_id`);
--> statement-breakpoint
CREATE INDEX `sales_product_id_slug_d3b832e5_like` ON `sales_product` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_product_id_slug_key` ON `sales_product` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `sales_product_insurer_company_id_6ea848f0` ON `sales_product` (`insurer_company_id`);
--> statement-breakpoint
CREATE INDEX `sales_product_operator_id_9bb354fe` ON `sales_product` (`operator_id`);
--> statement-breakpoint
CREATE INDEX `sales_provider_id_slug_3c98b20c_like` ON `sales_provider` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_provider_id_slug_key` ON `sales_provider` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `sales_sale_client_agency_id_492e395b` ON `sales_sale` (`client_id`);
--> statement-breakpoint
CREATE INDEX `sales_sale_contract_id_7a558867` ON `sales_sale` (`contract_id`);
--> statement-breakpoint
CREATE INDEX `sales_sale_created_by_id_f6773268` ON `sales_sale` (`created_by_id`);
--> statement-breakpoint
CREATE INDEX `sales_sale_entity_id_46f23b1b` ON `sales_sale` (`entity_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_sale_external_id_key` ON `sales_sale` (`vendu_id`);
--> statement-breakpoint
CREATE INDEX `sales_sale_id_slug_0cad056a_like` ON `sales_sale` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_sale_id_slug_key` ON `sales_sale` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `sales_sale_insurer_company_id_c3922dbf` ON `sales_sale` (`insurer_company_id`);
--> statement-breakpoint
CREATE INDEX `sales_sale_plan_id_5bea1e65` ON `sales_sale` (`plan_id`);
--> statement-breakpoint
CREATE INDEX `sales_sale_positive_at_b55f8742` ON `sales_sale` (`positive_at`);
--> statement-breakpoint
CREATE INDEX `sales_sale_product_id_e01466c2` ON `sales_sale` (`product_id`);
--> statement-breakpoint
CREATE INDEX `sales_sale_sales_mode_757d4d34` ON `sales_sale` (`sales_mode`);
--> statement-breakpoint
CREATE INDEX `sales_sale_sales_mode_757d4d34_like` ON `sales_sale` (`sales_mode`);
--> statement-breakpoint
CREATE INDEX `sales_sale_status_7ba038f2` ON `sales_sale` (`status`);
--> statement-breakpoint
CREATE INDEX `sales_sale_status_7ba038f2_like` ON `sales_sale` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_transaction_id` ON `sales_sale` (`transaction_id`) WHERE (transaction_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX `sales_saleaudio_id_slug_ccb460a7_like` ON `sales_saleaudio` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_saleaudio_id_slug_key` ON `sales_saleaudio` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `sales_saleaudio_sale_id_e1f71d2b` ON `sales_saleaudio` (`sale_id`);
--> statement-breakpoint
CREATE INDEX `sales_saletranscription_id_slug_c0b022c2_like` ON `sales_saletranscription` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_saletranscription_id_slug_key` ON `sales_saletranscription` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `sales_saletranscription_sale_id_0449c6e8` ON `sales_saletranscription` (`sale_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `socialaccount_socialaccount_provider_uid_fc810c6e_uniq` ON `socialaccount_socialaccount` (`provider`, `uid`);
--> statement-breakpoint
CREATE INDEX `socialaccount_socialaccount_user_id_8146e70c` ON `socialaccount_socialaccount` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `socialaccount_socialapp__socialapp_id_site_id_71a9a768_uniq` ON `socialaccount_socialapp_sites` (`socialapp_id`, `site_id`);
--> statement-breakpoint
CREATE INDEX `socialaccount_socialapp_sites_site_id_2579dee5` ON `socialaccount_socialapp_sites` (`site_id`);
--> statement-breakpoint
CREATE INDEX `socialaccount_socialapp_sites_socialapp_id_97fb6e7d` ON `socialaccount_socialapp_sites` (`socialapp_id`);
--> statement-breakpoint
CREATE INDEX `socialaccount_socialtoken_account_id_951f210e` ON `socialaccount_socialtoken` (`account_id`);
--> statement-breakpoint
CREATE INDEX `socialaccount_socialtoken_app_id_636a42d7` ON `socialaccount_socialtoken` (`app_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `socialaccount_socialtoken_app_id_account_id_fca4e0ac_uniq` ON `socialaccount_socialtoken` (`app_id`, `account_id`);
--> statement-breakpoint
CREATE INDEX `nps_resp_surv_user_cr_idx` ON `survey_npsresponse` (`survey_id`, `user_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `nps_resp_survey_created_idx` ON `survey_npsresponse` (`survey_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `nps_resp_user_created_idx` ON `survey_npsresponse` (`user_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `survey_npsresponse_id_slug_410ce6d7_like` ON `survey_npsresponse` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `survey_npsresponse_id_slug_key` ON `survey_npsresponse` (`id_slug`);
--> statement-breakpoint
CREATE INDEX `survey_npsresponse_survey_id_b9e958c5` ON `survey_npsresponse` (`survey_id`);
--> statement-breakpoint
CREATE INDEX `survey_npssurvey_id_slug_4010d31d_like` ON `survey_npssurvey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `survey_npssurvey_id_slug_key` ON `survey_npssurvey` (`id_slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_active_nps_survey` ON `survey_npssurvey` (`is_active`) WHERE is_active;
--> statement-breakpoint
CREATE INDEX `user_mfaauthenticationlog_user_id_4f3ae0f2` ON `user_mfaauthenticationlog` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_default_role` ON `user_role` (`is_default`) WHERE is_default;
--> statement-breakpoint
CREATE INDEX `user_role_name_a5e027ab_like` ON `user_role` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_role_name_key` ON `user_role` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_user_device` ON `user_trusteddevice` (`user_id`, `device_hash`);
--> statement-breakpoint
CREATE INDEX `user_trusteddevice_device_hash_4b6f8156` ON `user_trusteddevice` (`device_hash`);
--> statement-breakpoint
CREATE INDEX `user_trusteddevice_device_hash_4b6f8156_like` ON `user_trusteddevice` (`device_hash`);
--> statement-breakpoint
CREATE INDEX `user_trusteddevice_expires_at_5d115cd1` ON `user_trusteddevice` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `user_trusteddevice_user_id_cae5e133` ON `user_trusteddevice` (`user_id`);
--> statement-breakpoint
CREATE INDEX `user_user_agency_id_7be33bad` ON `user_user` (`agency_id`);
--> statement-breakpoint
CREATE INDEX `user_user_document_type_bf99ec99` ON `user_user` (`document_type`);
--> statement-breakpoint
CREATE INDEX `user_user_document_type_bf99ec99_like` ON `user_user` (`document_type`);
--> statement-breakpoint
CREATE INDEX `user_user_email_1c6f3d1a_like` ON `user_user` (`email`);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_user_email_key` ON `user_user` (`email`);
--> statement-breakpoint
CREATE INDEX `user_user_origin_02b42baa` ON `user_user` (`origin`);
--> statement-breakpoint
CREATE INDEX `user_user_origin_02b42baa_like` ON `user_user` (`origin`);
--> statement-breakpoint
CREATE INDEX `user_user_role_model_id_6e94cad6` ON `user_user` (`role_id`);
--> statement-breakpoint
CREATE INDEX `user_user_seller_id_d9b31783` ON `user_user` (`seller_id`);
--> statement-breakpoint
CREATE INDEX `user_user_groups_group_id_c57f13c0` ON `user_user_groups` (`group_id`);
--> statement-breakpoint
CREATE INDEX `user_user_groups_user_id_13f9a20d` ON `user_user_groups` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_user_groups_user_id_group_id_bb60391f_uniq` ON `user_user_groups` (`user_id`, `group_id`);
--> statement-breakpoint
CREATE INDEX `user_user_user_permissions_permission_id_ce49d4de` ON `user_user_user_permissions` (`permission_id`);
--> statement-breakpoint
CREATE INDEX `user_user_user_permissions_user_id_31782f58` ON `user_user_user_permissions` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_user_user_permissions_user_id_permission_id_64f4d5b8_uniq` ON `user_user_user_permissions` (`user_id`, `permission_id`);
--> statement-breakpoint
CREATE INDEX `user_usercomplementarydata_branch_id_7e3852ba` ON `user_usercomplementarydata` (`branch_id`);
--> statement-breakpoint
CREATE INDEX `user_usercomplementarydata_gender_23a4c5ff` ON `user_usercomplementarydata` (`gender`);
--> statement-breakpoint
CREATE INDEX `user_usercomplementarydata_gender_23a4c5ff_like` ON `user_usercomplementarydata` (`gender`);
--> statement-breakpoint
CREATE INDEX `user_usercomplementarydata_id_number_71fe11c8_like` ON `user_usercomplementarydata` (`id_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_usercomplementarydata_id_number_key` ON `user_usercomplementarydata` (`id_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_usercomplementarydata_user_id_key` ON `user_usercomplementarydata` (`user_id`);
--> statement-breakpoint
