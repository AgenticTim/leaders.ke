ALTER TABLE "wallets" DROP CONSTRAINT "wallets_campaign_id_campaigns_id_fk";
--> statement-breakpoint
ALTER TABLE "wallets" ALTER COLUMN "subject_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN "campaign_id";--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_subject_user_id_unique" UNIQUE("subject_user_id");