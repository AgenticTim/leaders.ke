CREATE TYPE "public"."broadcast_channel" AS ENUM('email', 'sms', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."broadcast_recipient_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."broadcast_status" AS ENUM('queued', 'sending', 'sent', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "broadcast_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"broadcast_id" integer NOT NULL,
	"follower_id" integer,
	"channel" "broadcast_channel" NOT NULL,
	"destination" varchar(120) NOT NULL,
	"status" "broadcast_recipient_status" DEFAULT 'queued' NOT NULL,
	"error" varchar(300),
	"credits_spent" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_user_id" integer NOT NULL,
	"creator_id" integer NOT NULL,
	"channel" "broadcast_channel" NOT NULL,
	"subject" varchar(200),
	"body" text NOT NULL,
	"audience_label" varchar(120) NOT NULL,
	"status" "broadcast_status" DEFAULT 'queued' NOT NULL,
	"total_recipients" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"credits_spent" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rate_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" varchar(40) NOT NULL,
	"bucket" varchar(140) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "followers" ADD COLUMN "unsubscribe_token" varchar(64);--> statement-breakpoint
ALTER TABLE "followers" ADD COLUMN "opted_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_follower_id_followers_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."followers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcast_recipients_broadcast_idx" ON "broadcast_recipients" USING btree ("broadcast_id");--> statement-breakpoint
CREATE INDEX "broadcast_recipients_status_idx" ON "broadcast_recipients" USING btree ("status");--> statement-breakpoint
CREATE INDEX "broadcasts_subject_idx" ON "broadcasts" USING btree ("subject_user_id");--> statement-breakpoint
CREATE INDEX "rate_events_action_bucket_idx" ON "rate_events" USING btree ("action","bucket","created_at");