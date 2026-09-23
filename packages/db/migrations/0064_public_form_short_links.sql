CREATE TABLE public_form_short_links (
 code TEXT PRIMARY KEY CHECK(length(code)=16 AND code NOT GLOB '*[^a-f0-9]*'),
 form_id TEXT NOT NULL UNIQUE REFERENCES public_forms(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL
);
