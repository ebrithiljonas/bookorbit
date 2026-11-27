CREATE TABLE "crosspoint_device_books" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"book_id" integer,
	"file_id" integer,
	"remote_path" varchar(2048) NOT NULL,
	"file_hash" varchar(32),
	"file_size" bigint,
	"last_seen_run_id" integer,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crosspoint_device_books_file_size_nonnegative_chk" CHECK ("crosspoint_device_books"."file_size" is null or "crosspoint_device_books"."file_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "crosspoint_device_collections" (
	"user_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"collection_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crosspoint_device_collections_device_id_collection_id_pk" PRIMARY KEY("device_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "crosspoint_device_smart_scopes" (
	"user_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"smart_scope_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crosspoint_device_smart_scopes_device_id_smart_scope_id_pk" PRIMARY KEY("device_id","smart_scope_id")
);
--> statement-breakpoint
CREATE TABLE "crosspoint_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"host" varchar(255) NOT NULL,
	"ws_port" integer DEFAULT 81 NOT NULL,
	"http_port" integer DEFAULT 80 NOT NULL,
	"device_id" varchar(64),
	"device_model" varchar(8),
	"firmware_version" varchar(64),
	"root_folder" varchar(512) DEFAULT '/BookOrbit' NOT NULL,
	"file_naming_pattern" text DEFAULT '<{authors:first} - >{title}' NOT NULL,
	"selection_mode" varchar(16) DEFAULT 'all' NOT NULL,
	"remove_missing" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crosspoint_devices_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "crosspoint_devices_selection_mode_chk" CHECK ("crosspoint_devices"."selection_mode" in ('all', 'selected')),
	CONSTRAINT "crosspoint_devices_ws_port_chk" CHECK ("crosspoint_devices"."ws_port" >= 1 and "crosspoint_devices"."ws_port" <= 65535),
	CONSTRAINT "crosspoint_devices_http_port_chk" CHECK ("crosspoint_devices"."http_port" >= 1 and "crosspoint_devices"."http_port" <= 65535)
);
--> statement-breakpoint
CREATE TABLE "crosspoint_sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"total_books" integer DEFAULT 0 NOT NULL,
	"uploaded" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"deleted" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"total_bytes" bigint,
	"transferred_bytes" bigint DEFAULT 0 NOT NULL,
	"error_class" varchar(128),
	"error" varchar(1000),
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crosspoint_sync_runs_status_chk" CHECK ("crosspoint_sync_runs"."status" in ('running', 'completed', 'failed', 'cancelled', 'interrupted')),
	CONSTRAINT "crosspoint_sync_runs_counts_nonnegative_chk" CHECK ("crosspoint_sync_runs"."total_books" >= 0 and "crosspoint_sync_runs"."uploaded" >= 0 and "crosspoint_sync_runs"."skipped" >= 0 and "crosspoint_sync_runs"."deleted" >= 0 and "crosspoint_sync_runs"."failed" >= 0 and "crosspoint_sync_runs"."transferred_bytes" >= 0),
	CONSTRAINT "crosspoint_sync_runs_total_bytes_nonnegative_chk" CHECK ("crosspoint_sync_runs"."total_bytes" is null or "crosspoint_sync_runs"."total_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "crosspoint_device_books" ADD CONSTRAINT "crosspoint_device_books_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspoint_device_books" ADD CONSTRAINT "crosspoint_device_books_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspoint_device_books" ADD CONSTRAINT "crosspoint_device_books_file_id_book_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."book_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspoint_device_books" ADD CONSTRAINT "crosspoint_device_books_owner_fk" FOREIGN KEY ("device_id","user_id") REFERENCES "public"."crosspoint_devices"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspoint_device_collections" ADD CONSTRAINT "crosspoint_device_collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspoint_device_collections" ADD CONSTRAINT "crosspoint_device_collections_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspoint_device_collections" ADD CONSTRAINT "crosspoint_device_collections_owner_fk" FOREIGN KEY ("device_id","user_id") REFERENCES "public"."crosspoint_devices"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspoint_device_smart_scopes" ADD CONSTRAINT "crosspoint_device_smart_scopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspoint_device_smart_scopes" ADD CONSTRAINT "crosspoint_device_smart_scopes_smart_scope_id_smart_scopes_id_fk" FOREIGN KEY ("smart_scope_id") REFERENCES "public"."smart_scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspoint_device_smart_scopes" ADD CONSTRAINT "crosspoint_device_smart_scopes_owner_fk" FOREIGN KEY ("device_id","user_id") REFERENCES "public"."crosspoint_devices"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspoint_devices" ADD CONSTRAINT "crosspoint_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspoint_sync_runs" ADD CONSTRAINT "crosspoint_sync_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspoint_sync_runs" ADD CONSTRAINT "crosspoint_sync_runs_owner_fk" FOREIGN KEY ("device_id","user_id") REFERENCES "public"."crosspoint_devices"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crosspoint_device_books_device_book_uidx" ON "crosspoint_device_books" USING btree ("device_id","book_id") WHERE "crosspoint_device_books"."book_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "crosspoint_device_books_device_path_uidx" ON "crosspoint_device_books" USING btree ("device_id","remote_path");--> statement-breakpoint
CREATE INDEX "crosspoint_device_books_user_device_idx" ON "crosspoint_device_books" USING btree ("user_id","device_id");--> statement-breakpoint
CREATE INDEX "crosspoint_device_books_book_id_idx" ON "crosspoint_device_books" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "crosspoint_device_books_last_seen_run_idx" ON "crosspoint_device_books" USING btree ("device_id","last_seen_run_id");--> statement-breakpoint
CREATE INDEX "crosspoint_device_collections_user_id_idx" ON "crosspoint_device_collections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "crosspoint_device_collections_collection_id_idx" ON "crosspoint_device_collections" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "crosspoint_device_smart_scopes_user_id_idx" ON "crosspoint_device_smart_scopes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "crosspoint_device_smart_scopes_smart_scope_id_idx" ON "crosspoint_device_smart_scopes" USING btree ("smart_scope_id");--> statement-breakpoint
CREATE INDEX "crosspoint_devices_user_id_idx" ON "crosspoint_devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crosspoint_devices_user_device_id_uidx" ON "crosspoint_devices" USING btree ("user_id","device_id") WHERE "crosspoint_devices"."device_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "crosspoint_devices_user_host_port_uidx" ON "crosspoint_devices" USING btree ("user_id","host","ws_port");--> statement-breakpoint
CREATE INDEX "crosspoint_sync_runs_user_started_idx" ON "crosspoint_sync_runs" USING btree ("user_id","started_at" desc);--> statement-breakpoint
CREATE INDEX "crosspoint_sync_runs_device_started_idx" ON "crosspoint_sync_runs" USING btree ("device_id","started_at" desc);