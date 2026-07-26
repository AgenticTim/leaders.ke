ALTER TABLE "platform_settings" ADD COLUMN "guest_ask_lifetime_limit" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "user_ask_daily_limit" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "ai_chat_cost_credits" integer DEFAULT 5 NOT NULL;