CREATE TABLE "crosspoint_bookmark_links" (
	"user_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"crosspoint_id" varchar(32) NOT NULL,
	"bookmark_id" integer NOT NULL,
	"xpath" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crosspoint_bookmark_links_device_id_crosspoint_id_pk" PRIMARY KEY("device_id","crosspoint_id")
);
--> statement-breakpoint
CREATE TABLE "crosspoint_device_documents" (
	"user_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"document_hash" varchar(64) NOT NULL,
	"book_file_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crosspoint_device_documents_device_id_document_hash_pk" PRIMARY KEY("device_id","document_hash")
);
--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "position_percent" real;--> statement-breakpoint
ALTER TABLE "crosspoint_device_books" ADD COLUMN "remote_filename_hash" varchar(32) GENERATED ALWAYS AS (md5(regexp_replace(remote_path, '^.*/', ''))) STORED;--> statement-breakpoint
ALTER TABLE "crosspoint_devices" ADD COLUMN "sync_token" varchar(32) DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "koreader_device_progress" ADD COLUMN "position" jsonb;--> statement-breakpoint
ALTER TABLE "crosspoint_bookmark_links" ADD CONSTRAINT "crosspoint_bookmark_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspoint_bookmark_links" ADD CONSTRAINT "crosspoint_bookmark_links_bookmark_id_bookmarks_id_fk" FOREIGN KEY ("bookmark_id") REFERENCES "public"."bookmarks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspoint_bookmark_links" ADD CONSTRAINT "crosspoint_bookmark_links_owner_fk" FOREIGN KEY ("device_id","user_id") REFERENCES "public"."crosspoint_devices"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspoint_device_documents" ADD CONSTRAINT "crosspoint_device_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspoint_device_documents" ADD CONSTRAINT "crosspoint_device_documents_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspoint_device_documents" ADD CONSTRAINT "crosspoint_device_documents_owner_fk" FOREIGN KEY ("device_id","user_id") REFERENCES "public"."crosspoint_devices"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crosspoint_bookmark_links_user_id_idx" ON "crosspoint_bookmark_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "crosspoint_bookmark_links_bookmark_id_idx" ON "crosspoint_bookmark_links" USING btree ("bookmark_id");--> statement-breakpoint
CREATE INDEX "crosspoint_device_documents_user_id_idx" ON "crosspoint_device_documents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "crosspoint_device_documents_book_file_id_idx" ON "crosspoint_device_documents" USING btree ("book_file_id");--> statement-breakpoint
CREATE INDEX "crosspoint_device_books_device_filename_hash_idx" ON "crosspoint_device_books" USING btree ("device_id","remote_filename_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "crosspoint_devices_sync_token_uidx" ON "crosspoint_devices" USING btree ("sync_token");--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_position_percent_range_chk" CHECK ("bookmarks"."position_percent" is null or ("bookmarks"."position_percent" >= 0 and "bookmarks"."position_percent" <= 100));