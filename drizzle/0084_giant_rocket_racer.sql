ALTER TABLE "ai_ask_events" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "ai_ask_events" ADD CONSTRAINT "ai_ask_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_ask_events_user_idx" ON "ai_ask_events" USING btree ("user_id","created_at");