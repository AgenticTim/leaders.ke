CREATE TYPE "public"."citizen_feedback_sentiment" AS ENUM('positive', 'neutral', 'negative');--> statement-breakpoint
CREATE TYPE "public"."mobilization_event_status" AS ENUM('planned', 'held', 'cancelled');--> statement-breakpoint
CREATE TABLE "citizen_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_user_id" integer NOT NULL,
	"collected_by_user_id" integer NOT NULL,
	"event_id" integer,
	"citizen_name" varchar(120),
	"county" varchar(100),
	"ward" varchar(100),
	"sentiment" "citizen_feedback_sentiment" DEFAULT 'neutral' NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mobilization_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_user_id" integer NOT NULL,
	"ambassador_user_id" integer NOT NULL,
	"title" varchar(160) NOT NULL,
	"description" text,
	"county" varchar(100),
	"ward" varchar(100),
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" "mobilization_event_status" DEFAULT 'planned' NOT NULL,
	"turnout" integer,
	"confirmed_by" integer,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "citizen_feedback" ADD CONSTRAINT "citizen_feedback_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citizen_feedback" ADD CONSTRAINT "citizen_feedback_collected_by_user_id_users_id_fk" FOREIGN KEY ("collected_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citizen_feedback" ADD CONSTRAINT "citizen_feedback_event_id_mobilization_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."mobilization_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobilization_events" ADD CONSTRAINT "mobilization_events_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobilization_events" ADD CONSTRAINT "mobilization_events_ambassador_user_id_users_id_fk" FOREIGN KEY ("ambassador_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobilization_events" ADD CONSTRAINT "mobilization_events_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "citizen_feedback_subject_idx" ON "citizen_feedback" USING btree ("subject_user_id");--> statement-breakpoint
CREATE INDEX "citizen_feedback_collected_by_idx" ON "citizen_feedback" USING btree ("collected_by_user_id");--> statement-breakpoint
CREATE INDEX "mobilization_events_subject_idx" ON "mobilization_events" USING btree ("subject_user_id");--> statement-breakpoint
CREATE INDEX "mobilization_events_ambassador_idx" ON "mobilization_events" USING btree ("ambassador_user_id");