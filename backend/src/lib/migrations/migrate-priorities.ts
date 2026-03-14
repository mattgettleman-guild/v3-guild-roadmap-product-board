/**
 * Priority data migration: Sync product_priority strings from roadmap_rows
 * into the product_priorities table as UUID-based records.
 *
 * Run with: npx tsx backend/src/lib/migrations/migrate-priorities.ts
 */

import { db } from "../db.js";
import { roadmapRows, productPriorities } from "../schema.js";
import { eq, sql } from "drizzle-orm";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function migratePriorities() {
  console.log("[migrate-priorities] Starting priority migration...");

  // 1. Read all distinct productPriority strings from roadmap_rows
  const distinctPriorities = await db
    .selectDistinct({ name: roadmapRows.productPriority })
    .from(roadmapRows)
    .where(sql`${roadmapRows.productPriority} IS NOT NULL AND ${roadmapRows.productPriority} != ''`);

  console.log(
    `[migrate-priorities] Found ${distinctPriorities.length} distinct priorities in roadmap_rows`,
  );

  // 2. For each, check if a product_priorities record exists
  let created = 0;
  let skipped = 0;

  for (const { name } of distinctPriorities) {
    if (!name || name === "Uncategorized") {
      skipped++;
      continue;
    }

    const existing = await db
      .select({ id: productPriorities.id })
      .from(productPriorities)
      .where(eq(productPriorities.name, name))
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      console.log(`  [skip] "${name}" already exists`);
      continue;
    }

    // Insert new product_priorities record
    const slug = slugify(name);
    const [inserted] = await db
      .insert(productPriorities)
      .values({
        name,
        slug,
        status: "active",
        createdBy: "migration",
        updatedBy: "migration",
      })
      .returning({ id: productPriorities.id });

    console.log(`  [created] "${name}" → ${inserted.id}`);
    created++;
  }

  console.log(
    `[migrate-priorities] Created ${created}, skipped ${skipped}`,
  );

  // 3. Back-fill priority_id on roadmap_rows
  const allPriorities = await db
    .select({ id: productPriorities.id, name: productPriorities.name })
    .from(productPriorities);

  let linked = 0;
  for (const priority of allPriorities) {
    const result = await db
      .update(roadmapRows)
      .set({ priorityId: priority.id })
      .where(
        sql`${roadmapRows.productPriority} = ${priority.name} AND (${roadmapRows.priorityId} IS NULL OR ${roadmapRows.priorityId} != ${priority.id})`,
      );

    // Count rows from the raw result if available
    linked++;
  }

  console.log(
    `[migrate-priorities] Back-filled priority_id for ${allPriorities.length} priorities`,
  );
  console.log("[migrate-priorities] Migration complete!");
  process.exit(0);
}

migratePriorities().catch((err) => {
  console.error("[migrate-priorities] FAILED:", err);
  process.exit(1);
});
