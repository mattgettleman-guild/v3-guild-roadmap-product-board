import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // v2 baseline
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_priorities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL UNIQUE,
        strategic_pillar text,
        commercial_why text,
        transformations jsonb,
        expected_outcomes jsonb,
        ai_generated_at timestamptz,
        ai_source_doc_id uuid,
        updated_by text NOT NULL DEFAULT 'system',
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS product_priority text;
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS ai_content jsonb;
      ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS domain text;
    `);

    // v3 additions — all IF NOT EXISTS, safe to run repeatedly
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS dismissed_alerts jsonb NOT NULL DEFAULT '[]';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS digest_subscribed boolean NOT NULL DEFAULT true;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_digest_sent_at timestamptz;
    `);
    await client.query(`
      ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS slug text;
      ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
      ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS owner jsonb NOT NULL DEFAULT '[]';
      ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS brief_objective text;
      ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS problem_statement text;
      ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS out_of_scope text;
      ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS success_metrics jsonb;
      ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS key_assumptions jsonb;
      ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS ai_summary text;
      ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS created_by text NOT NULL DEFAULT 'system';
    `);
    await client.query(`
      ALTER TABLE roadmap_rows ADD COLUMN IF NOT EXISTS priority_id uuid REFERENCES product_priorities(id);
    `);

    // Backfill slugs for any priorities missing one
    await client.query(`
      UPDATE product_priorities
      SET slug = lower(regexp_replace(name, '[^a-z0-9]+', '-', 'gi'))
      WHERE slug IS NULL OR slug = '';
    `);

    console.log("Database columns ensured");
  } finally {
    client.release();
  }
}
