import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS product_priority text;
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS ai_content jsonb;
    `);
    await client.query(`
      ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS domain text;
    `);
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
    console.log("Database columns ensured");
  } finally {
    client.release();
  }
}
