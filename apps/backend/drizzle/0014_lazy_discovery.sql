CREATE TYPE "public"."discovery_mode" AS ENUM('EAGER', 'LAZY');--> statement-breakpoint
ALTER TABLE "namespaces" ADD COLUMN "discovery_mode" "discovery_mode" DEFAULT 'EAGER' NOT NULL;--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "discovery_mode_override" "discovery_mode";
