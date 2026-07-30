-- Trigram GIN indexes for the unanchored `%q%` ILIKE searches behind
-- /api/quick-search and /search. Without them every keystroke sequential-scans
-- users, posts and parties; with pg_trgm the planner turns each ILIKE into an
-- index lookup.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_first_name_trgm_idx" ON "users" USING gin ("first_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_other_names_trgm_idx" ON "users" USING gin ("other_names" gin_trgm_ops);--> statement-breakpoint
-- Both search surfaces also match the concatenated full name as one string.
CREATE INDEX IF NOT EXISTS "users_full_name_trgm_idx" ON "users" USING gin (("first_name" || ' ' || "other_names") gin_trgm_ops);--> statement-breakpoint
-- /search additionally matches long free-text fields.
CREATE INDEX IF NOT EXISTS "users_bio_trgm_idx" ON "users" USING gin ("bio" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leaders_description_trgm_idx" ON "leaders" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posts_title_trgm_idx" ON "posts" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parties_name_trgm_idx" ON "parties" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parties_abbreviation_trgm_idx" ON "parties" USING gin ("abbreviation" gin_trgm_ops);
