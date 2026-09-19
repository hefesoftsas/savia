CREATE TABLE public_forms (
 id TEXT PRIMARY KEY,
 token TEXT NOT NULL UNIQUE,
 tenant_id TEXT NOT NULL,
 domain_id TEXT NOT NULL,
 object_name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('record','quote')),
 title TEXT NOT NULL,
 description TEXT,
 fields TEXT NOT NULL CHECK(json_valid(fields)),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
 daily_limit INTEGER NOT NULL CHECK(daily_limit BETWEEN 1 AND 1000),
 return_result INTEGER NOT NULL DEFAULT 0 CHECK(return_result IN (0,1)),
 expires_at TEXT,
 revoked_at TEXT,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX public_forms_management ON public_forms(tenant_id,object_name,created_at);
--> statement-breakpoint
CREATE TABLE public_form_submissions (
 form_id TEXT NOT NULL REFERENCES public_forms(id),
 submission_id TEXT NOT NULL,
 tenant_id TEXT NOT NULL,
 ip_hash TEXT NOT NULL,
 day TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 captcha_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('reserved','complete','failed')),
 response TEXT CHECK(response IS NULL OR json_valid(response)),
 created_at TEXT NOT NULL,
 PRIMARY KEY(form_id,submission_id),
 UNIQUE(captcha_hash)
);
--> statement-breakpoint
CREATE INDEX public_form_submissions_link_day ON public_form_submissions(form_id,day);
--> statement-breakpoint
CREATE INDEX public_form_submissions_tenant_day ON public_form_submissions(tenant_id,day);
--> statement-breakpoint
CREATE INDEX public_form_submissions_ip_day ON public_form_submissions(ip_hash,day);
