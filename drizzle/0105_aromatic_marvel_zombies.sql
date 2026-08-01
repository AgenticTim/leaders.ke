ALTER TABLE "conversations" ADD COLUMN "anon_id" varchar(64);--> statement-breakpoint
CREATE INDEX "conversations_anon_idx" ON "conversations" USING btree ("anon_id");