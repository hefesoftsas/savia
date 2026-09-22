-- Native counterpart of SQLite 0060: per-principal My Day widget layouts.
CREATE TABLE "user_my_day_widgets" (
  "principal_id" TEXT PRIMARY KEY NOT NULL, "layout" TEXT NOT NULL, "updated_at" TEXT NOT NULL);

ALTER TABLE "user_my_day_widgets" ADD FOREIGN KEY ("principal_id") REFERENCES "identity_principal"("id")
    ON UPDATE no action ON DELETE restrict;
