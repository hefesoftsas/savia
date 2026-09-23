CREATE TABLE public_form_short_links (
  code text PRIMARY KEY CHECK (length(code) = 16 AND code !~ '[^a-f0-9]'),
  form_id text NOT NULL UNIQUE REFERENCES public_forms(id) ON DELETE CASCADE,
  created_at text NOT NULL
);
