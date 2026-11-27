CREATE TABLE "crosspoint_device_libraries" (
	"user_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"library_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crosspoint_device_libraries_device_id_library_id_pk" PRIMARY KEY("device_id","library_id")
);
--> statement-breakpoint
ALTER TABLE "crosspoint_devices" DROP CONSTRAINT "crosspoint_devices_selection_mode_chk";--> statement-breakpoint
ALTER TABLE "crosspoint_devices" ALTER COLUMN "file_naming_pattern" SET DEFAULT '{library}/<{authors:first}|Unknown Author>/<{series}/>{originalFilename}';--> statement-breakpoint
ALTER TABLE "crosspoint_device_libraries" ADD CONSTRAINT "crosspoint_device_libraries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspoint_device_libraries" ADD CONSTRAINT "crosspoint_device_libraries_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspoint_device_libraries" ADD CONSTRAINT "crosspoint_device_libraries_owner_fk" FOREIGN KEY ("device_id","user_id") REFERENCES "public"."crosspoint_devices"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crosspoint_device_libraries_user_id_idx" ON "crosspoint_device_libraries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "crosspoint_device_libraries_library_id_idx" ON "crosspoint_device_libraries" USING btree ("library_id");--> statement-breakpoint
ALTER TABLE "crosspoint_devices" ADD CONSTRAINT "crosspoint_devices_selection_mode_chk" CHECK ("crosspoint_devices"."selection_mode" in ('all', 'libraries', 'selected'));