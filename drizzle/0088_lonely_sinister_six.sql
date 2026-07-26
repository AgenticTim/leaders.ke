CREATE TYPE "public"."profile_flag_reason" AS ENUM('impersonation', 'inappropriate_content', 'duplicate_profile', 'inaccurate_information', 'reported_abuse', 'other');--> statement-breakpoint
CREATE TYPE "public"."user_origin" AS ENUM('seed', 'browser', 'mobile');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "origin" "user_origin" DEFAULT 'seed' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "flag_reason" "profile_flag_reason";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "flagged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "features" jsonb DEFAULT '[]'::jsonb NOT NULL;