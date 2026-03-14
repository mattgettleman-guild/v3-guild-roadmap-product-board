/**
 * Migration: add columns that exist in v3 schema but not in the live DB.
 * Safe to run multiple times — uses IF NOT EXISTS.
 *
 * Run with:
 *   npx tsx backend/src/lib/migrations/add-missing-columns.ts
 */

import "dotenv/config";
import { db } from "../db.js";
import { sql } from "drizzle-orm";

async function run() {
  console.log("Running add-missing-columns migration…");

  const migrations = [
    // users table
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS dismissed_alerts jsonb NOT NULL DEFAULT '[]'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS digest_subscribed boolean NOT NULL DEFAULT true`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_digest_sent_at timestamptz`,

    // product_priorities table — v3 brief fields
    `ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS slug text`,
    `ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'`,
    `ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS owner jsonb NOT NULL DEFAULT '[]'`,
    `ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS brief_objective text`,
    `ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS problem_statement text`,
    `ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS out_of_scope text`,
    `ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS success_metrics jsonb`,
    `ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS key_assumptions jsonb`,
    `ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS ai_summary text`,
    `ALTER TABLE product_priorities ADD COLUMN IF NOT EXISTS created_by text NOT NULL DEFAULT 'system'`,

    // roadmap_rows — priority FK
    `ALTER TABLE roadmap_rows ADD COLUMN IF NOT EXISTS priority_id uuid REFERENCES product_priorities(id)`,

    // Add unique constraint on product_priorities.slug if column was just added
    // (safe: IF NOT EXISTS not supported for constraints, so catch the error)
  ];

  for (const stmt of migrations) {
    try {
      await db.execute(sql.raw(stmt));
      console.log(`  ✓ ${stmt.slice(0, 70)}…`);
    } catch (err: any) {
      if (err?.code === "42P07" || err?.message?.includes("already exists")) {
        console.log(`  · skipped (already exists): ${stmt.slice(0, 60)}`);
      } else {
        console.error(`  ✗ ${stmt.slice(0, 70)}`);
        console.error(`    ${err?.message}`);
      }
    }
  }

  // Backfill slug for any priorities that don't have one yet
  await db.execute(sql.raw(`
    UPDATE product_priorities
    SET slug = lower(regexp_replace(name, '[^a-z0-9]+', '-', 'gi'))
    WHERE slug IS NULL OR slug = ''
  `));
  console.log("  ✓ backfilled slugs");

  // Backfill priority_id on roadmap_rows
  await db.execute(sql.raw(`
    UPDATE roadmap_rows r
    SET priority_id = p.id
    FROM product_priorities p
    WHERE r.product_priority = p.name
      AND r.priority_id IS NULL
  `));
  console.log("  ✓ backfilled priority_id FK");

  console.log("Migration complete.");
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
