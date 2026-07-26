ALTER TABLE "wallets" DROP CONSTRAINT "wallets_campaign_id_unique";--> statement-breakpoint
ALTER TABLE "wallets" ALTER COLUMN "campaign_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "subject_user_id" integer;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;