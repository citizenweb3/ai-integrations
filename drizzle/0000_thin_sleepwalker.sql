CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "chat_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"ip_hash" varchar(64) NOT NULL,
	"query" text NOT NULL,
	"rewritten_query" text,
	"retrieved_ids" integer[] NOT NULL,
	"answer" text NOT NULL,
	"sources_json" jsonb,
	"feedback" varchar(8),
	"feedback_comment" text,
	"latency_ms" integer NOT NULL,
	"retrieval_latency_ms" integer,
	"generation_latency_ms" integer,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"finish_reason" varchar(64),
	"model" varchar(64) NOT NULL,
	"error_code" varchar(64),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logos_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"section_path" text,
	"content" text NOT NULL,
	"context_prefix" text,
	"content_for_embed" text NOT NULL,
	"content_tsv" "tsvector",
	"embedding" vector(768),
	"embedding_model" varchar(64),
	"token_count" integer,
	"language" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logos_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"identifier" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"content_hash" varchar(64),
	"remote_revision" varchar(128),
	"last_fetched_at" timestamp with time zone,
	"last_indexed_at" timestamp with time zone,
	"fetch_error" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "logos_sources_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
ALTER TABLE "logos_chunks" ADD CONSTRAINT "logos_chunks_source_id_logos_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."logos_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_logs_session_idx" ON "chat_logs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "chat_logs_created_idx" ON "chat_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "chat_logs_feedback_idx" ON "chat_logs" USING btree ("feedback");--> statement-breakpoint
CREATE INDEX "logos_chunks_source_idx" ON "logos_chunks" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "logos_chunks_source_chunk_idx" ON "logos_chunks" USING btree ("source_id","chunk_index");--> statement-breakpoint
CREATE INDEX "logos_chunks_embedding_idx" ON "logos_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "logos_chunks_tsv_idx" ON "logos_chunks" USING gin ("content_tsv");--> statement-breakpoint
CREATE INDEX "logos_sources_type_idx" ON "logos_sources" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "logos_sources_fetched_idx" ON "logos_sources" USING btree ("last_fetched_at");--> statement-breakpoint
CREATE TRIGGER logos_chunks_tsv_update
	BEFORE INSERT OR UPDATE ON "logos_chunks"
	FOR EACH ROW EXECUTE FUNCTION
	tsvector_update_trigger(content_tsv, 'pg_catalog.english', content_for_embed);
