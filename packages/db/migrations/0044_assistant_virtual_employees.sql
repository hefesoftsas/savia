CREATE TABLE `assistant_virtual_employees` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `agency_id` BIGINT,
  `name` TEXT NOT NULL,
  `handle` TEXT NOT NULL,
  `position` TEXT,
  `avatar` TEXT,
  `greeting` TEXT,
  `system_prompt` TEXT NOT NULL,
  `allowed_collections` TEXT NOT NULL DEFAULT '["*"]',
  `model` TEXT,
  `status` TEXT NOT NULL DEFAULT 'active' CHECK (`status` IN ('active', 'inactive')),
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL,
  `created_by` TEXT,
  FOREIGN KEY (`agency_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_virtual_employees_agency_handle`
ON `assistant_virtual_employees` (`agency_id`, `handle`) WHERE `agency_id` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_virtual_employees_global_handle`
ON `assistant_virtual_employees` (`handle`) WHERE `agency_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `assistant_virtual_employees_agency_index`
ON `assistant_virtual_employees` (`agency_id`);
--> statement-breakpoint
CREATE TABLE `assistant_virtual_employee_files` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `employee_id` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `content_type` TEXT NOT NULL,
  `size_bytes` INTEGER NOT NULL,
  `r2_key` TEXT NOT NULL,
  `rag_status` TEXT NOT NULL DEFAULT 'indexed' CHECK (`rag_status` IN ('pending', 'indexed', 'failed')),
  `created_at` TEXT NOT NULL,
  FOREIGN KEY (`employee_id`) REFERENCES `assistant_virtual_employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_virtual_employee_files_employee_index`
ON `assistant_virtual_employee_files` (`employee_id`);
--> statement-breakpoint
CREATE TABLE `assistant_virtual_employee_chunks` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `employee_id` TEXT NOT NULL,
  `file_id` TEXT NOT NULL,
  `chunk_index` INTEGER NOT NULL,
  `text` TEXT NOT NULL,
  `vector_id` TEXT,
  `created_at` TEXT NOT NULL,
  FOREIGN KEY (`employee_id`) REFERENCES `assistant_virtual_employees`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`file_id`) REFERENCES `assistant_virtual_employee_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_virtual_employee_chunks_lookup`
ON `assistant_virtual_employee_chunks` (`employee_id`, `file_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `assistant_virtual_employees` (
  `id`, `agency_id`, `name`, `handle`, `position`, `avatar`, `greeting`, `system_prompt`, `allowed_collections`, `model`, `status`, `created_at`, `updated_at`, `created_by`
) VALUES (
  'emp-default-ventas',
  NULL,
  'Laura - Ventas',
  'ventas',
  'Especialista en Ventas y Cotizaciones',
  'briefcase',
  '¡Hola! Soy Laura, tu especialista en ventas y cotizaciones. ¿En qué oportunidad o cliente puedo ayudarte hoy?',
  'Eres Laura, especialista en ventas y cotizaciones del equipo Savia. Tu objetivo es asesorar con agilidad en oportunidades de venta, cotizaciones de seguros y seguimiento a clientes prospectos. Eres proactiva, cordial y orientada al cierre de negocios.',
  '["*"]',
  NULL,
  'active',
  '2026-09-14T00:00:00.000Z',
  '2026-09-14T00:00:00.000Z',
  'system'
), (
  'emp-default-soporte',
  NULL,
  'Carlos - Soporte',
  'soporte',
  'Especialista en Atención y Pólizas',
  'headset',
  'Hola, soy Carlos de soporte. Estoy aquí para asistirte con consultas operativas, estado de pólizas y atención a usuarios.',
  'Eres Carlos, especialista en soporte y atención al cliente en Savia. Tu misión es resolver dudas operativas, verificar coberturas, pólizas y estatus de reclamos con tono empático, claro y pedagógico.',
  '["*"]',
  NULL,
  'active',
  '2026-09-14T00:00:00.000Z',
  '2026-09-14T00:00:00.000Z',
  'system'
);
