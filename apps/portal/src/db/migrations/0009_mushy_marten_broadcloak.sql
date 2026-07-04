CREATE TABLE "stores" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"stripe_customer_id" text,
	"subscription_id" text,
	"setup_payment_id" text,
	"video_r2_key" text,
	"video_external_url" text,
	"payment_failed_at" timestamp,
	"live_at" timestamp,
	"suspended_at" timestamp,
	"canceled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stores_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stores_user_id_idx" ON "stores" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stores_status_idx" ON "stores" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stores_subscription_id_idx" ON "stores" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "stores_stripe_customer_id_idx" ON "stores" USING btree ("stripe_customer_id");