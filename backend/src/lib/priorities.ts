import { eq, isNull, sql } from "drizzle-orm";
import { db } from "./db.js";
import { roadmapRows, productPriorities } from "./schema.js";
import { generatePrioritySummary } from "./ai-client.js";

/**
 * Ensures a product_priorities row exists for every distinct productPriority
 * value in roadmap_rows. Does NOT overwrite existing commercialWhy content.
 */
export async function syncPriorityRecords(actor = "system"): Promise<void> {
  const rows = await db
    .select({ productPriority: roadmapRows.productPriority, strategicPillar: roadmapRows.strategicPillar })
    .from(roadmapRows);

  // Build map of priority → most common pillar
  const pillarCount: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const name = r.productPriority?.trim();
    if (!name || name === "Uncategorized") continue;
    const pillar = r.strategicPillar?.trim() ?? "";
    if (!pillarCount[name]) pillarCount[name] = {};
    pillarCount[name][pillar] = (pillarCount[name][pillar] ?? 0) + 1;
  }

  for (const [name, pillars] of Object.entries(pillarCount)) {
    const strategicPillar = Object.entries(pillars).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    await db
      .insert(productPriorities)
      .values({ name, strategicPillar, updatedBy: actor })
      .onConflictDoUpdate({
        target: productPriorities.name,
        set: { strategicPillar, updatedBy: actor, updatedAt: sql`now()` },
      });
  }
}

/**
 * Generates commercialWhy summaries for all product_priorities that don't have one.
 * Runs with a concurrency cap of 3 to avoid hammering OpenAI.
 * Intended to be called fire-and-forget (non-blocking).
 */
export async function autoGenerateMissingSummaries(): Promise<void> {
  const missing = await db
    .select()
    .from(productPriorities)
    .where(isNull(productPriorities.commercialWhy));

  if (missing.length === 0) return;
  console.log(`[Priority Sync] Generating summaries for ${missing.length} priorities...`);

  const allRows = await db
    .select({
      productPriority: roadmapRows.productPriority,
      investment: roadmapRows.investment,
      description: roadmapRows.description,
      expectedBenefits: roadmapRows.expectedBenefits,
      jiraLinks: roadmapRows.jiraLinks,
      tactics: roadmapRows.tactics,
    })
    .from(roadmapRows);

  const byPriority = new Map<string, typeof allRows>();
  for (const r of allRows) {
    if (!byPriority.has(r.productPriority)) byPriority.set(r.productPriority, []);
    byPriority.get(r.productPriority)!.push(r);
  }

  const CONCURRENCY = 3;
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const batch = missing.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (p) => {
        const investments = byPriority.get(p.name) ?? [];
        if (investments.length === 0) return;

        const investmentInputs = investments.map((r) => ({
          investment: r.investment,
          description: r.description ?? undefined,
          expectedBenefits: (r.expectedBenefits as string[]) ?? [],
          jiraKeys: ((r.jiraLinks as Array<{ key: string }>) ?? []).map((j) => j.key).filter(Boolean),
          tactics: ((r.tactics as Array<{ name: string; description?: string; status?: string }>) ?? []).map(
            (t) => ({ name: t.name, description: t.description, status: t.status }),
          ),
        }));

        try {
          const summary = await generatePrioritySummary(p.name, p.strategicPillar ?? "", investmentInputs);
          await db
            .update(productPriorities)
            .set({ commercialWhy: summary, aiGeneratedAt: new Date(), updatedAt: new Date() })
            .where(eq(productPriorities.name, p.name));
          console.log(`[Priority Sync] Generated summary for "${p.name}"`);
        } catch (err) {
          console.error(`[Priority Sync] Failed to generate summary for "${p.name}":`, err);
        }
      }),
    );
  }
  console.log("[Priority Sync] Done.");
}

/**
 * Sync records then kick off background generation. Call this after imports.
 */
export function syncAndGeneratePriorities(actor = "system"): void {
  syncPriorityRecords(actor)
    .then(() => autoGenerateMissingSummaries())
    .catch((err) => console.error("[Priority Sync] Error:", err));
}
